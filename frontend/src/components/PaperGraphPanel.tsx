import { useState, useCallback, useRef, useEffect } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { Paper } from '../types'

interface GraphNode {
  id: string
  title: string
  source: string
  year: string
  citations: number
  authors: string
  role?: 'reference' | 'citing' | 'expanded'
  x?: number
  y?: number
}

interface GraphLink {
  source: string
  target: string
  similarity: number
  type?: 'semantic' | 'cites'
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

interface Props {
  papers: Paper[]
  onClose: () => void
}

const SOURCE_COLORS: Record<string, string> = {
  arXiv: '#6366f1',
  'Semantic Scholar': '#10b981',
  OpenAlex: '#f59e0b',
  PubMed: '#ef4444',
  'Europe PMC': '#ec4899',
  'INSPIRE-HEP': '#8b5cf6',
  CrossRef: '#06b6d4',
  CORE: '#84cc16',
  'NASA ADS': '#f97316',
  default: '#94a3b8',
}

function sourceColor(source: string) {
  return SOURCE_COLORS[source] ?? SOURCE_COLORS.default
}

export function PaperGraphPanel({ papers, onClose }: Props) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [threshold, setThreshold] = useState(0.35)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 })
  const [expandingId, setExpandingId] = useState<string | null>(null)
  const expandedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({ width: rect.width, height: rect.height })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const fetchGraph = useCallback(async (thresh: number) => {
    setLoading(true)
    setError('')
    setSelected(null)
    try {
      const body = {
        papers: papers.map(p => ({
          paper_id: p.paper_id,
          title: p.title,
          abstract: p.abstract ?? null,
          citations: p.citations,
          source: p.source,
          published_date: p.published_date ?? null,
          authors: p.authors,
        })),
        threshold: thresh,
      }
      const r = await fetch('/api/semantic/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('请求失败')
      const data: GraphData = await r.json()
      setGraphData(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [papers])

  useEffect(() => {
    fetchGraph(threshold)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const expandCitations = useCallback(async (nodeId: string) => {
    if (expandedRef.current.has(nodeId)) return
    setExpandingId(nodeId)
    try {
      const r = await fetch(`/api/semantic/citations/${encodeURIComponent(nodeId)}?limit=20`)
      if (!r.ok) throw new Error(await r.text())
      const data: GraphData = await r.json()
      expandedRef.current.add(nodeId)
      setGraphData(prev => {
        if (!prev) return prev
        const existingIds = new Set(prev.nodes.map(n => n.id))
        const newNodes = data.nodes
          .filter(n => !existingIds.has(n.id))
          .map(n => ({ ...n, role: n.role ?? 'expanded' as const }))
        const existingLinkKeys = new Set(prev.links.map(l => `${l.source}|${l.target}`))
        const newLinks = data.links.filter(l => !existingLinkKeys.has(`${l.source}|${l.target}`))
        return {
          nodes: [...prev.nodes, ...newNodes],
          links: [...prev.links, ...newLinks],
        }
      })
    } catch (e) {
      // silently ignore — SS may not have this paper
      console.warn('Citation expand failed:', e)
    } finally {
      setExpandingId(null)
    }
  }, [])

  const nodeCanvasObject = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const r = Math.max(4, Math.min(12, 4 + Math.log1p(node.citations || 0) * 1.5))
    const color = sourceColor(node.source)
    const isSelected = selected?.id === node.id

    ctx.beginPath()
    ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()

    if (isSelected) {
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, r + 3, 0, 2 * Math.PI)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (globalScale >= 1.2 || isSelected) {
      const label = node.title.slice(0, 30) + (node.title.length > 30 ? '…' : '')
      const fontSize = Math.max(8, 10 / globalScale)
      ctx.font = `${fontSize}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#374151'
      ctx.fillText(label, node.x!, node.y! + r + 2)
    }
  }, [selected])

  const linkColor = useCallback((link: GraphLink) => {
    if (link.type === 'cites') return '#f59e0b80'
    const sim = link.similarity
    const alpha = Math.round((sim - 0.3) * 2 * 255).toString(16).padStart(2, '0')
    return `#6366f1${alpha}`
  }, [])

  const linkWidth = useCallback((link: GraphLink) => {
    return Math.max(0.5, link.similarity * 3)
  }, [])

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
        <button onClick={onClose} className="text-indigo-300/80 hover:text-white transition-colors p-1 rounded hover:bg-white/5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-bold text-white">论文关系图谱</span>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-indigo-300/60">相似度阈值</span>
          <input
            type="range" min={0.1} max={0.8} step={0.05}
            value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            onMouseUp={() => fetchGraph(threshold)}
            onTouchEnd={() => fetchGraph(threshold)}
            className="w-20 accent-indigo-500"
          />
          <span className="text-xs text-indigo-300/80 w-8">{Math.round(threshold * 100)}%</span>
        </div>
        <span className="text-xs text-indigo-300/50 hidden sm:block">
          {graphData ? `${graphData.nodes.length} 节点 · ${graphData.links.length} 连线` : ''}
        </span>
      </div>

      {/* 图谱区 + 侧边信息面板 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 图谱 canvas */}
        <div ref={containerRef} className="flex-1 bg-gray-50 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
              <div className="text-sm text-gray-500 flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                计算语义相似度…
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          {!loading && graphData && graphData.links.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-sm text-gray-400 mb-1">当前阈值下论文间无显著关联</p>
              <p className="text-xs text-gray-300">尝试降低相似度阈值</p>
            </div>
          )}
          {!loading && graphData && (
            <ForceGraph2D
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              nodeCanvasObject={nodeCanvasObject as never}
              nodeCanvasObjectMode={() => 'replace'}
              linkColor={linkColor as never}
              linkWidth={linkWidth as never}
              onNodeClick={(node) => setSelected(n => n?.id === (node as GraphNode).id ? null : node as GraphNode)}
              backgroundColor="#f9fafb"
              linkDirectionalParticles={1}
              linkDirectionalParticleWidth={(link) => (link as GraphLink).similarity * 2}
              enableZoomInteraction
              enablePanInteraction
            />
          )}
        </div>

        {/* 右侧图例 + 节点详情 */}
        <div className="w-56 flex-shrink-0 border-l border-gray-100 flex flex-col overflow-y-auto">
          {/* 图例 */}
          <div className="p-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-500 mb-2">数据来源</p>
            <div className="space-y-1">
              {Object.entries(SOURCE_COLORS).filter(([k]) => k !== 'default').map(([source, color]) => {
                const count = graphData?.nodes.filter(n => n.source === source).length ?? 0
                if (!count) return null
                return (
                  <div key={source} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className="text-xs text-gray-500 truncate">{source}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 说明 */}
          <div className="p-3 border-b border-gray-50">
            <p className="text-xs text-gray-400 leading-relaxed">
              节点大小 = 引用量<br />
              <span className="inline-block w-3 h-0.5 bg-indigo-400 align-middle mr-1" /> 紫色边 = 语义相似<br />
              <span className="inline-block w-3 h-0.5 bg-amber-400 align-middle mr-1" /> 橙色边 = 引用关系<br />
              点击节点查看详情<br />
              滚轮缩放，拖动平移
            </p>
          </div>

          {/* 选中节点详情 */}
          {selected && (
            <div className="p-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">选中论文</p>
              <p className="text-xs font-medium text-gray-800 leading-snug mb-1">{selected.title}</p>
              {selected.authors && <p className="text-[11px] text-gray-400 mb-0.5">{selected.authors}</p>}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selected.source && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border"
                    style={{ color: sourceColor(selected.source), borderColor: sourceColor(selected.source) + '40', background: sourceColor(selected.source) + '15' }}>
                    {selected.source}
                  </span>
                )}
                {selected.year && <span className="text-[10px] text-gray-400">{selected.year}</span>}
                {selected.citations > 0 && (
                  <span className="text-[10px] text-gray-400">引用 {selected.citations}</span>
                )}
              </div>
              {/* Expand citation graph button */}
              <button
                onClick={() => expandCitations(selected.id)}
                disabled={expandingId === selected.id || expandedRef.current.has(selected.id)}
                className="mt-2.5 w-full text-[11px] flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {expandingId === selected.id ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {expandedRef.current.has(selected.id) ? '已扩展引用图' : '扩展引用图'}
              </button>
              {/* 相邻连接 */}
              {graphData && (() => {
                const neighbors = graphData.links
                  .filter(l => l.source === selected.id || l.target === selected.id)
                  .map(l => ({ id: l.source === selected.id ? l.target : l.source as string, sim: l.similarity }))
                  .sort((a, b) => b.sim - a.sim)
                if (!neighbors.length) return null
                return (
                  <div className="mt-2.5">
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">关联论文</p>
                    <div className="space-y-1">
                      {neighbors.slice(0, 4).map(({ id, sim }) => {
                        const n = graphData.nodes.find(x => x.id === id)
                        if (!n) return null
                        return (
                          <button key={id} onClick={() => setSelected(n)}
                            className="w-full text-left text-[10px] text-gray-500 hover:text-indigo-600 flex items-center gap-1">
                            <span className="truncate flex-1">{n.title}</span>
                            <span className="flex-shrink-0 text-indigo-400 font-medium">{Math.round(sim * 100)}%</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
