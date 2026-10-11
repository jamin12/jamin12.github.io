# jaminLog — 프로젝트 가이드

React 19 + Vite 기반 개인 블로그. **마크다운(`.md`) 파일을 읽어 글 본문으로 렌더링**하는 방식이고, GitHub Pages로 배포한다.

## 왜 이렇게 만들었나

버전·의존성·파일 구조는 `package.json`과 `src/`를 읽으면 알 수 있다. 여기엔 **코드를 봐도 안 나오는 전제**만 적는다.

### 글은 파일이다

모든 글은 `src/posts/` 아래의 마크다운 파일이다. DB도 CMS도 없다. git으로 버전 관리하고 에디터로 쓰고 빌드 타임에 번들된다.

의존성이 적을수록 오래 살아남는다. 10년 뒤에도 마크다운 파일은 열 수 있다.

### 폴더가 곧 사이트 구조다

카테고리 설정 파일이 없다. 폴더 이름이 카테고리명이 되고, 새 카테고리는 폴더를 만들면 생긴다. 글과 설정이 한 자리에 있어야 유지보수가 쉽다.

### 읽는 경험이 전부다

화려한 인터랙션보다 **타이포그래피·가독성·로딩 속도**가 우선이다. 개성은 그 위에 얹는다.

### Next.js·Astro를 쓰지 않는다

React 19의 새 API(`use()`, View Transition 등)를 실제로 써보는 것과, 블로그 엔진 내부를 직접 제어해 학습 실험장으로 쓰는 것이 목적이다. 프레임워크가 블랙박스로 가져가면 둘 다 안 된다. 정적 사이트 생성기를 쓰지 않는 비용은 알고 치르는 것이다.

---

## 필수: 작업 전 문서 확인

문서는 **읽는 목적**에 따라 두 갈래다. `docs/writing/`은 **규약**(지켜야 할 것), `docs/specs/`는 **설계 의도**(왜 그렇게 만들었는지)다.

아래 표에서 해당 문서를 **먼저 읽고** 작업한다. 문서를 읽지 않고 코드나 글을 고치지 않는다 — 여기 적힌 결정은 대부분 한 번 실패한 뒤에 나온 것이라, 모르고 손대면 같은 실패를 반복한다.

### 글을 쓸 때

| 작업 | 읽을 문서 |
| :--- | :--- |
| 새 글 작성 · frontmatter 필드 · 글이 목록에 안 뜰 때 | [`writing/frontmatter.md`](docs/writing/frontmatter.md) |
| 파일 배치 · slug · 카테고리 · 태그 · 시리즈 묶기 | [`writing/organizing.md`](docs/writing/organizing.md) |
| 본문 문법 (헤딩·코드블록·수식·mermaid·이미지·링크) · 문체 | [`writing/style.md`](docs/writing/style.md) |

### 블로그를 고칠 때

| 작업 영역 | 읽을 문서 |
| :--- | :--- |
| **UI·디자인 전반** — 색·서체·여백·톤 | [`.impeccable.md`](.impeccable.md) **먼저**, 그다음 아래 해당 spec |
| `src/lib/posts.ts` · `parse-frontmatter.js` · `scripts/build-posts-index.mjs` · 정렬 · 하위 카테고리 | [`specs/content.md`](docs/specs/content.md) |
| `src/pages/PostDetail.tsx` · `lib/shiki.ts` · `rehype-mermaid-passthrough.ts` · `components/{MermaidDiagram,TOC}.tsx` | [`specs/rendering.md`](docs/specs/rendering.md) |
| `src/App.tsx` 라우트 · 한글 slug 인코딩 · 404 · 스크롤 복원 · View Transition | [`specs/routing.md`](docs/specs/routing.md) |
| `src/App.css` · `components/*` · `pages/{PostList,CategoryPage,TagPage}.tsx` · 다크모드 · 반응형 | [`specs/layout.md`](docs/specs/layout.md) |
| `pages/Series*.tsx` · `components/SeriesStrip.tsx` · 시리즈 네비 | [`specs/series.md`](docs/specs/series.md) |
| `components/SEOHead.tsx` · `scripts/{generate-sitemap,prerender-meta}.mjs` · 메타 태그 | [`specs/seo.md`](docs/specs/seo.md) |
| `vite.config.js` · `package.json` 빌드 스크립트 · 배포 | [`specs/deployment.md`](docs/specs/deployment.md) |

`src/posts/**/*.md`는 글 파일이고 코드가 아니다. 여기를 고치는 건 "글을 쓸 때" 표를 따른다.

---

## 규칙

