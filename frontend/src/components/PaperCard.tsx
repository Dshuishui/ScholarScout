import { useState } from 'react'
import type { Paper } from '../types'
import { getDownloadUrl } from '../api/client'

const SOURCE_STYLES: Record<string, { bar: string; badge: string }> = {
  'arXiv':            { bar: 'bg-orange-400',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
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

interface Props {
  paper: Paper
  selected?: boolean
  onToggle?: () => void
  isRejected?: boolean
  onAnalyze?: () => void
}

export function PaperCard({ paper, selected = false, onToggle, isRejected = false, onAnalyze }: Props) {
  const [copied, setCopied] = useState(false)
  const year = paper.published_date?.slice(0, 4) ?? '—'

  const copyTitle = () => {
    navigator.clipboard.writeText(paper.title).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const authorStr = paper.authors.length === 0
    ? '作者未知'
    : paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ` 等 ${paper.authors.length} 人` : '')
  const style = SOURCE_STYLES[paper.source] ?? DEFAULT_STYLE

  const links = paper.source_links && paper.source_links.length > 0
    ? paper.source_links
    : paper.url ? [{ source: paper.source, url: paper.url }] : []

  return (
    <div className={`relative bg-white border rounded-xl overflow-hidden transition-all duration-200 ${
      selected
        ? 'border-blue-400 shadow-md ring-1 ring-blue-100'
        : isRejected
        ? 'border-gray-200 opacity-60 hover:opacity-80'
        : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
    }`}>
      {/* Left accent bar — colored per source */}
      <div className={`absolute inset-y-0 left-0 w-[3px] ${isRejected ? 'bg-gray-300' : style.bar}`} />

      <div className="pl-5 pr-4 py-4 flex gap-3">
        {/* Checkbox */}
        {onToggle && (
          <div className="flex-shrink-0 pt-0.5" onClick={e => e.stopPropagation()}>
            <button
              onClick={onToggle}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
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
          {/* Title + copy + analyze */}
          <div className="flex items-start gap-1.5 mb-1.5 group">
            <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 flex-1">
              {paper.title}
            </h3>
            {onAnalyze && (
              <button
                onClick={e => { e.stopPropagation(); onAnalyze() }}
                title="AI 分析"
                className="flex-shrink-0 mt-0.5 p-0.5 rounded text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </button>
            )}
            <button
              onClick={copyTitle}
              title="复制标题"
              className="flex-shrink-0 mt-0.5 p-0.5 rounded text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-all"
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
            <p className="text-xs text-gray-400 truncate">{authorStr}</p>
            {paper.venue && (
              <span
                className="text-xs text-slate-500 font-medium whitespace-nowrap flex-shrink-0 max-w-[45%] truncate"
                title={paper.venue}
              >
                {paper.venue}
              </span>
            )}
          </div>

          {/* Meta row: year · source · citations */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <span className="text-xs text-gray-400 tabular-nums">{year}</span>
            <span className="text-gray-200 select-none">·</span>
            <span className={`text-xs border rounded-full px-2 py-0.5 font-medium ${style.badge}`}>
              {paper.source}
            </span>
            {paper.citations > 0 && (
              <span className="text-xs text-gray-400">
                引用&nbsp;{paper.citations.toLocaleString()}
              </span>
            )}
            {isRejected && (
              <span className="text-xs text-orange-500 bg-orange-50 border border-orange-100 rounded-full px-2 py-0.5">
                AI 认为不相关
              </span>
            )}
          </div>

          {/* Abstract */}
          {paper.abstract && (
            <p className="text-xs text-gray-600 leading-relaxed line-clamp-3 mb-3">
              {paper.abstract}
            </p>
          )}

          {/* AI relevance reason */}
          {paper.relevance_reason && (
            <div className="flex items-start gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2 mb-3">
              <span className="text-blue-400 flex-shrink-0 mt-px text-xs">✦</span>
              <p className="text-xs text-blue-700 leading-relaxed">{paper.relevance_reason}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {links.map(link => (
              <a
                key={link.source}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all"
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
                className="inline-flex items-center gap-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg px-2.5 py-1 transition-colors"
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
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all"
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
        </div>
      </div>
    </div>
  )
}
