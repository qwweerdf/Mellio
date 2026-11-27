import { useEffect, useRef } from 'react'
import type { Bot, Conversation } from '../../../shared/types'
import appIcon from '../assets/app-icon.png'
import { BotAvatar, GroupAvatar, PresetAvatar } from './Avatar'
import { BotModal } from './BotModal'
import { ChatView } from './ChatView'
import { GroupSheet } from './GroupSheet'
import { Mark } from './Mark'
import { gsap, prefersReducedMotion, revealSafety, useGSAP } from './motion'
import { SettingsModal } from './Settings'
import { useStore } from './store'
import { useT } from './useT'

export default function App() {
  const init = useStore(s => s.init)
  const ready = useStore(s => s.ready)
  const bots = useStore(s => s.bots)
  const conversations = useStore(s => s.conversations)
  const messages = useStore(s => s.messages)
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
  const { t, lang } = useT()
  const isMac = window.api.platform === 'darwin'
  const shell = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    document.title = t('app.windowTitle')
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    // 文案随语言切换，t 的闭包已包含当前 lang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

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
        <p>{t('app.loading')}</p>
      </div>
    )
  }

  const activeConversation = conversations.find(c => c.id === activeId) ?? null
  const groups = conversations.filter(c => c.kind === 'group')

  const groupBots = (conversation: Conversation): Bot[] =>
    conversation.botIds.map(id => bots.find(b => b.id === id)).filter(Boolean) as Bot[]

  const isDmActive = (botId: string): boolean =>
    activeConversation?.kind === 'dm' && activeConversation.botIds[0] === botId

  let secondary: { label: string; run: () => void } | undefined
  if (bots.length >= 2) {
    secondary = { label: t('home.group'), run: openGroupCreate }
  } else if (bots.length === 1) {
    secondary = { label: t('home.chatWith', { name: bots[0].name }), run: () => void openBotChat(bots[0].id) }
  }

  const cleanPreview = (text?: string): string =>
    text ? text.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim() : ''

  const previewFor = (botId: string): string => {
    let bestText = ''
    let bestAt = -1
    for (const conversation of conversations.filter(c => c.botIds.includes(botId))) {
      let text = ''
      let at = conversation.lastMessageAt ?? 0
      const live = messages[conversation.id]
      if (live?.length) {
        for (let index = live.length - 1; index >= 0; index--) {
          const candidate = cleanPreview(live[index].content)
          if (candidate) {
            text = candidate
            at = live[index].createdAt
            break
          }
        }
      }
      if (!text) text = cleanPreview(conversation.lastMessage)
      if (text && at >= bestAt) {
        bestText = text
        bestAt = at
      }
    }
    return bestText || t('app.noMessages')
  }

  return (
    <div ref={shell} className={`shell${isMac ? ' is-mac' : ''}${railCollapsed ? ' is-rail-collapsed' : ''}`}>
      <a className="skip-link" href="#chat">
        {t('app.skip')}
      </a>

      <header className="topbar">
        <div className="topbar-right">
          <span className="topbar-note">{t('app.localOnly')}</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label={t('app.settings')} title={t('app.settings')}>
            <IconSliders />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className={`rail${railCollapsed ? ' is-collapsed' : ''}`} aria-label={`${t('app.botsLabel')} · ${t('app.groupsLabel')}`}>
          <div className="rail-inner" key={railCollapsed ? 'collapsed' : 'expanded'}>
            {railCollapsed ? (
              <>
                <button
                  className="rail-brand rail-brand--mini"
                  onClick={goHome}
                  aria-label={t('app.home')}
                  title="Mellio"
                >
                  <img src={appIcon} alt="" className="rail-brand-icon" />
                </button>

                <div className="rail-head rail-head--mini">
                  <button
                    className="rail-toggle icon-btn"
                    onClick={toggleRail}
                    aria-label={t('app.expand')}
                    title={t('app.expand')}
                  >
                    <IconChevron direction="right" />
                  </button>
                </div>

                <button
                  className="rail-icon-btn"
                  onClick={() => openBotEditor()}
                  aria-label={t('app.newBot')}
                  title={t('app.newBot')}
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
                  aria-label={t('app.newGroup')}
                  title={bots.length < 2 ? t('app.minBots') : t('app.newGroup')}
                >
                  <IconGroup />
                </button>
              </>
            ) : (
              <>
                <button className="rail-brand" onClick={goHome} aria-label={t('app.home')}>
                  <img src={appIcon} alt="" className="rail-brand-icon" />
                  <span className="rail-brand-name">Mellio</span>
                </button>

                <div className="rail-head">
                  <span className="label">{t('app.botsLabel')}</span>
                  <span className="label-count">{bots.length}</span>
                  <button
                    className="rail-toggle icon-btn"
                    onClick={toggleRail}
                    aria-label={t('app.collapse')}
                    title={t('app.collapse')}
                  >
                    <IconChevron direction="left" />
                  </button>
                </div>

                <button className="btn btn-secondary btn-block" onClick={() => openBotEditor()}>
                  {t('app.newBot')}
                </button>

                <div className="bot-list">
                  {bots.map(bot => (
                    <div key={bot.id} className={`bot-item${isDmActive(bot.id) ? ' is-active' : ''}`}>
                      <button
                        className="bot-item-main"
                        onClick={() => void openBotChat(bot.id)}
                        title={t('app.chatWith', { name: bot.name })}
                      >
                        <BotAvatar bot={bot} size={38} />
                        <span className="bot-item-text">
                          <span className="bot-item-name">{bot.name}</span>
                          <span className="bot-item-preview">{previewFor(bot.id)}</span>
                        </span>
                      </button>
                      <button
                        className="icon-btn bot-item-edit"
                        onClick={() => openBotEditor(bot.id)}
                        aria-label={t('app.editBot', { name: bot.name })}
                        title={t('app.edit')}
                      >
                        <IconPencil />
                      </button>
                    </div>
                  ))}
                  {bots.length === 0 && (
                    <p className="rail-empty">{t('app.noBots')}</p>
                  )}
                </div>

                <div className="rail-section">
                  <div className="rail-subhead">
                    <span className="label">{t('app.groupsLabel')}</span>
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
                            {group.collaborationMode === 'team'
                              ? t('app.groupMetaTeam', {
                                  count: group.botIds.length,
                                  lead:
                                    bots.find(bot => bot.id === group.leadBotId)?.name ?? '—'
                                })
                              : t('app.groupMeta', {
                                  count: group.botIds.length,
                                  mode:
                                    group.replyMode === 'mention'
                                      ? t('app.modeMention')
                                      : t('app.modeAll')
                                })}
                          </span>
                        </span>
                      </button>
                    ))}
                    {groups.length === 0 && (
                      <p className="rail-empty">{t('app.noGroups')}</p>
                    )}
                  </div>

                  <button
                    className="btn btn-secondary btn-block"
                    onClick={openGroupCreate}
                    disabled={bots.length < 2}
                    title={bots.length < 2 ? t('app.minBots') : t('app.newGroup')}
                  >
                    {t('app.newGroup')}
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
  const { t } = useT()

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
          <p className="home-eyebrow">{t('home.eyebrow')}</p>
          <h1 className="home-title">
            <span className="home-line">
              <span className="home-line-inner">{t('home.title1')}</span>
            </span>
            <span className="home-line">
              <span className="home-line-inner">{t('home.title2')}</span>
            </span>
          </h1>
          <p className="home-lead">{t('home.lead')}</p>
          <div className="home-actions">
            <button className="btn btn-primary" onClick={onNewBot}>
              {t('home.newBot')}
            </button>
            {secondary && (
              <button className="btn btn-secondary" onClick={secondary.run}>
                {secondary.label}
              </button>
            )}
          </div>
          <p className="home-fact">{t('home.fact')}</p>
        </div>

        <HomeWindow />
      </div>
    </main>
  )
}

