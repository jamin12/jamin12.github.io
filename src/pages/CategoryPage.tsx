import { useParams, Link, NavLink } from 'react-router'
import {
  getPostsByCategory,
  getSubcategoriesByCategory,
  getUngroupedPostsByCategory,
  formatCategory,
} from '../lib/posts'
import PostCards from '../components/PostCards'
import SEOHead from '../components/SEOHead'

export default function CategoryPage() {
  const { category, subcategory } = useParams()
  const allPosts = getPostsByCategory(category)
  const label = formatCategory(category)
  const subs = getSubcategoriesByCategory(category)
  const ungrouped = getUngroupedPostsByCategory(category)

  // 활성 하위 카테고리 (URL의 :subcategory 파라미터)
  const activeSub = subcategory || null
  const activeSubDef = activeSub
    ? subs.find((s) => s.slug === activeSub)
    : null

  // 단일 하위 카테고리 뷰: /categories/:cat/:sub
  if (activeSub && activeSubDef) {
    return (
      <div className="page-list">
        <SEOHead
          title={`${label} — ${activeSubDef.label}`}
          description={`${label} · ${activeSubDef.label} 하위 카테고리의 글 모음 (${activeSubDef.count}개)`}
          path={`/categories/${encodeURIComponent(category)}/${activeSub}`}
        />
        <header className="page-header">
          <p className="page-header__kicker">
            <Link to={`/categories/${encodeURIComponent(category)}`}>
              카테고리 · {label}
            </Link>
          </p>
          <h1 className="page-header__title">{activeSubDef.label}</h1>
          <p className="page-header__count">
            {activeSubDef.count}개의 글
          </p>
        </header>

        {subs.length > 1 && (
          <SubcategoryNav category={category} subs={subs} active={activeSub} />
        )}

        <PostCards
          posts={activeSubDef.posts}
          emptyMessage={`"${activeSubDef.label}" 하위 글이 아직 없어요.`}
        />

        <p className="back-link">
          <Link to={`/categories/${encodeURIComponent(category)}`}>
            ← {label} 전체 보기
          </Link>
        </p>
      </div>
    )
  }

  // 카테고리 전체 뷰: /categories/:cat
  // 하위 그룹이 정의돼 있으면 그룹별 섹션으로 렌더, 아니면 flat 목록
  return (
    <div className="page-list">
      <SEOHead
        title={activeSub ? `${label} — ${activeSubDef?.label}` : label}
        description={`${label} 카테고리의 글 모음 (${allPosts.length}개)`}
        path={activeSub ? `/categories/${encodeURIComponent(category)}/${activeSub}` : `/categories/${encodeURIComponent(category)}`}
      />
      <header className="page-header">
        <p className="page-header__kicker">카테고리</p>
        <h1 className="page-header__title">{label}</h1>
        <p className="page-header__count">{allPosts.length}개의 글</p>
      </header>

      {subs.length > 0 && (
        <SubcategoryNav category={category} subs={subs} active={null} />
      )}

      {subs.length === 0 ? (
        // 하위 그룹 없는 카테고리 (예: 트러블-슈팅) → flat
        <PostCards
          posts={allPosts}
          emptyMessage={`"${label}" 카테고리의 글이 아직 없어요.`}
        />
      ) : (
        <div className="subcategory-sections">
          {subs.map((sub) => (
            <section key={sub.slug} className="subcategory-section">
              <header className="subcategory-section__header">
                <h2 className="subcategory-section__title">
                  <Link
                    to={`/categories/${encodeURIComponent(category)}/${sub.slug}`}
                  >
                    {sub.label}
                  </Link>
                  <span className="subcategory-section__count">
                    {sub.count}
                  </span>
                </h2>
              </header>
              <PostCards posts={sub.posts} />
            </section>
          ))}

          {ungrouped.length > 0 && (
            <section className="subcategory-section">
              <header className="subcategory-section__header">
                <h2 className="subcategory-section__title">
                  그 외
                  <span className="subcategory-section__count">
                    {ungrouped.length}
                  </span>
                </h2>
              </header>
              <PostCards posts={ungrouped} />
            </section>
          )}
        </div>
      )}

      <p className="back-link">
        <Link to="/">← 전체 글로 돌아가기</Link>
      </p>
    </div>
  )
}

// 카테고리 상단의 하위 그룹 칩 네비
function SubcategoryNav({ category, subs, active }) {
  return (
    <nav className="subcategory-nav" aria-label="하위 카테고리">
      <NavLink
        to={`/categories/${encodeURIComponent(category)}`}
        end
        className={`subcategory-nav__chip ${
          !active ? 'subcategory-nav__chip--active' : ''
        }`}
      >
        전체
      </NavLink>
      {subs.map((sub) => (
        <NavLink
          key={sub.slug}
          to={`/categories/${encodeURIComponent(category)}/${sub.slug}`}
          className={({ isActive }) =>
            `subcategory-nav__chip ${
              isActive ? 'subcategory-nav__chip--active' : ''
            }`
          }
        >
          {sub.label}
          <span className="subcategory-nav__count">{sub.count}</span>
        </NavLink>
      ))}
    </nav>
  )
}
