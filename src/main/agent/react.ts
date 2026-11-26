// 最小 ReAct 框架：模型决定调用工具 → 执行 → 把结果回填 → 继续，直到给出最终回答。
// 不依赖 Agent 框架；工具、循环、事件都显式可控。

export interface ToolCall {
  id: string
  name: string
  /** 模型返回的原始 JSON 字符串 */
  arguments: string
}

export interface AgentTool {
  name: string
  description: string
  /** JSON Schema，直接发给模型的 function.parameters */
  parameters: Record<string, unknown>
  run(args: unknown): Promise<unknown>
}

export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface AssistantReply {
  content: string
  toolCalls?: ToolCall[]
}

export type ChatFn = (input: {
  messages: AgentMessage[]
  tools: AgentTool[]
  signal?: AbortSignal
}) => Promise<AssistantReply>

export type ReActEvent =
  | { type: 'assistant'; step: number; content: string }
  | { type: 'tool_call'; step: number; call: ToolCall }
  | { type: 'tool_result'; step: number; call: ToolCall; result: string; isError: boolean }
  | { type: 'final'; step: number; content: string }
  | { type: 'limit'; step: number; content: string }

export interface ReActOptions {
  messages: AgentMessage[]
  tools: AgentTool[]
  chat: ChatFn
  maxSteps?: number
  maxToolResultChars?: number
  signal?: AbortSignal
  onEvent?: (event: ReActEvent) => void
}

export interface ReActResult {
  content: string
  steps: ReActEvent[]
  messages: AgentMessage[]
}

export async function runReAct(options: ReActOptions): Promise<ReActResult> {
  const maxSteps = options.maxSteps ?? 6
  const maxToolResultChars = options.maxToolResultChars ?? 8000
  const messages = [...options.messages]
  const steps: ReActEvent[] = []
  const emit = (event: ReActEvent): void => {
    steps.push(event)
    options.onEvent?.(event)
  }
  const tools = new Map(options.tools.map(tool => [tool.name, tool]))

  let lastContent = ''
  for (let step = 1; step <= maxSteps; step++) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')

    const reply = await options.chat({ messages, tools: options.tools, signal: options.signal })
    lastContent = reply.content || ''
    const calls = reply.toolCalls ?? []

    if (calls.length === 0) {
      emit({ type: 'final', step, content: lastContent })
      return { content: lastContent, steps, messages }
    }

    if (lastContent.trim()) emit({ type: 'assistant', step, content: lastContent })
    messages.push({ role: 'assistant', content: lastContent, toolCalls: calls })

    for (const call of calls) {
      emit({ type: 'tool_call', step, call })

      let result: string
      let isError = false
      try {
        const tool = tools.get(call.name)
        if (!tool) throw new Error(`Unknown tool: ${call.name}`)
        const args = parseArguments(call.arguments)
        result = serialize(await tool.run(args))
      } catch (err) {
        isError = true
        result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }

      if (result.length > maxToolResultChars) {
        result = `${result.slice(0, maxToolResultChars)}…[truncated]`
      }

      emit({ type: 'tool_result', step, call, result, isError })
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result })
    }
  }

  emit({ type: 'limit', step: maxSteps, content: lastContent })
  return { content: lastContent, steps, messages }
}

export function toOpenAiTools(tools: AgentTool[]): Array<Record<string, unknown>> {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Tool arguments are not valid JSON')
  }
}

function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
