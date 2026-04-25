import type { Paper } from '../types'
import { getDownloadUrl } from '../api/client'

interface Props {
  paper: Paper
}

export function PaperCard({ paper }: Props) {
  const year = paper.published_date?.slice(0, 4) ?? '未知年份'
  const authorStr =
    paper.authors.slice(0, 3).join(', ') +
    (paper.authors.length > 3 ? ` 等 ${paper.authors.length} 人` : '')

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-gray-300 transition-all">
      <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 mb-1">
        {paper.title}
      </h3>

      <p className="text-xs text-gray-500 mb-2">
        {authorStr} · {year} ·{' '}
        <span className="inline-flex items-center bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
          {paper.source}
        </span>
        {paper.citations > 0 && (
          <span className="ml-2 text-gray-400">被引 {paper.citations}</span>
        )}
      </p>

      {paper.abstract && (
        <p className="text-xs text-gray-600 leading-relaxed line-clamp-3 mb-2">
          {paper.abstract}
        </p>
      )}

      {paper.relevance_reason && (
        <p className="text-xs text-blue-700 bg-blue-50 rounded-md px-2.5 py-1.5 mb-2">
          ✦ {paper.relevance_reason}
        </p>
      )}

      <div className="flex gap-2 mt-3">
        {paper.url && (
          <a
            href={paper.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-md px-3 py-1 transition-colors"
          >
            查看原文 ↗
          </a>
        )}
        {paper.pdf_url && (
          <a
            href={getDownloadUrl(paper.pdf_url)}
            download="paper.pdf"
            className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1 transition-colors"
          >
            下载 PDF
          </a>
        )}
        {!paper.pdf_url && paper.doi && (
          <span className="text-xs text-gray-400 px-1 py-1">
            无开放获取 PDF
          </span>
        )}
      </div>
    </div>
  )
}
