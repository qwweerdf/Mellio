// Bot 回复的 Markdown：使用 Astryx Markdown，保留 Mermaid 图表。
// 流式期间 Mermaid 先按代码显示，结束后再渲染。

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { Markdown as AstryxMarkdown } from '@astryxdesign/core/Markdown'

export function Markdown({ content, streaming }: { content: string; streaming?: boolean }) {
  const components = useMemo(
    () => ({
      code: ({ code, language }: { code: string; language?: string }) => {
        const chart = code.trim()
        if (language === 'mermaid') {
          if (!streaming && chart) return <Mermaid chart={chart} />
          return <CodeBlock code={chart} language="plaintext" isWrapped />
        }
        return <CodeBlock code={code} language={language || 'plaintext'} isWrapped />
      }
    }),
    [streaming]
  )

  return (
    <AstryxMarkdown
      className="md-astryx"
      density="default"
      isStreaming={false}
      headingLevelStart={2}
      contentWidth="100%"
      autolink="gfm"
      components={components}
    >
      {content}
    </AstryxMarkdown>
  )
}

function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const [failed, setFailed] = useState(false)
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    const renderId = `mmd-${id}-${++seq.current}`

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'base',
          fontFamily: 'Funnel Sans Variable, PingFang SC, Microsoft YaHei, sans-serif',
          themeVariables: {
            background: '#141414',
            primaryColor: '#242424',
            primaryTextColor: '#f2f2f2',
            primaryBorderColor: '#dafa9c',
            secondaryColor: '#1a1a1a',
            secondaryTextColor: '#f2f2f2',
            secondaryBorderColor: '#3a3a3a',
            tertiaryColor: '#1a1a1a',
            tertiaryTextColor: '#f2f2f2',
            tertiaryBorderColor: '#3a3a3a',
            mainBkg: '#242424',
            nodeBorder: '#dafa9c',
            clusterBkg: '#161616',
            clusterBorder: '#3a3a3a',
            lineColor: '#9a9a9a',
            textColor: '#f2f2f2',
            titleColor: '#f2f2f2',
            edgeLabelBackground: '#141414',
            pie1: '#dafa9c',
            pie2: '#a8d47f',
            pie3: '#7f9f62',
            pie4: '#e8e2b8',
            pie5: '#8b8b8b',
            pie6: '#c4c4a0',
            pie7: '#5f7a4a',
            pie8: '#f0edc9',
            pieTitleTextColor: '#f2f2f2',
            pieSectionTextColor: '#0f0f0f',
            pieLegendTextColor: '#f2f2f2',
            pieStrokeColor: '#141414',
            pieOuterStrokeColor: '#3a3a3a'
          }
        })
        const { svg } = await mermaid.render(renderId, chart)
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (failed) {
    return (
      <pre className="md-mermaid-fallback">
        <code>{chart}</code>
      </pre>
    )
  }
  return <div className="md-mermaid" ref={ref} aria-label="Diagram" />
}
