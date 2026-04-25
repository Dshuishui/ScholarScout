import { KeySetupScreen } from './components/KeySetupScreen'
import { MainLayout } from './components/MainLayout'
import { useApiKey } from './hooks/useApiKey'

export default function App() {
  const { apiKey, setApiKey, clearApiKey, hasKey } = useApiKey()

  if (!hasKey) {
    return <KeySetupScreen onKeySubmit={setApiKey} />
  }

  return <MainLayout apiKey={apiKey} onClearKey={clearApiKey} />
}
