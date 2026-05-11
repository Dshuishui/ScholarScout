import { useState, useEffect, useRef } from 'react'
import type { Paper } from '../types'
import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { PaperChatDrawer } from './PaperChatDrawer'
import { ToastContainer } from './Toast'
import { useSearch } from '../hooks/useSearch'
import { useSettings } from '../hooks/useSettings'
import { usePaperChat } from '../hooks/usePaperChat'
import { useModel } from '../hooks/useModel'
import { useAuth } from '../hooks/useAuth'
import { UserMenu } from './UserMenu'
import { SavedPage } from '../pages/SavedPage'
import { HistoryPage } from '../pages/HistoryPage'
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
  const [activePage, setActivePage] = useState<'saved' | 'history' | null>(null)
  const {
    messages, papers, rejectedPapers, isLoading, statusMessage, sourceStatuses,
    search, pendingKeywords, confirmedKeywords, confirmSearch, cancelSearch, reSearch,
    history, removeHistory, searchFromHistory,
  } = useSearch(apiKey, settings, model)

  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const { getMessages, sendMessage, isStreaming, streamingPaperId } = usePaperChat(apiKey, model)
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

  // 动态 Tab 标题
  useEffect(() => {
    if (confirmedKeywords && confirmedKeywords.length > 0) {
      document.title = `${confirmedKeywords.slice(0, 2).join(' · ')} — ScholarScout`
    } else {
      document.title = 'ScholarScout — AI 学术论文搜索'
    }
  }, [confirmedKeywords])

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
      <header className="h-11 flex-shrink-0 bg-white border-b border-gray-200 flex items-center px-4 justify-between z-20">
        <span className="text-sm font-semibold text-gray-800 tracking-tight select-none">ScholarScout</span>
        <div className="flex items-center gap-3">
          <button
            onClick={onClearKey}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            title="更换 API Key"
          >
            换 Key
          </button>
          <UserMenu onNavigate={setActivePage} />
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-96 flex-shrink-0">
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            onSearch={search}
            onClearKey={onClearKey}
            pendingKeywords={pendingKeywords}
            onConfirmKeywords={confirmSearch}
            onCancelSearch={cancelSearch}
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
        onSend={content => activePaper && sendMessage(activePaper, content)}
        onClose={() => setActivePaper(null)}
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
    </div>
  )
}
