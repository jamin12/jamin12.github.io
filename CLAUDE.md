# jaminLog — 프로젝트 가이드

React 19 + Vite 기반 개인 블로그. **마크다운(`.md`) 파일을 읽어 글 본문으로 렌더링**하는 방식이고, GitHub Pages로 배포한다.

## 프로젝트 컨텍스트

- **스택**: React 19.2, Vite 5, JS(JSX)
- **글 형식**: 마크다운 파일 기반. 파일 하나 = 글 하나.
- **배포**: GitHub Pages (`gh-pages` 패키지 사용 예정)
- **현재 상태**: 초기 세팅 완료 (Vite + React 19 설치, 기본 App 컴포넌트만 존재)

### 콘텐츠 구조 (확정)

```
src/posts/
├── <카테고리>/
│   ├── <slug>.md
│   └── images/
│       └── <글에서 참조할 이미지>
```

- **저장 위치**: `src/posts/` (Vite `import.meta.glob`으로 빌드 타임에 번들)
- **폴더 = 카테고리**: 카테고리별로 폴더 분리
- **파일명**: `<slug>.md` (날짜는 파일명에 넣지 않음)
- **메타데이터**: frontmatter(YAML)에 `title`, `date`, `tags` 등 선언
  ```markdown
  ---
  title: HTTP 기초
  date: 2026-04-05
  tags: [http, network]
  ---
  ```
- **이미지**: 해당 글이 속한 카테고리 폴더 아래 `images/`에 둔다 (글 옆에 둠). 마크다운 안에서는 상대경로로 참조.
- **로딩 방식**: `import.meta.glob('./posts/**/*.md', { query: '?raw', import: 'default', eager: true })`

---

## 상황별 스킬 사용 가이드

`.claude/skills/` 에 설치된 스킬 중 **이 블로그 프로젝트에 핵심적으로 쓰일 20개**만 남겨놓았다. 각 스킬은 `SKILL.md`의 description 트리거 키워드로 자동 발동되며, 명시적으로 부르려면 `/<skill-name>` 으로 호출한다.

### 0. 최초 1회 세팅 (모든 디자인 스킬의 전제)

| 스킬 | 역할 |
|---|---|
| `teach-impeccable` | 프로젝트 디자인 컨텍스트(브랜드·톤·참조 이미지·타겟 사용자)를 수집해 AI 설정에 저장. **블로그 디자인 스킬 쓰기 전 최초 1회 실행.** |
| `frontend-design` | 디자인 원칙·안티패턴(generic AI look 회피)·Context Gathering Protocol 정의. 대부분의 디자인 스킬이 호출 전에 이 스킬을 자동 주입한다. |

### 1. 레이아웃 · 타이포 · 품질 (가장 자주 씀)

블로그는 **읽는 경험**이 전부라 이 그룹이 핵심이다.

| 상황 | 스킬 |
|---|---|
| 레이아웃·여백·시각적 리듬이 어색할 때 | `arrange` |
| 폰트·크기·위계·가독성 개선 (마크다운 본문 H1~H6, 코드블록, 인용구) | `typeset` |
| 출시 직전 미세한 정렬·일관성 마지막 패스 | `polish` |
| 요소가 많아 어수선 → 단순화·클러터 제거 | `distill` |

### 2. 반응형 · 견고성 · 성능

| 상황 | 스킬 |
|---|---|
| 모바일·태블릿·데스크톱 반응형, 터치 타겟 | `adapt` |
| 에러 상태·빈 상태·텍스트 오버플로우·i18n·엣지 케이스 | `harden` |
| 로딩·렌더링·번들·이미지 성능 튜닝 | `optimize` |
| 접근성·성능·테마·반응형 기술 품질 리포트 (P0~P3) | `audit` |
| UX 관점 정성/정량 리뷰 (시각 위계, 인지 부하, 페르소나 테스트) | `critique` |
| 빈 카테고리·첫 방문·404 같은 빈 상태·첫 사용 흐름 | `onboard` |

### 3. 개성 · 모션 · 카피 (개인 블로그 느낌 살리기)

| 상황 | 스킬 |
|---|---|
| 너무 안전·밋밋·제네릭 → 임팩트·개성 강화 | `bolder` |
| 너무 회색·무채색 → 전략적 색 추가 | `colorize` |
| 기능적 UI에 즐거움·마이크로 인터랙션 추가 | `delight` |
| 목적 있는 애니메이션·트랜지션·호버 효과 | `animate` |
| 라벨·에러 메시지·카피·인스트럭션 개선 | `clarify` |

