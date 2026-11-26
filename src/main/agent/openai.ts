// OpenAI 兼容的 Chat Completions 客户端（非流式），带 function calling。
// 生产版本可以换成流式实现，runReAct 的循环不用改。

import type { AgentMessage, AgentTool, AssistantReply, ChatFn, ToolCall } from './react'
import { toOpenAiTools } from './react'

export function createOpenAiChat(options: {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  timeoutMs?: number
}): ChatFn {
  return async ({ messages, tools, signal }): Promise<AssistantReply> => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const body: Record<string, unknown> = {
      model: options.model,
      messages: messages.map(toWireMessage),
      stream: false
    }
    if (tools.length > 0) {
      body.tools = toOpenAiTools(tools)
      body.tool_choice = 'auto'
    }
    if (options.temperature !== undefined) body.temperature = options.temperature

    const res = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify(body),
      signal: combined
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`Provider returned HTTP ${res.status}${text ? `: ${text}` : ''}`)
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: unknown
          tool_calls?: Array<{
            id?: unknown
            function?: { name?: unknown; arguments?: unknown }
          }>
        }
      }>
    }
    const message = json.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content : ''
    const toolCalls: ToolCall[] = Array.isArray(message?.tool_calls)
      ? message.tool_calls
          .map(call => ({
            id: typeof call.id === 'string' ? call.id : '',
            name: typeof call.function?.name === 'string' ? call.function.name : '',
            arguments:
              typeof call.function?.arguments === 'string'
                ? call.function.arguments
                : JSON.stringify(call.function?.arguments ?? {})
          }))
          .filter(call => call.name.length > 0)
      : []

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined }
  }
}

function toWireMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content
    }
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content || null,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map(call => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.arguments }
            }))
          }
        : {})
    }
  }
  return { role: message.role, content: message.content }
}
