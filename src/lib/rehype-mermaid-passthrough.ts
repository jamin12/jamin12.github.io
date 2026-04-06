// ─────────────────────────────────────────
// rehype-mermaid-passthrough
//
// `<pre><code class="language-mermaid">...</code></pre>` 구조를
// `<div class="mermaid-block" data-mermaid-code="...">` 플레이스홀더로 교체.
//
// **shiki보다 먼저 실행되어야 함** — 이 플러그인이 돌아간 뒤엔 mermaid 코드블록이
// 사라지고 없으므로, 이후 shiki는 "mermaid"라는 이름을 보지 못함.
//
// react-markdown의 components.div 오버라이드가 이 div를 감지해 `<MermaidDiagram>`
// 컴포넌트로 렌더한다. 원본 mermaid 코드는 `data-mermaid-code` 속성에 보존.
//
// 왜 remark 레벨이 아니라 rehype 레벨인가:
// - remark의 `code` 노드를 직접 바꾸려면 node type을 바꾸거나 hName 어썰을 써야 하는데,
//   둘 다 react-markdown + rehype 체인에서 엣지 케이스가 많음
// - hast 레벨에서 pre>code.language-mermaid 패턴을 매칭하는 게 가장 안전
// ─────────────────────────────────────────

import { visit } from 'unist-util-visit'

export function rehypeMermaidPassthrough() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || index == null || !parent) return
      const codeChild = node.children?.find(
        (c) => c.type === 'element' && c.tagName === 'code'
      )
      if (!codeChild) return
      const classes = codeChild.properties?.className
      const classList = Array.isArray(classes) ? classes : []
      if (!classList.includes('language-mermaid')) return

      // <code> 내부 텍스트 노드를 전부 이어붙여 원본 코드 복원
      const code = extractText(codeChild).trim()

      // <pre>를 placeholder <div>로 교체
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['mermaid-block'],
          'data-mermaid-code': code,
        },
        children: [],
      }

      // visit 스킵 — 교체된 노드를 다시 순회하지 않도록 index 유지
      return ['skip', index]
    })
  }
}

function extractText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.value || ''
  if (Array.isArray(node.children)) {
    return node.children.map(extractText).join('')
  }
  return ''
}
