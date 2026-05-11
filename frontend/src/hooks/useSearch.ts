import { useState } from 'react'
import { parseQuery, searchPapers } from '../api/client'
import type { Message, Paper } from '../types'
import type { SearchSettings } from './useSettings'
import { useSearchHistory } from './useSearchHistory'

const WELCOME: Message = {
  id: '0',
  role: 'assistant',
  content: '您好！请描述您想搜索的论文，例如：\n\n"找2023年后关于大模型幻觉问题的论文"\n"diffusion model 在医学图像生成的应用综述"',
}

interface PendingSearch {
  assistantId: string
  keywords: string[]
  date_from: string | null
  date_to: string | null
  query: string
  history: { role: string; content: string }[]
}

export type SourceStatus = { status: 'pending' | 'done'; count: number }

export function useSearch(apiKey: string, settings: SearchSettings, model?: string) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [papers, setPapers] = useState<Paper[]>([])
  const [rejectedPapers, setRejectedPapers] = useState<Paper[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [pendingSearch, setPendingSearch] = useState<PendingSearch | null>(null)
  const [lastConfirmed, setLastConfirmed] = useState<PendingSearch | null>(null)
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({})
  const { history, addHistory, removeHistory } = useSearchHistory()

  const updateAssistant = (assistantId: string, patch: Partial<Message>) =>
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, ...patch } : m))

  const runSearchStream = async (
    assistantId: string,
    pending: PendingSearch,
    keywords: string[]
  ) => {
    setIsLoading(true)
    setStatusMessage('')
    updateAssistant(assistantId, { content: '正在搜索...', isLoading: true })

    try {
      for await (const event of searchPapers(
        pending.query, apiKey, pending.history, settings,
        { keywords, date_from: pending.date_from, date_to: pending.date_to },
        model
      )) {
        if (event.type === 'search_start') {
          // 真正开始搜索时才清空上一次结果
          setPapers([])
          setRejectedPapers([])
          setSourceStatuses({})
          const init: Record<string, SourceStatus> = {}
          event.sources.forEach(s => { init[s] = { status: 'pending', count: 0 } })
          setSourceStatuses(init)
        } else if (event.type === 'source_done') {
          setSourceStatuses(prev => ({
            ...prev,
            [event.source]: { status: 'done', count: event.count },
          }))
        } else if (event.type === 'progress') {
          setStatusMessage(event.message)
          updateAssistant(assistantId, { content: event.message })
        } else if (event.type === 'done') {
          setPapers(event.papers)
          setRejectedPapers(event.rejected_papers ?? [])
          setStatusMessage(event.message)
          setIsLoading(false)  // 主搜索完成，立即释放输入框
          updateAssistant(assistantId, { content: event.message, isLoading: false, papers: event.papers })
        } else if (event.type === 'pdf_finding') {
          setStatusMessage(event.message)
        } else if (event.type === 'pdf_update') {
          const updateMap = new Map(event.updates.map(u => [u.paper_id, u]))
          setPapers(prev => prev.map(p => {
            const u = updateMap.get(p.paper_id)
            if (!u) return p
            return {
              ...p,
              pdf_url: u.pdf_url ?? p.pdf_url ?? undefined,
              fallback_links: u.fallback_links.length > 0 ? u.fallback_links : p.fallback_links,
            }
          }))
          setStatusMessage(event.message)
        } else if (event.type === 'error') {
          setStatusMessage('')
          updateAssistant(assistantId, { content: `出错了：${event.message}`, isLoading: false })
        }
      }
    } catch {
      updateAssistant(assistantId, { content: '网络错误，请稍后重试', isLoading: false })
    } finally {
      setIsLoading(false)
    }
  }

  const search = async (query: string) => {
    const userMsgId = Date.now().toString()
    const assistantId = (Date.now() + 1).toString()

    setPendingSearch(null)
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: query },
      { id: assistantId, role: 'assistant', content: '正在理解您的需求...', isLoading: true },
    ])
    setStatusMessage('')

    try {
      const history = messages
        .filter(m => m.id !== '0' && !m.isLoading && m.content)
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))

      const result = await parseQuery(query, apiKey, history, model)

      if (result.intent === 'chat') {
        updateAssistant(assistantId, { content: result.reply, isLoading: false })
        setIsLoading(false)
      } else {
        const kwPreview = result.keywords.join('、')
        updateAssistant(assistantId, {
          content: `已提取关键词：**${kwPreview}**\n\n请在下方确认或编辑关键词后开始搜索。`,
          isLoading: false,
        })
        setPendingSearch({
          assistantId,
          keywords: result.keywords,
          date_from: result.date_from,
          date_to: result.date_to,
          query,
          history,
        })
        setIsLoading(false)
      }
    } catch {
      updateAssistant(assistantId, {
        content: '网络错误，请检查 Key 是否正确或稍后重试',
        isLoading: false,
      })
      setIsLoading(false)
    }
  }

  const confirmSearch = async (keywords: string[]) => {
    if (!pendingSearch) return
    const snapshot = pendingSearch
    setPendingSearch(null)
    setLastConfirmed({ ...snapshot, keywords })
    addHistory(keywords)
    await runSearchStream(snapshot.assistantId, snapshot, keywords)
  }

  const cancelSearch = () => {
    if (!pendingSearch) return
    const { assistantId } = pendingSearch
    setPendingSearch(null)
    updateAssistant(assistantId, { content: '搜索已取消。', isLoading: false })
    setIsLoading(false)
  }

  const reSearch = async (keywords: string[]) => {
    if (!lastConfirmed) return
    const newConfirmed = { ...lastConfirmed, keywords }
    setLastConfirmed(newConfirmed)

    const assistantId = Date.now().toString()
    const userMsgId = (Date.now() - 1).toString()
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: `重新搜索：${keywords.join('、')}` },
      { id: assistantId, role: 'assistant', content: '', isLoading: true },
    ])
    await runSearchStream(assistantId, newConfirmed, keywords)
  }

  const searchFromHistory = async (keywords: string[]) => {
    const assistantId = Date.now().toString()
    const userMsgId = (Date.now() - 1).toString()
    const query = keywords.join(' ')
    const confirmed: PendingSearch = {
      assistantId,
      keywords,
      date_from: null,
      date_to: null,
      query,
      history: [],
    }
    setLastConfirmed(confirmed)
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: `历史搜索：${keywords.join('、')}` },
      { id: assistantId, role: 'assistant', content: '', isLoading: true },
    ])
    await runSearchStream(assistantId, confirmed, keywords)
  }

  return {
    messages,
    papers,
    rejectedPapers,
    isLoading,
    statusMessage,
    sourceStatuses,
    search,
    pendingKeywords: pendingSearch?.keywords ?? null,
    confirmedKeywords: lastConfirmed?.keywords ?? null,
    confirmSearch,
    cancelSearch,
    reSearch: lastConfirmed ? reSearch : undefined,
    history,
    removeHistory,
    searchFromHistory,
  }
}
