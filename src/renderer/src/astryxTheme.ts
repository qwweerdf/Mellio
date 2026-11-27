import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

// 把 Astryx 的组件 token 对齐到 Mellio 的 soot + lime 设计系统。
export const mellioTheme = defineTheme({
  name: 'mellio',
  extends: neutralTheme,
  tokens: {
    '--color-background-body': '#0f0f0f',
    '--color-background-surface': '#1a1a1a',
    '--color-background-card': '#1a1a1a',
    '--color-background-muted': '#141414',
    '--color-text-primary': '#f2f2f2',
    '--color-text-secondary': '#8f8f8f',
    '--color-text-accent': '#dafa9c',
    '--color-accent': '#dafa9c',
    '--color-on-accent': '#0f0f0f',
    '--color-border': 'rgba(255,255,255,0.12)',
    '--color-border-emphasized': 'rgba(255,255,255,0.22)',
    '--radius-container': '12px',
    '--radius-element': '8px',
    '--radius-inner': '6px'
  },
  typography: {
    body: {
      family: 'Funnel Sans Variable',
      fallbacks: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    },
    heading: {
      family: 'Funnel Display Variable',
      fallbacks: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    },
    code: {
      family: 'DM Mono',
      fallbacks: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    }
  },
  motion: { tempo: 0.9, character: 'crisp' }
})
