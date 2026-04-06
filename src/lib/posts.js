// ─────────────────────────────────────────
// 콘텐츠 파이프라인 (메타 즉시 로드 + 본문 lazy)
//
// - 메타(title/date/tags/summary/slug/category/readingTime)는 prebuild로 JSON 생성되어
//   초기 번들에 들어간다. 홈·카테고리·태그 페이지는 이것만 있으면 된다.
// - 본문은 Vite의 lazy glob으로 파일당 별도 chunk가 되어 글 진입 시점에만 로드된다.
// - 빌드/dev 자동 생성: vite.config.js의 postsIndexPlugin이 처리
// ─────────────────────────────────────────

import metaJson from './posts-meta.json'
import { parseFrontmatter } from './parse-frontmatter.js'
import { getSubcategoriesForCategory } from './subcategory-rules.js'

// ── 본문 lazy 로더 ──
// eager: false (기본값). 각 .md 파일은 별도 dynamic chunk로 분리됨
const bodyModules = import.meta.glob('../posts/**/*.md', {
  query: '?raw',
  import: 'default',
})

// ── 이미지 맵은 경량 (경로→URL 매핑)이라 eager 유지 ──
const imageModules = import.meta.glob(
  '../posts/**/images/*.{png,jpg,jpeg,svg,webp,gif}',
  { eager: true, import: 'default' }
)

// ── Post 배열 (메타데이터만, 날짜 내림차순 정렬은 prebuild에서 완료) ──
// draft: true는 프로덕션에서 제외, dev에선 포함
export const posts = metaJson.filter(
  (p) => !(import.meta.env.PROD && p.draft)
)

// ── 카테고리 인덱스 ──
export const categories = [...new Set(posts.map((p) => p.category))]
  .map((name) => ({
    name,
    count: posts.filter((p) => p.category === name).length,
  }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))

// ── 태그 인덱스 ──
const tagMap = new Map()
for (const p of posts) {
  for (const t of p.tags) tagMap.set(t, (tagMap.get(t) || 0) + 1)
}
export const tags = [...tagMap.entries()]
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))

// ── 조회 함수 ──
export function getPostBySlug(slug) {
  return posts.find((p) => p.slug === slug)
}

export function getPostsByCategory(category) {
  return posts.filter((p) => p.category === category)
}

export function getPostsByTag(tag) {
  return posts.filter((p) => p.tags.includes(tag))
}

// 카테고리 안의 subcategory 그룹 인덱스.
// 정의된 rule 순서를 유지하며 빈 subcategory(해당 글 0개)는 제거.
// 각 그룹 객체: { slug, label, posts, count }
export function getSubcategoriesByCategory(categoryName) {
  const rules = getSubcategoriesForCategory(categoryName)
  const out = []
  for (const rule of rules) {
    const list = posts.filter(
      (p) => p.category === categoryName && p.subcategory === rule.slug
    )
    if (list.length > 0) {
      out.push({ ...rule, posts: list, count: list.length })
    }
  }
  return out
}

// 카테고리 내 특정 subcategory의 글만 조회
export function getPostsBySubcategory(category, subcategorySlug) {
  return posts.filter(
    (p) => p.category === category && p.subcategory === subcategorySlug
  )
}

// subcategory 규칙에 매칭되지 않은 "나머지" 글 — 트러블-슈팅처럼 규칙 없는 카테고리,
// 또는 새 태그 조합이라 아직 매핑되지 않은 글이 여기에 들어감
export function getUngroupedPostsByCategory(categoryName) {
  return posts.filter(
    (p) => p.category === categoryName && !p.subcategory
  )
}

// ── 시리즈 인덱스 ──
// 카테고리·태그와 독립적인 순서 있는 글 묶음.
// 같은 series 문자열을 가진 글들이 seriesOrder 순으로 정렬된다.
const seriesMap = new Map()
for (const p of posts) {
  if (!p.series) continue
  if (!seriesMap.has(p.series)) seriesMap.set(p.series, [])
  seriesMap.get(p.series).push(p)
}
for (const items of seriesMap.values()) {
  items.sort((a, b) => a.seriesOrder - b.seriesOrder)
}

export const seriesList = [...seriesMap.entries()]
  .map(([name, items]) => ({ name, count: items.length, posts: items }))
  .sort((a, b) => b.posts[0]?.date.localeCompare(a.posts[0]?.date))

export function getPostsBySeries(seriesName) {
  return seriesMap.get(seriesName) || []
}

export function getSeriesNav(slug) {
  const post = posts.find((p) => p.slug === slug)
  if (!post?.series) return null
  const ordered = getPostsBySeries(post.series)
  const idx = ordered.findIndex((p) => p.slug === slug)
  if (idx === -1) return null
  return {
    series: post.series,
    current: idx + 1,
    total: ordered.length,
    prev: idx > 0 ? ordered[idx - 1] : null,
    next: idx < ordered.length - 1 ? ordered[idx + 1] : null,
    all: ordered,
  }
}

// ── 본문 lazy 로더 ──
// React 19 `use(promise)` 훅과 Suspense로 소비.
// 같은 글을 반복 방문할 때 promise를 캐시해서 재요청 방지.
const bodyPromiseCache = new Map()
export function getPostBodyPromise(category, slug) {
  const key = `${category}/${slug}`
  if (bodyPromiseCache.has(key)) return bodyPromiseCache.get(key)
  const modulePath = `../posts/${category}/${slug}.md`
  const loader = bodyModules[modulePath]
  if (!loader) {
    const rejected = Promise.reject(
      new Error(`본문을 찾을 수 없습니다: ${modulePath}`)
    )
    bodyPromiseCache.set(key, rejected)
    return rejected
  }
  const promise = loader().then((raw) => {
    const { content } = parseFrontmatter(raw)
    return content
  })
  bodyPromiseCache.set(key, promise)
  return promise
}

// ── 카테고리 디스플레이 이름 ──
// URL/파일시스템은 하이픈(`개념-정리`), 화면 표시는 공백(`개념 정리`)
export function formatCategory(name) {
  return String(name).replace(/-/g, ' ')
}

// ── 이미지 경로 해석 ──
// 마크다운의 `./images/foo.png` → Vite가 번들한 최종 URL
export function resolveImageSrc(src, category) {
  if (!src || !src.startsWith('./images/')) return src
  const key = `../posts/${category}/${src.slice(2)}`
  return imageModules[key] ?? src
}
