import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'

interface FeedbackItem {
  id: number
  content: string
  location: string | null
  is_author: boolean
  created_at: string
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FeedbackWidget() {
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const feedRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchFeedback = () => {
    fetch('/api/feedback')
      .then(r => r.json())
      .then((data: FeedbackItem[]) => {
        setItems(data)
        setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }), 50)
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (!open) return
    fetchFeedback()
    const interval = setInterval(fetchFeedback, 30000)
    return () => clearInterval(interval)
  }, [open])

  useEffect(() => {
    if (cooldown <= 0) return
    timerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current!)
  }, [cooldown])

  const submit = async () => {
    const content = text.trim()
    if (!content || submitting || cooldown > 0) return
    setSubmitting(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      })
      if (r.status === 429) { setError('发送太频繁，请稍后再试'); return }
      if (!r.ok) { setError('发送失败，请重试'); return }
      setText('')
      setCooldown(60)
      fetchFeedback()
      setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }), 100)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        title="用户留言板"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* 反馈面板 */}
      {open && (
        <div
          className="fixed right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
          style={{ bottom: '88px', height: '480px' }}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0 bg-gradient-to-r from-blue-50 to-white">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">用户留言板</h3>
              <p className="text-xs text-gray-400">公开 · 所有人可见 · 实时更新</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>

          {/* 留言流 */}
          <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {items.length === 0 && (
              <p className="text-center text-gray-400 text-sm mt-8">还没有留言，来说点什么吧 👋</p>
            )}
            {items.map(item => (
              <div
                key={item.id}
                className={`rounded-xl px-3 py-2.5 border ${item.is_author ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}
              >
                {/* 头部：作者标签 + 时间 */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  {item.is_author ? (
                    <span className="text-[10px] font-bold text-white bg-blue-500 rounded-full px-1.5 py-0.5 leading-none">作者</span>
                  ) : (
                    <span className="text-[10px] text-gray-400">匿名</span>
                  )}
                  <span className="text-[10px] text-gray-300">·</span>
                  <span className="text-[10px] text-gray-400">{formatTime(item.created_at)}</span>
                  {item.location && (
                    <>
                      <span className="text-[10px] text-gray-300">·</span>
                      <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {item.location}
                      </span>
                    </>
                  )}
                </div>
                {/* 内容 */}
                <p className="text-sm text-gray-700 leading-relaxed break-words">{item.content}</p>
              </div>
            ))}
          </div>

          {/* 输入区 */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value.slice(0, 200))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="说点什么… (Enter 发送)"
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-300"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-300">{text.length}/200</span>
              <div className="flex items-center gap-2">
                {error && <span className="text-xs text-red-400">{error}</span>}
                <button
                  onClick={submit}
                  disabled={!text.trim() || submitting || cooldown > 0}
                  className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 transition-colors"
                >
                  {cooldown > 0 ? `${cooldown}s` : '发送'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
