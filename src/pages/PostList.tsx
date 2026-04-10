import { Link } from 'react-router'
import { publicPosts, categories, tags, formatCategory } from '../lib/posts'
import PostCards from '../components/PostCards'
import LatestGrid from '../components/LatestGrid'
import SeriesStrip from '../components/SeriesStrip'
import SEOHead from '../components/SEOHead'

// ── 홈 노출 설정 ──
const POSTS_PER_CATEGORY = 5 // `03 카테고리별 최근` 각 섹션의 글 수
const LATEST_COUNT = 6 // `01 최신 글`의 카드 수

// posts는 이미 날짜 내림차순이므로 각 카테고리의 첫 글 = 최신 글
function buildCategoryGroups() {
  const map = new Map()
  for (const post of publicPosts) {
    if (!map.has(post.category)) map.set(post.category, [])
    map.get(post.category).push(post)
  }
  return [...map.entries()]
    .map(([name, list]) => ({
      name,
      posts: list,
      count: list.length,
      latestDate: list[0]?.date || '',
    }))
    .sort((a, b) => (a.latestDate < b.latestDate ? 1 : -1))
}

export default function PostList() {
  const latest = publicPosts.slice(0, LATEST_COUNT)
  const groups = buildCategoryGroups()

  return (
    <div className="page-home">
      <SEOHead />
      {/* 01 최신 글 */}
      <section className="home-section">
        <header className="home-section__header">
          <h2 className="home-section__title">최신 글</h2>
          <p className="home-section__subtitle">
            따끈따끈 새로 올라온 글부터 골라보세요
          </p>
        </header>
        <LatestGrid posts={latest} />
      </section>

      {/* 02 시리즈 */}
      <section className="home-section">
        <header className="home-section__header">
          <h2 className="home-section__title">시리즈</h2>
          <p className="home-section__subtitle">
            순서대로 이어지는 글 묶음
          </p>
        </header>
        <SeriesStrip />
      </section>

      {/* 03 카테고리별 최근 글 */}
      {groups.length > 0 && (
        <section className="home-section">
          <header className="home-section__header">
            <h2 className="home-section__title">카테고리별 최근</h2>
            <p className="home-section__subtitle">
              각 카테고리의 최신 {POSTS_PER_CATEGORY}개를 한눈에
            </p>
          </header>
          <div className="category-sections">
            {groups.map((group) => (
              <section key={group.name} className="category-section">
                <header className="category-section__header">
                  <h3 className="category-section__title">
                    <Link to={`/categories/${encodeURIComponent(group.name)}`}>
                      {formatCategory(group.name)}
                    </Link>
                    <span className="category-section__count">
                      {group.count}
                    </span>
                  </h3>
                </header>
                <PostCards posts={group.posts.slice(0, POSTS_PER_CATEGORY)} />
                {group.count > POSTS_PER_CATEGORY && (
                  <p className="category-section__more">
                    <Link to={`/categories/${encodeURIComponent(group.name)}`}>
                      → {formatCategory(group.name)} 전체 {group.count}개 보기
                    </Link>
                  </p>
                )}
              </section>
            ))}
          </div>
        </section>
      )}

      {/* 04 태그 */}
      {tags.length > 0 && (
        <section className="home-section">
          <header className="home-section__header">
            <h2 className="home-section__title">태그</h2>
            <p className="home-section__subtitle">
              {tags.length}개의 태그로 더 좁게 탐색
            </p>
          </header>
          <ul className="tag-cloud">
            {tags.map((t) => (
              <li key={t.name}>
                <Link
                  to={`/tags/${encodeURIComponent(t.name)}`}
                  className="tag-chip"
                >
                  #{t.name}
                  <span className="tag-chip__count">{t.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
