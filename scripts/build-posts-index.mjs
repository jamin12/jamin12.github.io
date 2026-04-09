/**
 * posts 메타데이터 인덱스 생성기
 *
 * src/posts/**\/*.md를 스캔해서 src/lib/posts-meta.json 생성.
 * 본문은 포함하지 않음 — 클라이언트 번들에서 본문은 lazy import로 로드된다.
 *
 * 실행:
 *   - Vite plugin이 dev 서버 시작/변경 감지 시, 그리고 build 시작 시 자동 호출
 *   - CLI: node scripts/build-posts-index.mjs
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseFrontmatter } from '../src/lib/parse-frontmatter.js'
import { getSubcategory } from '../src/lib/subcategory-rules.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POSTS_DIR = path.resolve(__dirname, '../src/posts')
const OUTPUT = path.resolve(__dirname, '../src/lib/posts-meta.json')

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    // images/ 폴더는 마크다운 파일이 아니므로 스킵
    if (e.isDirectory() && e.name !== 'images') {
      out.push(...(await walk(path.join(dir, e.name))))
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(path.join(dir, e.name))
    }
  }
  return out
}

function calcReadingTime(content) {
  return Math.max(1, Math.round(content.length / 500))
}

export async function generatePostsIndex() {
  const files = await walk(POSTS_DIR)
  const posts = []
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const { data, content } = parseFrontmatter(raw)
    const rel = path.relative(POSTS_DIR, file).replace(/\\/g, '/')
    const m = rel.match(/^([^/]+)\/([^/]+)\.md$/)
    if (!m) continue
    const [, category, slug] = m
    const draft = data.draft === 'true' || data.draft === true
    const tags = Array.isArray(data.tags) ? data.tags : []
    // 하위 카테고리 자동 추론 (src/lib/subcategory-rules.js의 규칙 적용)
    const sub = getSubcategory(category, tags)
    posts.push({
      slug,
      category,
      subcategory: sub?.slug || '',
      subcategoryLabel: sub?.label || '',
      title: data.title || slug,
      date: data.date || '',
      tags,
      summary: data.summary || '',
      draft,
      readingTime: calcReadingTime(content),
      // 선택 필드: frontmatter `cover: ./images/foo.png` (홈 카드 대표 이미지)
      cover: data.cover || '',
      // 같은 날짜 글의 표시 순서 (없으면 0 → 이름순 폴백)
      order: data.order ? Number(data.order) : 0,
      // 시리즈: 카테고리·태그와 독립적인 순서 있는 글 묶음
      series: data.series || '',
      seriesOrder: data.seriesOrder ? Number(data.seriesOrder) : 0,
      path: `/posts/${slug}`,
    })
  }
  // 날짜 내림차순 (최신순), 같은 날짜면 order 오름차순, order 없으면 slug 이름순
  posts.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    const oa = a.order || Infinity
    const ob = b.order || Infinity
    if (oa !== ob) return oa - ob
    return a.slug.localeCompare(b.slug)
  })

  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, JSON.stringify(posts, null, 2) + '\n', 'utf8')
  return posts
}

// CLI 엔트리
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  generatePostsIndex()
    .then((posts) => {
      console.log(
        `✔ ${posts.length}개 → ${path.relative(process.cwd(), OUTPUT)}`
      )
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
