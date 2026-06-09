import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Props {
  onClose: () => void
  defaultTab?: 'login' | 'register'
}

export function AuthModal({ onClose, defaultTab = 'login' }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>(defaultTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 注册成功后的"验证邮件已发送"状态
  const [sentEmail, setSentEmail] = useState<string | null>(null)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMsg, setResendMsg] = useState('')

  const { login, register, resendVerification } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [tab])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (tab === 'register') {
      // 简单检测常见域名拼写错误（如 @qq.cm → @qq.com）
      const domainPart = email.split('@')[1] || ''
      const COMMON_TYPOS: Record<string, string> = {
        'qq.cm': 'qq.com', 'qq.con': 'qq.com', 'q.com': 'qq.com',
        '163.co': '163.com', '126.co': '126.com',
        'gmail.co': 'gmail.com', 'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com',
        'hotmail.co': 'hotmail.com', 'outloo.com': 'outlook.com',
      }
      if (COMMON_TYPOS[domainPart]) {
        setError(`邮箱域名可能有误：@${domainPart} → 是否应为 @${COMMON_TYPOS[domainPart]}？`)
        return
      }
      if (!domainPart.includes('.') || domainPart.endsWith('.')) {
        setError('邮箱格式不正确，请检查后重新输入')
        return
      }
    }

    setLoading(true)
    try {
      if (tab === 'login') {
        await login(email, password)
        onClose()
      } else {
        const msg = await register(email, password)
        setSentEmail(email)
        setResendMsg(msg)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!sentEmail) return
    setResendLoading(true)
    setResendMsg('')
    try {
      const msg = await resendVerification(sentEmail)
      setResendMsg(msg)
    } catch (err: unknown) {
      setResendMsg(err instanceof Error ? err.message : '发送失败，请稍后重试')
    } finally {
      setResendLoading(false)
    }
  }

  // ── 注册成功 → 等待验证 ────────────────────────────────────────────────────
  if (sentEmail) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8" onClick={e => e.stopPropagation()}>
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">验证邮件已发送</h3>
            <p className="text-sm text-gray-500 leading-relaxed mb-1">请查收发送到</p>
            <p className="text-sm font-medium text-indigo-600 mb-3 break-all">{sentEmail}</p>
            <p className="text-xs text-gray-400 leading-relaxed mb-5">
              点击邮件中的链接完成验证，即可获得
              <span className="text-indigo-500 font-medium"> 3 次免费搜索</span>。
              链接 24 小时内有效。
            </p>

            {resendMsg && (
              <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 mb-3">{resendMsg}</p>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleResend}
                disabled={resendLoading}
                className="w-full text-sm text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded-xl py-2.5 transition-colors disabled:opacity-50"
              >
                {resendLoading ? '发送中…' : '重新发送验证邮件'}
              </button>
              <button
                onClick={() => { setSentEmail(null); setTab('login'); setError('') }}
                className="w-full text-sm text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-xl py-2.5 transition-colors"
              >
                已验证，去登录 →
              </button>
              <button
                onClick={onClose}
                className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
              >
                稍后再说
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── 登录 / 注册表单 ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-4">
            <button
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === 'login' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
              onClick={() => { setTab('login'); setError('') }}
            >登录</button>
            <button
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === 'register' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
              onClick={() => { setTab('register'); setError('') }}
            >注册</button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {tab === 'register' && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-4 text-xs text-indigo-700 leading-relaxed">
            ⚡ 注册并验证邮箱后，获得 <strong>3 次免费搜索</strong>，无需配置 API Key 即可体验
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder={tab === 'register' ? '密码（至少 8 位）' : '密码'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={tab === 'register' ? 8 : 1}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && (
            <div className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2">
              <span>{error}</span>
              {error.includes('尚未验证') && (
                <button
                  type="button"
                  className="underline text-red-600 hover:text-red-700 flex-shrink-0"
                  onClick={async () => {
                    if (!email) return
                    setError('')
                    try {
                      const msg = await resendVerification(email)
                      setSentEmail(email)
                      setResendMsg(msg)
                    } catch { setError('发送失败，请稍后重试') }
                  }}
                >重新发送</button>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
          >
            {loading ? '请稍候…' : tab === 'login' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  )
}
