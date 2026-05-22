import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Paper } from '../types'
import type { ChatMessage, PdfStatus } from '../hooks/usePaperChat'

const PROMPTS_KEY = 'scholarscout_quick_prompts'
const DEFAULT_PROMPTS = [
  '这篇论文的核心贡献是什么？',
  '这篇论文的方法有哪些局限性？',
  '这篇论文适合哪些应用场景？',
  '和同领域其他工作相比有何优势？',
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

// 复制按钮
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
      className="p-1 rounded bg-gray-200/80 hover:bg-gray-300 text-gray-500 transition-colors"
      title="复制"
    >
      {copied
        ? <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
        : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      }
    </button>
  )
}

interface Props {
  paper: Paper | null
  messages: ChatMessage[]
  isStreaming: boolean
  pdfStatus: PdfStatus
  onSend: (content: string) => void
  onStop: () => void
  onClose: () => void
  onUploadPdf: (file: File) => Promise<boolean>
  onRemovePdf?: () => void
  onNewChat: () => void
  onRegenerate?: () => void
  isMobile?: boolean
}

export function PaperChatDrawer({ paper, messages, isStreaming, pdfStatus, onSend, onStop, onClose, onUploadPdf, onRemovePdf, onNewChat, onRegenerate, isMobile = false }: Props) {
  const [input, setInput] = useState('')
  const [editingPrompts, setEditingPrompts] = useState(false)
  const [newPrompt, setNewPrompt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const [resumeCount, setResumeCount] = useState(0)
  const [showPrompts, setShowPrompts] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const { prompts, remove, add, reset } = useQuickPrompts()
  const isOpen = paper !== null

  // 仅在用户在底部时才自动滚动
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (isNearBottom || isStreaming) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isStreaming])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300)
      setInput('')
      setUploadError(false)
      setIsDragging(false)
      dragCounter.current = 0
      setResumeCount(messages.filter(m => !m.isStreaming).length)
    }
  }, [isOpen, paper?.paper_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = () => {
    const q = input.trim()
    if (!q || isStreaming || !paper) return
    setInput('')
    onSend(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const processFile = useCallback(async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return
    setUploading(true)
    setUploadError(false)
    try {
      const ok = await onUploadPdf(file)
      if (!ok) setUploadError(true)
    } finally {
      setUploading(false)
    }
  }, [onUploadPdf])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await processFile(file)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  // Drag & Drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }, [])
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) await processFile(file)
  }, [processFile])

  // 最后一条非 streaming AI 消息的 index（用于显示重新生成按钮）
  const lastAiIdx = messages.reduce((acc, m, i) => m.role === 'assistant' && !m.isStreaming ? i : acc, -1)

  return (
    <>
      {isOpen && (
        <div
          className={`fixed inset-0 z-40 ${isMobile ? 'bg-black/50' : 'bg-black/10'}`}
          onClick={onClose}
        />
      )}

      <div
        className={`fixed bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isMobile
            ? `inset-x-0 bottom-0 h-[88vh] rounded-t-2xl ${isOpen ? 'translate-y-0' : 'translate-y-full'}`
            : `top-0 right-0 h-full w-[440px] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {paper && (
          <>
            {/* ── Mobile drag handle ── */}
            {isMobile && (
              <div className="flex-shrink-0 flex items-center justify-center pt-2.5 pb-0">
                <div className="w-9 h-1 rounded-full bg-gray-300" />
              </div>
            )}

            {/* ── Drag overlay ── */}
            {isDragging && (
              <div className="absolute inset-0 z-[60] bg-violet-600/90 flex flex-col items-center justify-center gap-3 rounded-none pointer-events-none">
                <svg className="w-14 h-14 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-white font-semibold text-lg">松开以上传 PDF</p>
                <p className="text-white/70 text-sm">支持文字版 PDF（非扫描版）</p>
              </div>
            )}

            {/* ── Header ── */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-wide mb-0.5">论文分析</p>
                  <h2 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">{paper.title}</h2>
                  {(paper.venue || paper.published_date) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {[paper.venue, paper.published_date?.slice(0, 4)].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <button onClick={onClose} className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
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
                  <button onClick={() => { onNewChat(); setResumeCount(0) }} className="text-violet-500 hover:text-violet-700 hover:underline">
                    新建会话
                  </button>
                </div>
              )}
            </div>

            {/* ── PDF 状态 banner ── */}
            <div className={`flex-shrink-0 mx-4 mt-3 mb-1 rounded-xl px-3 py-2 text-xs flex items-center gap-2 ${
              pdfStatus === 'ok'
                ? 'bg-green-50 border border-green-100 text-green-700'
                : pdfStatus === 'error'
                ? 'bg-red-50 border border-red-100 text-red-600'
                : 'bg-blue-50 border border-blue-100 text-blue-600'
            }`}>
              {pdfStatus === 'ok' ? (
                <>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">已上传全文，AI 基于完整内容分析</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-green-600 hover:text-green-800 underline underline-offset-2 whitespace-nowrap"
                  >重新上传</button>
                  {onRemovePdf && (
                    <button
                      onClick={onRemovePdf}
                      className="text-green-500 hover:text-red-500 transition-colors ml-1 flex-shrink-0"
                      title="清除 PDF，回到摘要分析模式"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </>
              ) : pdfStatus === 'error' ? (
                <>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">PDF 解析失败（扫描版或加密 PDF），基于摘要分析</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">基于<strong>摘要</strong>分析</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 hover:text-blue-800 font-medium underline underline-offset-2 whitespace-nowrap"
                  >上传 PDF 获取全文分析 →</button>
                </>
              )}
            </div>

            {/* ── Messages ── */}
            <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
              {/* 空状态 + 快捷提问 */}
              {messages.length === 0 && (
                <div className="flex flex-col items-center text-center text-gray-400 pt-4 pb-2">
                  <svg className="w-9 h-9 mb-2.5 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <p className="text-sm font-medium text-gray-500">和 AI 讨论这篇论文</p>
                  <p className="text-xs mt-1 text-gray-300 mb-4">询问方法、贡献、实验、局限性等</p>

                  <div className="w-full text-left space-y-1.5">
                    {prompts.map((q, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <button
                          onClick={() => { if (!editingPrompts) { setInput(q); textareaRef.current?.focus() } }}
                          className={`flex-1 text-left text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 transition-colors ${
                            editingPrompts ? 'cursor-default opacity-50' : 'hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200'
                          }`}
                        >{q}</button>
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
                    <div className="flex items-center gap-3 mt-1 text-xs">
                      <button onClick={() => { setEditingPrompts(p => !p); setNewPrompt('') }} className="text-gray-400 hover:text-gray-600">
                        {editingPrompts ? '完成' : '编辑快捷提问'}
                      </button>
                      {editingPrompts && <button onClick={reset} className="text-gray-300 hover:text-gray-500">恢复默认</button>}
                    </div>
                  </div>
                </div>
              )}

              {/* 消息气泡 */}
              {messages.map((msg, i) => (
                <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 self-start mt-1">
                      <svg className="w-3.5 h-3.5 text-violet-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm1 11H9v-2h2v2zm0-4H9V7h2v2z"/>
                      </svg>
                    </div>
                  )}
                  <div className={`relative max-w-[82%] ${msg.role === 'user' ? '' : 'flex flex-col gap-1'}`}>
                    {msg.role === 'user' ? (
                      <div className="rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed bg-violet-600 text-white whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm leading-relaxed bg-gray-100 text-gray-800 prose prose-sm max-w-none prose-p:my-1 prose-headings:my-1.5 prose-pre:my-1.5 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                          {msg.isStreaming && (
                            <span className="inline-block w-1 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
                          )}
                        </div>
                        {/* AI 消息操作栏（常驻，最后一条才显示重新生成） */}
                        {!msg.isStreaming && msg.content && (
                          <div className="flex items-center gap-1.5 px-1">
                            <CopyButton text={msg.content} />
                            {i === lastAiIdx && onRegenerate && !isStreaming && (
                              <button
                                onClick={onRegenerate}
                                title="重新生成"
                                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-violet-600 px-1.5 py-1 rounded bg-gray-100 hover:bg-violet-50 transition-colors"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                重新生成
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* ── 快捷提问栏（有消息时显示，可收起）── */}
            {messages.length > 0 && (
              <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50/50">
                <button
                  onClick={() => setShowPrompts(p => !p)}
                  className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    快捷提问
                  </span>
                  <svg className={`w-3.5 h-3.5 transition-transform ${showPrompts ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPrompts && (
                  <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                    {prompts.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => { setInput(q); textareaRef.current?.focus(); setShowPrompts(false) }}
                        disabled={isStreaming}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 disabled:opacity-40 transition-all"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Input Area ── */}
            <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-gray-100">
              <div className={`rounded-2xl border transition-all bg-white overflow-hidden ${
                isStreaming ? 'border-gray-200' : 'border-gray-300 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100'
              }`}>
                {/* PDF 状态 chip */}
                {pdfStatus === 'ok' && (
                  <div className="px-3 pt-3">
                    <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-2.5 py-1">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      PDF 全文已加载
                      <svg className="w-3 h-3 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </div>
                )}
                {uploadError && pdfStatus === 'error' && (
                  <div className="px-3 pt-3">
                    <span className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-2.5 py-1">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      PDF 解析失败，请尝试其他文件
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
                    title="上传论文 PDF，或直接拖拽 PDF 到对话框"
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-40 ${
                      pdfStatus === 'ok'
                        ? 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
                        : pdfStatus === 'error'
                        ? 'bg-red-50 border-red-200 text-red-500 hover:bg-red-100'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                  >
                    {uploading ? (
                      <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>解析中…</>
                    ) : pdfStatus === 'ok' ? (
                      <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>重新上传 PDF</>
                    ) : (
                      <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>上传 PDF</>
                    )}
                  </button>

                  {/* 停止 / 发送 */}
                  {isStreaming ? (
                    <button
                      onClick={onStop}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="2"/>
                      </svg>
                      停止
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-gray-100 disabled:text-gray-300 text-white transition-all"
                    >
                      发送
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-300 text-center mt-1.5">Enter 发送 · Shift+Enter 换行 · 拖拽 PDF 到此处上传</p>
            </div>

            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
          </>
        )}
      </div>
    </>
  )
}
