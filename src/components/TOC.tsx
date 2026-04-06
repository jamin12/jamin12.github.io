import { useEffect, useRef, useState } from 'react'

// 본문 DOM에서 h2/h3를 추출해 목차를 렌더링한다.
// rehype-slug가 id를 부여한 뒤 마운트되므로 렌더 이후 DOM에서 읽는다.
//
// Scroll-spy (2026-04 4차 추가):
//  1. 윈도우 scroll 이벤트를 rAF로 throttle해 현재 "읽고 있는" 헤딩을 active로 마킹
//  2. active가 바뀌면 TOC 내부 `.post-sidebar` 스크롤 컨테이너에서 해당 항목을
//     자동으로 중앙 근처로 끌어옴 (`scrollIntoView` `block: nearest`)
//
// 판정 규칙: 뷰포트 상단에서 120px 아래 지점을 기준선으로 잡고,
// 그 기준선보다 **위에 있는 헤딩들 중 가장 마지막 것**(= 가장 가까운 것)을 active로.
// 이유: 독자는 보통 화면 상단-중앙 영역의 제목 아래 문단을 읽고 있으므로,
// "방금 지나친 제목"이 현재 섹션이라고 판단.
export default function TOC({ containerRef }) {
  const [headings, setHeadings] = useState([])
  const [activeId, setActiveId] = useState(null)
  const tocRef = useRef(null)

  // 1. 본문에서 h2/h3 수집
  useEffect(() => {
    if (!containerRef?.current) return
    const els = containerRef.current.querySelectorAll('h2, h3')
    setHeadings(
      Array.from(els)
        .filter((el) => el.id)
        .map((el) => ({
          id: el.id,
          text: el.textContent,
          level: el.tagName === 'H2' ? 2 : 3,
        }))
    )
  }, [containerRef])

  // 2. 스크롤 스파이 — rAF throttled
  useEffect(() => {
    if (headings.length === 0) return

    let ticking = false
    const update = () => {
      ticking = false
      const threshold = window.scrollY + 120
      let current = null
      for (const h of headings) {
        const el = document.getElementById(h.id)
        if (!el) continue
        if (el.offsetTop <= threshold) {
          current = h.id
        } else {
          break
        }
      }
      // 맨 위에서는 첫 헤딩을 active로
      if (!current && headings.length > 0) {
        current = headings[0].id
      }
      setActiveId((prev) => (current && current !== prev ? current : prev))
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    update() // 초기 1회
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [headings])

  // 3. active 항목이 바뀌면 TOC 내부 스크롤 컨테이너에서 해당 링크를 보이게
  useEffect(() => {
    if (!activeId || !tocRef.current) return
    // 같은 id가 본문에도 있을 수 있으니 TOC 내부에서만 쿼리
    const activeLink = tocRef.current.querySelector(
      `a[data-toc-id="${CSS.escape(activeId)}"]`
    )
    if (!activeLink) return

    const scrollParent = tocRef.current.closest('.post-sidebar')
    if (!scrollParent) return

    // 이미 컨테이너 안에 잘 보이면 스크롤 안 함 (불필요한 움직임 방지)
    const linkRect = activeLink.getBoundingClientRect()
    const parentRect = scrollParent.getBoundingClientRect()
    const marginTop = 40
    const marginBottom = 40
    const isFullyVisible =
      linkRect.top >= parentRect.top + marginTop &&
      linkRect.bottom <= parentRect.bottom - marginBottom
    if (isFullyVisible) return

    activeLink.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }, [activeId])

  if (headings.length === 0) return null

  return (
    <nav className="toc" aria-label="목차" ref={tocRef}>
      <div className="toc__title">목차</div>
      <ul className="toc__list">
        {headings.map((h) => (
          <li
            key={h.id}
            className={`toc__item toc__item--h${h.level}`}
          >
            <a
              href={`#${h.id}`}
              data-toc-id={h.id}
              className={`toc__link ${
                activeId === h.id ? 'toc__link--active' : ''
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
