# 배포 (Deployment)

> 작성일: 2026-04-05

---

## 1. 역할

빌드된 정적 파일(`dist/`)을 GitHub Pages에 배포하는 프로세스를 정의한다.

블로그는 서버가 필요 없는 정적 사이트이므로, GitHub Pages의 무료 호스팅이 충분하다. 추가 인프라 비용·운영 부담이 없다.

---

## 2. 배포 타겟

| 항목 | 값 |
|------|-----|
| 호스트 | GitHub Pages |
| URL 형식 | `https://<username>.github.io/<repo>/` |
| 배포 브랜치 | `gh-pages` (자동 생성) |
| 배포 도구 | `gh-pages` npm 패키지 (이미 설치됨) |

### 왜 GitHub Pages인가

| 후보 | 장단점 |
|------|--------|
| **GitHub Pages** | 무료, 소스 관리와 같은 자리, 설정 최소 |
| Vercel | 더 빠른 전파·PR 프리뷰, 커스텀 도메인 쉬움. 필요해지면 전환 |
| Netlify | Vercel과 유사 |
| Cloudflare Pages | 네트워크 우수. 대안 |

개인 블로그 규모에서는 전부 오버스펙. GitHub Pages로 시작하고, 필요 시 Vercel로 전환한다.

---

## 3. Vite `base` 경로

### 문제

GitHub Pages는 `https://username.github.io/jaminLog/`처럼 **하위 경로**에 배포된다. Vite 기본 `base: '/'`로 빌드하면 에셋 경로가 `/assets/...`가 되어 하위 경로 환경에서 404가 난다.

### 규칙

| 환경 | base | 이유 |
|------|------|------|
| 로컬 dev | `'/'` | 루트에서 서빙 |
| GitHub Pages 배포 | `'/jaminLog/'` | repo명과 일치 |
| 커스텀 도메인 사용 시 | `'/'` | 루트 배포로 복귀 |

### 현재 상태

`vite.config.js:7`은 `base: './'` (상대경로)로 되어 있다. 상대경로는 단순한 정적 에셋 로딩에는 작동하지만, **클라이언트 라우터**(React Router)와 조합될 때 내부 네비게이션에서 경로가 꼬일 수 있다.

라우터 추가 시 절대 경로 `/jaminLog/`로 변경 필수.

### 환경별 분기

```js
// vite.config.js
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/jaminLog/' : '/',
}))
```

---

## 4. React Router `basename` 연동

Vite `base`와 React Router `basename`이 서로 일치해야 라우팅이 정상 작동한다.

```jsx
<BrowserRouter basename={import.meta.env.BASE_URL}>
  ...
</BrowserRouter>
```

`import.meta.env.BASE_URL`은 Vite `base` 값을 그대로 노출하므로 자동 동기화된다. 수동으로 문자열을 중복 관리하지 않는다.

---

## 5. SPA 404 폴백

### 문제

GitHub Pages는 기본적으로 SPA 폴백을 지원하지 않는다. `/posts/foo`로 직접 접속하면 GitHub가 `posts/foo/index.html`을 찾다가 진짜 404를 반환해버려 React 앱이 아예 마운트되지 못한다.

새로고침·외부 링크 진입이 전부 깨지므로 블로그에 치명적.

### 해결: 404.html 트릭

1. `public/404.html`에 루트 `index.html`과 동일한 내용을 넣는다
2. GitHub Pages는 404 시 `404.html`을 서빙한다
3. `404.html`이 `index.html`과 동일하므로 SPA가 마운트되고, React Router가 현재 URL을 읽어 정상 라우팅한다

### 자동화

매번 수동으로 `index.html`을 복사하지 않도록, 빌드 후 스크립트로 자동 복사한다.

```json
// package.json
"scripts": {
  "build": "vite build && cp dist/index.html dist/404.html",
  "deploy": "pnpm build && gh-pages -d dist"
}
```

Windows bash(현 환경)에서는 `cp`가 작동한다. Node 스크립트로 작성해도 된다.

---

## 6. 빌드/배포 명령

| 명령 | 설명 |
|------|------|
| `pnpm dev` | 로컬 개발 서버 (hot reload) |
| `pnpm build` | `dist/` 생성 + sitemap.xml + 라우트별 HTML 프리렌더 + 404.html |
| `pnpm preview` | 빌드 결과 로컬 확인 (배포 전 필수) |
| `pnpm deploy` | `gh-pages -d dist` 실행 |

### 빌드 파이프라인 상세 (2026-04-10 추가)

```
pnpm build
  = vite build
  → node scripts/generate-sitemap.mjs   (posts-meta.json → dist/sitemap.xml)
  → node scripts/prerender-meta.mjs     (각 라우트별 index.html에 메타 태그 주입 + 404.html 생성)
```

sitemap과 프리렌더 스크립트는 `vite build` 이후 순차 실행된다. 상세는 [specs/seo.md](seo.md) 참조.

### 배포 체크리스트

1. 새 글·수정 사항 git commit
2. `pnpm build` 성공 확인
3. `pnpm preview`로 로컬에서 라우팅·이미지·다크모드 확인
4. `pnpm deploy` 실행
5. 1~2분 대기 후 실제 URL에서 확인
6. 직접 링크 접속(`/posts/...`) 테스트 — 404 폴백 작동 검증

`pnpm preview`는 GitHub Pages와 유사한 하위 경로 환경을 시뮬레이션하므로, 여기서 깨지면 배포해도 깨진다. **반드시 preview 후 deploy**.

---

## 7. 커스텀 도메인 (선택, 2차)

### 전환 절차

1. `public/CNAME` 파일에 도메인 한 줄 (`blog.example.com`)
2. DNS에서 GitHub Pages IP로 A 레코드 또는 CNAME 설정
3. Vite `base`를 `/`로 되돌리기 (`vite.config.js`)
4. GitHub repo Settings → Pages에서 Custom domain 입력
5. "Enforce HTTPS" 체크

### 지금 안 하는 이유

- 도메인 비용 + 연간 갱신 부담
- 블로그가 자리 잡기 전에 URL을 바꾸면 외부 링크가 깨짐
- GitHub 하위 도메인도 충분히 프로페셔널

글 10~20개 쌓이고 주소 공유가 잦아지면 검토.

---

## 8. GitHub Actions 자동 배포 (선택, 2차)

### 장점

- 수동 `pnpm deploy` 불필요
- 여러 기기에서 글 작성 후 git push만 하면 배포됨
- 빌드 실패 즉시 알림

### 단점 (지금 안 하는 이유)

- 설정 추가 (`.github/workflows/deploy.yml`)
- 빌드 로그 디버깅 필요
- 현재는 혼자 쓰는 단일 기기라 이득 적음

글 작성 빈도가 늘거나 여러 기기에서 작성하게 되면 전환.

---

## 9. 연관 도메인

| 도메인 | 관계 |
|--------|------|
| **Routing** | `basename`·SPA 404 폴백이 라우터와 직접 연결 |
| **Content** | 새 글 추가 후 재빌드·재배포 필요 (빌드 타임 번들이므로) |