function HomeWindow() {
  const { t } = useT()
  return (
    <div className="home-window" role="img" aria-label={t('home.mockAria')}>
      <div className="window-bar">
        <Mark size={16} />
        <span className="window-title">{t('home.mockTitle')}</span>
        <span className="window-meta">{t('home.mockBots')}</span>
      </div>
      <div className="window-body">
        <div className="window-msg--user">{t('home.mockUser')}</div>

        <div className="window-bot">
          <PresetAvatar id="golden-retriever" size={28} />
          <div>
            <div className="window-name">
              {t('home.mockBot1')} <span className="window-model">grok-4</span>
            </div>
            <p className="window-text">
              {t('home.mockReply1')}
              <span className="caret" aria-hidden="true" />
            </p>
          </div>
        </div>

        <div className="window-bot">
          <PresetAvatar id="corgi-3" size={28} />
          <div>
            <div className="window-name">
              {t('home.mockBot2')} <span className="window-model">deepseek-chat</span>
            </div>
            <p className="window-text">{t('home.mockReply2')}</p>
          </div>
        </div>

        <div className="window-bot">
          <PresetAvatar id="fox-broad-forehead-right" size={28} />
          <div>
            <div className="window-name">
              {t('home.mockBot3')} <span className="window-model">gpt-4o</span>
            </div>
            <p className="window-text">{t('home.mockReply3')}</p>
          </div>
        </div>
      </div>
      <div className="window-composer">
        <span>{t('home.mockComposer')}</span>
        <span className="window-send">{t('home.mockSend')}</span>
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
