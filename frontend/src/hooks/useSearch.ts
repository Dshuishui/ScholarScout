import { useRef, useState } from 'react'
import { parseQuery, searchPapers, createSession, updateSessionPapers, ApiError } from '../api/client'
import type { Message, Paper, SearchSessionItem } from '../types'
import type { SearchSettings } from './useSettings'
import { useSearchHistory } from './useSearchHistory'
import type { HistoryItem } from './useSearchHistory'
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
  /** 解析出的概念组，后端用来取交集检索；用户改了关键词就不再适用 */
  concepts?: string[][]
  query: string
  history: { role: string; content: string }[]
}

export type SourceStatus = { status: 'pending' | 'done'; count: number }

const NEXT_STEPS_KEY = 'ss_next_steps_shown'

/** 第一次搜到结果时提示接下来能做什么：2026-10 的真实访客搜完都直接离开，没人用过 AI 对话、中文标题和订阅 */
function nextStepsTip(): string {
  try {
    if (localStorage.getItem(NEXT_STEPS_KEY)) return ''
    localStorage.setItem(NEXT_STEPS_KEY, '1')
  } catch { return '' }
  return '\n\n接下来可以：点论文下方的 **AI 对话**，让 AI 帮你读这篇；点结果上方的 **中文标题**，一键翻译全部标题；' +
    '点 **订阅更新**（需登录），每天早上把这个方向的新论文发到邮箱。'
}

function daysAgo(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  return days <= 0 ? '今天' : `${days} 天前`
}

