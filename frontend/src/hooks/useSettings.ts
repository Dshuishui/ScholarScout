import { useState } from 'react'

export interface SearchSettings {
  limitPerSource: number
  validatedLimit: number
}

const DEFAULT: SearchSettings = {
  limitPerSource: 50,
  validatedLimit: 50,
}

const STORAGE_KEY = 'scholarscout-settings'

export function useSettings() {
  const [settings, setSettings] = useState<SearchSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? { ...DEFAULT, ...JSON.parse(saved) } : DEFAULT
    } catch {
      return DEFAULT
    }
  })

  const updateSettings = (patch: Partial<SearchSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return { settings, updateSettings }
}
