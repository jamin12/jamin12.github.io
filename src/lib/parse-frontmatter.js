// ─────────────────────────────────────────
// 공용 frontmatter 파서
// - 브라우저 (Vite/ESM)와 Node 스크립트 양쪽에서 import
// - 지원: scalar, 배열 ([a, b, c]), `key:` 빈 값, 간단한 주석 무시
// - 멀티라인 배열이나 복잡한 YAML은 지원하지 않음 (이 프로젝트 규약상 불필요)
// ─────────────────────────────────────────

/**
 * @typedef {{ data: Record<string, unknown>, content: string }} ParseResult
 */

/**
 * @param {string} raw
 * @returns {ParseResult}
 */
export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }

  const [, yaml, content] = match
  const data = {}
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) continue
    const [, key, rawVal] = m
    const val = rawVal.trim()
    if (val === '') {
      data[key] = ''
    } else if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      data[key] = val.replace(/^["']|["']$/g, '')
    }
  }
  return { data, content }
}
