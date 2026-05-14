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
}

export function PaperChatDrawer({ paper, messages, isStreaming, pdfStatus, onSend, onClose, onUploadPdf }: Props) {
  const [input, setInput] = useState('')
  const [editingPrompts, setEditingPrompts] = useState(false)
  const [newPrompt, setNewPrompt] = useState('')
  const [uploading, setUploading] = useState(false)
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
    }
  }, [isOpen, paper?.paper_id])

  const handleSend = () => {
    const q = input.trim()
    if (!q || isStreaming || !paper) return
    setInput('')
    onSend(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      await onUploadPdf(file)
    } finally {
      setUploading(false)
    }
  }

  const gsUrl = paper
    ? `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`
    : '#'

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {paper && (
          <>
            {/* Header */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-blue-600 font-medium mb-0.5">论文分析</p>
                  <h2 className="text-base font-semibold text-gray-900 line-clamp-2 leading-snug">
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
                  className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* PDF 状态栏 */}
              <div className="mt-2">
                {pdfStatus === 'loading' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-500">
                    <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    <span>正在读取论文 PDF，请稍等…</span>
                  </div>
                )}
                {pdfStatus === 'ok' && (
                  <div className="flex items-center gap-1.5 text-xs text-green-600">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>已读取论文全文，AI 可深度分析</span>
                  </div>
                )}
                {pdfStatus === 'failed' && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>暂时无法获取 PDF，分析基于摘要</span>
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 pb-4">
                  <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <p className="text-base font-medium">和 AI 讨论这篇论文</p>
                  <p className="text-sm mt-1 text-gray-300">可以询问方法、贡献、局限性等</p>

                  {/* PDF 失败时的提示 */}
                  {pdfStatus === 'failed' && (
                    <div className="mt-4 w-full rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-left">
                      <p className="text-xs font-medium text-amber-700 mb-1">暂时无法自动获取 PDF</p>
                      <p className="text-xs text-amber-600 leading-relaxed">
                        AI 将基于摘要进行分析，深度有限。如需全文分析，可以：
                      </p>
                      <div className="flex flex-col gap-1.5 mt-2">
                        <a
                          href={gsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          前往谷歌学术下载论文 PDF
                        </a>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          {uploading ? '上传中…' : '上传 PDF 文件让 AI 读全文'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quick prompts */}
                  <div className="mt-4 space-y-1.5 w-full text-left">
                    {prompts.map((q, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <button
                          onClick={() => { if (!editingPrompts) { setInput(q); textareaRef.current?.focus() } }}
                          className={`flex-1 text-left text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 transition-colors ${
                            editingPrompts ? 'cursor-default opacity-60' : 'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'
                          }`}
                        >
                          {q}
                        </button>
                        {editingPrompts && (
                          <button
                            onClick={() => remove(i)}
                            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-400 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}

                    {editingPrompts && (
                      <div className="flex gap-1 mt-1">
                        <input
                          value={newPrompt}
                          onChange={e => setNewPrompt(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { add(newPrompt); setNewPrompt('') } }}
                          placeholder="输入新提问… Enter 添加"
                          className="flex-1 text-xs border border-dashed border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-transparent text-gray-600 placeholder-gray-300"
                        />
                      </div>
                    )}
                  </div>

                  {/* Edit controls */}
                  <div className="flex items-center gap-3 mt-3 text-xs">
                    <button
                      onClick={() => { setEditingPrompts(p => !p); setNewPrompt('') }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {editingPrompts ? '完成' : '编辑快捷提问'}
                    </button>
                    {editingPrompts && (
                      <button onClick={reset} className="text-gray-300 hover:text-gray-500 transition-colors">
                        恢复默认
                      </button>
                    )}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">
                      <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm1 11H9v-2h2v2zm0-4H9V7h2v2z"/>
                      </svg>
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    }`}
                  >
                    {msg.content}
                    {msg.isStreaming && (
                      <span className="inline-block w-1 h-3.5 bg-gray-500 ml-0.5 animate-pulse rounded-sm" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="flex-shrink-0 border-t border-gray-200 px-3 py-3">
              <div className="flex gap-2 items-end">
                {/* 上传 PDF 按钮（始终显示，失败时高亮） */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || pdfStatus === 'loading'}
                  title={pdfStatus === 'ok' ? '重新上传 PDF' : '上传 PDF 让 AI 读全文'}
                  className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    pdfStatus === 'ok'
                      ? 'text-green-500 bg-green-50 hover:bg-green-100'
                      : pdfStatus === 'failed'
                      ? 'text-amber-500 bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-200'
                      : 'text-gray-400 bg-gray-50 hover:bg-gray-100'
                  } disabled:opacity-40`}
                >
                  {uploading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  )}
                </button>

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="询问这篇论文… (Enter 发送)"
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center transition-colors text-white"
                >
                  {isStreaming ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* 隐藏文件输入 */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        )}
      </div>
    </>
  )
}
