import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'

interface ReplySnippet {
  id: number
  content: string
  recalled: boolean
}

interface FeedbackItem {
  id: number
  content: string | null
  recalled: boolean
  location: string | null
  is_author: boolean
  created_at: string
  can_recall: boolean
  reply_to: ReplySnippet | null
}

function formatRelativeTime(iso: string): string {
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z'
  const diff = Date.now() - new Date(utc).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 10) return '刚刚'
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  const d = new Date(utc)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Rate limit: max 5 sends per 2 min
function checkRateLimit(sendTimes: number[]): string | null {
  const now = Date.now()
  const recent = sendTimes.filter(t => now - t < 120000)
  if (recent.length >= 5) return '2 分钟内最多发送 5 条，请稍后再试'
  return null
}

export function FeedbackWidget() {
  const { token, isLoggedIn } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sendTimes, setSendTimes] = useState<number[]>([])
  const [replyTo, setReplyTo] = useState<FeedbackItem | null>(null)
  const [recalling, setRecalling] = useState<number | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (feedRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight
      }
    }, 60)
  }, [])

  const fetchFeedback = useCallback(() => {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/feedback', { headers })
      .then(r => r.json())
      .then((data: FeedbackItem[]) => {
        setItems(data)
        scrollToBottom()
      })
      .catch(() => {})
  }, [token, scrollToBottom])

  useEffect(() => {
    if (!open) return
    fetchFeedback()
    const interval = setInterval(fetchFeedback, 20000)
    return () => clearInterval(interval)
  }, [open, fetchFeedback])

  // Re-fetch when login state changes (to get can_recall flags)
  useEffect(() => {
    if (open) fetchFeedback()
  }, [isLoggedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    const content = text.trim()
    if (!content || submitting) return
    const limitErr = checkRateLimit(sendTimes)
    if (limitErr) { setError(limitErr); return }

    setSubmitting(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({ content, reply_to_id: replyTo?.id ?? null }),
      })
      if (r.status === 429) { setError('服务器限流，请稍后再试'); return }
      if (!r.ok) { setError('发送失败，请重试'); return }

      const result = await r.json() as { ok: boolean; id: number; created_at: string }

      // 乐观更新：立刻显示，不等 GET 返回
      const optimisticItem: FeedbackItem = {
        id: result.id,
        content,
        recalled: false,
        location: null,
        is_author: false,
        created_at: result.created_at,
        can_recall: isLoggedIn,
        reply_to: replyTo
          ? { id: replyTo.id, content: (replyTo.content ?? '').slice(0, 80), recalled: replyTo.recalled }
          : null,
      }
      setItems(prev => [...prev, optimisticItem])
      scrollToBottom()

      setText('')
      setReplyTo(null)
      setSendTimes(prev => [...prev, Date.now()])

      // 后台刷新以获取准确数据（location、is_author 等）
      setTimeout(fetchFeedback, 800)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRecall = async (id: number) => {
    if (!token || recalling) return
    setRecalling(id)
    try {
      const r = await fetch(`/api/feedback/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        setItems(prev => prev.map(item =>
          item.id === id ? { ...item, recalled: true, content: null, can_recall: false } : item
        ))
      } else {
        const data = await r.json().catch(() => ({}))
        setError(data.detail ?? '撤回失败')
      }
    } catch {
      setError('网络错误')
    } finally {
      setRecalling(null)
    }
  }

  const limitMsg = checkRateLimit(sendTimes)

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
        {items.length > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
            {items.filter(i => !i.recalled).length > 9 ? '9+' : items.filter(i => !i.recalled).length}
          </span>
        )}
      </button>

      {/* 留言面板 */}
      {open && (
        <div
          className="fixed right-6 z-50 flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
          style={{
            bottom: '88px',
            width: 'min(560px, calc(100vw - 32px))',
            height: 'min(680px, 80vh)',
          }}
        >
          {/* 头部 */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">用户留言板</h3>
              <p className="text-xs text-gray-400 mt-0.5">公开 · 所有人可见 · 每 20 秒自动更新</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 留言流 */}
          <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {items.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 text-sm">
                <svg className="w-10 h-10 mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                还没有留言，来说点什么吧 👋
              </div>
            )}

            {items.map(item => (
              <div key={item.id} className="group">
                {/* 引用块 */}
                {item.reply_to && (
                  <div className="ml-3 mb-1 flex items-start gap-1.5">
                    <div className="w-0.5 self-stretch bg-gray-200 rounded-full flex-shrink-0" />
                    <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2">
                      {item.reply_to.recalled ? '原留言已撤回' : item.reply_to.content}
                    </p>
                  </div>
                )}

                {/* 消息气泡 */}
                <div className={`rounded-xl px-3.5 py-2.5 transition-colors ${
                  item.is_author
                    ? 'bg-blue-50 border border-blue-100'
                    : item.recalled
                    ? 'bg-gray-50 border border-gray-100 opacity-50'
                    : 'bg-gray-50 border border-gray-100 hover:bg-white hover:border-gray-200'
                }`}>
                  {/* 元信息行 */}
                  <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    {item.is_author ? (
                      <span className="text-[10px] font-bold text-white bg-blue-500 rounded-full px-1.5 py-0.5 leading-none">作者</span>
                    ) : (
                      <span className="text-[10px] font-medium text-gray-400">匿名用户</span>
                    )}
                    <span className="text-[10px] text-gray-300">·</span>
                    <span className="text-[10px] text-gray-400">{formatRelativeTime(item.created_at)}</span>
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
                  {item.recalled ? (
                    <p className="text-xs text-gray-300 italic">此条留言已被撤回</p>
                  ) : (
                    <p className="text-sm text-gray-700 leading-relaxed break-words">{item.content}</p>
                  )}

                  {/* 操作按钮 */}
                  {!item.recalled && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => { setReplyTo(item); textareaRef.current?.focus() }}
                        className="text-[11px] text-gray-400 hover:text-blue-500 flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        回复
                      </button>
                      {item.can_recall && (
                        <button
                          onClick={() => handleRecall(item.id)}
                          disabled={recalling === item.id}
                          className="text-[11px] text-gray-300 hover:text-red-400 flex items-center gap-1 transition-colors disabled:opacity-50 ml-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          {recalling === item.id ? '撤回中…' : '撤回'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 输入区 */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
            {/* 引用预览 */}
            {replyTo && (
              <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
                <div className="w-0.5 self-stretch bg-blue-300 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-blue-600 mb-0.5">回复</p>
                  <p className="text-xs text-blue-500 truncate">{replyTo.content?.slice(0, 60)}</p>
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  className="text-blue-300 hover:text-blue-500 flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => { setText(e.target.value.slice(0, 200)); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
              placeholder={replyTo ? `回复：${replyTo.content?.slice(0, 30)}…` : '说点什么… (Enter 发送，Shift+Enter 换行)'}
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-gray-300"
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-300">{text.length}/200</span>
                {(error || limitMsg) && (
                  <span className="text-xs text-red-400">{error || limitMsg}</span>
                )}
              </div>
              <button
                onClick={handleSubmit}
                disabled={!text.trim() || submitting || !!limitMsg}
                className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-3.5 py-1.5 transition-colors"
              >
                {submitting ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
