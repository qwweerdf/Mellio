# Mellio v0.1 · 最小可运行 MVP 方案

> 目标：3 个工作日，从空目录到「双击安装、能群聊」的桌面应用。
> 状态：可执行 · 日期：2026-11-25
>
> **实现更新（2026-11-26）**：v0.1 已直接使用 SQLite（Electron 内置 `node:sqlite`，WAL；旧 `data.json` 首次启动自动导入并改名）。左栏改为「Bot 名册 + 群聊」（可折叠），移除右侧参与者栏；群聊新增「全部回复 / @ 回复」两种模式与 @ 提及；Bot 使用 15 个预设头像（不选随机，旧 id 自动映射）；1:1 聊天右上角可切换服务商/模型；Bot 回复可复制；Bot 行显示最新消息；应用支持中英双语；离线演示 Provider 已移除；App 使用自定义圆角图标；安装包通过 GitHub Actions 发布到 Releases。下文第 3 节的 JSON 方案与部分交互描述保留为最初规划记录，以代码与 README 为准。

---

## 0. 决策摘要

| 项 | 决策 |
|---|---|
| 运行时 | Electron + React + TypeScript（electron-vite）· **无 Python、无本地 HTTP 服务** |
| 业务逻辑位置 | 主进程 Node；`orchestrator / llm / repo` 写成不认识 Electron 的纯 TS |
| renderer | 只放 UI 状态（草稿、滚动、乐观更新），**不写任何业务规则** |
| 依赖 | 约 10 个，v0.1 不含原生模块 |
| 存储 | SQLite（Electron 内置 `node:sqlite`，WAL）；旧 JSON 首次启动自动导入 |
| API Key | `safeStorage` 加密后随 JSON 存储，密文不进 renderer、不进日志 |
| 发布 | electron-builder：macOS dmg（arm64）+ Windows NSIS（x64，per-user），先不签名 |

成功标准（五条）：

1. `npm run dev` 打开窗口，配置一个 OpenAI-compatible Provider 后能流式聊天
2. 创建 3–5 个 Bot，群聊里全员并行回复，可单独取消
3. 关掉应用重开，数据还在
4. 单个 Bot 失败（Key 错/超时/限流）不影响其他 Bot
5. `npm run dist:mac` / `dist:win` 产出可安装包，干净机器能装

---

## 1. 范围

| 做（v0.1） | 不做（v0.2+） |
|---|---|
| Provider 配置 + Key 加密 + 连接测试 | 账号、云同步、订阅 |
| Bot CRUD（emoji 头像/颜色/人设/模型/温度） | 记忆、工具调用、MCP、知识库 |
| 会话列表：单聊 = 1 个参与者的群聊 | 多轮讨论模式（主持人/总结者） |
| 群聊：全员并行 + @点名 + 流式 + 逐个取消 | 导入导出、会话搜索、自动更新 |
| 每个 Bot 独立状态（排队/生成/失败/已取消） | 文件/图片、语音、快捷键面板 |
| 本地持久化、崩溃/重启不丢 | 正式 i18n（文案先集中一个文件） |
| 首启动向导（无 Provider 自动弹设置） | 签名公证（公开前补） |
| dmg / exe 打包 | Linux |

---

## 2. 架构

```
┌────────────── renderer（sandbox · 浏览器环境）──────────────┐
│ React 三栏 UI · zustand 只存 UI 状态 · 不含业务规则          │
│ 只调 window.api.*，只接收 'run:event' 单向事件              │
└──────────────────────────┬─────────────────────────────────┘
                  contextBridge（preload，约 20 行）
┌──────────────────────────┴─────────────────────────────────┐
│ main（Node 环境）                                           │
│  index.ts        窗口 / 菜单 / IPC 注册（薄壳）              │
│  orchestrator.ts 目标解析、上下文拼装、并发 4、取消/超时     │
│  llm.ts          OpenAI-compatible SSE 客户端（fetch，零依赖）│
│  repo.ts         JSON 持久化——唯一碰存储的文件               │
│  secrets.ts      safeStorage 加解密 Key                     │
└─────────────────────────────────────────────────────────────┘
```

判据：**「换成 CLI/Web 版这段逻辑还要不要？」** 要 → 主进程；不要 → renderer。

业务逻辑的典型写法（纯 TS，可脱离 Electron 单测）：

