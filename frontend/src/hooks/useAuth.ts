import { useState, useCallback, createContext, useContext, createElement } from 'react'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'scholarscout_token'
const USER_KEY = 'scholarscout_user'

export interface AuthUser {
  id: number
  email: string
  freeSearches: number
}

async function apiFetch(path: string, body: object): Promise<Record<string, unknown>> {
  const r = await fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.detail || '请求失败')
  return data
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  isLoggedIn: boolean
  /** 注册：发验证邮件，不自动登录，返回成功提示文本 */
  register: (email: string, password: string) => Promise<string>
  login: (email: string, password: string) => Promise<void>
  /** 用已知 JWT 直接登录（邮箱验证回调用） */
  loginWithToken: (token: string) => Promise<void>
  logout: () => void
  sessionExpired: () => void
  resendVerification: (email: string) => Promise<string>
  /** 搜索成功后刷新 freeSearches 计数 */
  refreshCredits: () => Promise<void>
  /** 本地乐观扣减，无需网络 */
  decrementFreeSearches: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  const _persist = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(STORAGE_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(t)
    setUser(u)
  }, [])

  const _fetchMe = useCallback(async (t: string): Promise<AuthUser> => {
    const me = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${t}` },
    }).then(r => r.json())
    return {
      id: me.id,
      email: me.email,
      freeSearches: me.free_searches ?? 0,
    }
  }, [])

  const register = useCallback(async (email: string, password: string): Promise<string> => {
    const data = await apiFetch('/register', { email, password })
    return (data.message as string) || '验证邮件已发送，请查收'
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch('/login', { email, password })
    const me = await _fetchMe(data.access_token as string)
    _persist(data.access_token as string, me)
  }, [_persist, _fetchMe])

  const loginWithToken = useCallback(async (t: string) => {
    const me = await _fetchMe(t)
    _persist(t, me)
  }, [_persist, _fetchMe])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem('ss_saved_map')
    setToken(null)
    setUser(null)
  }, [])

  const sessionExpired = useCallback(() => {
    logout()
    window.dispatchEvent(new CustomEvent('auth:expired'))
  }, [logout])

  const resendVerification = useCallback(async (email: string): Promise<string> => {
    const data = await apiFetch('/resend-verification', { email })
    return (data.message as string) || '验证邮件已重新发送'
  }, [])

  const refreshCredits = useCallback(async () => {
    if (!token) return
    try {
      const me = await _fetchMe(token)
      setUser(me)
      localStorage.setItem(USER_KEY, JSON.stringify(me))
    } catch { /* ignore */ }
  }, [token, _fetchMe])

  const decrementFreeSearches = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev
      const updated = { ...prev, freeSearches: Math.max(0, prev.freeSearches - 1) }
      localStorage.setItem(USER_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  return {
    user, token, register, login, loginWithToken, logout, sessionExpired,
    resendVerification, refreshCredits, decrementFreeSearches,
    isLoggedIn: !!user,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState()
  return createElement(AuthContext.Provider, { value: auth }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
