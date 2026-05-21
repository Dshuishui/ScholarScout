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
  const [activePage, setActivePage] = useState<'saved' | 'history' | 'subscriptions' | null>(null)
  const {
    messages, papers, rejectedPapers, isLoading, statusMessage, sourceStatuses,
    search, confirmedKeywords, reSearch,
    hasSearchError, history, removeHistory, searchFromHistory,
  } = useSearch(apiKey, settings, model)

  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const { getMessages, sendMessage, stopStreaming, isStreaming, streamingPaperId, getPdfStatus, setPdfText, setPdfError, clearChat } = usePaperChat(apiKey, model)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

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
        setPdfText(paperId, data.text)
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
        className="flex-1 flex overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(99,102,241,0.05) 0%, transparent 55%), #f7f8fc',
        }}
      >
        <div className="w-96 flex-shrink-0">
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
        <div className="flex-1 min-w-0">
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

      <RedPandaWidget isSearching={isLoading} />
      <FeedbackWidget />
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
        onNewChat={() => activePaper && clearChat(activePaper)}
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
