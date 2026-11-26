// AI SDK 版的一次模型调用：带工具声明，但不在这里执行工具。
// runReAct 仍然负责循环和工具执行；以后可以直接换成 SDK 的 stopWhen 多步循环。

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, jsonSchema, tool, type ModelMessage } from 'ai'
import type { AgentMessage, AgentTool, AssistantReply, ChatFn, ToolCall } from './react'

export function createOpenAiChat(options: {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
}): ChatFn {
  const provider = createOpenAICompatible({
    name: 'mellio-agent',
    baseURL: options.baseUrl,
    apiKey: options.apiKey
  })

  return async ({ messages, tools, signal }): Promise<AssistantReply> => {
    const instructions = messages
      .filter(message => message.role === 'system')
      .map(message => message.content)
      .join('\n\n')
    const conversation = messages.filter(message => message.role !== 'system')

    const result = await generateText({
      model: provider(options.model),
      instructions: instructions || undefined,
      messages: toModelMessages(conversation),
      tools: Object.fromEntries(
        tools.map(toolDef => [
          toolDef.name,
          tool({
            description: toolDef.description,
            inputSchema: jsonSchema(toolDef.parameters)
          })
        ])
      ),
      temperature: options.temperature,
      abortSignal: signal
    })

    const toolCalls: ToolCall[] = result.toolCalls.map(call => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: JSON.stringify(call.input ?? {})
    }))

    return {
      content: result.text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    }
  }
}

function toModelMessages(messages: AgentMessage[]): ModelMessage[] {
  return messages.map(message => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.name,
            output: { type: 'text', value: message.content }
          }
        ]
      }
    }

    if (message.role === 'assistant') {
      const content: Array<Record<string, unknown>> = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: parseArguments(call.arguments)
        })
      }
      return { role: 'assistant', content: content.length > 0 ? content : '' }
    }

    return { role: message.role, content: message.content }
  }) as ModelMessage[]
}

function parseArguments(raw: string): unknown {
  try {
    return raw.trim() ? (JSON.parse(raw) as unknown) : {}
  } catch {
    return {}
  }
}
