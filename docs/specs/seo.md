# SEO (검색 엔진 최적화)

> 작성일: 2026-04-10

---

## 1. 역할

블로그 글이 검색 엔진(Google 등)에 노출되고, 소셜 미디어 공유 시 올바른 미리보기(OG 카드)가 나오도록 보장한다.

SPA(React)의 근본적 약점 — 크롤러가 `<div id="root"></div>`만 볼 수 있는 문제 — 을 빌드 타임 전략으로 해결한다.

---

## 2. 문제와 전략

### SPA의 SEO 약점

| 크롤러 | JS 실행 | 결과 |
|--------|---------|------|
| Googlebot | O (지연 있음) | 인덱싱은 되지만 느리고 불안정 |
| Facebook/Twitter/Slack | X | OG 태그 없으면 미리보기 깨짐 |
| Bing/Naver | 부분적 | 불확실 |

### 선택한 전략: 빌드 타임 메타 태그 주입

| 후보 | 장점 | 단점 | 결정 |
|------|------|------|------|
| **SSR (Next.js/Vite SSR)** | 완벽한 프리렌더 | 프레임워크 전환 필요, 학습 목적에 반함 | 기각 |
| **vite-ssg** | 빌드 시 정적 HTML | Vue 전용, React 19 `use()` 훅 비호환 | 기각 |
| **react-snap** | 빌드 후 headless 스냅샷 | React 19 `createRoot` 비호환, 미유지보수 | 기각 |
| **빌드 후 메타 주입** | SPA 구조 유지, 소셜 크롤러 대응, 단순 | 본문 HTML은 없음 (JS 필요) | **채택** |

**이유**: SPA 아키텍처를 유지하면서 소셜 크롤러가 필요로 하는 메타 태그만 정적으로 제공한다. Google은 JS를 렌더링하므로 본문 인덱싱에 문제없고, 소셜 미디어 미리보기는 OG 태그로 해결된다.

---

## 3. 구현 레이어

### 3.1 정적 메타 태그 (index.html)

기본 OG/Twitter 메타 태그를 `index.html`에 선언. 프리렌더되지 않은 경로의 폴백 역할.

```html
<meta property="og:site_name" content="jaminLog" />
<meta property="og:title" content="jaminLog" />
<meta property="og:description" content="개발 경험과 기술 지식을 기록하는 개인 블로그" />
<meta property="og:url" content="https://jamin12.github.io/" />
```

### 3.2 클라이언트 동적 메타 (react-helmet-async)

각 페이지 컴포넌트에서 `<SEOHead>` 컴포넌트를 통해 title, description, OG 태그를 동적으로 교체.

| 페이지 | title | description |
|--------|-------|-------------|
| 홈 `/` | jaminLog | 기본 설명 |
| 글 `/posts/:slug` | `{글 제목} — jaminLog` | summary 또는 `{제목} — {카테고리}` |
| 카테고리 `/categories/:cat` | `{카테고리명} — jaminLog` | `{카테고리명} 카테고리의 글 모음 (N개)` |
| 태그 `/tags/:tag` | `#{태그} — jaminLog` | `"{태그}" 태그가 붙은 글 모음` |
| 시리즈 `/series` | `Series — jaminLog` | 순서대로 읽으면 흐름이 이어지는 글 묶음 |
| 시리즈 상세 `/series/:name` | `{시리즈명} 시리즈 — jaminLog` | `{시리즈명} — N편, 약 M분` |

Google은 JS를 실행하므로 이 동적 메타를 읽을 수 있다.

### 3.3 빌드 타임 프리렌더 (prerender-meta.mjs)

빌드 후 실행되는 Node 스크립트. `dist/index.html`을 템플릿으로, 각 라우트별 HTML 파일을 생성한다.

**생성 규칙:**

| 라우트 | 출력 경로 | OG type |
|--------|----------|---------|
| `/posts/{slug}` | `dist/posts/{slug}/index.html` | article |
| `/categories/{cat}` | `dist/categories/{cat}/index.html` | website |
| `/series` | `dist/series/index.html` | website |
| `/series/{name}` | `dist/series/{name}/index.html` | website |
| `/tags/{tag}` | `dist/tags/{tag}/index.html` | website |
| 404 | `dist/404.html` | website |

**동작 방식:**
1. `dist/index.html`의 `<title>` ~ `<meta name="twitter:description">` 구간을 탐지
2. 해당 구간을 라우트별 메타 태그로 교체
3. 나머지(JS 번들 참조, CSS 등)는 그대로 유지
4. GitHub Pages가 `/posts/foo`에 접근하면 `dist/posts/foo/index.html`을 서빙

**결과**: 소셜 크롤러가 JS 없이도 올바른 제목/설명/URL을 읽을 수 있다.

### 3.4 sitemap.xml

빌드 후 `scripts/generate-sitemap.mjs`가 `posts-meta.json`을 읽어 `dist/sitemap.xml`을 생성.

| 라우트 타입 | priority | changefreq |
|------------|----------|------------|
| 홈 | 1.0 | daily |
| 개별 글 | 0.8 | monthly |
| 카테고리 | 0.6 | weekly |
| 시리즈 | 0.5 | weekly |
| 태그 | 0.3 | weekly |

### 3.5 robots.txt

```
User-agent: *
Allow: /
Sitemap: https://jamin12.github.io/sitemap.xml
```

---

## 4. 빌드 파이프라인

```
pnpm build
  ├─ vite build              → dist/ (기본 SPA 번들)
  ├─ generate-sitemap.mjs    → dist/sitemap.xml
  └─ prerender-meta.mjs      → dist/posts/*/index.html
                               dist/categories/*/index.html
                               dist/series/*/index.html
                               dist/tags/*/index.html
                               dist/404.html
```

`package.json`:
```json
"build": "vite build && node scripts/generate-sitemap.mjs && node scripts/prerender-meta.mjs"
```

---

## 5. 향후 확장

| 항목 | 상태 | 비고 |
|------|------|------|
| JSON-LD 구조화 데이터 | 미구현 | Google 리치 결과 (Article, BreadcrumbList) |
| OG 이미지 | 미구현 | cover 이미지가 있는 글에 `og:image` 적용 |
| RSS 피드 | 미구현 | features.md "2차"에 포함 |
| Google Search Console 등록 | 미구현 | 배포 후 수동 등록 필요 |
| 네이버 서치어드바이저 등록 | 미구현 | 한국어 블로그라 권장 |

---

## 6. 연관 도메인

| 도메인 | 관계 |
|--------|------|
| **Deployment** | 빌드 파이프라인에 sitemap·프리렌더 단계 추가 |
| **Content** | posts-meta.json이 sitemap·프리렌더의 데이터 소스 |
| **Routing** | 라우트 구조가 sitemap URL과 프리렌더 경로를 결정 |
