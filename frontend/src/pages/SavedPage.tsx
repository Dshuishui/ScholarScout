import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import { PaperCard } from '../components/PaperCard'
import { useAuth } from '../hooks/useAuth'

interface SavedItem {
  id: number
  paper_id_hash: string
  paper: Paper
}

interface Props {
  token: string
  onClose: () => void
}

export function SavedPage({ token, onClose }: Props) {
  const { sessionExpired } = useAuth()
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    fetch('/api/user/saved', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { sessionExpired(); return null } if (!r.ok) throw new Error(); return r.json() })
      .then((data: SavedItem[] | null) => { if (data) setItems(Array.isArray(data) ? data : []) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const unsave = async (item: SavedItem) => {
    await fetch(`/api/user/saved/${item.paper_id_hash}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 与 SubscriptionsPage 统一的深色顶栏 */}
      <div
        className="h-11 flex-shrink-0 flex items-center px-4 justify-between z-10 relative"
        style={{
          background: '#080818',
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.07) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          borderBottom: '1px solid rgba(99,102,241,0.18)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <button
            onClick={onClose}
            className="text-indigo-300/70 hover:text-indigo-200 transition-colors p-1 rounded hover:bg-white/5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-bold text-white tracking-tight">收藏夹</span>
        </div>
        {!loading && !error && (
          <span className="text-xs text-indigo-300/50">{items.length} 篇论文</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-center text-gray-400 mt-8">加载中…</p>}
        {!loading && error && (
          <div className="text-center mt-12">
            <p className="text-gray-500 mb-3">加载失败，请重试</p>
            <button
              onClick={load}
              className="text-sm text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-4 py-1.5 transition-colors"
            >重新加载</button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="text-center mt-12">
            <p className="text-gray-400 mb-1">还没有收藏的论文</p>
            <p className="text-xs text-gray-300">在搜索结果中点击「收藏」按钮添加</p>
          </div>
        )}
        {items.map(item => (
          <PaperCard
            key={item.id}
            paper={item.paper}
            isSaved={true}
            onSave={() => unsave(item)}
          />
        ))}
      </div>
    </div>
  )
}
