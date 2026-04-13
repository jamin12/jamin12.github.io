import { Link } from 'react-router'
import SEOHead from '../components/SEOHead'

export default function AboutPage() {
  return (
    <>
      <SEOHead
        title="About — jaminLog"
        description="jaminLog 소개 및 연락처"
      />
      <div className="page-about">
        <header className="about__header">
          <span className="about__avatar" aria-hidden="true">J</span>
          <div>
            <h1 className="about__name">jamin</h1>
            <p className="about__bio">개발 기록과 생각을 남기는 공간</p>
          </div>
        </header>

        <section className="about__section">
          <h2 className="about__section-title">Connect</h2>
          <div className="about__channels">
            <div className="about__channel about__channel--static">
              <svg className="about__channel-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
              <div>
                <span className="about__channel-name">Email</span>
                <span className="about__channel-desc">rudals9901@naver.com</span>
              </div>
            </div>
          </div>
        </section>

        <nav className="about__back">
          <Link to="/">← 홈으로</Link>
        </nav>
      </div>
    </>
  )
}
