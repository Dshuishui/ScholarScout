import { useEffect, useState } from 'react'
import { MainLayout } from './components/MainLayout'
import { ResetPasswordModal } from './components/ResetPasswordModal'
import { AccessModal } from './components/AccessModal'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { AccessProvider } from './hooks/useAccess'
import { toast } from './components/Toast'
import { track } from './lib/analytics'

function AppInner() {
  const { loginWithToken } = useAuth()
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
              track('email_verified')
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

  // 打开网站直接进入搜索页：未登录访客有免费体验次数，用完再引导注册或填 Key
  return (
    <>
      <MainLayout />
      <AccessModal />
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
      <AccessProvider>
        <AppInner />
      </AccessProvider>
    </AuthProvider>
  )
}
