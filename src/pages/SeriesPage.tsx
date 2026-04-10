import { Link } from 'react-router'
import { seriesList, formatCategory } from '../lib/posts'
import SEOHead from '../components/SEOHead'

export default function SeriesPage() {
  return (
    <div className="page-series">
      <SEOHead
        title="Series"
        description="순서대로 읽으면 흐름이 이어지는 글 묶음"
        path="/series"
      />
      <header className="page-series__header">
        <h1 className="page-series__title">Series</h1>
        <p className="page-series__desc">
          순서대로 읽으면 흐름이 이어지는 글 묶음
        </p>
      </header>

      <div className="series-grid">
        {seriesList.map((s) => {
          const totalTime = s.posts.reduce((sum, p) => sum + p.readingTime, 0)
          return (
            <section key={s.name} className="series-card">
              <Link
                to={`/series/${encodeURIComponent(s.name)}`}
                className="series-card__header series-card__header--link"
                viewTransition
              >
                <h2 className="series-card__name">{s.name}</h2>
                <span className="series-card__count">{s.count}편 · 약 {totalTime}분</span>
              </Link>
              <ol className="series-card__list">
                {s.posts.map((post) => (
                  <li key={post.slug} className="series-card__item">
                    <Link
                      to={`/posts/${encodeURIComponent(post.slug)}`}
                      className="series-card__link"
                      viewTransition
                    >
                      <span className="series-card__order">{post.seriesOrder}</span>
                      <span className="series-card__post-title">{post.title}</span>
                    </Link>
                    <div className="series-card__meta">
                      <time>{post.date}</time>
                      <span className="series-card__sep">·</span>
                      <span>{formatCategory(post.category)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </div>
  )
}
