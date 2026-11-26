import { create } from 'zustand'
import type {
  Bot,
  BotInput,
  Conversation,
  Message,
  ProviderInput,
  ProviderView,
  ReplyMode,
  RunEvent
} from '../../../shared/types'
import { localizeError, translate, type Lang } from './i18n'

let started = false
let toastTimer: ReturnType<typeof setTimeout> | null = null

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem('mellio.rail') === 'collapsed'
  } catch {
    return false
  }
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('mellio.lang')
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function errText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').slice(0, 300)
}

function insertSorted(list: Message[], message: Message): Message[] {
  if (list.some(m => m.id === message.id)) return list
  const next = [...list]
  const index = next.findIndex(m => m.createdAt > message.createdAt)
  if (index === -1) next.push(message)
  else next.splice(index, 0, message)
  return next
}

interface UiStore {
  ready: boolean
  providers: ProviderView[]
  bots: Bot[]
  conversations: Conversation[]
  activeId: string | null
  messages: Record<string, Message[]>
  loaded: Record<string, boolean>
  settingsOpen: boolean
  botEditor: { open: boolean; botId?: string }
  groupSheet: { open: boolean; mode: 'create' | 'members'; conversationId?: string }
  railCollapsed: boolean
  lang: Lang
  toast: string | null

  init(): Promise<void>
  refresh(): Promise<void>
  select(id: string): Promise<void>
  goHome(): void
  toggleRail(): void
  setLang(lang: Lang): void

  openBotChat(botId: string): Promise<void>
  createGroupFromSheet(title: string, botIds: string[]): Promise<void>
  saveGroupMembers(botIds: string[]): Promise<void>
  setReplyMode(mode: ReplyMode): Promise<void>

  send(text: string): Promise<void>
  cancel(message: Message): Promise<void>
  saveBot(input: BotInput): Promise<void>
  updateBotModel(botId: string, providerId: string, model: string): Promise<void>
  deleteBot(id: string): Promise<void>

  saveProvider(input: ProviderInput): Promise<void>
  removeProvider(id: string): Promise<void>
  testProvider(id: string): Promise<string>
  fetchModels(id: string): Promise<string[]>

  setSettingsOpen(open: boolean): void
  openBotEditor(botId?: string): void
  closeBotEditor(): void
  openGroupCreate(): void
  openGroupMembers(conversationId: string): void
  closeGroupSheet(): void

  showToast(message: string): void
  applyEvent(event: RunEvent): void
}

