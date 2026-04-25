import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import type { Paper } from '../types'
import { PaperCard } from './PaperCard'
import { getDownloadUrl } from '../api/client'

const ITEMS_PER_PAGE = 20
const DOWNLOAD_CONCURRENCY = 3

interface Props {
  papers: Paper[]
  isLoading: boolean
  statusMessage: string
}

interface DownloadProgress {
  current: number
  total: number
  status: string
  done: boolean
}

function sanitizeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80)
}

function exportCSV(papers: Paper[]) {
  const headers = ['标题', '作者', '年份', '来源', '引用数', '摘要', '论文链接', 'PDF链接']
  const rows = papers.map(p => [
    p.title,
    p.authors.join('; '),
    p.published_date?.slice(0, 4) ?? '',
    p.source,
    String(p.citations),
    (p.abstract ?? '').replace(/\n/g, ' '),
    p.url ?? '',
    p.pdf_url ?? '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `scholarscout-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Pagination({ current, total, onChange }: {
  current: number
  total: number
  onChange: (p: number) => void
}) {
  if (total <= 1) return null

  const pages: (number | '...')[] = []
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('...')
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
    if (current < total - 2) pages.push('...')
    pages.push(total)
  }

  const base = 'px-3 py-1.5 text-xs rounded-lg transition-colors'
  const activeBtn = `${base} bg-blue-600 text-white font-semibold shadow-sm`
  const inactiveBtn = `${base} text-gray-600 hover:bg-gray-100 border border-gray-200`
  const arrowBtn = `${base} text-gray-500 hover:bg-gray-100 border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed`

  return (
    <div className="flex items-center justify-center gap-1.5 py-5 border-t border-gray-100 mt-2">
      <button className={arrowBtn} onClick={() => onChange(current - 1)} disabled={current === 1}>‹</button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-1 text-gray-300 text-xs select-none">…</span>
        ) : (
          <button key={p} className={p === current ? activeBtn : inactiveBtn} onClick={() => onChange(p as number)}>
            {p}
          </button>
        )
      )}
      <button className={arrowBtn} onClick={() => onChange(current + 1)} disabled={current === total}>›</button>
    </div>
  )
}

export function ResultsPanel({ papers, isLoading, statusMessage }: Props) {
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)

  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()) }, [papers])

  const totalPages = Math.ceil(papers.length / ITEMS_PER_PAGE)
  const pagePapers = papers.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
  const start = (currentPage - 1) * ITEMS_PER_PAGE + 1
  const end = Math.min(currentPage * ITEMS_PER_PAGE, papers.length)

  const selectedWithPdf = papers.filter(p => selectedIds.has(p.paper_id) && p.pdf_url)
  const allPageSelected = pagePapers.length > 0 && pagePapers.every(p => selectedIds.has(p.paper_id))

  const togglePaper = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(papers.map(p => p.paper_id)))
  const selectPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      pagePapers.forEach(p => next.add(p.paper_id))
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const downloadSelected = async () => {
    if (selectedWithPdf.length === 0) return

    const zip = new JSZip()
    let completed = 0

    setDownloadProgress({ current: 0, total: selectedWithPdf.length, status: '准备中...', done: false })

    for (let i = 0; i < selectedWithPdf.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = selectedWithPdf.slice(i, i + DOWNLOAD_CONCURRENCY)
      await Promise.all(batch.map(async paper => {
        const year = paper.published_date?.slice(0, 4) ?? 'unknown'
        const name = sanitizeFilename(paper.title)
        const filename = `${year}_${name}.pdf`

        setDownloadProgress(prev => prev && ({
          ...prev,
          status: `正在下载：${paper.title.slice(0, 30)}...`,
        }))

        try {
          const resp = await fetch(getDownloadUrl(paper.pdf_url!))
          if (resp.ok) {
            zip.file(filename, await resp.arrayBuffer())
          }
        } catch {
          // 跳过下载失败的论文
        } finally {
          completed++
          setDownloadProgress(prev => prev && ({ ...prev, current: completed }))
        }
      }))
    }

    setDownloadProgress(prev => prev && ({ ...prev, status: '正在压缩打包...', current: selectedWithPdf.length }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scholarscout-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)

    setDownloadProgress(prev => prev && ({ ...prev, status: '下载完成！', done: true }))
    setTimeout(() => setDownloadProgress(null), 2500)
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 顶部标题栏 */}
      <div className="px-5 py-3 border-b border-gray-200 bg-white flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-700 flex-shrink-0">搜索结果</h2>

        {papers.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* 计数 */}
            <span className="text-xs text-gray-400">
              {totalPages > 1 ? `${start}–${end} / ${papers.length} 篇` : `${papers.length} 篇`}
            </span>

            {/* 全选操作 */}
            <div className="flex items-center gap-1">
              <button
                onClick={allPageSelected ? clearSelection : selectPage}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all"
              >
                {allPageSelected ? '取消当前页' : '选当前页'}
              </button>
              <button
                onClick={selectedIds.size === papers.length ? clearSelection : selectAll}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all"
              >
                {selectedIds.size === papers.length ? '取消全选' : '全选所有'}
              </button>
            </div>

            {/* 已选提示 + 下载 */}
            {selectedIds.size > 0 && (
              <button
                onClick={downloadSelected}
                disabled={selectedWithPdf.length === 0 || !!downloadProgress}
                className="flex items-center gap-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-1 transition-all"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载 {selectedWithPdf.length} 篇 PDF
                {selectedIds.size !== selectedWithPdf.length && (
                  <span className="opacity-70">（已选 {selectedIds.size} 篇，{selectedIds.size - selectedWithPdf.length} 篇无 PDF）</span>
                )}
              </button>
            )}

            {/* 导出 CSV */}
            <button
              onClick={() => exportCSV(papers)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 bg-white hover:bg-blue-50 rounded-lg px-2.5 py-1 transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              导出 CSV
            </button>
          </div>
        )}
      </div>

      {/* 状态栏 */}
      {statusMessage && (
        <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100">
          <p className="text-xs text-blue-600 break-words leading-relaxed">{statusMessage}</p>
        </div>
      )}

      {/* 论文列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && papers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
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

        {pagePapers.map(paper => (
          <PaperCard
            key={paper.paper_id}
            paper={paper}
            selected={selectedIds.has(paper.paper_id)}
            onToggle={() => togglePaper(paper.paper_id)}
          />
        ))}

        <Pagination current={currentPage} total={totalPages} onChange={p => { setCurrentPage(p) }} />
      </div>

      {/* 下载进度浮层 */}
      {downloadProgress && (
        <div className="absolute bottom-6 right-6 bg-white border border-gray-200 shadow-xl rounded-2xl p-4 z-50 w-80">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-800">
              {downloadProgress.done ? '下载完成 ✓' : '正在打包 PDF'}
            </span>
            <span className="text-xs text-gray-400 tabular-nums">
              {downloadProgress.current} / {downloadProgress.total}
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-2.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-300 ${downloadProgress.done ? 'bg-green-500' : 'bg-blue-600'}`}
              style={{ width: `${(downloadProgress.current / downloadProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 truncate">{downloadProgress.status}</p>
        </div>
      )}
    </div>
  )
}
