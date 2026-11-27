import { useEffect, useRef, useState } from 'react'
import type { CollaborationMode, GroupSettings } from '../../../shared/types'
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
  const clearConversation = useStore(s => s.clearConversation)

  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<CollaborationMode>('parallel')
  const [leadBotId, setLeadBotId] = useState('')
  const [maxRejections, setMaxRejections] = useState(2)
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
      setMode(editing?.collaborationMode ?? 'parallel')
      setLeadBotId(editing?.leadBotId ?? '')
      setMaxRejections(editing?.maxRejections ?? 2)
    } else {
      setTitle('')
      setSelected(new Set())
      setMode('parallel')
      setLeadBotId('')
      setMaxRejections(2)
    }
    setBusy(false)
    // 只在打开或切换模式时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.open, sheet.mode, sheet.conversationId])

  useEffect(() => {
    if (mode !== 'team') return
    if (selected.size === 0) {
      if (leadBotId) setLeadBotId('')
      return
    }
    if (!selected.has(leadBotId)) setLeadBotId(Array.from(selected)[0])
  }, [mode, selected, leadBotId])

  const toggle = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearHistory = async (): Promise<void> => {
    if (!editing) return
    if (!window.confirm(t('group.clearHistoryConfirm', { title: editing.title }))) return
    await clearConversation(editing.id)
    close()
  }

  const submit = async (): Promise<void> => {
    if (selected.size < 2 || busy) return
    if (mode === 'team' && !selected.has(leadBotId)) return
    const settings: GroupSettings = { mode, leadBotId: mode === 'team' ? leadBotId : undefined, maxRejections }
    setBusy(true)
    if (sheet.mode === 'create') await createGroup(title, [...selected], settings)
    else await saveMembers([...selected], settings)
    setBusy(false)
  }

  const selectedBots = bots.filter(bot => selected.has(bot.id))

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
          <p className="sheet-note">{t('group.createNote')}</p>
        </>
      ) : (
        <p className="sheet-note">{t('group.membersNote', { title: editing?.title ?? 'Group' })}</p>
      )}

      <div className="field">
        <span className="field-label">{t('group.collaboration')}</span>
        <div className="segmented">
          <button
            type="button"
            className={mode === 'parallel' ? 'is-active' : ''}
            aria-pressed={mode === 'parallel'}
            onClick={() => setMode('parallel')}
          >
            {t('group.modeParallel')}
          </button>
          <button
            type="button"
            className={mode === 'team' ? 'is-active' : ''}
            aria-pressed={mode === 'team'}
            onClick={() => setMode('team')}
          >
            {t('group.modeTeam')}
          </button>
        </div>
        <span className="hint">
          {mode === 'team' ? t('group.teamHint') : t('group.parallelHint')}
        </span>
      </div>

      {mode === 'team' && (
        <>
          <label className="field">
            <span className="field-label">{t('group.lead')}</span>
            <select
              className="select"
              value={leadBotId}
              onChange={event => setLeadBotId(event.target.value)}
            >
              <option value="">{t('group.leadPlaceholder')}</option>
              {selectedBots.map(bot => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
            <span className="hint">{t('group.leadHint')}</span>
          </label>

          <label className="field">
            <span className="field-label">{t('group.maxRejections', { count: maxRejections })}</span>
            <input
              className="input"
              type="number"
              min={0}
              max={5}
              value={maxRejections}
              onChange={event => setMaxRejections(Math.max(0, Math.min(5, Number(event.target.value) || 0)))}
            />
            <span className="hint">{t('group.maxRejectionsHint')}</span>
          </label>
        </>
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

      {sheet.mode === 'members' && editing && (
        <div className="form-danger-row">
          <button type="button" className="link link--danger" onClick={() => void clearHistory()}>
            {t('group.clearHistory')}
          </button>
        </div>
      )}

      <div className="form-actions">
        <span className={`form-status${selected.size < 2 || (mode === 'team' && !selected.has(leadBotId)) ? ' form-status--error' : ''}`}>
          {selected.size < 2
            ? t('group.min')
            : mode === 'team' && !selected.has(leadBotId)
              ? t('group.teamNeedsLead')
              : t('group.selected', { count: selected.size })}
        </span>
        <div className="form-actions-right">
          <button className="btn btn-secondary" onClick={close}>
            {t('group.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={selected.size < 2 || (mode === 'team' && !selected.has(leadBotId)) || busy}
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
