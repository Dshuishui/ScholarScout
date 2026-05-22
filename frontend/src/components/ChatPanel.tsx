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

const EXAMPLE_GROUPS = [
  {
    label: 'AI / 机器学习',
    color: 'indigo',
    examples: [
      '找 2023 年后关于大模型幻觉问题的论文',
      'RAG 检索增强生成最新进展综述',
      'Transformer 在视觉任务的优化方法',
    ],
  },
  {
    label: '生命科学',
    color: 'emerald',
    examples: [
      'AlphaFold 蛋白质结构预测的最新改进',
      '单细胞 RNA 测序数据分析方法',
      'CRISPR 基因编辑精准性提升研究',
    ],
  },
  {
    label: '其他方向',
    color: 'amber',
    examples: [
      '图神经网络用于药物分子设计',
      '联邦学习隐私保护最新方案',
      '量子计算在密码学中的应用',
    ],
  },
]

export function ChatPanel({
  messages, isLoading, onSearch,
  history, onSearchFromHistory, onRemoveHistory, inputRef,
}: Props) {
  const [input, setInput] = useState('')
  const [activeGroup, setActiveGroup] = useState(0)
  const [historyCollapsed, setHistoryCollapsed] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const localRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = (inputRef as RefObject<HTMLTextAreaElement>) ?? localRef

  // 是否是初始状态（只有 welcome 消息）
  const isInitial = messages.length <= 1 && messages[0]?.id === '0'

  // 历史折叠：找最后一条 user 消息的索引
  const lastUserIdx = messages.reduce((best, m, i) => m.role === 'user' ? i : best, -1)
  const hasCollapsibleHistory = lastUserIdx > 1 // 有历史（index 1 之前还有消息）
  const hiddenCount = hasCollapsibleHistory ? lastUserIdx - 1 : 0
  const visibleMessages = (historyCollapsed && hasCollapsibleHistory)
    ? messages.slice(lastUserIdx)
    : messages

  // 每次新搜索（新增 user 消息）自动重置为折叠
  const userMsgCount = messages.filter(m => m.role === 'user').length
  const prevCountRef = useRef(userMsgCount)
  useEffect(() => {
    if (userMsgCount > prevCountRef.current) {
      setHistoryCollapsed(true)
      prevCountRef.current = userMsgCount
    }
  }, [userMsgCount])

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

  const group = EXAMPLE_GROUPS[activeGroup]
  const colorMap: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
    amber: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100',
  }
  const tabActive: Record<string, string> = {
    indigo: 'bg-indigo-600 text-white',
    emerald: 'bg-emerald-600 text-white',
    amber: 'bg-amber-500 text-white',
  }

  return (
    <div className="flex flex-col h-full bg-white/80 md:border-r border-indigo-100/60">
      {/* Section label */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100/80">
        <div className="w-1.5 h-4 rounded-full bg-indigo-500/70" />
        <span className="text-[11px] font-semibold text-indigo-500/80 uppercase tracking-widest select-none">
          搜索对话
        </span>
      </div>

      {/* 初始状态：分领域示例引导 */}
      {isInitial && !isLoading ? (
        <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">
          {/* 欢迎文案 */}
          <div className="text-center pt-2">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">用自然语言搜索学术论文</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              AI 自动提取关键词，同时搜索 10 个学术数据库
            </p>
          </div>

          {/* 分类 Tab */}
          <div>
            <div className="flex gap-1.5 mb-3">
              {EXAMPLE_GROUPS.map((g, i) => (
                <button
                  key={g.label}
                  onClick={() => setActiveGroup(i)}
                  className={`text-[11px] font-semibold rounded-full px-2.5 py-1 transition-all ${
                    activeGroup === i
                      ? tabActive[g.color]
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {group.examples.map(ex => (
                <button
                  key={ex}
                  onClick={() => { if (!isLoading) onSearch(ex) }}
                  disabled={isLoading}
                  className={`text-xs text-left px-3 py-2.5 rounded-xl border transition-all disabled:opacity-40 ${colorMap[group.color]}`}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* 最近搜索 */}
          {history.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">最近搜索</p>
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
                    <span className="text-xs text-gray-500 truncate flex-1 group-hover:text-gray-700 transition-colors">
                      {item.keywords.join(' · ')}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); onRemoveHistory(item.timestamp) }}
                      className="text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none flex-shrink-0 px-1"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* 历史折叠开关 */}
            {hasCollapsibleHistory && (
              <button
                onClick={() => setHistoryCollapsed(c => !c)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-indigo-500 py-1.5 rounded-lg hover:bg-gray-50 border border-dashed border-gray-200 transition-colors"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${historyCollapsed ? '' : 'rotate-180'}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {historyCollapsed
                  ? `显示 ${hiddenCount} 条早期对话`
                  : '折叠早期对话'}
              </button>
            )}

            {visibleMessages.map(msg => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* 历史搜索（有搜索记录时，无输入时显示）*/}
          {!input.trim() && history.length > 0 && (
            <div className="px-4 pt-2 pb-1 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1.5">最近搜索</p>
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
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
