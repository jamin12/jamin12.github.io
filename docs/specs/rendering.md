# 렌더링 (Rendering)

> 작성일: 2026-04-05

---

## 1. 역할

콘텐츠 파이프라인이 만든 Post 객체의 **마크다운 본문(body)** 을 React 요소 트리로 변환하는 계층이다.

블로그는 "읽는 경험"이 전부이므로, 이 계층의 품질이 블로그 전체의 품질을 결정한다. 특히 **본문 타이포그래피**와 **코드블록**은 개발 블로그의 핵심이다.

---

## 2. 렌더러 선택

### 후보 비교

| 후보 | 장점 | 단점 |
|------|------|------|
| **react-markdown** | 가벼움, React 친화, 컴포넌트 override 쉬움 | MDX 기능(JSX 삽입) 없음 |
| **MDX** | 마크다운 안에 React 컴포넌트 삽입 가능 | 빌드 복잡도↑, 글 파일이 순수 md가 아님 |
| **marked + 커스텀** | 최대 제어 | 직접 구현 부담 |

### 결정: react-markdown (+ remark/rehype 플러그인)

이유:
- 글 파일은 **순수 마크다운**이어야 한다. 다른 도구(VS Code 프리뷰, GitHub 렌더링 등)와 호환되고, 나중에 엔진을 바꿔도 콘텐츠 이식성이 유지된다
- MDX의 "글 안에 컴포넌트" 기능은 매력적이지만, 블로그 규모에서는 오버엔지니어링. 필요해지면 나중에 전환
- react-markdown은 요소별 `components` prop으로 스타일/동작을 세밀하게 커스터마이징 가능

### 플러그인 구성

| 플러그인 | 역할 |
|---------|------|
| `remark-gfm` | GitHub Flavored Markdown (표, 체크리스트, 취소선) |
| `remark-math` | `$...$` / `$$...$$`를 math 노드로 파싱 |
| `rehype-slug` | 헤딩에 id 자동 부여 (TOC·앵커링크용) |
| `rehype-autolink-headings` | 헤딩 옆 앵커 링크 자동 삽입 |
| `rehype-katex` | math 노드를 KaTeX로 렌더링 (`katex/dist/katex.min.css` 필요) |
| `rehype-mermaid-passthrough` (로컬) | ` ```mermaid` 코드블록을 `<div class="mermaid-block">` 플레이스홀더로 교체. **shiki보다 먼저** 실행되어야 함 |
| `@shikijs/rehype` | 코드블록 신택스 하이라이팅 |

### Mermaid 다이어그램 (2026-04 4차 추가)

5개 글(`async-taskdecorator-faq`, `pact_consumer_test`, `pact_provider_test`, `network-web`, `network-device-architecture`)에 sequenceDiagram / flowchart / graph 형태의 mermaid 코드가 이관돼 있어 4차 디자인 반복 중 사용자 피드백으로 렌더링 지원 추가.

**처리 흐름**

1. **rehype-mermaid-passthrough** (로컬 플러그인, `src/lib/rehype-mermaid-passthrough.js`): hast 트리에서 `<pre><code class="language-mermaid">` 패턴을 찾아 `<div class="mermaid-block" data-mermaid-code="...">` 로 교체. shiki 체인 **앞에** 두어 shiki가 mermaid 언어를 보지 못하게 차단
2. **react-markdown `components.div` 오버라이드** (PostDetail.jsx): `mermaid-block` 클래스를 감지하면 `<MermaidDiagram code={...}>` 으로 렌더
3. **MermaidDiagram 컴포넌트** (`src/components/MermaidDiagram.jsx`): `mermaid` 라이브러리를 **dynamic import**로 지연 로드(~1MB 이상). 첫 호출 시에만 초기화되고 module-scope에서 싱글턴으로 캐시. `mermaid.render(id, code)`의 SVG 출력을 `dangerouslySetInnerHTML`로 주입

**테마 토글 대응**

`<html data-theme>` 속성 변경을 `MutationObserver`로 감시. 다크/라이트가 바뀌면 `currentTheme` 캐시 무효화 + mermaid 재초기화 + 재렌더. 테마 변수는 `themeVariables`로 직접 주입해 우리 토큰(`--bg-subtle`, `--text` 등)과 색 톤을 맞춤:

| 토큰 | dark 값 | light 값 |
|------|--------|---------|
| background | `#111116` | `#ffffff` |
| primaryColor | `#14141a` | `#f5f5f7` |
| primaryTextColor | `#f5f5f7` | `#0a0a0b` |
| primaryBorderColor | `#2b2b33` | `#d4d4dc` |
| lineColor | `#5b5b63` | `#6b6b73` |

