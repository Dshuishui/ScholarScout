import { useState } from 'react'
import type { Paper } from '../types'
import { getDownloadUrl } from '../api/client'
import { toast } from './Toast'
import { useAuth } from '../hooks/useAuth'

const SOURCE_STYLES: Record<string, { bar: string; badge: string }> = {
  'arXiv':            { bar: 'bg-green-500',   badge: 'bg-green-50 text-green-700 border-green-200' },
  'Semantic Scholar': { bar: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  'OpenAlex':         { bar: 'bg-violet-500',  badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  'PubMed':           { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'Europe PMC':       { bar: 'bg-teal-500',    badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  'INSPIRE-HEP':      { bar: 'bg-red-400',     badge: 'bg-red-50 text-red-700 border-red-200' },
  'CrossRef':         { bar: 'bg-indigo-500',  badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  'CORE':             { bar: 'bg-cyan-500',    badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'NASA ADS':         { bar: 'bg-sky-500',     badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  'Google Scholar':   { bar: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
}
const DEFAULT_STYLE = { bar: 'bg-gray-300', badge: 'bg-gray-50 text-gray-600 border-gray-200' }

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  'arXiv':            'arXiv — 物理/CS/数学预印本，全文免费',
  'Semantic Scholar': 'Semantic Scholar — 2亿+ 论文，AI 语义搜索',
  'OpenAlex':         'OpenAlex — 2.5亿+ 开放元数据，综合学科',
  'PubMed':           'PubMed — 医学与生命科学权威数据库',
  'Europe PMC':       'Europe PMC — 生命科学 + bioRxiv/medRxiv',
  'INSPIRE-HEP':      'INSPIRE-HEP — 高能物理专业数据库',
  'CrossRef':         'CrossRef — 1.5亿+ DOI 注册，综合学科',
  'CORE':             'CORE — 1.7亿+ 开放获取全文',
  'NASA ADS':         'NASA ADS — 天文学与天体物理专业库',
  'Google Scholar':   'Google Scholar — 综合搜索，含灰色文献',
}

interface Props {
  paper: Paper
  selected?: boolean
  onToggle?: () => void
  isRejected?: boolean
  onAnalyze?: () => void
  compact?: boolean
  isSaved?: boolean
  onSave?: () => void
  hasChat?: boolean
}

export function PaperCard({ paper, selected = false, onToggle, isRejected = false, onAnalyze, compact = false, isSaved = false, onSave, hasChat = false }: Props) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { isLoggedIn } = useAuth()
  const showAbstract = !compact || expanded
  const hasExpandable = compact && (!!paper.abstract || !!paper.relevance_reason)
  const year = paper.published_date?.slice(0, 4) ?? '—'

  const copyTitle = () => {
    navigator.clipboard.writeText(paper.title).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.show('论文题目已复制到剪贴板，快去学习吧 📚')
    })
  }

  const authorStr = paper.authors.length === 0
    ? '作者未知'
    : paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ` 等 ${paper.authors.length} 人` : '')
  const style = SOURCE_STYLES[paper.source] ?? DEFAULT_STYLE

  const links = paper.source_links && paper.source_links.length > 0
    ? paper.source_links
    : paper.url ? [{ source: paper.source, url: paper.url }] : []

  const scholarUrl =
    paper.source_links?.find(l => l.source === 'Google Scholar')?.url
    ?? `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${paper.title}"`)}`

  const sourceLinks = links.filter(l => l.source !== 'Google Scholar')

  // P1: Quality badges
  const isHighlyCited = paper.citations >= 1000
  const hasOpenAccess = !!paper.pdf_url

  return (
    <div className={`relative bg-white border rounded-xl overflow-hidden transition-all duration-200 ${
      selected
        ? 'border-blue-400 shadow-md ring-1 ring-blue-100 -translate-y-0.5'
        : isRejected
        ? 'border-gray-200 opacity-60 hover:opacity-80'
        : 'border-gray-200 hover:border-gray-300 hover:-translate-y-0.5 hover:shadow-lg'
    }`}>
      {/* Left accent bar */}
      <div className={`absolute inset-y-0 left-0 w-[3px] ${isRejected ? 'bg-gray-300' : style.bar}`} />

      <div className="pl-5 pr-4 py-4 flex gap-3">
        {/* Checkbox */}
        {onToggle && (
          <div className="flex-shrink-0 pt-0.5" onClick={e => e.stopPropagation()}>
            <button
              onClick={onToggle}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all active:scale-95 ${
                selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300 hover:border-blue-400'
              }`}
            >
              {selected && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Title + copy */}
          <div className="flex items-start gap-1.5 mb-1.5">
            <h3 className="text-base font-bold text-gray-900 leading-snug line-clamp-2 flex-1">
              {paper.title}
            </h3>
            <button
              onClick={copyTitle}
              title="复制标题"
              className="flex-shrink-0 mt-0.5 p-0.5 rounded text-gray-300 hover:text-gray-500 transition-all active:scale-95"
            >
              {copied ? (
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>

          {/* Authors + Venue */}
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-sm text-gray-400 truncate">{authorStr}</p>
            {paper.venue && (
              <span className="text-xs text-slate-500 font-medium whitespace-nowrap flex-shrink-0 max-w-[45%] truncate" title={paper.venue}>
                {paper.venue}
              </span>
            )}
          </div>

          {/* Meta row: year · source · citations · quality badges */}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <span className="text-xs text-gray-400 tabular-nums">{year}</span>
            <span className="text-gray-200 select-none">·</span>
            <span
              className={`text-xs border rounded-full px-2 py-0.5 font-medium cursor-default ${style.badge}`}
              title={SOURCE_DESCRIPTIONS[paper.source] ?? paper.source}
            >
              {paper.source}
            </span>
            {paper.citations > 0 && (
              <span className="text-xs text-gray-400">引用&nbsp;{paper.citations.toLocaleString()}</span>
            )}
            {isHighlyCited && (
              <span className="text-xs border rounded-full px-2 py-0.5 font-medium bg-amber-50 text-amber-700 border-amber-200" title="引用数超过 1000">
                高引
              </span>
            )}
            {hasOpenAccess && !isRejected && (
              <span className="text-xs border rounded-full px-2 py-0.5 font-medium bg-emerald-50 text-emerald-700 border-emerald-200" title="可免费获取全文">
                OA
              </span>
            )}
            {isRejected && (
              <span className="text-xs text-orange-500 bg-orange-50 border border-orange-100 rounded-full px-2 py-0.5">
                AI 认为不相关
              </span>
            )}
            {hasChat && (
              <span
                className="inline-flex items-center gap-0.5 text-xs text-violet-500 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5"
                title="有 AI 对话记录"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                已对话
              </span>
            )}
          </div>

          {/* P1: Compact mode — always show 1-line relevance reason preview */}
          {compact && !expanded && paper.relevance_reason && !isRejected && (
            <div className="flex items-start gap-1 mb-2">
              <span className="text-blue-400 flex-shrink-0 text-xs mt-0.5">✦</span>
              <p className="text-xs text-blue-600/90 line-clamp-1 leading-relaxed">{paper.relevance_reason}</p>
            </div>
          )}

          {/* Compact expand bar */}
          {hasExpandable && (
            <button
              onClick={() => setExpanded(prev => !prev)}
              className="w-full flex items-center gap-2 text-xs text-gray-400 hover:text-blue-500 py-1.5 border-y border-gray-100 my-2 hover:bg-blue-50/40 transition-colors group"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="font-medium group-hover:text-blue-500 transition-colors">
                {expanded ? '收起摘要' : '查看摘要与 AI 分析'}
              </span>
              {!expanded && paper.abstract && (
                <span className="truncate text-gray-300 flex-1">— {paper.abstract.slice(0, 60)}…</span>
              )}
            </button>
          )}

          {/* Abstract */}
          {showAbstract && paper.abstract && (
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 mb-3">
              {paper.abstract}
            </p>
          )}

          {/* AI relevance reason (full) */}
          {showAbstract && paper.relevance_reason && (
            <div className="flex items-start gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2 mb-3">
              <span className="text-blue-400 flex-shrink-0 mt-px text-xs">✦</span>
              <p className="text-sm text-blue-700 leading-relaxed">{paper.relevance_reason}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-end gap-1.5 mt-1">
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {sourceLinks.map(link => (
                <a
                  key={link.source}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all active:scale-95"
                >
                  {link.source}
                  <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
              {paper.pdf_url ? (
                <a
                  href={getDownloadUrl(paper.pdf_url)}
                  download="paper.pdf"
                  className="inline-flex items-center gap-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg px-2.5 py-1 transition-all active:scale-95"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  PDF
                </a>
              ) : paper.fallback_links && paper.fallback_links.length > 0 ? (
                <>
                  <span className="text-xs text-gray-400 py-1 w-full">查找全文：</span>
                  {paper.fallback_links.map(fl => (
                    <a
                      key={fl.name}
                      href={fl.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all active:scale-95"
                    >
                      {fl.name}
                      <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                </>
              ) : links.length > 0 ? (
                <span className="text-xs text-gray-300 py-1">无开放获取 PDF</span>
              ) : null}
            </div>

            {/* Google Scholar — 常驻 */}
            <a
              href={scholarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 hover:border-sky-300 active:bg-sky-200 text-sky-700 transition-all active:scale-95"
            >
              <span className="flex items-center gap-1 text-xs font-semibold leading-tight">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 24a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm0-24L0 9.5l4.838 3.94A8 8 0 0 1 12 9a8 8 0 0 1 7.162 4.44L24 9.5z"/>
                </svg>
                Google Scholar
              </span>
              <span className="text-[10px] text-sky-400 leading-none">引用 · 全文 · 相关</span>
            </a>

            {/* Bookmark — 常驻 */}
            {onSave && (
              <button
                onClick={e => { e.stopPropagation(); onSave() }}
                title={isSaved ? '已收藏 · 点击取消收藏' : isLoggedIn ? '收藏到我的文献库' : '登录后可收藏'}
                className={`flex-shrink-0 inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${
                  isSaved
                    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                    : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                }`}
              >
                <span className="flex items-center gap-1 text-xs font-semibold leading-tight">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  {isSaved ? '已收藏' : '收藏'}
                </span>
                {/* 已登录时只在已收藏状态显示副文字，未登录时提示需要登录 */}
                {(isSaved || !isLoggedIn) && (
                  <span className={`text-[10px] leading-none ${isSaved ? 'text-blue-200' : 'text-blue-400'}`}>
                    {isSaved ? '点击取消' : '登录后使用'}
                  </span>
                )}
              </button>
            )}

            {/* AI 对话 — 常驻 */}
            {onAnalyze && (
              <button
                onClick={e => { e.stopPropagation(); onAnalyze() }}
                className="flex-shrink-0 inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 hover:border-violet-300 active:bg-violet-200 text-violet-700 transition-all active:scale-95"
              >
                <span className="flex items-center gap-1 text-xs font-semibold leading-tight">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  AI 对话
                </span>
                <span className="text-[10px] text-violet-400 leading-none">独立上下文</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
