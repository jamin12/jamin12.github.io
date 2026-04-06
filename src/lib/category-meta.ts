// ─────────────────────────────────────────
// 카테고리 메타 — 이름 첫 글자 letter-mark
//
// 설계 원칙 (docs/specs/layout.md §2.5 4차 참조):
// - 카테고리별 **색상 매핑·이모지 모두 사용하지 않음**. Electric Blue 단일 액센트 + 타이포그래피 규율 유지
// - 시각적 구분은 **이름의 첫 글자**를 Fraunces serif로 letter-mark 처리 (사이드바 'J' 아바타와 동일 패턴)
// - 카드 배경·테두리는 공통 토큰(`--bg-subtle`, `--border`, `--accent-tint`)
//
// 이 파일은 데이터/헬퍼 전용. 스타일은 App.css의
// `.category-card__mark`, `.sidebar__nav-mark`, `.hero-post__fallback-mark`에서 처리
// ─────────────────────────────────────────

import { getSubcategoriesForCategory } from './subcategory-rules.js'

// 카테고리 이름의 첫 글자 (하이픈/공백/언더스코어 제거 후)
// 예: "개념-정리" → "개", "코테" → "코", "react" → "R"
export function getCategoryLetter(name) {
  const cleaned = String(name || '').replace(/[-_\s]/g, '')
  const ch = cleaned.charAt(0)
  // 라틴 문자는 대문자화, 한글/기타 스크립트는 그대로
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch || '·'
}

// 포스트의 서브카테고리 라벨 반환. 없으면 null.
export function getSubcategoryLabel(category, subcategory) {
  if (!subcategory) return null
  const rule = getSubcategoriesForCategory(category)
    .find((r) => r.slug === subcategory)
  return rule?.label ?? null
}
