# 콘텐츠 파이프라인 (Content)

> 작성일: 2026-04-05

---

## 1. 역할

블로그의 모든 글은 `src/posts/` 아래의 마크다운 파일이다. 이 원시 파일 더미를 **빌드 타임에 구조화된 데이터(Post 객체 배열)** 로 변환하는 것이 콘텐츠 파이프라인의 역할이다.

런타임 fetch 없이 모든 글이 번들에 포함되므로, 사이트 로딩 후에는 추가 네트워크 요청 없이 모든 글을 탐색할 수 있다.

---

## 2. 입력 계약

파일 배치 규약과 frontmatter 필드 정의는 **작성자 계약**이므로 [`writing/organizing.md`](../writing/organizing.md#파일을-어디에-두나)와 [`writing/frontmatter.md`](../writing/frontmatter.md)가 원천이다. 여기 다시 적지 않는다 — 두 곳에 적으면 반드시 한쪽이 낡는다.

이 spec은 그 계약을 **왜 그렇게 정했고 파이프라인이 어떻게 처리하는지**만 다룬다.

| 계약 | 그렇게 정한 이유 |
|------|----------------|
| 파일 위치 `src/posts/<category>/<slug>.md` | Vite glob 패턴의 대상. 경로 파싱만으로 카테고리가 나오므로 등록 절차가 필요 없다 |
| 폴더명 = 카테고리 | 별도 카테고리 설정 파일을 두면 폴더와 어긋날 수 있다. 파일 시스템을 단일 원천으로 |
| 날짜는 frontmatter에만 | 파일명에 날짜를 넣으면 이중 관리가 된다. 날짜 수정 시 URL(slug)까지 바뀌는 것도 피함 |
| slug는 파일명 그대로 (한글 포함) | 파일 ↔ URL 대응이 명확. URL 인코딩은 라우터 단에서 → [routing.md](routing.md) |
| 이미지는 카테고리 폴더 아래 `images/` | §5 참조 |

### 파서 선택

`gray-matter`를 사용한다. Node 의존성이 없어 브라우저 번들에 포함 가능하고, YAML frontmatter 표준을 지원한다.

### `draft`는 런타임 필터다

`draft: true` 글도 **번들에는 포함되고**, 목록·라우팅에서만 걸러진다. 접근 경로가 없으니 실질적으로는 안 보이지만 완전한 비공개는 아니다.

번들에서 완전히 빼려면 `_drafts/` prefix + glob 패턴 분리가 필요한데, 아직 안 했다 — 초안이 민감한 내용을 담는 일이 없어 비용을 치를 이유가 없었다. 필요해지면 그때 분리한다.

### 검증 강도

`title`/`date` 누락만 스킵 처리하고 나머지는 통과시킨다. 시리즈 관련 검증(`seriesOrder` 누락·중복·번호 공백)은 아직 없다 — 개인 블로그 규모에서 오탐 없는 검증기를 만드는 비용이 얻는 것보다 크다고 판단. 시리즈가 늘어 실제로 순서가 어긋나는 일이 생기면 그때 추가한다.

---

## 3. 로딩 전략 — 메타 즉시 + 본문 lazy

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

`src/lib/posts.ts`의 `getPostBodyPromise(category, slug)`가 promise를 반환하고, `PostDetail`이 `const body = use(getPostBodyPromise(...))`로 동기처럼 받는다. 미해결 상태엔 `App.tsx`의 route-level `<Suspense>`가 fallback을 노출 (같은 Suspense가 PostDetail chunk 로드와 body 로드 두 단계를 모두 커버). promise는 모듈 레벨 `Map`에 캐시해 같은 글 재방문 시 재요청하지 않는다.

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

## 4. 카테고리·태그 인덱싱

### 카테고리 추출

파일 경로 `./posts/<category>/<slug>.md`에서 경로 파싱으로 `category`를 추출한다. 별도 등록 과정 없이 폴더만 만들면 자동 인식된다.

### 태그 집계

모든 Post의 `tags` 배열을 합쳐 중복 제거한다. 각 태그별 글 수도 함께 계산해둔다 (태그 페이지에서 사용).

### 정렬 기준

| 대상 | 정렬 |
|------|------|
| 글 목록 (전체/카테고리/태그) | `date` 내림차순(최신순) → 같은 날짜면 `order` 오름차순 → slug 이름순 |
| 카테고리 목록 | 글 수 내림차순 → 이름 가나다순 |
| 태그 목록 | 사용 빈도 내림차순 |

**결정 기록 (2026-06-23, `order`를 1순위에서 같은-날짜 보조키로 강등)**:
- *1차 — `order` 1순위 (이전)*: frontmatter `order`(정수)를 최우선 정렬키로 두어 개념 정리 다부작 글을 1편→N편 순서로 위에서 아래로 고정했다(`order` 오름차순 → 같은 order면 날짜순). 결과적으로 목록 상단에 오래된 1편이 박혀 **카테고리 목록이 최신 글을 안 보여주는** 문제가 생겼다.
- *2차 — `order` 완전 제거 시도*: 순수 날짜 내림차순으로 되돌렸으나, **같은 날 올린 묶음**(circuit-breaker 7글, network 9글 등)이 slug 알파벳순으로 흩어져 읽는 순서가 깨졌다(예: `circuit-breaker-why`가 맨 뒤로).
- *최종 — 날짜 1순위 + `order` 2순위*: 날짜 내림차순으로 최신 글이 위로 오게 하되, **같은 날짜 안에서만** `order` 오름차순이 적용되어 묶음의 읽는 순서를 보존한다. `order`는 날짜를 넘지 못하므로 1차 문제(오래된 글 상단 고정)는 재발하지 않는다. 카테고리를 넘나드는 순서 묶음은 여전히 `series`/`seriesOrder`(→ [series.md](series.md))가 담당하며, 시리즈 정렬은 `seriesOrder` 기반이라 영향 없음.

---

## 5. 이미지 참조 규칙

작성자 규약(`./images/<파일>` 상대경로, 카테고리 폴더 아래 배치)은 [`writing/style.md`](../writing/style.md#이미지-경로) 참조. 여기서는 그 규약의 근거와 해석 방식만 다룬다.

### 해석 방식

Vite의 import 시스템이 런타임 동적 경로를 해석하지 못하므로, 렌더링 단계에서 `<img src>` 경로를 **카테고리 기준 절대 경로**로 변환하고, 미리 glob으로 로드한 이미지 맵에서 해시된 최종 URL을 조회한다. 상세는 [rendering.md](rendering.md)에서 다룬다.

### 왜 public 폴더가 아닌 src 내부인가

- public은 전역 경로라 카테고리별로 이미지를 모을 수 없다
- 글과 이미지가 같은 폴더에 있어야 **글 단위로 이동/삭제가 쉽다**
- Vite가 import한 이미지는 해시가 붙어 캐시 무효화도 자동
- VS Code에서 마크다운 프리뷰 시 상대경로가 그대로 작동

---

## 6. 읽는 시간 계산

Post 객체에 `readingTime` 필드를 넣어둔다. 매 렌더마다 다시 계산하지 않는다.

| 항목 | 값 |
|------|-----|
| 기준 속도 | 한국어 분당 약 500자 |
| 계산식 | `Math.max(1, Math.round(body.length / 500))` |
| 최소값 | 1분 (짧은 글도 "1분"으로 표시) |

영문 혼용 글은 영문이 더 빨리 읽히지만, 단순화를 위해 한국어 기준만 사용.

---

## 7. 외부 Jekyll 블로그에서의 마이그레이션

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

**검증**: 2026-04-05 기준 `posts-meta.json` 전수 검증에서 68/68 글이 의도한 하위 그룹에 들어감. 당시 분포는 개념-정리 (network 10 · elasticsearch 5 · kubernetes 4 · deployment 4 · spring 3 · cdc 3 · nextjs 3 · redis 3 · cs 2 · monitoring 2 · database 1 · jackson 1) / 코테 (dp 5 · graph 2 · math 1 · string 1) / 트러블-슈팅 (flat, 4글) / CDC·모니터링·CI-CD (시리즈로 묶여 하위 카테고리 불필요). 지금 값은 `posts-meta.json`이 원천이고, 이 숫자는 규칙 설계 시점의 근거로만 남긴다.

**2026-04-13 추가**: `saga` / `outbox` 태그를 잡는 `Saga · Outbox` 서브 카테고리 신설. `saga` 규칙은 `circuit-breaker` 뒤에 배치 — 다른 규칙과 태그 충돌 없으므로 우선순위 이슈 없음. 트러블-슈팅 카테고리의 글들은 `saga` 태그를 가지지만 `트러블-슈팅: []`(빈 규칙)이라 서브 카테고리에 묶이지 않음 — 의도된 동작.

**2026-05-05 갱신**: 트러블-슈팅의 Saga 리팩터링 회고와 개념-정리의 Saga + Outbox 설계 시리즈를 단일 시리즈로 통합. 두 글이 분리되어 있을 때 독자가 회고의 결론("단순 2테이블로 단순화 승리")과 설계의 결론("4테이블로 재정교화")을 충돌로만 읽고 흐름을 잇지 못한다는 판단이 근거. 회고(시간순 의사결정) → 설계론(현재 시점 결과)을 카테고리 넘나드는 시리즈의 두 막으로 묶어, 단순화에서 다시 정교화로 돌아온 결정 자체가 이력으로 보이게 했다. 태그·서브카테고리 규칙은 변동 없음(`saga` / `outbox` 태그가 그대로 `Saga · Outbox` 서브카테고리에 매핑).

**2026-09-08 갱신**: k8s 강의 노트 42글이 들어오면서 `kubernetes` 서브 카테고리를 `k8s`(slug, label 모두)로 바꿨다. 태그 이름과 같게 맞춘 것이고 매칭 태그(`k8s`, `kubernetes`)는 그대로다. 같은 날 두 가지가 드러났다.
- **"맨 마지막" 규칙이 실제로는 중간에 있었다.** 4차 이후 `circuit-breaker`, `saga`, `coroutine`, `spring-reactive`, `go` 규칙을 배열 끝에 덧붙이는 동안 `kubernetes` 규칙이 그 앞에 남았다. 그 결과 `kubernetes` 태그가 붙은 "실시간 로그 스트리밍" 시리즈 글 2편(`websocket-주제-선정`, `websocket-kotlin-flow-pipeline`)이 k8s 서브로 들어갔다. `k8s` 규칙을 배열 맨 끝으로 옮기고, 주석에 "새 규칙은 이 위에 넣는다"를 남겼다. 배열 순서가 곧 우선순위인 구조에서는 "마지막"이라는 약속이 파일을 고칠 때마다 깨질 수 있다.
- **`websocket` 서브 카테고리 신설.** 실시간 로그 스트리밍 시리즈 6편 중 4편은 어느 규칙에도 걸리지 않아 서브 카테고리가 비어 있었다. `websocket` 태그를 잡는 규칙을 `go` 뒤, `k8s` 앞에 두었다. `websocket-kotlin-flow-pipeline`은 `websocket` 태그가 없고 `coroutine` 태그가 있어 Coroutine으로 간다. Kotlin Flow 파이프라인 글이라 그쪽이 맞다고 봤다.

**새 주제가 생겼을 때의 절차**는 작성자 쪽 일이라 [`writing/organizing.md`](../writing/organizing.md#하위-카테고리)에 있다.

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

## 8. 시리즈 (Series)

별도 도메인으로 분리. 상세는 **[series.md](series.md)** 참조.

frontmatter에 `series`/`seriesOrder` 필드를 추가하여 카테고리·태그와 독립적인 순서 있는 글 묶음을 정의한다. 빌드 파이프라인에서 `posts-meta.json`에 주입되며, 런타임 조회 함수(`seriesList`, `getPostsBySeries`, `getSeriesNav`)를 `posts.ts`에서 제공한다.

---

## 9. 연관 도메인

| 도메인 | 관계 |
|--------|------|
| **Rendering** | Post.body를 받아 React 요소로 변환. 이미지 경로 해석 책임 |
| **Routing** | Post.path/slug 기반 URL 매핑. 카테고리/태그 인덱스 사용 |
| **Layout** | PostList/PostDetail 컴포넌트가 Post 객체 소비 |
| **[writing/frontmatter.md](../writing/frontmatter.md)**, **[organizing.md](../writing/organizing.md)** | 이 파이프라인의 **입력 계약**. frontmatter 스키마·파일 배치·분류 규약의 원천 |
