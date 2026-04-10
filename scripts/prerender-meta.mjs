/**
 * 프리렌더링 메타 태그 주입기
 *
 * 빌드 결과(dist/index.html)를 템플릿으로, 각 라우트별 HTML 파일을 생성한다.
 * 소셜 미디어 크롤러(Facebook, Twitter 등)는 JS를 실행하지 않으므로
 * 정적 HTML에 OG 태그가 있어야 제대로 미리보기가 나온다.
 *
 * 생성 파일 예시:
 *   dist/posts/<slug>/index.html
 *   dist/categories/<category>/index.html
 *   dist/series/index.html
 *   dist/tags/<tag>/index.html
 *
 * 실행: node scripts/prerender-meta.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')
const META_PATH = path.resolve(__dirname, '../src/lib/posts-meta.json')
const SITE_URL = 'https://jamin12.github.io'
const SITE_NAME = 'jaminLog'
const DEFAULT_DESC = '개발 경험과 기술 지식을 기록하는 개인 블로그'

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildMetaTags({ title, description, url, type = 'website', publishedTime, tags }) {
  const pageTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME
  const desc = description || DEFAULT_DESC

  let meta = `
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:locale" content="ko_KR" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(desc)}" />`

  if (type === 'article' && publishedTime) {
    meta += `\n    <meta property="article:published_time" content="${publishedTime}" />`
  }
  if (tags?.length) {
    for (const tag of tags) {
      meta += `\n    <meta property="article:tag" content="${escapeHtml(tag)}" />`
    }
  }
  return meta
}

function injectMeta(template, metaTags) {
  // index.html의 기존 title ~ twitter 메타를 교체
  // <title>...</title> 부터 마지막 twitter meta까지 교체
  return template.replace(
    /<title>.*?<\/title>[\s\S]*?<meta name="twitter:description"[^>]*\/>/,
    metaTags.trim()
  )
}

async function writeHtml(routePath, metaTags, template) {
  const html = injectMeta(template, metaTags)
  const dir = path.join(DIST, routePath)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), html, 'utf8')
}

async function main() {
  const template = await readFile(path.join(DIST, 'index.html'), 'utf8')
  const raw = await readFile(META_PATH, 'utf8')
  const posts = JSON.parse(raw).filter((p) => !p.draft && !p.private)

  let count = 0

  // 개별 글
  for (const p of posts) {
    const meta = buildMetaTags({
      title: p.title,
      description: p.summary || `${p.title} — ${p.category.replace(/-/g, ' ')}`,
      url: `${SITE_URL}/posts/${encodeURIComponent(p.slug)}`,
      type: 'article',
      publishedTime: p.date,
      tags: p.tags,
    })
    await writeHtml(`posts/${p.slug}`, meta, template)
    count++
  }

  // 카테고리
  const categories = [...new Set(posts.map((p) => p.category))]
  for (const cat of categories) {
    const catPosts = posts.filter((p) => p.category === cat)
    const label = cat.replace(/-/g, ' ')
    const meta = buildMetaTags({
      title: label,
      description: `${label} 카테고리의 글 모음 (${catPosts.length}개)`,
      url: `${SITE_URL}/categories/${encodeURIComponent(cat)}`,
    })
    await writeHtml(`categories/${cat}`, meta, template)
    count++
  }

  // 시리즈 인덱스
  const seriesNames = [...new Set(posts.map((p) => p.series).filter(Boolean))]
  if (seriesNames.length > 0) {
    const meta = buildMetaTags({
      title: 'Series',
      description: '순서대로 읽으면 흐름이 이어지는 글 묶음',
      url: `${SITE_URL}/series`,
    })
    await writeHtml('series', meta, template)
    count++

    for (const s of seriesNames) {
      const sPosts = posts.filter((p) => p.series === s)
      const totalTime = sPosts.reduce((sum, p) => sum + p.readingTime, 0)
      const meta = buildMetaTags({
        title: `${s} 시리즈`,
        description: `${s} — ${sPosts.length}편, 약 ${totalTime}분`,
        url: `${SITE_URL}/series/${encodeURIComponent(s)}`,
      })
      await writeHtml(`series/${s}`, meta, template)
      count++
    }
  }

  // 태그
  const tagSet = new Set()
  for (const p of posts) {
    for (const t of p.tags) tagSet.add(t)
  }
  for (const tag of tagSet) {
    const meta = buildMetaTags({
      title: `#${tag}`,
      description: `"${tag}" 태그가 붙은 글 모음`,
      url: `${SITE_URL}/tags/${encodeURIComponent(tag)}`,
    })
    await writeHtml(`tags/${tag}`, meta, template)
    count++
  }

  // 404.html (SPA 폴백)
  const notFoundHtml = injectMeta(template, buildMetaTags({
    title: '404',
    description: '페이지를 찾을 수 없어요.',
    url: SITE_URL,
  }))
  await writeFile(path.join(DIST, '404.html'), notFoundHtml, 'utf8')
  count++

  console.log(`✔ ${count}개 라우트 HTML 생성 완료`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
