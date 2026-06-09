import { useEffect, useState } from 'react'
import { KeySetupScreen } from './components/KeySetupScreen'
import { MainLayout } from './components/MainLayout'
import { useApiKey } from './hooks/useApiKey'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { toast } from './components/Toast'

function AppInner() {
  const { apiKey, setApiKey, clearApiKey, hasKey } = useApiKey()
  const { isLoggedIn, user, loginWithToken } = useAuth()
  const [guestMode, setGuestMode] = useState(false)

  // 邮箱验证回调：URL 含 ?verify=<token> 时自动完成验证并登录
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verify')
    if (!verifyToken) return

    // 立刻清掉 URL 中的 token（不可重放）
    window.history.replaceState({}, '', '/')

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
      .then(r => r.json())
      .then(data => {
        if (data.access_token) {
          return loginWithToken(data.access_token).then(() => {
            const n = data.free_searches as number
            const msg = n > 0 ? `已获得 ${n} 次免费搜索，开始探索吧！` : '验证成功，请配置 API Key 开始使用'
            toast.show(`✅ 邮箱验证成功！${msg}`)
          })
        }
        toast.show(`验证失败：${data.detail || '链接无效或已过期'}`)
      })
      .catch(() => toast.show('验证请求失败，请重试'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 试用模式：已登录 + 有免费额度 → 无需 API Key 也能进入
  const hasTrial = isLoggedIn && (user?.freeSearches ?? 0) > 0
  const canEnter = hasKey || hasTrial || guestMode

  const handleClearKey = () => {
    clearApiKey()
    setGuestMode(false)
  }

  return canEnter
    ? <MainLayout apiKey={apiKey} onClearKey={handleClearKey} />
    : <KeySetupScreen onKeySubmit={setApiKey} onGuestEnter={() => setGuestMode(true)} />
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
