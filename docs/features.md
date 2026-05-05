# jaminLog 기능 목록

> 작성일: 2026-04-05
> 마지막 업데이트: 2026-04-05
> 현재 상태: 읽기 기능 전부 완료. **배포만 미진행** (로컬 dev 서버에서만 동작)

## 콘텐츠 파이프라인 → [specs/content.md](specs/content.md)

- [x] 마크다운 파일 로딩 (`import.meta.glob`, eager)
- [x] Frontmatter 파싱 (title, date, tags, summary, draft, **cover**)
- [x] 폴더 기반 카테고리 자동 분류
- [x] 글 인덱스 생성 (빌드 타임, 날짜순 정렬)
- [x] 태그 인덱스 생성 (빈도순)
- [x] 이미지 상대경로 참조 규칙 (`./images/*` → Vite 해시 URL 리졸버)
- [x] draft 플래그 (프로덕션 빌드에서 목록·라우팅 제외, dev는 "초안" 배지)
- [x] **시리즈** (2026-04-06) — 카테고리·태그 독립적인 순서 있는 글 묶음. frontmatter `series`/`seriesOrder` 필드. 데이터 레이어 완료 (`seriesList`, `getPostsBySeries`, `getSeriesNav`). 카테고리를 넘나드는 시리즈 지원(회고 → 설계론 같은 두 막 구조). 등록된 시리즈 목록은 빌드 산출물에서 자동 추출. 상세는 [specs/series.md](specs/series.md)

## 렌더링 → [specs/rendering.md](specs/rendering.md)

- [x] 마크다운 → React 렌더링 (react-markdown 10 + remark-gfm 4)
- [x] LaTeX 수식 (remark-math 6 + rehype-katex 7, 인라인·블록)
- [x] 헤딩 위계 (H1~H4) 스타일링
- [x] 코드블록 신택스 하이라이팅 (shiki 4, fine-grained, 16개 언어, 듀얼 테마)
- [x] **Mermaid 다이어그램** (2026-04 4차) — sequenceDiagram/flowchart/graph 등. 로컬 `rehype-mermaid-passthrough` 플러그인으로 shiki 앞단에서 교체, `MermaidDiagram` 컴포넌트가 dynamic import로 mermaid lib 지연 로드. 테마 토글 시 `MutationObserver`로 자동 재렌더. mermaid 없는 글은 lib 로드 0
- [x] 인용구 / 리스트 / 테이블 기본 스타일
- [x] 이미지 렌더링 (카테고리 기준 상대경로 해석, lazy loading)
- [x] 내부 링크 vs 외부 링크 구분 (외부는 `target=_blank rel=noopener`)
- [x] 목차(TOC) 자동 생성 (h2/h3, DOM 스캔)
- [x] 헤딩 앵커 링크 (`rehype-slug` + `rehype-autolink-headings`)

## 라우팅 → [specs/routing.md](specs/routing.md)

