import { Link } from 'react-router'
import { formatCategory, getPostsBySeries } from '../lib/posts.js'

// 재사용 가능한 글 목록 렌더러
// props.posts: Post 배열
// props.emptyMessage: 비었을 때 표시 텍스트
export default function PostCards({ posts, emptyMessage = '아직 글이 없어요.' }) {
  if (!posts || posts.length === 0) {
    return <p className="empty">{emptyMessage}</p>
  }

  return (
    <ul className="post-list">
      {posts.map((post) => (
        <li
          key={post.slug}
          className={`post-list__item ${post.draft ? 'post-list__item--draft' : ''}`}
        >
          <Link
            to={`/posts/${encodeURIComponent(post.slug)}`}
            className="post-list__link"
            viewTransition
          >
            <h2 className="post-list__title">
              {post.draft && <span className="draft-badge">초안</span>}
              {post.series && (
                <span className="series-chip">
                  {post.series} {post.seriesOrder}/{getPostsBySeries(post.series).length}
                </span>
              )}
              {post.title}
            </h2>
            {post.summary && (
              <p className="post-list__summary">{post.summary}</p>
            )}
          </Link>
          <div className="post-list__meta">
            <time className="post-list__date">{post.date}</time>
            <span className="post-list__dot">·</span>
            <span className="post-list__reading">약 {post.readingTime}분</span>
            <span className="post-list__dot">·</span>
            <Link
              to={`/categories/${encodeURIComponent(post.category)}`}
              className="post-list__category"
            >
              {formatCategory(post.category)}
            </Link>
            {post.tags.length > 0 && (
              <span className="post-list__tags">
                {post.tags.map((t) => (
                  <Link
                    key={t}
                    to={`/tags/${encodeURIComponent(t)}`}
                    className="tag-chip"
                  >
                    #{t}
                  </Link>
                ))}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
