import { useState } from 'react'
import { parseQuery, searchPapers, createSession, ApiError } from '../api/client'
import type { Message, Paper, SearchSessionItem } from '../types'
import type { SearchSettings } from './useSettings'
import { useSearchHistory } from './useSearchHistory'
import { useAuth } from './useAuth'
import { useAccess } from './useAccess'
import type { GateReason } from './useAccess'
import { track } from '../lib/analytics'

// 这些错误码说明"额度不够"，除了在对话里提示，还要弹出注册 / 填 Key 的引导
const GATE_CODES = new Set<GateReason>(['trial_exhausted', 'credits_exhausted', 'trial_capacity', 'key_required'])

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
  domains?: string[]
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
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null)
  const { history, addHistory, removeHistory } = useSearchHistory()
  const { token } = useAuth()
  const { deviceId, mode, trial, freeRemaining, applyRemaining, openGate, refreshTrial } = useAccess()
  // 没有自己的 Key 时：登录用户用账号免费次数，未登录访客用设备标识领体验次数
  const trialAuth = apiKey ? undefined : { token, deviceId }

  /** 已知额度不够时直接弹引导，不发请求、不在对话里留一条失败记录 */
  const blockedReason = (): GateReason | null => {
    if (mode === 'own_key') return null
    if (mode === 'account_trial') return (freeRemaining ?? 0) <= 0 ? 'credits_exhausted' : null
    if (!trial.loaded) return null  // 额度还没查到，交给服务端判断
    if (!trial.enabled) return 'key_required'
    if (trial.anonRemaining <= 0) return 'trial_exhausted'
    if (!trial.capacityOk) return 'trial_capacity'
    return null
  }

  const guard = (): boolean => {
    const reason = blockedReason()
    if (reason) {
      openGate(reason)
      return false
    }
    return true
  }

  /** 把请求错误翻译成对话里的提示；额度类错误同时弹出引导 */
  const describeError = (err: unknown): string => {
    if (err instanceof ApiError) {
      track('search_error', { code: err.code, mode })
      if (GATE_CODES.has(err.code as GateReason)) {
        openGate(err.code as GateReason)
        refreshTrial()
      } else if (err.code === 'invalid_key' || err.code === 'insufficient_balance') {
        openGate('manual')
      } else if (err.code === 'trial_unavailable') {
        openGate('key_required')
      }
      return `⚠️ ${err.message}`
    }
    track('search_error', { code: 'network', mode })
    return '网络错误，请检查网络后重试'
  }

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
        { keywords, date_from: pending.date_from, date_to: pending.date_to, domains: pending.domains },
        model,
        trialAuth,
      )) {
        if (event.type === 'quota') {
          applyRemaining(event.kind, event.remaining)
        } else if (event.type === 'search_start') {
          // 真正开始搜索时才清空上一次结果
          setPapers([])
          setRejectedPapers([])
          setSourceStatuses({})
          setCurrentSessionId(null)
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
          if (event.refunded && typeof event.remaining === 'number') {
            applyRemaining(mode === 'account_trial' ? 'account' : 'anon', event.remaining)
          }
          track('search_done', { mode, count: event.papers.length })
          const note = event.refunded ? '\n\n（没有找到相关论文，本次不计免费次数）' : ''
          updateAssistant(assistantId, { content: event.message + note, isLoading: false, papers: event.papers })
          // 登录用户自动保存搜索快照
          if (token && event.papers.length > 0) {
            createSession(token, {
              query: pending.query,
              keywords: pending.keywords,
              papers: event.papers,
            }).then(res => { if (res?.id) setCurrentSessionId(res.id) })
          }
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
          if (event.refunded && typeof event.remaining === 'number') {
            applyRemaining(mode === 'account_trial' ? 'account' : 'anon', event.remaining)
          }
          track('search_error', { code: 'pipeline', mode })
          const note = event.refunded ? '（本次不计免费次数）' : ''
          updateAssistant(assistantId, { content: `出错了：${event.message}${note}`, isLoading: false })
        }
      }
    } catch (err) {
      setHasSearchError(true)
      updateAssistant(assistantId, { content: describeError(err), isLoading: false })
    } finally {
      setIsLoading(false)
    }
  }

  const search = async (query: string) => {
    if (!guard()) return
    track('search_submit', { mode })
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

      const result = await parseQuery(query, apiKey, history, model, trialAuth)

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
          domains: result.domains,
          query,
          history,
        }
        setLastConfirmed(confirmed)
        addHistory(result.keywords)
        await runSearchStream(assistantId, confirmed, result.keywords)
      }
    } catch (err) {
      updateAssistant(assistantId, { content: describeError(err), isLoading: false })
      setIsLoading(false)
    }
  }


  const reSearch = async (keywords: string[]) => {
    if (!lastConfirmed || !guard()) return
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

  const loadSession = (session: SearchSessionItem) => {
    const assistantId = Date.now().toString()
    const userMsgId = (Date.now() - 1).toString()
    setPapers(session.papers)
    setRejectedPapers([])
    setCurrentSessionId(session.id)
    setSearchDateRange(null)
    setSourceStatuses({})
    setHasSearchError(false)
    setLastConfirmed({
      assistantId,
      keywords: session.keywords,
      date_from: null,
      date_to: null,
      query: session.query ?? session.keywords.join(' '),
      history: [],
    })
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: `加载快照：${session.keywords.join('、')}` },
      {
        id: assistantId,
        role: 'assistant',
        content: `已加载 ${session.papers.length} 篇论文（快照 ${new Date(session.created_at).toLocaleDateString('zh-CN')}）`,
        isLoading: false,
      },
    ])
  }

  const searchFromHistory = async (keywords: string[]) => {
    if (!guard()) return
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
    currentSessionId,
    loadSession,
  }
}
