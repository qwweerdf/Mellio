// AI SDK 客户端：
// - 普通 OpenAI 兼容服务走 @ai-sdk/openai-compatible
// - DeepSeek 的 Chat Completions 原生搜索走 AI SDK + 自定义 fetch（保留 sources/queries）
// - DeepSeek v4-pro 的官方 Responses 搜索走 @ai-sdk/deepseek + tools.webSearch()
// 业务层仍然只看到 AsyncGenerator<ChatChunk>，orchestrator 不用改。

import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText } from 'ai'
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

  if (params.provider.type === 'deepseek' && isDeepSeekPro(params.model)) {
    yield* deepSeekResponsesChat(params)
    return
  }
  yield* compatibleChat(params)
}

// ---------- OpenAI 兼容 / DeepSeek Chat Completions ----------

async function* compatibleChat(params: ChatParams): AsyncGenerator<ChatChunk> {
  const searchState =
    params.provider.type === 'deepseek' && isDeepSeekFlash(params.model)
      ? createSearchState()
      : undefined
  const { instructions, messages } = splitSystemMessages(params.messages)

  const provider = createOpenAICompatible({
    name: params.provider.type === 'deepseek' ? 'deepseek' : 'openai-compatible',
    baseURL: params.provider.baseUrl,
    apiKey: params.apiKey,
    includeUsage: true,
    ...(searchState ? { fetch: createDeepSeekFetch(searchState) } : {})
  })

  const result = streamText({
    model: provider(params.model),
    instructions,
    messages,
    temperature: searchState ? undefined : params.temperature,
    abortSignal: params.signal
  })

  let emittedVersion = 0
  let usage: ChatChunk['usage']

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        if (part.text) yield { delta: part.text }
        break
      case 'source':
        if (part.sourceType === 'url' && searchState) {
          addSource(searchState.sources, { url: part.url, title: part.title })
          searchState.version++
        }
        break
      case 'finish':
        usage = toUsage(part.totalUsage)
        break
      case 'error':
        throw asError(part.error)
    }

    if (searchState && searchState.version !== emittedVersion) {
      emittedVersion = searchState.version
      yield { sources: [...searchState.sources], queries: [...searchState.queries] }
    }
  }

  if (searchState) {
    await searchState.done
    if (searchState.version !== emittedVersion) {
      yield { sources: [...searchState.sources], queries: [...searchState.queries] }
    }
  }
  if (usage) yield { usage }
}

// ---------- DeepSeek Responses（官方 webSearch 工具） ----------

async function* deepSeekResponsesChat(params: ChatParams): AsyncGenerator<ChatChunk> {
  const deepseek = createDeepSeek({
    apiKey: params.apiKey,
    baseURL: params.provider.baseUrl || undefined
  })
  const state = createSearchState()
  const { instructions, messages } = splitSystemMessages(params.messages)

  const result = streamText({
    model: deepseek.responses(params.model),
    instructions,
    messages,
    tools: { web_search: deepseek.tools.webSearch() },
    abortSignal: params.signal
  })

  let emittedVersion = 0
  let usage: ChatChunk['usage']

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        if (part.text) yield { delta: part.text }
        break
      case 'tool-result':
        if (part.toolName === 'web_search') ingestDeepSeekToolOutput(part.output, state)
        break
      case 'source':
        if (part.sourceType === 'url') {
          addSource(state.sources, { url: part.url, title: part.title })
          state.version++
        }
        break
      case 'finish':
        usage = toUsage(part.totalUsage)
        break
      case 'error':
        throw asError(part.error)
    }

    if (state.version !== emittedVersion) {
      emittedVersion = state.version
      yield { sources: [...state.sources], queries: [...state.queries] }
    }
  }

  if (state.version !== emittedVersion) {
    yield { sources: [...state.sources], queries: [...state.queries] }
  }
  if (usage) yield { usage }
}

function splitSystemMessages(messages: ChatMessage[]): {
  instructions?: string
  messages: ChatMessage[]
} {
  const instructions = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')
  return {
    instructions: instructions || undefined,
    messages: messages.filter(message => message.role !== 'system')
  }
}

function isDeepSeekPro(model: string): boolean {
  return model.toLowerCase().startsWith('deepseek-v4-pro')
}

