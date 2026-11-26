// SQLite 存储层（Electron 内置 node:sqlite，零原生依赖）。
// 旧版 data.json 在首次启动时自动导入并改名为 data.json.imported。

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AVATAR_IDS, AVATAR_META } from '../../shared/avatars'
import type {
  Bot,
  BotInput,
  Conversation,
  ConversationKind,
  Message,
  MessageStatus,
  ProviderInput,
  ProviderType,
  ProviderView,
  ReplyMode,
  ToolStep,
  WebSource
} from '../../shared/types'

export interface StoredProvider {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  keyEnc?: string
  models: string[]
}

let db: DatabaseSync | null = null

function d(): DatabaseSync {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT NOT NULL DEFAULT '',
  key_enc TEXT,
  models_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bot (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🤖',
  color TEXT NOT NULL DEFAULT '#F2B24B',
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'group',
  reply_mode TEXT NOT NULL DEFAULT 'all',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_bot (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bot(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, bot_id)
);

CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  bot_id TEXT,
  run_id TEXT,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  queries_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON message(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_bot ON conversation_bot(bot_id);

PRAGMA user_version = 5;
`

export function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(join(dir, 'mellio.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  let version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (version < 1) {
    // 全新数据库：SCHEMA 已包含 v2–v5 的字段
    db.exec(SCHEMA)
    version = 5
  }
  if (version < 2) {
    // v1 → v2：缓存供应商的模型列表
    db.exec(`
      ALTER TABLE provider ADD COLUMN models_json TEXT NOT NULL DEFAULT '[]';
      PRAGMA user_version = 2;
    `)
    version = 2
  }
  if (version < 3) {
    // v2 → v3：保存原生搜索的引用来源
    db.exec(`
      ALTER TABLE message ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]';
      PRAGMA user_version = 3;
    `)
    version = 3
  }
  if (version < 4) {
    // v3 → v4：保存本次回复实际使用的搜索关键词
    db.exec(`
      ALTER TABLE message ADD COLUMN queries_json TEXT NOT NULL DEFAULT '[]';
      PRAGMA user_version = 4;
    `)
    version = 4
  }
  if (version < 5) {
    // v4 → v5：保存 ReAct 工具调用步骤
    db.exec(`
      ALTER TABLE message ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]';
      PRAGMA user_version = 5;
    `)
    version = 5
  }

  importLegacyJson(dir)
  removeDemoData()
  normalizeProviderTypes()
  normalizeAvatars()
}

// 早期手动填写的 DeepSeek 服务商升级为 deepseek 类型，启用原生 Web Search
function normalizeProviderTypes(): void {
  d()
    .prepare(
      `UPDATE provider SET type = 'deepseek'
       WHERE type = 'openai' AND lower(base_url) LIKE '%api.deepseek.com%'`
    )
    .run()
}

// 早期版本内置的离线演示已移除：清理演示 Provider、Bot 及其 DM 会话
function removeDemoData(): void {
  const hasDemo = d()
    .prepare(
      `SELECT 1 FROM provider WHERE id = 'demo-provider'
       UNION SELECT 1 FROM bot WHERE provider_id = 'demo-provider'
       LIMIT 1`
    )
    .get()
  if (!hasDemo) return

  tx(() => {
    d()
      .prepare(
        `DELETE FROM message
         WHERE bot_id IN (SELECT id FROM bot WHERE provider_id = 'demo-provider')`
      )
      .run()
    d()
      .prepare(
        `DELETE FROM conversation
         WHERE kind = 'dm'
           AND id IN (
             SELECT conversation_id FROM conversation_bot
             WHERE bot_id IN (SELECT id FROM bot WHERE provider_id = 'demo-provider')
           )`
      )
      .run()
    d().prepare(`DELETE FROM bot WHERE provider_id = 'demo-provider'`).run()
    d()
      .prepare(
        `DELETE FROM conversation
         WHERE kind = 'dm'
           AND id NOT IN (SELECT conversation_id FROM conversation_bot)`
      )
      .run()
    d().prepare(`DELETE FROM provider WHERE id = 'demo-provider'`).run()
  })
}

// 旧版 SVG 预设的头像 id → 15 个新头像
const LEGACY_AVATAR_MAP: Record<string, string> = {
  blob: 'fox-broad-forehead-right',
  bot: 'corgi-3',
  cat: 'hamster-alert-round-eyes-left',
  ghost: 'sheep-3',
  sprout: 'deer-2',
  clover: 'fox-round-face-left',
  fish: 'sea-otter-3',
  bird: 'peach-eared-white-bunny'
}

function normalizeAvatars(): void {
  const valid = new Set<string>(AVATAR_IDS)
  const rows = d()
    .prepare('SELECT id, avatar FROM bot ORDER BY created_at, rowid')
    .all() as unknown as Array<{ id: string; avatar: string }>
  const update = d().prepare('UPDATE bot SET avatar = ?, emoji = ?, color = ? WHERE id = ?')
  rows.forEach((row, index) => {
    if (valid.has(row.avatar)) return
    const mapped = LEGACY_AVATAR_MAP[row.avatar] ?? AVATAR_IDS[index % AVATAR_IDS.length]
    const meta = AVATAR_META[mapped]
    update.run(mapped, meta?.emoji ?? '🤖', meta?.color ?? '#F2B24B', row.id)
  })
}

export function closeRepo(): void {
  if (!db) return
  db.close()
  db = null
}

function count(table: 'provider' | 'bot' | 'conversation' | 'message'): number {
  const row = d().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return Number(row.n)
}

function tx<T>(fn: () => T): T {
  d().exec('BEGIN')
  try {
    const result = fn()
    d().exec('COMMIT')
    return result
  } catch (err) {
    d().exec('ROLLBACK')
    throw err
  }
}

// ---------- providers ----------

interface ProviderRow {
  id: string
  name: string
  type: string
  base_url: string
  key_enc: string | null
  models_json: string | null
}

function parseModels(json: string | null): string[] {
  try {
    const parsed = JSON.parse(json || '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : []
  } catch {
    return []
  }
}

function providerModels(row: ProviderRow): string[] {
  return row.type === 'fake' ? ['demo'] : parseModels(row.models_json)
}

function rowToProviderView(p: ProviderRow): ProviderView {
  return {
    id: p.id,
    name: p.name,
    type: p.type as ProviderType,
    baseUrl: p.base_url,
    hasKey: Boolean(p.key_enc),
    models: providerModels(p)
  }
}

export function listProviders(): ProviderView[] {
  return (d()
    .prepare('SELECT * FROM provider ORDER BY rowid')
    .all() as unknown as ProviderRow[]).map(rowToProviderView)
}

export function getProvider(id: string): StoredProvider | undefined {
  const row = d().prepare('SELECT * FROM provider WHERE id = ?').get(id) as unknown as ProviderRow | undefined
  if (!row) return undefined
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProviderType,
    baseUrl: row.base_url,
    keyEnc: row.key_enc ?? undefined,
    models: providerModels(row)
  }
}

export function saveProvider(input: ProviderInput, keyEnc?: string): ProviderView {
  const id = input.id || randomUUID()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const type =
    input.type === 'openai' && /api\.deepseek\.com/i.test(baseUrl) ? 'deepseek' : input.type
  const existing = input.id ? getProvider(input.id) : undefined
  d()
    .prepare(
      `INSERT INTO provider (id, name, type, base_url, key_enc, enabled)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         base_url = excluded.base_url,
         key_enc = COALESCE(excluded.key_enc, provider.key_enc)`
    )
    .run(
      id,
      input.name.trim() || '未命名服务商',
      type,
      baseUrl,
      keyEnc ?? null
    )
  // Base URL 变了，旧的模型列表作废
  if (existing && existing.baseUrl !== baseUrl) {
    d().prepare("UPDATE provider SET models_json = '[]' WHERE id = ?").run(id)
  }
  const row = d().prepare('SELECT * FROM provider WHERE id = ?').get(id) as unknown as ProviderRow
  return rowToProviderView(row)
}

export function setProviderModels(id: string, models: string[]): void {
  d().prepare('UPDATE provider SET models_json = ? WHERE id = ?').run(JSON.stringify(models), id)
}

export function removeProvider(id: string): void {
  d().prepare('DELETE FROM provider WHERE id = ?').run(id)
}

// ---------- bots ----------

interface BotRow {
  id: string
  name: string
  avatar: string
  emoji: string
  color: string
  system_prompt: string
  provider_id: string
  model: string
  temperature: number
}

function rowToBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar ?? '',
    emoji: row.emoji,
    color: row.color,
    systemPrompt: row.system_prompt,
    providerId: row.provider_id,
    model: row.model,
    temperature: Number(row.temperature)
  }
}

export function listBots(): Bot[] {
  return (d().prepare('SELECT * FROM bot ORDER BY created_at, rowid').all() as unknown as BotRow[]).map(rowToBot)
}

export function getBot(id: string): Bot | undefined {
  const row = d().prepare('SELECT * FROM bot WHERE id = ?').get(id) as unknown as BotRow | undefined
  return row ? rowToBot(row) : undefined
}

export function saveBot(input: BotInput): Bot {
  const id = input.id || randomUUID()
  const bot: Bot = {
    id,
    name: input.name.trim() || '新 Bot',
    avatar: input.avatar || '',
    emoji: (input.emoji || '🤖').slice(0, 4),
    color: input.color || '#F2B24B',
    systemPrompt: input.systemPrompt ?? '',
    providerId: input.providerId,
    model: input.model.trim(),
    temperature: Math.min(2, Math.max(0, Number(input.temperature) || 0))
  }
  d()
    .prepare(
      `INSERT INTO bot (id, name, avatar, emoji, color, system_prompt, provider_id, model, temperature, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         avatar = excluded.avatar,
         emoji = excluded.emoji,
         color = excluded.color,
         system_prompt = excluded.system_prompt,
         provider_id = excluded.provider_id,
         model = excluded.model,
         temperature = excluded.temperature`
    )
    .run(
      bot.id,
      bot.name,
      bot.avatar,
      bot.emoji,
      bot.color,
      bot.systemPrompt,
      bot.providerId,
      bot.model,
      bot.temperature,
      Date.now()
    )
  return bot
}

export function removeBot(id: string): void {
  tx(() => {
    d().prepare('DELETE FROM bot WHERE id = ?').run(id)
    // 1:1 会话失去 Bot 后没有存在意义；群聊保留历史
    d()
      .prepare(
        `DELETE FROM conversation
         WHERE kind = 'dm'
           AND id NOT IN (SELECT conversation_id FROM conversation_bot)`
      )
      .run()
  })
}

// ---------- conversations ----------

interface ConversationRow {
  id: string
  title: string
  kind: string
  reply_mode: string
  created_at: number
  updated_at: number
}

function participantIds(conversationId: string): string[] {
  return (
    d()
      .prepare('SELECT bot_id FROM conversation_bot WHERE conversation_id = ? ORDER BY sort_order')
      .all(conversationId) as unknown as Array<{ bot_id: string }>
  ).map(r => r.bot_id)
}

function latestMessage(conversationId: string): { content: string; at: number } | undefined {
  const row = d()
    .prepare(
      `SELECT content, created_at FROM message
       WHERE conversation_id = ? AND content <> ''
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`
    )
    .get(conversationId) as { content: string; created_at: number } | undefined
  return row ? { content: row.content, at: Number(row.created_at) } : undefined
}

function rowToConversation(row: ConversationRow): Conversation {
  const latest = latestMessage(row.id)
  return {
    id: row.id,
    title: row.title,
    botIds: participantIds(row.id),
    kind: row.kind as ConversationKind,
    replyMode: row.reply_mode as ReplyMode,
    lastMessage: latest?.content,
    lastMessageAt: latest?.at,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export function listConversations(): Conversation[] {
  return (
    d()
      .prepare('SELECT * FROM conversation ORDER BY updated_at DESC, rowid DESC')
      .all() as unknown as ConversationRow[]
  ).map(rowToConversation)
}

export function getConversation(id: string): Conversation | undefined {
  const row = d().prepare('SELECT * FROM conversation WHERE id = ?').get(id) as unknown as
    | ConversationRow
    | undefined
  return row ? rowToConversation(row) : undefined
}

function insertParticipants(conversationId: string, botIds: string[]): void {
  const stmt = d().prepare(
    'INSERT OR IGNORE INTO conversation_bot (conversation_id, bot_id, sort_order) VALUES (?, ?, ?)'
  )
  botIds.forEach((botId, index) => stmt.run(conversationId, botId, index))
}

export function openBotChat(botId: string): Conversation {
  const bot = getBot(botId)
  if (!bot) throw new Error('Bot 不存在')

  const existing = d()
    .prepare(
      `SELECT c.* FROM conversation c
       JOIN conversation_bot cb ON cb.conversation_id = c.id
       WHERE c.kind = 'dm' AND cb.bot_id = ?
         AND (SELECT COUNT(*) FROM conversation_bot x WHERE x.conversation_id = c.id) = 1
       ORDER BY c.updated_at DESC
       LIMIT 1`
    )
    .get(botId) as unknown as ConversationRow | undefined

  if (existing) return rowToConversation(existing)

  const now = Date.now()
  const id = randomUUID()
  tx(() => {
    d()
      .prepare(
        `INSERT INTO conversation (id, title, kind, reply_mode, created_at, updated_at)
         VALUES (?, ?, 'dm', 'all', ?, ?)`
      )
      .run(id, bot.name, now, now)
    insertParticipants(id, [botId])
  })
  return getConversation(id) as Conversation
}

export function createGroup(title: string, botIds: string[]): Conversation {
  const unique = [...new Set(botIds)].filter(id => Boolean(getBot(id)))
  if (unique.length < 2) throw new Error('群聊至少需要 2 个 Bot')

  const names = unique.map(id => getBot(id)?.name).filter(Boolean) as string[]
  const finalTitle = title.trim() || names.slice(0, 3).join('、') || '新群聊'
  const now = Date.now()
  const id = randomUUID()

  tx(() => {
    d()
      .prepare(
        `INSERT INTO conversation (id, title, kind, reply_mode, created_at, updated_at)
         VALUES (?, ?, 'group', 'all', ?, ?)`
      )
      .run(id, finalTitle, now, now)
    insertParticipants(id, unique)
  })
  return getConversation(id) as Conversation
}

export function setGroupMembers(conversationId: string, botIds: string[]): void {
  const conversation = getConversation(conversationId)
  if (!conversation) throw new Error('会话不存在')
  if (conversation.kind !== 'group') throw new Error('只有群聊可以修改成员')

  const unique = [...new Set(botIds)].filter(id => Boolean(getBot(id)))
  if (unique.length < 2) throw new Error('群聊至少需要 2 个 Bot')

  tx(() => {
    d().prepare('DELETE FROM conversation_bot WHERE conversation_id = ?').run(conversationId)
    insertParticipants(conversationId, unique)
    d().prepare('UPDATE conversation SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId)
  })
}

export function setReplyMode(conversationId: string, mode: ReplyMode): void {
  d()
    .prepare('UPDATE conversation SET reply_mode = ? WHERE id = ?')
    .run(mode === 'mention' ? 'mention' : 'all', conversationId)
}

// ---------- messages ----------

interface MessageRow {
  id: string
  conversation_id: string
  author: string
  bot_id: string | null
  run_id: string | null
  content: string
  status: string
  error: string | null
  sources_json: string | null
  queries_json: string | null
  steps_json: string | null
  created_at: number
}

function parseSources(json: string | null): WebSource[] | undefined {
  try {
    const parsed = JSON.parse(json || '[]') as unknown
    if (!Array.isArray(parsed)) return undefined
    const sources = parsed.filter(
      (source): source is WebSource =>
        Boolean(source) && typeof source === 'object' && typeof (source as WebSource).url === 'string'
    )
    return sources.length > 0 ? sources : undefined
  } catch {
    return undefined
  }
}

function parseQueries(json: string | null): string[] | undefined {
  try {
    const parsed = JSON.parse(json || '[]') as unknown
    if (!Array.isArray(parsed)) return undefined
    const queries = parsed.filter((query): query is string => typeof query === 'string' && query.length > 0)
    return queries.length > 0 ? queries : undefined
  } catch {
    return undefined
  }
}

function parseSteps(json: string | null): ToolStep[] | undefined {
  try {
    const parsed = JSON.parse(json || '[]') as unknown
    if (!Array.isArray(parsed)) return undefined
    const steps = parsed.filter(
      (step): step is ToolStep =>
        Boolean(step) &&
        typeof step === 'object' &&
        typeof (step as ToolStep).id === 'string' &&
        typeof (step as ToolStep).toolName === 'string'
    )
    return steps.length > 0 ? steps : undefined
  } catch {
    return undefined
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    author: row.author as 'user' | 'bot',
    botId: row.bot_id ?? undefined,
    runId: row.run_id ?? undefined,
    content: row.content,
    status: row.status as MessageStatus,
    error: row.error ?? undefined,
    sources: parseSources(row.sources_json),
    searchQueries: parseQueries(row.queries_json),
    steps: parseSteps(row.steps_json),
    createdAt: Number(row.created_at)
  }
}

export function listMessages(conversationId: string): Message[] {
  return (
    d()
      .prepare('SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId) as unknown as MessageRow[]
  ).map(rowToMessage)
}

export function getMessage(id: string): Message | undefined {
  const row = d().prepare('SELECT * FROM message WHERE id = ?').get(id) as unknown as MessageRow | undefined
  return row ? rowToMessage(row) : undefined
}

export function addMessage(message: Message): Message {
  tx(() => {
    d()
      .prepare(
        `INSERT INTO message (id, conversation_id, author, bot_id, run_id, content, status, error, sources_json, queries_json, steps_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.conversationId,
        message.author,
        message.botId ?? null,
        message.runId ?? null,
        message.content,
        message.status,
        message.error ?? null,
        JSON.stringify(message.sources ?? []),
        JSON.stringify(message.searchQueries ?? []),
        JSON.stringify(message.steps ?? []),
        message.createdAt
      )
    d().prepare('UPDATE conversation SET updated_at = ? WHERE id = ?').run(Date.now(), message.conversationId)
  })
  return message
}

