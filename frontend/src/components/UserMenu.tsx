import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { AuthModal } from './AuthModal'

interface Props {
  onNavigate: (page: 'saved' | 'history' | null) => void
}

export function UserMenu({ onNavigate }: Props) {
  const { user, logout, isLoggedIn } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!isLoggedIn) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="text-xs font-medium text-indigo-200 hover:text-white border border-indigo-500/30 hover:border-indigo-400/50 hover:bg-white/5 rounded-lg px-3 py-1.5 transition-all"
        >登录</button>
        {showModal && <AuthModal onClose={() => setShowModal(false)} />}
      </>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center hover:bg-blue-700 transition-colors"
        title={user!.email}
      >
        {user!.email[0].toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-10 bg-white border border-gray-100 rounded-xl shadow-lg w-48 py-1 z-50">
          <div className="px-4 py-2 text-xs text-gray-400 truncate">{user!.email}</div>
          <hr className="my-1 border-gray-100" />
          <button
            onClick={() => { onNavigate('saved'); setOpen(false) }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
          >收藏夹</button>
          <button
            onClick={() => { onNavigate('history'); setOpen(false) }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
          >AI 对话记录</button>
          <hr className="my-1 border-gray-100" />
          <button
            onClick={() => { logout(); setOpen(false); onNavigate(null) }}
            className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
          >退出登录</button>
        </div>
      )}
    </div>
  )
}
