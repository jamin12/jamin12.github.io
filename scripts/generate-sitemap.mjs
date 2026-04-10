/**
 * sitemap.xml 생성기
 *
 * posts-meta.json + 정적 라우트를 읽어 dist/sitemap.xml 생성.
 * 빌드 후(postbuild) 실행된다.
 *
 * 실행: node scripts/generate-sitemap.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SITE_URL = 'https://jamin12.github.io'
const META_PATH = path.resolve(__dirname, '../src/lib/posts-meta.json')
const OUTPUT = path.resolve(__dirname, '../dist/sitemap.xml')

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function urlEntry(loc, lastmod, changefreq = 'weekly', priority = '0.5') {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
}

async function main() {
  const raw = await readFile(META_PATH, 'utf8')
  const posts = JSON.parse(raw).filter(
    (p) => !p.draft && !p.private
  )

  const urls = []

  // 홈
  urls.push(urlEntry(SITE_URL + '/', posts[0]?.date || '', 'daily', '1.0'))

  // 개별 글
  for (const p of posts) {
    urls.push(
      urlEntry(`${SITE_URL}/posts/${encodeURIComponent(p.slug)}`, p.date, 'monthly', '0.8')
    )
  }

  // 카테고리
  const categories = [...new Set(posts.map((p) => p.category))]
  for (const cat of categories) {
    urls.push(
      urlEntry(`${SITE_URL}/categories/${encodeURIComponent(cat)}`, '', 'weekly', '0.6')
    )
  }

  // 시리즈
  const seriesNames = [...new Set(posts.map((p) => p.series).filter(Boolean))]
  if (seriesNames.length > 0) {
    urls.push(urlEntry(`${SITE_URL}/series`, '', 'weekly', '0.5'))
    for (const s of seriesNames) {
      urls.push(
        urlEntry(`${SITE_URL}/series/${encodeURIComponent(s)}`, '', 'weekly', '0.5')
      )
    }
  }

  // 태그
  const tagSet = new Set()
  for (const p of posts) {
    for (const t of p.tags) tagSet.add(t)
  }
  for (const tag of tagSet) {
    urls.push(
      urlEntry(`${SITE_URL}/tags/${encodeURIComponent(tag)}`, '', 'weekly', '0.3')
    )
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`

  await writeFile(OUTPUT, xml, 'utf8')
  console.log(`✔ sitemap.xml 생성 (${urls.length}개 URL) → dist/sitemap.xml`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
