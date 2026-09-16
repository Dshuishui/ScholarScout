import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import type { Paper } from '../types'
import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { ToastContainer, toast } from './Toast'
import { useSearch } from '../hooks/useSearch'
import { useSettings } from '../hooks/useSettings'
import { usePaperChat } from '../hooks/usePaperChat'
import { useModel } from '../hooks/useModel'
import { useAuth } from '../hooks/useAuth'
import { useWebSocket } from '../hooks/useWebSocket'
import { useIsMobile } from '../hooks/useIsMobile'
import { useAccess } from '../hooks/useAccess'
import { useBackToClose } from '../hooks/useBackToClose'
import { track } from '../lib/analytics'
import { UserMenu } from './UserMenu'
// 二级页面只在打开时加载，首屏只下载搜索页需要的代码
const SavedPage = lazy(() => import('../pages/SavedPage').then(m => ({ default: m.SavedPage })))
const HistoryPage = lazy(() => import('../pages/HistoryPage').then(m => ({ default: m.HistoryPage })))
const SessionsPage = lazy(() => import('../pages/SessionsPage').then(m => ({ default: m.SessionsPage })))
const SemanticSearchPanel = lazy(() => import('./SemanticSearchPanel').then(m => ({ default: m.SemanticSearchPanel })))
const RagChatPanel = lazy(() => import('./RagChatPanel').then(m => ({ default: m.RagChatPanel })))
// react-force-graph-2d 体积较大，仅在打开关系图谱时才加载，避免拖慢首屏
const PaperGraphPanel = lazy(() => import('./PaperGraphPanel').then(m => ({ default: m.PaperGraphPanel })))
const SubscriptionsPage = lazy(() => import('../pages/SubscriptionsPage').then(m => ({ default: m.SubscriptionsPage })))
import { FeedbackWidget } from './FeedbackWidget'
import { RedPandaWidget } from './RedPandaWidget'

const PaperChatDrawer = lazy(() => import('./PaperChatDrawer').then(m => ({ default: m.PaperChatDrawer })))

// 与后端 MAX_UPLOAD_BYTES、nginx 里 /api/paper/parse-pdf 的 client_max_body_size 保持一致
const MAX_PDF_UPLOAD_MB = 50

