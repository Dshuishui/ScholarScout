import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Subscription {
  id: number
  keywords: string[]
  active: boolean
  created_at: string
  last_sent: string | null
  daily_limit: number
}

interface QueueItem {
  id: number
  paper_title: string
  paper_url: string | null
  paper_id: string | null
  planned_date: string   // YYYY-MM-DD
  sent_at: string | null
  source: string | null
  year: string | null
  citations: number | null
  abstract: string | null
}

interface Props {
  token: string
  onClose: () => void
  initialExpandId?: number
}

function formatDate(iso: string | null) {
  if (!iso) return '从未'
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatPlannedDate(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return '今天'
  if (dateStr === tomorrow) return '明天'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function QueueItemRow({ item, isSent, isToday, formatPlannedDate: fmt }: {
  item: QueueItem
  isSent: boolean
  isToday: boolean
  formatPlannedDate: (s: string) => string
}) {
  const [showAbstract, setShowAbstract] = useState(false)
  return (
    <div className={`px-2.5 py-2 rounded-lg text-xs transition-colors ${
      isSent ? 'bg-green-50/80' : isToday ? 'bg-indigo-50 border border-indigo-100' : 'bg-white/80 border border-gray-100'
    }`}>
      <div className="flex items-start gap-2.5">
        {/* 状态图标 */}
        <div className="flex-shrink-0 mt-0.5">
          {isSent ? (
            <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : isToday ? (
            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </div>
        {/* 日期 */}
        <span className={`flex-shrink-0 w-12 font-medium ${isSent ? 'text-green-600' : isToday ? 'text-indigo-600' : 'text-gray-400'}`}>
          {fmt(item.planned_date)}
        </span>
        {/* 标题 + meta */}
        <div className="flex-1 min-w-0">
          <div className={`leading-relaxed line-clamp-2 ${isSent ? 'text-gray-500' : 'text-gray-700'}`}>
            {item.paper_url ? (
              <a href={item.paper_url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 hover:underline">
                {item.paper_title}
              </a>
            ) : item.paper_title}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {item.source && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 font-medium">{item.source}</span>
            )}
            {item.year && <span className="text-[10px] text-gray-400">{item.year}</span>}
            {item.citations != null && item.citations > 0 && (
              <span className="text-[10px] text-gray-400">引用 {item.citations}</span>
            )}
            {item.abstract && (
              <button
                onClick={() => setShowAbstract(v => !v)}
                className="text-[10px] text-indigo-400 hover:text-indigo-600 transition-colors"
              >
                {showAbstract ? '收起摘要' : '查看摘要'}
              </button>
            )}
          </div>
          {showAbstract && item.abstract && (
            <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed border-l-2 border-indigo-100 pl-2">
              {item.abstract}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export function SubscriptionsPage({ token, onClose, initialExpandId }: Props) {
  const { sessionExpired } = useAuth()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // 队列展开状态
  const [expandedId, setExpandedId] = useState<number | null>(initialExpandId ?? null)
  const [queues, setQueues] = useState<Record<number, QueueItem[]>>({})
  const [queueLoading, setQueueLoading] = useState<number | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)

  // daily_limit 编辑
  const [editingLimit, setEditingLimit] = useState<Record<number, number>>({})
  const [savingLimit, setSavingLimit] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/subscriptions', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { sessionExpired(); return null } return r.json() })
      .then(data => { if (data) setSubs(Array.isArray(data) ? data : []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchQueue = useCallback(async (subId: number) => {
    setQueueLoading(subId)
    try {
      const r = await fetch(`/api/subscriptions/${subId}/queue`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        const data: QueueItem[] = await r.json()
        setQueues(prev => ({ ...prev, [subId]: data }))
      }
    } finally {
      setQueueLoading(null)
    }
  }, [token])

  // 有 initialExpandId 时，subs 加载完自动拉取队列
  useEffect(() => {
    if (initialExpandId && !loading) fetchQueue(initialExpandId)
  }, [initialExpandId, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (subId: number) => {
    if (expandedId === subId) {
      setExpandedId(null)
    } else {
      setExpandedId(subId)
      if (!queues[subId]) fetchQueue(subId)
    }
  }

  const handleToggle = async (id: number) => {
    setTogglingId(id)
    try {
      const r = await fetch(`/api/subscriptions/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        const updated: Subscription = await r.json()
        setSubs(prev => prev.map(s => s.id === id ? updated : s))
      }
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      const r = await fetch(`/api/subscriptions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok || r.status === 204) {
        setSubs(prev => prev.filter(s => s.id !== id))
        setQueues(prev => { const n = { ...prev }; delete n[id]; return n })
        if (expandedId === id) setExpandedId(null)
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleRefreshQueue = async (id: number) => {
    setRefreshingId(id)
    try {
      await fetch(`/api/subscriptions/${id}/refresh-queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      // 后台刷新，3 秒后重新拉取
      setTimeout(() => fetchQueue(id), 3000)
    } finally {
      setRefreshingId(null)
    }
  }

  const handleSaveLimit = async (id: number) => {
    const limit = editingLimit[id]
    if (!limit) return
    setSavingLimit(id)
    try {
      const r = await fetch(`/api/subscriptions/${id}/daily-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ daily_limit: limit }),
      })
      if (r.ok) {
        const updated: Subscription = await r.json()
        setSubs(prev => prev.map(s => s.id === id ? updated : s))
        setEditingLimit(prev => { const n = { ...prev }; delete n[id]; return n })
      }
    } finally {
      setSavingLimit(null)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 顶栏 */}
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
          <span className="text-sm font-bold text-white tracking-tight">订阅管理</span>
        </div>
        <span className="text-xs text-indigo-300/50">每天 08:00 自动推送</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
          </div>
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-gray-700 mb-1">还没有订阅</p>
              <p className="text-sm text-gray-400 leading-relaxed">
                搜索论文后，在关键词栏点击<strong className="text-indigo-600">「订阅更新」</strong>按钮<br />
                每天 08:00 自动将新论文发送到您的邮箱
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 mb-4">
              共 {subs.length} 个订阅 · 下次推送：{tomorrow()} 08:00
            </p>
            {subs.map(sub => {
              const isExpanded = expandedId === sub.id
              const queue = queues[sub.id] ?? []
              const currentLimit = editingLimit[sub.id] ?? sub.daily_limit

              const sentCount = queue.filter(i => i.sent_at).length
              const pendingCount = queue.filter(i => !i.sent_at).length

              return (
                <div
                  key={sub.id}
                  className={`border rounded-2xl transition-all ${
                    sub.active
                      ? 'border-indigo-100 bg-white shadow-sm'
                      : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
                  {/* 卡片主体 */}
                  <div className="p-4">
                    {/* Keywords */}
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      {sub.keywords.map((kw, i) => (
                        <span
                          key={i}
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            sub.active ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
                          }`}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>

                    {/* Meta + Actions */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-400 space-y-0.5">
                        <div>创建于 {formatDate(sub.created_at)}</div>
                        <div>上次推送：{sub.last_sent ? formatDate(sub.last_sent) : '从未'}</div>
                        {/* 每日推送篇数 */}
                        <div className="flex items-center gap-1.5 mt-1">
                          <span>每天推送</span>
                          {editingLimit[sub.id] !== undefined ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={currentLimit}
                                onChange={e => setEditingLimit(prev => ({ ...prev, [sub.id]: Math.min(10, Math.max(1, Number(e.target.value))) }))}
                                className="w-10 text-center text-xs border border-indigo-300 rounded px-1 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                              <span>篇</span>
                              <button
                                onClick={() => handleSaveLimit(sub.id)}
                                disabled={savingLimit === sub.id}
                                className="text-[10px] text-white bg-indigo-600 hover:bg-indigo-700 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingLimit(prev => { const n = { ...prev }; delete n[sub.id]; return n })}
                                className="text-[10px] text-gray-400 hover:text-gray-600"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingLimit(prev => ({ ...prev, [sub.id]: sub.daily_limit }))}
                              className="text-indigo-600 font-medium hover:underline"
                            >
                              {sub.daily_limit} 篇
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Toggle */}
                        <button
                          onClick={() => handleToggle(sub.id)}
                          disabled={togglingId === sub.id}
                          title={sub.active ? '暂停推送' : '恢复推送'}
                          className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                            sub.active ? 'bg-indigo-600' : 'bg-gray-300'
                          } ${togglingId === sub.id ? 'opacity-50' : ''}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                            sub.active ? 'left-5' : 'left-0.5'
                          }`} />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(sub.id)}
                          disabled={deletingId === sub.id}
                          title="删除订阅"
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {deletingId === sub.id ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 展开队列按钮 */}
                    <button
                      onClick={() => toggleExpand(sub.id)}
                      className="mt-3 w-full flex items-center justify-between text-xs text-gray-400 hover:text-indigo-600 transition-colors py-1.5 border-t border-gray-50"
                    >
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        推送队列
                        {queues[sub.id] && (
                          <span className="text-gray-300">
                            · 已发 {sentCount} 篇 · 待推 {pendingCount} 篇
                          </span>
                        )}
                      </span>
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* 队列展开区 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/50 rounded-b-2xl px-4 py-3">
                      {/* 操作栏 */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">推送计划</span>
                        <button
                          onClick={() => handleRefreshQueue(sub.id)}
                          disabled={refreshingId === sub.id}
                          title="重新搜索论文并追加到队列"
                          className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {refreshingId === sub.id ? (
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                          刷新队列
                        </button>
                      </div>

                      {queueLoading === sub.id ? (
                        <div className="flex justify-center py-6">
                          <div className="w-5 h-5 rounded-full border-2 border-indigo-300 border-t-transparent animate-spin" />
                        </div>
                      ) : queue.length === 0 ? (
                        (() => {
                          // 区分"刚创建正在填充"和"真的空了"
                          const createdMs = new Date(sub.created_at).getTime()
                          const isPopulating = Date.now() - createdMs < 3 * 60 * 1000 // 3分钟内
                          return isPopulating ? (
                            <div className="flex flex-col items-center gap-2 py-6 text-xs text-indigo-500">
                              <div className="w-5 h-5 rounded-full border-2 border-indigo-300 border-t-transparent animate-spin" />
                              <p className="font-medium">正在后台搜索相关论文…</p>
                              <p className="text-gray-400">通常需要 1-2 分钟，完成后点击「刷新队列」查看</p>
                            </div>
                          ) : (
                            <div className="text-center py-6 text-xs text-gray-400">
                              <p>队列已清空</p>
                              <p className="mt-1">点击「刷新队列」重新搜索并补充论文</p>
                            </div>
                          )
                        })()
                      ) : (
                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                          {queue.map(item => {
                            const isSent = !!item.sent_at
                            const isToday = item.planned_date === today
                            return (
                              <QueueItemRow
                                key={item.id}
                                item={item}
                                isSent={isSent}
                                isToday={isToday}
                                formatPlannedDate={formatPlannedDate}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
