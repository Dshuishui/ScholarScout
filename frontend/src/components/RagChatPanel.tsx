import { useState, useRef } from 'react'
import type { Paper } from '../types'

interface Props {
  papers: Paper[]
  apiKey: string
  model: string
  onClose: () => void
}

export function RagChatPanel({ papers, apiKey, model, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const ask = async () => {
    if (!question.trim() || loading) return
    setAnswer('')
    setLoading(true)
    abortRef.current = new AbortController()

    try {
      const body = {
        question: question.trim(),
        papers: papers.map(p => ({
          paper_id: p.paper_id,
          title: p.title,
          abstract: p.abstract ?? null,
          authors: p.authors,
          published_date: p.published_date ?? null,
          source: p.source,
        })),
        api_key: apiKey,
        model,
      }

      const r = await fetch('/api/semantic/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      if (!r.ok) {
        setAnswer('请求失败，请检查 API Key 是否有效。')
        return
      }

      const reader = r.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        setAnswer(buf)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setAnswer('网络错误，请重试。')
      }
    } finally {
      setLoading(false)
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 顶栏 */}
      <div
        className="h-11 flex-shrink-0 flex items-center px-4 gap-3"
        style={{
          background: '#080818',
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.07) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          borderBottom: '1px solid rgba(99,102,241,0.18)',
        }}
      >
        <button
          onClick={onClose}
          className="text-indigo-300/80 hover:text-white transition-colors p-1 rounded hover:bg-white/5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-bold text-white">多文献问答</span>
        <span className="text-xs text-indigo-300/50 ml-auto">{papers.length} 篇文献</span>
      </div>

      {/* 文献列表 */}
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
        <p className="text-xs text-gray-500 mb-1.5">基于以下论文回答问题：</p>
        <div className="flex flex-wrap gap-1">
          {papers.map((p, i) => (
            <span
              key={p.paper_id}
              className="inline-flex items-center gap-1 text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5"
              title={p.title}
            >
              <span className="font-bold">[{i + 1}]</span>
              <span className="max-w-[140px] truncate">{p.title}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 回答区 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!answer && !loading && (
          <div className="text-center mt-8">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">输入问题，AI 将基于上方论文的摘要回答</p>
            <p className="text-xs text-gray-300 mt-1">支持比较、总结、方法论等问题</p>
          </div>
        )}
        {(answer || loading) && (
          <div className="prose prose-sm max-w-none">
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {answer}
              {loading && <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />}
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="px-4 pb-4 pt-2 border-t border-gray-100">
        <div className="flex gap-2">
          <textarea
            className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            rows={2}
            placeholder="问一个关于这些论文的问题…"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask()
              }
            }}
          />
          {loading ? (
            <button
              onClick={stop}
              className="flex-shrink-0 px-4 py-2 text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-xl transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              onClick={ask}
              disabled={!question.trim()}
              className="flex-shrink-0 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-xl transition-colors"
            >
              提问
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">AI 依据摘要回答，可能存在局限性 · Enter 发送，Shift+Enter 换行</p>
      </div>
    </div>
  )
}
