import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Props {
  onClose: () => void
}

export function AuthModal({ onClose }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'login') await login(email, password)
      else await register(email, password)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-4">
            <button
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === 'login' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
              onClick={() => setTab('login')}
            >登录</button>
            <button
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === 'register' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
              onClick={() => setTab('register')}
            >注册</button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

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
          {error && <p className="text-red-500 text-xs">{error}</p>}
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
