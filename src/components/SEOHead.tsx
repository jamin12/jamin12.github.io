import { Helmet } from 'react-helmet-async'

const SITE_NAME = 'jaminLog'
const SITE_URL = 'https://jamin12.github.io'
const DEFAULT_DESCRIPTION = '개발 경험과 기술 지식을 기록하는 개인 블로그'

interface SEOHeadProps {
  title?: string
  description?: string
  path?: string
  type?: 'website' | 'article'
  publishedTime?: string
  tags?: string[]
}

export default function SEOHead({
  title,
  description = DEFAULT_DESCRIPTION,
  path = '/',
  type = 'website',
  publishedTime,
  tags,
}: SEOHeadProps) {
  const pageTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME
  const canonicalUrl = `${SITE_URL}${path}`

  return (
    <Helmet>
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:locale" content="ko_KR" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />

      {/* Article metadata */}
      {type === 'article' && publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {type === 'article' &&
        tags?.map((tag) => (
          <meta property="article:tag" content={tag} key={tag} />
        ))}
    </Helmet>
  )
}
