import { useState } from 'react'
import { parseQuery, searchPapers } from '../api/client'
import type { Message, Paper } from '../types'
import type { SearchSettings } from './useSettings'
import { useSearchHistory } from './useSearchHistory'
import { useAuth } from './useAuth'

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
  const [lastConfirmed, setLastConfirmed] = useState<PendingSearch | null>(null)
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({})
  const [searchDateRange, setSearchDateRange] = useState<{ from: string | null; to: string | null } | null>(null)
  const [hasSearchError, setHasSearchError] = useState(false)
  const { history, addHistory, removeHistory } = useSearchHistory()
  const { token, decrementFreeSearches } = useAuth()
  // 试用模式：apiKey 为空 + 有登录 token
  const isTrial = !apiKey && !!token
  const authToken = isTrial ? (token ?? undefined) : undefined

  const updateAssistant = (assistantId: string, patch: Partial<Message>) =>
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, ...patch } : m))

  const runSearchStream = async (
    assistantId: string,
    pending: PendingSearch,
    keywords: string[]
  ) => {
    setIsLoading(true)
    setStatusMessage('')
    setHasSearchError(false)
    updateAssistant(assistantId, { content: '正在搜索...', isLoading: true })

    try {
      for await (const event of searchPapers(
        pending.query, apiKey, pending.history, settings,
        { keywords, date_from: pending.date_from, date_to: pending.date_to },
        model,
        authToken,
      )) {
        if (event.type === 'search_start') {
          // 真正开始搜索时才清空上一次结果
          setPapers([])
          setRejectedPapers([])
          setSourceStatuses({})
          setSearchDateRange({ from: event.date_from ?? null, to: event.date_to ?? null })
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
          // 试用模式：本地乐观扣减免费次数（后端已原子扣减）
          if (isTrial) decrementFreeSearches()
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
          setHasSearchError(true)
          updateAssistant(assistantId, { content: `出错了：${event.message}`, isLoading: false })
        }
      }
    } catch (err) {
      setHasSearchError(true)
      const msg = err instanceof Error ? err.message : ''
      let errDisplay = '网络错误，请稍后重试'
      if (msg.includes('402') || msg.includes('INSUFFICIENT_BALANCE')) {
        errDisplay = '⚠️ DeepSeek API 余额不足，请前往 platform.deepseek.com 充值'
      } else if (msg.includes('401') || msg.includes('INVALID_KEY')) {
        errDisplay = '⚠️ API Key 无效或已过期，请点击顶栏「换 Key」重新输入'
      }
      updateAssistant(assistantId, { content: errDisplay, isLoading: false })
    } finally {
      setIsLoading(false)
    }
  }

  const search = async (query: string) => {
    const userMsgId = Date.now().toString()
    const assistantId = (Date.now() + 1).toString()

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: query },
      { id: assistantId, role: 'assistant', content: '正在理解您的需求...', isLoading: true },
    ])
    setStatusMessage('')
    setHasSearchError(false)

    try {
      const history = messages
        .filter(m => m.id !== '0' && !m.isLoading && m.content)
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))

      const result = await parseQuery(query, apiKey, history, model, authToken)

      if (result.intent === 'chat') {
        updateAssistant(assistantId, { content: result.reply, isLoading: false })
        setIsLoading(false)
      } else {
        const kwPreview = result.keywords.join('、')
        updateAssistant(assistantId, {
          content: `已提取关键词：**${kwPreview}**\n\n开始搜索...`,
          isLoading: true,
        })
        const confirmed: PendingSearch = {
          assistantId,
          keywords: result.keywords,
          date_from: result.date_from,
          date_to: result.date_to,
          query,
          history,
        }
        setLastConfirmed(confirmed)
        addHistory(result.keywords)
        await runSearchStream(assistantId, confirmed, result.keywords)
      }
    } catch {
      updateAssistant(assistantId, {
        content: '网络错误，请检查 Key 是否正确或稍后重试',
        isLoading: false,
      })
      setIsLoading(false)
    }
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
    searchDateRange,
    search,
    confirmedKeywords: lastConfirmed?.keywords ?? null,
    reSearch: lastConfirmed ? reSearch : undefined,
    hasSearchError,
    history,
    removeHistory,
    searchFromHistory,
  }
}
