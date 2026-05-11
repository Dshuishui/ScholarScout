import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import type { ChatMessage } from '../hooks/usePaperChat'

interface ChatRecord {
  paper_id_hash: string
  paper: Paper
  messages: ChatMessage[]
  updated_at: string
}

interface Props {
  token: string
  onClose: () => void
  onOpenChat: (paper: Paper) => void
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

export function HistoryPage({ token, onClose, onOpenChat }: Props) {
  const [records, setRecords] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user/chats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((data: ChatRecord[]) => { setRecords(data); setLoading(false) })
  }, [token])

  const handleOpen = (paper: Paper) => {
    onClose()
    setTimeout(() => onOpenChat(paper), 100)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div>
          <h2 className="font-semibold text-gray-800">AI 对话记录</h2>
          <p className="text-xs text-gray-400 mt-0.5">点击论文可继续对话</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && <p className="text-center text-gray-400 mt-8">加载中…</p>}
        {!loading && records.length === 0 && (
          <p className="text-center text-gray-400 mt-8">还没有 AI 对话记录，点击论文卡片的「AI 对话」开始吧</p>
        )}
        {records.map(rec => {
          const lastMsg = [...rec.messages].reverse().find(m => m.role === 'assistant')
          return (
            <button
              key={rec.paper_id_hash}
              onClick={() => handleOpen(rec.paper)}
              className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug">{rec.paper.title}</p>
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{timeAgo(rec.updated_at)}</span>
              </div>
              {lastMsg && (
                <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">{lastMsg.content}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-blue-500">{rec.messages.length} 条消息</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">{rec.paper.source}</span>
                <span className="ml-auto text-xs text-blue-500 font-medium">继续对话 →</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
