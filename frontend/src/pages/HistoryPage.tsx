import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import { PaperCard } from '../components/PaperCard'

interface Props {
  token: string
  onClose: () => void
}

export function HistoryPage({ token, onClose }: Props) {
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user/history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((data: Paper[]) => { setPapers(data); setLoading(false) })
  }, [token])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">阅读历史</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="text-center text-gray-400 mt-8">加载中…</p>}
        {!loading && papers.length === 0 && (
          <p className="text-center text-gray-400 mt-8">还没有阅读记录</p>
        )}
        {papers.map((p, i) => (
          <PaperCard key={`${p.paper_id}-${i}`} paper={p} />
        ))}
      </div>
    </div>
  )
}
