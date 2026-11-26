import { useEffect, useRef, useState } from 'react'
import { AVATARS, AVATAR_META } from '../../../shared/avatars'
import type { BotInput } from '../../../shared/types'
import { PresetAvatar } from './Avatar'
import { ModelInput } from './ModelInput'
import { gsap, prefersReducedMotion, revealSafety, useGSAP } from './motion'
import { Sheet } from './Sheet'
import { useStore } from './store'
import { useT } from './useT'

const empty = (providerId: string): BotInput => ({
  name: '',
  avatar: '',
  emoji: '',
  color: '',
  systemPrompt: '',
  providerId,
  model: '',
  temperature: 0.7
})

function randomAvatar(): (typeof AVATARS)[number] {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)]
}

function withRandomAvatar(input: BotInput): BotInput {
  if (input.avatar && AVATAR_META[input.avatar]) return input
  const pick = randomAvatar()
  return { ...input, avatar: pick.id, emoji: pick.emoji, color: pick.color }
}

export function BotModal() {
  const editor = useStore(s => s.botEditor)
  const bots = useStore(s => s.bots)
  const providers = useStore(s => s.providers)
  const close = useStore(s => s.closeBotEditor)
  const saveBot = useStore(s => s.saveBot)
  const deleteBot = useStore(s => s.deleteBot)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const { t, lang } = useT()

  const [form, setForm] = useState<BotInput>(empty(''))
  const [saving, setSaving] = useState(false)
  const grid = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!editor.open || prefersReducedMotion()) return
      const items = grid.current?.querySelectorAll('.avatar-pick')
      if (!items?.length) return
      gsap.from(items, { autoAlpha: 0, y: 6, duration: 0.28, stagger: 0.025, ease: 'power2.out' })
      return revealSafety(grid.current, '.avatar-pick', 1200)
    },
    { scope: grid, dependencies: [editor.open] }
  )

  useEffect(() => {
    if (!editor.open) return
    const existing = editor.botId ? bots.find(b => b.id === editor.botId) : undefined
    setForm(existing ? { ...existing } : empty(providers[0]?.id ?? ''))
    setSaving(false)
    // 只在打开时初始化表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.open, editor.botId])

  const update = (patch: Partial<BotInput>): void => setForm(f => ({ ...f, ...patch }))
  const canSave = Boolean(form.name.trim() && form.providerId && form.model.trim())
  const provider = providers.find(p => p.id === form.providerId)

  const shuffleAvatar = (): void => {
    const pick = randomAvatar()
    update({ avatar: pick.id, emoji: pick.emoji, color: pick.color })
  }

  const submit = async (): Promise<void> => {
    if (!canSave || saving) return
    setSaving(true)
    await saveBot(withRandomAvatar(form))
    setSaving(false)
  }

  const remove = async (): Promise<void> => {
    if (!form.id) return
    if (!window.confirm(t('bot.deleteConfirm', { name: form.name }))) return
    await deleteBot(form.id)
  }

  return (
    <Sheet open={editor.open} title={form.id ? t('bot.editTitle') : t('bot.newTitle')} onClose={close} width={640}>
      <div className="field">
        <div className="field-head">
          <span className="field-label">
            {t('bot.avatar')} <span className="field-hint">{t('bot.avatarHint')}</span>
          </span>
          <button type="button" className="link link--muted" onClick={shuffleAvatar}>
            {t('bot.random')}
          </button>
        </div>
        <div className="avatar-grid" role="group" aria-label={t('bot.avatarAria')} ref={grid}>
          {AVATARS.map(avatar => (
            <button
              key={avatar.id}
              type="button"
              className={`avatar-pick${form.avatar === avatar.id ? ' is-selected' : ''}`}
              aria-pressed={form.avatar === avatar.id}
              title={lang === 'en' ? avatar.labelEn : avatar.label}
              onClick={() => update({ avatar: avatar.id, emoji: avatar.emoji, color: avatar.color })}
            >
              <PresetAvatar id={avatar.id} size={50} />
              <span className="avatar-pick-label">{lang === 'en' ? avatar.labelEn : avatar.label}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">{t('bot.name')}</span>
        <input
          className="input"
          value={form.name}
          placeholder={t('bot.namePlaceholder')}
          onChange={event => update({ name: event.target.value })}
          autoFocus
        />
      </label>

      <label className="field">
        <span className="field-label">{t('bot.persona')}</span>
        <textarea
          className="textarea"
          value={form.systemPrompt}
          rows={3}
          placeholder={t('bot.personaPlaceholder')}
          onChange={event => update({ systemPrompt: event.target.value })}
        />
        <span className="hint">{t('bot.personaNote')}</span>
      </label>

      {providers.length === 0 ? (
        <div className="hint">
          {t('bot.noProvider')}
          <button
            className="link"
            style={{ marginLeft: 6 }}
            onClick={() => {
              close()
              setSettingsOpen(true)
            }}
          >
            {t('bot.goAdd')}
          </button>
        </div>
      ) : (
        <div className="form-row">
          <label className="field">
            <span className="field-label">{t('bot.provider')}</span>
            <select
              className="select"
              value={form.providerId}
              onChange={event => update({ providerId: event.target.value })}
            >
              {providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.type !== 'fake' && !provider.hasKey ? t('bot.noKey') : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">
{t('bot.model')}
              {provider && provider.models.length > 0 && (
                <span className="field-hint">
                  {t('bot.modelCount', { count: provider.models.length })}
                </span>
              )}
              {provider && provider.type !== 'fake' && provider.models.length === 0 && (
                <span className="field-hint">{t('bot.modelFetchHint')}</span>
              )}
            </span>
            <ModelInput
              value={form.model}
              models={provider?.models ?? []}
              placeholder={
                provider && provider.models.length > 0
                  ? t('bot.modelPlaceholder')
                  : t('bot.modelFreePlaceholder')
              }
              onChange={model => update({ model })}
            />
          </label>
        </div>
      )}

      <label className="field">
        <span className="field-label">{t('bot.temperature', { value: form.temperature.toFixed(1) })}</span>
        <input
          className="range"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={form.temperature}
          onChange={event => update({ temperature: Number(event.target.value) })}
        />
      </label>

      <div className="form-actions">
        {form.id ? (
          <button className="link link--danger" onClick={() => void remove()}>
            {t('bot.delete')}
          </button>
        ) : (
          <span />
        )}
        <div className="form-actions-right">
          <button className="btn btn-secondary" onClick={close}>
            {t('bot.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!canSave || saving}
          >
            {t('bot.save')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
