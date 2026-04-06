import { Link } from 'react-router'
import { seriesList } from '../lib/posts'

export default function SeriesStrip() {
  if (seriesList.length === 0) return null

  return (
    <div className="series-strip">
      {seriesList.map((s) => {
        const last = s.posts[s.posts.length - 1]
        return (
          <Link
            key={s.name}
            to={`/series/${encodeURIComponent(s.name)}`}
            className="series-strip__card"
            viewTransition
          >
            <div className="series-strip__top">
              <span className="series-strip__name">{s.name}</span>
              <span className="series-strip__count">{s.count}편</span>
            </div>
            <p className="series-strip__latest">
              {last.seriesOrder}. {last.title}
            </p>
            <div className="series-strip__dots">
              {s.posts.map((p, i) => (
                <span key={i} className="series-strip__dot" />
              ))}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
