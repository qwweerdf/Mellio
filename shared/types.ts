// 前后端共享的唯一契约。只放类型，不放运行时代码。

export type ProviderType = 'openai' | 'deepseek' | 'fake'

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
export type CollaborationMode = 'parallel' | 'team'

export interface GroupSettings {
  mode: CollaborationMode
  leadBotId?: string
  maxRejections: number
}

export interface Conversation {
  id: string
  title: string
  botIds: string[]
  kind: ConversationKind
  /** group 下生效：all = 所有 Bot 回复；mention = 只有被 @ 的 Bot 回复 */
  replyMode: ReplyMode
  /** parallel = 同时回复；team = 负责人拆任务、成员执行、负责人汇总 */
  collaborationMode: CollaborationMode
  /** team 模式下的负责人 Bot */
  leadBotId?: string
  /** 每个任务最多被负责人驳回几次 */
  maxRejections: number
  /** 最新一条非空消息，供侧栏预览 */
  lastMessage?: string
  lastMessageAt?: number
  createdAt: number
  updatedAt: number
}

export type MessageStatus = 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'

export interface WebSource {
  title: string
  url: string
  snippet?: string
}

export interface ToolStep {
  id: string
  toolName: string
  input?: unknown
  output?: string
  status: 'running' | 'done' | 'error'
  error?: string
  startedAt: number
  endedAt?: number
}

export interface Message {
  id: string
  conversationId: string
  author: 'user' | 'bot'
  botId?: string
  runId?: string
  content: string
  status: MessageStatus
  error?: string
  /** 原生 Web Search 返回的引用来源 */
  sources?: WebSource[]
  /** 本次回复实际发起的搜索关键词 */
  searchQueries?: string[]
  /** ReAct 工具调用步骤 */
  steps?: ToolStep[]
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
      type: 'search'
      runId: string
      conversationId: string
      botId: string
      messageId: string
      sources?: WebSource[]
      queries?: string[]
    }
  | {
      type: 'step'
      runId: string
      conversationId: string
      botId: string
      messageId: string
      step: ToolStep
    }
  | {
      type: 'done'
      runId: string
      conversationId: string
      botId: string
      messageId: string
      usage?: { in: number; out: number }
      sources?: WebSource[]
      queries?: string[]
    }
  | { type: 'cancelled'; runId: string; conversationId: string; botId: string; messageId: string }
  | { type: 'remove'; conversationId: string; messageId: string }
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
  clearBotHistory(botId: string): Promise<void>
  clearConversation(conversationId: string): Promise<void>
  saveProvider(input: ProviderInput): Promise<ProviderView>
  removeProvider(id: string): Promise<void>
  testProvider(id: string): Promise<string>
  fetchModels(providerId: string): Promise<string[]>
  openBotChat(botId: string): Promise<Conversation>
  createGroup(title: string, botIds: string[], settings?: GroupSettings): Promise<Conversation>
  setGroupMembers(conversationId: string, botIds: string[]): Promise<void>
  setGroupSettings(conversationId: string, settings: GroupSettings): Promise<Conversation>
  setReplyMode(conversationId: string, mode: ReplyMode): Promise<void>
  send(input: SendInput): Promise<SendResult>
  cancel(runId: string): Promise<void>
  regenerateMessage(messageId: string): Promise<void>
  onRunEvent(cb: (event: RunEvent) => void): () => void
}
