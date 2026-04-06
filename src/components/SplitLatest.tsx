import { Link } from 'react-router'
import { resolveImageSrc, formatCategory } from '../lib/posts'
import { getCategoryLetter, getSubcategoryLabel } from '../lib/category-meta'
import HeroPost from './HeroPost'

// 홈 `01 최신 글`: 최신 4개를 좌측 히어로 1 + 우측 compact 3으로 split
export default function SplitLatest({ posts }) {
  if (!posts || posts.length === 0) return null
  const [hero, ...sides] = posts

  return (
    <div className="split-latest">
      <HeroPost post={hero} />
      {sides.length > 0 && (
        <ul className="split-latest__sides">
          {sides.map((post) => {
            const coverUrl = post.cover
              ? resolveImageSrc(post.cover, post.category)
              : ''
            const mark = getSubcategoryLabel(post.category, post.subcategory)
              || getCategoryLetter(post.category)
            return (
              <li key={post.slug} className="side-post">
                <Link
                  to={`/posts/${encodeURIComponent(post.slug)}`}
                  className="side-post__link"
                  viewTransition
                >
                  <div className="side-post__body">
                    <p className="side-post__kicker">
                      {formatCategory(post.category)}
                    </p>
                    <h4 className="side-post__title">{post.title}</h4>
                    <div className="side-post__meta">
                      <time>{post.date}</time>
                      <span className="side-post__dot">·</span>
                      <span>약 {post.readingTime}분</span>
                    </div>
                  </div>
                  <div
                    className={`side-post__media ${coverUrl ? 'side-post__media--image' : 'side-post__media--fallback'}`}
                    style={
                      coverUrl
                        ? { backgroundImage: `url(${coverUrl})` }
                        : undefined
                    }
                  >
                    {!coverUrl && (
                      <span
                        className={`side-post__fallback-mark ${mark.length > 1 ? 'side-post__fallback-mark--label' : ''}`}
                        aria-hidden="true"
                      >
                        {mark}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
