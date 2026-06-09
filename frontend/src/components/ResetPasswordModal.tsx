import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Props {
  token: string
  onClose: () => void
  onSuccess: () => void
}

export function ResetPasswordModal({ token, onClose, onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const { loginWithToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('两次密码不一致'); return }
    if (password.length < 8) { setError('密码至少 8 位'); return }
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.detail || '重置失败，请重试'); return }
      if (data.access_token) await loginWithToken(data.access_token)
      setDone(true)
      setTimeout(onSuccess, 1800)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">密码重置成功</h3>
            <p className="text-sm text-gray-500">已自动登录，正在跳转…</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold text-gray-800">设置新密码</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                ref={inputRef}
                type="password"
                placeholder="新密码（至少 8 位）"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                required
                minLength={8}
                className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                placeholder="确认新密码"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError('') }}
                required
                className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
              >
                {loading ? '提交中…' : '确认重置密码'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
