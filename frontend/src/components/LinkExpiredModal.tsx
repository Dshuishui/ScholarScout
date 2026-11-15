import { useState } from 'react'

interface Props {
  kind: 'verify' | 'reset'
  /** 后端给的原因，如"验证链接已过期，请重新申请" */
  reason: string
  onClose: () => void
  onLogin: () => void
}

/** 邮件里的验证或重置链接失效时用：以前只闪一下提示"请重新申请"，却不说去哪申请 */
export function LinkExpiredModal({ kind, reason, onClose, onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const isVerify = kind === 'verify'

  const resend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setResult(null)
    try {
      const r = await fetch(isVerify ? '/api/auth/resend-verification' : '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await r.json().catch(() => ({}))
      const detail = typeof data.detail === 'string' ? data.detail : ''
      setResult(r.ok
        ? { ok: true, text: data.message || '已重新发送，请查收邮箱（也看看垃圾邮件）' }
        : { ok: false, text: detail || '发送没有成功，请稍后再试' })
    } catch {
      setResult({ ok: false, text: '网络连接失败，请检查网络后重试' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-6 sm:p-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800">{isVerify ? '验证链接用不了了' : '重置密码的链接用不了了'}</h3>
          <button onClick={onClose} aria-label="关闭" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed mb-1">{reason}</p>
        <p className="text-xs text-gray-400 leading-relaxed mb-4">
          {isVerify
            ? '链接 24 小时内有效，只能用一次。已经验证过的话直接登录即可；还没验证的话，填上注册邮箱，我们重新发一封。'
            : '链接 1 小时内有效，只能用一次。填上注册邮箱，我们重新发一封重置邮件。'}
        </p>
        <form onSubmit={resend} className="flex flex-col gap-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="注册邮箱"
            value={email}
            onChange={e => { setEmail(e.target.value); setResult(null) }}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {result && (
            <p className={`text-xs rounded-lg px-3 py-2 ${result.ok ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>{result.text}</p>
          )}
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
          >
            {sending ? '发送中…' : isVerify ? '重新发送验证邮件' : '重新发送重置邮件'}
          </button>
        </form>
        <button onClick={onLogin} className="w-full mt-3 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg py-2.5 transition-colors">
          {isVerify ? '已经验证过了，去登录' : '想起密码了，去登录'}
        </button>
      </div>
    </div>
  )
}
