# 콘텐츠 파이프라인 (Content)

> 작성일: 2026-04-05

---

## 1. 역할

블로그의 모든 글은 `src/posts/` 아래의 마크다운 파일이다. 이 원시 파일 더미를 **빌드 타임에 구조화된 데이터(Post 객체 배열)** 로 변환하는 것이 콘텐츠 파이프라인의 역할이다.

런타임 fetch 없이 모든 글이 번들에 포함되므로, 사이트 로딩 후에는 추가 네트워크 요청 없이 모든 글을 탐색할 수 있다.

---

## 2. 파일 구조 규약

```
src/posts/
├── <카테고리>/
│   ├── <slug>.md
│   └── images/
│       └── <이미지 파일>
```

### 규칙

| 항목 | 규칙 | 이유 |
|------|------|------|
| 파일 위치 | `src/posts/<category>/<slug>.md` | Vite glob 패턴 대상 |
| 카테고리 | 폴더명 그대로 (한글 가능) | 설정 파일 없이 폴더가 분류 |
| 파일명 | `<slug>.md` | URL의 slug와 1:1 대응 |
| 날짜 | frontmatter에만 | 파일명 중복 관리 방지 |
| 이미지 | 카테고리 폴더 아래 `images/` | 글과 리소스를 같은 자리에 |

### 예시

```
src/posts/
├── http/
│   ├── http-basics.md
│   ├── rest-vs-rpc.md
│   └── images/
│       ├── tcp-handshake.png
│       └── http-flow.svg
└── react/
    ├── use-hook.md
    └── images/
        └── use-hook-diagram.png
```

---

## 3. Frontmatter 스키마

각 `.md` 파일 최상단에 YAML 형식으로 메타데이터를 선언한다.

```markdown
---
title: HTTP 기초
date: 2026-04-05
tags: [http, network]
summary: HTTP의 기본 개념과 메서드, 상태 코드 정리
---

본문 시작...
```

| 필드 | 필수 | 타입 | 용도 |
|------|------|------|------|
| `title` | ✅ | string | 글 제목 (목록/상세/탭 타이틀) |
| `date` | ✅ | YYYY-MM-DD | 정렬 기준, 목록 표시 |
| `tags` | ⬜ | string[] | 태그 필터 |
| `summary` | ⬜ | string | 목록 카드의 미리보기 |
| `draft` | ⬜ | boolean | true면 프로덕션 빌드 제외 |
| `cover` | ⬜ | `./images/<파일>` | 홈의 SplitLatest 히어로/사이드 카드, 카테고리 페이지 카드의 대표 이미지. 본문 이미지와 같은 `./images/` 상대경로 규칙. 없으면 카테고리 이모지 + `--bg-subtle` 그라데이션 fallback |
| `series` | ⬜ | string | 시리즈 이름. 같은 문자열을 가진 글이 하나의 시리즈로 묶인다. 카테고리·태그와 독립 |
| `seriesOrder` | ⬜ | number | 시리즈 내 순서 (1부터). `series`가 있으면 필수 |

### 검증 규칙

- `title` 또는 `date` 누락 시 빌드 경고, 해당 글 스킵
- `date`가 미래면 경고만 하고 포함
- `draft: true`는 프로덕션 빌드에서 제외, dev 모드에선 포함 (초안 미리보기)

### 파서 선택

`gray-matter`를 사용한다. Node 의존성이 없고 브라우저 번들에 포함 가능, YAML frontmatter 표준 지원.

---

## 4. 로딩 전략 — 메타 즉시 + 본문 lazy

홈·카테고리·태그 같은 **목록 페이지**는 메타데이터(title/date/tags/summary/slug/category/readingTime)만 있으면 되고, **본문은 글 상세에 진입한 순간에만** 필요하다. 이 분리가 번들 구조의 기본이다.

