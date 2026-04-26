import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { useSearch } from '../hooks/useSearch'
import { useSettings } from '../hooks/useSettings'

interface Props {
  apiKey: string
  onClearKey: () => void
}

export function MainLayout({ apiKey, onClearKey }: Props) {
  const { settings, updateSettings } = useSettings()
  const {
    messages, papers, isLoading, statusMessage,
    search, pendingKeywords, confirmSearch, cancelSearch, reSearch,
  } = useSearch(apiKey, settings)

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
        />
      </div>
      <div className="flex-1 min-w-0 relative">
        <ResultsPanel
          papers={papers}
          isLoading={isLoading}
          statusMessage={statusMessage}
          settings={settings}
          onSettingsChange={updateSettings}
          onReSearch={reSearch}
        />
      </div>
    </div>
  )
}