```ts
// main/orchestrator.ts
export interface Deps {
  repo: Repo
  stream(p: Provider, model: string, msgs: Msg[], signal: AbortSignal): AsyncIterable<Chunk>
  emit(e: RunEvent): void          // IPC 注入；测试时换成数组
}
export async function respond(deps: Deps, convId: string, text: string, targets: 'all' | string[]) {}
```

### 依赖（全部）

`electron` · `electron-vite` · `electron-builder` · `vite` · `react` · `react-dom` · `typescript` · `zustand` · `react-markdown` · `gsap` · `@gsap/react` · `@fontsource-variable/funnel-display` · `@fontsource-variable/funnel-sans` · `@fontsource/dm-mono`

刻意不用，及原因：

| 不用 | 原因 |
|---|---|
| better-sqlite3（v0.1） | 原生模块 = 跨平台打包最大风险，v0.1 不值得 |
| ai-sdk | OpenAI-compatible SSE 手写约 80 行，零依赖 |
| shadcn / radix | v0.1 只有 4 个界面，Tailwind 手写 |
| keytar | Electron 内置 `safeStorage` 够用 |
| LangGraph / 任何编排框架 | 一个约 150 行的 orchestrator 就够 |

### 文件树（约 13 个文件）

```
mellio/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ package.json
├─ shared/types.ts
├─ shared/avatars.ts
├─ src/main/index.ts
├─ src/main/orchestrator.ts
├─ src/main/llm.ts
├─ src/main/repo.ts
├─ src/main/secrets.ts
├─ src/preload/index.ts
├─ src/renderer/index.html
├─ src/renderer/main.tsx
├─ src/renderer/App.tsx
├─ src/renderer/ChatView.tsx
├─ src/renderer/GroupSheet.tsx
├─ src/renderer/BotModal.tsx
├─ src/renderer/Settings.tsx
├─ src/renderer/Avatar.tsx
├─ src/renderer/Sheet.tsx
├─ src/renderer/Mark.tsx
├─ src/renderer/motion.ts
└─ src/renderer/styles.css
```

---

## 3. 数据库决策（重点）

### v0.1：不用数据库，用单 JSON 文件

- 位置：`app.getPath('userData')/data.json`（mac: `~/Library/Application Support/Mellio/`，win: `%APPDATA%/Mellio/`）
- 写入：300ms 防抖，写 `data.json.tmp` 后 `rename` 原子替换；加载失败时读 `data.json.bak`
- 结构：

```json
{
  "providers": [{ "id": "p1", "name": "OpenRouter", "type": "openai",
                  "baseUrl": "https://openrouter.ai/api/v1", "keyEnc": "<base64 密文>" }],
  "bots":       [{ "id": "b1", "name": "小书", "emoji": "📚", "color": "#7C6CF6",
                   "systemPrompt": "…", "providerId": "p1", "model": "…", "temperature": 0.7 }],
  "conversations": [{ "id": "c1", "title": "代码审查组", "botIds": ["b1"], "createdAt": 0 }],
  "messages":   [{ "id": "m1", "conversationId": "c1", "author": "user",
                   "content": "…", "status": "done", "createdAt": 0 }]
}
```

为什么这不算偷懒：

- v0.1 的数据量是个位数 MB、单进程写入、无查询需求，JSON 完全够用
- 换数据库的成本被压到**一个文件**：`repo.ts` 是唯一知道存储长什么样的地方

```ts
// ponytail: 全量 JSON 落盘，万条消息内没问题；换 SQLite 只改 repo.ts
```

### 什么时候必须换 SQLite（触发条件任一）

- 消息累计 > 约 1 万条，或 `data.json` > 20MB、启动/保存开始变慢
- 需要会话全文搜索、分页、按时间范围查询
- 需要多窗口 / 未来本地 API / CLI 并发访问
- 需要 schema 迁移（升级不丢数据）、备份恢复
- 计划做"导出/导入"，需要真事务

按 v0.1 的范围，这大概在第 2–3 周做会话搜索时会到。

### 换成什么

| 方案 | 结论 |
|---|---|
| **better-sqlite3（推荐）** | 成熟、同步 API、事务简单；electron-builder 走 `npmRebuild` 自动重建。代价：mac/win 双平台 CI 需建好 |
| `node:sqlite`（Node 内置） | Electron 45 自带 Node 24，理论可用且零原生依赖，但仍属实验性 API——花 10 分钟在目标 Electron 版本上实测，能用就优先它 |
| Drizzle ORM | 需要类型安全查询时作为 repo 内部实现引入；v0.1/v0.2 不必须 |
| Prisma | 过重，桌面应用不推荐 |

