import { Link } from 'react-router'
import { formatCategory, getSubcategoriesByCategory } from '../lib/posts'
import { getCategoryLetter } from '../lib/category-meta'

const MAX_CHIPS = 4

// 홈 `02 카테고리`: 카테고리를 카드 그리드로.
// 글 수 상위 3개는 #1/#2/#3 랭킹 배지 (categories는 posts.js에서 이미 count 내림차순 정렬됨)
// 카드 하단에 서브카테고리 칩 노출 (상위 MAX_CHIPS개, 나머지 +N)
export default function CategoryGrid({ categories }) {
  if (!categories || categories.length === 0) return null

  return (
    <ul className="category-grid">
      {categories.map((cat, idx) => {
        const rank = idx < 3 ? idx + 1 : null
        const subs = getSubcategoriesByCategory(cat.name)
        const visible = subs.slice(0, MAX_CHIPS)
        const rest = subs.length - MAX_CHIPS

        return (
          <li key={cat.name} className="category-grid__item">
            <Link
              to={`/categories/${encodeURIComponent(cat.name)}`}
              className="category-card"
            >
              {rank && (
                <span
                  className={`category-card__rank category-card__rank--${rank}`}
                >
                  #{rank}
                </span>
              )}
              <span className="category-card__mark" aria-hidden="true">
                {getCategoryLetter(cat.name)}
              </span>
              <div className="category-card__body">
                <span className="category-card__name">
                  {formatCategory(cat.name)}
                </span>
                <span className="category-card__count">
                  {cat.count} articles
                </span>
              </div>
              {visible.length > 0 && (
                <div className="category-card__chips">
                  {visible.map((sub) => (
                    <span key={sub.slug} className="category-card__chip">
                      {sub.label}
                    </span>
                  ))}
                  {rest > 0 && (
                    <span className="category-card__chip category-card__chip--more">
                      +{rest}
                    </span>
                  )}
                </div>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
