import { useState, useEffect, useMemo } from 'react'
import JSZip from 'jszip'
import type { Paper } from '../types'
import type { SearchSettings } from '../hooks/useSettings'
import { PaperCard } from './PaperCard'
import { getDownloadUrl } from '../api/client'

const ITEMS_PER_PAGE = 20
const DOWNLOAD_CONCURRENCY = 3

type SortOption = 'relevance' | 'citations' | 'date_desc' | 'date_asc'

interface Props {
  papers: Paper[]
  rejectedPapers?: Paper[]
  isLoading: boolean
  settings: SearchSettings
  onSettingsChange: (patch: Partial<SearchSettings>) => void
  onReSearch?: (keywords: string[]) => void
  confirmedKeywords?: string[] | null
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

  const base = 'w-8 h-8 flex items-center justify-center text-xs rounded-full transition-all'
  const activeBtn = `${base} bg-blue-600 text-white font-semibold shadow-sm`
  const inactiveBtn = `${base} text-gray-500 hover:bg-white hover:text-gray-800 hover:shadow-sm`
  const arrowBtn = `${base} text-gray-400 hover:bg-white hover:text-gray-700 hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none`

  return (
    <div className="flex items-center justify-center gap-1 py-6 mt-2">
      <button className={arrowBtn} onClick={() => onChange(current - 1)} disabled={current === 1}>‹</button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="w-8 text-center text-gray-300 text-xs select-none">…</span>
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

export function ResultsPanel({ papers, rejectedPapers = [], isLoading, statusMessage, settings, onSettingsChange, onReSearch, confirmedKeywords }: Props) {
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [appliedSettings, setAppliedSettings] = useState(settings)
  const [editKeywords, setEditKeywords] = useState<string[]>([])
  const [newKw, setNewKw] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('relevance')
  const [activeTab, setActiveTab] = useState<'filtered' | 'all'>('filtered')
  const [showSettings, setShowSettings] = useState(false)

  // 新搜索完成时重置到筛选后视图
  useEffect(() => {
    setCurrentPage(1)
    setSelectedIds(new Set())
    setAppliedSettings(settings)
    setActiveTab('filtered')
  }, [papers]) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换 tab 或排序时回到第一页
  useEffect(() => { setCurrentPage(1) }, [sortBy, activeTab])

  const rejectedIds = useMemo(() => new Set(rejectedPapers.map(p => p.paper_id)), [rejectedPapers])

  const activePapers = useMemo(
    () => activeTab === 'filtered' ? papers : [...papers, ...rejectedPapers],
    [activeTab, papers, rejectedPapers]
  )

  const sortedPapers = useMemo(() => {
    if (sortBy === 'relevance') return activePapers
    return [...activePapers].sort((a, b) => {
      if (sortBy === 'citations') return b.citations - a.citations
      const da = a.published_date ?? ''
      const db = b.published_date ?? ''
      return sortBy === 'date_desc' ? db.localeCompare(da) : da.localeCompare(db)
    })
  }, [activePapers, sortBy])

  // Sync keyword editor when a new search completes
  useEffect(() => {
    if (confirmedKeywords) {
      setEditKeywords([...confirmedKeywords])
      setNewKw('')
    }
  }, [confirmedKeywords])

  const keywordsChanged = confirmedKeywords != null && (
    editKeywords.join(',') !== confirmedKeywords.join(',')
  )
  const settingsChanged = papers.length > 0 && (
    appliedSettings.limitPerSource !== settings.limitPerSource ||
    appliedSettings.validatedLimit !== settings.validatedLimit
  )
  const needsReSearch = (keywordsChanged || settingsChanged) && papers.length > 0 && !!onReSearch

  const addKeyword = () => {
    const kw = newKw.trim()
    if (!kw || editKeywords.includes(kw)) { setNewKw(''); return }
    setEditKeywords(prev => [...prev, kw])
    setNewKw('')
  }

  const totalPages = Math.ceil(sortedPapers.length / ITEMS_PER_PAGE)
  const pagePapers = sortedPapers.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
  const start = (currentPage - 1) * ITEMS_PER_PAGE + 1
  const end = Math.min(currentPage * ITEMS_PER_PAGE, sortedPapers.length)

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
    const failed: { title: string; authors: string; year: string; url: string; reason: string }[] = []

    setDownloadProgress({ current: 0, total: selectedWithPdf.length, status: '准备中...', done: false })

    for (let i = 0; i < selectedWithPdf.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = selectedWithPdf.slice(i, i + DOWNLOAD_CONCURRENCY)
      await Promise.all(batch.map(async paper => {
        const year = paper.published_date?.slice(0, 4) ?? 'unknown'
        const filename = `${year}_${sanitizeFilename(paper.title)}.pdf`

        setDownloadProgress(prev => prev && ({
          ...prev,
          status: `正在下载：${paper.title.slice(0, 30)}...`,
        }))

        try {
          const resp = await fetch(getDownloadUrl(paper.pdf_url!))
          if (resp.ok) {
            zip.file(filename, await resp.arrayBuffer())
          } else {
            failed.push({ title: paper.title, authors: paper.authors.join('; '), year, url: paper.pdf_url!, reason: `HTTP ${resp.status}` })
          }
        } catch {
          failed.push({ title: paper.title, authors: paper.authors.join('; '), year, url: paper.pdf_url!, reason: '网络错误' })
        } finally {
          completed++
          setDownloadProgress(prev => prev && ({ ...prev, current: completed }))
        }
      }))
    }

    // 失败明细写入 CSV 一起放进 ZIP
    if (failed.length > 0) {
      const headers = ['标题', '作者', '年份', 'PDF链接', '失败原因']
      const csvRows = [headers, ...failed.map(f => [f.title, f.authors, f.year, f.url, f.reason])]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')
      zip.file('failed_downloads.csv', '﻿' + csvRows)
    }

    const successCount = selectedWithPdf.length - failed.length
    const doneStatus = failed.length > 0
      ? `${successCount} 篇成功，${failed.length} 篇失败（详见 failed_downloads.csv）`
      : '全部下载完成！'

    setDownloadProgress(prev => prev && ({ ...prev, status: '正在压缩打包...', current: selectedWithPdf.length }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scholarscout-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)

    setDownloadProgress(prev => prev && ({ ...prev, status: doneStatus, done: true }))
    setTimeout(() => setDownloadProgress(null), 3500)
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* 顶部标题栏 */}
      <div className="px-5 py-3 border-b border-gray-200 bg-white flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800 flex-shrink-0">搜索结果</h2>

        {papers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {totalPages > 1 && (
              <span className="text-xs text-gray-400 tabular-nums mr-1">
                {start}–{end} / {sortedPapers.length}
              </span>
            )}

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
              {selectedIds.size === papers.length ? '取消全选' : '全选'}
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={downloadSelected}
                disabled={selectedWithPdf.length === 0 || !!downloadProgress}
                className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-2.5 py-1 transition-all"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载 {selectedWithPdf.length} PDF
                {selectedIds.size !== selectedWithPdf.length && (
                  <span className="opacity-70 ml-0.5">({selectedIds.size - selectedWithPdf.length} 无 PDF)</span>
                )}
              </button>
            )}

            <button
              onClick={() => exportCSV(papers)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1 transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              导出为 CSV
            </button>
          </div>
        )}
      </div>

