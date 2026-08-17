# Frontmatter

모든 글은 `.md` 파일 최상단에 YAML로 메타데이터를 선언한다. 이게 글에 대해 블로그가 아는 전부다.

## 새 글 절차

```
1. src/posts/<카테고리>/<slug>.md 생성        → 배치 규약은 organizing.md
2. frontmatter 작성 (title·date 필수)
3. 본문 작성                                  → 본문 규약은 style.md
4. 이미지는 카테고리 폴더 아래 images/ 에
5. pnpm dev 로 확인
```

등록할 곳도, 고칠 설정 파일도 없다. 파일을 올바른 자리에 두면 빌드가 인식한다.

---

## 최소 형태

```markdown
---
title: HTTP 기초
date: 2026-04-05
---

본문 시작...
```

`title`과 `date` 둘만 필수다. 나머지는 필요할 때 붙인다.

## 전체 예시

```markdown
---
title: CDC 기술 선정
date: 2025-12-18
tags: [cdc, kafka, debezium]
summary: Debezium과 Maxwell을 비교하고 Debezium을 고른 이유
cover: ./images/cdc-architecture.png
series: CDC 도입기
seriesOrder: 2
order: 1
draft: false
---
```

---

## 필드

| 필드 | 필수 | 타입 | 하는 일 |
|------|------|------|--------|
| `title` | ✅ | string | 글 제목. 목록 카드·상세 헤더·브라우저 탭에 쓰인다 |
| `date` | ✅ | `YYYY-MM-DD` | 정렬 1순위이자 목록에 표시되는 날짜 |
| `tags` | ⬜ | string[] | 태그 필터. 하위 카테고리 자동 분류의 입력이기도 하다 → [organizing.md](organizing.md) |
| `summary` | ⬜ | string | 목록 카드의 미리보기 한두 줄. 없으면 카드에 제목만 |
| `cover` | ⬜ | `./images/<파일>` | 홈 히어로·카테고리 카드의 대표 이미지. 없으면 카테고리 letter-mark 그라데이션이 대신 들어간다 |
| `draft` | ⬜ | boolean | `true`면 프로덕션 빌드의 목록·라우팅에서 제외. dev에서는 "초안" 배지와 함께 보인다 |
| `order` | ⬜ | number | **같은 날짜** 글끼리의 순서 (작은 값이 위). 날짜를 넘지 못한다 |
| `series` | ⬜ | string | 시리즈 이름. 같은 문자열이면 같은 시리즈 → [organizing.md](organizing.md) |
| `seriesOrder` | ⬜ | number | 시리즈 내 순서 (1부터). `series`가 있으면 사실상 필수 |

### `date`

정렬의 1순위다. 미래 날짜를 넣으면 경고만 하고 그대로 포함하므로, 예약 발행 용도로는 쓸 수 없다.

시각은 넣지 않는다. 날짜까지만 본다.

### `order`

같은 날 여러 글을 올렸을 때만 의미가 있다. 이 값은 **날짜를 이기지 못한다** — `order: 1`을 붙여도 더 최신 날짜의 글보다 위로 올라가지 않는다. 같은 날 묶음의 읽는 순서를 고정하는 용도다.

없으면 그날 글 중 맨 아래에서 slug 이름순으로 들어간다.

카테고리를 넘나드는 순서는 `order`가 아니라 `series`가 담당한다.

### `cover`

본문 이미지와 완전히 같은 규칙이다. 카테고리 폴더 아래 `images/`에 두고 `./images/<파일>`로 적는다.

### `summary`

목록 카드에서 제목 아래 들어간다. 본문 첫 문단을 자동으로 잘라 쓰지 않으므로, 없으면 그냥 안 나온다.

---

## 검증

빌드가 잡아주는 것과 잡아주지 않는 것이 갈린다.

| 상황 | 결과 |
|------|------|
| `title` 또는 `date` 누락 | **빌드 경고 + 해당 글 스킵** — 목록에 아예 안 나온다 |
| `date`가 미래 | 경고만, 정상 포함 |
| `draft: true` | 프로덕션 제외, dev 포함 |
| `series`만 있고 `seriesOrder` 없음 | **검증 없음** — 순서가 조용히 어긋난다 |
| 같은 시리즈 안에서 `seriesOrder` 중복 | **검증 없음** |
| `series` 이름 오타 | **검증 없음** — 1편짜리 시리즈가 조용히 생긴다 |

아래 세 개는 빌드가 안 잡아주니 시리즈를 묶을 때 직접 확인한다. 검증 규칙을 넣자는 논의와 그 상태는 [`specs/series.md` §4](../specs/series.md#4-frontmatter-스키마)에 있다.

---

## 안 보일 때

`pnpm dev`는 `.md` 변경을 감지해 메타 인덱스를 자동으로 다시 만든다. 그래도 글이 안 보이면 대개 셋 중 하나다.

| 증상 | 원인 |
|------|------|
| 목록에 아예 없음 | `title` 또는 `date` 누락 — 빌드 경고 후 스킵된다. 콘솔 확인 |
| dev엔 보이는데 배포본에 없음 | `draft: true` |
| 잘못된 카테고리에 있음 | 파일이 다른 폴더에 있음 |

이미지가 안 뜨면 경로 오타다. 조용히 숨기지 않고 404를 그대로 노출하니 콘솔에 보인다.

### `draft`

dev 서버에서는 "초안" 배지와 함께 보이고, 프로덕션 빌드의 목록·라우팅에서는 빠진다. 다만 **번들에는 포함되므로** 완전한 비공개가 아니다. 남에게 절대 보이면 안 되는 내용은 커밋하지 않는다.

---

## 연관

| 문서 | 관계 |
|------|------|
| [organizing.md](organizing.md) | 파일을 어디에 두나 + `tags`·`series`·`order`를 실제로 어떻게 고르나 |
| [style.md](style.md) | frontmatter 아래 본문 규약 |
| [`specs/content.md`](../specs/content.md) | 이 필드들이 빌드에서 어떻게 처리되는지, 왜 이 스키마인지 |
