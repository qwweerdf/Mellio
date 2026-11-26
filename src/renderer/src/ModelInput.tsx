// 模型输入框 + 自己控制的下拉列表。
// 不用原生 <datalist>：Electron/Chromium 里点它的箭头经常弹不出来。

import { useEffect, useRef, useState } from 'react'

export function ModelInput({
  value,
  models,
  placeholder,
  onChange,
  onEnter,
  autoFocus
}: {
  value: string
  models: string[]
  placeholder?: string
  onChange: (value: string) => void
  onEnter?: () => void
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

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

  return (
    <div className="model-input" ref={root}>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            setOpen(false)
            onEnter?.()
          } else if (event.key === 'ArrowDown' && models.length > 0) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      />
      {models.length > 0 && (
        <button
          type="button"
          className="model-input-toggle"
          aria-label="Choose model"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
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
            style={{
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 150ms var(--ease)'
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
      {open && models.length > 0 && (
        <div className="model-menu" role="listbox">
          {models.map(model => (
            <button
              type="button"
              key={model}
              role="option"
              aria-selected={model === value}
              className={`model-option${model === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(model)
                setOpen(false)
              }}
            >
              {model}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
