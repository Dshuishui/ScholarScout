import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Paper } from '../types'

type Mode = 'compare' | 'review' | 'trend'

const MODES: { key: Mode; label: string; desc: string; icon: string }[] = [
  { key: 'compare', label: '对比分析', desc: '方法、贡献、局限性横向对比', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { key: 'review',  label: '文献综述', desc: '生成综述段落，可直接引用',  icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'trend',   label: '研究趋势', desc: '时间线演进与未来方向预测',  icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
]

function buildMessages(papers: Paper[], mode: Mode) {
  const paperCtx = papers.map((p, i) => {
    const parts = [
      `【论文 ${i + 1}】`,
      `标题：${p.title}`,
    ]
    if (p.authors.length > 0) parts.push(`作者：${p.authors.slice(0, 3).join('、')}${p.authors.length > 3 ? ' 等' : ''}`)
    if (p.published_date) parts.push(`年份：${p.published_date.slice(0, 4)}`)
    if (p.venue) parts.push(`来源：${p.venue}`)
    if (p.abstract) parts.push(`摘要：${p.abstract.slice(0, 500)}`)
    if (p.relevance_reason) parts.push(`AI摘要：${p.relevance_reason}`)
    return parts.join('\n')
  }).join('\n\n')

  const systemPrompts: Record<Mode, string> = {
    compare: `你是学术研究助手。请对以下 ${papers.length} 篇论文进行系统性对比分析，必须包含以下部分：\n1. **总览表格**（论文名、年份、核心方法、主要贡献）\n2. **方法与技术路线对比**\n3. **创新点与贡献对比**\n4. **实验设置与结果对比**（如有）\n5. **优缺点与局限性**\n6. **相互关系与传承**\n\n请用中文，Markdown 格式，结构清晰，包含表格。`,
    review:  `你是学术写作助手。请基于以下 ${papers.length} 篇论文撰写一段专业的文献综述，需涵盖：研究背景与问题、各论文的核心贡献及相互关联、领域现状总结。写作风格：学术正式，第三人称，可直接用于论文 Related Work 章节。请用中文，Markdown 格式，600-900 字。`,
    trend:   `你是学术研究助手。请分析以下论文所属领域的研究趋势，需包含：\n1. **技术演进路线**（按时间梳理关键突破）\n2. **研究热点变化**\n3. **各论文的里程碑意义**\n4. **未来研究方向预测**\n\n请用中文，Markdown 格式，结合论文时间线分析。`,
  }

  return [
    { role: 'system', content: systemPrompts[mode] },
    { role: 'user', content: `以下是选中的论文：\n\n${paperCtx}\n\n请开始分析。` },
  ]
}

interface Props {
  papers: Paper[]
  apiKey: string
  onClose: () => void
}

export function ComparePanel({ papers, apiKey, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('compare')
  const [content, setContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 自动滚动
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming])

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const generate = useCallback(async () => {
    if (!apiKey) return
    setContent('')
    setIsStreaming(true)
    setHasGenerated(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          stream: true,
          messages: buildMessages(papers, mode),
        }),
      })

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? ''
            accumulated += delta
            setContent(accumulated)
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setContent(prev => prev + `\n\n> ⚠️ 生成失败：${(err as Error).message}`)
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }, [apiKey, papers, mode])

  const stop = () => { abortRef.current?.abort() }

  const copy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
           style={{ background: '#fff' }}>

        {/* ── Header ── */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-3"
          style={{
            background: '#080818',
            backgroundImage: 'linear-gradient(rgba(99,102,241,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.08) 1px,transparent 1px)',
            backgroundSize: '48px 48px',
            borderBottom: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                 style={{ background: 'linear-gradient(135deg,rgba(139,92,246,0.9),rgba(99,102,241,0.9))', boxShadow: '0 0 10px rgba(139,92,246,0.4)' }}>
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white tracking-tight">AI 多论文分析</span>
            <span className="text-xs text-indigo-300/60 ml-1">已选 {papers.length} 篇</span>
          </div>
          <button onClick={onClose} className="text-indigo-300/60 hover:text-indigo-200 p-1 rounded hover:bg-white/5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Selected papers chips ── */}
        <div className="flex-shrink-0 px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          {papers.map((p, i) => (
            <span key={p.paper_id} className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-gray-600 max-w-[200px]">
              <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-600 font-bold text-[10px] flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <span className="truncate">{p.title.slice(0, 40)}{p.title.length > 40 ? '…' : ''}</span>
              {p.published_date && <span className="text-gray-300 flex-shrink-0">{p.published_date.slice(0, 4)}</span>}
            </span>
          ))}
        </div>

        {/* ── Mode selector ── */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3 flex gap-3">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setContent(''); setHasGenerated(false) }}
              disabled={isStreaming}
              className={`flex-1 flex items-center gap-2.5 px-3.5 py-3 rounded-xl border-2 text-left transition-all ${
                mode === m.key
                  ? 'border-violet-500 bg-violet-50'
                  : 'border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-white'
              } disabled:opacity-50`}
            >
              <svg className={`w-4 h-4 flex-shrink-0 ${mode === m.key ? 'text-violet-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={m.icon} />
              </svg>
              <div>
                <div className={`text-xs font-semibold ${mode === m.key ? 'text-violet-700' : 'text-gray-600'}`}>{m.label}</div>
                <div className={`text-[10px] leading-tight ${mode === m.key ? 'text-violet-500' : 'text-gray-400'}`}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* ── Content area ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-4 min-h-0">
          {!hasGenerated ? (
            <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-violet-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">选择分析模式，点击「生成」开始</p>
                <p className="text-xs text-gray-400 mt-1">
                  AI 将基于 {papers.length} 篇论文的标题、摘要和元数据进行分析
                </p>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-headings:font-semibold prose-p:text-gray-700 prose-p:leading-relaxed prose-li:text-gray-700 prose-strong:text-gray-800 prose-table:text-sm prose-th:bg-gray-50 prose-th:text-gray-600 prose-td:text-gray-600 pt-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-violet-400 ml-0.5 animate-pulse rounded-sm" />
              )}
            </div>
          )}
        </div>

        {/* ── Action bar ── */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {isStreaming ? '生成中…' : hasGenerated && content ? `${content.length} 字符` : ''}
          </div>
          <div className="flex items-center gap-2">
            {content && !isStreaming && (
              <>
                <button
                  onClick={copy}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-3 py-1.5 transition-all"
                >
                  {copied
                    ? <><svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>已复制</>
                    : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>复制结果</>
                  }
                </button>
                <button
                  onClick={generate}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-3 py-1.5 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重新生成
                </button>
              </>
            )}
            {isStreaming ? (
              <button
                onClick={stop}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl px-4 py-2 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
                停止
              </button>
            ) : (
              <button
                onClick={generate}
                disabled={!apiKey}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-xl px-4 py-2 transition-all shadow-sm hover:shadow-violet-200/60 shadow-md"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {hasGenerated ? '重新生成' : '生成'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
