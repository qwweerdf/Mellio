import { useEffect, useRef, type ReactNode } from 'react'
import { gsap, prefersReducedMotion, useGSAP } from './motion'

interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  width?: number
  children: ReactNode
}

export function Sheet({ open, title, onClose, width = 560, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!open || prefersReducedMotion()) return
      gsap.from('.scrim-bg', { autoAlpha: 0, duration: 0.15, ease: 'power2.out' })
      gsap.from('.sheet', { autoAlpha: 0, y: 10, scale: 0.985, duration: 0.2, ease: 'expo.out' })
    },
    { scope: ref, dependencies: [open] }
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="scrim" ref={ref} onMouseDown={onClose}>
      <div className="scrim-bg" aria-hidden="true" />
      <div
        className="sheet"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 className="sheet-title" id="sheet-title">
            {title}
          </h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
