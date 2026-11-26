import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Bot, Conversation, Message, ReplyMode } from '../../../shared/types'
import { BotAvatar, GroupAvatar } from './Avatar'
import { gsap, prefersReducedMotion, revealSafety, useGSAP } from './motion'
import { useStore } from './store'
import { useT } from './useT'

const EMPTY: Message[] = []

export function ChatView({ conversation }: { conversation: Conversation }) {
  const bots = useStore(s => s.bots)
  const timeline = useStore(s => s.messages[conversation.id] ?? EMPTY)
  const openBotEditor = useStore(s => s.openBotEditor)
  const openGroupMembers = useStore(s => s.openGroupMembers)
  const setReplyMode = useStore(s => s.setReplyMode)
  const { t } = useT()
  const root = useRef<HTMLDivElement>(null)

  const participants = conversation.botIds
    .map(id => bots.find(b => b.id === id))
    .filter(Boolean) as Bot[]
  const isGroup = conversation.kind === 'group'
  const dmBot = isGroup ? undefined : participants[0]

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
      tl.from('.canvas-head', { autoAlpha: 0, y: -6, duration: 0.3 }, 0)
        .from(
          '.stream .msg:nth-last-child(-n+8)',
          { autoAlpha: 0, y: 8, duration: 0.45, stagger: 0.035 },
          0.05
        )
        .from('.composer', { autoAlpha: 0, y: 8, duration: 0.35 }, 0.1)
      return revealSafety(root.current, '.canvas-head, .stream .msg, .composer', 1600)
    },
    { scope: root, dependencies: [conversation.id] }
  )

  return (
    <main className="canvas" id="chat" ref={root}>
      <header className="canvas-head">
        <div className="canvas-id">
          {isGroup ? (
            <GroupAvatar bots={participants} size={40} />
          ) : (
            <BotAvatar bot={dmBot} size={40} />
          )}
          <div className="canvas-id-text">
            <h1 className="conv-title-main">
              {isGroup ? conversation.title : dmBot?.name ?? conversation.title}
            </h1>
            <p className="conv-sub">
              {isGroup
                ? t(
                    conversation.replyMode === 'mention'
                      ? 'chat.groupMetaMention'
                      : 'chat.groupMetaAll',
                    { count: participants.length }
                  )
                : dmBot
                  ? t('chat.dmSub')
                  : t('chat.deletedBot')}
            </p>
          </div>
        </div>

        <div className="canvas-actions">
          {isGroup && (
            <ReplyModeToggle mode={conversation.replyMode} onChange={mode => void setReplyMode(mode)} />
          )}
          {isGroup ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => openGroupMembers(conversation.id)}
              title={t('chat.membersTitle')}
            >
              {t('chat.members')}
            </button>
          ) : dmBot ? (
            <>
              <ModelPicker bot={dmBot} />
              <button
                className="icon-btn"
                onClick={() => openBotEditor(dmBot.id)}
                aria-label={t('chat.editBot')}
                title={t('chat.editBot')}
              >
                <IconPencil />
              </button>
            </>
          ) : null}
        </div>
      </header>

      <MessageStream
        conversationId={conversation.id}
        timeline={timeline}
        bots={bots}
        participantCount={participants.length}
      />

      <Composer conversation={conversation} participants={participants} />
    </main>
  )
}

function ReplyModeToggle({
  mode,
  onChange
}: {
  mode: ReplyMode
  onChange: (mode: ReplyMode) => void
}) {
  const { t } = useT()
  return (
    <div
      className={`mode-toggle ${mode === 'all' ? 'mode-all' : 'mode-mention'}`}
      role="group"
      aria-label={t('chat.modeGroupAria')}
    >
      <span className="mode-thumb" aria-hidden="true" />
      <button
        aria-pressed={mode === 'mention'}
        onClick={() => onChange('mention')}
        title={t('chat.modeMentionTitle')}
      >
        {t('app.modeMention')}
      </button>
      <button
        aria-pressed={mode === 'all'}
        onClick={() => onChange('all')}
        title={t('chat.modeAllTitle')}
      >
        {t('app.modeAll')}
      </button>
    </div>
  )
}