1. **React 19 최신 패턴을 쓴다.** `use()` hook, ref as prop 등 19의 새 API를 우선 고려한다.
2. **글(.md) 파일은 사용자 콘텐츠다.** 내용을 임의로 수정·생성하지 않는다. 읽어서 렌더링하는 것이 앱의 역할.
3. **한국어 파일명·폴더명**을 고려해 URL 인코딩·라우팅에서 주의한다.
4. **배포 전 `vite.config.js`의 `base`를 GitHub Pages repo 이름에 맞춰야** 한다 (현재는 `'./'`).

---

## 문서 유지

```
docs/
├── writing/             # 글을 쓸 때 — 3개
│   ├── frontmatter.md   # 필드 스키마·검증·새 글 절차
│   ├── organizing.md    # 파일 배치 + 카테고리·태그·시리즈 선택 기준
│   └── style.md         # 표준 마크다운과 다른 것 + 문체
└── specs/               # 블로그를 만들 때 — 도메인별 7개
    content · rendering · routing · layout · series · seo · deployment
```

**인덱스 파일을 두지 않는다.** 허브 문서는 내용 없이 링크만 모으다가 실제 문서와 어긋난다. 문서 간 연결은 각 파일 끝의 "연관" 표가 담당한다.

**겹치는 사실은 `writing/`이 원천이다.** frontmatter 스키마, 파일 배치, 지원 문법은 `writing/`에만 적고 `specs/`는 링크만 건다. 두 곳에 적으면 반드시 한쪽이 낡는다. `specs/`가 그 주제를 다룰 때는 "왜 그 계약인가"만 쓴다.

**마크다운 일반 문법을 적지 않는다.** `writing/style.md`는 이 블로그에서만 다른 것(h2부터 시작, 지원 언어 16개, mermaid, `./images/` 경로)만 담는다. 표·리스트·인용 같은 표준 문법 설명은 넣지 않는다.

**기능 체크리스트는 두지 않는다.** 무엇이 구현됐는지는 코드를 읽으면 알 수 있고, 그런 문서는 반드시 코드와 어긋난다. `docs/`에는 **코드로 복원할 수 없는 것만** 남긴다 — 기각한 대안, 트레이드오프, 도입하지 않기로 한 결정과 그 이유. 아직 안 만든 것은 별도 백로그를 만들지 말고 **해당 도메인 spec 안에** "미착수"로 적는다 (배포는 `deployment.md`, RSS·OG는 `seo.md`, 검색·About은 `routing.md`).

`specs/` 작성 스타일:
- **왜**는 산문으로, **무엇·값·규칙·상태·권한**은 표로
- 의사결정은 "후보 비교 → 결정 → 이유" 패턴
- 공식·계산엔 항상 예시 숫자
- 끝 섹션은 "연관 도메인" 표로 마무리

### 규칙

5. **나와 상의해서 기획한 것은 그 자리에서 끝내지 말고 `docs/`에 기록한다.**
   - 설계 결정·도메인 분리·기술 선택·트레이드오프는 해당 `docs/specs/<도메인>.md`에 반영한다
   - 새 도메인이 생기면 새 spec 파일을 만들고, **위 라우팅 표에 한 줄 추가**한 뒤 관련 기존 spec의 "연관 도메인" 표에도 연결한다. 표에 없는 문서는 아무도 안 읽는다
   - 작성 스타일은 위 원칙과 기존 spec 파일을 기준으로 유지한다 (갑자기 톤·포맷이 바뀌면 기획서 전체가 어수선해진다)

6. **기능을 추가·변경·제거할 때는 `docs/`도 같은 작업 안에서 동기화한다.**
   - 영향받는 `docs/specs/*.md` 섹션을 수정한다
   - 미착수로 적어둔 것을 구현했다면 해당 spec의 그 문장을 지운다
   - 이전 결정이 바뀌었다면 **"왜 바뀌었는지"도 함께 기록**한다. 낡은 결정을 조용히 지우지 않는다 — 번복 이유가 다음 번복을 막는다
   - 수치(번들 크기 등)를 갱신할 때는 측정 시점을 함께 적는다
   - 코드와 docs가 어긋나면 기획서의 가치는 사라진다. 동기화는 "나중에"가 아니라 **해당 작업 단위 안에서** 처리한다

7. **작성자 계약이 바뀌면 `docs/writing/`을 같은 작업 안에서 고친다.**
   - frontmatter 필드 추가·삭제, 지원 문법 변경, 파일 배치 규칙 변경, 분류 축 변경은 전부 계약 변경이다
   - `writing/`을 먼저 고치고, 관련 `specs/`에는 **"왜 그렇게 바꿨는지"만** 남긴다 (필드 표를 복붙하지 않는다)
   - 글을 쓰다가 정한 문체 판단은 `writing/style.md`에 이유와 함께 추가한다
