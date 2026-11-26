// Bot 回复的 Markdown 渲染：GFM 表格 + Mermaid 图表（流式期间先显示源码）。

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ content, streaming }: { content: string; streaming?: boolean }) {
  const components = useMemo<Components>(
    () => ({
      table: props => (
        <div className="md-table">
          <table {...props} />
        </div>
      ),
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      pre: ({ children }) => {
        const child = Children.toArray(children)[0]
        if (isValidElement(child)) {
          const props = child.props as { className?: string; children?: ReactNode }
          const lang = /language-([\w-]+)/.exec(props.className ?? '')?.[1]
          if (lang === 'mermaid') {
            const chart = String(props.children ?? '').trim()
            if (!streaming && chart) return <Mermaid chart={chart} />
          }
        }
        return <pre>{children}</pre>
      }
    }),
    [streaming]
  )

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
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
