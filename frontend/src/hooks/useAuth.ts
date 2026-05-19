import { useState, useCallback, createContext, useContext, createElement } from 'react'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'scholarscout_token'
const USER_KEY = 'scholarscout_user'

export interface AuthUser {
  id: number
  email: string
}

async function apiFetch(path: string, body: object): Promise<{ access_token?: string; detail?: string }> {
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
  register: (email: string, password: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  sessionExpired: () => void  // 401 时调用：清除 token + 触发 toast
}

const AuthContext = createContext<AuthContextValue | null>(null)

function useAuthState(): AuthContextValue {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  const _persist = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(STORAGE_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(t)
    setUser(u)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const data = await apiFetch('/register', { email, password })
    const me = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then(r => r.json())
    _persist(data.access_token!, me)
  }, [_persist])

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch('/login', { email, password })
    const me = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then(r => r.json())
    _persist(data.access_token!, me)
  }, [_persist])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem('ss_saved_map')
    setToken(null)
    setUser(null)
  }, [])

  const sessionExpired = useCallback(() => {
    logout()
    // 用 CustomEvent 通知 Toast 层，避免循环依赖
    window.dispatchEvent(new CustomEvent('auth:expired'))
  }, [logout])

  return { user, token, register, login, logout, sessionExpired, isLoggedIn: !!user }
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
