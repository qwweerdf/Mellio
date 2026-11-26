// 脚本用 mock 模型：离线演示 ToolLoopAgent 的两轮 calculator 调用 + 最终回答。

import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 }
}

export function createMockCalculatorModel(
  finalText = '两个结果分别是 60 和 12。'
): MockLanguageModelV4 {
  let calls = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      calls++
      const chunks =
        calls === 1
          ? toolCallChunks('(12 + 8) * 3', 'call_1')
          : calls === 2
            ? toolCallChunks('sqrt(144)', 'call_2')
            : textChunks(finalText)
      return { stream: convertArrayToReadableStream(chunks) }
    }
  })
}

function toolCallChunks(expression: string, id: string): any[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-input-start', id, toolName: 'calculator' },
    {
      type: 'tool-input-delta',
      id,
      delta: JSON.stringify({ expression })
    },
    { type: 'tool-input-end', id },
    {
      type: 'tool-call',
      toolCallId: id,
      toolName: 'calculator',
      input: JSON.stringify({ expression })
    },
    {
      type: 'finish',
      usage,
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' }
    }
  ]
}

function textChunks(text: string): any[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: text },
    { type: 'text-end', id: 'text-1' },
    {
      type: 'finish',
      usage,
      finishReason: { unified: 'stop', raw: 'stop' }
    }
  ]
}
