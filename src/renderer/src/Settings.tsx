import { useState } from 'react'
import type { ProviderType, ProviderView } from '../../../shared/types'
import type { Lang } from './i18n'
import { Sheet } from './Sheet'
import { errText, useStore } from './store'
import { useT } from './useT'

interface ProviderForm {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  type: ProviderType
}

const blank = (): ProviderForm => ({ id: '', name: '', baseUrl: '', apiKey: '', type: 'openai' })

type Tone = 'info' | 'error'

export function SettingsModal() {
  const open = useStore(s => s.settingsOpen)
  const setOpen = useStore(s => s.setSettingsOpen)
  const providers = useStore(s => s.providers)
  const saveProvider = useStore(s => s.saveProvider)
  const removeProvider = useStore(s => s.removeProvider)
  const testProvider = useStore(s => s.testProvider)
  const fetchModels = useStore(s => s.fetchModels)
  const showToast = useStore(s => s.showToast)
  const setLang = useStore(s => s.setLang)
  const { t, lang, te } = useT()

  const [form, setForm] = useState(blank())
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({ text: '', tone: 'info' })
  const [busy, setBusy] = useState(false)

  const edit = (provider: ProviderView): void => {
    setForm({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKey: '', type: provider.type })
    setStatus({ text: '', tone: 'info' })
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim() || busy) return
    setBusy(true)
    setStatus({ text: '', tone: 'info' })
    try {
      await saveProvider({
        id: form.id || undefined,
        name: form.name,
        type: form.type,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined
      })
      setForm(blank())
      setStatus({ text: t('settings.saved'), tone: 'info' })
    } catch (err) {
      setStatus({ text: te(errText(err)), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const test = async (id: string): Promise<void> => {
    setBusy(true)
    setStatus({ text: t('settings.testing'), tone: 'info' })
    try {
      const result = await testProvider(id)
      setStatus({ text: te(result), tone: 'info' })
    } catch (err) {
      setStatus({ text: te(errText(err)), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const pullModels = async (provider: ProviderView): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus({ text: t('settings.pulling'), tone: 'info' })
    try {
      const models = await fetchModels(provider.id)
      setStatus({ text: t('settings.pulled', { count: models.length }), tone: 'info' })
      showToast(t('settings.toastPulled', { count: models.length }))
    } catch (err) {
      setStatus({ text: te(errText(err)), tone: 'error' })
      showToast(te(errText(err)))
    } finally {
      setBusy(false)
    }
  }

  const applyDeepSeek = (): void => {
    setForm(f => ({
      ...f,
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      type: 'deepseek'
    }))
    setStatus({ text: '', tone: 'info' })
  }

  const remove = async (provider: ProviderView): Promise<void> => {
    if (!window.confirm(t('settings.deleteConfirm', { name: provider.name }))) return
    try {
      await removeProvider(provider.id)
      if (form.id === provider.id) setForm(blank())
    } catch (err) {
      setStatus({ text: te(errText(err)), tone: 'error' })
    }
  }

  return (
    <Sheet open={open} title={t('settings.title')} onClose={() => setOpen(false)} width={640}>
      <p className="sheet-note">
        {t('settings.note')}
      </p>

      <label className="field lang-field">
        <span className="field-label">{t('settings.language')}</span>
        <select
          className="select"
          value={lang}
          onChange={event => setLang(event.target.value as Lang)}
        >
          <option value="zh">简体中文</option>
          <option value="en">English</option>
        </select>
      </label>

      {providers.length > 0 && (
        <div className="provider-list">
          {providers.map(provider => (
            <div className="provider-row" key={provider.id}>
              <div className="provider-info">
                <p className="provider-name">
                  {provider.name}
                  {provider.type === 'fake' ? null : provider.hasKey ? (
                    <span className="tag">{t('settings.hasKey')}</span>
                  ) : (
                    <span className="tag tag--danger">{t('settings.noKey')}</span>
                  )}
                  {provider.type !== 'fake' && provider.models.length > 0 && (
                    <span className="tag">{t('settings.modelsCount', { count: provider.models.length })}</span>
                  )}
                  {provider.type === 'deepseek' && (
                    <span className="tag">{t('settings.webCapable')}</span>
                  )}
                </p>
                <p className="provider-url">
                  {provider.type === 'fake' ? t('settings.fakeDesc') : provider.baseUrl || t('settings.urlFallback')}
                </p>
              </div>
              {provider.type !== 'fake' && (
                <div className="provider-actions">
                  <button className="link" onClick={() => void pullModels(provider)}>
                    {t('settings.fetch')}
                  </button>
                  <button className="link" onClick={() => void test(provider.id)}>
                    {t('settings.test')}
                  </button>
                  <button className="link" onClick={() => edit(provider)}>
                    {t('settings.edit')}
                  </button>
                  <button className="link link--danger" onClick={() => void remove(provider)}>
                    {t('settings.delete')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="form-section">
        <p className="section-label">{form.id ? t('settings.editProvider') : t('settings.add')}</p>

        <div className="preset-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={applyDeepSeek}>
            {t('settings.deepseekPreset')}
          </button>
          <span className="field-hint">{t('settings.deepseekHint')}</span>
        </div>

        <div className="form-row">
          <label className="field">
            <span className="field-label">{t('settings.name')}</span>
            <input
              className="input"
              value={form.name}
              placeholder={t('settings.namePlaceholder')}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">{t('settings.baseUrl')}</span>
            <input
              className="input"
              value={form.baseUrl}
              placeholder={t('settings.basePlaceholder')}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
            />
          </label>
        </div>

        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">{t('settings.apiKey')}</span>
          <input
            className="input"
            type="password"
            value={form.apiKey}
            placeholder={form.id ? t('settings.keyKeep') : t('settings.keyPlaceholder')}
            onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
          />
        </label>

        <p className={`form-status${status.tone === 'error' ? ' form-status--error' : ''}`} role="status">
          {status.text}
        </p>

        <div className="form-actions">
          <span />
          <div className="form-actions-right">
            {form.id && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setForm(blank())
                  setStatus({ text: '', tone: 'info' })
                }}
              >
                {t('settings.cancelEdit')}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={!form.name.trim() || busy}
            >
              {t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
