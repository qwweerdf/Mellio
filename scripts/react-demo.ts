// ReAct + calculator 最小可运行 demo。
// 默认离线 mock；设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后走真实 OpenAI 兼容接口。
//
//   npm run demo:react
//   npm run demo:react -- "帮我算 (12 + 8) * 3，再算 sqrt(144)"
//   LLM_BASE_URL=https://api.deepseek.com/v1 LLM_API_KEY=sk-... LLM_MODEL=deepseek-flash npm run demo:react

import { createOpenAiChat } from '../src/main/agent/openai'
import { runReAct, type AgentMessage, type ChatFn, type ReActEvent } from '../src/main/agent/react'
import { calculatorTool } from '../src/main/agent/tools/calculator'

const SYSTEM_PROMPT = `You are a ReAct agent.
Use the calculator tool for any arithmetic. Never calculate in your head.
After a tool returns, use its result to continue. When you have the final answer, reply normally without calling another tool.
Answer in the user's language.`

const DEFAULT_QUESTION = '帮我算 (12 + 8) * 3，再算 sqrt(144)，最后告诉我两个结果。'

async function main(): Promise<void> {
  const forceMock = process.argv.includes('--mock')
  const question = process.argv.slice(2).filter(arg => arg !== '--mock').join(' ').trim() || DEFAULT_QUESTION
  const apiKey = process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  const useMock = forceMock || !apiKey
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1'
  const model = process.env.LLM_MODEL ?? 'deepseek-flash'

  const chat: ChatFn = useMock
    ? mockChat
    : createOpenAiChat({ baseUrl, apiKey, model, temperature: 0.2 })

  console.log('ReAct demo · calculator only')
  console.log(`mode     ${useMock ? 'mock (offline)' : `${model} @ ${baseUrl}`}`)
  console.log(`question ${question}`)
  console.log('')

  const result = await runReAct({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question }
    ],
    tools: [calculatorTool],
    chat,
    maxSteps: 6,
    onEvent: printEvent
  })

  if (!result.content.trim()) {
    console.log('(agent produced no final text)')
  }
  console.log('')
  console.log(`done · ${result.steps.length} events`)
}

function printEvent(event: ReActEvent): void {
  switch (event.type) {
    case 'assistant':
      console.log(`[step ${event.step}] assistant`)
      console.log(indent(event.content))
      console.log('')
      break
    case 'tool_call':
      console.log(`[step ${event.step}] tool_call → ${event.call.name}`)
      console.log(indent(prettyJson(event.call.arguments)))
      console.log('')
      break
    case 'tool_result':
      console.log(`[step ${event.step}] tool_result${event.isError ? ' (error)' : ''} ← ${event.call.name}`)
      console.log(indent(prettyJson(event.result)))
      console.log('')
      break
    case 'final':
      console.log(`[step ${event.step}] final`)
      console.log(indent(event.content))
      break
    case 'limit':
      console.log(`[step ${event.step}] stopped: max steps reached`)
      console.log(indent(event.content))
      break
  }
}

// 离线 mock：第一轮调用 calculator，第二轮再调用一次，第三轮给最终答案。
// 用来在没有任何 API Key 的情况下验证循环、事件和步骤输出。
const mockChat: ChatFn = async ({ messages }) => {
  const toolMessages = messages.filter(
    (message): message is Extract<AgentMessage, { role: 'tool' }> => message.role === 'tool'
  )
  if (toolMessages.length === 0) {
    return {
      content: '我先算第一个表达式。',
      toolCalls: [
        {
          id: 'call_1',
          name: 'calculator',
          arguments: JSON.stringify({ expression: '(12 + 8) * 3' })
        }
      ]
    }
  }
  if (toolMessages.length === 1) {
    return {
      content: '再算第二个。',
      toolCalls: [
        {
          id: 'call_2',
          name: 'calculator',
          arguments: JSON.stringify({ expression: 'sqrt(144)' })
        }
      ]
    }
  }

  const values = toolMessages.map(message => {
    try {
      const parsed = JSON.parse(message.content) as { value?: unknown }
      return String(parsed.value)
    } catch {
      return message.content
    }
  })
  return { content: `两个结果分别是 ${values.join(' 和 ')}。` }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
}

main().catch(err => {
  console.error('ReAct demo failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