      {/* 关键词行 */}
      {confirmedKeywords != null && (
        <div className="px-5 py-2.5 bg-white border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-400 shrink-0">搜索词</span>
          {editKeywords.map((kw, i) => (
            <span
              key={i}
              className="flex items-center gap-1 bg-blue-600 text-white text-xs rounded-full px-2.5 py-1 font-medium shadow-sm"
            >
              {kw}
              <button
                onClick={() => setEditKeywords(prev => prev.filter((_, j) => j !== i))}
                className="text-blue-200 hover:text-white transition-colors leading-none ml-0.5"
              >
                ✕
              </button>
            </span>
          ))}
          <input
            value={newKw}
            onChange={e => setNewKw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
            onBlur={addKeyword}
            placeholder="＋ 添加"
            className="text-xs border border-dashed border-gray-300 rounded-full px-2.5 py-1 outline-none focus:border-blue-400 bg-transparent text-gray-500 placeholder-gray-300 w-20"
          />
          {needsReSearch && (
            <button
              onClick={() => onReSearch!(editKeywords)}
              disabled={isLoading || editKeywords.length === 0}
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full px-3 py-1 transition-all shadow-sm"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              重新搜索
            </button>
          )}
        </div>
      )}

      {/* Tab 栏 + 排序 + 设置 */}
      {(papers.length > 0 || rejectedPapers.length > 0) && (
        <>
          <div className="px-5 py-0 bg-white border-b border-gray-200 flex items-center justify-between">
            <div className="flex">
              {(['filtered', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {tab === 'filtered' ? 'AI 筛选后' : '全部结果'}
                  <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 tabular-nums ${
                    activeTab === tab ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {tab === 'filtered' ? papers.length : papers.length + rejectedPapers.length}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortOption)}
                className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer hover:border-gray-300 transition-colors"
              >
                <option value="relevance">相关性优先</option>
                <option value="citations">引用数最高</option>
                <option value="date_desc">最新发表</option>
                <option value="date_asc">最早发表</option>
              </select>

              <button
                onClick={() => setShowSettings(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  showSettings || settingsChanged
                    ? 'border-blue-300 bg-blue-50 text-blue-600'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span className="tabular-nums">每源 {settings.limitPerSource} · 展示 {settings.validatedLimit}</span>
                {settingsChanged && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
              </button>
            </div>
          </div>

          {/* 折叠设置面板 */}
          {showSettings && (
            <div className="px-5 py-3 bg-blue-50/60 border-b border-blue-100 flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 whitespace-nowrap">每源抓取</label>
                <input
                  type="range" min={10} max={200} step={1}
                  value={settings.limitPerSource}
                  onChange={e => onSettingsChange({ limitPerSource: Number(e.target.value) })}
                  className="w-24 accent-blue-600 cursor-pointer"
                />
                <span className="text-xs font-semibold text-blue-600 w-10 tabular-nums">{settings.limitPerSource} 篇</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 whitespace-nowrap">展示上限</label>
                <input
                  type="range" min={10} max={500} step={1}
                  value={settings.validatedLimit}
                  onChange={e => onSettingsChange({ validatedLimit: Number(e.target.value) })}
                  className="w-24 accent-blue-600 cursor-pointer"
                />
                <span className="text-xs font-semibold text-blue-600 w-10 tabular-nums">{settings.validatedLimit} 篇</span>
              </div>
              <p className="text-xs text-blue-400 ml-auto">调整后点击重新搜索生效</p>
            </div>
          )}
        </>
      )}

      {/* 状态栏 — 有结果后才显示进度（加载中且无结果时进度已在列表区展示） */}
      {statusMessage && papers.length > 0 && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
          <p className="text-xs text-blue-600 break-words leading-relaxed">{statusMessage}</p>
        </div>
      )}

      {/* 论文列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && papers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-56 gap-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-600">正在搜索</p>
              {statusMessage && (
                <p className="text-xs text-gray-400 mt-1 max-w-xs">{statusMessage}</p>
              )}
            </div>
          </div>
        )}

        {!isLoading && papers.length === 0 && !statusMessage && (
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] text-center gap-5 px-8">
            <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-gray-700 mb-1.5">开始探索学术文献</p>
              <p className="text-sm text-gray-400 leading-relaxed">
                在左侧用自然语言描述你想找的论文<br />
                AI 将自动提取关键词并搜索 10 个学术数据库
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {[
                '找 2023 年后关于大模型幻觉问题的论文',
                'diffusion model 在医学图像的应用综述',
                '图神经网络用于药物发现的最新进展',
              ].map(example => (
                <div key={example} className="text-xs text-gray-400 bg-white border border-gray-200 rounded-lg px-3 py-2 text-left">
                  "{example}"
                </div>
              ))}
            </div>
          </div>
        )}

        {pagePapers.map(paper => (
          <PaperCard
            key={paper.paper_id}
            paper={paper}
            selected={selectedIds.has(paper.paper_id)}
            onToggle={activeTab === 'filtered' || !rejectedIds.has(paper.paper_id) ? () => togglePaper(paper.paper_id) : undefined}
            isRejected={rejectedIds.has(paper.paper_id)}
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