**번들 비용**

- mermaid: gzip 약 400~500KB. 크지만 **dynamic import로 PostDetail chunk에서도 분리**되어 mermaid 블록이 있는 글을 열 때만 로드
- 홈/카테고리/태그 페이지는 영향 0
- mermaid 없는 글은 MermaidDiagram 컴포넌트가 마운트되지 않아 라이브러리 로드 안 됨

**렌더 실패 시**

mermaid.render가 throw하면 에러 메시지 + 원본 코드를 `.mermaid-diagram--error` 박스로 노출. 무음 실패(그냥 빈 박스) 금지 — 작성자가 문법 오류를 즉시 알 수 있어야 함

**왜 rehype 레벨에서 교체하는가**

- remark 레벨에서 code 노드를 건드리면 `hName`·`hProperties` 지정이 필요한데 react-markdown + rehype 체인에서 엣지 케이스 많음
- hast의 `pre > code.language-mermaid` 패턴 매칭이 가장 단순·안정적
- 더 중요한 건 **shiki보다 먼저 실행** — 플러그인 배열 순서로 제어

---

## 3. 코드블록 하이라이팅

### 왜 shiki인가

| 항목 | shiki | prism |
|------|-------|-------|
| 엔진 | TextMate (VS Code 동일) | 자체 파서 |
| 품질 | VS Code 수준의 정확도 | 언어별 편차 |
| 테마 | VS Code 테마 재사용 | 한정적 |
| 번들 크기 | 약간 큼 | 작음 |

품질이 최우선. 개발 블로그에서 코드블록이 잘못 하이라이팅되면 신뢰가 깨진다.

### 빌드 타임 vs 런타임 — 실제: 런타임 + lazy chunk

당초 빌드 타임 하이라이팅을 선호했으나, react-markdown과의 자연스러운 통합을 위해 **런타임 하이라이팅**으로 전환. 대신 다음 두 방식으로 초기 로딩 비용을 상쇄한다.

| 최적화 | 효과 |
|--------|------|
| **fine-grained 언어 import** | `createHighlighterCoreSync`에 16개 언어 모듈을 직접 import → shiki 기본 bundle의 수백 개 언어가 번들에 포함되지 않음 |
| **route-level lazy chunk** | `React.lazy(PostDetail)` + `Suspense` → 홈·카테고리·태그 페이지의 초기 번들엔 shiki가 **포함되지 않고**, 글 상세 진입 시에만 로드 |

결과: **PostDetail chunk에 shiki + KaTeX가 격리**되어(gzip 약 316 KB) 홈/카테고리/태그 페이지 진입 시 하이라이팅·수식 엔진을 내려받지 않는다. 글 읽기 시점에만 로드.