export function updateMessage(id: string, patch: Partial<Message>): Message | undefined {
  const message = getMessage(id)
  if (!message) return undefined
  const next = { ...message, ...patch }
  d()
    .prepare(
      'UPDATE message SET content = ?, status = ?, error = ?, sources_json = ?, queries_json = ?, steps_json = ? WHERE id = ?'
    )
    .run(
      next.content,
      next.status,
      next.error ?? null,
      JSON.stringify(next.sources ?? []),
      JSON.stringify(next.searchQueries ?? []),
      JSON.stringify(next.steps ?? []),
      id
    )
  return next
}

export function recentMessages(conversationId: string, limit: number): Message[] {
  return (
    d()
      .prepare(
        `SELECT * FROM (
           SELECT rowid AS rid, * FROM message
           WHERE conversation_id = ? AND status IN ('done', 'cancelled')
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?
         ) ORDER BY created_at, rid`
      )
      .all(conversationId, limit) as unknown as MessageRow[]
  ).map(rowToMessage)
}

// ---------- legacy import ----------

interface LegacyData {
  providers?: Array<{
    id: string
    name: string
    type?: string
    baseUrl?: string
    keyEnc?: string
  }>
  bots?: Array<{
    id: string
    name: string
    emoji?: string
    color?: string
    systemPrompt?: string
    providerId?: string
    model?: string
    temperature?: number
  }>
  conversations?: Array<{ id: string; title: string; botIds?: string[]; createdAt?: number }>
  messages?: Array<{
    id: string
    conversationId: string
    author?: string
    botId?: string
    runId?: string
    content?: string
    status?: string
    error?: string
    createdAt?: number
  }>
}

