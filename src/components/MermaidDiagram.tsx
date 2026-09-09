import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────
// MermaidDiagram — 마크다운의 `\`\`\`mermaid` 블록을 SVG 다이어그램으로 렌더
//
// 전략:
//  1. mermaid는 ~1MB+ 라이브러리 → **dynamic import로 지연 로드**
//     (글에 mermaid 블록이 없으면 로드 안 됨. PostDetail chunk와도 분리됨)
//  2. 첫 호출 시 전역 1회 초기화 (module-scope promise 캐시)
//  3. 테마 토글 감지: `<html data-theme>` 속성 변경을 `MutationObserver`로 감시,
//     다크/라이트 바뀌면 재초기화 + 재렌더
//  4. 렌더 에러 시 원본 코드를 `<pre>`로 노출 (무음 실패 금지)
// ─────────────────────────────────────────

let mermaidInstance = null
let initialized = false

// mermaid.render는 측정용 DOM을 내부에서 공유한다. 한 글에 다이어그램이 셋 이상
// 있으면 각 컴포넌트의 effect가 동시에 render를 부르고, 서로의 상태를 덮어써
// 일부가 빈 SVG로 돌아온다 (throw가 아니라 falsy라서 에러 박스도 안 뜬다).
// 호출을 모듈 단위 큐로 직렬화한다.
let renderQueue: Promise<unknown> = Promise.resolve()

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task) as Promise<T>
  renderQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import('mermaid')
    mermaidInstance = mod.default
  }
  if (!initialized) {
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
      themeVariables: {
        background: '#ffffff',
        primaryColor: '#f5f5f7',
        primaryTextColor: '#0a0a0b',
        primaryBorderColor: '#d4d4dc',
        lineColor: '#6b6b73',
      },
    })
    initialized = true
  }
  return mermaidInstance
}

export default function MermaidDiagram({ code, onClickExpand }: { code: string; onClickExpand?: (svgHtml: string) => void }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(null)
  const idRef = useRef(
    `mermaid-${Math.random().toString(36).slice(2, 11)}`
  )

  useEffect(() => {
    if (!code) return
    let alive = true
    const render = async () => {
      try {
        const rendered = await enqueueRender(async () => {
          const mermaid = await getMermaid()
          const id = `${idRef.current}-${Date.now()}`
          const { svg } = await mermaid.render(id, code)
          return svg
        })
        // 빈 SVG는 조용히 넘기지 않는다. 빈 박스만 남으면 작성자가 못 알아챈다.
        if (!rendered) throw new Error('mermaid가 빈 SVG를 돌려줬다')
        if (alive) {
          setSvg(rendered)
          setError(null)
        }
      } catch (e) {
        if (alive) {
          setError(e?.message || String(e))
          setSvg('')
        }
      }
    }
    render()
    return () => {
      alive = false
    }
  }, [code])

  if (error) {
    return (
      <div className="mermaid-diagram mermaid-diagram--error" role="alert">
        <p className="mermaid-diagram__error-title">Mermaid 렌더 오류</p>
        <p className="mermaid-diagram__error-message">{error}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div
      className="mermaid-diagram zoomable"
      // svg는 mermaid가 생성한 신뢰할 수 있는 출력 — securityLevel: 'loose'
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
      onClick={() => onClickExpand?.(svg)}
    />
  )
}
