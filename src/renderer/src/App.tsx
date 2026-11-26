import { useEffect, useRef } from 'react'
import type { Bot, Conversation } from '../../../shared/types'
import { BotAvatar, GroupAvatar, PresetAvatar } from './Avatar'
import { BotModal } from './BotModal'
import { ChatView } from './ChatView'
import { GroupSheet } from './GroupSheet'
import { Mark } from './Mark'
import { gsap, prefersReducedMotion, revealSafety, useGSAP } from './motion'
import { SettingsModal } from './Settings'
import { useStore } from './store'

export default function App() {
  const init = useStore(s => s.init)
  const ready = useStore(s => s.ready)
  const bots = useStore(s => s.bots)
  const conversations = useStore(s => s.conversations)
  const activeId = useStore(s => s.activeId)
  const railCollapsed = useStore(s => s.railCollapsed)
  const toast = useStore(s => s.toast)
  const goHome = useStore(s => s.goHome)
  const select = useStore(s => s.select)
  const openBotChat = useStore(s => s.openBotChat)
  const openBotEditor = useStore(s => s.openBotEditor)
  const openGroupCreate = useStore(s => s.openGroupCreate)
  const toggleRail = useStore(s => s.toggleRail)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const isMac = window.api.platform === 'darwin'
  const shell = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void init()
  }, [init])

  useGSAP(
    () => {
      if (!ready || prefersReducedMotion()) return
      gsap.from('.rail-inner > *', {
        autoAlpha: 0,
        y: 8,
        duration: 0.45,
        stagger: 0.04,
        ease: 'expo.out'
      })
      return revealSafety(shell.current, '.rail-inner > *', 1200)
    },
    { scope: shell, dependencies: [ready] }
  )

  if (!ready) {
    return (
      <div className="boot">
        <Mark size={28} />
        <p>正在打开 Mellio…</p>
      </div>
    )
  }

  const activeConversation = conversations.find(c => c.id === activeId) ?? null
  const groups = conversations.filter(c => c.kind === 'group')

  const groupBots = (conversation: Conversation): Bot[] =>
    conversation.botIds.map(id => bots.find(b => b.id === id)).filter(Boolean) as Bot[]

  const isDmActive = (botId: string): boolean =>
    activeConversation?.kind === 'dm' && activeConversation.botIds[0] === botId

  const demoBot = bots.find(b => b.id === 'demo-bot')
  let secondary: { label: string; run: () => void } | undefined
  if (demoBot) {
    secondary = { label: '先和梅梅聊聊', run: () => void openBotChat(demoBot.id) }
  } else if (bots.length >= 2) {
    secondary = { label: '拉个群', run: openGroupCreate }
  } else if (bots.length === 1) {
    secondary = { label: `和 ${bots[0].name} 聊聊`, run: () => void openBotChat(bots[0].id) }
  }

  return (
    <div ref={shell} className={`shell${isMac ? ' is-mac' : ''}${railCollapsed ? ' is-rail-collapsed' : ''}`}>
      <a className="skip-link" href="#chat">
        跳到对话
      </a>

      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="回到首页">
          <Mark size={20} />
          <span className="brand-name">Mellio</span>
        </button>
        <div className="topbar-right">
          <span className="topbar-note">记录只在本机</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="设置" title="设置">
            <IconSliders />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`rail${railCollapsed ? ' is-collapsed' : ''}`} aria-label="Bot 与群聊">
          <div className="rail-inner" key={railCollapsed ? 'collapsed' : 'expanded'}>
            {railCollapsed ? (
              <>
                <div className="rail-head rail-head--mini">
                  <button
                    className="rail-toggle icon-btn"
                    onClick={toggleRail}
                    aria-label="展开侧栏"
                    title="展开侧栏"
                  >
                    <IconChevron direction="right" />
                  </button>
                </div>

                <button
                  className="rail-icon-btn"
                  onClick={() => openBotEditor()}
                  aria-label="新建 Bot"
                  title="新建 Bot"
                >
                  <IconPlus />
                </button>

                <div className="rail-mini-list">
                  {bots.map(bot => (
                    <button
                      key={bot.id}
                      className={`rail-mini${isDmActive(bot.id) ? ' is-active' : ''}`}
                      onClick={() => void openBotChat(bot.id)}
                      aria-label={bot.name}
                      title={bot.name}
                    >
                      <BotAvatar bot={bot} size={36} />
                    </button>
                  ))}
                </div>

                {groups.length > 0 && <div className="rail-divider" />}

                <div className="rail-mini-list">
                  {groups.map(group => (
                    <button
                      key={group.id}
                      className={`rail-mini${group.id === activeId ? ' is-active' : ''}`}
                      onClick={() => void select(group.id)}
                      aria-label={group.title}
                      title={group.title}
                    >
                      <GroupAvatar bots={groupBots(group)} size={36} />
                    </button>
                  ))}
                </div>

                <button
                  className="rail-icon-btn"
                  onClick={openGroupCreate}
                  disabled={bots.length < 2}
                  aria-label="拉个群"
                  title={bots.length < 2 ? '至少需要 2 个 Bot' : '拉个群'}
                >
                  <IconGroup />
                </button>
              </>
            ) : (
              <>
                <div className="rail-head">
                  <span className="label">Bot</span>
                  <span className="label-count">{bots.length}</span>
                  <button
                    className="rail-toggle icon-btn"
                    onClick={toggleRail}
                    aria-label="收起侧栏"
                    title="收起侧栏"
                  >
                    <IconChevron direction="left" />
                  </button>
                </div>

                <button className="btn btn-secondary btn-block" onClick={() => openBotEditor()}>
                  ＋ 新建 Bot
                </button>

                <div className="bot-list">
                  {bots.map(bot => (
                    <div key={bot.id} className={`bot-item${isDmActive(bot.id) ? ' is-active' : ''}`}>
                      <button
                        className="bot-item-main"
                        onClick={() => void openBotChat(bot.id)}
                        title={`和 ${bot.name} 聊天`}
                      >
                        <BotAvatar bot={bot} size={38} />
                        <span className="bot-item-text">
                          <span className="bot-item-name">{bot.name}</span>
                          <span className="bot-item-model">{bot.model || '未选模型'}</span>
                        </span>
                      </button>
                      <button
                        className="icon-btn bot-item-edit"
                        onClick={() => openBotEditor(bot.id)}
                        aria-label={`编辑 ${bot.name}`}
                        title="编辑"
                      >
                        <IconPencil />
                      </button>
                    </div>
                  ))}
                  {bots.length === 0 && (
                    <p className="rail-empty">还没有 Bot。新建一个，AI 团队就位。</p>
                  )}
                </div>

                <div className="rail-section">
                  <div className="rail-subhead">
                    <span className="label">群聊</span>
                    <span className="label-count">{groups.length}</span>
                  </div>

                  <div className="group-list">
                    {groups.map(group => (
                      <button
                        key={group.id}
                        className={`group-item${group.id === activeId ? ' is-active' : ''}`}
                        onClick={() => void select(group.id)}
                      >
                        <GroupAvatar bots={groupBots(group)} size={36} />
                        <span className="group-item-text">
                          <span className="group-item-name">{group.title}</span>
                          <span className="group-item-meta">
                            {group.botIds.length} 个 Bot ·{' '}
                            {group.replyMode === 'mention' ? '@ 回复' : '全部回复'}
                          </span>
                        </span>
                      </button>
                    ))}
                    {groups.length === 0 && (
                      <p className="rail-empty">还没有群聊。拉几个 Bot 进来。</p>
                    )}
                  </div>

                  <button
                    className="btn btn-secondary btn-block"
                    onClick={openGroupCreate}
                    disabled={bots.length < 2}
                    title={bots.length < 2 ? '至少需要 2 个 Bot' : '拉个群'}
                  >
                    ＋ 拉个群
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {activeConversation ? (
          <ChatView key={activeConversation.id} conversation={activeConversation} />
        ) : (
          <Home onNewBot={() => openBotEditor()} secondary={secondary} />
        )}
      </div>

      <BotModal />
      <SettingsModal />
      <GroupSheet />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

function Home({
  onNewBot,
  secondary
}: {
  onNewBot: () => void
  secondary?: { label: string; run: () => void }
}) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
      tl.from('.home-eyebrow', { autoAlpha: 0, y: 8, duration: 0.45 }, 0)
        .from('.home-line-inner', { yPercent: 110, duration: 0.7, stagger: 0.08 }, 0.05)
        .from('.home-lead', { autoAlpha: 0, y: 12, duration: 0.52 }, 0.42)
        .from('.home-actions', { autoAlpha: 0, y: 12, duration: 0.52 }, 0.5)
        .from('.home-fact', { autoAlpha: 0, y: 8, duration: 0.45 }, 0.6)
        .from('.home-window', { autoAlpha: 0, scale: 0.98, duration: 0.9 }, 0.3)
      return revealSafety(
        root.current,
        '.home-eyebrow, .home-line-inner, .home-lead, .home-actions, .home-fact, .home-window',
        1800
      )
    },
    { scope: root }
  )

  return (
    <main className="home" id="chat" ref={root}>
      <div className="home-grid">
        <div className="home-copy">
          <p className="home-eyebrow">本地优先 · 自带 API Key</p>
          <h1 className="home-title">
            <span className="home-line">
              <span className="home-line-inner">把一支 AI 团队，</span>
            </span>
            <span className="home-line">
              <span className="home-line-inner">放到你的桌面上。</span>
            </span>
          </h1>
          <p className="home-lead">
            给每个 Bot 设定角色与模型。它们同场回答，聊天记录只留在你的电脑上。
          </p>
          <div className="home-actions">
            <button className="btn btn-primary" onClick={onNewBot}>
              新建 Bot
            </button>
            {secondary && (
              <button className="btn btn-secondary" onClick={secondary.run}>
                {secondary.label}
              </button>
            )}
          </div>
          <p className="home-fact">多个模型同场 · 无需注册 · 数据留在本机</p>
        </div>

        <HomeWindow />
      </div>
    </main>
  )
}

