// OpenAI-compatible 流式客户端 + 离线 fake provider。零依赖，只用 fetch。
// 以后接 Anthropic / Gemini：在这里加一个 switch，不影响上层。

import type { ProviderType, WebSource } from '../../shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatChunk {
  delta?: string
  usage?: { in: number; out: number }
  /** 原生 Web Search 返回的引用，流结束时一次性给出 */
  sources?: WebSource[]
  /** 本次回复实际发起的搜索关键词 */
  queries?: string[]
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

  // DeepSeek 的搜索工具只对 deepseek-flash 开放；声明后由模型自己决定是否搜索
  const deepSeekSearch =
    params.provider.type === 'deepseek' && params.model.toLowerCase().startsWith('deepseek-flash')
  const url = `${params.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: true
  }
  if (deepSeekSearch) {
    // DeepSeek 服务端工具：只传 type；不能使用 tool_choice
    body.tools = [{ type: 'deepseek_web_search' }]
  } else {
    body.temperature = params.temperature ?? 0.7
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify(body),
    signal: params.signal
  })

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`服务商返回 HTTP ${res.status}${text ? `：${text}` : ''}`)
  }
  if (!res.body) throw new Error('服务商没有返回内容流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const sources: WebSource[] = []
  const queries: string[] = []
  let emittedSources = 0
  let emittedQueries = 0
  let buffer = ''
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue

      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        finished = true
        break
      }

      let json: any
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }

      const choice = json.choices?.[0]
      const delta = choice?.delta
      if (typeof delta?.content === 'string' && delta.content) {
        yield { delta: delta.content }
      }

      // DeepSeek/OpenAI 风格引用
      collectAnnotations(sources, delta?.annotations)
      collectAnnotations(sources, choice?.message?.annotations)
      collectServerSources(sources, delta?.server_tool_calls, queries)
      collectServerSources(sources, choice?.message?.server_tool_calls, queries)

      // DeepSeek 流式工具事件：call_started 带关键词，call_completed 带来源
      const event = choice?.server_tool_event
      if (event?.call) {
        collectQueries(queries, event.queries)
        collectServerSources(sources, [{ calls: [event.call] }], queries)
      }

      if (queries.length > emittedQueries || sources.length > emittedSources) {
        emittedQueries = queries.length
        emittedSources = sources.length
        yield { sources: [...sources], queries: [...queries] }
      }

      if (json.usage) {
        yield { usage: { in: json.usage.prompt_tokens ?? 0, out: json.usage.completion_tokens ?? 0 } }
      }
    }
  }
}

function collectAnnotations(list: WebSource[], raw: unknown): void {
  if (!Array.isArray(raw)) return
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const citation = (item as { url_citation?: unknown }).url_citation
    if (citation && typeof citation === 'object') addSource(list, citation)
  }
}

function collectServerSources(list: WebSource[], raw: unknown, queries: string[]): void {
  if (!Array.isArray(raw)) return
  for (const step of raw) {
    if (!step || typeof step !== 'object') continue
    const calls = (step as { calls?: unknown }).calls
    if (!Array.isArray(calls)) continue
    for (const call of calls) {
      if (!call || typeof call !== 'object') continue
      const entry = call as { sources?: unknown; queries?: unknown; action?: unknown; query?: unknown }
      collectQueries(queries, entry.queries)
      collectQueries(queries, entry.query)
      if (entry.action && typeof entry.action === 'object') {
        const action = entry.action as { queries?: unknown; query?: unknown }
        collectQueries(queries, action.queries)
        collectQueries(queries, action.query)
      }
      if (!Array.isArray(entry.sources)) continue
      for (const source of entry.sources) addSource(list, source)
    }
  }
}

function collectQueries(list: string[], raw: unknown): void {
  if (typeof raw === 'string') raw = [raw]
  if (!Array.isArray(raw)) return
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const query = item.trim()
    if (query && !list.includes(query) && list.length < 24) list.push(query)
  }
}

function addSource(list: WebSource[], raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const source = raw as { url?: unknown; title?: unknown; snippet?: unknown; content?: unknown }
  if (typeof source.url !== 'string' || !/^https?:/i.test(source.url)) return
  if (list.some(item => item.url === source.url)) return
  list.push({
    title: typeof source.title === 'string' && source.title ? source.title : source.url,
    url: source.url,
    snippet:
      typeof source.snippet === 'string'
        ? source.snippet
        : typeof source.content === 'string'
          ? source.content
          : undefined
  })
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
