import { Link } from 'react-router'
import { privatePosts, formatCategory } from '../lib/posts'
import PostCards from '../components/PostCards'
import SEOHead from '../components/SEOHead'

export default function PrivateListPage() {
  return (
    <div className="page-home">
      <SEOHead title="비밀글" />
      <section className="home-section">
        <header className="home-section__header">
          <h2 className="home-section__title">비밀글</h2>
          <p className="home-section__subtitle">
            목록에 공개되지 않는 글 {privatePosts.length}개
          </p>
        </header>
        {privatePosts.length > 0 ? (
          <PostCards posts={privatePosts} />
        ) : (
          <p className="empty">비밀글이 없습니다.</p>
        )}
      </section>
    </div>
  )
}
