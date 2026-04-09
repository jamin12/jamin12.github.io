import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface LightboxProps {
  onClose: () => void
  children: React.ReactNode
}

export default function Lightbox({ onClose, children }: LightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content">
        {children}
      </div>
      <button className="lightbox-close" onClick={onClose} aria-label="닫기">
        ×
      </button>
    </div>,
    document.body,
  )
}
