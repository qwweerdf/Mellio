// 一个可执行的自检：旧数据迁移 + 回复模式/@ 解析 + 并行/失败隔离/取消 + SSE。
// npm run check

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as repo from '../src/main/repo'
import { cancelRun, respond, type ChatFn, type RespondDeps } from '../src/main/orchestrator'
import { chat } from '../src/main/llm'
import { composeSystemPrompt } from '../src/main/prompt'
import { isStepCount, ToolLoopAgent } from 'ai'
import { calculatorTool, evaluateExpression } from '../src/main/agent/tools/calculator'
import { createMockCalculatorModel } from './mock-agent-model'
import type { RunEvent } from '../shared/types'

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'mellio-check-'))
}

function deps(events: RunEvent[], chatFn: ChatFn): RespondDeps {
  return { emit: event => events.push(event), resolveKey: () => 'key', chat: chatFn }
}

const fakeChat: ChatFn = async function* (params) {
  if (params.model === 'boom') throw new Error('模拟失败')
  if (params.model === 'slow') {
    const aborted = new Promise<never>((_, reject) => {
      const fail = (): void => reject(new DOMException('aborted', 'AbortError'))
      if (params.signal?.aborted) fail()
      else params.signal?.addEventListener('abort', fail, { once: true })
    })
    aborted.catch(() => {})
    yield { delta: 'a' }
    await aborted
    return
  }
  yield { delta: '你' }
  yield { delta: '好呀' }
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function testLegacyImport(): Promise<void> {
  const dir = makeDir()
  writeFileSync(
    join(dir, 'data.json'),
    JSON.stringify({
      providers: [{ id: 'p1', name: 'fake', type: 'fake', baseUrl: '' }],
      bots: [
        {
          id: 'b1',
          name: 'A',
          emoji: '🤖',
          color: '#000000',
          systemPrompt: '',
          providerId: 'p1',
          model: 'm',
          temperature: 0.7
        }
      ],
      conversations: [{ id: 'c1', title: '旧会话', botIds: ['b1'], createdAt: 1 }],
      messages: [
        { id: 'm1', conversationId: 'c1', author: 'user', content: 'hello', status: 'done', createdAt: 2 }
      ]
    })
  )

  repo.initRepo(dir)
  const bots = repo.listBots()
  assert.equal(bots.length, 1)
  assert.ok(bots[0].avatar, '旧 Bot 自动分配预设头像')
  const conversation = repo.getConversation('c1')
  assert.equal(conversation?.kind, 'dm')
  assert.equal(repo.listMessages('c1').length, 1)
  assert.ok(existsSync(join(dir, 'data.json.imported')))
  repo.closeRepo()
  rmSync(dir, { recursive: true, force: true })
  console.log('  ✓ 旧 JSON 数据导入 SQLite')
}

async function testReplyModes(): Promise<void> {
  const dir = makeDir()
  repo.initRepo(dir)
  const provider = repo.saveProvider({ name: 'fake', type: 'fake', baseUrl: '' })
  const a = repo.saveBot({
    name: '阿码',
    avatar: 'bot',
    emoji: '🤖',
    color: '#BFD6EE',
    systemPrompt: 'A',
    providerId: provider.id,
    model: 'ok',
    temperature: 0.7
  })
  const b = repo.saveBot({
    name: '判官',
    avatar: 'clover',
    emoji: '🍀',
    color: '#A9D3CF',
    systemPrompt: 'B',
    providerId: provider.id,
    model: 'boom',
    temperature: 0.7
  })

  const group = repo.createGroup('测试群', [a.id, b.id])
  assert.equal(group.replyMode, 'all')

  const events: RunEvent[] = []
  await respond({ conversationId: group.id, text: '你好' }, deps(events, fakeChat))

  let messages = repo.listMessages(group.id)
  assert.equal(messages.length, 3, 'user + 2 bot')
  const okMsg = messages.find(m => m.botId === a.id)
  const badMsg = messages.find(m => m.botId === b.id)
  assert.equal(okMsg?.content, '你好呀')
  assert.equal(okMsg?.status, 'done')
  assert.equal(badMsg?.status, 'error', '单个失败不影响其他 Bot')
  assert.ok(events.some(e => e.type === 'delta' && e.messageId === okMsg?.id))
  assert.ok(events.some(e => e.type === 'error' && e.messageId === badMsg?.id))

  // @ 模式：只有被点名的 Bot 回复
  repo.setReplyMode(group.id, 'mention')
  const before = repo.listMessages(group.id).length
  const mentionEvents: RunEvent[] = []
  const mentionResult = await respond(
    { conversationId: group.id, text: '@阿码 你好' },
    deps(mentionEvents, fakeChat)
  )
  assert.equal(mentionResult.runIds.length, 1)
  messages = repo.listMessages(group.id)
  assert.equal(messages.length, before + 2, 'user + 仅阿码')
  assert.equal(messages.filter(m => m.botId === b.id).length, 1, '判官没有被点名')

  // @ 模式：没有点名时不出 Run
  const quiet = await respond(
    { conversationId: group.id, text: '大家先别动' },
    deps([], fakeChat)
  )
  assert.equal(quiet.runIds.length, 0)
  assert.equal(repo.listMessages(group.id).filter(m => m.author === 'user').length, 3)

  repo.closeRepo()
  rmSync(dir, { recursive: true, force: true })
  console.log('  ✓ 回复模式（全部 / @）、失败隔离、持久化')
}

async function testCancel(): Promise<void> {
  const dir = makeDir()
  repo.initRepo(dir)
  const provider = repo.saveProvider({ name: 'fake', type: 'fake', baseUrl: '' })
  const slow = repo.saveBot({
    name: '慢速',
    avatar: 'fish',
    emoji: '🐟',
    color: '#DDBBA3',
    systemPrompt: '',
    providerId: provider.id,
    model: 'slow',
    temperature: 0.7
  })
  const dm = repo.openBotChat(slow.id)
  assert.equal(dm.kind, 'dm')
  assert.equal(dm.botIds[0], slow.id)

  const pending = respond({ conversationId: dm.id, text: '开始' }, deps([], fakeChat))
  await waitFor(() => repo.listMessages(dm.id).some(m => m.status === 'streaming'))
  const running = repo.listMessages(dm.id).find(m => m.status === 'streaming')
  const runId = running?.runId
  assert.ok(runId)
  cancelRun(runId)
  await pending

  const message = repo.listMessages(dm.id).find(m => m.author === 'bot')
  assert.equal(message?.status, 'cancelled')
  assert.equal(message?.content, 'a', '取消后保留已生成内容')

  repo.closeRepo()
  rmSync(dir, { recursive: true, force: true })
  console.log('  ✓ 单聊会话与取消保留部分内容')
}

async function testSse(): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}\n\n'
    )
    res.write(
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}\n\n'
    )
    res.write(
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n'
    )
    res.write('data: [DONE]\n\n')
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  let output = ''
  for await (const chunk of chat({
    provider: { type: 'openai', baseUrl: `http://127.0.0.1:${port}` },
    model: 'test',
    apiKey: 'k',
    messages: [{ role: 'user', content: 'hi' }]
  })) {
    output += chunk.delta ?? ''
  }
  server.close()
  server.closeAllConnections()

  assert.equal(output, '你好')
  console.log('  ✓ SSE 流式解析')
}

