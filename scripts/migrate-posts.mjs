#!/usr/bin/env node
/**
 * Jekyll _posts → jaminLog src/posts 마이그레이션
 *
 * 동작:
 *  - 재귀 스캔: D:/project/personal/jamin12/_posts/**\/*.md
 *  - frontmatter 파싱 (Jekyll 호환 subset)
 *  - 카테고리 = frontmatter categories[0] (없으면 최상위 폴더)
 *  - 태그 = 기존 tags ∪ categories[1:] ∪ 서브폴더(최상위 제외) (dedupe)
 *  - 날짜 = frontmatter date의 YYYY-MM-DD, 없으면 파일명 접두사
 *  - slug = 파일명 - 날짜 접두사, 공백→하이픈
 *  - 제목 = trim + 양끝 따옴표 제거
 *  - Jekyll 전용 필드 제거: layout, mermaid, math
 *  - Liquid 태그 변환: {% include link-preview.html ... %} → 마크다운 링크
 *  - 이미지: /assets/imgs/... → 실제 파일을 src/posts/<cat>/images/로 복사,
 *            본문 참조는 ./images/<hyphenated-filename>로 변환
 *
 * 사용:
 *   node scripts/migrate-posts.mjs              # 드라이런 (기본)
 *   node scripts/migrate-posts.mjs --apply      # 실제 쓰기
 */

import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const APPLY = process.argv.includes('--apply')
const SOURCE_POSTS = 'D:/project/personal/jamin12/_posts'
const SOURCE_ROOT = 'D:/project/personal/jamin12'
const TARGET_POSTS = path.resolve('src/posts')

// 카테고리 이름 정규화
// frontmatter에 공백 없이 "개념정리"로 쓴 파일과, frontmatter 없이 폴더명 "개념 정리"로
// fallback되어 "개념-정리"가 된 파일을 한 카테고리로 통합하기 위한 맵.
// key/value 모두 hyphenate() 적용 후 기준.
const CATEGORY_ALIASES = {
  개념정리: '개념-정리',
}

const report = {
  processed: 0,
  skipped: 0,
  categoryDist: new Map(),
  tagDist: new Map(),
  warnings: [],
  collisions: [],
  missingImages: [],
  liquidUnknown: [],
  dateConflicts: [],
  imagesCopied: 0,
  noFrontmatter: [],
}

// ─────────────────────────────────────────
// YAML subset 파서 (Jekyll frontmatter 호환)
// ─────────────────────────────────────────
function parseScalar(raw) {
  const v = raw.trim()
  if (v === '') return ''
  if (v === 'true') return true
  if (v === 'false') return false
  // 인라인 배열 [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return v.replace(/^["']|["']$/g, '')
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, content: raw, hasFm: false }
  const [, yaml, content] = m
  const data = {}
  let currentKey = null
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    // 블록 배열 원소: `  - value`
    const itemMatch = line.match(/^\s+-\s*(.+)$/)
    if (itemMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(itemMatch[1].trim().replace(/^["']|["']$/g, ''))
      continue
    }
    // key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1]
      const rawVal = kvMatch[2]
      data[currentKey] = rawVal === '' ? [] : parseScalar(rawVal)
    }
  }
  // single-string tags → array
  if (typeof data.tags === 'string') data.tags = [data.tags]
  if (typeof data.categories === 'string') data.categories = [data.categories]
  return { data, content, hasFm: true }
}

