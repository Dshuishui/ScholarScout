import { useState } from 'react'
import { semanticSearch, findSimilarPapers } from '../api/client'
import type { SemanticHit } from '../api/client'

interface Props {
  defaultQuery?: string
  onClose: () => void
}

export function SemanticSearchPanel({ defaultQuery = '', onClose }: Props) {
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<SemanticHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(false)
    const hits = await semanticSearch(query.trim(), 12)
    setResults(hits)
    setSearched(true)
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 顶栏 */}
      <div
        className="h-11 flex-shrink-0 flex items-center px-4 gap-3 z-10 relative"
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
          className="flex items-center gap-1.5 text-indigo-300/80 hover:text-white transition-colors p-1 rounded hover:bg-white/5"
          title="返回"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-bold text-white tracking-tight">语义检索</span>
        <span className="text-xs text-indigo-300/50 ml-auto">向量相似度搜索</span>
      </div>

      {/* 搜索框 */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex gap-2">
          <input
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            placeholder="用自然语言描述你想找的论文方向…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
          />
          <button
            onClick={search}
            disabled={loading || !query.trim()}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
              </svg>
            )}
            搜索
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          从历史搜索过的论文中，找出语义最相关的结果
        </p>
      </div>

      {/* 结果 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && (
          <p className="text-center text-gray-400 text-sm mt-8">向量检索中…</p>
        )}

        {!loading && searched && results.length === 0 && (
          <div className="text-center mt-12">
            <p className="text-gray-400 text-sm mb-1">暂无结果</p>
            <p className="text-xs text-gray-300">请先进行一次普通搜索，将论文加入索引后再使用语义检索</p>
          </div>
        )}

        {!loading && results.map((hit, i) => (
          <SemanticHitCard key={hit.paper_id} hit={hit} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

function SemanticHitCard({ hit, rank }: { hit: SemanticHit; rank: number }) {
  const [similar, setSimilar] = useState<SemanticHit[]>([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)
  const [showSimilar, setShowSimilar] = useState(false)

  const loadSimilar = async () => {
    if (similar.length > 0) {
      setShowSimilar(s => !s)
      return
    }
    setLoadingSimilar(true)
    const hits = await findSimilarPapers(hit.paper_id, 4)
    setSimilar(hits)
    setShowSimilar(true)
    setLoadingSimilar(false)
  }

  const pct = Math.round(hit.similarity * 100)
  const barColor = pct >= 80 ? 'bg-green-400' : pct >= 60 ? 'bg-indigo-400' : 'bg-gray-300'

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3.5 hover:border-indigo-100 transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold text-violet-400 mt-0.5 flex-shrink-0 w-4">[{rank}]</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug mb-1">{hit.title}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
            {hit.authors && <span className="truncate max-w-[180px]">{hit.authors}</span>}
            {hit.year && <span>{hit.year}</span>}
            {hit.source && <span className="text-indigo-400">{hit.source}</span>}
            {hit.citations > 0 && <span>引用 {hit.citations}</span>}
          </div>
        </div>
        {/* 相似度条 */}
        <div className="flex-shrink-0 text-right ml-2">
          <span className="text-xs font-bold text-indigo-600">{pct}%</span>
          <div className="w-12 h-1.5 bg-gray-100 rounded-full mt-1">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* 找相似按钮 */}
      <div className="mt-2 flex justify-end">
        <button
          onClick={loadSimilar}
          disabled={loadingSimilar}
          className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-40"
        >
          {loadingSimilar ? '查找中…' : showSimilar ? '▲ 收起相似' : '▼ 找相似论文'}
        </button>
      </div>

      {showSimilar && similar.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-50 space-y-1.5">
          {similar.map(s => (
            <div key={s.paper_id} className="flex items-start gap-1.5 pl-3">
              <span className="text-[9px] text-violet-300 mt-0.5 flex-shrink-0">●</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-600 line-clamp-1">{s.title}</p>
                <span className="text-[10px] text-gray-400">{s.source}{s.year ? ` · ${s.year}` : ''}</span>
              </div>
              <span className="text-[10px] font-semibold text-indigo-400 flex-shrink-0">{Math.round(s.similarity * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {showSimilar && similar.length === 0 && !loadingSimilar && (
        <p className="text-xs text-gray-400 mt-2 pl-3">暂无相似论文（需要更多论文入库）</p>
      )}
    </div>
  )
}