export const useStore = create<UiStore>((set, get) => ({
  ready: false,
  providers: [],
  bots: [],
  conversations: [],
  activeId: null,
  messages: {},
  loaded: {},
  settingsOpen: false,
  botEditor: { open: false },
  groupSheet: { open: false, mode: 'create' },
  railCollapsed: initialCollapsed(),
  lang: initialLang(),
  toast: null,

  init: async () => {
    if (started) return
    started = true
    try {
      const state = await window.api.getState()
      set({
        providers: state.providers,
        bots: state.bots,
        conversations: state.conversations,
        ready: true
      })
      window.api.onRunEvent(event => get().applyEvent(event))
    } catch (err) {
      set({ ready: true })
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  refresh: async () => {
    const state = await window.api.getState()
    set({ providers: state.providers, bots: state.bots, conversations: state.conversations })
  },

  select: async id => {
    set({ activeId: id })
    if (get().loaded[id]) return
    try {
      const messages = await window.api.listMessages(id)
      set(s => ({
        messages: { ...s.messages, [id]: messages },
        loaded: { ...s.loaded, [id]: true }
      }))
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  goHome: () => set({ activeId: null }),

  toggleRail: () => {
    const next = !get().railCollapsed
    set({ railCollapsed: next })
    try {
      localStorage.setItem('mellio.rail', next ? 'collapsed' : 'expanded')
    } catch {
      /* 忽略存储失败 */
    }
  },

  setLang: lang => {
    set({ lang })
    try {
      localStorage.setItem('mellio.lang', lang)
    } catch {
      /* 忽略存储失败 */
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  },

  openBotChat: async botId => {
    try {
      const conversation = await window.api.openBotChat(botId)
      await get().refresh()
      await get().select(conversation.id)
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  createGroupFromSheet: async (title, botIds) => {
    try {
      const conversation = await window.api.createGroup(title, botIds)
      set({ groupSheet: { open: false, mode: 'create' } })
      await get().refresh()
      await get().select(conversation.id)
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  saveGroupMembers: async botIds => {
    const id = get().groupSheet.conversationId
    if (!id) return
    try {
      await window.api.setGroupMembers(id, botIds)
      set({ groupSheet: { open: false, mode: 'create' } })
      await get().refresh()
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  setReplyMode: async mode => {
    const id = get().activeId
    if (!id) return
    try {
      await window.api.setReplyMode(id, mode)
      set(s => ({
        conversations: s.conversations.map(c => (c.id === id ? { ...c, replyMode: mode } : c))
      }))
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  send: async text => {
    const id = get().activeId
    const trimmed = text.trim()
    if (!id || !trimmed) return
    if (!get().loaded[id]) await get().select(id)

    // 主进程要等所有 Bot 跑完才返回；先乐观插入，避免用户消息在等待期间消失
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: Message = {
      id: tempId,
      conversationId: id,
      author: 'user',
      content: trimmed,
      status: 'done',
      createdAt: Date.now()
    }
    set(s => ({ messages: { ...s.messages, [id]: insertSorted(s.messages[id] ?? [], optimistic) } }))

    try {
      const { userMsg, runIds } = await window.api.send({ conversationId: id, text: trimmed })
      set(s => ({
        messages: {
          ...s.messages,
          [id]: (s.messages[id] ?? []).map(m => (m.id === tempId ? userMsg : m))
        }
      }))

      if (runIds.length === 0) {
        const conversation = get().conversations.find(c => c.id === id)
        if (conversation?.kind === 'group' && conversation.replyMode === 'mention') {
          get().showToast(translate(get().lang, "toast.noMention"))
        }
      }
    } catch (err) {
      set(s => ({
        messages: { ...s.messages, [id]: (s.messages[id] ?? []).filter(m => m.id !== tempId) }
      }))
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  cancel: async message => {
    if (!message.runId) return
    try {
      await window.api.cancel(message.runId)
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  saveBot: async input => {
    try {
      const bot = await window.api.saveBot(input)
      await get().refresh()
      if (!input.id) await get().openBotChat(bot.id)
      get().closeBotEditor()
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  updateBotModel: async (botId, providerId, model) => {
    const bot = get().bots.find(b => b.id === botId)
    if (!bot) return
    try {
      await window.api.saveBot({ ...bot, providerId, model: model.trim() })
      await get().refresh()
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  deleteBot: async id => {
    try {
      await window.api.removeBot(id)
      await get().refresh()
      const activeId = get().activeId
      if (activeId && !get().conversations.some(c => c.id === activeId)) {
        set({ activeId: null })
      }
      get().closeBotEditor()
    } catch (err) {
      get().showToast(localizeError(get().lang, errText(err)))
    }
  },

  saveProvider: async input => {
    await window.api.saveProvider(input)
    await get().refresh()
  },

  removeProvider: async id => {
    await window.api.removeProvider(id)
    await get().refresh()
  },

  testProvider: async id => window.api.testProvider(id),

  fetchModels: async id => {
    const models = await window.api.fetchModels(id)
    await get().refresh()
    return models
  },

  setSettingsOpen: open => set({ settingsOpen: open }),
  openBotEditor: botId => set({ botEditor: { open: true, botId } }),
  closeBotEditor: () => set({ botEditor: { open: false } }),
  openGroupCreate: () => set({ groupSheet: { open: true, mode: 'create' } }),
  openGroupMembers: conversationId =>
    set({ groupSheet: { open: true, mode: 'members', conversationId } }),
  closeGroupSheet: () => set({ groupSheet: { open: false, mode: 'create' } }),

  showToast: message => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: message })
    toastTimer = setTimeout(() => set({ toast: null }), 4000)
  },

  applyEvent: event => {
    const { conversationId } = event
    if (!get().loaded[conversationId]) return

    const list = get().messages[conversationId] ?? []
    const exists = list.some(m => m.id === event.messageId)
    let next: Message[]

    if (event.type === 'status') {
      next = exists
        ? list.map(m => (m.id === event.messageId ? { ...m, status: event.status, runId: event.runId } : m))
        : insertSorted(list, {
            id: event.messageId,
            conversationId,
            author: 'bot',
            botId: event.botId,
            runId: event.runId,
            content: '',
            status: event.status,
            createdAt: Date.now()
          })
    } else if (event.type === 'delta') {
      next = list.map(m =>
        m.id === event.messageId ? { ...m, content: m.content + event.delta, status: 'streaming' } : m
      )
    } else if (event.type === 'done') {
      next = list.map(m => (m.id === event.messageId ? { ...m, status: 'done' } : m))
    } else if (event.type === 'cancelled') {
      next = list.map(m => (m.id === event.messageId ? { ...m, status: 'cancelled' } : m))
    } else {
      next = list.map(m =>
        m.id === event.messageId ? { ...m, status: 'error', error: event.error } : m
      )
    }

    set(s => ({ messages: { ...s.messages, [conversationId]: next } }))
  }
}))
