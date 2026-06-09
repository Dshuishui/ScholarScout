import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'

const REACTIONS_KEY = 'ss_feedback_reactions'
type EmojiKey = '👍' | '❤️' | '😂' | '🤔'
const EMOJIS: EmojiKey[] = ['👍', '❤️', '😂', '🤔']

type Category = 'suggest' | 'bug' | 'chat'
const TABS: { key: Category; label: string; icon: string }[] = [
  { key: 'suggest', label: '建议', icon: '💡' },
  { key: 'bug',     label: '反馈', icon: '🐛' },
  { key: 'chat',    label: '聊天', icon: '💬' },
]

interface ReplySnippet {
  id: number
  content: string
  recalled: boolean
  is_author: boolean
}

interface FeedbackItem {
  id: number
  content: string | null
  recalled: boolean
  location: string | null
  is_author: boolean
  is_mine: boolean
  sender_name: string | null
  category: Category
  created_at: string
  can_recall: boolean
  reactions: Record<string, number>
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

function checkRateLimit(sendTimes: number[]): string | null {
  const now = Date.now()
  const recent = sendTimes.filter(t => now - t < 120000)
  if (recent.length >= 5) return '2 分钟内最多发送 5 条，请稍后再试'
  return null
}

function loadReactions(): Record<number, EmojiKey | null> {
  try { return JSON.parse(localStorage.getItem(REACTIONS_KEY) ?? '{}') }
  catch { return {} }
}
function saveReactions(r: Record<number, EmojiKey | null>) {
  localStorage.setItem(REACTIONS_KEY, JSON.stringify(r))
}

interface FeedbackWidgetProps {
  isMobileTabBar?: boolean
}

export function FeedbackWidget({ isMobileTabBar = false }: FeedbackWidgetProps) {
  const { token, isLoggedIn, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sendTimes, setSendTimes] = useState<number[]>([])
  const [replyTo, setReplyTo] = useState<FeedbackItem | null>(null)
  const [recalling, setRecalling] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<Category>('chat')
  const [myReactions, setMyReactions] = useState<Record<number, EmojiKey | null>>(() => loadReactions())
  const [serverReactions, setServerReactions] = useState<Record<number, Record<string, number>>>({})
  const feedRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 登录用户用邮箱前缀作为显示名，未登录用户匿名
  const displayName = isLoggedIn && user?.email ? user.email.split('@')[0] : '用户'

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
    }, 60)
  }, [])

  const scrollToMessage = useCallback((id: number) => {
    const el = document.getElementById(`msg-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-blue-300')
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-300'), 1500)
    }
  }, [])

  const fetchFeedback = useCallback(() => {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/feedback', { headers })
      .then(r => r.json())
      .then((data: FeedbackItem[]) => {
        setItems(data)
        // 同步服务端 reactions
        const sr: Record<number, Record<string, number>> = {}
        data.forEach(item => { if (item.reactions) sr[item.id] = item.reactions })
        setServerReactions(sr)
        scrollToBottom()
      })
      .catch(() => {})
  }, [token, scrollToBottom])

  useEffect(() => { fetchFeedback() }, [fetchFeedback])

  useEffect(() => {
    if (!open) return
    fetchFeedback()
    const interval = setInterval(fetchFeedback, 20000)
    return () => clearInterval(interval)
  }, [open, fetchFeedback])

  const handleReaction = async (item: FeedbackItem, emoji: EmojiKey) => {
    const prev = myReactions[item.id]
    const isRemoving = prev === emoji

    // 乐观更新本地选择
    setMyReactions(cur => {
      const next = { ...cur, [item.id]: isRemoving ? null : emoji }
      saveReactions(next)
      return next
    })

    // 若切换表情，先撤销旧的
    if (prev && !isRemoving) {
      await fetch(`/api/feedback/${item.id}/react`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: prev, action: 'remove' }),
      }).catch(() => {})
    }

    const resp = await fetch(`/api/feedback/${item.id}/react`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji, action: isRemoving ? 'remove' : 'add' }),
    }).catch(() => null)

    if (resp?.ok) {
      const data = await resp.json()
      setServerReactions(cur => ({ ...cur, [item.id]: data.reactions }))
    }
  }

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
        body: JSON.stringify({ content, reply_to_id: replyTo?.id ?? null, category: activeTab }),
      })
      if (r.status === 429) { setError('服务器限流，请稍后再试'); return }
      if (!r.ok) { setError('发送失败，请重试'); return }

      const result = await r.json() as { ok: boolean; id: number; created_at: string }
      const optimisticItem: FeedbackItem = {
        id: result.id, content, recalled: false, location: null,
        is_author: false, is_mine: true, sender_name: displayName,
        category: activeTab, created_at: result.created_at, can_recall: isLoggedIn,
        reactions: {},
        reply_to: replyTo ? {
          id: replyTo.id,
          content: (replyTo.content ?? '').slice(0, 80),
          recalled: replyTo.recalled,
          is_author: replyTo.is_author,
        } : null,
      }
      setItems(prev => [...prev, optimisticItem])
      scrollToBottom()
      setText('')
      setReplyTo(null)
      setSendTimes(prev => [...prev, Date.now()])
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
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        setItems(prev => prev.map(item =>
          item.id === id ? { ...item, recalled: true, content: null, can_recall: false } : item
        ))
      } else {
        const data = await r.json().catch(() => ({}))
        setError(data.detail ?? '撤回失败')
      }
    } catch { setError('网络错误') }
    finally { setRecalling(null) }
  }

  const filteredItems = items.filter(item => {
    if (item.recalled) return activeTab === 'chat'
    if (activeTab === 'chat') return !item.category || item.category === 'chat'
    return item.category === activeTab
  })

  const limitMsg = checkRateLimit(sendTimes)
  const unreadCount = items.filter(i => !i.recalled).length
  const tabCounts: Record<Category, number> = {
    suggest: items.filter(i => !i.recalled && i.category === 'suggest').length,
    bug:     items.filter(i => !i.recalled && i.category === 'bug').length,
    chat:    items.filter(i => !i.recalled && (!i.category || i.category === 'chat')).length,
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`fixed right-6 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
          isMobileTabBar ? 'bottom-[72px]' : 'bottom-6'
        }`}
        title="用户留言板"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {unreadCount > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 留言面板 */}
      <div
        className={`fixed right-6 z-50 flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden transition-all duration-300 ease-out ${
          open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        style={{
          bottom: isMobileTabBar ? '132px' : '88px',
          width: 'min(520px, calc(100vw - 32px))',
          height: isMobileTabBar ? 'min(600px, 72vh)' : 'min(660px, 80vh)',
        }}
      >
        {/* 头部 */}
        <div className="flex-shrink-0 border-b border-gray-100">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-50 to-white">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">用户留言板</h3>
              <p className="text-xs text-gray-400 mt-0.5">公开 · 所有人可见</p>
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

          {/* Tabs */}
          <div className="flex border-t border-gray-100">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
                {tabCounts[tab.key] > 0 && (
                  <span className={`text-[10px] rounded-full px-1.5 py-0.5 tabular-nums ${
                    activeTab === tab.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}>{tabCounts[tab.key]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 留言流 */}
        <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 text-sm gap-2">
              <span className="text-2xl opacity-50">{TABS.find(t => t.key === activeTab)?.icon}</span>
              {activeTab === 'suggest' ? '还没有建议，说点什么吧 👀' :
               activeTab === 'bug' ? '没有反馈问题，继续保持 ✨' :
               '还没有留言，来说点什么吧 👋'}
            </div>
          )}

          {filteredItems.map(item => {
            const isRight = item.is_author || item.is_mine
            const reactions = serverReactions[item.id] ?? item.reactions ?? {}

            return (
              <div
                key={item.id}
                id={`msg-${item.id}`}
                className={`flex flex-col gap-1 transition-all rounded-xl ${isRight ? 'items-end' : 'items-start'}`}
              >
                {/* 回复引用块 */}
                {item.reply_to && (
                  <div
                    className={`flex items-start gap-1.5 max-w-[85%] cursor-pointer group/quote ${isRight ? 'flex-row-reverse' : ''}`}
                    onClick={() => !item.reply_to!.recalled && scrollToMessage(item.reply_to!.id)}
                  >
                    <div className={`w-0.5 self-stretch rounded-full flex-shrink-0 ${item.reply_to.recalled ? 'bg-gray-200' : 'bg-blue-300'}`} />
                    <div className="min-w-0">
                      <span className={`text-[10px] font-medium ${item.reply_to.recalled ? 'text-gray-300' : 'text-blue-400 group-hover/quote:text-blue-600'}`}>
                        ↩ 回复{item.reply_to.is_author ? ' 作者' : ''}
                      </span>
                      <p className="text-[11px] text-gray-400 truncate leading-relaxed">
                        {item.reply_to.recalled ? '原留言已撤回' : item.reply_to.content}
                      </p>
                    </div>
                  </div>
                )}

                {/* 消息气泡 */}
                <div className={`max-w-[85%] ${isRight ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  {/* 发送者标签 */}
                  <div className={`flex items-center gap-1.5 px-1 ${isRight ? 'flex-row-reverse' : ''}`}>
                    {item.is_author ? (
                      <span className="text-[10px] font-bold text-white bg-blue-500 rounded-full px-1.5 py-0.5 leading-none">作者</span>
                    ) : item.is_mine ? (
                      <span className="text-[10px] font-medium text-indigo-500">{displayName}</span>
                    ) : item.sender_name ? (
                      <span className="text-[10px] font-medium text-gray-400">{item.sender_name}</span>
                    ) : (
                      <span className="text-[10px] font-medium text-gray-300">匿名</span>
                    )}
                    <span className="text-[10px] text-gray-300">{formatRelativeTime(item.created_at)}</span>
                  </div>

                  {/* 气泡本体 */}
                  <div className={`rounded-2xl px-3.5 py-2.5 transition-colors ${
                    item.is_author
                      ? 'bg-blue-500 text-white rounded-tr-sm'
                      : item.is_mine
                      ? 'bg-indigo-100 text-indigo-900 rounded-tr-sm'
                      : item.recalled
                      ? 'bg-gray-50 border border-gray-100 opacity-40 rounded-tl-sm'
                      : 'bg-gray-100 text-gray-800 rounded-tl-sm hover:bg-gray-200/70'
                  }`}>
                    {item.recalled ? (
                      <p className="text-xs italic opacity-60">此条留言已被撤回</p>
                    ) : (
                      <p className="text-sm leading-relaxed break-words">{item.content}</p>
                    )}
                  </div>

                  {/* Emoji 反应 + 操作 */}
                  {!item.recalled && (
                    <div className={`flex items-center gap-1 px-1 flex-wrap ${isRight ? 'flex-row-reverse' : ''}`}>
                      {EMOJIS.map(emoji => {
                        const count = reactions[emoji] ?? 0
                        const selected = myReactions[item.id] === emoji
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(item, emoji)}
                            className={`flex items-center gap-0.5 text-sm px-1.5 py-0.5 rounded-full transition-all border ${
                              selected
                                ? 'bg-blue-100 border-blue-300 ring-1 ring-blue-200 scale-110'
                                : 'border-transparent hover:bg-gray-100 opacity-50 hover:opacity-100'
                            }`}
                          >
                            <span>{emoji}</span>
                            {count > 0 && <span className="text-[10px] text-gray-500 tabular-nums">{count}</span>}
                          </button>
                        )
                      })}
                      <div className={`${isRight ? 'mr-auto' : 'ml-auto'}`} />
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
                          {recalling === item.id ? '撤回中…' : '撤回'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 输入区 */}
        <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
          {/* 引用预览 */}
          {replyTo && (
            <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
              <div className="w-0.5 self-stretch bg-blue-300 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-blue-600 mb-0.5">
                  ↩ 回复{replyTo.is_author ? ' 作者' : ''}
                </p>
                <p className="text-xs text-blue-500 truncate">{replyTo.content?.slice(0, 60)}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-blue-300 hover:text-blue-500 flex-shrink-0">
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
            placeholder={
              replyTo ? `回复：${replyTo.content?.slice(0, 30)}…` :
              activeTab === 'suggest' ? '分享你的建议… (Enter 发送)' :
              activeTab === 'bug' ? '描述遇到的问题… (Enter 发送)' :
              '说点什么… (Enter 发送，Shift+Enter 换行)'
            }
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-gray-300"
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-300">{text.length}/200</span>
              {isLoggedIn && user?.email && (
                <span className="text-xs text-gray-400">as {displayName}</span>
              )}
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
    </>
  )
}
