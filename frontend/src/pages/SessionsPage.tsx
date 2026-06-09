import { useEffect, useState } from 'react'
import { getSessions, deleteSession } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import type { SearchSessionItem } from '../types'

interface Props {
  token: string
  onClose: () => void
  onLoad: (session: SearchSessionItem) => void
}

const MODE_LABELS: Record<string, string> = {
  compare: '对比',
  review: '综述',
  trend: '趋势',
}

function timeAgo(iso: string): string {
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z'
  const diff = Math.floor((Date.now() - new Date(utc).getTime()) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

export function SessionsPage({ token, onClose, onLoad }: Props) {
  const { sessionExpired } = useAuth()
  const [sessions, setSessions] = useState<SearchSessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const data = await getSessions(token)
      setSessions(Array.isArray(data) ? data : [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    setDeleting(id)
    const ok = await deleteSession(token, id)
    if (ok) setSessions(prev => prev.filter(s => s.id !== id))
    setDeleting(null)
  }

  return (
    <div className="flex flex-col h-full bg-white">
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
          <span className="text-sm font-bold text-white tracking-tight">搜索快照</span>
        </div>
        {!loading && !error && (
          <span className="text-xs text-indigo-300/50">{sessions.length} 条记录</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading && <p className="text-center text-gray-400 mt-8 text-sm">加载中…</p>}

        {!loading && error && (
          <div className="text-center mt-12">
            <p className="text-gray-500 mb-3 text-sm">加载失败，请重试</p>
            <button
              onClick={load}
              className="text-sm text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-4 py-1.5 transition-colors"
            >重新加载</button>
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center mt-12">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm mb-1">还没有搜索快照</p>
            <p className="text-xs text-gray-300">每次搜索完成后会自动保存快照</p>
          </div>
        )}

        {sessions.map(session => {
          const isExpanded = expanded === session.id
          const savedModes = Object.keys(session.analysis)
          return (
            <div
              key={session.id}
              className="bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-indigo-100 transition-colors"
            >
              {/* 标题行 */}
              <button
                className="w-full text-left px-4 py-3 flex items-start gap-3"
                onClick={() => setExpanded(isExpanded ? null : session.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {session.keywords.map(kw => (
                      <span key={kw} className="text-[11px] font-medium bg-indigo-50 text-indigo-600 rounded-full px-2 py-0.5 border border-indigo-100">
                        {kw}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{session.papers.length} 篇论文</span>
                    {savedModes.length > 0 && (
                      <>
                        <span className="text-gray-200">·</span>
                        <div className="flex gap-1">
                          {savedModes.map(m => (
                            <span key={m} className="text-[10px] bg-violet-50 text-violet-500 rounded px-1.5 py-0.5 border border-violet-100">
                              {MODE_LABELS[m] ?? m}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-gray-400">{timeAgo(session.created_at)}</span>
                  </div>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="px-4 pb-3 border-t border-gray-50">
                  {/* 论文列表（前 5 条） */}
                  <div className="mt-2.5 space-y-1 mb-3">
                    {session.papers.slice(0, 5).map((p, i) => (
                      <div key={p.paper_id} className="flex items-start gap-2">
                        <span className="text-[10px] font-bold text-violet-400 mt-0.5 flex-shrink-0 w-4">[{i + 1}]</span>
                        <p className="text-xs text-gray-600 line-clamp-1 flex-1">{p.title}</p>
                        {p.published_date && (
                          <span className="text-[10px] text-gray-300 flex-shrink-0">{p.published_date.slice(0, 4)}</span>
                        )}
                      </div>
                    ))}
                    {session.papers.length > 5 && (
                      <p className="text-xs text-gray-400 pl-6">…还有 {session.papers.length - 5} 篇</p>
                    )}
                  </div>

                  {/* 已保存的分析预览 */}
                  {savedModes.length > 0 && (
                    <div className="mb-3 space-y-1.5">
                      {savedModes.map(m => (
                        <div key={m} className="bg-violet-50 rounded-lg px-3 py-2 border border-violet-100">
                          <span className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide">{MODE_LABELS[m] ?? m} 分析</span>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{session.analysis[m]?.slice(0, 120)}…</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { onLoad(session); onClose() }}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg py-2 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      加载论文
                    </button>
                    <button
                      onClick={e => handleDelete(e, session.id)}
                      disabled={deleting === session.id}
                      className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 border border-red-100 hover:border-red-300 bg-white hover:bg-red-50 rounded-lg px-3 py-2 transition-colors disabled:opacity-40"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