```
┌─ 초기 번들 (index.js) ─────────────────┐
│ posts-meta.json — 모든 글의 메타만    │
│ PostList / PostCards / CategoryPage    │
│ (shiki, KaTeX, react-markdown 미포함) │
└────────────────────────────────────────┘

┌─ PostDetail chunk ─ (글 상세 진입 시) ─┐
│ react-markdown + shiki + KaTeX         │
│ TOC 컴포넌트, 본문 렌더 플러그인 체인    │
└────────────────────────────────────────┘

┌─ 글별 body chunk (66개, 각 2~10 KB) ──┐
│ .md 파일 원문 텍스트                   │
│ `use(getPostBodyPromise(...))`로 소비  │
└────────────────────────────────────────┘
```

### 메타 인덱스 — `src/lib/posts-meta.json`

빌드·dev 서버 시작 시 `scripts/build-posts-index.mjs`가 `src/posts/**/*.md`를 스캔해 메타데이터만 JSON으로 떨군다. 클라이언트는 이 JSON을 **정적 import**하므로 초기 번들은 글 본문 없이 가볍다. Vite 플러그인(`vite.config.js`의 `postsIndexPlugin`)이 dev에서 `.md` 변경을 watch해 자동 재생성한다.

| 필드 | 용도 |
|------|------|
| `slug`, `category`, `path` | 라우팅 |
| `title`, `date`, `tags`, `summary` | 목록 카드 |
| `readingTime` | 빌드 타임에 미리 계산 (본문 길이 기준) |
| `draft` | 프로덕션에선 필터 |
| `series`, `seriesOrder` | 시리즈 네비게이션 (이전/다음, 시리즈 목록) |

### 본문 — lazy glob + React 19 `use()` 훅

```js
const bodyModules = import.meta.glob('../posts/**/*.md', {
  query: '?raw',
  import: 'default',
  // eager: false (기본값) → 각 파일이 별도 dynamic chunk로 분리
})
```

`src/lib/posts.js`의 `getPostBodyPromise(category, slug)`가 promise를 반환하고, `PostDetail`이 `const body = use(getPostBodyPromise(...))`로 동기처럼 받는다. 미해결 상태엔 `App.jsx`의 route-level `<Suspense>`가 fallback을 노출 (같은 Suspense가 PostDetail chunk 로드와 body 로드 두 단계를 모두 커버). promise는 모듈 레벨 `Map`에 캐시해 같은 글 재방문 시 재요청하지 않는다.

### 번들 실측 (2026-04-05 기준, 글 68개)

| | 최적화 전 (eager) | 최적화 후 (lazy) |
|---|---|---|
| 초기 `index.js` gzip | 234 KB | **82 KB** |
| `PostDetail` chunk gzip | 235 KB | 316 KB (KaTeX 포함) |
| 본문 chunks | (초기에 몰빵) | 66개 × 2~10 KB |

홈 초기 진입 비용이 거의 최적화 전 수치(79 KB)로 복원됨. 글 수가 늘어나도 초기 번들은 메타 JSON만 커지고 본문은 여전히 lazy.

### 왜 이 구조가 이 블로그에 맞는가

| 대안 | 기각 이유 |
|------|----------|
| `{ eager: true }` 단순 방식 (원안) | 글 수에 비례해 초기 번들 증가 — 68개에서 이미 234 KB |
| 카테고리별 chunk 분할 | 카테고리 단위로 묶으면 해당 카테고리 전체가 한 번에 내려옴. 개별 글 lazy보다 조잡 |
| 서버 사이드 API | 배포를 정적에서 서버로 바꿔야 함, 인프라 비용 |
| MDX 빌드 타임 렌더 | 본문을 HTML로 사전 컴파일, lazy 분리와 병행 가능하지만 구조 복잡도↑. 나중에 재고 |

### Post 객체 형태

```js
{
  slug: 'http-basics',
  category: 'http',
  title: 'HTTP 기초',
  date: '2026-04-05',
  tags: ['http', 'network'],
  summary: 'HTTP의 기본 개념과 메서드, 상태 코드 정리',
  body: '...(마크다운 본문)',
  path: '/posts/http-basics',  // URL
  readingTime: 7,  // 분 단위
}
```

