import { useState, useCallback } from 'react'

const STORAGE_KEY = 'scholarscout_search_history'
const MAX_ITEMS = 3

export interface HistoryItem {
  keywords: string[]
  timestamp: number
}

export function useSearchHistory() {
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    } catch {
      return []
    }
  })

  const addHistory = useCallback((keywords: string[]) => {
    if (keywords.length === 0) return
    setHistory(prev => {
      const fingerprint = keywords.join(',')
      const deduped = prev.filter(item => item.keywords.join(',') !== fingerprint)
      const next = [{ keywords, timestamp: Date.now() }, ...deduped].slice(0, MAX_ITEMS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeHistory = useCallback((timestamp: number) => {
    setHistory(prev => {
      const next = prev.filter(item => item.timestamp !== timestamp)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { history, addHistory, removeHistory }
}
