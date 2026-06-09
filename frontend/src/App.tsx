import { useEffect, useState } from 'react'
import { KeySetupScreen } from './components/KeySetupScreen'
import { MainLayout } from './components/MainLayout'
import { ResetPasswordModal } from './components/ResetPasswordModal'
import { useApiKey } from './hooks/useApiKey'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { toast } from './components/Toast'

function AppInner() {
  const { apiKey, setApiKey, clearApiKey, hasKey } = useApiKey()
  const { isLoggedIn, user, loginWithToken } = useAuth()
  const [guestMode, setGuestMode] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(null)

  // 邮箱验证回调：URL 含 ?verify=<token> 时自动完成验证并登录
  // 密码重置回调：URL 含 ?reset=<token> 时打开重置密码弹窗
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    const verifyToken = params.get('verify')
    if (verifyToken) {
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
      return
    }

    const rt = params.get('reset')
    if (rt) {
      window.history.replaceState({}, '', '/')
      setResetToken(rt)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 试用模式：已登录 + 有免费额度 → 无需 API Key 也能进入
  const hasTrial = isLoggedIn && (user?.freeSearches ?? 0) > 0
  const canEnter = hasKey || hasTrial || guestMode

  const handleClearKey = () => {
    clearApiKey()
    setGuestMode(false)
  }

  return (
    <>
      {canEnter
        ? <MainLayout apiKey={apiKey} onClearKey={handleClearKey} />
        : <KeySetupScreen onKeySubmit={setApiKey} onGuestEnter={() => setGuestMode(true)} />
      }
      {resetToken && (
        <ResetPasswordModal
          token={resetToken}
          onClose={() => setResetToken(null)}
          onSuccess={() => setResetToken(null)}
        />
      )}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