function serializeFrontmatter(data) {
  const lines = ['---']
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      lines.push(`${k}: [${v.join(', ')}]`)
    } else {
      const s = String(v)
      const needsQuote = /[:#\[\]{}&*!|>%@`]/.test(s) || /^\s|\s$/.test(s)
      lines.push(`${k}: ${needsQuote ? `"${s.replace(/"/g, '\\"')}"` : s}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────
function hyphenate(str) {
  return String(str).trim().replace(/\s+/g, '-')
}

function extractYMD(str) {
  if (!str) return null
  const m = String(str).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function stripDatePrefix(filename) {
  const base = filename.replace(/\.md$/, '')
  const m = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)
  return m ? { date: m[1], slug: m[2] } : { date: null, slug: base }
}

async function walk(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

// ─────────────────────────────────────────
// 본문 변환 (Liquid + 이미지)
// ─────────────────────────────────────────
function transformLiquid(body, filePath) {
  let out = body
  // {% include link-preview.html url="X" title="Y" %} → [Y](X)
  out = out.replace(
    /\{%\s*include\s+link-preview\.html\s+url="([^"]+)"\s+title="([^"]+)"\s*%\}/g,
    '[$2]($1)'
  )
  // {% include link-preview.html url="X" %} → [X](X) (title 없는 variant)
  out = out.replace(
    /\{%\s*include\s+link-preview\.html\s+url="([^"]+)"\s*%\}/g,
    '[$1]($1)'
  )
  // {% raw %}...{% endraw %} — Jekyll Liquid escape 블록, 태그만 제거 (내용 유지)
  out = out.replace(/\{%\s*raw\s*%\}/g, '')
  out = out.replace(/\{%\s*endraw\s*%\}/g, '')
  // 남은 Liquid 태그 수집 (경고만)
  const remaining = out.match(/\{%[^%]*%\}/g)
  if (remaining) {
    for (const tag of remaining) {
      report.liquidUnknown.push({ file: filePath, tag })
    }
  }
  return out
}

async function processImages(body, category, sourceFilePath) {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g
  const copies = [] // { srcAbs, destName }
  const newBody = body.replace(imagePattern, (match, alt, src) => {
    // 외부 URL은 그대로
    if (/^https?:\/\//.test(src)) return match
    // Jekyll 절대 경로 /assets/... 만 처리
    if (!src.startsWith('/assets/')) return match
    const srcAbs = path.join(SOURCE_ROOT, src.replace(/^\//, ''))
    const origName = decodeURIComponent(path.basename(src))
    const destName = hyphenate(origName)
    copies.push({ srcAbs, destName, origRef: src })
    return `![${alt}](./images/${destName})`
  })
  // 실제 복사
  const catImagesDir = path.join(TARGET_POSTS, category, 'images')
  for (const { srcAbs, destName, origRef } of copies) {
    if (!existsSync(srcAbs)) {
      report.missingImages.push({ file: sourceFilePath, ref: origRef, srcAbs })
      continue
    }
    if (APPLY) {
      await mkdir(catImagesDir, { recursive: true })
      await copyFile(srcAbs, path.join(catImagesDir, destName))
    }
    report.imagesCopied++
  }
  return newBody
}

// ─────────────────────────────────────────
// 메인 처리
// ─────────────────────────────────────────
async function processFile(sourcePath, targetSlugs) {
  const raw = await readFile(sourcePath, 'utf8')
  const { data, content, hasFm } = parseFrontmatter(raw)

  if (!hasFm) {
    report.noFrontmatter.push(sourcePath)
  }

  // 경로 파싱: _posts 기준 상대경로
  const relFromPosts = path.relative(SOURCE_POSTS, sourcePath).replace(/\\/g, '/')
  const parts = relFromPosts.split('/')
  const filename = parts.pop()
  const topFolder = parts[0] || ''
  const subfoldersBeyondTop = parts.slice(1)

  // 카테고리 결정
  let category
  if (Array.isArray(data.categories) && data.categories.length > 0) {
    category = hyphenate(data.categories[0])
  } else {
    category = hyphenate(topFolder)
  }
  if (!category) {
    report.warnings.push(`카테고리 없음: ${sourcePath}`)
    report.skipped++
    return null
  }
  // alias 적용 (같은 의미의 다른 표기를 하나로 통일)
  if (CATEGORY_ALIASES[category]) category = CATEGORY_ALIASES[category]

  // 태그 결정
  const tagSet = new Set()
  if (Array.isArray(data.tags)) data.tags.forEach((t) => tagSet.add(hyphenate(t)))
  if (Array.isArray(data.categories)) {
    data.categories.slice(1).forEach((t) => tagSet.add(hyphenate(t)))
  }
  subfoldersBeyondTop.forEach((t) => tagSet.add(hyphenate(t)))
  const tags = [...tagSet]

  // 날짜 결정
  const fmDate = extractYMD(data.date)
  const { date: filenameDate, slug: filenameSlug } = stripDatePrefix(filename)
  const date = fmDate || filenameDate
  if (fmDate && filenameDate && fmDate !== filenameDate) {
    report.dateConflicts.push({
      file: sourcePath,
      fm: fmDate,
      filename: filenameDate,
    })
  }
  if (!date) {
    report.warnings.push(`날짜 없음: ${sourcePath}`)
  }

  // 제목
  const title = data.title
    ? String(data.title).trim().replace(/^["']|["']$/g, '')
    : filenameSlug

  // summary
  const summary = data.summary ? String(data.summary).trim() : ''

  // slug — 충돌 시 서브폴더 경로를 prefix로 붙여 재시도
  const baseSlug = hyphenate(filenameSlug)
  let slug = baseSlug
  let targetKey = `${category}/${slug}`
  if (targetSlugs.has(targetKey) && subfoldersBeyondTop.length > 0) {
    const prefix = subfoldersBeyondTop.map(hyphenate).join('-')
    slug = `${prefix}-${baseSlug}`
    targetKey = `${category}/${slug}`
    report.warnings.push(
      `slug 충돌 회피: ${baseSlug} → ${slug} (${sourcePath})`
    )
  }
  if (targetSlugs.has(targetKey)) {
    report.collisions.push({
      target: targetKey,
      sources: [targetSlugs.get(targetKey), sourcePath],
    })
    report.skipped++
    return null
  }
  targetSlugs.set(targetKey, sourcePath)
  const targetPath = path.join(TARGET_POSTS, category, `${slug}.md`)

  // 본문 변환
  let body = content.replace(/^\r?\n+/, '') // 앞쪽 빈 줄 제거
  body = transformLiquid(body, sourcePath)
  body = await processImages(body, category, sourcePath)

  // 새 frontmatter
  const newFm = {}
  if (title) newFm.title = title
  if (date) newFm.date = date
  if (tags.length > 0) newFm.tags = tags
  if (summary) newFm.summary = summary

  const output = serializeFrontmatter(newFm) + '\n\n' + body.trimStart() + '\n'

  // 쓰기
  if (APPLY) {
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, output, 'utf8')
  }

  report.processed++
  bump(report.categoryDist, category)
  tags.forEach((t) => bump(report.tagDist, t))
  return { sourcePath, targetPath, category, slug, tags, date, title }
}

// ─────────────────────────────────────────
// 실행
// ─────────────────────────────────────────
async function main() {
  console.log(`\n▶ Jekyll → jaminLog 마이그레이션 ${APPLY ? '(APPLY)' : '(DRY-RUN)'}`)
  console.log(`   소스: ${SOURCE_POSTS}`)
  console.log(`   대상: ${TARGET_POSTS}\n`)

  if (!existsSync(SOURCE_POSTS)) {
    console.error(`❌ 소스 폴더 없음: ${SOURCE_POSTS}`)
    process.exit(1)
  }

  const files = await walk(SOURCE_POSTS)
  console.log(`발견된 .md 파일: ${files.length}개\n`)

  const targetSlugs = new Map()
  for (const f of files) {
    try {
      await processFile(f, targetSlugs)
    } catch (e) {
      report.warnings.push(`처리 실패: ${f} — ${e.message}`)
    }
  }

  // 리포트
  console.log('─'.repeat(60))
  console.log(`✔ 처리: ${report.processed}개`)
  console.log(`✘ 스킵: ${report.skipped}개`)
  console.log(`🖼  이미지 복사${APPLY ? '' : ' (예정)'}: ${report.imagesCopied}개`)
  console.log('─'.repeat(60))

  console.log('\n📂 카테고리 분포')
  const catSorted = [...report.categoryDist.entries()].sort((a, b) => b[1] - a[1])
  for (const [c, n] of catSorted) console.log(`  ${c.padEnd(20)} ${n}개`)

  console.log('\n🏷  태그 분포 (상위 20)')
  const tagSorted = [...report.tagDist.entries()].sort((a, b) => b[1] - a[1])
  for (const [t, n] of tagSorted.slice(0, 20)) console.log(`  ${t.padEnd(20)} ${n}개`)
  if (tagSorted.length > 20) console.log(`  ... (총 ${tagSorted.length}개 태그)`)

  if (report.collisions.length > 0) {
    console.log('\n⚠  slug 충돌 (같은 카테고리에 같은 slug):')
    for (const c of report.collisions) {
      console.log(`  ${c.target}`)
      for (const s of c.sources) console.log(`    ← ${s}`)
    }
  }

  if (report.dateConflicts.length > 0) {
    console.log('\n⚠  날짜 불일치 (frontmatter vs 파일명):')
    for (const d of report.dateConflicts.slice(0, 10)) {
      console.log(`  ${d.file}`)
      console.log(`    frontmatter=${d.fm}, filename=${d.filename}`)
    }
    if (report.dateConflicts.length > 10) {
      console.log(`  ... (총 ${report.dateConflicts.length}건)`)
    }
  }

  if (report.missingImages.length > 0) {
    console.log(`\n⚠  이미지 누락: ${report.missingImages.length}개`)
    for (const m of report.missingImages.slice(0, 10)) {
      console.log(`  ${m.ref}`)
      console.log(`    in ${m.file}`)
    }
    if (report.missingImages.length > 10) {
      console.log(`  ... (총 ${report.missingImages.length}건)`)
    }
  }

  if (report.liquidUnknown.length > 0) {
    console.log(`\n⚠  알 수 없는 Liquid 태그: ${report.liquidUnknown.length}개`)
    const unique = new Map()
    for (const l of report.liquidUnknown) {
      unique.set(l.tag, (unique.get(l.tag) || 0) + 1)
    }
    for (const [tag, n] of [...unique.entries()].slice(0, 10)) {
      console.log(`  ${tag} (${n}회)`)
    }
  }

  if (report.noFrontmatter.length > 0) {
    console.log(`\n⚠  frontmatter 없음: ${report.noFrontmatter.length}개`)
    for (const f of report.noFrontmatter.slice(0, 5)) console.log(`  ${f}`)
  }

  if (report.warnings.length > 0) {
    console.log(`\n⚠  기타 경고: ${report.warnings.length}개`)
    for (const w of report.warnings.slice(0, 10)) console.log(`  ${w}`)
  }

  console.log('\n' + (APPLY ? '✅ 실제 쓰기 완료' : '💡 드라이런 — 실제 쓰려면 --apply'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
