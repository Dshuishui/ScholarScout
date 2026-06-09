import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import type { ChatMessage } from '../hooks/usePaperChat'
import { useAuth } from '../hooks/useAuth'

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
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z'
  const diff = Math.floor((Date.now() - new Date(utc).getTime()) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

export function HistoryPage({ token, onClose, onOpenChat }: Props) {
  const { sessionExpired } = useAuth()
  const [records, setRecords] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    fetch('/api/user/chats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { sessionExpired(); return null } if (!r.ok) throw new Error(); return r.json() })
      .then((data: ChatRecord[] | null) => { if (data) setRecords(Array.isArray(data) ? data : []) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = (paper: Paper) => {
    onClose()
    setTimeout(() => onOpenChat(paper), 100)
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
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-indigo-300/80 hover:text-white transition-colors p-1 rounded hover:bg-white/5"
            title="返回主页"
          >
            <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(59,130,246,0.9))' }}>
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="text-xs font-semibold tracking-tight hidden sm:inline">ScholarScout</span>
          </button>
          <span className="text-indigo-300/30 text-xs">/</span>
          <span className="text-sm font-bold text-white tracking-tight">AI 对话记录</span>
        </div>
        {!loading && !error && (
          <span className="text-xs text-indigo-300/50">{records.length} 条记录</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
        {!loading && !error && records.length === 0 && (
          <div className="text-center mt-12">
            <p className="text-gray-400 mb-1">还没有 AI 对话记录</p>
            <p className="text-xs text-gray-300">点击论文卡片的「AI 对话」按钮开始</p>
          </div>
        )}
        {records.map(rec => {
          const lastMsg = [...rec.messages].reverse().find(m => m.role === 'assistant')
          return (
            <button
              key={rec.paper_id_hash}
              onClick={() => handleOpen(rec.paper)}
              className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 hover:border-indigo-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug">{rec.paper.title}</p>
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{timeAgo(rec.updated_at)}</span>
              </div>
              {lastMsg && (
                <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">{lastMsg.content}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-indigo-500">{rec.messages.length} 条消息</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">{rec.paper.source}</span>
                <span className="ml-auto text-xs text-indigo-500 font-medium">继续对话 →</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