### v0.2 SQLite 目标 schema（替换实现时参考）

```sql
CREATE TABLE provider (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'openai',        -- 以后 anthropic / gemini
  base_url TEXT NOT NULL, key_enc BLOB, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bot (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '🤖',
  color TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT REFERENCES provider(id) ON DELETE SET NULL,
  model TEXT NOT NULL, temperature REAL NOT NULL DEFAULT 0.7, created_at INTEGER NOT NULL
);
CREATE TABLE conversation (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'group',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE conversation_bot (
  conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
  bot_id TEXT REFERENCES bot(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, bot_id)
);
CREATE TABLE message (
  id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
  author TEXT NOT NULL, bot_id TEXT, run_id TEXT,
  content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'done',
  meta_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX idx_msg ON message(conversation_id, created_at);
CREATE TABLE run (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, bot_id TEXT NOT NULL,
  trigger_message_id TEXT NOT NULL, status TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, error TEXT,
  started_at INTEGER, finished_at INTEGER
);
```

迁移方式：`PRAGMA user_version` 递增 + 迁移数组；首次启动检测到 `data.json` 就导入并改名 `data.json.imported`（约 30 行）。开启 WAL。

---

## 4. 数据契约（前后端唯一共享物）

```ts
// shared/types.ts
export interface Provider { id: string; name: string; type: 'openai' | 'fake'; baseUrl: string }
export interface Bot {
  id: string; name: string; emoji: string; color: string
  systemPrompt: string; providerId: string; model: string; temperature: number
}
export interface Conversation { id: string; title: string; botIds: string[]; createdAt: number }
export interface Message {
  id: string; conversationId: string; author: 'user' | 'bot'; botId?: string
  content: string; status: 'streaming' | 'done' | 'error' | 'cancelled'; createdAt: number
}
export type RunEvent =
  | { type: 'status'; runId: string; status: 'queued' | 'streaming' }
  | { type: 'delta'; runId: string; messageId: string; delta: string }
  | { type: 'done'; runId: string; messageId: string; usage?: { in: number; out: number } }
  | { type: 'error'; runId: string; messageId: string; error: string }
```

### IPC API（preload 暴露的全部能力）

```ts
api = {
  state(): Promise<{ providers: Provider[]; bots: Bot[]; conversations: Conversation[] }>
  messages(convId: string): Promise<Message[]>
  saveBot(bot: Bot): Promise<Bot>
  removeBot(id: string): Promise<void>
  saveProvider(p: Provider & { apiKey?: string }): Promise<Provider>
  testProvider(id: string): Promise<string>
  createConversation(title: string, botIds: string[]): Promise<Conversation>
  send(input: { conversationId: string; text: string; targets: 'all' | string[] }):
    Promise<{ userMsg: Message; runIds: string[] }>
  cancel(runId: string): Promise<void>
  onRunEvent(cb: (e: RunEvent) => void): () => void
}
```

---

## 5. 一次群聊发送的完整流程

```
send({ conversationId, text, targets: 'all' })
 1. repo 追加 user Message
 2. 解析 targets：'all' → 会话全部 botIds；或 ['bot_a']
 3. 每个目标：建占位 Message(streaming) + Run，emit 'status: queued'
 4. 队列并发 4，其余排队（约 6 行 worker 循环）
 5. 拼上下文：system + 最近 20 条；
    自己的发言 = assistant，其他 Bot 的发言压成 user 并加 "[名字]: " 前缀
    （并行轮彼此看不到对方本轮回复，这是 v0.1 的明确取舍）
 6. llm.chat() 流式 → emit delta → 主进程累计文本
 7. 结束：落 usage、改状态；取消 = abort 且保留已生成内容；
    失败只影响自己的 Run
```

- 取消：`Map<runId, AbortController>`
- 超时：`AbortSignal.any([timeout(120s), userSignal])`
- 安全基线：`sandbox: true`、`contextIsolation`、CSP、禁止 navigation/新窗口、模型输出 Markdown **不渲染 raw HTML**、外链走 `shell.openExternal`

---

## 6. UI 最小集

三栏布局：会话列表（240px）｜时间线｜参与者栏（220px）

