// ReAct + calculator demo，使用 AI SDK 的 ToolLoopAgent。
// 默认离线 mock；设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后走真实 OpenAI 兼容接口。
//
//   npm run demo:react
//   npm run demo:react -- "帮我算 (12 + 8) * 3，再算 sqrt(144)"

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { isStepCount, ToolLoopAgent } from 'ai'
import { calculatorTool } from '../src/main/agent/tools/calculator'
import { createMockCalculatorModel } from './mock-agent-model'

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
  const modelId = process.env.LLM_MODEL ?? 'deepseek-flash'

  const model = useMock
    ? createMockCalculatorModel()
    : createOpenAICompatible({ name: 'mellio-demo', baseURL: baseUrl, apiKey })(modelId)

  const agent = new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools: { calculator: calculatorTool },
    stopWhen: isStepCount(6)
  })

  console.log('ReAct demo · ToolLoopAgent + calculator')
  console.log(`mode     ${useMock ? 'mock (offline)' : `${modelId} @ ${baseUrl}`}`)
  console.log(`question ${question}`)
  console.log('')

  const result = await agent.stream({
    messages: [{ role: 'user', content: question }]
  })

  let printedText = false
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'tool-call':
        console.log(`tool_call → ${part.toolName}`)
        console.log(indent(pretty(part.input)))
        console.log('')
        break
      case 'tool-result':
        console.log(`tool_result ← ${part.toolName}`)
        console.log(indent(pretty(part.output)))
        console.log('')
        break
      case 'text-delta':
        if (!printedText) {
          console.log('final')
          printedText = true
        }
        process.stdout.write(part.text)
        break
      case 'finish':
        if (printedText) console.log('')
        console.log('')
        console.log(`done · finish=${part.finishReason} · tokens in=${part.totalUsage.inputTokens ?? 0} out=${part.totalUsage.outputTokens ?? 0}`)
        break
      case 'error':
        throw part.error
    }
  }
}

function pretty(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
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
