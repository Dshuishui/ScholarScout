import { useState, useCallback } from 'react'

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

export function useAuth() {
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
    setToken(null)
    setUser(null)
  }, [])

  return { user, token, register, login, logout, isLoggedIn: !!user }
}