### 4. React 19 / Vercel 공식 가이드

블로그 프로젝트가 React 19 + Vite라 이 3개는 전부 핵심.

| 상황 | 스킬 |
|---|---|
| React 성능 최적화 패턴 (렌더링·메모이제이션·번들) | `vercel-react-best-practices` |
| View Transition API로 페이지 전환·공유 요소 애니메이션 | `vercel-react-view-transitions` |
| compound components, 재사용 API 설계, **React 19 API 변경 포함** | `vercel-composition-patterns` |

---

## 이 프로젝트에서 자주 쓸 조합

- **최초 1회** → `teach-impeccable` → `frontend-design`
- **기본 페이지 레이아웃 & 타이포** → `arrange` + `typeset`
- **마크다운 본문 가독성 (H1~H6, 코드블록, 인용)** → `typeset` → `polish`
- **글 목록 ↔ 상세 전환 애니메이션** → `vercel-react-view-transitions` + `animate`
- **모바일 대응** → `adapt`
- **성능 이슈** → `optimize` → `vercel-react-best-practices`
- **빈 카테고리·로딩·에러 상태** → `harden` + `onboard`
- **개성이 부족할 때** → `bolder` 또는 `colorize` 또는 `delight`
- **React 19 패턴·컴포지션 설계** → `vercel-composition-patterns`
- **출시 전 전반 감사** → `critique` + `audit` → `polish`

---

## 규칙

1. **React 19 최신 패턴을 쓴다.** `use()` hook, Server Components(해당 시), ref as prop 등 19의 새 API를 우선 고려한다.
2. **글(.md) 파일은 사용자 콘텐츠다.** 내용을 임의로 수정·생성하지 않는다. 읽어서 렌더링하는 것이 앱의 역할.
3. **한국어 파일명·폴더명**을 고려해 URL 인코딩·라우팅에서 주의한다 (공백·한글 포함 경로 가능성).
4. **배포 전 `vite.config.js`의 `base`를 GitHub Pages repo 이름에 맞춰야** 한다 (현재는 `'./'`).

---

## 문서화 (`docs/`)

`docs/`는 **구현 가이드가 아니라 기획·설계 의도의 기록**이다. 나중에 "왜 이렇게 만들었지?"를 코드만 보고 복원할 수 없는 결정(대안 비교, 트레이드오프, 의사결정 배경)을 보존하는 것이 목적이다.

구조는 2계층:
- `docs/features.md` — 기능 체크리스트 + 각 섹션은 해당 spec으로 링크
- `docs/specs/*.md` — 도메인 단위 기획서 (content, rendering, routing, layout, deployment …), `overview.md`가 허브

작성 스타일:
- **왜**는 산문으로, **무엇·값·규칙·상태·권한**은 표로
- 의사결정은 "후보 비교 → 결정 → 이유" 패턴
- 공식·계산엔 항상 예시 숫자
- 끝 섹션은 "연관 도메인" 표로 마무리

### 규칙

5. **나와 상의해서 기획한 것은 그 자리에서 끝내지 말고 `docs/`에 기록한다.**
   - 설계 결정·도메인 분리·기술 선택·트레이드오프는 해당 `docs/specs/<도메인>.md`에 반영한다
   - 새 도메인이 생기면 새 spec 파일을 만들고 `docs/specs/overview.md`의 spec 인덱스와 `docs/features.md`의 섹션 링크에 추가한다
   - 작성 스타일은 위 원칙과 기존 spec 파일을 기준으로 유지한다 (갑자기 톤·포맷이 바뀌면 기획서 전체가 어수선해진다)

6. **기능을 추가·변경·제거할 때는 `docs/`도 같은 작업 안에서 동기화한다.**
   - `docs/features.md` 체크박스 상태를 실제와 맞춘다 (`[ ]` → `[x]` 또는 그 반대)
   - 영향받는 `docs/specs/*.md` 섹션을 수정한다
   - 이전 결정이 바뀌었다면 **"왜 바뀌었는지"도 함께 기록**한다. 낡은 결정을 조용히 지우지 않는다 — 번복 이유가 다음 번복을 막는다
   - 새 버전·라이브러리·수치(번들 크기 등)가 확정되면 `overview.md`의 기술 스택 표와 관련 spec을 갱신한다
   - 코드와 docs가 어긋나면 기획서의 가치는 사라진다. 동기화는 "나중에"가 아니라 **해당 작업 단위 안에서** 처리한다
