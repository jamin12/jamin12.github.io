import { useParams, Link } from 'react-router'
import { getPostsByTag } from '../lib/posts'
import PostCards from '../components/PostCards'

export default function TagPage() {
  const { tag } = useParams()
  const list = getPostsByTag(tag)

  return (
    <div className="page-list">
      <header className="page-header">
        <p className="page-header__kicker">태그</p>
        <h1 className="page-header__title">#{tag}</h1>
        <p className="page-header__count">{list.length}개의 글</p>
      </header>
      <PostCards
        posts={list}
        emptyMessage={`"#${tag}" 태그의 글이 아직 없어요.`}
      />
      <p className="back-link">
        <Link to="/">← 전체 글로 돌아가기</Link>
      </p>
    </div>
  )
}
