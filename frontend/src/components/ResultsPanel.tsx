import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { useAuth } from '../hooks/useAuth'
import { AuthModal } from './AuthModal'
import JSZip from 'jszip'
import type { Paper } from '../types'
import type { SearchSettings } from '../hooks/useSettings'
import type { SourceStatus } from '../hooks/useSearch'
import type { ChatMessage } from '../hooks/usePaperChat'
import { ALL_SOURCES } from '../hooks/useSettings'
import { PaperCard } from './PaperCard'
import { PaperCardSkeleton } from './PaperCardSkeleton'
import { getDownloadUrl } from '../api/client'

const ComparePanel = lazy(() => import('./ComparePanel').then(m => ({ default: m.ComparePanel })))

const SOURCE_COLORS: Record<string, string> = {
  'arXiv':            'text-green-600',
  'Semantic Scholar': 'text-blue-600',
  'OpenAlex':         'text-violet-600',
  'PubMed':           'text-emerald-600',
  'Europe PMC':       'text-teal-600',
  'INSPIRE-HEP':      'text-red-500',
  'CrossRef':         'text-indigo-600',
  'CORE':             'text-cyan-600',
  'NASA ADS':         'text-sky-600',
  'Google Scholar':   'text-amber-600',
}

const ITEMS_PER_PAGE = 20
const DOWNLOAD_CONCURRENCY = 1   // 顺序下载，防止并发触发 arXiv/Sci-Hub 等源的 IP 限流
const DOWNLOAD_TIMEOUT_MS = 90_000

type SortOption = 'relevance' | 'citations' | 'date_desc' | 'date_asc'
type ViewMode = 'list' | 'grouped'
type Density = 'compact' | 'standard'