export function useSearch(apiKey: string, settings: SearchSettings, model?: string) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [papers, setPapers] = useState<Paper[]>([])
  const [rejectedPapers, setRejectedPapers] = useState<Paper[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // 每次换一组结果就加 1：上一次搜索 done 之后还在补论文，用户这时开始新搜索或打开历史，旧流后面的事件都要丢掉
  const resultsGen = useRef(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [lastConfirmed, setLastConfirmed] = useState<PendingSearch | null>(null)
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({})
  const [searchDateRange, setSearchDateRange] = useState<{ from: string | null; to: string | null } | null>(null)
  const [previewPapers, setPreviewPapers] = useState<Paper[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [hasSearchError, setHasSearchError] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null)
  const { history, addHistory, saveResults, removeHistory } = useSearchHistory()
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

  /** 搜索中断（AI 筛选失败、连接断开）时，把已经搜到的原始结果留给用户，而不是清空页面 */
  const keepPreviewAsResults = (): boolean => {
    let kept = false
    setPreviewPapers(prev => {
      if (prev.length) {
        setPapers(cur => (cur.length ? cur : prev))
        kept = prev.length > 0
      }
      return prev
    })
    return kept
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
    // done 之后还会补一批论文：补完要更新历史记录、搜索快照和这条回复
    let shownPapers: Paper[] = []
    let doneContent = ''
    let sessionReq: Promise<{ id: number } | null> | null = null
    const gen = ++resultsGen.current
    const stale = () => gen !== resultsGen.current

    try {
      for await (const event of searchPapers(
        pending.query, apiKey, pending.history, settings,
        { keywords, date_from: pending.date_from, date_to: pending.date_to, domains: pending.domains, concepts: pending.concepts },
        model,
        trialAuth,
      )) {
        if (stale()) break
        if (event.type === 'quota') {
          applyRemaining(event.kind, event.remaining)
        } else if (event.type === 'partial') {
          setPreviewPapers(event.papers)
          setPreviewTotal(event.total)
        } else if (event.type === 'search_start') {
          // 真正开始搜索时才清空上一次结果
          setPapers([])
          setPreviewPapers([])
          setPreviewTotal(0)
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
          setPreviewPapers([])
          setRejectedPapers(event.rejected_papers ?? [])
          setStatusMessage(event.message)
          setIsLoading(false)  // 主搜索完成，立即释放输入框
          if (event.refunded && typeof event.remaining === 'number') {
            applyRemaining(mode === 'account_trial' ? 'account' : 'anon', event.remaining)
          }
          track('search_done', { mode, count: event.papers.length })
          const note = event.refunded ? '\n\n（没有找到相关论文，本次不计免费次数）' : ''
          const tip = event.papers.length > 0 ? nextStepsTip() : ''
          shownPapers = event.papers
          doneContent = event.message + note + tip
          updateAssistant(assistantId, { content: doneContent, isLoading: false, papers: event.papers })
          saveResults(keywords, event.papers)
          // 登录用户自动保存搜索快照
          if (token && event.papers.length > 0) {
            sessionReq = createSession(token, {
              query: pending.query,
              keywords: pending.keywords,
              papers: event.papers,
            })
            sessionReq.then(res => { if (res?.id) setCurrentSessionId(res.id) })
          }
        } else if (event.type === 'expanding') {
          setStatusMessage(event.message)
        } else if (event.type === 'more_papers') {
          setStatusMessage(event.message)
          const known = new Set(shownPapers.map(p => p.paper_id))
          const added = event.papers.filter(p => !known.has(p.paper_id))
          if (added.length > 0) {
            shownPapers = [...shownPapers, ...added]
            const merged = shownPapers
            setPapers(prev => [...prev, ...added.filter(p => !prev.some(x => x.paper_id === p.paper_id))])
            doneContent += `\n\n${event.message}`
            updateAssistant(assistantId, { content: doneContent, papers: merged })
            saveResults(keywords, merged)
            track('search_more', { count: added.length })
            if (token && sessionReq) {
              sessionReq.then(res => { if (res?.id) updateSessionPapers(token, res.id, merged) })
            }
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
          const kept = keepPreviewAsResults()
          updateAssistant(assistantId, {
            content: `出错了：${event.message}${note}` + (kept ? '\n\n已保留搜到的原始结果（未经 AI 筛选）。' : ''),
            isLoading: false,
          })
        }
      }
      // 流结束了却没收到 done：连接被中途切断，保留已搜到的结果
      if (!stale()) keepPreviewAsResults()
    } catch (err) {
      if (stale()) return
      setHasSearchError(true)
      const kept = keepPreviewAsResults()
      updateAssistant(assistantId, {
        content: describeError(err) + (kept ? '\n\n已保留搜到的原始结果（未经 AI 筛选）。' : ''),
        isLoading: false,
      })
    } finally {
      if (!stale()) setIsLoading(false)
    }
  }

  /** forceSearch：用户在 AI 的直接回答下点了"按这个问题搜论文"，不再判断意图 */
  const search = async (query: string, forceSearch = false) => {
    if (!guard()) return
    track('search_submit', forceSearch ? { mode, forced: true } : { mode })
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

      const result = await parseQuery(query, apiKey, history, model, trialAuth, forceSearch)

      if (result.intent === 'chat') {
        updateAssistant(assistantId, { content: result.reply, isLoading: false, searchableQuery: query })
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
          concepts: result.concepts,
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
    const keywordsEdited = keywords.join(',') !== lastConfirmed.keywords.join(',')
    const newConfirmed = { ...lastConfirmed, keywords, ...(keywordsEdited && { concepts: undefined }) }
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
    resultsGen.current++
    setIsLoading(false)  // 正在进行的那次搜索作废了，它不会再来关掉加载状态
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

  const searchFromHistory = async (item: HistoryItem) => {
    const { keywords, papers: saved } = item
    resultsGen.current++
    const assistantId = Date.now().toString()
    const userMsgId = (Date.now() - 1).toString()
    // 有上次的结果就直接打开：2026-10 有访客隔 3 天重搜同一组关键词，又等了一两分钟、又花了一次次数
    if (saved?.length) {
      setIsLoading(false)
      setPapers(saved)
      setPreviewPapers([])
      setRejectedPapers([])
      setCurrentSessionId(null)
      setSearchDateRange(null)
      setSourceStatuses({})
      setHasSearchError(false)
      setLastConfirmed({ assistantId, keywords, date_from: null, date_to: null, query: keywords.join(' '), history: [] })
      setMessages(prev => [
        ...prev,
        { id: userMsgId, role: 'user', content: `历史搜索：${keywords.join('、')}` },
        {
          id: assistantId,
          role: 'assistant',
          content: `已打开${daysAgo(item.timestamp)}的搜索结果，共 ${saved.length} 篇（没有重新搜索）。想看最新论文，在输入框里重新描述一次需求即可。`,
          isLoading: false,
          papers: saved,
        },
      ])
      return
    }
    if (!guard()) return
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
    previewPapers,
    previewTotal,
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