이 배열을 앱 시작 시 1회 만들어 module-scope에 둔다. React context로 감싸는 것도 가능하지만, 불변 데이터이므로 단순 export가 더 간단하다.

---

## 5. 카테고리·태그 인덱싱

### 카테고리 추출

파일 경로 `./posts/<category>/<slug>.md`에서 경로 파싱으로 `category`를 추출한다. 별도 등록 과정 없이 폴더만 만들면 자동 인식된다.

### 태그 집계

모든 Post의 `tags` 배열을 합쳐 중복 제거한다. 각 태그별 글 수도 함께 계산해둔다 (태그 페이지에서 사용).

### 정렬 기준

| 대상 | 정렬 |
|------|------|
| 글 목록 (전체/카테고리/태그) | `date` 내림차순 (최신순) |
| 카테고리 목록 | 글 수 내림차순 → 이름 가나다순 |
| 태그 목록 | 사용 빈도 내림차순 |

---

## 6. 이미지 참조 규칙

마크다운 본문에서는 **상대경로**로 이미지를 참조한다.

```markdown
![TCP 핸드셰이크](./images/tcp-handshake.png)
```

### 해석 방식

Vite의 import 시스템이 런타임 동적 경로를 해석하지 못하므로, 렌더링 단계에서 `<img src>` 경로를 **카테고리 기준 절대 경로**로 변환하고, 미리 glob으로 로드한 이미지 맵에서 해시된 최종 URL을 조회한다. 상세는 [rendering.md](rendering.md)에서 다룬다.

### 왜 public 폴더가 아닌 src 내부인가

- public은 전역 경로라 카테고리별로 이미지를 모을 수 없다
- 글과 이미지가 같은 폴더에 있어야 **글 단위로 이동/삭제가 쉽다**
- Vite가 import한 이미지는 해시가 붙어 캐시 무효화도 자동
- VS Code에서 마크다운 프리뷰 시 상대경로가 그대로 작동

---

## 7. 읽는 시간 계산

Post 객체에 `readingTime` 필드를 넣어둔다. 매 렌더마다 다시 계산하지 않는다.

| 항목 | 값 |
|------|-----|
| 기준 속도 | 한국어 분당 약 500자 |
| 계산식 | `Math.max(1, Math.round(body.length / 500))` |
| 최소값 | 1분 (짧은 글도 "1분"으로 표시) |

영문 혼용 글은 영문이 더 빨리 읽히지만, 단순화를 위해 한국어 기준만 사용.

---

## 8. 외부 Jekyll 블로그에서의 마이그레이션

초기 글은 기존 Jekyll 블로그(`D:/project/personal/jamin12/`)에서 일괄 이관했다. 스크립트는 `scripts/migrate-posts.mjs`에 있고, 드라이런 기본·`--apply`로 실제 쓰기.

### 매핑 규칙 (옵션 D: 상위만 카테고리, 하위는 태그)

Jekyll이 `_posts/<주제폴더>/<slug>.md` + frontmatter `categories:` 배열로 **물리 폴더와 논리 카테고리를 따로** 관리하는 것을 jaminLog의 단일 카테고리 모델로 변환한다.

| 필드 | 출처 (우선순위) |
|------|---------------|
| **카테고리** | frontmatter `categories[0]` → 없으면 `_posts/` 아래 최상위 폴더명 |
| **태그** | 기존 `tags` ∪ `categories[1:]` ∪ 서브폴더(최상위 제외) 경로 (set으로 중복 제거) |
| **날짜** | frontmatter `date`의 YYYY-MM-DD 부분만 → 없으면 파일명 `YYYY-MM-DD-` 접두사 |
| **title** | trim + 양끝 따옴표 제거 |
| **slug** | 파일명에서 날짜 접두사 제거 + 공백 → 하이픈 |
| **제거되는 Jekyll 전용 필드** | `layout`, `mermaid`, `math` |

### 옵션 D의 보완: 런타임 하위 카테고리 레이어 (2026-04 4차)

