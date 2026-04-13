import { NavLink, Link, useLocation, useParams } from 'react-router'
import {
  categories,
  seriesList,
  formatCategory,
  getSubcategoriesByCategory,
  getPostBySlug,
} from '../lib/posts'
import { getCategoryLetter } from '../lib/category-meta'

// ≥ 1024px에서만 렌더. 모바일/태블릿은 `.app__topbar` 사용 (App.jsx)
// 브랜드 블록이 이미 홈 링크 역할을 하므로 별도의 "홈" 네비 항목은 두지 않음.
//
// 하위 카테고리는 **현재 활성화된 카테고리만 자동 펼침**. 수동 토글 없음.
// 활성 판정 로직: URL이 `/categories/:cat[/...]` 이거나 `/tags/:tag` 가 아닐 때,
// 보고 있는 글의 카테고리를 활성으로 간주.
export default function Sidebar() {
  const { pathname } = useLocation()
  const { category: activeCategory, subcategory: activeSubcategory } =
    getActiveNav(pathname)

  return (
    <aside className="sidebar" aria-label="사이트 네비게이션">
      <div className="sidebar__header">
        <Link to="/" className="sidebar__brand" aria-label="jaminLog 홈">
          <span className="sidebar__avatar" aria-hidden="true">J</span>
          <span className="sidebar__brand-text">
            <span className="sidebar__title">jaminLog</span>
            <span className="sidebar__tagline">개발 기록과 생각</span>
          </span>
        </Link>
      </div>

      <div className="sidebar__section">
        <h2 className="sidebar__section-title">카테고리</h2>
        <ul className="sidebar__list">
          {categories.map((cat) => {
            const isActive = cat.name === activeCategory
            const subs = isActive ? getSubcategoriesByCategory(cat.name) : []
            return (
              <li key={cat.name}>
                <NavLink
                  to={`/categories/${encodeURIComponent(cat.name)}`}
                  end
                  className={({ isActive: linkActive }) =>
                    `sidebar__nav-item ${
                      linkActive || isActive ? 'sidebar__nav-item--active' : ''
                    }`
                  }
                >
                  <span className="sidebar__nav-mark" aria-hidden="true">
                    {getCategoryLetter(cat.name)}
                  </span>
                  <span className="sidebar__nav-name">
                    {formatCategory(cat.name)}
                  </span>
                  <span className="sidebar__nav-count">{cat.count}</span>
                </NavLink>

                {subs.length > 0 && (
                  <ul className="sidebar__sublist">
                    {subs.map((sub) => (
                      <li key={sub.slug}>
                        <NavLink
                          to={`/categories/${encodeURIComponent(
                            cat.name
                          )}/${sub.slug}`}
                          className={({ isActive: linkActive }) =>
                            `sidebar__subitem ${
                              linkActive || sub.slug === activeSubcategory
                                ? 'sidebar__subitem--active'
                                : ''
                            }`
                          }
                        >
                          <span className="sidebar__subname">{sub.label}</span>
                          <span className="sidebar__subcount">{sub.count}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {seriesList.length > 0 && (() => {
        const activePost = getActivePost(pathname)
        const activeSeries = activePost?.series || null
        const activeSlug = activePost?.slug || null

        return (
          <div className="sidebar__section">
            <h2 className="sidebar__section-title">
              <Link to="/series" className="sidebar__section-title-link">
                시리즈
              </Link>
            </h2>
            <ul className="sidebar__list">
              {seriesList.map((s) => {
                const isOpen = s.name === activeSeries
                return (
                  <li key={s.name}>
                    <Link
                      to={`/series/${encodeURIComponent(s.name)}`}
                      className={`sidebar__nav-item ${isOpen ? 'sidebar__nav-item--active' : ''}`}
                    >
                      <span className="sidebar__nav-mark" aria-hidden="true">
                        {s.name.charAt(0)}
                      </span>
                      <span className="sidebar__nav-name">{s.name}</span>
                      <span className="sidebar__nav-count">{s.count}</span>
                    </Link>
                    {isOpen && (
                      <ul className="sidebar__sublist">
                        {s.posts.map((p) => (
                          <li key={p.slug}>
                            <Link
                              to={`/posts/${encodeURIComponent(p.slug)}`}
                              className={`sidebar__subitem ${
                                p.slug === activeSlug ? 'sidebar__subitem--active' : ''
                              }`}
                              viewTransition
                            >
                              <span className="sidebar__sub-order">{p.seriesOrder}.</span>
                              <span className="sidebar__subname">{p.title}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })()}

      <div className="sidebar__footer" />
    </aside>
  )
}

// URL에서 현재 활성 카테고리·서브카테고리 추출.
// `/categories/:cat[/:sub]` 에선 URL 파라미터에서,
// `/posts/:slug` 에선 해당 글의 메타데이터에서,
// 그 외 경로(`/`, `/tags/...`)에선 null
function getActiveNav(pathname) {
  const catMatch = pathname.match(/^\/categories\/([^/]+)(?:\/([^/]+))?/)
  if (catMatch) {
    try {
      return {
        category: decodeURIComponent(catMatch[1]),
        subcategory: catMatch[2] ? decodeURIComponent(catMatch[2]) : null,
      }
    } catch {
      return { category: catMatch[1], subcategory: catMatch[2] ?? null }
    }
  }

  const postMatch = pathname.match(/^\/posts\/([^/]+)/)
  if (postMatch) {
    try {
      const slug = decodeURIComponent(postMatch[1])
      const post = getPostBySlug(slug)
      return {
        category: post?.category ?? null,
        subcategory: post?.subcategory ?? null,
      }
    } catch {
      return { category: null, subcategory: null }
    }
  }

  return { category: null, subcategory: null }
}

// 현재 보고 있는 글의 Post 객체 반환 (시리즈 판정용)
function getActivePost(pathname) {
  const postMatch = pathname.match(/^\/posts\/([^/]+)/)
  if (!postMatch) return null
  try {
    return getPostBySlug(decodeURIComponent(postMatch[1])) || null
  } catch {
    return null
  }
}
