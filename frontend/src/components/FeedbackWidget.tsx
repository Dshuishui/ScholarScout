import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'

const NICKNAME_KEY = 'ss_feedback_nickname'
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
}

interface FeedbackItem {
  id: number
  content: string | null
  recalled: boolean
  location: string | null
  is_author: boolean
  category: Category
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
  const { token, isLoggedIn } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sendTimes, setSendTimes] = useState<number[]>([])
  const [replyTo, setReplyTo] = useState<FeedbackItem | null>(null)
  const [recalling, setRecalling] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<Category>('chat')
  const [reactions, setReactions] = useState<Record<number, EmojiKey | null>>(() => loadReactions())
  const [nickname, setNickname] = useState<string>(() => localStorage.getItem(NICKNAME_KEY) ?? '')
  const [showNicknameInput, setShowNicknameInput] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nicknameRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
    }, 60)
  }, [])

  const fetchFeedback = useCallback(() => {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/feedback', { headers })
      .then(r => r.json())
      .then((data: FeedbackItem[]) => { setItems(data); scrollToBottom() })
      .catch(() => {})
  }, [token, scrollToBottom])

  useEffect(() => { fetchFeedback() }, [fetchFeedback])

  useEffect(() => {
    if (!open) return
    fetchFeedback()
    const interval = setInterval(fetchFeedback, 20000)
    return () => clearInterval(interval)
  }, [open, fetchFeedback])

  const handleReaction = (id: number, emoji: EmojiKey) => {
    setReactions(prev => {
      const next = { ...prev, [id]: prev[id] === emoji ? null : emoji }
      saveReactions(next)
      return next
    })
  }

  const handleSubmit = async () => {
    const content = text.trim()
    if (!content || submitting) return

    // 若昵称未设置，先弹出昵称输入
    if (!nickname && !showNicknameInput) {
      setShowNicknameInput(true)
      setTimeout(() => nicknameRef.current?.focus(), 100)
      return
    }

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
        id: result.id, content, recalled: false, location: null, is_author: false,
        category: activeTab, created_at: result.created_at, can_recall: isLoggedIn,
        reply_to: replyTo ? { id: replyTo.id, content: (replyTo.content ?? '').slice(0, 80), recalled: replyTo.recalled } : null,
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

  // 按 category 字段过滤；聊天 tab 兜底显示未分类（旧数据无 category）
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
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* 留言面板（底部向上滑入）*/}
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

          {/* 3 Tabs */}
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
        <div ref={feedRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 text-sm gap-2">
              <span className="text-2xl opacity-50">{TABS.find(t => t.key === activeTab)?.icon}</span>
              {activeTab === 'suggest' ? '还没有建议，说点什么吧 👀' :
               activeTab === 'bug' ? '没有反馈问题，继续保持 ✨' :
               '还没有留言，来说点什么吧 👋'}
            </div>
          )}

          {filteredItems.map(item => (
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
                  ? 'bg-gray-50 border border-gray-100 opacity-40'
                  : 'bg-gray-50 border border-gray-100 hover:bg-white hover:border-gray-200'
              }`}>
                {/* 元信息行 */}
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {item.is_author ? (
                    <span className="text-[10px] font-bold text-white bg-blue-500 rounded-full px-1.5 py-0.5 leading-none">作者</span>
                  ) : (
                    <span className="text-[10px] font-medium text-gray-400">用户</span>
                  )}
                  <span className="text-[10px] text-gray-300">·</span>
                  <span className="text-[10px] text-gray-400">{formatRelativeTime(item.created_at)}</span>
                  {/* location 不再显示 */}
                </div>

                {/* 内容 */}
                {item.recalled ? (
                  <p className="text-xs text-gray-300 italic">此条留言已被撤回</p>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed break-words">{item.content}</p>
                )}

                {/* Emoji 反应 + 操作按钮 */}
                {!item.recalled && (
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {/* Emoji 反应 */}
                    {EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(item.id, emoji)}
                        className={`text-sm px-1.5 py-0.5 rounded-lg transition-all ${
                          reactions[item.id] === emoji
                            ? 'bg-blue-100 ring-1 ring-blue-300 scale-110'
                            : 'hover:bg-gray-100 opacity-50 hover:opacity-100'
                        }`}
                        title={`${emoji} 反应`}
                      >
                        {emoji}
                      </button>
                    ))}
                    <div className="flex-1" />
                    {/* 回复 */}
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
          ))}
        </div>

        {/* 输入区 */}
        <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
          {/* 昵称设置（首次发言时） */}
          {showNicknameInput && (
            <div className="mb-2 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
              <span className="text-xs text-blue-600 whitespace-nowrap">昵称：</span>
              <input
                ref={nicknameRef}
                value={nickname}
                onChange={e => setNickname(e.target.value.slice(0, 20))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    localStorage.setItem(NICKNAME_KEY, nickname || '访客')
                    setNickname(nickname || '访客')
                    setShowNicknameInput(false)
                  }
                  if (e.key === 'Escape') setShowNicknameInput(false)
                }}
                placeholder="起个昵称（可跳过）"
                className="flex-1 text-xs bg-transparent focus:outline-none text-blue-700 placeholder-blue-300"
              />
              <button
                onClick={() => {
                  const name = nickname.trim() || '访客'
                  localStorage.setItem(NICKNAME_KEY, name)
                  setNickname(name)
                  setShowNicknameInput(false)
                  // 继续提交
                  setTimeout(handleSubmit, 50)
                }}
                className="text-xs text-blue-600 font-semibold hover:text-blue-800"
              >确认发送</button>
            </div>
          )}

          {/* 引用预览 */}
          {replyTo && (
            <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
              <div className="w-0.5 self-stretch bg-blue-300 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-blue-600 mb-0.5">回复</p>
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
              {/* 昵称显示 */}
              {nickname && (
                <button
                  onClick={() => setShowNicknameInput(true)}
                  className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
                  title="点击修改昵称"
                >
                  as {nickname}
                </button>
              )}
              {!nickname && !showNicknameInput && (
                <button
                  onClick={() => { setShowNicknameInput(true); setTimeout(() => nicknameRef.current?.focus(), 100) }}
                  className="text-xs text-gray-300 hover:text-blue-400 transition-colors"
                >
                  + 设置昵称
                </button>
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
