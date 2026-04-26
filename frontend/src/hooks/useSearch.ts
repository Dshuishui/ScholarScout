import { useState } from 'react'
import { parseQuery, searchPapers } from '../api/client'
import type { Message, Paper } from '../types'
import type { SearchSettings } from './useSettings'

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

export function useSearch(apiKey: string, settings: SearchSettings) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [papers, setPapers] = useState<Paper[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [pendingSearch, setPendingSearch] = useState<PendingSearch | null>(null)
  const [lastConfirmed, setLastConfirmed] = useState<PendingSearch | null>(null)

  const updateAssistant = (assistantId: string, patch: Partial<Message>) =>
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, ...patch } : m))

  const runSearchStream = async (
    assistantId: string,
    pending: PendingSearch,
    keywords: string[]
  ) => {
    setIsLoading(true)
    setPapers([])
    setStatusMessage('')
    updateAssistant(assistantId, { content: '正在搜索...', isLoading: true })

    try {
      for await (const event of searchPapers(
        pending.query, apiKey, pending.history, settings,
        { keywords, date_from: pending.date_from, date_to: pending.date_to }
      )) {
        if (event.type === 'progress') {
          setStatusMessage(event.message)
          updateAssistant(assistantId, { content: event.message })
        } else if (event.type === 'done') {
          setPapers(event.papers)
          setStatusMessage(event.message)
          updateAssistant(assistantId, { content: event.message, isLoading: false, papers: event.papers })
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
    setIsLoading(true)
    setStatusMessage('')

    try {
      const history = messages
        .filter(m => m.id !== '0' && !m.isLoading && m.content)
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))

      const result = await parseQuery(query, apiKey, history)

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
    await runSearchStream(snapshot.assistantId, snapshot, keywords)
  }

  const cancelSearch = () => {
    if (!pendingSearch) return
    const { assistantId } = pendingSearch
    setPendingSearch(null)
    updateAssistant(assistantId, { content: '搜索已取消。', isLoading: false })
    setIsLoading(false)
  }

  const reSearch = async () => {
    if (!lastConfirmed) return
    const assistantId = Date.now().toString()
    const userMsgId = (Date.now() - 1).toString()
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: '重新搜索（已调整参数）' },
      { id: assistantId, role: 'assistant', content: '', isLoading: true },
    ])
    await runSearchStream(assistantId, lastConfirmed, lastConfirmed.keywords)
  }

  return {
    messages,
    papers,
    isLoading,
    statusMessage,
    search,
    pendingKeywords: pendingSearch?.keywords ?? null,
    confirmSearch,
    cancelSearch,
    reSearch: lastConfirmed ? reSearch : undefined,
  }
}