function ModelPicker({ bot }: { bot: Bot }) {
  const providers = useStore(s => s.providers)
  const updateBotModel = useStore(s => s.updateBotModel)
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState(bot.providerId)
  const [model, setModel] = useState(bot.model)
  const root = useRef<HTMLDivElement>(null)
  const { t } = useT()

  useEffect(() => {
    if (!open) return
    setProviderId(bot.providerId)
    setModel(bot.model)
  }, [open, bot.providerId, bot.model])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const provider = providers.find(p => p.id === bot.providerId)
  const selectedProvider = providers.find(p => p.id === providerId)

  const save = async (): Promise<void> => {
    if (!providerId || !model.trim() || providers.length === 0) return
    await updateBotModel(bot.id, providerId, model)
    setOpen(false)
  }

  return (
    <div className="model-picker" ref={root}>
      <button
        className="model-picker-btn"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('chat.pickerTitle')}
      >
        <span className="model-picker-provider">{provider?.name ?? t('chat.noProviderSelected')}</span>
        <span className="model-picker-model">{bot.model || t('chat.selectModel')}</span>
        <IconChevron open={open} />
      </button>

      {open && (
        <div className="model-pop" role="dialog" aria-label={t('chat.pickerTitle')}>
          <label className="field">
            <span className="field-label">{t('chat.provider')}</span>
            {providers.length > 0 ? (
              <select
                className="select"
                value={providerId}
                onChange={event => setProviderId(event.target.value)}
              >
                {!providers.some(p => p.id === providerId) && (
                  <option value={providerId}>{provider?.name ?? t('chat.noProviderSelected')}</option>
                )}
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="hint">{t('chat.noProviders')}</p>
            )}
          </label>

          <label className="field">
            <span className="field-label">
{t('chat.model')}
              {selectedProvider && selectedProvider.models.length > 0 && (
                <span className="field-hint">
                  {t('chat.modelCount', { count: selectedProvider.models.length })}
                </span>
              )}
            </span>
            <input
              className="input"
              value={model}
              onChange={event => setModel(event.target.value)}
              placeholder={
                selectedProvider && selectedProvider.models.length > 0
                  ? t('chat.modelPlaceholder')
                  : t('chat.modelFreePlaceholder')
              }
              list="picker-model-options"
              autoFocus
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void save()
                }
              }}
            />
            <datalist id="picker-model-options">
              {(selectedProvider?.models ?? []).map(item => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>

          <div className="model-pop-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
              {t('chat.cancel')}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void save()}
              disabled={!providerId || !model.trim() || providers.length === 0}
            >
              {t('chat.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageStream({
  conversationId,
  timeline,
  bots,
  participantCount
}: {
  conversationId: string
  timeline: Message[]
  bots: Bot[]
  participantCount: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useT()
  const last = timeline.length ? timeline[timeline.length - 1] : null

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversationId, timeline.length, last?.content.length])

  return (
    <div className="stream-wrap" ref={ref}>
      <div className="stream" role="log" aria-live="polite">
        {timeline.length === 0 && (
          <p className="stream-empty">
            {participantCount > 1
              ? t('chat.streamEmptyMulti')
              : participantCount === 1
                ? t('chat.streamEmptySingle')
                : t('chat.streamEmptyNone')}
          </p>
        )}
        {timeline.map(message =>
          message.author === 'user' ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <BotMessage
              key={message.id}
              message={message}
              bot={bots.find(b => b.id === message.botId)}
            />
          )
        )}
      </div>
    </div>
  )
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="msg msg--user">
      <div className="bubble-user">{message.content}</div>
    </div>
  )
}

