import { useState, useRef, useEffect } from 'react'
import type { RefObject } from 'react'
import type { Message } from '../types'
import type { HistoryItem } from '../hooks/useSearchHistory'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: Message[]
  isLoading: boolean
  onSearch: (query: string) => void
  history: HistoryItem[]
  onSearchFromHistory: (keywords: string[]) => void
  onRemoveHistory: (timestamp: number) => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

export function ChatPanel({
  messages, isLoading, onSearch,
  history, onSearchFromHistory, onRemoveHistory, inputRef,
}: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const localRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = (inputRef as RefObject<HTMLTextAreaElement>) ?? localRef

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const q = input.trim()
    if (!q || isLoading) return
    setInput('')
    onSearch(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full bg-white/80 border-r border-indigo-100/60">
      {/* Section label */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100/80">
        <div className="w-1.5 h-4 rounded-full bg-indigo-500/70" />
        <span className="text-[11px] font-semibold text-indigo-500/80 uppercase tracking-widest select-none">
          搜索对话
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 最近搜索 — 无输入、有历史时显示 */}
      {!input.trim() && history.length > 0 && (
        <div className="px-4 pt-2 pb-1 border-t border-gray-100">
          <p className="text-sm text-gray-400 mb-1.5">最近搜索</p>
          <div className="flex flex-col gap-0.5">
            {history.map(item => (
              <div
                key={item.timestamp}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => !isLoading && onSearchFromHistory(item.keywords)}
              >
                <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-gray-500 truncate flex-1 group-hover:text-gray-700 transition-colors">
                  {item.keywords.join(' · ')}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onRemoveHistory(item.timestamp) }}
                  className="text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none flex-shrink-0 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100">
        <div className={`rounded-2xl border transition-all bg-white overflow-hidden ${
          isLoading
            ? 'border-gray-100 opacity-60'
            : 'border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100'
        }`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想找的论文，AI 会自动提取关键词…"
            disabled={isLoading}
            rows={2}
            style={{ minHeight: '52px', maxHeight: '120px' }}
            className="w-full px-4 pt-3 pb-1 text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none bg-transparent leading-relaxed"
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[11px] text-gray-400">Enter 发送 · Shift+Enter 换行</span>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed rounded-xl px-3.5 py-1.5 transition-colors"
            >
              {isLoading
                ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>搜索中</>
                : <>搜索<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
