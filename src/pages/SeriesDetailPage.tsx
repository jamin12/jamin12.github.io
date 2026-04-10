import { useParams, Link } from 'react-router'
import { getPostsBySeries, formatCategory } from '../lib/posts'
import SEOHead from '../components/SEOHead'

export default function SeriesDetailPage() {
  const { name } = useParams()
  const seriesName = decodeURIComponent(name)
  const posts = getPostsBySeries(seriesName)

  if (posts.length === 0) {
    return (
      <div className="post-not-found">
        <p>시리즈를 찾을 수 없어요.</p>
        <Link to="/series">시리즈 목록으로</Link>
      </div>
    )
  }

  const totalTime = posts.reduce((sum, p) => sum + p.readingTime, 0)
  const first = posts[0]

  return (
    <div className="page-series-detail">
      <SEOHead
        title={`${seriesName} 시리즈`}
        description={`${seriesName} — ${posts.length}편, 약 ${totalTime}분`}
        path={`/series/${encodeURIComponent(name)}`}
      />
      <header className="series-detail__header">
        <Link to="/series" className="series-detail__back">
          ← 시리즈 목록
        </Link>
        <h1 className="series-detail__title">{seriesName}</h1>
        <div className="series-detail__meta">
          <span>{posts.length}편</span>
          <span className="series-detail__sep">·</span>
          <span>총 약 {totalTime}분</span>
        </div>
      </header>

      <ol className="series-timeline">
        {posts.map((post, i) => (
          <li
            key={post.slug}
            className={`series-timeline__item ${
              i === posts.length - 1 ? 'series-timeline__item--last' : ''
            }`}
          >
            <div className="series-timeline__node" />
            <div className="series-timeline__content">
              <Link
                to={`/posts/${encodeURIComponent(post.slug)}`}
                className="series-timeline__link"
                viewTransition
              >
                <span className="series-timeline__order">{post.seriesOrder}.</span>
                <span className="series-timeline__post-title">{post.title}</span>
              </Link>
              <div className="series-timeline__meta">
                <time>{post.date}</time>
                <span className="series-timeline__sep">·</span>
                <span>{formatCategory(post.category)}</span>
                <span className="series-timeline__sep">·</span>
                <span>약 {post.readingTime}분</span>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="series-detail__cta">
        <Link
          to={`/posts/${encodeURIComponent(first.slug)}`}
          className="series-detail__start"
          viewTransition
        >
          1편부터 읽기 →
        </Link>
      </div>
    </div>
  )
}
