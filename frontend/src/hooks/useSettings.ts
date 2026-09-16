import { useState, useEffect } from 'react'

// 全部可能的数据源；实际可用的以后端 /api/sources 为准（没配 key 的源永远返回 0 篇，不展示）
export const ALL_SOURCES = [
  'arXiv', 'Semantic Scholar', 'OpenAlex', 'PubMed',
  'Europe PMC', 'INSPIRE-HEP', 'CrossRef', 'CORE', 'NASA ADS', 'Google Scholar',
] as const

export interface SearchSettings {
  limitPerSource: number
  validatedLimit: number
  selectedSources: string[]
}

const DEFAULT: SearchSettings = {
  limitPerSource: 50,
  validatedLimit: 50,
  selectedSources: [...ALL_SOURCES],
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

  const [availableSources, setAvailableSources] = useState<string[]>([...ALL_SOURCES])

  useEffect(() => {
    fetch('/api/sources')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list: string[] | undefined = d?.sources
        if (!list?.length) return
        setAvailableSources(list)
        // 本地存的勾选里可能有已经不可用的源，清掉，否则"已选 N 个"对不上
        setSettings(prev => {
          const kept = prev.selectedSources.filter(s => list.includes(s))
          if (kept.length === prev.selectedSources.length) return prev
          const next = { ...prev, selectedSources: kept.length ? kept : list }
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
          return next
        })
      })
      .catch(() => { /* 取不到就用完整列表，不影响使用 */ })
  }, [])

  const updateSettings = (patch: Partial<SearchSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return { settings, updateSettings, availableSources }
}
