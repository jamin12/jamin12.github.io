// ─────────────────────────────────────────
// 하위 카테고리 (subcategory) 규칙
//
// 설계 맥락 (docs/specs/content.md §8 옵션 D의 보완):
// - Jekyll 이관 시 옵션 D("상위만 카테고리, 하위는 태그")로 물리 구조를 평탄화했으나,
//   그 결과 "개념-정리" 41글이 한 덩어리로 보여 탐색성이 0에 가까웠음
// - 파일/URL을 건드리지 않고 **기존 태그를 재활용**해 UI 레벨에서 하위 그룹을 복원
// - 각 카테고리별로 ordered rule 배열. 더 구체적인 규칙이 앞에 와야 함
//   (예: argo-rollouts는 kubernetes보다 우선 → deployment 서브로 빠짐)
//
// 정확도: 2026-04-05 posts-meta.json 전수 검증 기준 68/68
//
// 새 카테고리/주제가 추가되면 이 파일만 수정. 전역 변수는 없음
// ─────────────────────────────────────────

export const SUBCATEGORY_RULES = {
  '개념-정리': [
    { slug: 'network',       label: '네트워크',       tags: ['network'] },
    { slug: 'elasticsearch', label: 'Elasticsearch',  tags: ['elasticsearch'] },
    { slug: 'deployment',    label: '배포 전략',       tags: ['canary', 'blue-green', 'argo-rollouts'] },
    { slug: 'cdc',           label: 'Pact · CDC',     tags: ['pact', 'cdc'] },
    // spring 규칙은 java 태그를 포함하지 않음 — jackson-polymorphic이 java 태그를 가지지만
    // 내용은 Jackson 관련이라 spring으로 묶이면 안 됨
    { slug: 'spring',        label: 'Spring',         tags: ['spring', 'spring-boot', 'event', 'listener', 'valid', 'validated'] },
    { slug: 'nextjs',        label: 'Next.js',        tags: ['Next.js', 'nextJs'] },
    { slug: 'jackson',       label: 'Jackson',        tags: ['jackson'] },
    // redis 규칙은 streams 태그만 잡음 — jackson-polymorphic이 redis 태그도 가지기 때문
    { slug: 'redis',         label: 'Redis Streams',  tags: ['streams'] },
    { slug: 'monitoring',    label: '모니터링',        tags: ['monitoring'] },
    { slug: 'ci',            label: 'CI/CD',           tags: ['CI'] },
    { slug: 'cs',            label: 'CS 기초',         tags: ['cs'] },
    { slug: 'database',      label: '데이터베이스',    tags: ['databases'] },
    // kubernetes는 맨 마지막. argo-rollouts(kubernetes 태그도 포함)가 먼저 deployment로 빠진 뒤,
    // 순수 k8s 스토리지/권한 관련 글(Pv-pvc, storageClass 등)만 여기로 떨어짐
    { slug: 'kubernetes',    label: 'Kubernetes',     tags: ['k8s', 'kubernetes'] },
  ],

  '코테': [
    { slug: 'dp',     label: 'DP',           tags: ['dp'] },
    { slug: 'graph',  label: '그래프 · BFS', tags: ['graph', 'bfs'] },
    { slug: 'string', label: '문자열',       tags: ['string'] },
    { slug: 'math',   label: '수학',         tags: ['math'] },
  ],

  // 4글 뿐이라 하위 그룹 없이 flat 유지 (자연스럽게 묶이는 주제도 없음)
  '트러블-슈팅': [],
}

// 카테고리 + 태그 배열 → 매칭되는 첫 rule (없으면 null)
// 빌드 타임에 build-posts-index.mjs가 호출해서 각 글의 subcategory 필드를 채움
export function getSubcategory(category, tags) {
  const rules = SUBCATEGORY_RULES[category]
  if (!rules || rules.length === 0) return null
  for (const rule of rules) {
    if (rule.tags.some((t) => tags.includes(t))) {
      return rule
    }
  }
  return null
}

// 카테고리의 전체 subcategory 정의 (UI 네비에서 사용)
export function getSubcategoriesForCategory(category) {
  return SUBCATEGORY_RULES[category] || []
}