- **气泡**：emoji 头像（Bot 色圆底）+ 名字 + 模型 chip + 状态（排队点 / 流式光标 / 失败点击重试）
- **输入框**：`@` 弹 Bot 选择；「发送给：全员 / 某人」切换；Enter 发送、Shift+Enter 换行
- **BotModal**：名字、emoji、颜色、人设、模型
- **Settings**：Provider 列表（baseUrl + Key + 测试连接）；无 Provider 时自动弹出
- **设计系统**（来自 design-taste-frontend 的 deal）：soot + pale lime 深色单色盘（`#0f0f0f / #1a1a1a / #dafa9c`）、Funnel Display / Funnel Sans / DM Mono、soft 圆角 8/12/20、动效 token 150/120/90ms。GSAP 只做首屏与弹层入场，滚动不触发任何动画；`prefers-reduced-motion` 下全部静止
- 文案全部集中在 `strings.ts`（i18n 的口子）

---

## 7. 三天排期

| 天 | 内容 | 验收 |
|---|---|---|
| **D1** 核心闭环 | 脚手架、types、repo、llm SSE、单 Bot 单聊、流式渲染、Bot 编辑器 | 填 Key（DeepSeek / OpenRouter / xAI `https://api.x.ai/v1` 均可）→ 有流式回复；重开应用记录还在 |
| **D2** 群聊 | 多 Bot 会话、@、全员并行、并发队列、取消、失败隔离、状态气泡、参与者栏 | 3–5 个 Bot 同时流式；点停止立刻停；一个 Key 错只影响该 Bot |
| **D3** 能装 | electron-builder、图标、README、空状态打磨、无 Provider 引导 | 干净机器双击安装（mac 首次右键打开，README 说明）；`npm run dist:*` 可用 |

半天余量可加：**fake provider**（约 30 行，固定流式演示文本）——同时充当离线演示模式与未来 CI 的测试替身。

```jsonc
// package.json scripts
"dev":        "electron-vite dev",
"dist:mac":   "electron-vite build && electron-builder --mac",
"dist:win":   "electron-vite build && electron-builder --win"
```

---

## 8. 打包配置要点

```yaml
# electron-builder.yml（核心项）
appId: com.mellio.app
productName: Mellio
directories: { output: release, buildResources: build }
files: ["out/**/*"]
mac:
  category: public.app-category.productivity
  target: [{ target: dmg, arch: [arm64] }]
win:
  target: [{ target: nsis, arch: [x64] }]
nsis:
  oneClick: false
  perMachine: false              # per-user，不需要管理员权限
  allowToChangeInstallationDirectory: true
```

- 图标：`build/icon.png`（1024×1024，builder 自动派生各尺寸）
- 签名/公证：公开前再补（Apple Developer $99/年 + 证书）；README 如实说明 unsigned 的打开方式
- 自动更新：在 builder 配置加 `publish` 块 + 引入 `electron-updater`，代码层预留位置即可

---

## 9. 升级接缝（v0.1 → 后续版本全是加法）

| 现在 | 以后 | 改动范围 |
|---|---|---|
| JSON 存储 | SQLite + 搜索/分页 | 只换 `repo.ts` + 30 行导入器 |
| 手写 SSE（仅 OpenAI 兼容） | Anthropic / Gemini / 工具调用 | `llm.ts` 加一个 switch（或换 ai-sdk） |
| 全员 / @ | 多轮讨论模式 | `orchestrator.ts` 加 `mode` 分支 |
| 单窗口 | 托盘 / 多窗口 / 快捷键 | `index.ts` 加代码 |
| 无签名 | 签名 + 公证 + 自动更新 | 证书 + builder 配置，代码零改动 |
| 重活（本地模型/解析） | `utilityProcess.fork()` 或 Ollama HTTP | 新增进程，不影响主流程 |

唯一纪律：**renderer 不写业务规则，主进程不认识 React。**

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| SSE 兼容差异（部分兼容端点少字段） | D1 就用 2 家真实供应商 + 1 个 fake provider 验证 |
| Key 泄漏 | 只在主进程解密使用；日志统一脱敏；不接受 renderer 传 key |
| JSON 写坏 | 原子 rename + `.bak` + 启动读取失败回退 |
| 打包签名卡发布 | v0.1 unsigned 内测；公开前 2 周启动签名流程 |
| 模型输出注入（XSS） | react-markdown 不渲染 HTML；外链二次确认 |
| 范围膨胀 | 本文件「不做」列表就是验收红线，v0.1 不破例 |
