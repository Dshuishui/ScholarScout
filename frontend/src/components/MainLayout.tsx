import { useState } from 'react'
import type { Paper } from '../types'
import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { PaperChatDrawer } from './PaperChatDrawer'
import { ToastContainer } from './Toast'
import { useSearch } from '../hooks/useSearch'
import { useSettings } from '../hooks/useSettings'
import { usePaperChat } from '../hooks/usePaperChat'

interface Props {
  apiKey: string
  onClearKey: () => void
}

export function MainLayout({ apiKey, onClearKey }: Props) {
  const { settings, updateSettings } = useSettings()
  const {
    messages, papers, rejectedPapers, isLoading, statusMessage,
    search, pendingKeywords, confirmedKeywords, confirmSearch, cancelSearch, reSearch,
    history, removeHistory, searchFromHistory,
  } = useSearch(apiKey, settings)

  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const { getMessages, sendMessage, isStreaming, streamingPaperId } = usePaperChat(apiKey)

  const handleAnalyzePaper = (paper: Paper) => {
    setActivePaper(prev => prev?.paper_id === paper.paper_id ? null : paper)
  }

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
        />
      </div>
      <div className="flex-1 min-w-0 relative">
        <ResultsPanel
          papers={papers}
          rejectedPapers={rejectedPapers}
          isLoading={isLoading}
          statusMessage={statusMessage}
          settings={settings}
          onSettingsChange={updateSettings}
          onReSearch={reSearch}
          confirmedKeywords={confirmedKeywords}
          onAnalyzePaper={handleAnalyzePaper}
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
    </div>
  )
}