- [x] 홈 `/` - **Dev Dashboard 4섹션 구조** (2026-04 4차): `01 최신 글`(히어로 1 + side 3) → `02 카테고리 그리드`(랭킹 #1/#2/#3) → `03 카테고리별 최근`(섹션 loop) → `04 태그`. 왼쪽 260px sticky 사이드바 셸 (`<1024px`에서 top bar로 대체)
- [x] **하위 카테고리 레이어** (2026-04 4차, 옵션 D 보완) — `src/lib/subcategory-rules.js`에 카테고리별 ordered tag→group rule 정의. `build-posts-index.mjs`가 메타 JSON에 `subcategory` 필드 주입. 물리 폴더·URL·파일 수정 0. 분포: 개념-정리 (network 10 · elasticsearch 5 · kubernetes 4 · deployment 4 · spring 3 · cdc 3 · nextjs 3 · redis 3 · cs 2 · monitoring 2 · database 1 · jackson 1) / 코테 (dp 5 · graph 2 · math 1 · string 1) / 트러블-슈팅 (flat, 4글) / CDC·모니터링·CI-CD (시리즈로 묶임, 하위 카테고리 불필요)
- [x] **하위 카테고리 라우트** — `/categories/:cat/:sub` nested path. CategoryPage 한 컴포넌트가 전체 뷰 · 단일 하위 뷰를 `useParams` 분기로 처리
- [x] **사이드바 하위 그룹 트리** — 활성 카테고리만 자동 펼침 (수동 토글 없음). 좌측 가이드 라인 + 글머리 tick, 활성 하위는 `--accent` + `--accent-tint`
- [x] **CategoryPage 하위 네비** — 상단 칩 네비("전체" + 각 하위 그룹), 카테고리 전체 뷰에서 그룹별 섹션 분할, 하위 단독 뷰에선 breadcrumb kicker(`카테고리 · 상위 이름`) + 단일 섹션
- [x] 글 상세 `/posts/:slug`
- [x] 카테고리 `/categories/:category`
- [x] 태그 `/tags/:tag`
- [x] 404 페이지
- [x] 한글 slug URL 인코딩/디코딩
- [x] 클라이언트 라우팅 (React Router v7.14)
- [x] 스크롤 복원 (PUSH/REPLACE는 top, POP은 브라우저 복원, 앵커는 보존)
- [x] View Transitions (Link `viewTransition` prop + CSS crossfade)

## 레이아웃/UI → [specs/layout.md](specs/layout.md)

- [x] **사이드바 셸** (2026-04 4차) — 왼쪽 260px sticky, 프로필(Fraunces `J` letter-mark + 타이틀 + 태그라인) + 카테고리 트리(이름 첫 글자 letter-mark + 카운트) + 하단 텍스트 테마 토글(`LIGHT`/`DARK`). `<1024px`에서 top bar로 폴백. **이모지·이모티콘 일체 금지** (전역 CLAUDE.md 규칙)
- [x] 푸터 (빌드 정보 한 줄) _— 외부 링크(GitHub 등) 아직 없음_
- [x] **홈 Dev Dashboard 섹션**: `SplitLatest`(히어로 + side 3) · `CategoryGrid`(랭킹 배지 + letter-mark) · `CategorySections` loop · `TagFooter`
- [x] **커버 이미지 지원** — frontmatter `cover: ./images/foo.png` (optional). 없으면 카테고리 letter-mark + `--bg-subtle` 그라데이션 fallback
- [x] 글 목록 카드 (제목/summary/날짜/읽는시간/카테고리/태그칩)
- [x] 글 상세 레이아웃 (본문 720px + 데스크톱 우측 TOC sticky)
- [x] 타이포그래피 (Pretendard, 17px/1.75, `word-break: keep-all`)
- [x] 반응형 (640/1100px 브레이크포인트, `.app--wide` 토글)
- [x] 다크 모드 (CSS 변수, FOUC 방지 인라인 스크립트, localStorage, **다크 기본** — 2026-04부터 플립)
- [x] **Dev Dashboard Editorial** (2026-04, 4차 반복에서 확정) — 3차 Refined Editorial Dark의 **문자**(Fraunces + Inter 이중 스택, Electric Blue `#2b5bff` 단일 액센트, CSS counter, 다크 `#0a0a0b` 기본)를 100% 계승하면서 **홈의 구조만** Inpa Dev 스타일의 사이드바 + 카드 그리드 대시보드로 교체. 왼쪽 260px sticky 사이드바(letter-mark 아바타 + 카테고리 트리), 홈 4섹션 적층(`SplitLatest` → `CategoryGrid` → `CategorySections` → `TagFooter`). 성격 3단어 Sharp·Honest·Playful 유지. 상세·기각 기록(1차 Polished Brutalism → 2차 Refined Minimal → 3차 Refined Editorial Dark → 4차 Dev Dashboard Editorial, 하루 동안 네 번)은 [`specs/layout.md §2.5`](specs/layout.md), 원칙은 프로젝트 루트 [`.impeccable.md`](../.impeccable.md)
- [x] 빈 상태 (빈 카테고리/태그, 없는 글)
- [x] 읽는 시간 표시 (한국어 분당 500자 기준)

## SEO → [specs/seo.md](specs/seo.md)

- [x] 기본 메타 태그 (description, OG, Twitter Card) — `index.html` 정적 선언
- [x] 클라이언트 동적 메타 (`react-helmet-async`) — 페이지별 title/description/OG 교체
- [x] robots.txt — `public/robots.txt`
- [x] sitemap.xml 자동 생성 — `scripts/generate-sitemap.mjs`, 빌드 후 실행
- [x] 빌드 타임 프리렌더 — `scripts/prerender-meta.mjs`, 라우트별 HTML에 메타 태그 주입 (소셜 크롤러 대응)
- [x] 404.html SPA 폴백 — 프리렌더 스크립트에서 자동 생성
- [ ] JSON-LD 구조화 데이터
- [ ] OG 이미지 (cover → og:image)
- [ ] Google Search Console / 네이버 서치어드바이저 등록

## ���포 → [specs/deployment.md](specs/deployment.md)

- [ ] GitHub Pages 배포 (`gh-pages` 패키지)
- [ ] Vite `base` 경로 repo명 대응
- [ ] React Router `basename` 연동
- [ ] SPA 404 폴백 (`public/404.html` 트릭)
- [ ] 빌드 파이프라인 (`pnpm build` → `pnpm deploy`)

## 번들 최적화

- [x] shiki fine-grained bundle (`@shikijs/rehype/core` + `createHighlighterCoreSync`)
- [x] `React.lazy(PostDetail)` + `Suspense`로 route-level code splitting
- [x] **메타/본문 분리** — `scripts/build-posts-index.mjs`가 빌드·dev 시 `src/lib/posts-meta.json` 생성, 본문은 `import.meta.glob`의 lazy 모드로 글당 별도 chunk. `PostDetail`이 React 19 `use()` 훅으로 body promise 소비. 상세는 [content.md의 로딩 전략](specs/content.md#4-로딩-전략--메타-즉시--본문-lazy)
  - 초기 `index.js` gzip: **82 KB** (글 68개 기준)
  - `PostDetail` chunk gzip: 316 KB (shiki + KaTeX 포함)
  - 본문 chunks: 글당 2~10 KB, 68개 분리

## 콘텐츠 마이그레이션

- [x] Jekyll `_posts` → jaminLog `src/posts` 일괄 이관 스크립트 (`scripts/migrate-posts.mjs`, 68개 글 + 54개 이미지, 옵션 D 해석, 상세는 [content.md의 마이그레이션 섹션](specs/content.md#8-외부-jekyll-블로그에서의-마이그레이션))
- [x] 카테고리 디스플레이: URL은 하이픈(`개념-정리`), 화면은 공백(`개념 정리`) — `formatCategory()` 헬퍼

## 2차 (있으면 좋은 것)

- [ ] 검색 (제목/태그 클라이언트 검색)
- [ ] About 페이지
- [ ] RSS 피드
- [ ] 댓글 (giscus 등)
- [ ] 커스텀 도메인
- [ ] GitHub Actions 자동 배포
- [ ] 푸터에 GitHub/외부 링크
- [ ] draft 글을 번들에서 완전 배제 (`_drafts/` prefix + glob 패턴 분리)