function importLegacyJson(dir: string): 'none' | 'ok' | 'failed' {
  if (count('provider') > 0 || count('bot') > 0) return 'none'
  const file = join(dir, 'data.json')
  if (!existsSync(file)) return 'none'

  let data: LegacyData
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as LegacyData
  } catch (err) {
    console.error('旧数据读取失败', err)
    return 'failed'
  }

  try {
    tx(() => {
      const insertProvider = d().prepare(
        `INSERT OR IGNORE INTO provider (id, name, type, base_url, key_enc, enabled)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      for (const provider of data.providers ?? []) {
        insertProvider.run(
          provider.id,
          provider.name,
          provider.type === 'fake' ? 'fake' : 'openai',
          provider.baseUrl ?? '',
          provider.keyEnc ?? null
        )
      }

      const insertBot = d().prepare(
        `INSERT OR IGNORE INTO bot
           (id, name, avatar, emoji, color, system_prompt, provider_id, model, temperature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      ;(data.bots ?? []).forEach((bot, index) => {
        insertBot.run(
          bot.id,
          bot.name,
          AVATAR_IDS[index % AVATAR_IDS.length],
          bot.emoji ?? '🤖',
          bot.color ?? '#F2B24B',
          bot.systemPrompt ?? '',
          bot.providerId ?? '',
          bot.model ?? '',
          Number(bot.temperature) || 0.7,
          Date.now() + index
        )
      })

      const insertConversation = d().prepare(
        `INSERT OR IGNORE INTO conversation (id, title, kind, reply_mode, created_at, updated_at)
         VALUES (?, ?, ?, 'all', ?, ?)`
      )
      const knownBots = new Set(
        (d().prepare('SELECT id FROM bot').all() as unknown as Array<{ id: string }>).map(r => r.id)
      )
      const importedConversations = new Set<string>()
      // 旧版本点“新建会话”会留下没有消息的空草稿，导入时跳过
      const withMessages = new Set((data.messages ?? []).map(m => m.conversationId))

      for (const conversation of data.conversations ?? []) {
        if (!withMessages.has(conversation.id)) continue
        const botIds = [...new Set(conversation.botIds ?? [])].filter(id => knownBots.has(id))
        if (botIds.length === 0) continue
        const createdAt = Number(conversation.createdAt) || Date.now()
        insertConversation.run(
          conversation.id,
          conversation.title,
          botIds.length > 1 ? 'group' : 'dm',
          createdAt,
          createdAt
        )
        insertParticipants(conversation.id, botIds)
        importedConversations.add(conversation.id)
      }

      const insertMessage = d().prepare(
        `INSERT OR IGNORE INTO message
           (id, conversation_id, author, bot_id, run_id, content, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const message of data.messages ?? []) {
        if (!importedConversations.has(message.conversationId)) continue
        insertMessage.run(
          message.id,
          message.conversationId,
          message.author === 'user' ? 'user' : 'bot',
          message.botId ?? null,
          message.runId ?? null,
          message.content ?? '',
          message.status ?? 'done',
          message.error ?? null,
          Number(message.createdAt) || Date.now()
        )
      }
    })
    renameSync(file, `${file}.imported`)
    return 'ok'
  } catch (err) {
    console.error('旧数据导入失败，保留 data.json 未改动', err)
    return 'failed'
  }
}
