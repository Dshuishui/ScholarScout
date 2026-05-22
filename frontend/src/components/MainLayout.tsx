import { useState, useEffect, useRef } from 'react'
import type { Paper } from '../types'
import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { PaperChatDrawer } from './PaperChatDrawer'
import { ToastContainer, toast } from './Toast'
import { useSearch } from '../hooks/useSearch'
import { useSettings } from '../hooks/useSettings'
import { usePaperChat } from '../hooks/usePaperChat'
import { useModel } from '../hooks/useModel'
import { useAuth } from '../hooks/useAuth'
import { useIsMobile } from '../hooks/useIsMobile'
import { UserMenu } from './UserMenu'
import { SavedPage } from '../pages/SavedPage'
import { HistoryPage } from '../pages/HistoryPage'
import { SubscriptionsPage } from '../pages/SubscriptionsPage'
import { FeedbackWidget } from './FeedbackWidget'
import { RedPandaWidget } from './RedPandaWidget'

interface Props {
  apiKey: string
  onClearKey: () => void
}

export function MainLayout({ apiKey, onClearKey }: Props) {
  const { settings, updateSettings } = useSettings()
  const { model } = useModel()
  const { token, isLoggedIn } = useAuth()
  const isMobile = useIsMobile()
  const [activePage, setActivePage] = useState<'saved' | 'history' | 'subscriptions' | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileTab, setMobileTab] = useState<'search' | 'results'>('search')

  const {
    messages, papers, rejectedPapers, isLoading, statusMessage, sourceStatuses,
    search, confirmedKeywords, reSearch,
    hasSearchError, history, removeHistory, searchFromHistory,
  } = useSearch(apiKey, settings, model)

  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const { getMessages, sendMessage, regenerate, stopStreaming, isStreaming, streamingPaperId, getPdfStatus, setPdfText, setPdfError, removePdf, clearChat } = usePaperChat(apiKey, model)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  // 搜索开始时移动端自动切到结果 tab
  useEffect(() => {
    if (isMobile && isLoading) setMobileTab('results')
  }, [isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const formData = new FormData()
    formData.append('file', file)
    try {
      const r = await fetch('/api/paper/parse-pdf', { method: 'POST', body: formData })
      const data = await r.json()
      if (data.text) {
        setPdfText(activePaper, data.text)
        return true
      }
      setPdfError(paperId)
      return false
    } catch {
      setPdfError(paperId)
      return false
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

  return (
    <div className="h-screen flex flex-col overflow-hidden">
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
        </div>

        <div className="relative flex items-center gap-3">
          <button
            onClick={onClearKey}
            className="text-xs text-indigo-300/70 hover:text-indigo-200 transition-colors px-2 py-1 rounded hover:bg-white/5"
            title="更换 API Key"
          >
            换 Key
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
            <div style={{ width: '384px' }}>
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
            rejectedPapers={rejectedPapers}
            isLoading={isLoading}
            statusMessage={statusMessage}
            sourceStatuses={sourceStatuses}
            settings={settings}
            onSettingsChange={updateSettings}
            onReSearch={reSearch}
            confirmedKeywords={confirmedKeywords}
            onAnalyzePaper={handleAnalyzePaper}
            onExampleSearch={search}
            apiKey={apiKey}
            getMessages={getMessages}
            hasSearchError={hasSearchError}
          />
        </div>
      </div>

      {/* ── 移动端底部 Tab Bar ── */}
      {isMobile && (
        <div className="flex-shrink-0 bg-white border-t border-gray-200 z-20" style={{ height: '56px' }}>
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
          </div>
        </div>
      )}

      <RedPandaWidget isSearching={isLoading} />
      <FeedbackWidget isMobileTabBar={isMobile} />
      <ToastContainer />
      <PaperChatDrawer
        paper={activePaper}
        messages={activePaper ? getMessages(activePaper.paper_id) : []}
        isStreaming={!!activePaper && streamingPaperId === activePaper.paper_id && isStreaming}
        pdfStatus={activePaper ? getPdfStatus(activePaper.paper_id) : 'idle'}
        onSend={content => activePaper && sendMessage(activePaper, content)}
        onStop={stopStreaming}
        onClose={() => setActivePaper(null)}
        onUploadPdf={handleUploadPdf}
        onRemovePdf={activePaper ? () => removePdf(activePaper) : undefined}
        onNewChat={() => activePaper && clearChat(activePaper, true)}
        onRegenerate={() => activePaper && regenerate(activePaper)}
        isMobile={isMobile}
      />
      {activePage === 'saved' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <SavedPage token={token} onClose={() => setActivePage(null)} />
        </div>
      )}
      {activePage === 'history' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <HistoryPage token={token} onClose={() => setActivePage(null)} onOpenChat={handleAnalyzePaper} />
        </div>
      )}
      {activePage === 'subscriptions' && token && (
        <div className="fixed inset-0 z-40 bg-white">
          <SubscriptionsPage token={token} onClose={() => setActivePage(null)} />
        </div>
      )}
    </div>
  )
}