function BotMessage({ message, bot }: { message: Message; bot?: Bot }) {
  const cancel = useStore(s => s.cancel)
  const { t, te } = useT()
  const [copied, setCopied] = useState(false)
  const streaming = message.status === 'streaming'

  const copy = async (): Promise<void> => {
    try {
      await window.api.copyText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }

  return (
    <div className={`msg${streaming ? ' is-streaming' : ''}`}>
      <BotAvatar bot={bot} size={32} />
      <div className="bot-body">
        <div className="bot-head">
          <span className="bot-name">{bot?.name ?? 'Bot'}</span>
          {bot?.model && <span className="bot-model">{bot.model}</span>}
          {message.content && !streaming && (
            <button
              className="link link--muted msg-copy"
              onClick={() => void copy()}
              title={t('chat.copyTitle')}
            >
              {copied ? t('chat.copied') : t('chat.copy')}
            </button>
          )}
          {streaming && (
            <button className="link link--muted msg-stop" onClick={() => void cancel(message)}>
              {t('chat.stop')}
            </button>
          )}
        </div>

        {message.content ? (
          <div className="md">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        ) : message.status === 'queued' ? (
          <p className="msg-status">{t('chat.queued')}</p>
        ) : message.status === 'streaming' ? (
          <p className="msg-status">{t('chat.streaming')}</p>
        ) : null}

        {message.status === 'error' && (
          <p className="msg-error">{message.error ? te(message.error) : t('chat.errorFallback')}</p>
        )}
        {message.status === 'cancelled' && <p className="msg-note">{t('chat.cancelled')}</p>}
      </div>
    </div>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionedBots(text: string, participants: Bot[]): Bot[] {
  return participants.filter(bot =>
    new RegExp(`@${escapeRegExp(bot.name)}(?=\\s|[，。,.!?！？:：]|$)`).test(text)
  )
}

function Composer({
  conversation,
  participants
}: {
  conversation: Conversation
  participants: Bot[]
}) {
  const [text, setText] = useState('')
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const { t } = useT()
  const send = useStore(s => s.send)
  const busy = useStore(s =>
    (s.messages[conversation.id] ?? EMPTY).some(
      m => m.status === 'streaming' || m.status === 'queued'
    )
  )

  useEffect(() => {
    if (!mention) return
    const onDown = (event: MouseEvent): void => {
      if (!composerRef.current?.contains(event.target as Node)) setMention(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMention(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [mention])

  const isGroup = conversation.kind === 'group'
  const filtered = mention
    ? participants.filter(bot => bot.name.toLowerCase().includes(mention.query.toLowerCase()))
    : []
  const mentioned = isGroup ? mentionedBots(text, participants) : []
  const canSend = Boolean(text.trim()) && !busy && participants.length > 0

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || busy || participants.length === 0) return
    setText('')
    setMention(null)
    void send(trimmed)
  }

  const insertMention = (bot: Bot): void => {
    if (!mention) return
    const caret = ta.current?.selectionStart ?? text.length
    const before = text.slice(0, mention.start)
    const after = text.slice(caret)
    const next = `${before}@${bot.name} ${after}`
    setText(next)
    setMention(null)
    const position = before.length + bot.name.length + 2
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(position, position)
    })
  }

  const triggerMention = (): void => {
    if (!isGroup) return
    const element = ta.current
    const position = element?.selectionStart ?? text.length
    const next = `${text.slice(0, position)}@${text.slice(position)}`
    setText(next)
    setMention({ start: position, query: '' })
    setHighlight(0)
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(position + 1, position + 1)
    })
  }

  const hint = busy
    ? t('chat.streaming')
    : isGroup
      ? conversation.replyMode === 'mention'
        ? mentioned.length > 0
          ? t('chat.replyTo', { names: mentioned.map(bot => bot.name).join(', ') })
          : t('chat.mentionOnly')
        : t('chat.allReply', { count: participants.length })
      : t('chat.enterHint')

  const placeholder = !participants.length
    ? t('chat.noBotsPlaceholder')
    : isGroup
      ? conversation.replyMode === 'mention'
        ? t('chat.mentionPlaceholder')
        : t('chat.groupPlaceholder', { count: participants.length })
      : t('chat.dmPlaceholder')

  return (
    <div className="composer-wrap">
      <div className="composer" ref={composerRef}>
        {mention && filtered.length > 0 && (
          <div className="mention-pop" role="listbox" aria-label={t('chat.mentionListAria')}>
            {filtered.map((bot, index) => (
              <button
                key={bot.id}
                role="option"
                aria-selected={index === highlight}
                className={`mention-item${index === highlight ? ' is-highlight' : ''}`}
                onMouseDown={event => {
                  event.preventDefault()
                  insertMention(bot)
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <BotAvatar bot={bot} size={28} />
                <span className="mention-name">{bot.name}</span>
                <span className="mention-model">{bot.model}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={ta}
          value={text}
          onChange={event => {
            const value = event.target.value
            setText(value)
            const position = event.target.selectionStart ?? value.length
            const match = value.slice(0, position).match(/(?:^|\s)@([^\s@]*)$/)
            if (match) {
              setMention({ start: position - match[1].length - 1, query: match[1] })
              setHighlight(0)
            } else {
              setMention(null)
            }
          }}
          onKeyDown={event => {
            if (mention && filtered.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight(value => (value + 1) % filtered.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight(value => (value - 1 + filtered.length) % filtered.length)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setMention(null)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                insertMention(filtered[highlight])
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={placeholder}
          aria-label={t('chat.messageAria')}
        />

        <div className="composer-bar">
          <div className="composer-left">
            {isGroup && (
              <button
                className="mention-btn"
                onClick={triggerMention}
                aria-label={t('chat.mentionAria')}
                title={t('chat.mentionAria')}
              >
                @
              </button>
            )}
            <span className="composer-hint">{hint}</span>
          </div>
          <button className="btn btn-primary btn-send" onClick={submit} disabled={!canSend}>
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms var(--ease)' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function IconPencil() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
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
