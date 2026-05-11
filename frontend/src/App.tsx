import { KeySetupScreen } from './components/KeySetupScreen'
import { MainLayout } from './components/MainLayout'
import { useApiKey } from './hooks/useApiKey'
import { AuthProvider } from './hooks/useAuth'

export default function App() {
  const { apiKey, setApiKey, clearApiKey, hasKey } = useApiKey()

  return (
    <AuthProvider>
      {!hasKey
        ? <KeySetupScreen onKeySubmit={setApiKey} />
        : <MainLayout apiKey={apiKey} onClearKey={clearApiKey} />
      }
    </AuthProvider>
  )
}
