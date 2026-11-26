// 群聊编排：回复模式、@ 解析、上下文拼装、并发上限、取消、超时、失败隔离。
// 不依赖 Electron——可以用注入的 chat 在 Node 里直接测（见 scripts/selfcheck.ts）。

import { randomUUID } from 'node:crypto'
import type { Bot, Conversation, Message, RunEvent, SendInput, SendResult, ToolStep, WebSource } from '../../shared/types'
import * as repo from './repo'
import { chat as realChat, type ChatMessage } from './llm'
import { composeSystemPrompt } from './prompt'

export type ChatFn = typeof realChat

export interface RespondDeps {
  emit: (event: RunEvent) => void
  resolveKey: (providerId: string) => string | undefined
  chat?: ChatFn
}

const MAX_CONCURRENCY = 4
const CONTEXT_LIMIT = 20
const TIMEOUT_MS = 120_000

const active = new Map<string, AbortController>()

export function cancelRun(runId: string): void {
  active.get(runId)?.abort()
}

export async function respond(input: SendInput, deps: RespondDeps): Promise<SendResult> {
  const chatFn = deps.chat ?? realChat
  const conversation = repo.getConversation(input.conversationId)
  if (!conversation) throw new Error('会话不存在')

  const text = input.text.trim()
  if (!text) throw new Error('不能发送空消息')

  const botIds = resolveTargets(conversation, text)

  const now = Date.now()
  const userMsg: Message = {
    id: randomUUID(),
    conversationId: conversation.id,
    author: 'user',
    content: text,
    status: 'done',
    createdAt: now
  }
  repo.addMessage(userMsg)

  const tasks = botIds.map(botId => {
    const message: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      author: 'bot',
      botId,
      runId: randomUUID(),
      content: '',
      status: 'queued',
      createdAt: now + 1
    }
    repo.addMessage(message)
    deps.emit({
      type: 'status',
      runId: message.runId as string,
      conversationId: conversation.id,
      botId,
      messageId: message.id,
      status: 'queued'
    })
    return { botId, message }
  })

  const queue = [...tasks]
  const work = async (): Promise<void> => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      await runOne(conversation.id, task.botId, task.message, chatFn, deps)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, work))

  return { userMsg, runIds: tasks.map(t => t.message.runId as string) }
}

function resolveTargets(conversation: Conversation, text: string): string[] {
  if (conversation.kind === 'dm' || conversation.replyMode !== 'mention') {
    return conversation.botIds
  }
  return conversation.botIds.filter(botId => {
    const bot = repo.getBot(botId)
    return bot ? isMentioned(bot, text) : false
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isMentioned(bot: Bot, text: string): boolean {
  const pattern = new RegExp(`@${escapeRegExp(bot.name)}(?=\\s|[，。,.!?！？:：]|$)`)
  return pattern.test(text)
}

async function runOne(
  conversationId: string,
  botId: string,
  message: Message,
  chatFn: ChatFn,
  deps: RespondDeps
): Promise<void> {
  const runId = message.runId as string
  const controller = new AbortController()
  active.set(runId, controller)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)
  let content = ''
  let sources: WebSource[] = []
  let queries: string[] = []
  const steps: ToolStep[] = []

  try {
    const bot = repo.getBot(botId)
    const provider = bot ? repo.getProvider(bot.providerId) : undefined
    if (!bot || !provider) throw new Error('Bot 或服务商不存在，请重新配置')

    const messages = buildContext(conversationId, bot)
    repo.updateMessage(message.id, { status: 'streaming' })
    deps.emit({ type: 'status', runId, conversationId, botId, messageId: message.id, status: 'streaming' })

    let usage: { in: number; out: number } | undefined
    for await (const chunk of chatFn({
      provider,
      model: bot.model,
      apiKey: deps.resolveKey(provider.id),
      messages,
      temperature: bot.temperature,
      signal: controller.signal
    })) {
      if (chunk.delta) {
        content += chunk.delta
        deps.emit({ type: 'delta', runId, conversationId, botId, messageId: message.id, delta: chunk.delta })
      }
      if (chunk.usage) usage = chunk.usage
      if (chunk.sources) sources = chunk.sources
      if (chunk.queries) queries = chunk.queries
      if (chunk.sources || chunk.queries) {
        deps.emit({
          type: 'search',
          runId,
          conversationId,
          botId,
          messageId: message.id,
          sources: chunk.sources,
          queries: chunk.queries
        })
      }
      if (chunk.step) {
        const index = steps.findIndex(step => step.id === chunk.step?.id)
        if (index >= 0) steps[index] = chunk.step
        else steps.push(chunk.step)
        deps.emit({
          type: 'step',
          runId,
          conversationId,
          botId,
          messageId: message.id,
          step: chunk.step
        })
      }
    }

    repo.updateMessage(message.id, {
      content,
      status: 'done',
      sources: sources.length > 0 ? sources : undefined,
      searchQueries: queries.length > 0 ? queries : undefined,
      steps: steps.length > 0 ? steps : undefined
    })
    deps.emit({
      type: 'done',
      runId,
      conversationId,
      botId,
      messageId: message.id,
      usage,
      sources: sources.length > 0 ? sources : undefined,
      queries: queries.length > 0 ? queries : undefined
    })
  } catch (err) {
    if (timedOut) {
      const error = '请求超时（120 秒）'
      repo.updateMessage(message.id, {
        content,
        status: 'error',
        error,
        sources: sources.length ? sources : undefined,
        searchQueries: queries.length ? queries : undefined,
        steps: steps.length ? steps : undefined
      })
      deps.emit({ type: 'error', runId, conversationId, botId, messageId: message.id, error })
    } else if (controller.signal.aborted) {
      repo.updateMessage(message.id, {
        content,
        status: 'cancelled',
        sources: sources.length ? sources : undefined,
        searchQueries: queries.length ? queries : undefined,
        steps: steps.length ? steps : undefined
      })
      deps.emit({ type: 'cancelled', runId, conversationId, botId, messageId: message.id })
    } else {
      const error = errText(err)
      repo.updateMessage(message.id, {
        content,
        status: 'error',
        error,
        sources: sources.length ? sources : undefined,
        searchQueries: queries.length ? queries : undefined,
        steps: steps.length ? steps : undefined
      })
      deps.emit({ type: 'error', runId, conversationId, botId, messageId: message.id, error })
    }
  } finally {
    clearTimeout(timer)
    active.delete(runId)
  }
}

// 自己发的发言算 assistant；其他 Bot 的发言压成带名字前缀的 user 消息。
// 并行轮里看不到彼此本轮的回复——v0.1 的明确取舍。
function buildContext(conversationId: string, bot: Bot): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: composeSystemPrompt(bot) }]

  for (const message of repo.recentMessages(conversationId, CONTEXT_LIMIT)) {
    if (message.author === 'user') {
      messages.push({ role: 'user', content: message.content })
    } else if (message.botId === bot.id) {
      messages.push({ role: 'assistant', content: message.content })
    } else {
      const name = (message.botId && repo.getBot(message.botId)?.name) || 'Bot'
      messages.push({ role: 'user', content: `[${name}]：${message.content}` })
    }
  }
  return messages
}

function errText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.slice(0, 500)
}
