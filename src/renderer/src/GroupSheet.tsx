import { useEffect, useRef, useState } from 'react'
import { BotAvatar } from './Avatar'
import { gsap, prefersReducedMotion, revealSafety, useGSAP } from './motion'
import { Sheet } from './Sheet'
import { useStore } from './store'
import { useT } from './useT'

export function GroupSheet() {
  const sheet = useStore(s => s.groupSheet)
  const bots = useStore(s => s.bots)
  const conversations = useStore(s => s.conversations)
  const close = useStore(s => s.closeGroupSheet)
  const createGroup = useStore(s => s.createGroupFromSheet)
  const saveMembers = useStore(s => s.saveGroupMembers)

  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { t } = useT()

  useGSAP(
    () => {
      if (!sheet.open || prefersReducedMotion()) return
      const rows = listRef.current?.querySelectorAll('.pick-row')
      if (!rows?.length) return
      gsap.from(rows, { autoAlpha: 0, y: 5, duration: 0.26, stagger: 0.025, ease: 'power2.out' })
      return revealSafety(listRef.current, '.pick-row', 1200)
    },
    { scope: listRef, dependencies: [sheet.open, sheet.mode] }
  )

  const editing =
    sheet.mode === 'members' ? conversations.find(c => c.id === sheet.conversationId) : undefined

  useEffect(() => {
    if (!sheet.open) return
    if (sheet.mode === 'members') {
      setTitle(editing?.title ?? '')
      setSelected(new Set(editing?.botIds ?? []))
    } else {
      setTitle('')
      setSelected(new Set())
    }
    setBusy(false)
    // 只在打开或切换模式时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.open, sheet.mode, sheet.conversationId])

  const toggle = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (selected.size < 2 || busy) return
    setBusy(true)
    if (sheet.mode === 'create') await createGroup(title, [...selected])
    else await saveMembers([...selected])
    setBusy(false)
  }

  return (
    <Sheet
      open={sheet.open}
      title={sheet.mode === 'create' ? t('group.createTitle') : t('group.membersTitle')}
      onClose={close}
      width={560}
    >
      {sheet.mode === 'create' ? (
        <>
          <label className="field">
            <span className="field-label">{t('group.name')}</span>
            <input
              className="input"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder={t('group.namePlaceholder')}
              autoFocus
            />
          </label>
          <p className="sheet-note">
            {t('group.createNote')}
          </p>
        </>
      ) : (
        <p className="sheet-note">{t('group.membersNote', { title: editing?.title ?? 'Group' })}</p>
      )}

      <div className="field">
        <span className="field-label">{t('group.pick')}</span>
        <div className="pick-list" ref={listRef}>
          {bots.map(bot => {
            const on = selected.has(bot.id)
            return (
              <button
                key={bot.id}
                type="button"
                className={`pick-row${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(bot.id)}
              >
                <BotAvatar bot={bot} size={34} />
                <span className="pick-text">
                  <span className="pick-name">{bot.name}</span>
                  <span className="pick-model">{bot.model || t('bot.noModel')}</span>
                </span>
                <span className={`pick-check${on ? ' is-on' : ''}`} aria-hidden="true">
                  {on ? <IconCheck /> : null}
                </span>
              </button>
            )
          })}
          {bots.length === 0 && <p className="rail-empty">{t('group.noBots')}</p>}
        </div>
      </div>

      <div className="form-actions">
        <span className={`form-status${selected.size < 2 ? ' form-status--error' : ''}`}>
          {selected.size < 2 ? t('group.min') : t('group.selected', { count: selected.size })}
        </span>
        <div className="form-actions-right">
          <button className="btn btn-secondary" onClick={close}>
            {t('group.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={selected.size < 2 || busy}
          >
            {sheet.mode === 'create' ? t('group.create') : t('group.saveMembers')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}
