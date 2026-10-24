import { useState, useCallback } from 'react'
import type { Paper } from '../types'

const STORAGE_KEY = 'scholarscout_search_history'
const MAX_ITEMS = 3

export interface HistoryItem {
  keywords: string[]
  timestamp: number
  /** 上次搜到的结果：点历史记录直接打开，不用重新搜（以前每次都重搜，要等一两分钟、再花一次次数） */
  papers?: Paper[]
}

function persist(items: HistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 存储空间不够时只留关键词，历史记录本身不能丢
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.map(({ keywords, timestamp }) => ({ keywords, timestamp }))))
    } catch { /* localStorage 不可用 */ }
  }
}

const fingerprint = (keywords: string[]) => keywords.join(',')

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
      const deduped = prev.filter(item => fingerprint(item.keywords) !== fingerprint(keywords))
      const next = [{ keywords, timestamp: Date.now() }, ...deduped].slice(0, MAX_ITEMS)
      persist(next)
      return next
    })
  }, [])

  /** 搜索完成后把结果记到对应的历史记录上 */
  const saveResults = useCallback((keywords: string[], papers: Paper[]) => {
    if (papers.length === 0) return
    setHistory(prev => {
      const next = prev.map(item =>
        fingerprint(item.keywords) === fingerprint(keywords) ? { ...item, papers } : item)
      persist(next)
      return next
    })
  }, [])

  const removeHistory = useCallback((timestamp: number) => {
    setHistory(prev => {
      const next = prev.filter(item => item.timestamp !== timestamp)
      persist(next)
      return next
    })
  }, [])

  return { history, addHistory, saveResults, removeHistory }
}
