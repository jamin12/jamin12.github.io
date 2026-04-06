import { lazy, Suspense } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router'
import PostList from './pages/PostList.jsx'
import CategoryPage from './pages/CategoryPage.jsx'
import TagPage from './pages/TagPage.jsx'
import SeriesPage from './pages/SeriesPage.jsx'
import SeriesDetailPage from './pages/SeriesDetailPage.jsx'
import Sidebar from './components/Sidebar.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import './App.css'

// PostDetail은 shiki(언어 문법 16개) + KaTeX를 포함해 번들이 무거우므로 lazy 로드
// → 홈/카테고리/태그 진입 시에는 하이라이터·수식 엔진을 로드하지 않음
const PostDetail = lazy(() => import('./pages/PostDetail.jsx'))

function NotFound() {
  return (
    <div className="post-not-found">
      <p className="not-found__code">404</p>
      <p>페이지를 찾을 수 없어요.</p>
      <Link to="/">홈으로 돌아가기</Link>
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const isPostDetail = location.pathname.startsWith('/posts/')

  return (
    <div className="app">
      <ScrollToTop />
      <Sidebar />
      <div className="app__shell">
        {/* < 1024px 전용 top bar. 데스크톱에선 CSS로 숨김 */}
        <header className="app__topbar">
          <Link to="/" className="app__topbar-brand">
            <span className="app__topbar-avatar" aria-hidden="true">J</span>
            <span>jaminLog</span>
          </Link>
          <ThemeToggle />
        </header>
        <main className={`app__main ${isPostDetail ? 'app__main--post' : ''}`}>
          <Routes>
            <Route path="/" element={<PostList />} />
            <Route
              path="/posts/:slug"
              element={
                <Suspense fallback={<p className="empty">불러오는 중...</p>}>
                  <PostDetail />
                </Suspense>
              }
            />
            <Route path="/categories/:category" element={<CategoryPage />} />
            <Route
              path="/categories/:category/:subcategory"
              element={<CategoryPage />}
            />
            <Route path="/series" element={<SeriesPage />} />
            <Route path="/series/:name" element={<SeriesDetailPage />} />
            <Route path="/tags/:tag" element={<TagPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <footer className="app__footer">
          <p>© jaminLog · Built with React 19 + Vite</p>
        </footer>
      </div>
    </div>
  )
}
