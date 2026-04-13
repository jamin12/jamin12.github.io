// ─────────────────────────────────────────
// shiki fine-grained highlighter
// 필요한 언어·테마만 import 해서 번들 크기 최소화
// ─────────────────────────────────────────

import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// 언어 — 필요할 때마다 여기에 추가
import js from 'shiki/langs/javascript.mjs'
import ts from 'shiki/langs/typescript.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import html from 'shiki/langs/html.mjs'
import css from 'shiki/langs/css.mjs'
import json from 'shiki/langs/json.mjs'
import bash from 'shiki/langs/bash.mjs'
import md from 'shiki/langs/markdown.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import sql from 'shiki/langs/sql.mjs'
import python from 'shiki/langs/python.mjs'
import go from 'shiki/langs/go.mjs'
import rust from 'shiki/langs/rust.mjs'
import java from 'shiki/langs/java.mjs'
import kotlin from 'shiki/langs/kotlin.mjs'

// 테마 — 라이트 전용
import githubLight from 'shiki/themes/github-light.mjs'

export const highlighter = createHighlighterCoreSync({
  themes: [githubLight],
  langs: [
    js,
    ts,
    jsx,
    tsx,
    html,
    css,
    json,
    bash,
    md,
    yaml,
    sql,
    python,
    go,
    rust,
    java,
    kotlin,
  ],
  engine: createJavaScriptRegexEngine(),
})
