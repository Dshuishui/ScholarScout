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
    <div className="h-screen flex overflow-hidden">
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
      <div className="flex-1 min-w-0 relative">
        <div className="absolute top-3 right-4 z-30 flex items-center gap-2">
          <UserMenu onNavigate={setActivePage} />
        </div>
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
          <HistoryPage token={token} onClose={() => setActivePage(null)} />
        </div>
      )}
    </div>
  )
}
