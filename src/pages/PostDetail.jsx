import { use, useRef } from 'react'
import { useParams, Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeKatex from 'rehype-katex'
import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import 'katex/dist/katex.min.css'
import {
  getPostBySlug,
  getPostBodyPromise,
  getSeriesNav,
  resolveImageSrc,
  formatCategory,
} from '../lib/posts.js'
import { getSubcategoriesForCategory } from '../lib/subcategory-rules.js'
import { highlighter } from '../lib/shiki.js'
import { rehypeMermaidPassthrough } from '../lib/rehype-mermaid-passthrough.js'
import TOC from '../components/TOC.jsx'
import MermaidDiagram from '../components/MermaidDiagram.jsx'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [
  rehypeSlug,
  [
    rehypeAutolinkHeadings,
    {
      behavior: 'append',
      properties: { className: 'heading-anchor', ariaLabel: '이 섹션으로 링크' },
      content: { type: 'text', value: '#' },
    },
  ],
  rehypeKatex,
  // mermaid 블록을 placeholder div로 교체 — 반드시 shiki보다 먼저 실행
  rehypeMermaidPassthrough,
  [
    rehypeShikiFromHighlighter,
    highlighter,
    {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  ],
]

export default function PostDetail() {
  const { slug } = useParams()
  const post = getPostBySlug(slug)
  const bodyRef = useRef(null)

  if (!post) {
    return (
      <div className="post-not-found">
        <p>글을 찾을 수 없어요.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </div>
    )
  }

  // React 19 use() 훅 — body promise를 동기처럼 소비.
  // 미해결 상태에선 App.jsx의 <Suspense>가 fallback을 노출
  const body = use(getPostBodyPromise(post.category, slug))
  const seriesNav = getSeriesNav(slug)

  const components = {
    img: ({ src, alt }) => (
      <img
        src={resolveImageSrc(src, post.category)}
        alt={alt || ''}
        loading="lazy"
      />
    ),
    a: ({ href = '', children, ...rest }) => {
      const isExternal = /^https?:\/\//.test(href)
      if (isExternal) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
            {children}
          </a>
        )
      }
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      )
    },
    // rehype-mermaid-passthrough가 남긴 placeholder를 MermaidDiagram으로 렌더
    div: ({ node, className, children, ...rest }) => {
      const classList = Array.isArray(className)
        ? className
        : typeof className === 'string'
          ? className.split(/\s+/)
          : []
      if (classList.includes('mermaid-block')) {
        const code =
          node?.properties?.dataMermaidCode ||
          rest['data-mermaid-code'] ||
          ''
        return <MermaidDiagram code={code} />
      }
      return (
        <div className={className} {...rest}>
          {children}
        </div>
      )
    },
  }

  return (
    <div className="page-post">
      <div className="post-layout">
        <article className="post">
          <header className="post__header">
            <p className="post__kicker">
              <Link to={`/categories/${encodeURIComponent(post.category)}`}>
                {formatCategory(post.category)}
              </Link>
              {post.subcategory && (() => {
                const rule = getSubcategoriesForCategory(post.category)
                  .find((r) => r.slug === post.subcategory)
                return rule ? (
                  <>
                    <span className="post__kicker-sep"> &gt; </span>
                    <Link
                      to={`/categories/${encodeURIComponent(post.category)}/${post.subcategory}`}
                    >
                      {rule.label}
                    </Link>
                  </>
                ) : null
              })()}
            </p>
            {seriesNav && (
              <div className="series-banner">
                <span className="series-banner__name">{seriesNav.series}</span>
                <span className="series-banner__sep">/</span>
                <span className="series-banner__pos">{seriesNav.current} of {seriesNav.total}</span>
              </div>
            )}
            <h1 className="post__title">{post.title}</h1>
            <div className="post__meta">
              <time>{post.date}</time>
              <span className="post__dot">·</span>
              <span>약 {post.readingTime}분</span>
            </div>
            {post.tags.length > 0 && (
              <div className="post__tags">
                {post.tags.map((t) => (
                  <Link
                    key={t}
                    to={`/tags/${encodeURIComponent(t)}`}
                    className="tag-chip"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            )}
          </header>
          <div className="post__body" ref={bodyRef}>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={components}
            >
              {body}
            </ReactMarkdown>
          </div>
          <footer className="post__footer">
            {seriesNav && (
              <nav className="series-nav">
                <div className="series-nav__header">
                  <span className="series-nav__label">{seriesNav.series}</span>
                  <span className="series-nav__pos">{seriesNav.current} / {seriesNav.total}</span>
                </div>
                <div className="series-nav__links">
                  {seriesNav.prev ? (
                    <Link
                      to={`/posts/${encodeURIComponent(seriesNav.prev.slug)}`}
                      className="series-nav__link series-nav__link--prev"
                      viewTransition
                    >
                      <span className="series-nav__dir">← 이전</span>
                      <span className="series-nav__title">
                        {seriesNav.prev.seriesOrder}. {seriesNav.prev.title}
                      </span>
                    </Link>
                  ) : (
                    <div />
                  )}
                  {seriesNav.next ? (
                    <Link
                      to={`/posts/${encodeURIComponent(seriesNav.next.slug)}`}
                      className="series-nav__link series-nav__link--next"
                      viewTransition
                    >
                      <span className="series-nav__dir">다음 →</span>
                      <span className="series-nav__title">
                        {seriesNav.next.seriesOrder}. {seriesNav.next.title}
                      </span>
                    </Link>
                  ) : (
                    <div />
                  )}
                </div>
              </nav>
            )}
            <Link to="/" className="back-link">
              ← 목록으로
            </Link>
          </footer>
        </article>
        <aside className="post-sidebar">
          <TOC containerRef={bodyRef} />
        </aside>
      </div>
    </div>
  )
}
