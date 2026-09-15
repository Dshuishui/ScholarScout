import { useState, useCallback, useEffect, createContext, useContext, createElement } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './useAuth'
import { track } from '../lib/analytics'

// 谁来付 DeepSeek 的钱：用户自己的 Key / 登录用户的免费次数 / 未登录访客的体验次数。
// 这里集中管理三者的状态，以及"次数用完、需要填 Key"时弹出的引导窗口。

const KEY_STORAGE = 'scholarscout_deepseek_key'
const DEVICE_STORAGE = 'scholarscout_device_id'

/** 引导窗口为什么弹出，决定标题文案和主推的选项 */
export type GateReason =
  | 'manual'              // 用户自己点开（顶栏按钮）
  | 'trial_exhausted'     // 未登录体验次数用完
  | 'credits_exhausted'   // 登录账号的免费次数用完
  | 'trial_capacity'      // 今天全站免费名额用完
  | 'key_required'        // 没有任何可用额度
  | 'feature'             // 论文对话等功能需要自己的 Key

export type AccessMode = 'own_key' | 'account_trial' | 'anon_trial'

interface TrialInfo {
  loaded: boolean
  enabled: boolean
  anonRemaining: number
  anonTotal: number
  signupBonus: number
  capacityOk: boolean
}

interface AccessContextValue {
  apiKey: string
  hasKey: boolean
  setApiKey: (key: string) => void
  clearApiKey: () => void
  deviceId: string
  mode: AccessMode
  /** 当前模式下还剩几次免费搜索；自己的 Key 为 null（不限） */
  freeRemaining: number | null
  trial: TrialInfo
  refreshTrial: () => Promise<void>
  /** 搜索流里服务端返回的最新剩余次数 */
  applyRemaining: (kind: 'anon' | 'account', remaining: number) => void
  gate: { reason: GateReason; feature?: string } | null
  openGate: (reason: GateReason, feature?: string) => void
  closeGate: () => void
}

function loadDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE)
    if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return existing
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    localStorage.setItem(DEVICE_STORAGE, id)
    return id
  } catch {
    return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  }
}

const AccessContext = createContext<AccessContextValue | null>(null)

function useAccessState(): AccessContextValue {
  const { token, user, setFreeSearches } = useAuth()
  const [apiKey, setApiKeyState] = useState<string>(() => {
    try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' }
  })
  const [deviceId] = useState(loadDeviceId)
  const [trial, setTrial] = useState<TrialInfo>({
    loaded: false, enabled: true, anonRemaining: 0, anonTotal: 2, signupBonus: 3, capacityOk: true,
  })
  const [gate, setGate] = useState<{ reason: GateReason; feature?: string } | null>(null)

  const setApiKey = useCallback((key: string) => {
    try { localStorage.setItem(KEY_STORAGE, key) } catch { /* ignore */ }
    setApiKeyState(key)
  }, [])

  const clearApiKey = useCallback(() => {
    try { localStorage.removeItem(KEY_STORAGE) } catch { /* ignore */ }
    setApiKeyState('')
  }, [])

  const refreshTrial = useCallback(async () => {
    try {
      const headers: Record<string, string> = { 'X-Trial-Device': deviceId }
      if (token) headers.Authorization = `Bearer ${token}`
      const r = await fetch('/api/trial/status', { headers })
      if (!r.ok) return
      const d = await r.json()
      setTrial({
        loaded: true,
        enabled: !!d.enabled,
        anonRemaining: d.anon_remaining ?? 0,
        anonTotal: d.anon_total ?? 2,
        signupBonus: d.signup_bonus ?? 0,
        capacityOk: d.capacity_ok ?? true,
      })
      if (typeof d.account_remaining === 'number') setFreeSearches(d.account_remaining)
    } catch { /* 网络失败时保持原状，真正搜索时服务端会再判断 */ }
  }, [deviceId, token, setFreeSearches])

  useEffect(() => { refreshTrial() }, [refreshTrial])

  const applyRemaining = useCallback((kind: 'anon' | 'account', remaining: number) => {
    if (kind === 'account') setFreeSearches(remaining)
    else setTrial(t => ({ ...t, anonRemaining: remaining }))
  }, [setFreeSearches])

  const openGate = useCallback((reason: GateReason, feature?: string) => {
    setGate({ reason, feature })
    track('gate_open', feature ? { reason, feature } : { reason })
  }, [])
  const closeGate = useCallback(() => setGate(null), [])

  const hasKey = apiKey.length > 0
  const mode: AccessMode = hasKey ? 'own_key' : token ? 'account_trial' : 'anon_trial'
  const freeRemaining = mode === 'own_key' ? null
    : mode === 'account_trial' ? (user?.freeSearches ?? 0)
    : trial.anonRemaining

  return {
    apiKey, hasKey, setApiKey, clearApiKey, deviceId, mode, freeRemaining,
    trial, refreshTrial, applyRemaining, gate, openGate, closeGate,
  }
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const value = useAccessState()
  return createElement(AccessContext.Provider, { value }, children)
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext)
  if (!ctx) throw new Error('useAccess must be used within AccessProvider')
  return ctx
}