function testSystemPrompt(): void {
  const prompt = composeSystemPrompt({
    id: 'b',
    name: '阿码',
    avatar: '',
    emoji: '🤖',
    color: '#000000',
    systemPrompt: '你是后端工程师，回答直接。',
    providerId: 'p',
    model: 'm',
    temperature: 0.7
  })
  assert.match(prompt, /You are 阿码/)
  assert.match(prompt, /<persona>\n你是后端工程师，回答直接。\n<\/persona>/)
  assert.ok(!prompt.includes('{{'), '模板占位符应全部替换')
  console.log('  ✓ 默认 system prompt（名称/人设/时间注入）')
}

async function testDeepSeekAutoSearch(): Promise<void> {
  const bodies: Array<{ tools?: unknown; temperature?: unknown }> = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      bodies.push(JSON.parse(body) as { tools?: unknown; temperature?: unknown })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"mock","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n'
      )
      res.write(
        'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"mock","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
      )
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const run = async (model: string): Promise<void> => {
    for await (const _chunk of chat({
      provider: { type: 'deepseek', baseUrl: `http://127.0.0.1:${port}` },
      model,
      apiKey: 'k',
      temperature: 0.7,
      messages: [{ role: 'user', content: 'hi' }]
    })) {
      /* 只为收集请求体 */
    }
  }
  await run('deepseek-flash')
  await run('deepseek-v4-flash')
  server.close()
  server.closeAllConnections()

  const tools0 = bodies[0]?.tools as Array<{ type?: string; function?: { name?: string } }>
  const tools1 = bodies[1]?.tools as Array<{ type?: string; function?: { name?: string } }>
  assert.ok(tools0.some(tool => tool.type === 'deepseek_web_search'))
  assert.ok(tools0.some(tool => tool.function?.name === 'calculator'))
  assert.equal(bodies[0]?.temperature, undefined, '带搜索工具时不传 temperature')
  assert.ok(tools1.every(tool => tool.type !== 'deepseek_web_search'), '不支持搜索的模型不声明搜索工具')
  assert.ok(tools1.some(tool => tool.function?.name === 'calculator'))
  assert.equal(bodies[1]?.temperature, 0.7)
  console.log('  ✓ DeepSeek 自动联网（模型决定是否调用）')
}

async function testCalculatorReact(): Promise<void> {
  assert.equal(await evaluateExpression('(12 + 8) * 3'), 60)
  assert.equal(await evaluateExpression('sqrt(144)'), 12)
  await assert.rejects(() => evaluateExpression('a = 1'))
  await assert.rejects(() => evaluateExpression('import("fs")'))
  await assert.rejects(() => evaluateExpression('sqrt.constructor'))
  await assert.rejects(() => evaluateExpression('[1, 2]'))

  const agent = new ToolLoopAgent({
    model: createMockCalculatorModel(),
    instructions: 'Use the calculator tool for arithmetic.',
    tools: { calculator: calculatorTool },
    stopWhen: isStepCount(6)
  })
  const result = await agent.stream({
    messages: [{ role: 'user', content: '算一下 (12 + 8) * 3，再算 sqrt(144)' }]
  })
  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') text += part.text
  }
  assert.equal(text, '两个结果分别是 60 和 12。')
  const steps = await result.steps
  assert.equal(steps.length, 3)
  assert.equal(steps.flatMap(step => step.toolCalls).length, 2)
  console.log('  ✓ ToolLoopAgent 循环 + calculator 工具')
}

async function main(): Promise<void> {
  testSystemPrompt()
  await testCalculatorReact()
  await testLegacyImport()
  await testReplyModes()
  await testCancel()
  await testSse()
  await testDeepSeekAutoSearch()
  console.log('✓ selfcheck passed')
}

main().catch(err => {
  console.error('✗ selfcheck failed:', err)
  process.exit(1)
})
