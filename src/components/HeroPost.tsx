import { Link } from 'react-router'
import { resolveImageSrc, formatCategory } from '../lib/posts'
import { getCategoryLetter, getSubcategoryLabel } from '../lib/category-meta'

// 홈 `01 최신 글`의 좌측 히어로 카드.
// cover 있으면 이미지 + 그라데이션 오버레이, 없으면 서브카테고리 라벨 또는 카테고리 letter-mark fallback
export default function HeroPost({ post }) {
  if (!post) return null
  const coverUrl = post.cover ? resolveImageSrc(post.cover, post.category) : ''
  const mark = getSubcategoryLabel(post.category, post.subcategory)
    || getCategoryLetter(post.category)

  return (
    <Link
      to={`/posts/${encodeURIComponent(post.slug)}`}
      className="hero-post"
      viewTransition
    >
      <div
        className={`hero-post__media ${coverUrl ? 'hero-post__media--image' : 'hero-post__media--fallback'}`}
        style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
      >
        {!coverUrl && (
          <span
            className={`hero-post__fallback-mark ${mark.length > 1 ? 'hero-post__fallback-mark--label' : ''}`}
            aria-hidden="true"
          >
            {mark}
          </span>
        )}
      </div>
      <div className="hero-post__body">
        <p className="hero-post__kicker">{formatCategory(post.category)}</p>
        <h3 className="hero-post__title">{post.title}</h3>
        {post.summary && (
          <p className="hero-post__summary">{post.summary}</p>
        )}
        <div className="hero-post__meta">
          <time>{post.date}</time>
          <span className="hero-post__dot">·</span>
          <span>약 {post.readingTime}분</span>
        </div>
      </div>
    </Link>
  )
}
