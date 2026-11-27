// 团队协作：负责人拆任务 → 成员顺序执行 → 负责人审核/打回 → 负责人汇总。
// AI SDK 负责每个 Bot 的模型调用；任务状态和消息顺序由这里控制。

import { randomUUID } from 'node:crypto'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import type { Bot, Conversation, Message, SendResult, ToolStep, WebSource } from '../../shared/types'
import { chat, type ChatMessage } from './llm'
import { composeSystemPrompt } from './prompt'
import * as repo from './repo'
import type { RespondDeps } from './orchestrator'

const MAX_TASKS = 5
const RESULT_LIMIT = 6000

const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        assigneeId: z.string(),
        title: z.string(),
        brief: z.string(),
        acceptance: z.array(z.string()).min(1).max(6)
      })
    )
    .min(1)
    .max(MAX_TASKS)
})

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  feedback: z.string().default('')
})

type Plan = z.infer<typeof planSchema>
type Review = z.infer<typeof reviewSchema>

interface TeamResult {
  task: Plan['tasks'][number]
  worker: Bot
  content: string
  rejected: number
}

const TEAM_PLAN_PROMPT = `You are the team lead. Break the user's request into 1–5 concrete tasks for teammates.
- Only assign tasks to the listed teammate IDs.
- Each task must be self-contained: the worker will not see the full chat history.
- Express your reasoning clearly and naturally while using as few words as possible. Be concise, direct, and precise. 
- Focus on key points. Avoid unnecessary explanations, repetition, filler words, and verbosity. Say more with less. 
- Do not assign the same trivial work twice.
Return the plan through the submit_plan tool.`

const TEAM_WORKER_PROMPT = `You are executing one task for a team lead.
- Return only the deliverable. No greeting, no preamble, no restating the task, no process narration, no closing offer.
- Express your reasoning clearly and naturally while using as few words as possible. Be concise, direct, and precise. 
- Focus on key points. Avoid unnecessary explanations, repetition, filler words, and verbosity. Say more with less. 
- Follow the task brief and acceptance criteria. If something is impossible, state the blocker in one sentence.
- Before starting, read the team context and prior results. Reuse information that is already there instead of redoing the work.
- Do not speak to the end user; the lead will summarize.`

const TEAM_FINAL_PROMPT = `You are the team lead reporting to the end user.
Return a short final answer: what was delivered, who owned what, and any risks or unfinished items.
Referencing all teammates' answers, and conclude the final answer to user question or request.
Express your reasoning clearly and naturally while using as few words as possible. Be concise, direct, and precise. 
Focus on key points. Avoid unnecessary explanations, repetition, filler words, and verbosity. Say more with less. 
Use bullets only when they help.
No greeting, no process narration, no repeating the original task, no internal tooling details.
You are the only team member allowed to reply to the user.`

const teamCancellers = new Map<string, AbortController>()

export function cancelTeamRun(runId: string): void {
  teamCancellers.get(runId)?.abort()
}

