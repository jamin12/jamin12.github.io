# jaminLog 기획

> 작성일: 2026-04-05

---

## 1. jaminLog란

**개인 개발 블로그**다. 내가 공부하고 경험한 내용을 마크다운으로 기록하고, 웹으로 읽을 수 있게 만드는 시스템이다.

복잡한 CMS나 정적 사이트 생성기(Next.js, Gatsby, Astro, Hugo 등)를 쓰지 않고 **React 19 + Vite**로 직접 구축한다. 이유는 두 가지:

1. React 19의 새 API(`use` hook, View Transition 등)를 실제로 써보면서 익히기 위함
2. 블로그 엔진 내부를 내가 제어해야 학습 실험장으로 쓸 수 있음

---

## 2. 핵심 철학

### 글은 파일이다

모든 글은 `src/posts/` 아래의 마크다운 파일이다. DB도, CMS도, 헤드리스 CMS도 없다. 파일을 git으로 버전 관리하고, 에디터(VS Code)로 쓰고, 빌드 타임에 번들된다.

이유: 의존성이 적을수록 오래 살아남는다. 10년 뒤에도 마크다운 파일은 열 수 있다.

### 폴더 = 카테고리

파일 시스템 구조가 곧 사이트 구조다. 별도 카테고리 설정 파일이 없고, 폴더 이름이 카테고리명이 된다.

```
src/posts/
├── http/
│   ├── http-basics.md
│   └── images/http-diagram.png
└── react/
    └── react19-use-hook.md
```

이유: 글과 설정이 한 자리에 있어야 유지보수가 쉽다. 새 카테고리를 만들려면 폴더만 만들면 된다.

### 읽는 경험이 전부

블로그는 **읽히기 위해** 존재한다. 화려한 애니메이션이나 인터랙션보다 **타이포그래피·가독성·로딩 속도**가 우선이다. 개성은 그 위에 얹는다.

---

## 3. 기술 스택 결정

| 기술 | 상태 | 선택 |
|------|------|------|
| **React** | 확정 | 19.2.0 (`use` hook, `lazy`, `Suspense` 적극 활용) |
| **빌드 도구** | 확정 | Vite 5.4 (`import.meta.glob`으로 마크다운·이미지 번들) |
| **언어** | 확정 | JSX (TypeScript 미도입) |
| **마크다운 파서** | 확정 | react-markdown 10 + remark-gfm 4 |
| **수식 렌더링** | 확정 | remark-math 6 + rehype-katex 7 + katex 0.16 (Jekyll 이관 글의 LaTeX 대응) |
| **rehype 플러그인** | 확정 | rehype-slug 6, rehype-autolink-headings 7 |
| **라우터** | 확정 | React Router 7.14 (`<BrowserRouter>` + `<Routes>`) |
| **코드 하이라이팅** | 확정 | shiki 4 (`@shikijs/rehype/core` + fine-grained imports), 듀얼 테마 github-light/dark |
| **스타일링** | 확정 | vanilla CSS + CSS 변수 (다크모드 토큰) |
| **폰트** | 확정 | Pretendard (+ 시스템 fallback) |
| **배포** | 예정 | GitHub Pages + `gh-pages` 패키지 (아직 미배포) |

상세 결정 과정은 각 spec 문서에서 기록한다.

---

## 4. 도메인 구조

```
콘텐츠                   렌더링                   UI
─────────              ─────────              ─────────
Post (글 파일)          Markdown Renderer      Layout (헤더/푸터)
Frontmatter            Code Highlighter       PostList
Category (폴더)         TOC                    PostDetail
Tag                    Image Resolver         Category/Tag Page

라우팅                   배포
─────────              ─────────
Router                 GitHub Pages
Slug Encoder           Vite base
404                    404 폴백
```

### 데이터 흐름

```
.md 파일 ──(import.meta.glob)──> Raw Text
                                   │
                          (frontmatter 파싱)
                                   ↓
                              Post 객체
                                   │
                    ┌──────────────┼──────────────┐
                    ↓              ↓              ↓
                PostList      PostDetail    Category/Tag
                (카드)         (본문 렌더)     (필터)
```

---

## 5. 주요 설계 결정

| 결정 | 이유 |
|------|------|
| DB/CMS 없이 파일 기반 | 영속성·단순성·git 버전 관리 |
| 폴더 = 카테고리 | 설정 파일 분리 불필요, 직관성 |
| 메타 prebuild JSON + 본문 lazy glob | 초기 번들엔 메타만, 본문은 글 진입 시 dynamic chunk로 로드. 68개 기준 초기 gzip 82 KB |
| Next.js/Astro 안 씀 | 학습 목적 + 블랙박스 제거 |
| slug는 파일명 그대로 (한글 포함) | 파일 = URL의 대응이 명확. URL 인코딩은 라우터 단에서 처리 |
| 날짜는 frontmatter, 파일명엔 없음 | 파일명 이중 관리 방지. 날짜 수정도 메타데이터만 건드림 |
| URL에 카테고리 미포함 (`/posts/:slug`) | slug가 전역 유일이면 충분. 카테고리 이동 시 URL 안 깨짐 |
| MDX 대신 순수 마크다운 | 글 파일의 이식성 (VS Code/GitHub와 호환) |
| shiki 런타임 + route-level lazy chunk | 런타임 하이라이팅으로 react-markdown과의 통합을 단순하게, 대신 `React.lazy(PostDetail)`로 초기 번들에서 분리 |
| fine-grained 언어 import | shiki 기본 bundle은 수백 개 언어를 dynamic chunk로 포함 → `createHighlighterCoreSync`에 언어 모듈을 직접 import하여 트리셰이킹 |
| draft는 런타임 필터 (번들엔 포함) | 목록/라우팅 차단으로 접근은 불가. 완전 제거는 `_drafts/` prefix + glob 분리로 미래 확장 |
| 다크모드 CSS 변수 + FOUC 방지 인라인 | React 마운트 전에 `<html data-theme>` 적용해 첫 프레임부터 올바른 색 |
| CSS 변수 토큰 | Tailwind·CSS-in-JS 없이도 다크모드·일관성 달성 |

---

## 6. 사용자 역할

개인 블로그이므로 역할은 단 두 종류다.

| 역할 | 누구 | 할 수 있는 일 |
|------|------|-------------|
| **Reader** | 방문자 | 글 읽기, 탐색, 검색 (2차) |
| **Author** | 나 (jamin) | 마크다운 파일 추가/수정, git commit, 배포 |

인증 시스템이 필요 없다. Author는 로컬 파일 시스템에서만 작업하고, 배포 후에는 Reader만 남는다.

---

## 7. spec 문서 구성

| spec | 다루는 내용 |
|------|-----------|
| [content.md](content.md) | 마크다운 파이프라인, 파일 구조, frontmatter, 이미지 참조 규칙 |
| [rendering.md](rendering.md) | 마크다운 → React 렌더링, 코드 하이라이팅, TOC |
| [routing.md](routing.md) | 라우팅 구조, 한글 slug, 404 처리 |
| [layout.md](layout.md) | UI 프레임, 타이포그래피, 반응형, 다크모드 |
| [deployment.md](deployment.md) | GitHub Pages 배포, Vite base 경로, SPA 폴백 |
| [series.md](series.md) | 시리즈 — 카테고리·태그 독립적인 순서 있는 글 묶음, frontmatter 스키마, UI 설계 |
