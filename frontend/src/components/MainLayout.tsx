import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { useSearch } from '../hooks/useSearch'

interface Props {
  apiKey: string
  onClearKey: () => void
}

export function MainLayout({ apiKey, onClearKey }: Props) {
  const { messages, papers, isLoading, statusMessage, search } = useSearch(apiKey)

  return (
    <div className="h-screen flex overflow-hidden">
      <div className="w-96 flex-shrink-0">
        <ChatPanel
          messages={messages}
          isLoading={isLoading}
          onSearch={search}
          onClearKey={onClearKey}
        />
      </div>
      <div className="flex-1 min-w-0">
        <ResultsPanel
          papers={papers}
          isLoading={isLoading}
          statusMessage={statusMessage}
        />
      </div>
    </div>
  )
}
