// OpenAI-compatible 流式客户端 + 离线 fake provider。零依赖，只用 fetch。
// 以后接 Anthropic / Gemini：在这里加一个 switch，不影响上层。

import type { ProviderType } from '../../shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatChunk {
  delta?: string
  usage?: { in: number; out: number }
}

export interface ChatParams {
  provider: { type: ProviderType; baseUrl: string }
  model: string
  apiKey?: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
}

export async function* chat(params: ChatParams): AsyncGenerator<ChatChunk> {
  if (params.provider.type === 'fake') {
    yield* fake(params.messages, params.signal)
    return
  }
  if (!params.apiKey) throw new Error('这个服务商还没有配置 API Key')

  const url = `${params.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      stream: true
    }),
    signal: params.signal
  })

  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`服务商返回 HTTP ${res.status}${body ? `：${body}` : ''}`)
  }
  if (!res.body) throw new Error('服务商没有返回内容流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue

      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return

      let json: {
        choices?: Array<{ delta?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }

      const delta = json.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) yield { delta }
      if (json.usage) {
        yield { usage: { in: json.usage.prompt_tokens ?? 0, out: json.usage.completion_tokens ?? 0 } }
      }
    }
  }
}

export async function listModels(
  provider: { type: ProviderType; baseUrl: string },
  apiKey?: string
): Promise<string[]> {
  if (provider.type === 'fake') return ['demo']
  if (!apiKey) throw new Error('还没有配置 API Key')

  const url = `${provider.baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`拉取模型失败：HTTP ${res.status}${body ? `：${body}` : ''}`)
  }

  const json = (await res.json().catch(() => null)) as unknown
  let raw: unknown[] = []
  if (Array.isArray(json)) raw = json
  else if (json && typeof json === 'object') {
    const object = json as { data?: unknown; models?: unknown }
    if (Array.isArray(object.data)) raw = object.data
    else if (Array.isArray(object.models)) raw = object.models
  }

  const ids = raw
    .map(item => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const id = (item as { id?: unknown }).id
        return typeof id === 'string' ? id : undefined
      }
      return undefined
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const unique = [...new Set(ids)].sort()
  if (unique.length === 0) throw new Error('服务商没有返回模型列表')
  return unique
}

export async function testConnection(
  provider: { type: ProviderType; baseUrl: string },
  apiKey?: string
): Promise<string> {
  if (provider.type === 'fake') return '演示模式可用'
  const models = await listModels(provider, apiKey)
  return `连接成功 · ${models.length} 个模型`
}

async function* fake(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<ChatChunk> {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const text = [
    '你好呀，我是离线演示里的梅梅 🫧',
    '',
    `我收到了你说的：「${lastUser.slice(0, 60)}」`,
    '',
    '在「设置 → 添加服务商」里接入真实模型（OpenAI、DeepSeek、OpenRouter、xAI 等 OpenAI 兼容服务都能用）后，回复就会来自你选的模型。',
    '',
    '先感受一下流式输出：',
    '',
    '```js',
    'console.log("hello, Mellio")',
    '```'
  ].join('\n')

  for (let i = 0; i < text.length; i += 3) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    await sleep(18, signal)
    yield { delta: text.slice(i, i + 3) }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}