export function MainLayout() {
  const { apiKey, mode, freeRemaining, trial, openGate } = useAccess()
  const { settings, updateSettings, availableSources } = useSettings()
  const { lastMessage, status: wsStatus } = useWebSocket()
  const { model } = useModel()
  const { token, isLoggedIn } = useAuth()
  const isMobile = useIsMobile()
  const [activePage, setActivePage] = useState<'saved' | 'history' | 'subscriptions' | 'sessions' | 'semantic' | null>(null)
  const [ragPapers, setRagPapers] = useState<Paper[] | null>(null)
  const [graphPapers, setGraphPapers] = useState<Paper[] | null>(null)
  const [expandSubId, setExpandSubId] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileTab, setMobileTab] = useState<'search' | 'results'>('search')

  const {
    messages, papers, previewPapers, previewTotal, rejectedPapers, isLoading, statusMessage, sourceStatuses,
    search, confirmedKeywords, reSearch,
    hasSearchError, history, removeHistory, searchFromHistory, searchDateRange,
    currentSessionId, loadSession,
  } = useSearch(apiKey, settings, model)

  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const { getMessages, sendMessage, regenerate, stopStreaming, isStreaming, streamingPaperId, getPdfStatus, setPdfText, setPdfError, removePdf, clearChat } = usePaperChat(apiKey, model)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  // 搜索开始时移动端自动切到结果 tab
  useEffect(() => {
    if (isMobile && isLoading) setMobileTab('results')
  }, [isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // 支持子组件通过 custom event 打开页面（如订阅成功后跳转订阅管理）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const page = typeof detail === 'string' ? detail : detail?.page
      if (page === 'subscriptions' || page === 'saved' || page === 'history' || page === 'sessions') {
        setActivePage(page as 'saved' | 'history' | 'subscriptions' | 'sessions')
        if (page === 'subscriptions' && detail?.expandId) {
          setExpandSubId(detail.expandId)
        }
      }
    }
    window.addEventListener('navigate:page', handler)
    return () => window.removeEventListener('navigate:page', handler)
  }, [])

  // 论文对话有免费额度（后端代付）；多论文分析、多文献问答仍由浏览器直连 DeepSeek，需要自己的 Key
  const freeChatsLeft = trial.chatsRemaining
  const requireKey = (feature: string): boolean => {
    if (apiKey) return true
    if (feature === '论文对话' && freeChatsLeft > 0) return true
    openGate('feature', feature)
    return false
  }

  const handleAnalyzePaper = (paper: Paper) => {
    setActivePaper(prev => {
      if (prev?.paper_id === paper.paper_id) return null
      if (isLoggedIn && token) {
        fetch('/api/user/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ paper }),
        }).catch(() => {})
      }
      return paper
    })
  }

  const handleUploadPdf = async (file: File): Promise<boolean> => {
    if (!activePaper) return false
    const paperId = activePaper.paper_id
    const fail = (reason: string) => {
      toast.show(reason)
      setPdfError(paperId)
      return false
    }
    if (file.size > MAX_PDF_UPLOAD_MB * 1024 * 1024) {
      return fail(`PDF 超过 ${MAX_PDF_UPLOAD_MB}MB，暂不支持上传`)
    }
    const formData = new FormData()
    formData.append('file', file)
    try {
      const r = await fetch('/api/paper/parse-pdf', { method: 'POST', body: formData })
      if (r.status === 413) return fail(`PDF 超过 ${MAX_PDF_UPLOAD_MB}MB，暂不支持上传`)
      if (r.status === 429) return fail('上传太频繁，请稍后再试')
      const data = await r.json()
      if (data.text) {
        setPdfText(activePaper, data.text)
        return true
      }
      if (data.error === 'too_large') return fail(`PDF 超过 ${MAX_PDF_UPLOAD_MB}MB，暂不支持上传`)
      if (data.error === 'extract_failed') return fail('没能从 PDF 中提取到文字，可能是扫描版或图片版 PDF')
      return fail('PDF 解析失败，请尝试其他文件')
    } catch {
      return fail('上传失败，请检查网络后重试')
    }
  }

  // 动态 Tab 标题
  useEffect(() => {
    if (confirmedKeywords && confirmedKeywords.length > 0) {
      document.title = `${confirmedKeywords.slice(0, 2).join(' · ')} — ScholarScout`
    } else {
      document.title = 'ScholarScout — AI 学术论文搜索'
    }
  }, [confirmedKeywords])

  // 监听 token 过期事件
  useEffect(() => {
    const handler = () => toast.show('登录已过期，请重新登录')
    window.addEventListener('auth:expired', handler)
    return () => window.removeEventListener('auth:expired', handler)
  }, [])

  // WebSocket 推送通知
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.event === 'search_indexed') {
      const n = lastMessage.data.count as number
      toast.show(`已索引 ${n} 篇论文到语义库`)
    } else if (lastMessage.event === 'subscription_ready') {
      const added = lastMessage.data.added as number
      const kws = (lastMessage.data.keywords as string[] | undefined)?.join('、') ?? ''
      if (added > 0) {
        toast.show(`订阅「${kws}」已就绪，找到 ${added} 篇论文`)
      }
    }
  }, [lastMessage])

  // 键盘快捷键：/ 聚焦搜索框，Esc 关闭抽屉
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePaper(null)
        return
      }
      const tag = (e.target as HTMLElement).tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        chatInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const isDrawerOpen = activePaper !== null

  // 手机返回手势关闭当前浮层，而不是离开网站
  useBackToClose(activePage !== null, () => { setActivePage(null); setExpandSubId(null) })
  useBackToClose(isDrawerOpen, () => setActivePaper(null))
  useBackToClose(!!ragPapers, () => setRagPapers(null))
  useBackToClose(!!graphPapers, () => setGraphPapers(null))

  return (
    // 100dvh：手机浏览器地址栏收起/展开时高度跟着变，100vh 会让底部标签栏被遮住
    <div className="h-screen flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* 全宽顶部导航栏 */}
      <header
        className="h-11 flex-shrink-0 flex items-center px-4 justify-between z-20 relative"
        style={{
          background: '#080818',
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.07) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          borderBottom: '1px solid rgba(99,102,241,0.18)',
          boxShadow: '0 1px 0 rgba(99,102,241,0.08), inset 0 -1px 0 rgba(0,0,0,0.4)',
        }}
      >
        {/* 顶部辉光 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 40% 120% at 0% 50%, rgba(99,102,241,0.12) 0%, transparent 70%), radial-gradient(ellipse 30% 120% at 100% 50%, rgba(59,130,246,0.1) 0%, transparent 70%)',
          }}
        />

        <div className="relative flex items-center gap-2.5">
          {/* 侧边栏折叠按钮（仅桌面端显示） */}
          {!isMobile && (
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="p-1.5 rounded text-indigo-300/50 hover:text-indigo-200 hover:bg-white/5 transition-colors mr-0.5"
              title={sidebarCollapsed ? '展开搜索面板 (/)' : '折叠搜索面板'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarCollapsed
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                }
              </svg>
            </button>
          )}
          <button
            onClick={() => setActivePage(null)}
            className="flex items-center gap-2 rounded hover:opacity-80 transition-opacity"
            title="ScholarScout"
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(59,130,246,0.9))',
                boxShadow: '0 0 10px rgba(99,102,241,0.5)',
              }}
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white tracking-tight select-none">ScholarScout</span>
          </button>
        </div>

        <div className="relative flex items-center gap-1.5 sm:gap-3">
          {/* WS 连接指示 */}
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
              wsStatus === 'connected' ? 'bg-emerald-400' :
              wsStatus === 'connecting' ? 'bg-amber-400 animate-pulse' :
              'bg-gray-600'
            }`}
            title={wsStatus === 'connected' ? '实时推送已连接' : wsStatus === 'connecting' ? '连接中…' : '推送未连接'}
          />
          <button
            onClick={() => setActivePage('semantic')}
            className="text-xs text-indigo-300/70 hover:text-indigo-200 transition-colors px-2 py-1 rounded hover:bg-white/5 flex items-center gap-1"
            title="语义检索"
            aria-label="语义检索"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="hidden sm:inline">语义检索</span>
          </button>
          <button
            onClick={() => { track('access_chip_click', { mode }); openGate('manual') }}
            className={`text-xs transition-colors px-2 py-1 rounded whitespace-nowrap ${
              mode === 'own_key'
                ? 'text-indigo-300/70 hover:text-indigo-200 hover:bg-white/5'
                : (freeRemaining ?? 0) > 0
                  ? 'text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-300/20'
                  : 'text-white bg-indigo-500/80 hover:bg-indigo-500'
            }`}
            title={mode === 'own_key' ? '管理 DeepSeek API Key' : '免费次数与 API Key'}
          >
            {mode === 'own_key' ? '我的 Key' : (freeRemaining ?? 0) > 0 ? `免费 ${freeRemaining} 次` : '填写 Key'}
          </button>
          <UserMenu onNavigate={setActivePage} />
        </div>
      </header>

      {/* 主内容区 */}
      <div
        className="flex-1 flex overflow-hidden transition-all duration-300"
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(99,102,241,0.05) 0%, transparent 55%), #f7f8fc',
          marginRight: (!isMobile && isDrawerOpen) ? '440px' : '0px',
        }}
      >
        {/* ── 桌面端：可折叠侧边栏 ── */}
        {!isMobile && (
          <div
            className="flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out"
            style={{ width: sidebarCollapsed ? '0px' : '384px' }}
          >
            <div style={{ width: '384px', height: '100%' }}>
              <ChatPanel
                messages={messages}
                isLoading={isLoading}
                onSearch={search}
                history={history}
                onSearchFromHistory={searchFromHistory}
                onRemoveHistory={removeHistory}
                inputRef={chatInputRef}
              />
            </div>
          </div>
        )}

        {/* 桌面端折叠时的展开薄条 */}
        {!isMobile && sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="flex-shrink-0 w-8 flex items-center justify-center bg-white/60 border-r border-indigo-100/60 hover:bg-indigo-50 transition-colors group"
            title="展开搜索面板"
          >
            <svg className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* ── 移动端搜索面板 ── */}
        {isMobile && mobileTab === 'search' && (
          <div className="flex-1 overflow-hidden">
            <ChatPanel
              messages={messages}
              isLoading={isLoading}
              onSearch={search}
              history={history}
              onSearchFromHistory={searchFromHistory}
              onRemoveHistory={removeHistory}
              inputRef={chatInputRef}
            />
          </div>
        )}

        {/* 结果面板（桌面端始终显示，移动端 results tab 时显示） */}
        <div className={`${isMobile ? (mobileTab === 'results' ? 'flex-1 min-w-0' : 'hidden') : 'flex-1 min-w-0'}`}>
          <ResultsPanel
            papers={papers}
            previewPapers={previewPapers}
            previewTotal={previewTotal}
            rejectedPapers={rejectedPapers}
            isLoading={isLoading}
            statusMessage={statusMessage}
            sourceStatuses={sourceStatuses}
            settings={settings}
            availableSources={availableSources}
            onSettingsChange={updateSettings}
            onReSearch={reSearch}
            confirmedKeywords={confirmedKeywords}
            onAnalyzePaper={handleAnalyzePaper}
            onExampleSearch={search}
            apiKey={apiKey}
            getMessages={getMessages}
            hasSearchError={hasSearchError}
            searchDateRange={searchDateRange}
            sessionId={currentSessionId}
            onOpenRag={(selectedPapers) => { if (requireKey('多文献问答')) setRagPapers(selectedPapers) }}
            onOpenGraph={(selectedPapers) => setGraphPapers(selectedPapers)}
            onRequireKey={requireKey}
          />
        </div>
      </div>

      {/* ── 移动端底部 Tab Bar ── */}
      {isMobile && (
        <div className="flex-shrink-0 bg-white border-t border-gray-200 z-20" style={{ height: 'calc(56px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex h-full">
            {/* 搜索 tab */}
            <button
              onClick={() => setMobileTab('search')}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                mobileTab === 'search' ? 'text-indigo-600' : 'text-gray-400'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-[10px] font-medium">搜索</span>
            </button>

            {/* 结果 tab */}
            <button
              onClick={() => setMobileTab('results')}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                mobileTab === 'results' ? 'text-indigo-600' : 'text-gray-400'
              }`}
            >
              <div className="relative">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {/* 加载中小点 */}
                {isLoading && (
                  <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                )}
                {/* 结果数量徽章 */}
                {!isLoading && papers.length > 0 && (
                  <span className="absolute -top-1 -right-1.5 text-[8px] bg-indigo-600 text-white rounded-full min-w-[14px] h-3.5 flex items-center justify-center font-bold px-0.5 tabular-nums">
                    {papers.length > 99 ? '99+' : papers.length}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">结果</span>
            </button>

            {/* 留言 tab：手机上悬浮按钮会挡住搜索框，入口放到这里 */}
            <button
              onClick={() => window.dispatchEvent(new Event('feedback:toggle'))}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-400 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="text-[10px] font-medium">留言</span>
            </button>
          </div>
        </div>
      )}

      {!isMobile && <RedPandaWidget isSearching={isLoading} />}
      <FeedbackWidget isMobileTabBar={isMobile} />
      <ToastContainer />
      <Suspense fallback={null}>
        <PaperChatDrawer
          paper={activePaper}
          messages={activePaper ? getMessages(activePaper.paper_id) : []}
          isStreaming={!!activePaper && streamingPaperId === activePaper.paper_id && isStreaming}
          pdfStatus={activePaper ? getPdfStatus(activePaper.paper_id) : 'idle'}
          onSend={content => { if (activePaper && requireKey('论文对话')) sendMessage(activePaper, content) }}
          onStop={stopStreaming}
          onClose={() => setActivePaper(null)}
          onUploadPdf={handleUploadPdf}
          onRemovePdf={activePaper ? () => removePdf(activePaper) : undefined}
          onNewChat={() => activePaper && clearChat(activePaper, true)}
          onRegenerate={() => { if (activePaper && requireKey('论文对话')) regenerate(activePaper) }}
          isMobile={isMobile}
          freeChatsLeft={apiKey ? undefined : freeChatsLeft}
          onRequireKey={apiKey || freeChatsLeft > 0 ? undefined : () => openGate('feature', '论文对话')}
        />
      </Suspense>
      {activePage === 'saved' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={null}><SavedPage token={token} onClose={() => setActivePage(null)} /></Suspense>
        </div>
      )}
      {activePage === 'history' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={null}><HistoryPage token={token} onClose={() => setActivePage(null)} onOpenChat={handleAnalyzePaper} /></Suspense>
        </div>
      )}
      {activePage === 'sessions' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={null}>
            <SessionsPage
              token={token}
              onClose={() => setActivePage(null)}
              onLoad={session => { loadSession(session); setActivePage(null) }}
            />
          </Suspense>
        </div>
      )}
      {activePage === 'subscriptions' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={null}>
            <SubscriptionsPage token={token} onClose={() => { setActivePage(null); setExpandSubId(null) }} initialExpandId={expandSubId ?? undefined} />
          </Suspense>
        </div>
      )}
      {activePage === 'semantic' && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={null}><SemanticSearchPanel onClose={() => setActivePage(null)} /></Suspense>
        </div>
      )}
      {ragPapers && ragPapers.length > 0 && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={null}>
            <RagChatPanel
              papers={ragPapers}
              apiKey={apiKey}
              model={model}
              onClose={() => setRagPapers(null)}
            />
          </Suspense>
        </div>
      )}
      {graphPapers && graphPapers.length >= 2 && (
        <div className="fixed inset-0 z-40 bg-white">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-gray-400">加载关系图谱…</div>}>
            <PaperGraphPanel papers={graphPapers} onClose={() => setGraphPapers(null)} />
          </Suspense>
        </div>
      )}
    </div>
  )
}