옵션 D로 물리 구조를 평탄화한 결과, 실제로는 `개념-정리` 하나에 41글이 `network`/`elasticsearch`/`kubernetes`/`deployment`/`spring`/`redis`/`pact`/... 등 약 12개 주제로 섞여 들어가 **카테고리가 탐색 축으로 제 역할을 못 하는** 문제가 드러났다. 4차 디자인 반복 중 사용자가 "하위 카테고리가 있는 걸로 알고 있는데"로 지적.

**해결**: 파일/URL은 건드리지 않고 `src/lib/subcategory-rules.js`에 **카테고리별 ordered tag → subcategory rule 배열**을 정의. `build-posts-index.mjs`가 각 글의 `tags`를 rule에 대조해 `subcategory` 필드를 메타 JSON에 주입한다. 런타임 조회는 `getSubcategoriesByCategory(name)` 헬퍼가 담당.

**왜 옵션 D를 번복하지 않나**
- 글이 여러 주제에 걸쳐 있을 때(`tls`는 network + TLS 구현 + 러너스하이2 프로젝트 세 축에 동시) 폴더는 하나에만 있을 수 있으나 태그는 다중 분류가 가능
- 68파일 이동 + migrate-posts.mjs 재작성 + 이미지 상대경로 재점검의 비용 대비 얻는 것이 적음
- Rule map은 **한 파일 수정으로 분류 체계 전체를 바꿀 수 있어** 물리 이동보다 유연

**우선순위 주의**: rule 배열은 "더 구체적인 규칙이 앞" 원칙. 예를 들어 `argo-rollouts-canary`는 `[kubernetes, argo-rollouts, canary, ...]` 태그를 가지므로, `deployment` 규칙이 `kubernetes` 규칙보다 먼저 와야 "배포 전략" 하위로 빠진다. 반대로 `Pv-pvc`처럼 `[k8s]`만 가진 순수 k8s 글은 deployment에 걸리지 않고 마지막 `kubernetes` 규칙으로 떨어진다. `jackson-polymorphic-type-handling`의 경우 `[jackson, serialization, redis, java]` 태그 중 `redis`가 있지만, 실제 내용은 Jackson 직렬화라 `jackson` 규칙을 `redis` 규칙보다 앞에 두고 `redis` 규칙은 `streams` 태그만 잡도록 한정했다.

**검증**: 2026-04-05 기준 `posts-meta.json` 전수 검증에서 68/68 글이 의도한 하위 그룹에 들어감. 분포는 `docs/features.md`의 하위 카테고리 항목 참조.

**2026-04-13 추가**: `saga` / `outbox` 태그를 잡는 `Saga · Outbox` 서브 카테고리 신설. Saga + Outbox 패턴 시리즈 4편(`saga-outbox-01` ~ `04`)과 기존 리팩터링 경험기(`msa-saga-pattern-refactoring`)가 대상. `saga` 규칙은 `circuit-breaker` 뒤에 배치 — 다른 규칙과 태그 충돌 없으므로 우선순위 이슈 없음. 트러블-슈팅 카테고리의 리팩터링 글은 `saga` 태그를 가지지만 `트러블-슈팅: []`(빈 규칙)이라 서브 카테고리에 묶이지 않음 — 의도된 동작.

**새 주제가 생기면**
1. 새 글에 적절한 태그 부여 (기존 태그 재활용 권장)
2. 기존 태그로 분류가 안 되면 `src/lib/subcategory-rules.js`에 규칙 한 줄 추가
3. 우선순위(rule 배열 순서) 재검토 — 새 rule이 기존 글을 재분류하지 않는지 전수 검증
4. 빈 카테고리 rule(`트러블-슈팅: []`)은 유지 — 작은 카테고리에 억지 하위 그룹 만들지 않음

### 카테고리 alias

같은 카테고리가 Jekyll frontmatter(`개념정리`, 공백 없음)와 물리 폴더명(`개념 정리`, 공백 있음)에서 다르게 표기될 수 있다. 이걸 한 카테고리로 통일하기 위해 `CATEGORY_ALIASES` 맵을 스크립트 상단에 둔다.

