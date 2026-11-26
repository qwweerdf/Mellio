import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// 窗口被遮挡时浏览器会暂停 rAF，GSAP 入场可能停在半途把控件留在 opacity:0。
// 到时强制结束这些 tween 并清掉内联隐藏样式，保证界面永远可用。
export function revealSafety(scope: HTMLElement | null, selector: string, delay = 1800): () => void {
  const timer = window.setTimeout(() => {
    if (!scope) return
    const targets = Array.from(scope.querySelectorAll<HTMLElement>(selector))
    if (!targets.length) return
    gsap.killTweensOf(targets)
    for (const el of targets) {
      el.style.removeProperty('opacity')
      el.style.removeProperty('visibility')
      el.style.removeProperty('transform')
    }
  }, delay)
  return () => window.clearTimeout(timer)
}

export { gsap, useGSAP }