export async function respondTeam(
  conversation: Conversation,
  text: string,
  deps: RespondDeps
): Promise<SendResult> {
  if (!conversation.leadBotId) throw new Error('团队协作还没有选择负责人')
  const lead = repo.getBot(conversation.leadBotId)
  if (!lead || !conversation.botIds.includes(lead.id)) throw new Error('团队负责人不在群里')

  const workers = conversation.botIds
    .filter(id => id !== lead.id)
    .map(id => repo.getBot(id))
    .filter((bot): bot is Bot => Boolean(bot))
  if (workers.length === 0) throw new Error('团队协作至少需要一名执行成员')

  const userMsg: Message = {
    id: randomUUID(),
    conversationId: conversation.id,
    author: 'user',
    content: text,
    status: 'done',
    createdAt: Date.now()
  }
  repo.addMessage(userMsg)

  const controller = new AbortController()
  const runIds: string[] = []
  const register = (runId: string): void => {
    runIds.push(runId)
    teamCancellers.set(runId, controller)
  }

  try {
    // 先放一个负责人占位消息：前端立即显示“思考中”，拆完任务后复用它作为第一条任务分配。
    const planMessage = createThinkingMessage(conversation.id, lead.id, deps, register)
    const plan = await planTasks({
      lead,
      workers,
      task: text,
      context: teamContext(conversation.id, []),
      deps,
      signal: controller.signal
    })
    const results: TeamResult[] = []
    let pendingAssignment: Message | undefined = planMessage

    for (const task of plan.tasks.slice(0, MAX_TASKS)) {
      if (controller.signal.aborted) break
      const worker = workers.find(bot => bot.id === task.assigneeId) ?? workers[0]
      if (!worker) continue

      let rejectionCount = 0
      let feedback = ''
      let result = ''

      while (!controller.signal.aborted) {
        if (!feedback) {
          const assignment = `@${worker.name} 任务：${task.title}\n${task.brief}`
          if (pendingAssignment) {
            finishInternalMessage(pendingAssignment, assignment, deps)
            pendingAssignment = undefined
          } else {
            const placeholder = createThinkingMessage(conversation.id, lead.id, deps, register)
            await new Promise<void>(resolve => setTimeout(resolve, 180))
            finishInternalMessage(placeholder, assignment, deps)
          }
        }

        const run = await runAgentMessage({
          conversationId: conversation.id,
          bot: worker,
          deps,
          controller,
          register,
          systemExtra: TEAM_WORKER_PROMPT,
          prompt: `${teamContext(conversation.id, results)}\n\n原始目标：${text}\n\n你的任务：${task.title}\n${task.brief}\n\n验收标准：\n${task.acceptance.map(item => `- ${item}`).join('\n')}${feedback ? `\n\n负责人反馈：${feedback}` : ''}`
        })
        result = run.content

        if (rejectionCount >= conversation.maxRejections) break

        const reviewThinking = createThinkingMessage(conversation.id, lead.id, deps, register)
        const review = await reviewTask({
          lead,
          worker,
          task,
          result,
          rejectionCount,
          maxRejections: conversation.maxRejections,
          deps,
          signal: controller.signal
        })

        if (review.decision === 'approve') {
          removeInternalMessage(reviewThinking, deps)
          break
        }

        rejectionCount++
        feedback = review.feedback
        if (rejectionCount > conversation.maxRejections) {
          removeInternalMessage(reviewThinking, deps)
          break
        }
        finishInternalMessage(reviewThinking, `@${worker.name} 需要修改：${feedback}`, deps)
      }

      results.push({ task, worker, content: result, rejected: rejectionCount })
      if (controller.signal.aborted) break
    }

    if (controller.signal.aborted) {
      return { userMsg, runIds }
    }

    const final = await runAgentMessage({
      conversationId: conversation.id,
      bot: lead,
      deps,
      controller,
      register,
      systemExtra: TEAM_FINAL_PROMPT,
      prompt: finalPrompt(text, results)
    })

    return { userMsg, runIds: final.runId ? [final.runId] : runIds.slice(-1) }
  } finally {
    for (const runId of runIds) teamCancellers.delete(runId)
  }
}

async function planTasks(params: {
  lead: Bot
  workers: Bot[]
  task: string
  context: string
  deps: RespondDeps
  signal: AbortSignal
}): Promise<Plan> {
  const roster = params.workers
    .map(worker => `- ${worker.id}: ${worker.name} (${worker.model})`)
    .join('\n')
  try {
    return await generateStructured({
      bot: params.lead,
      deps: params.deps,
      signal: params.signal,
      schema: planSchema,
      toolName: 'submit_plan',
      system: `${composeSystemPrompt(params.lead, { calculator: false })}\n\n${TEAM_PLAN_PROMPT}\n\nTeammates:\n${roster}`,
      prompt: `Team context:\n${params.context}\n\nUser task:\n${params.task}`
    })
  } catch {
    return {
      tasks: params.workers.slice(0, 3).map((worker, index) => ({
        assigneeId: worker.id,
        title: `任务 ${index + 1}`,
        brief: params.task,
        acceptance: ['给出可执行、可检查的结果']
      }))
    }
  }
}

async function reviewTask(params: {
  lead: Bot
  worker: Bot
  task: Plan['tasks'][number]
  result: string
  rejectionCount: number
  maxRejections: number
  deps: RespondDeps
  signal: AbortSignal
}): Promise<Review> {
  try {
    return await generateStructured({
      bot: params.lead,
      deps: params.deps,
      signal: params.signal,
      schema: reviewSchema,
      toolName: 'submit_review',
      system: `${composeSystemPrompt(params.lead, { calculator: false })}\n\nYou are reviewing a teammate's work. Decide approve or reject. Reject only when an acceptance criterion is missing or the result is unusable. Keep feedback to 2 short sentences (at most 120 Chinese characters). Do not repeat the full task or list every criterion. If this is the last allowed revision, approve the best available result.`,
      prompt: `Task: ${params.task.title}\nBrief: ${params.task.brief}\nAcceptance:\n${params.task.acceptance.map(item => `- ${item}`).join('\n')}\n\nWorker: ${params.worker.name}\nResult:\n${params.result.slice(0, RESULT_LIMIT)}\n\nRejections used: ${params.rejectionCount}/${params.maxRejections}`
    })
  } catch {
    return { decision: 'approve', feedback: '' }
  }
}

