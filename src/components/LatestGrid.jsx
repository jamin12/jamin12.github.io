import { Link } from 'react-router'
import { formatCategory } from '../lib/posts.js'
import { getSubcategoryLabel, getCategoryLetter } from '../lib/category-meta.js'

// 홈 `01 최신 글`: 균일한 카드 그리드
export default function LatestGrid({ posts }) {
  if (!posts || posts.length === 0) return null

  return (
    <ul className="latest-grid">
      {posts.map((post) => {
        const mark =
          getSubcategoryLabel(post.category, post.subcategory) ||
          getCategoryLetter(post.category)

        return (
          <li key={post.slug} className="latest-grid__item">
            <Link
              to={`/posts/${encodeURIComponent(post.slug)}`}
              className="latest-card"
              viewTransition
            >
              <span
                className={`latest-card__mark ${mark.length > 1 ? 'latest-card__mark--label' : ''}`}
                aria-hidden="true"
              >
                {mark}
              </span>
              <div className="latest-card__body">
                <p className="latest-card__kicker">
                  {formatCategory(post.category)}
                </p>
                <h3 className="latest-card__title">{post.title}</h3>
                <div className="latest-card__meta">
                  <time>{post.date}</time>
                  <span className="latest-card__dot">·</span>
                  <span>약 {post.readingTime}분</span>
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
