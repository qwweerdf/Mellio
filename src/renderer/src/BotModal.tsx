import { useEffect, useRef, useState } from 'react'
import { AVATARS, AVATAR_META } from '../../../shared/avatars'
import type { BotInput } from '../../../shared/types'
import { PresetAvatar } from './Avatar'
import { gsap, prefersReducedMotion, useGSAP } from './motion'
import { Sheet } from './Sheet'
import { useStore } from './store'

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

  const [form, setForm] = useState<BotInput>(empty(''))
  const [saving, setSaving] = useState(false)
  const grid = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!editor.open || prefersReducedMotion()) return
      const items = grid.current?.querySelectorAll('.avatar-pick')
      if (!items?.length) return
      gsap.from(items, { autoAlpha: 0, y: 6, duration: 0.28, stagger: 0.025, ease: 'power2.out' })
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
    if (!window.confirm(`删除 ${form.name}？会话里的记录会保留。`)) return
    await deleteBot(form.id)
  }

  return (
    <Sheet open={editor.open} title={form.id ? "编辑 Bot" : "新建 Bot"} onClose={close} width={640}>
      <div className="field">
        <div className="field-head">
          <span className="field-label">
            头像 <span className="field-hint">不选就随机</span>
          </span>
          <button type="button" className="link link--muted" onClick={shuffleAvatar}>
            随机一个
          </button>
        </div>
        <div className="avatar-grid" role="group" aria-label="选择头像" ref={grid}>
          {AVATARS.map(avatar => (
            <button
              key={avatar.id}
              type="button"
              className={`avatar-pick${form.avatar === avatar.id ? ' is-selected' : ''}`}
              aria-pressed={form.avatar === avatar.id}
              title={avatar.label}
              onClick={() => update({ avatar: avatar.id, emoji: avatar.emoji, color: avatar.color })}
            >
              <PresetAvatar id={avatar.id} size={50} />
              <span className="avatar-pick-label">{avatar.label}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">名字</span>
        <input
          className="input"
          value={form.name}
          placeholder="比如：代码审查员"
          onChange={event => update({ name: event.target.value })}
          autoFocus
        />
      </label>

      <label className="field">
        <span className="field-label">人设</span>
        <textarea
          className="textarea"
          value={form.systemPrompt}
          rows={3}
          placeholder="先指出风险，再给具体的修改建议。"
          onChange={event => update({ systemPrompt: event.target.value })}
        />
      </label>

      {providers.length === 0 ? (
        <div className="hint">
          还没有配置服务商。
          <button
            className="link"
            style={{ marginLeft: 6 }}
            onClick={() => {
              close()
              setSettingsOpen(true)
            }}
          >
            去添加
          </button>
        </div>
      ) : (
        <div className="form-row">
          <label className="field">
            <span className="field-label">服务商</span>
            <select
              className="select"
              value={form.providerId}
              onChange={event => update({ providerId: event.target.value })}
            >
              {providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.type !== 'fake' && !provider.hasKey ? '（无 Key）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">
              模型
              {provider && provider.models.length > 0 && (
                <span className="field-hint">{provider.models.length} 个可选</span>
              )}
              {provider && provider.type !== 'fake' && provider.models.length === 0 && (
                <span className="field-hint">可在设置里拉取</span>
              )}
            </span>
            <input
              className="input"
              value={form.model}
              placeholder={
                provider && provider.models.length > 0
                  ? '选择或输入模型…'
                  : 'deepseek-chat / grok-4'
              }
              list="bot-model-options"
              onChange={event => update({ model: event.target.value })}
            />
          </label>
          <datalist id="bot-model-options">
            {(provider?.models ?? []).map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>
      )}

      <label className="field">
        <span className="field-label">温度 {form.temperature.toFixed(1)}</span>
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
            删除 Bot
          </button>
        ) : (
          <span />
        )}
        <div className="form-actions-right">
          <button className="btn btn-secondary" onClick={close}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!canSave || saving}
          >
            保存 Bot
          </button>
        </div>
      </div>
    </Sheet>
  )
}
