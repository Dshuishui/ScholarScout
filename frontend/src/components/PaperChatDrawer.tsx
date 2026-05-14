import { useState, useRef, useEffect } from 'react'
import type { Paper } from '../types'
import type { ChatMessage, PdfStatus } from '../hooks/usePaperChat'

const PROMPTS_KEY = 'scholarscout_quick_prompts'
const DEFAULT_PROMPTS = [
  '这篇论文的核心贡献是什么？',
  '这篇论文的方法有哪些局限性？',
  '这篇论文适合哪些应用场景？',
]

function useQuickPrompts() {
  const [prompts, setPrompts] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(PROMPTS_KEY)
      return s ? JSON.parse(s) : DEFAULT_PROMPTS
    } catch { return DEFAULT_PROMPTS }
  })
  const update = (next: string[]) => {
    setPrompts(next)
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(next))
  }
  return {
    prompts,
    remove: (i: number) => update(prompts.filter((_, j) => j !== i)),
    add: (text: string) => { if (text.trim()) update([...prompts, text.trim()]) },
    reset: () => update(DEFAULT_PROMPTS),
  }
}

interface Props {
  paper: Paper | null
  messages: ChatMessage[]
  isStreaming: boolean
  pdfStatus: PdfStatus
  onSend: (content: string) => void
  onClose: () => void
  onUploadPdf: (file: File) => Promise<void>
  onNewChat: () => void
}

export function PaperChatDrawer({ paper, messages, isStreaming, pdfStatus, onSend, onClose, onUploadPdf, onNewChat }: Props) {
  const [input, setInput] = useState('')
  const [editingPrompts, setEditingPrompts] = useState(false)
  const [newPrompt, setNewPrompt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null)
  const [resumeCount, setResumeCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { prompts, remove, add, reset } = useQuickPrompts()
  const isOpen = paper !== null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300)
      setInput('')
      setUploadedFilename(null)
      setResumeCount(messages.filter(m => !m.isStreaming).length)
    }
  }, [isOpen, paper?.paper_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 当外部 pdfStatus 变为 ok 时（第一次）清除文件名重设
  useEffect(() => {
    if (pdfStatus !== 'ok') setUploadedFilename(null)
  }, [paper?.paper_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = () => {
    const q = input.trim()
    if (!q || isStreaming || !paper) return
    setInput('')
    onSend(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name
    e.target.value = ''
    setUploading(true)
    try {
      await onUploadPdf(file)
      setUploadedFilename(name)
    } finally {
      setUploading(false)
    }
  }

  // 自动撑高 textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />}

      <div
        className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {paper && (
          <>
            {/* ── Header ── */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-wide mb-0.5">论文分析</p>
                  <h2 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">
                    {paper.title}
                  </h2>
                  {(paper.venue || paper.published_date) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {[paper.venue, paper.published_date?.slice(0, 4)].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 恢复对话提示 */}
              {resumeCount > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                  <svg className="w-3 h-3 text-violet-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <span>已加载上次 {resumeCount} 条对话</span>
                  <span className="text-gray-200">·</span>
                  <button
                    onClick={() => { onNewChat(); setResumeCount(0) }}
                    className="text-violet-500 hover:text-violet-700 hover:underline"
                  >
                    新建会话
                  </button>
                </div>
              )}
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {/* 分析依据说明 — 始终显示在顶部 */}
              <div className={`rounded-xl px-3 py-2.5 text-xs flex items-start gap-2 ${
                pdfStatus === 'ok'
                  ? 'bg-green-50 border border-green-100 text-green-700'
                  : 'bg-blue-50 border border-blue-100 text-blue-600'
              }`}>
                {pdfStatus === 'ok' ? (
                  <>
                    <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>已上传论文全文，AI 可进行深度分析</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>当前分析基于：<strong>标题、摘要、作者、年份</strong>。点击下方 PDF 按钮上传全文可获得更深入的分析。</span>
                  </>
                )}
              </div>

              {/* 空状态 */}
              {messages.length === 0 && (
                <div className="flex flex-col items-center text-center text-gray-400 pt-4 pb-2">
                  <svg className="w-9 h-9 mb-2.5 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <p className="text-sm font-medium text-gray-500">和 AI 讨论这篇论文</p>
                  <p className="text-xs mt-1 text-gray-300">询问方法、贡献、实验、局限性等</p>

                  {/* 快捷提问 */}
                  <div className="mt-4 space-y-1.5 w-full text-left">
                    {prompts.map((q, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <button
                          onClick={() => { if (!editingPrompts) { setInput(q); textareaRef.current?.focus() } }}
                          className={`flex-1 text-left text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 transition-colors ${
                            editingPrompts ? 'cursor-default opacity-50' : 'hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200'
                          }`}
                        >
                          {q}
                        </button>
                        {editingPrompts && (
                          <button onClick={() => remove(i)} className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                    {editingPrompts && (
                      <input
                        value={newPrompt}
                        onChange={e => setNewPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { add(newPrompt); setNewPrompt('') } }}
                        placeholder="添加快捷提问… Enter 确认"
                        className="w-full text-xs border border-dashed border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-400 placeholder-gray-300"
                      />
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs">
                      <button
                        onClick={() => { setEditingPrompts(p => !p); setNewPrompt('') }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {editingPrompts ? '完成' : '编辑快捷提问'}
                      </button>
                      {editingPrompts && (
                        <button onClick={reset} className="text-gray-300 hover:text-gray-500">恢复默认</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 消息气泡 */}
              {messages.map((msg, i) => (
                <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-violet-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm1 11H9v-2h2v2zm0-4H9V7h2v2z"/>
                      </svg>
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}
                  >
                    {msg.content}
                    {msg.isStreaming && (
                      <span className="inline-block w-1 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* ── Input Area (modern chat style) ── */}
            <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-gray-100">
              <div className={`rounded-2xl border transition-all bg-white overflow-hidden ${
                isStreaming ? 'border-gray-200' : 'border-gray-300 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100'
              }`}>
                {/* PDF 已上传 chip */}
                {(pdfStatus === 'ok' || uploadedFilename) && uploadedFilename && (
                  <div className="px-3 pt-3">
                    <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-2.5 py-1 max-w-full">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="truncate max-w-[240px]">{uploadedFilename}</span>
                      <svg className="w-3 h-3 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </div>
                )}

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                  placeholder="询问这篇论文…"
                  rows={2}
                  style={{ minHeight: '56px', maxHeight: '160px' }}
                  className="w-full px-3.5 pt-3 pb-1 text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none bg-transparent disabled:opacity-50"
                />

                {/* 底部工具栏 */}
                <div className="flex items-center justify-between px-3 pb-2.5">
                  {/* PDF 上传按钮 */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || isStreaming}
                    title="上传论文 PDF 以获得更深入分析"
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-40 ${
                      pdfStatus === 'ok'
                        ? 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                  >
                    {uploading ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        上传中…
                      </>
                    ) : pdfStatus === 'ok' ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        已上传 PDF
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        上传 PDF
                      </>
                    )}
                  </button>

                  {/* 发送按钮 */}
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isStreaming}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-gray-100 disabled:text-gray-300 text-white transition-all"
                  >
                    {isStreaming ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        回复中
                      </>
                    ) : (
                      <>
                        发送
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-gray-300 text-center mt-1.5">Enter 发送 · Shift+Enter 换行</p>
            </div>

            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
          </>
        )}
      </div>
    </>
  )
}
