import { useState, useRef, useEffect } from 'react'
import type { Message } from '../types'
import type { HistoryItem } from '../hooks/useSearchHistory'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: Message[]
  isLoading: boolean
  onSearch: (query: string) => void
  onClearKey: () => void
  pendingKeywords: string[] | null
  onConfirmKeywords: (keywords: string[]) => void
  onCancelSearch: () => void
  history: HistoryItem[]
  onSearchFromHistory: (keywords: string[]) => void
  onRemoveHistory: (timestamp: number) => void
}

export function ChatPanel({
  messages, isLoading, onSearch, onClearKey,
  pendingKeywords, onConfirmKeywords, onCancelSearch,
  history, onSearchFromHistory, onRemoveHistory,
}: Props) {
  const [input, setInput] = useState('')
  const [editKeywords, setEditKeywords] = useState<string[]>([])
  const [newKw, setNewKw] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const newKwRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingKeywords])

  // Sync local edit state when pendingKeywords arrives
  useEffect(() => {
    if (pendingKeywords) {
      setEditKeywords([...pendingKeywords])
      setNewKw('')
    }
  }, [pendingKeywords])

  const handleSend = () => {
    const q = input.trim()
    if (!q || isLoading || pendingKeywords) return
    setInput('')
    onSearch(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const removeKeyword = (index: number) => {
    setEditKeywords(prev => prev.filter((_, i) => i !== index))
  }

  const addKeyword = () => {
    const kw = newKw.trim()
    if (!kw || editKeywords.includes(kw)) return
    setEditKeywords(prev => [...prev, kw])
    setNewKw('')
    newKwRef.current?.focus()
  }

  const handleNewKwKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addKeyword()
    }
  }

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-none mb-0.5">ScholarScout</h1>
            <p className="text-sm text-gray-400 leading-none">AI 学术论文搜索</p>
          </div>
        </div>
        <button
          onClick={onClearKey}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-gray-100"
        >
          更换 Key
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Keyword editor — shown when pendingKeywords is set */}
      {pendingKeywords && (
        <div className="px-4 pb-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2.5">
            <p className="text-sm font-semibold text-blue-700">确认关键词后开始搜索</p>

            {/* Tag list */}
            <div className="flex flex-wrap gap-1.5">
              {editKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 bg-white border border-blue-300 text-blue-700 text-xs rounded-full px-2.5 py-1 font-medium"
                >
                  {kw}
                  <button
                    onClick={() => removeKeyword(i)}
                    className="text-blue-300 hover:text-blue-600 transition-colors leading-none"
                  >
                    ✕
                  </button>
                </span>
              ))}

              {/* Inline add input */}
              <input
                ref={newKwRef}
                value={newKw}
                onChange={e => setNewKw(e.target.value)}
                onKeyDown={handleNewKwKeyDown}
                onBlur={addKeyword}
                placeholder="+ 添加关键词"
                className="text-xs border border-dashed border-blue-300 rounded-full px-2.5 py-1 outline-none focus:border-blue-500 bg-transparent text-blue-700 placeholder-blue-300 min-w-24 w-28"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-blue-400">回车添加，点 ✕ 删除关键词</p>
              <div className="flex gap-2">
                <button
                  onClick={onCancelSearch}
                  className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => onConfirmKeywords(editKeywords)}
                  disabled={editKeywords.length === 0}
                  className="text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg font-medium transition-colors"
                >
                  开始搜索 →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 最近搜索 — 无输入、无 pending、有历史时显示 */}
      {!pendingKeywords && !input.trim() && history.length > 0 && (
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
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingKeywords ? '请先确认或取消关键词' : '描述您想找的论文，Enter 发送，Shift+Enter 换行'}
            disabled={isLoading || !!pendingKeywords}
            rows={2}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 disabled:text-gray-400 leading-relaxed"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !!pendingKeywords}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap self-end"
          >
            {isLoading ? '搜索中' : '搜索'}
          </button>
        </div>
        <p className="text-xs text-gray-300 mt-1.5 text-right">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  )
}