async function generateStructured<T>(params: {
  bot: Bot
  deps: RespondDeps
  signal: AbortSignal
  schema: z.ZodType<T>
  toolName: string
  system: string
  prompt: string
}): Promise<T> {
  const model = modelFor(params.bot, params.deps)
  const result = await generateText({
    model,
    system: params.system,
    prompt: params.prompt,
    tools: {
      [params.toolName]: tool({
        description: 'Submit the structured result.',
        inputSchema: params.schema
      })
    },
    abortSignal: params.signal
  })

  const call = result.toolCalls[0]
  if (call) {
    const parsed = params.schema.safeParse(call.input)
    if (parsed.success) return parsed.data
  }

  const raw = result.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = params.schema.safeParse(JSON.parse(raw) as unknown)
  if (!parsed.success) throw new Error('团队负责人没有返回有效结构')
  return parsed.data
}

function modelFor(bot: Bot, deps: RespondDeps) {
  const provider = repo.getProvider(bot.providerId)
  if (!provider) throw new Error('服务商不存在')
  const apiKey = deps.resolveKey(provider.id)
  if (!apiKey) throw new Error('服务商还没有配置 API Key')
  return createOpenAICompatible({
    name: provider.name,
    baseURL: provider.baseUrl,
    apiKey
  })(bot.model)
}

interface AgentRunResult {
  content: string
  runId?: string
}

async function runAgentMessage(params: {
  conversationId: string
  bot: Bot
  deps: RespondDeps
  controller: AbortController
  register: (runId: string) => void
  systemExtra: string
  prompt: string
}): Promise<AgentRunResult> {
  const provider = repo.getProvider(params.bot.providerId)
  if (!provider) throw new Error('服务商不存在')
  const apiKey = params.deps.resolveKey(provider.id)
  if (!apiKey) throw new Error('服务商还没有配置 API Key')

  const runId = randomUUID()
  const message: Message = {
    id: randomUUID(),
    conversationId: params.conversationId,
    author: 'bot',
    botId: params.bot.id,
    runId,
    content: '',
    status: 'queued',
    createdAt: Date.now()
  }
  repo.addMessage(message)
  params.register(runId)
  params.deps.emit({
    type: 'status',
    runId,
    conversationId: params.conversationId,
    botId: params.bot.id,
    messageId: message.id,
    status: 'queued'
  })

  const model = params.bot.model.toLowerCase()
  const providerType = provider.type
  const webSearch = providerType === 'deepseek' && (model.startsWith('deepseek-flash') || model.startsWith('deepseek-v4-pro'))
  const calculator = !(providerType === 'deepseek' && model.startsWith('deepseek-v4-pro'))
  const system = `${composeSystemPrompt(params.bot, {
    webSearch,
    webSearchTool: model.startsWith('deepseek-v4-pro') ? 'web_search' : 'deepseek_web_search',
    calculator
  })}\n\n${params.systemExtra}`
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: params.prompt }
  ]

  let content = ''
  let sources: WebSource[] = []
  let queries: string[] = []
  const steps: ToolStep[] = []

  try {
    repo.updateMessage(message.id, { status: 'streaming' })
    params.deps.emit({
      type: 'status',
      runId,
      conversationId: params.conversationId,
      botId: params.bot.id,
      messageId: message.id,
      status: 'streaming'
    })

    for await (const chunk of chat({
      provider,
      model: params.bot.model,
      apiKey,
      messages,
      temperature: params.bot.temperature,
      signal: params.controller.signal
    })) {
      if (chunk.delta) {
        content += chunk.delta
        params.deps.emit({
          type: 'delta',
          runId,
          conversationId: params.conversationId,
          botId: params.bot.id,
          messageId: message.id,
          delta: chunk.delta
        })
      }
      if (chunk.sources) sources = chunk.sources
      if (chunk.queries) queries = chunk.queries
      if (chunk.sources || chunk.queries) {
        params.deps.emit({
          type: 'search',
          runId,
          conversationId: params.conversationId,
          botId: params.bot.id,
          messageId: message.id,
          sources: chunk.sources,
          queries: chunk.queries
        })
      }
      if (chunk.step) {
        const index = steps.findIndex(step => step.id === chunk.step?.id)
        if (index >= 0) steps[index] = chunk.step
        else steps.push(chunk.step)
        params.deps.emit({
          type: 'step',
          runId,
          conversationId: params.conversationId,
          botId: params.bot.id,
          messageId: message.id,
          step: chunk.step
        })
      }
    }

    repo.updateMessage(message.id, {
      content,
      status: 'done',
      sources: sources.length ? sources : undefined,
      searchQueries: queries.length ? queries : undefined,
      steps: steps.length ? steps : undefined
    })
    params.deps.emit({
      type: 'done',
      runId,
      conversationId: params.conversationId,
      botId: params.bot.id,
      messageId: message.id,
      sources: sources.length ? sources : undefined,
      queries: queries.length ? queries : undefined
    })
    return { content, runId }
  } catch (err) {
    const cancelled = params.controller.signal.aborted
    const error = err instanceof Error ? err.message : String(err)
    repo.updateMessage(message.id, {
      content,
      status: cancelled ? 'cancelled' : 'error',
      error: cancelled ? undefined : error,
      sources: sources.length ? sources : undefined,
      searchQueries: queries.length ? queries : undefined,
      steps: steps.length ? steps : undefined
    })
    if (cancelled) {
      params.deps.emit({
        type: 'cancelled',
        runId,
        conversationId: params.conversationId,
        botId: params.bot.id,
        messageId: message.id
      })
    } else {
      params.deps.emit({
        type: 'error',
        runId,
        conversationId: params.conversationId,
        botId: params.bot.id,
        messageId: message.id,
        error
      })
    }
    return { content, runId }
  }
}