interface Props {
  papers: Paper[]
  rejectedPapers?: Paper[]
  isLoading: boolean
  settings: SearchSettings
  onSettingsChange: (patch: Partial<SearchSettings>) => void
  onReSearch?: (keywords: string[]) => void
  confirmedKeywords?: string[] | null
  statusMessage: string
  sourceStatuses?: Record<string, SourceStatus>
  onAnalyzePaper?: (paper: Paper) => void
  onExampleSearch?: (query: string) => void
  apiKey?: string
  getMessages?: (paperId: string) => ChatMessage[]
  hasSearchError?: boolean
  searchDateRange?: { from: string | null; to: string | null } | null
  sessionId?: number | null
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

async function translateTitles(titles: string[], apiKey: string): Promise<string[]> {
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      stream: false,
      messages: [
        { role: 'system', content: '你是学术翻译助手。将下列英文论文标题翻译为中文，保持学术术语准确。严格按"序号. 中文标题"格式逐行输出，不加任何解释。' },
        { role: 'user', content: numbered },
      ],
    }),
  })
  const data = await resp.json()
  const text: string = data.choices?.[0]?.message?.content ?? ''
  const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d+\./.test(l))
  return titles.map((_, i) => {
    const line = lines.find(l => l.startsWith(`${i + 1}.`))
    return line ? line.replace(/^\d+\.\s*/, '').trim() : ''
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function generateChatsHTML(papers: Paper[], getMessages: (id: string) => ChatMessage[]): string {
  const dated = new Date().toLocaleString('zh-CN')
  const sections = papers
    .map(p => ({ p, msgs: getMessages(p.paper_id).filter(m => !m.isStreaming) }))
    .filter(({ msgs }) => msgs.length > 0)
    .map(({ p, msgs }) => {
      const bubbles = msgs.map(m => {
        const isUser = m.role === 'user'
        const style = isUser
          ? 'background:#2563eb;color:#fff;border-radius:18px 18px 4px 18px;margin-left:auto'
          : 'background:#f3f4f6;color:#1f2937;border-radius:18px 18px 18px 4px;margin-right:auto'
        return `<div style="display:flex;${isUser ? 'justify-content:flex-end' : 'justify-content:flex-start'};margin-bottom:10px">
          <div style="${style};padding:10px 14px;max-width:78%;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHtml(m.content)}</div>
        </div>`
      }).join('')
      const meta = [
        p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ' 等' : ''),
        p.published_date?.slice(0, 4),
        p.venue,
      ].filter(Boolean).join(' · ')
      return `<div style="margin-bottom:36px;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
        <div style="background:#f9fafb;padding:16px;border-bottom:1px solid #e5e7eb">
          <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:4px">${escapeHtml(p.title)}</div>
          <div style="font-size:12px;color:#6b7280">${escapeHtml(meta)}</div>
        </div>
        <div style="padding:16px;display:flex;flex-direction:column">${bubbles}</div>
      </div>`
    })

  if (sections.length === 0) return ''
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>ScholarScout AI 对话记录</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:860px;margin:0 auto;padding:24px;color:#1f2937">
<h1 style="font-size:20px;font-weight:700;margin-bottom:4px">ScholarScout AI 对话记录</h1>
<p style="color:#6b7280;font-size:13px;margin-bottom:32px">导出时间：${escapeHtml(dated)} · 共 ${sections.length} 篇论文有对话记录</p>
${sections.join('\n')}
</body></html>`
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
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

export function ResultsPanel({ papers, rejectedPapers = [], isLoading, statusMessage, sourceStatuses = {}, settings, onSettingsChange, onReSearch, confirmedKeywords, onAnalyzePaper, onExampleSearch, apiKey, getMessages, hasSearchError = false, searchDateRange, sessionId }: Props) {
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [appliedSettings, setAppliedSettings] = useState(settings)
  const [editKeywords, setEditKeywords] = useState<string[]>([])
  const [newKw, setNewKw] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('relevance')
  const [activeTab, setActiveTab] = useState<'filtered' | 'all'>('filtered')
  const [yearFrom, setYearFrom] = useState<number | null>(null)
  const [yearTo, setYearTo] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [density, setDensityState] = useState<Density>(() =>
    (localStorage.getItem('scholarscout_density') as Density) ?? 'compact'
  )
  const setDensity = (d: Density) => {
    setDensityState(d)
    localStorage.setItem('scholarscout_density', d)
  }

  const { token, isLoggedIn, user } = useAuth()
  const [savedMap, setSavedMap] = useState<Map<string, string>>(() => {
    try {
      const cached = localStorage.getItem('ss_saved_map')
      return cached ? new Map(JSON.parse(cached) as [string, string][]) : new Map()
    } catch { return new Map() }
  })
  const [subscriptions, setSubscriptions] = useState<{ id: number; keywords: string[] }[]>([])
  const [subLoading, setSubLoading] = useState(false)
  const [showSubModal, setShowSubModal] = useState(false)
  const [subModalKeywords, setSubModalKeywords] = useState<string[]>([])
  const [newSubId, setNewSubId] = useState<number | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportOpts, setExportOpts] = useState({ aiOnly: true, aiAnalysis: true, translate: true, chats: true })
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState('')

  const _syncSaved = (items: { paper_id_hash: string; paper: { paper_id: string } }[]) => {
    const m = new Map(items.map(i => [i.paper.paper_id, i.paper_id_hash]))
    setSavedMap(m)
    localStorage.setItem('ss_saved_map', JSON.stringify([...m.entries()]))
  }

  useEffect(() => {
    if (!isLoggedIn || !token) {
      setSavedMap(new Map())
      localStorage.removeItem('ss_saved_map')
      setSubscriptions([])
      return
    }
    fetch('/api/user/saved', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(_syncSaved)
      .catch(() => {})
    fetch('/api/subscriptions', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((data: { id: number; keywords: string[] }[]) => setSubscriptions(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [isLoggedIn, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const isSubscribed = confirmedKeywords != null && subscriptions.some(
    s => JSON.stringify([...s.keywords].sort()) === JSON.stringify([...confirmedKeywords].sort())
  )

  const handleSubscribe = async () => {
    if (!token || !confirmedKeywords || isSubscribed || subLoading) return
    setSubLoading(true)
    try {
      const r = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keywords: confirmedKeywords }),
      })
      if (r.ok) {
        const sub: { id: number; keywords: string[] } = await r.json()
        setSubscriptions(prev => [...prev, sub])
        setSubModalKeywords(confirmedKeywords)
        setNewSubId(sub.id)
        setShowSubModal(true)
      }
    } finally {
      setSubLoading(false)
    }
  }

  const handleSave = async (paper: Paper) => {
    if (!token) return
    const existingHash = savedMap.get(paper.paper_id)
    if (existingHash) {
      // 乐观更新
      setSavedMap(prev => {
        const m = new Map(prev); m.delete(paper.paper_id)
        localStorage.setItem('ss_saved_map', JSON.stringify([...m.entries()]))
        return m
      })
      await fetch(`/api/user/saved/${existingHash}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    } else {
      const r = await fetch('/api/user/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper }),
      })
      if (r.ok) {
        // 乐观更新（无需重新拉取全量）
        const data = await r.json() as { paper_id_hash?: string }
        const hash = data.paper_id_hash ?? ''
        setSavedMap(prev => {
          const m = new Map(prev); m.set(paper.paper_id, hash)
          localStorage.setItem('ss_saved_map', JSON.stringify([...m.entries()]))
          return m
        })
      }
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setExportStatus('')
    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      const exportPapers = exportOpts.aiOnly ? papers : [...papers, ...rejectedPapers]
      const headers: string[] = ['标题', '作者', '年份', '来源', '引用数', '摘要', '论文链接', 'PDF链接']
      if (exportOpts.translate) headers.splice(1, 0, '中文标题')
      if (exportOpts.aiAnalysis) headers.push('AI相关性分析')

      let chineseTitles: string[] = []
      if (exportOpts.translate && apiKey) {
        setExportStatus(`正在翻译 ${exportPapers.length} 篇标题…`)
        chineseTitles = await translateTitles(exportPapers.map(p => p.title), apiKey)
        setExportStatus('正在生成文件…')
      }

      const rows = exportPapers.map((p, i) => {
        const row = [
          p.title,
          p.authors.join('; '),
          p.published_date?.slice(0, 4) ?? '',
          p.source,
          String(p.citations),
          (p.abstract ?? '').replace(/\n/g, ' '),
          p.url ?? '',
          p.pdf_url ?? '',
        ]
        if (exportOpts.translate) row.splice(1, 0, chineseTitles[i] ?? '')
        if (exportOpts.aiAnalysis) row.push(p.relevance_reason ?? '')
        return row
      })

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\n')

      // 判断是否需要附带对话记录
      const chatsHTML = (exportOpts.chats && getMessages)
        ? generateChatsHTML(exportPapers, getMessages)
        : ''

      if (chatsHTML) {
        // 打包成 ZIP
        const zip = new JSZip()
        zip.file('papers.csv', '﻿' + csvContent)
        zip.file('chats.html', chatsHTML)
        const blob = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `scholarscout-${dateStr}.zip`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        downloadCSV([headers, ...rows], `scholarscout-${dateStr}.csv`)
      }

      setShowExportModal(false)
    } finally {
      setExporting(false)
    }
  }

  // 新搜索完成时重置到筛选后视图
  useEffect(() => {
    setCurrentPage(1)
    setSelectedIds(new Set())
    setAppliedSettings(settings)
    setActiveTab('filtered')
    setCollapsedGroups(new Set())
  }, [papers]) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换 tab 或排序时回到第一页
  useEffect(() => { setCurrentPage(1) }, [sortBy, activeTab])

  const rejectedIds = useMemo(() => new Set(rejectedPapers.map(p => p.paper_id)), [rejectedPapers])

  const activePapers = useMemo(
    () => activeTab === 'filtered' ? papers : [...papers, ...rejectedPapers],
    [activeTab, papers, rejectedPapers]
  )

  // 年份范围：结果变化时重置
  const availableYears = useMemo(() => {
    const years = activePapers
      .map(p => parseInt(p.published_date?.slice(0, 4) ?? ''))
      .filter(y => !isNaN(y) && y > 1900)
    if (years.length === 0) return null
    return { min: Math.min(...years), max: Math.max(...years) }
  }, [activePapers])

  useEffect(() => {
    if (availableYears) {
      setYearFrom(availableYears.min)
      setYearTo(availableYears.max)
    }
  }, [availableYears?.min, availableYears?.max]) // eslint-disable-line react-hooks/exhaustive-deps

  const yearFilteredPapers = useMemo(() => {
    if (!yearFrom && !yearTo) return activePapers
    return activePapers.filter(p => {
      const y = parseInt(p.published_date?.slice(0, 4) ?? '0')
      if (isNaN(y)) return true
      if (yearFrom && y < yearFrom) return false
      if (yearTo && y > yearTo) return false
      return true
    })
  }, [activePapers, yearFrom, yearTo])

  const sortedPapers = useMemo(() => {
    return [...yearFilteredPapers].sort((a, b) => {
      if (sortBy === 'relevance') return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
      if (sortBy === 'citations') return b.citations - a.citations
      const da = a.published_date ?? ''
      const db = b.published_date ?? ''
      return sortBy === 'date_desc' ? db.localeCompare(da) : da.localeCompare(db)
    })
  }, [yearFilteredPapers, sortBy])

  const groupedPapers = useMemo(() => {
    if (viewMode !== 'grouped') return null
    const map = new Map<string, Paper[]>()
    for (const p of sortedPapers) {
      if (!map.has(p.source)) map.set(p.source, [])
      map.get(p.source)!.push(p)
    }
    return map
  }, [viewMode, sortedPapers])

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
    appliedSettings.validatedLimit !== settings.validatedLimit ||
    JSON.stringify([...(appliedSettings.selectedSources ?? [])].sort()) !==
    JSON.stringify([...(settings.selectedSources ?? [])].sort())
  )

  const toggleSource = (source: string) => {
    const cur = settings.selectedSources ?? []
    onSettingsChange({
      selectedSources: cur.includes(source) ? cur.filter(s => s !== source) : [...cur, source]
    })
  }

  const clampNum = (val: number, min: number, max: number) =>
    Math.min(max, Math.max(min, isNaN(val) ? min : val))
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

  const selectedWithPdf = papers.filter(p => selectedIds.has(p.paper_id) && (p.pdf_url || p.url))
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

        const downloadUrl = paper.pdf_url || paper.url || ''
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
          let resp: Response
          try {
            resp = await fetch(getDownloadUrl(downloadUrl, paper.doi, paper.paper_id), { signal: ctrl.signal })
          } finally {
            clearTimeout(timer)
          }
          if (resp.ok) {
            zip.file(filename, await resp.arrayBuffer())
          } else {
            let reason = `HTTP ${resp.status}`
            try { const j = await resp.json(); reason = j.detail ?? reason } catch { /* ignore */ }
            failed.push({ title: paper.title, authors: paper.authors.join('; '), year, url: downloadUrl, reason })
          }
        } catch (err) {
          const reason = (err instanceof Error && err.name === 'AbortError') ? '下载超时（90s）' : '网络错误'
          failed.push({ title: paper.title, authors: paper.authors.join('; '), year, url: downloadUrl, reason })
        } finally {
          completed++
          setDownloadProgress(prev => prev && ({ ...prev, current: completed }))
        }
      }))
    }

    // 失败的论文生成可点击的 HTML 下载页，比 CSV 更易用
    if (failed.length > 0) {
      const cards = failed.map(f => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:12px;background:#fff;">
        <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:4px;">${f.title.replace(/</g,'&lt;')}</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">${f.authors} · ${f.year}</div>
        <div style="font-size:11px;color:#ef4444;margin-bottom:10px;">失败原因：${f.reason}</div>
        <a href="${f.url}" target="_blank" rel="noopener"
           style="display:inline-block;background:#4f46e5;color:#fff;font-size:12px;font-weight:600;
                  padding:6px 16px;border-radius:6px;text-decoration:none;">
          点击下载 PDF →
        </a>
      </div>`).join('')

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>下载失败 - 手动下载链接</title></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:700px;margin:32px auto;padding:0 16px;background:#f9fafb;color:#111827;">
  <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color:#4f46e5;margin-top:0;">ScholarScout 手动下载链接</h2>
    <p style="color:#6b7280;font-size:13px;">共 <strong>${failed.length}</strong> 篇论文因来源网站访问限制无法自动下载。<br>
       点击下方各论文的「点击下载 PDF」按钮，即可从原始来源直接获取。</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
    ${cards}
    <p style="font-size:12px;color:#9ca3af;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px;">
      如仍无法下载，可尝试谷歌学术 · Sci-Hub · ResearchGate 等平台获取全文。
    </p>
  </div>
</body>
</html>`
      zip.file('手动下载链接.html', html)

      // 同时保留 CSV 供程序处理或批量复制链接
      const csvRows = [
        ['标题', '作者', '年份', 'PDF直链（复制到浏览器可直接下载）', '失败原因'],
        ...failed.map(f => [f.title, f.authors, f.year, f.url, f.reason]),
      ].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
      zip.file('failed_downloads.csv', '﻿' + csvRows)
    }

    const successCount = selectedWithPdf.length - failed.length
    const doneStatus = failed.length > 0
      ? `${successCount} 篇成功，${failed.length} 篇失败（查看压缩包内「手动下载链接.html」）`
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
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* 顶部标题栏 */}
      <div className="px-5 py-3 border-b border-gray-200/80 bg-white/70 backdrop-blur-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 rounded-full bg-gray-300" />
            <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">搜索结果</h2>
          </div>
          {/* 搜索摘要统计 */}
          {!isLoading && papers.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              {Object.keys(sourceStatuses).length > 0 && (
                <>
                  <span className="font-medium text-gray-500">
                    {Object.values(sourceStatuses).filter(s => s.count > 0).length} 个来源
                  </span>
                  <span className="text-gray-200">·</span>
                </>
              )}
              <span className="text-gray-500">
                共 <span className="font-semibold text-gray-700">{papers.length + rejectedPapers.length}</span> 篇
              </span>
              {rejectedPapers.length > 0 && (
                <>
                  <span className="text-gray-200">·</span>
                  <span className="text-gray-500">
                    AI 筛选 <span className="font-semibold text-indigo-600">{papers.length}</span> 篇相关
                  </span>
                </>
              )}
            </div>
          )}
          {isLoading && Object.keys(sourceStatuses).length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <div className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin flex-shrink-0" />
              <span>
                {Object.values(sourceStatuses).filter(s => s.status === 'done').length}
                &nbsp;/&nbsp;{Object.keys(sourceStatuses).length} 个来源完成
              </span>
            </div>
          )}
        </div>

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

            {selectedIds.size >= 2 && (
              <button
                onClick={() => setShowCompare(true)}
                className="flex items-center gap-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-2.5 py-1 transition-all shadow-sm"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI 多论文分析
                <span className="bg-white/20 rounded px-1 text-[10px]">{selectedIds.size}</span>
              </button>
            )}
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
              onClick={() => setShowExportModal(true)}
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
        <div className="px-5 py-2.5 bg-white border-b border-gray-100 flex items-center gap-2 justify-between">
          {/* 左侧：标签 + chips + 添加输入 + 重搜按钮 */}
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <span className="text-sm font-medium text-gray-400 shrink-0">搜索词</span>
            {editKeywords.map((kw, i) => (
              <span
                key={i}
                className="flex items-center gap-1 bg-indigo-600 text-white text-xs rounded-full px-2.5 py-1 font-medium shadow-sm"
              >
                {kw}
                <button
                  onClick={() => setEditKeywords(prev => prev.filter((_, j) => j !== i))}
                  className="text-indigo-200 hover:text-white transition-colors leading-none ml-0.5"
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
              className="text-xs border border-dashed border-gray-300 rounded-full px-2.5 py-1 outline-none focus:border-indigo-400 bg-transparent text-gray-500 placeholder-gray-300 w-20"
            />
            {keywordsChanged && onReSearch && (
              <button
                onClick={() => onReSearch(editKeywords)}
                disabled={isLoading || editKeywords.length === 0}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full px-3 py-1 transition-all shadow-sm"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                重新搜索
              </button>
            )}
          </div>

          {/* 右侧：日期范围 + 订阅按钮 */}
          <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
            {searchDateRange && (
              <span className="text-[11px] text-gray-400 tabular-nums">
                {searchDateRange.from?.slice(0, 4) ?? '…'}–{searchDateRange.to?.slice(0, 4) ?? String(new Date().getFullYear())} 年
              </span>
            )}
            <button
              onClick={isLoggedIn ? handleSubscribe : () => setShowAuthModal(true)}
              disabled={subLoading || isSubscribed}
              title={isSubscribed ? '已订阅，可在订阅管理中查看' : '订阅后每天 08:00（北京时间）收到新论文邮件'}
              className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-1.5 transition-all ${
                isSubscribed
                  ? 'bg-green-50 text-green-700 border border-green-200 cursor-default'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-indigo-200/60 active:scale-95'
              } ${subLoading ? 'opacity-60' : ''}`}
            >
              {subLoading ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : isSubscribed ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              )}
              {isSubscribed ? '已订阅' : '订阅更新'}
            </button>
            {isSubscribed ? (
              <span className="text-[10px] text-green-600">每日 08:00 推送 · 可随时取消</span>
            ) : (
              <span className="text-[10px] text-gray-400">每日推送 · 可随时取消</span>
            )}
          </div>
        </div>
      )}

      {/* ── 搜索配置区 ─────────────────────────────────────────────── */}
      <div className="px-5 pt-3 pb-3 bg-white/70 backdrop-blur-sm border-b border-gray-100/80">
        {/* 源选择 */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-3.5 rounded-full bg-gray-200" />
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">搜索源</span>
            <button
              onClick={() => onSettingsChange({ selectedSources: [...ALL_SOURCES] })}
              className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors ml-1"
            >全选</button>
            <button
              onClick={() => onSettingsChange({ selectedSources: [] })}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >清空</button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_SOURCES.map(source => (
              <label key={source} className="flex items-center gap-1.5 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={(settings.selectedSources ?? ALL_SOURCES).includes(source)}
                  onChange={() => toggleSource(source)}
                  className="w-3.5 h-3.5 rounded accent-indigo-600 cursor-pointer"
                />
                <span className={`text-xs font-medium transition-colors ${
                  (settings.selectedSources ?? ALL_SOURCES).includes(source)
                    ? (SOURCE_COLORS[source] ?? 'text-gray-700')
                    : 'text-gray-300'
                }`}>
                  {source}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 数量参数 + 重搜按钮 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 whitespace-nowrap">每源</label>
            <input
              type="number" min={5} max={200}
              value={settings.limitPerSource}
              onChange={e => onSettingsChange({ limitPerSource: Number(e.target.value) })}
              onBlur={e => onSettingsChange({ limitPerSource: clampNum(Number(e.target.value), 5, 200) })}
              className="w-14 text-xs text-center border border-gray-200 rounded-lg px-1.5 py-1 focus:outline-none focus:border-indigo-400 tabular-nums bg-white"
            />
            <span className="text-xs text-gray-400">篇</span>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 whitespace-nowrap">展示上限</label>
            <input
              type="number" min={5} max={500}
              value={settings.validatedLimit}
              onChange={e => onSettingsChange({ validatedLimit: Number(e.target.value) })}
              onBlur={e => onSettingsChange({ validatedLimit: clampNum(Number(e.target.value), 5, 500) })}
              className="w-16 text-xs text-center border border-gray-200 rounded-lg px-1.5 py-1 focus:outline-none focus:border-indigo-400 tabular-nums bg-white"
            />
            <span className="text-xs text-gray-400">篇</span>
          </div>
          {settingsChanged && onReSearch && (
            <button
              onClick={() => onReSearch(editKeywords)}
              disabled={isLoading || (settings.selectedSources ?? []).length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              重新搜索
            </button>
          )}
          {!settingsChanged && (
            <span className="text-xs text-gray-400">调整参数或勾选源后点击重新搜索</span>
          )}
        </div>
      </div>

      {/* Tab 栏 + 排序（有结果才显示）*/}
      {(papers.length > 0 || rejectedPapers.length > 0) && (
        <div className="px-5 py-0 bg-white border-b border-gray-200 flex items-center justify-between">
          <div className="flex">
            {(['filtered', 'all'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'filtered' ? 'AI 筛选后' : '全部结果'}
                <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 tabular-nums ${
                  activeTab === tab ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'
                }`}>
                  {tab === 'filtered' ? papers.length : papers.length + rejectedPapers.length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {/* 密度切换 */}
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setDensity('compact')}
                title="紧凑模式 — 折叠摘要，每屏显示更多论文"
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${density === 'compact' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600 bg-white'}`}
              >
                紧凑
              </button>
              <button
                onClick={() => setDensity('standard')}
                title="标准模式 — 显示摘要"
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${density === 'standard' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600 bg-white'}`}
              >
                标准
              </button>
            </div>

            {/* 视图切换 */}
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                title="列表视图"
                className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600 bg-white'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('grouped')}
                title="按来源分组"
                className={`p-1.5 transition-colors ${viewMode === 'grouped' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600 bg-white'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </button>
            </div>
            {/* 年份过滤 */}
            {availableYears && (availableYears.max - availableYears.min) >= 1 && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <input
                  type="number"
                  value={yearFrom ?? ''}
                  min={availableYears.min}
                  max={yearTo ?? availableYears.max}
                  onChange={e => setYearFrom(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-center bg-white hover:border-gray-300 transition-colors [appearance:textfield]"
                />
                <span className="text-gray-300">–</span>
                <input
                  type="number"
                  value={yearTo ?? ''}
                  min={yearFrom ?? availableYears.min}
                  max={availableYears.max}
                  onChange={e => setYearTo(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-center bg-white hover:border-gray-300 transition-colors [appearance:textfield]"
                />
                {(yearFrom !== availableYears.min || yearTo !== availableYears.max) && (
                  <button
                    onClick={() => { setYearFrom(availableYears.min); setYearTo(availableYears.max) }}
                    className="text-gray-300 hover:text-gray-500 transition-colors"
                    title="重置年份"
                  >✕</button>
                )}
              </div>
            )}
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
          </div>
        </div>
      )}

      {/* 状态栏 — 有结果后才显示进度（加载中且无结果时进度已在列表区展示） */}
      {statusMessage && papers.length > 0 && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
          <p className="text-xs text-blue-600 break-words leading-relaxed">{statusMessage}</p>
        </div>
      )}

      {/* 论文列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 搜索中：来源进度网格 + 骨架屏 */}
        {isLoading && papers.length === 0 && (
          <div className="space-y-3">
            {Object.keys(sourceStatuses).length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-medium text-gray-500 mb-3">
                  并发搜索中
                  <span className="ml-2 text-gray-300 font-normal">
                    {Object.values(sourceStatuses).filter(s => s.status === 'done').length}
                    &nbsp;/&nbsp;{Object.keys(sourceStatuses).length} 完成
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {Object.entries(sourceStatuses).map(([source, st]) => (
                    <div key={source} className="flex items-center gap-2">
                      {st.status === 'done' ? (
                        <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" />
                      )}
                      <span className={`text-xs font-medium truncate ${SOURCE_COLORS[source] ?? 'text-gray-500'}`}>
                        {source}
                      </span>
                      {st.status === 'done' && (
                        <span className="text-xs text-gray-500 ml-auto tabular-nums flex-shrink-0">
                          {st.count}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : statusMessage ? (
              <div className="flex items-center gap-2 px-1 pb-1">
                <div className="w-4 h-4 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin flex-shrink-0" />
                <p className="text-sm text-gray-600">{statusMessage}</p>
              </div>
            ) : null}
            {Array.from({ length: 4 }).map((_, i) => (
              <PaperCardSkeleton key={i} index={i} />
            ))}
          </div>
        )}

        {/* 空状态：示例查询可点击 */}
        {!isLoading && papers.length === 0 && rejectedPapers.length === 0 && !hasSearchError && !statusMessage && (
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
              <p className="text-xs text-gray-400 mb-1">点击示例快速开始 ↓</p>
              {[
                '找 2023 年后关于大模型幻觉问题的论文',
                'diffusion model 在医学图像的应用综述',
                '图神经网络用于药物发现的最新进展',
              ].map(example => (
                <button
                  key={example}
                  onClick={() => onExampleSearch?.(example)}
                  className="text-sm text-gray-500 hover:text-blue-600 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg px-3 py-2.5 text-left transition-all"
                >
                  "{example}"
                </button>
              ))}
            </div>
          </div>
        )}


        {/* AI 筛选后 0 篇引导 */}
        {!isLoading && activeTab === 'filtered' && papers.length === 0 && rejectedPapers.length > 0 && (
          <div className="flex flex-col items-center justify-center min-h-[280px] text-center gap-4 px-8">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">AI 筛选后无相关论文</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                共找到 <span className="font-medium text-gray-600">{rejectedPapers.length}</span> 篇，但均被 AI 判为低相关<br />
                可切换到「全部结果」查看原始结果，或调整关键词重搜
              </p>
            </div>
            <button
              onClick={() => setActiveTab('all')}
              className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl px-4 py-2 transition-colors"
            >
              查看全部 {rejectedPapers.length} 篇
            </button>
          </div>
        )}

        {/* 搜索出错 — 重试 */}
        {hasSearchError && !isLoading && papers.length === 0 && confirmedKeywords != null && (
          <div className="flex flex-col items-center justify-center min-h-[280px] text-center gap-4 px-8">
            <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">搜索遇到问题</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                可能是网络波动或服务暂时不可用<br />
                请检查 API Key 是否正确，或稍后点击重试
              </p>
            </div>
            {onReSearch && (
              <button
                onClick={() => onReSearch(editKeywords)}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl px-4 py-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                重新搜索
              </button>
            )}
          </div>
        )}

        {viewMode === 'grouped' && groupedPapers ? (
          Array.from(groupedPapers.entries()).map(([source, sourcePapers]) => {
            const isCollapsed = collapsedGroups.has(source)
            const toggleCollapse = () => setCollapsedGroups(prev => {
              const next = new Set(prev)
              next.has(source) ? next.delete(source) : next.add(source)
              return next
            })
            return (
              <div key={source}>
                {/* 分组标题 — 可折叠 */}
                <button
                  onClick={toggleCollapse}
                  className="w-full flex items-center gap-3 px-3 py-3 mt-3 first:mt-0 rounded-xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all group"
                >
                  <span className={`text-base font-bold ${SOURCE_COLORS[source] ?? 'text-gray-700'}`}>
                    {source}
                  </span>
                  <span className={`text-sm font-medium px-2 py-0.5 rounded-full tabular-nums ${
                    SOURCE_COLORS[source]
                      ? `bg-gray-100 text-gray-500`
                      : 'bg-gray-100 text-gray-400'
                  }`}>
                    {sourcePapers.length} 篇
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 分组内论文列表 */}
                {!isCollapsed && (
                  <div className="mt-2 space-y-3">
                    {sourcePapers.map((paper, idx) => (
                      <div key={paper.paper_id} className="card-enter" style={{ animationDelay: `${idx * 55}ms` }}>
                        <PaperCard
                          paper={paper}
                          selected={selectedIds.has(paper.paper_id)}
                          onToggle={activeTab === 'filtered' || !rejectedIds.has(paper.paper_id) ? () => togglePaper(paper.paper_id) : undefined}
                          isRejected={rejectedIds.has(paper.paper_id)}
                          onAnalyze={onAnalyzePaper ? () => onAnalyzePaper(paper) : undefined}
                          compact={density === 'compact'}
                          isSaved={savedMap.has(paper.paper_id)}
                          onSave={() => isLoggedIn ? handleSave(paper) : setShowAuthModal(true)}
                          hasChat={!!getMessages && getMessages(paper.paper_id).filter(m => !m.isStreaming).length > 0}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <>
            {pagePapers.map((paper, idx) => (
              <div key={paper.paper_id} className="card-enter" style={{ animationDelay: `${idx * 55}ms` }}>
                <PaperCard
                  paper={paper}
                  selected={selectedIds.has(paper.paper_id)}
                  onToggle={activeTab === 'filtered' || !rejectedIds.has(paper.paper_id) ? () => togglePaper(paper.paper_id) : undefined}
                  isRejected={rejectedIds.has(paper.paper_id)}
                  onAnalyze={onAnalyzePaper ? () => onAnalyzePaper(paper) : undefined}
                  compact={density === 'compact'}
                  isSaved={savedMap.has(paper.paper_id)}
                  onSave={() => isLoggedIn ? handleSave(paper) : setShowAuthModal(true)}
                  hasChat={!!getMessages && getMessages(paper.paper_id).filter(m => !m.isStreaming).length > 0}
                />
              </div>
            ))}
            <Pagination current={currentPage} total={totalPages} onChange={p => { setCurrentPage(p) }} />
          </>
        )}
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {showCompare && apiKey && (
        <Suspense fallback={null}>
          <ComparePanel
            papers={papers.filter(p => selectedIds.has(p.paper_id))}
            apiKey={apiKey}
            onClose={() => setShowCompare(false)}
            token={token ?? undefined}
            sessionId={sessionId}
          />
        </Suspense>
      )}

      {/* 导出 CSV 选项弹窗 */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !exporting && setShowExportModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-80 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">导出 CSV 选项</h3>
            <p className="text-xs text-gray-400 mb-4">
              将导出{' '}
              <span className="font-medium text-gray-600">
                {exportOpts.aiOnly ? papers.length : papers.length + rejectedPapers.length}
              </span>{' '}
              篇论文
            </p>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={exportOpts.aiOnly}
                  onChange={e => setExportOpts(o => ({ ...o, aiOnly: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 rounded accent-blue-600 cursor-pointer"
                />
                <div>
                  <p className="text-sm text-gray-700 group-hover:text-gray-900">仅导出 AI 筛选后的论文</p>
                  <p className="text-xs text-gray-400">
                    {papers.length} 篇相关 / 共 {papers.length + rejectedPapers.length} 篇；取消勾选则导出全部
                  </p>
                </div>
              </label>

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={exportOpts.aiAnalysis}
                    onChange={e => setExportOpts(o => ({ ...o, aiAnalysis: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 rounded accent-blue-600 cursor-pointer"
                  />
                  <div>
                    <p className="text-sm text-gray-700 group-hover:text-gray-900">包含 AI 相关性分析</p>
                    <p className="text-xs text-gray-400">每篇论文的 AI 解读说明</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={exportOpts.translate}
                    onChange={e => setExportOpts(o => ({ ...o, translate: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 rounded accent-blue-600 cursor-pointer"
                  />
                  <div>
                    <p className="text-sm text-gray-700 group-hover:text-gray-900">翻译标题为中文</p>
                    <p className="text-xs text-gray-400">AI 批量翻译，导出会稍慢</p>
                  </div>
                </label>

                {getMessages && (
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={exportOpts.chats}
                      onChange={e => setExportOpts(o => ({ ...o, chats: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded accent-blue-600 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm text-gray-700 group-hover:text-gray-900">包含 AI 对话记录</p>
                      <p className="text-xs text-gray-400">有对话的论文附带 chats.html，打包为 ZIP</p>
                    </div>
                  </label>
                )}
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowExportModal(false)}
                disabled={exporting}
                className="flex-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl py-2 transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex-1 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl py-2 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {exporting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    <span className="truncate">{exportStatus || '处理中…'}</span>
                  </>
                ) : '确认导出'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 订阅成功 Modal */}
      {showSubModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowSubModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-[340px] p-6 mx-4"
            onClick={e => e.stopPropagation()}
          >
            {/* 顶部图标 + 标题 */}
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900">订阅成功</h3>
              <p className="text-xs text-gray-500 mt-1">你将收到包含以下关键词的最新论文推送</p>
            </div>

            {/* 关键词 chips */}
            <div className="flex flex-wrap gap-1.5 justify-center mb-5">
              {subModalKeywords.map(kw => (
                <span
                  key={kw}
                  className="bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full border border-indigo-100"
                >
                  {kw}
                </span>
              ))}
            </div>

            {/* 推送详情 */}
            <div className="bg-gray-50 rounded-xl p-3.5 space-y-2.5 mb-5">
              <div className="flex items-center gap-2.5 text-xs text-gray-600">
                <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>每天 <strong>08:00</strong>（北京时间）发送</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-gray-600">
                <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">发送至 <strong>{user?.email ?? '你的邮箱'}</strong></span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-gray-600">
                <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>随时可在「订阅管理」中取消</span>
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowSubModal(false)}
                className="flex-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl py-2 transition-colors"
              >
                知道了
              </button>
              <button
                onClick={() => {
                  setShowSubModal(false)
                  window.dispatchEvent(new CustomEvent('navigate:page', { detail: { page: 'subscriptions', expandId: newSubId } }))
                }}
                className="flex-1 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl py-2 transition-colors"
              >
                查看订阅管理
              </button>
            </div>
          </div>
        </div>
      )}

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
