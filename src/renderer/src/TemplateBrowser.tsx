import { useMemo, useState } from 'react'
import {
  AGENT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type AgentTemplate,
  type TemplateCategory
} from './agentTemplates'
import { useT } from './useT'

export function TemplateBrowser({
  onPick,
  onBack
}: {
  onPick: (template: AgentTemplate) => void
  onBack: () => void
}) {
  const { t, lang } = useT()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return AGENT_TEMPLATES.filter(template => {
      if (category !== 'all' && template.category !== category) return false
      if (!q) return true
      return [
        template.name.zh,
        template.name.en,
        template.description.zh,
        template.description.en,
        template.vibe.zh,
        template.vibe.en
      ].some(text => text.toLowerCase().includes(q))
    })
  }, [query, category])

  return (
    <div className="template-browser">
      <div className="template-browser-head">
        <button type="button" className="link link--muted" onClick={onBack}>
          ← {t('bot.templateBack')}
        </button>
        <span className="template-count">{t('bot.templateCount', { count: filtered.length })}</span>
      </div>

      <input
        className="input template-search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder={t('bot.templateSearch')}
        autoFocus
      />

      <div className="template-cats" role="group" aria-label={t('bot.templateTitle')}>
        <button
          type="button"
          className={`template-chip${category === 'all' ? ' is-active' : ''}`}
          onClick={() => setCategory('all')}
        >
          {t('bot.templateAll')}
        </button>
        {TEMPLATE_CATEGORIES.map(item => (
          <button
            key={item.id}
            type="button"
            className={`template-chip${category === item.id ? ' is-active' : ''}`}
            onClick={() => setCategory(item.id)}
          >
            {item.label[lang]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="template-empty">{t('bot.templateEmpty')}</p>
      ) : (
        <div className="template-list">
          {filtered.map(template => (
            <button
              key={template.id}
              type="button"
              className="template-item"
              onClick={() => onPick(template)}
            >
              <span
                className="template-emoji"
                style={{ background: `color-mix(in srgb, ${template.color} 24%, transparent)` }}
                aria-hidden="true"
              >
                {template.emoji}
              </span>
              <span className="template-text">
                <span className="template-name">{template.name[lang]}</span>
                <span className="template-desc">{template.description[lang]}</span>
                <span className="template-vibe">{template.vibe[lang]}</span>
              </span>
              <span className="template-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
