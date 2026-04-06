import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router'

// 새 페이지 이동(PUSH/REPLACE) 시 스크롤을 최상단으로.
// 뒤로/앞으로(POP)는 브라우저 기본 복원을 그대로 사용.
// 해시(#anchor)가 있으면 앵커 스크롤을 방해하지 않도록 스킵.
export default function ScrollToTop() {
  const { pathname } = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    if (navType === 'POP') return
    if (typeof window === 'undefined') return
    if (window.location.hash) return
    window.scrollTo(0, 0)
  }, [pathname, navType])

  return null
}
