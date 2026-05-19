import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Subscription {
  id: number
  keywords: string[]
  active: boolean
  created_at: string
  last_sent: string | null
}

interface TestResult {
  sent: boolean
  count: number
  reason?: string
}

interface Props {
  token: string
  onClose: () => void
}

function formatDate(iso: string | null) {
  if (!iso) return '从未'
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export function SubscriptionsPage({ token, onClose }: Props) {
  const { sessionExpired } = useAuth()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({})

  useEffect(() => {
    fetch('/api/subscriptions', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { sessionExpired(); return null } return r.json() })
      .then(data => { if (data) setSubs(Array.isArray(data) ? data : []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

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
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleTestSend = async (id: number) => {
    setTestingId(id)
    setTestResults(prev => { const n = { ...prev }; delete n[id]; return n })
    try {
      const r = await fetch(`/api/subscriptions/${id}/test-send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        const result: TestResult = await r.json()
        setTestResults(prev => ({ ...prev, [id]: result }))
      } else {
        setTestResults(prev => ({ ...prev, [id]: { sent: false, count: 0, reason: '请求失败' } }))
      }
    } catch {
      setTestResults(prev => ({ ...prev, [id]: { sent: false, count: 0, reason: '网络错误' } }))
    } finally {
      setTestingId(null)
    }
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
          <span className="text-sm font-bold text-white tracking-tight">订阅管理</span>
        </div>
        <span className="text-xs text-indigo-300/50">每天 8:00 自动推送</span>
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
                每天 8:00 自动将新论文发送到您的邮箱
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 mb-4">
              共 {subs.length} 个订阅 · 下次推送：{tomorrow()} 08:00
            </p>
            {subs.map(sub => {
              const result = testResults[sub.id]
              return (
                <div
                  key={sub.id}
                  className={`border rounded-2xl p-4 transition-all ${
                    sub.active
                      ? 'border-indigo-100 bg-white shadow-sm'
                      : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
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
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Test send */}
                      <button
                        onClick={() => handleTestSend(sub.id)}
                        disabled={testingId === sub.id}
                        title="立即搜索过去7天论文并发送到邮箱（测试用）"
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-50"
                      >
                        {testingId === sub.id ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        )}
                        测试发送
                      </button>

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

                  {/* Test result feedback */}
                  {result && (
                    <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${
                      result.sent
                        ? 'bg-green-50 text-green-700 border border-green-100'
                        : 'bg-amber-50 text-amber-700 border border-amber-100'
                    }`}>
                      {result.sent
                        ? `✓ 已发送 ${result.count} 篇论文到您的邮箱`
                        : `未发送：${result.reason === 'no new papers' ? '过去 7 天没有新论文' : result.reason}`}
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
