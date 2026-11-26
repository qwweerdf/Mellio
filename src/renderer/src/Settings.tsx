import { useState } from 'react'
import type { ProviderView } from '../../../shared/types'
import { Sheet } from './Sheet'
import { errText, useStore } from './store'

const blank = () => ({ id: '', name: '', baseUrl: '', apiKey: '' })

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

  const [form, setForm] = useState(blank())
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({ text: '', tone: 'info' })
  const [busy, setBusy] = useState(false)

  const edit = (provider: ProviderView): void => {
    setForm({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKey: '' })
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
        type: 'openai',
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined
      })
      setForm(blank())
      setStatus({ text: '已保存', tone: 'info' })
    } catch (err) {
      setStatus({ text: errText(err), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const test = async (id: string): Promise<void> => {
    setBusy(true)
    setStatus({ text: '正在测试…', tone: 'info' })
    try {
      const result = await testProvider(id)
      setStatus({ text: result, tone: 'info' })
    } catch (err) {
      setStatus({ text: errText(err), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const pullModels = async (provider: ProviderView): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus({ text: '正在拉取模型…', tone: 'info' })
    try {
      const models = await fetchModels(provider.id)
      setStatus({ text: `已保存 ${models.length} 个模型`, tone: 'info' })
      showToast(`已拉取 ${models.length} 个模型`)
    } catch (err) {
      setStatus({ text: errText(err), tone: 'error' })
      showToast(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (provider: ProviderView): Promise<void> => {
    if (!window.confirm(`删除服务商「${provider.name}」？使用它的 Bot 需要重新选择。`)) return
    try {
      await removeProvider(provider.id)
      if (form.id === provider.id) setForm(blank())
    } catch (err) {
      setStatus({ text: errText(err), tone: 'error' })
    }
  }

  return (
    <Sheet open={open} title="设置" onClose={() => setOpen(false)} width={640}>
      <p className="sheet-note">
        支持任何 OpenAI 兼容服务：OpenAI、DeepSeek、OpenRouter、xAI、Ollama。API Key 保存在系统钥匙串，只在本机使用。保存后点「拉取模型」，创建 Bot 时就能直接选模型。
      </p>

      {providers.length > 0 && (
        <div className="provider-list">
          {providers.map(provider => (
            <div className="provider-row" key={provider.id}>
              <div className="provider-info">
                <p className="provider-name">
                  {provider.name}
                  {provider.type === 'fake' ? null : provider.hasKey ? (
                    <span className="tag">Key ✓</span>
                  ) : (
                    <span className="tag tag--danger">无 Key</span>
                  )}
                  {provider.type !== 'fake' && provider.models.length > 0 && (
                    <span className="tag">{provider.models.length} 个模型</span>
                  )}
                </p>
                <p className="provider-url">
                  {provider.type === 'fake' ? '不联网的演示模式' : provider.baseUrl || '未填 Base URL'}
                </p>
              </div>
              {provider.type !== 'fake' && (
                <div className="provider-actions">
                  <button className="link" onClick={() => void pullModels(provider)}>
                    拉取模型
                  </button>
                  <button className="link" onClick={() => void test(provider.id)}>
                    测试
                  </button>
                  <button className="link" onClick={() => edit(provider)}>
                    编辑
                  </button>
                  <button className="link link--danger" onClick={() => void remove(provider)}>
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="form-section">
        <p className="section-label">{form.id ? '编辑服务商' : '添加服务商'}</p>

        <div className="form-row">
          <label className="field">
            <span className="field-label">名称</span>
            <input
              className="input"
              value={form.name}
              placeholder="DeepSeek"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              className="input"
              value={form.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
            />
          </label>
        </div>

        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">API Key</span>
          <input
            className="input"
            type="password"
            value={form.apiKey}
            placeholder={form.id ? '留空保持不变' : 'sk-…'}
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
                取消编辑
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={!form.name.trim() || busy}
            >
              保存服务商
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