function isDeepSeekFlash(model: string): boolean {
  return model.toLowerCase().startsWith('deepseek-flash')
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function toUsage(usage?: {
  inputTokens?: number
  outputTokens?: number
}): ChatChunk['usage'] | undefined {
  if (!usage) return undefined
  return { in: usage.inputTokens ?? 0, out: usage.outputTokens ?? 0 }
}

// ---------- DeepSeek Chat Completions 搜索扩展 ----------
// AI SDK 的 OpenAI 兼容 provider 不认识 DeepSeek 的 server_tool_event，
// 所以用官方支持的 custom fetch 注入工具，并旁路解析、保留 sources/queries。

interface SearchState {
  sources: WebSource[]
  queries: string[]
  version: number
  done: Promise<void>
}

function createSearchState(): SearchState {
  return { sources: [], queries: [], version: 0, done: Promise.resolve() }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function createDeepSeekFetch(state: SearchState): FetchLike {
  return async (input, init) => {
    let next = init
    if (typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>
        body.tools = [{ type: 'deepseek_web_search' }]
        delete body.temperature
        delete body.tool_choice
        next = { ...init, body: JSON.stringify(body) }
      } catch {
        /* 保持原请求体 */
      }
    }

    const response = await fetch(input, next)
    if (!response.ok || !response.body) return response

    const [clientBody, tapBody] = response.body.tee()
    state.done = consumeDeepSeekSse(tapBody, state)
    return new Response(clientBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}

async function consumeDeepSeekSse(body: ReadableStream<Uint8Array>, state: SearchState): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
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
        try {
          ingestDeepSeekChunk(JSON.parse(payload) as unknown, state)
        } catch {
          /* 单条坏数据不影响流 */
        }
      }
    }
  } catch {
    /* 旁路解析失败不影响主回答 */
  } finally {
    reader.releaseLock()
  }
}

function ingestDeepSeekChunk(json: unknown, state: SearchState): void {
  if (!json || typeof json !== 'object') return
  const choice = (json as { choices?: Array<{ delta?: unknown; message?: unknown }> }).choices?.[0]
  if (!choice) return
  const beforeSources = state.sources.length
  const beforeQueries = state.queries.length

  const delta = choice.delta as
    | { annotations?: unknown; server_tool_calls?: unknown }
    | undefined
  const message = choice.message as
    | { annotations?: unknown; server_tool_calls?: unknown }
    | undefined

  collectAnnotations(state.sources, delta?.annotations)
  collectAnnotations(state.sources, message?.annotations)
  collectServerSources(state.sources, delta?.server_tool_calls, state.queries)
  collectServerSources(state.sources, message?.server_tool_calls, state.queries)

  const event = (choice as {
    server_tool_event?: { call?: unknown; queries?: unknown }
  }).server_tool_event
  if (event?.call) {
    collectQueries(state.queries, event.queries)
    collectServerSources(state.sources, [{ calls: [event.call] }], state.queries)
  }

  if (state.sources.length !== beforeSources || state.queries.length !== beforeQueries) {
    state.version++
  }
}

function ingestDeepSeekToolOutput(output: unknown, state: SearchState): void {
  const value = unwrapToolOutput(output)
  if (!value || typeof value !== 'object') return
  const action = (value as { action?: unknown }).action
  if (!action || typeof action !== 'object') return

  const beforeSources = state.sources.length
  const beforeQueries = state.queries.length
  const record = action as {
    type?: unknown
    queries?: unknown
    sources?: unknown
    url?: unknown
    page?: { url?: unknown }
  }

  collectQueries(state.queries, record.queries)
  if (Array.isArray(record.sources)) {
    for (const source of record.sources) addSource(state.sources, source)
  }
  const url =
    typeof record.url === 'string'
      ? record.url
      : record.page && typeof record.page.url === 'string'
        ? record.page.url
        : undefined
  if (url) addSource(state.sources, { url })

  if (state.sources.length !== beforeSources || state.queries.length !== beforeQueries) {
    state.version++
  }
}

function unwrapToolOutput(output: unknown): unknown {
  if (
    output &&
    typeof output === 'object' &&
    'type' in output &&
    'value' in output &&
    typeof (output as { type?: unknown }).type === 'string'
  ) {
    return (output as { value: unknown }).value
  }
  return output
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
    if (!query || query.startsWith('ws_call_id=') || list.includes(query) || list.length >= 24) continue
    list.push(query)
  }
}

function addSource(list: WebSource[], raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const source = raw as { url?: unknown; title?: unknown; snippet?: unknown; content?: unknown }
  if (typeof source.url !== 'string' || !/^https?:/i.test(source.url)) return
  const url = cleanUrl(source.url)
  if (!url || list.some(item => item.url === url)) return
  list.push({
    title:
      typeof source.title === 'string' && source.title
        ? source.title
        : (hostnameOf(url) ?? url),
    url,
    snippet:
      typeof source.snippet === 'string'
        ? source.snippet
        : typeof source.content === 'string'
          ? source.content
          : undefined
  })
}

function cleanUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.hash.includes('ws_call_id=')) url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

// ---------- 模型列表 / 连接测试（仍用轻量 fetch） ----------

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

// ---------- 离线 fake ----------

async function* fake(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<ChatChunk> {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const text = [
    '你好呀，我是离线演示里的梅梅 🫧',
    '',
    `我收到了你说的：「${lastUser.slice(0, 60)}」`,
    '',
    '在「设置 → 添加服务商」里接入真实模型（OpenAI、DeepSeek、OpenRouter、xAI、OpenAI 兼容服务都能用）后，回复就会来自你选的模型。',
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