```js
const CATEGORY_ALIASES = {
  개념정리: '개념-정리',
}
```

원칙: **URL에는 하이픈(`개념-정리`)**, 디스플레이는 필요 시 UI 단에서 하이픈→공백 변환(`개념 정리`). 파일 시스템·URL의 공백 금지 규칙은 그대로 유지.

### 본문 변환

| 대상 | 변환 |
|------|------|
| Jekyll Liquid `{% include link-preview.html url="X" title="Y" %}` | `[Y](X)` 마크다운 링크 |
| `title` 없는 variant | `[X](X)` |
| `{% raw %}` / `{% endraw %}` | 제거 (내용은 유지) |
| 이미지 `/assets/imgs/...` | 실제 파일을 `src/posts/<카테고리>/images/`로 복사, 본문 참조는 `./images/<파일명>` (파일명 공백→하이픈) |
| 외부 CDN 이미지 (`http(s)://...`) | 그대로 유지 |
| 알 수 없는 Liquid | 그대로 두고 경고 로그 |

### slug 충돌 처리

같은 카테고리에 같은 slug가 두 개 이상 나오면, **서브폴더 경로를 하이픈으로 이어 slug 앞에 prefix**로 붙여 재시도. 그래도 충돌하면 스킵하고 리포트.

예: `_posts/기타/러너스하이2/주제1/주제찾기.md` + 같은 이름이 `주제2`, `주제3`에도 있음
→ `기타/주제찾기`, `기타/러너스하이2-주제2-주제찾기`, `기타/러너스하이2-주제3-주제찾기`

### 스크립트가 건드리지 않는 것

- 기존 `src/posts/` 아래 이미 있는 카테고리(`react`, `sample` 등)는 스크립트가 **추가만** 한다. 덮어쓰거나 삭제하지 않음.
- 마이그레이션 결과 검증은 `pnpm build`로. 파서가 새 파일을 모두 Post 객체로 만들어낼 수 있는지 확인.

### 해결된 항목 (4차에서 처리)

- **LaTeX 수식**: 초기 미지원 → 이관 직후 `rehype-katex` + `remark-math` 추가로 해결. 코테 글의 `\binom{N}{K}` 등 정상 렌더
- **Mermaid 다이어그램**: `mermaid: true` Jekyll 전용 필드는 migration 시 제거됐지만 본문의 `` ```mermaid `` 코드블록은 그대로 남아있었음. 4차에서 사용자 피드백으로 렌더링 지원 추가 — 로컬 `rehype-mermaid-passthrough` 플러그인 + `MermaidDiagram` 컴포넌트 + dynamic import. 상세는 [rendering.md의 Mermaid 섹션](rendering.md#mermaid-다이어그램-2026-04-4차-추가) 참조

### 미해결 항목

- **태그 표기 흔들림** (`Next.js` vs `nextJs`, 밑줄 포함된 `러너스하이2_주제2` 등): 원본 frontmatter에서 온 것이므로 스크립트가 건드리지 않음. 필요하면 수동 정리. 4차 subcategory rule이 이 흔들림을 흡수하도록 `tags: ['Next.js', 'nextJs']` 처럼 같은 규칙에 여러 변형을 담음

---

## 9. 시리즈 (Series)

별도 도메인으로 분리. 상세는 **[series.md](series.md)** 참조.

frontmatter에 `series`/`seriesOrder` 필드를 추가하여 카테고리·태그와 독립적인 순서 있는 글 묶음을 정의한다. 빌드 파이프라인에서 `posts-meta.json`에 주입되며, 런타임 조회 함수(`seriesList`, `getPostsBySeries`, `getSeriesNav`)를 `posts.js`에서 제공한다.

---

## 10. 연관 도메인

| 도메인 | 관계 |
|--------|------|
| **Rendering** | Post.body를 받아 React 요소로 변환. 이미지 경로 해석 책임 |
| **Routing** | Post.path/slug 기반 URL 매핑. 카테고리/태그 인덱스 사용 |
| **Layout** | PostList/PostDetail 컴포넌트가 Post 객체 소비 |