function HomeWindow() {
  return (
    <div className="home-window" role="img" aria-label="产品预览：三个 Bot 在同一个群聊里同时回复">
      <div className="window-bar">
        <Mark size={16} />
        <span className="window-title">代码审查组</span>
        <span className="window-meta">3 个 Bot</span>
      </div>
      <div className="window-body">
        <div className="window-msg--user">审一下这段登录逻辑，顺便起个测试。</div>

        <div className="window-bot">
          <PresetAvatar id="golden-retriever" size={28} />
          <div>
            <div className="window-name">
              梅梅 <span className="window-model">grok-4</span>
            </div>
            <p className="window-text">
              先看三个风险：超时、重放、日志带了 token
              <span className="caret" aria-hidden="true" />
            </p>
          </div>
        </div>

        <div className="window-bot">
          <PresetAvatar id="corgi-3" size={28} />
          <div>
            <div className="window-name">
              阿码 <span className="window-model">deepseek-chat</span>
            </div>
            <p className="window-text">测试写到 tests/auth.test.ts，覆盖过期 token 和并发续期。</p>
          </div>
        </div>

        <div className="window-bot">
          <PresetAvatar id="fox-broad-forehead-right" size={28} />
          <div>
            <div className="window-name">
              判官 <span className="window-model">gpt-4o</span>
            </div>
            <p className="window-text">结论：先修日志，再补重放测试。</p>
          </div>
        </div>
      </div>
      <div className="window-composer">
        <span>@ 阿码 继续</span>
        <span className="window-send">发送</span>
      </div>
    </div>
  )
}

function IconSliders() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h7M15 7h5M4 12h2M10 12h10M4 17h9M17 17h3" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  )
}

function IconChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: direction === 'right' ? 'rotate(180deg)' : undefined }}
    >
      <path d="M14.5 6L8.5 12l6 6" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconGroup() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="3.2" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M15.8 14.7c2.2.3 4 1.8 4.6 4" />
    </svg>
  )
}

function IconPencil() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  )
}
