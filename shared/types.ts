// 前后端共享的唯一契约。只放类型，不放运行时代码。

export type ProviderType = 'openai' | 'fake'

export interface ProviderView {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  hasKey: boolean
  /** 从 /models 拉取并缓存的模型 id */
  models: string[]
}

export interface ProviderInput {
  id?: string
  name: string
  type: ProviderType
  baseUrl: string
  /** 留空表示沿用已保存的 Key */
  apiKey?: string
}

export interface Bot {
  id: string
  name: string
  /** 预设头像 id，空字符串回退到 emoji */
  avatar: string
  emoji: string
  color: string
  systemPrompt: string
  providerId: string
  model: string
  temperature: number
}

export type BotInput = Omit<Bot, 'id'> & { id?: string }

export type ConversationKind = 'dm' | 'group'
export type ReplyMode = 'all' | 'mention'

export interface Conversation {
  id: string
  title: string
  botIds: string[]
  kind: ConversationKind
  /** group 下生效：all = 所有 Bot 回复；mention = 只有被 @ 的 Bot 回复 */
  replyMode: ReplyMode
  createdAt: number
  updatedAt: number
}

export type MessageStatus = 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'

export interface Message {
  id: string
  conversationId: string
  author: 'user' | 'bot'
  botId?: string
  runId?: string
  content: string
  status: MessageStatus
  error?: string
  createdAt: number
}

export interface SendInput {
  conversationId: string
  text: string
}

export interface SendResult {
  userMsg: Message
  runIds: string[]
}

export type RunEvent =
  | {
      type: 'status'
      runId: string
      conversationId: string
      botId: string
      messageId: string
      status: 'queued' | 'streaming'
    }
  | { type: 'delta'; runId: string; conversationId: string; botId: string; messageId: string; delta: string }
  | {
      type: 'done'
      runId: string
      conversationId: string
      botId: string
      messageId: string
      usage?: { in: number; out: number }
    }
  | { type: 'cancelled'; runId: string; conversationId: string; botId: string; messageId: string }
  | { type: 'error'; runId: string; conversationId: string; botId: string; messageId: string; error: string }

export interface AppState {
  providers: ProviderView[]
  bots: Bot[]
  conversations: Conversation[]
}

export interface MellioApi {
  platform: string
  copyText(text: string): Promise<void>
  getState(): Promise<AppState>
  listMessages(conversationId: string): Promise<Message[]>
  saveBot(input: BotInput): Promise<Bot>
  removeBot(id: string): Promise<void>
  saveProvider(input: ProviderInput): Promise<ProviderView>
  removeProvider(id: string): Promise<void>
  testProvider(id: string): Promise<string>
  fetchModels(providerId: string): Promise<string[]>
  openBotChat(botId: string): Promise<Conversation>
  createGroup(title: string, botIds: string[]): Promise<Conversation>
  setGroupMembers(conversationId: string, botIds: string[]): Promise<void>
  setReplyMode(conversationId: string, mode: ReplyMode): Promise<void>
  send(input: SendInput): Promise<SendResult>
  cancel(runId: string): Promise<void>
  onRunEvent(cb: (event: RunEvent) => void): () => void
}