본문 자체도 lazy로 분리되어 글당 별도 chunk가 되었다. 글 상세 진입 시 `PostDetail` chunk + 해당 글의 body chunk 두 개만 내려오는 구조. 상세는 [content.md의 로딩 전략](content.md#4-로딩-전략--메타-즉시--본문-lazy).

### 수식 렌더링 (KaTeX)

Jekyll에서 이관된 코테/개념정리 글 일부에 LaTeX 수식이 있어 `remark-math` + `rehype-katex`를 체인에 추가했다.

| 항목 | 값 |
|------|-----|
| 지원 문법 | 인라인 `$E=mc^2$`, 블록 `$$...$$` |
| CSS | `import 'katex/dist/katex.min.css'` (`PostDetail.jsx` 최상단) |
| 번들 비용 | PostDetail chunk 기준 gzip +80 KB |
| 대안 | MathJax (번들 더 큼), KaTeX 미지원 (기각 — 코테 글 가독성 포기) |

### 하이라이터 초기화 코드

`src/lib/shiki.js`에서 하이라이터를 한 번만 생성하고, `@shikijs/rehype/core`가 이를 rehype 플러그인으로 감싼다.

```js
import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import js from 'shiki/langs/javascript.mjs'
// ... (16개 언어 import)
import githubLight from 'shiki/themes/github-light.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'

export const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [js, ts, /* ... */],
  engine: createJavaScriptRegexEngine(),
})
```

### 지원 언어 (초기)

기본 세트: `js`, `ts`, `jsx`, `tsx`, `html`, `css`, `json`, `bash`, `md`, `yaml`, `sql`, `python`, `go`, `rust`, `java`, `kotlin`

- 그 외 언어는 필요할 때 추가 (shiki는 언어 모듈을 선택적으로 로드)
- 언어 미지정 코드블록은 plain text로 표시

### 테마

- 라이트: `github-light`
- 다크: `github-dark`
- 같은 코드블록이 두 테마 모두 출력되고, CSS 변수로 전환

---

## 4. 커스텀 컴포넌트 매핑

`react-markdown`의 `components` prop으로 기본 HTML 요소를 커스텀 컴포넌트로 교체한다.

| 마크다운 요소 | 커스텀 처리 |
|-------------|------------|
| `h1` ~ `h6` | id 자동, 앵커 링크, 위계별 스타일 |
| `p` | 본문 스타일 (line-height, 여백) |
| `a` | 외부 링크면 `target="_blank" rel="noopener noreferrer"`, 내부 링크면 React Router Link |
| `img` | 카테고리 기준 경로 해석 + lazy loading + alt 검증 |
| `code` (inline) | 인라인 코드 스타일 |
| `pre > code` | shiki 하이라이팅 결과 |
| `blockquote` | 왼쪽 보더 인용 스타일 |
| `table` | 가로 스크롤 래퍼 |
| `hr` | 구분선 |

---

## 5. 이미지 경로 해석

마크다운에서는 `![](./images/foo.png)`처럼 상대경로로 쓰지만, 브라우저는 현재 URL 기준으로 해석해서 404가 난다.

### 해결

Post 객체에 `category` 정보가 있으므로, 렌더링 시 `./images/`를 `./posts/<category>/images/` 로 변환한 후 Vite가 번들한 이미지 맵에서 실제 해시된 URL을 조회한다.

```js
// 빌드 타임에 이미지 glob도 미리 읽어둠
const images = import.meta.glob(
  './posts/**/images/*.{png,jpg,jpeg,svg,webp,gif}',
  { eager: true, import: 'default' }
)

// 렌더링 시
function resolveImageSrc(src, category) {
  if (!src.startsWith('./images/')) return src  // 외부 URL은 그대로
  const key = `./posts/${category}/${src.slice(2)}`
  return images[key] ?? src
}
```

`import.meta.glob`이 기본 import로 이미지를 로드하면 해시가 적용된 최종 경로(예: `/assets/tcp-handshake-a3b4c5.png`)를 반환한다.

### 미존재 이미지 처리

경로 해석 실패 시 원본 문자열을 그대로 사용해 브라우저에서 404가 보이게 둔다 (조용히 숨기면 글 작성자가 오타를 놓침). 개발 모드에서는 콘솔 경고.

---

## 6. 목차 (TOC)

### 왜 필요한가

개발 블로그 글은 길어지기 쉽다. 사용자가 특정 섹션으로 바로 이동할 수 있어야 한다.

### 생성 방식

1. `rehype-slug`로 모든 헤딩에 id 부여
2. 렌더링 시 `h2`/`h3`만 추출해서 별도 TOC 컴포넌트로
3. 데스크톱: 본문 오른쪽 고정 사이드바, 스크롤 스파이로 현재 섹션 강조
4. 모바일: 글 상단 접을 수 있는 TOC

### h1은 왜 제외

h1은 글 제목 하나만 써야 의미 있다. TOC에 들어가면 노이즈. 본문 내부 최상위 위계는 h2부터 사용하는 규약.

### h4 이하는 왜 제외

TOC가 너무 세세해지면 훑어보기가 오히려 어려워진다. 3단계까지가 탐색 감각의 한계.

---

## 7. 링크 처리

| 링크 유형 | 처리 |
|----------|------|
| 외부 (`http://`, `https://`) | `target="_blank"`, `rel="noopener noreferrer"`, 외부 아이콘 표시 |
| 내부 (`/posts/...`, `/categories/...`) | React Router Link로 SPA 네비 |
| 앵커 (`#heading-id`) | 같은 페이지 부드러운 스크롤 |
| 이미지 (`![](...)`) | 별도 Image 컴포넌트, 클릭 시 확대 검토 (2차) |

---

## 8. 연관 도메인

| 도메인 | 관계 |
|--------|------|
| **Content** | Post.body/category 소비, 이미지 맵 공유 |
| **Routing** | 내부 링크/앵커 이동을 라우터와 연결 |
| **Layout** | PostDetail이 렌더러를 래핑. 본문 타이포 스타일이 여기서 적용 |
