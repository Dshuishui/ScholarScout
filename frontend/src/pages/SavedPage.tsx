import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import { PaperCard } from '../components/PaperCard'

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
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch('/api/user/saved', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: SavedItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [token])

  const unsave = async (item: SavedItem) => {
    await fetch(`/api/user/saved/${item.paper_id_hash}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">收藏夹</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="text-center text-gray-400 mt-8">加载中…</p>}
        {!loading && error && <p className="text-center text-red-400 mt-8">加载失败，请刷新重试</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-center text-gray-400 mt-8">还没有收藏的论文</p>
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
