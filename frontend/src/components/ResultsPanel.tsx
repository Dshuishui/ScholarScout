import type { Paper } from '../types'
import { PaperCard } from './PaperCard'

interface Props {
  papers: Paper[]
  isLoading: boolean
  statusMessage: string
}

export function ResultsPanel({ papers, isLoading, statusMessage }: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="px-5 py-3.5 border-b border-gray-200 bg-white flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">搜索结果</h2>
        {papers.length > 0 && (
          <span className="text-xs text-gray-400">{papers.length} 篇</span>
        )}
      </div>

      {statusMessage && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
          <p className="text-xs text-blue-600">{statusMessage}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && papers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
            <p className="text-sm text-gray-400">正在搜索...</p>
          </div>
        )}

        {!isLoading && papers.length === 0 && !statusMessage && (
          <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
            <p className="text-2xl">🔍</p>
            <p className="text-sm text-gray-400">在左侧描述您想找的论文</p>
            <p className="text-xs text-gray-300">例如：找2023年后关于RAG的综述</p>
          </div>
        )}

        {papers.map(paper => (
          <PaperCard key={paper.paper_id} paper={paper} />
        ))}
      </div>
    </div>
  )
}