function createThinkingMessage(
  conversationId: string,
  botId: string,
  deps: RespondDeps,
  register: (runId: string) => void
): Message {
  const runId = randomUUID()
  const message: Message = {
    id: randomUUID(),
    conversationId,
    author: 'bot',
    botId,
    runId,
    content: '',
    status: 'streaming',
    createdAt: Date.now()
  }
  repo.addMessage(message)
  register(runId)
  deps.emit({
    type: 'status',
    runId,
    conversationId,
    botId,
    messageId: message.id,
    status: 'streaming'
  })
  return message
}

function finishInternalMessage(message: Message, content: string, deps: RespondDeps): void {
  repo.updateMessage(message.id, { content, status: 'done' })
  deps.emit({
    type: 'delta',
    runId: message.runId ?? '',
    conversationId: message.conversationId,
    botId: message.botId ?? '',
    messageId: message.id,
    delta: content
  })
  deps.emit({
    type: 'done',
    runId: message.runId ?? '',
    conversationId: message.conversationId,
    botId: message.botId ?? '',
    messageId: message.id
  })
}

function removeInternalMessage(message: Message, deps: RespondDeps): void {
  repo.deleteMessage(message.id)
  deps.emit({ type: 'remove', conversationId: message.conversationId, messageId: message.id })
}


function teamContext(conversationId: string, results: TeamResult[]): string {
  const messages = repo
    .recentMessages(conversationId, 12)
    .filter(message => message.content.trim())
    .map(message => {
      const author =
        message.author === 'user'
          ? '用户'
          : (message.botId && repo.getBot(message.botId)?.name) || 'Bot'
      return `${author}：${message.content.slice(0, 1200)}`
    })
    .join('\n')
  const done = results
    .map(result => `- ${result.task.title}（${result.worker.name}）：${result.content.slice(0, 1500)}`)
    .join('\n')
  return `最近群聊：\n${messages || '（无）'}\n\n已完成任务结果：\n${done || '（无）'}`
}

function finalPrompt(original: string, results: TeamResult[]): string {
  const body = results
    .map(
      (result, index) =>
        `${index + 1}. ${result.task.title}（${result.worker.name}）\n${result.content.slice(0, RESULT_LIMIT)}${result.rejected > 0 ? `\n被驳回 ${result.rejected} 次` : ''}`
    )
    .join('\n\n')
  return `原始任务：${original}\n\n团队成员结果：\n${body || '（没有产生结果）'}\n\n请以负责人身份向用户汇总。`
}
