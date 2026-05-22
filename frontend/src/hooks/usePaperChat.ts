import { useState, useCallback, useEffect, useRef } from 'react'
import type { Paper } from '../types'
import { useAuth } from './useAuth'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export type PdfStatus = 'idle' | 'ok' | 'error'

export function usePaperChat(apiKey: string, model: string = 'deepseek-v4-flash') {
  const { token, isLoggedIn } = useAuth()
  const [histories, setHistories] = useState<Map<string, ChatMessage[]>>(new Map())
  const [streamingPaperId, setStreamingPaperId] = useState<string | null>(null)
  const [pdfStatuses, setPdfStatuses] = useState<Map<string, PdfStatus>>(new Map())
  const pdfTextsRef = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  // 清理旧版 localStorage 缓存（已改为后端存储）
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ss_pdf_')) localStorage.removeItem(key)
      }
    } catch {}
  }, [])

  // 从后端加载对话记录和 PDF 文本（登录后恢复）
  useEffect(() => {
    if (!isLoggedIn || !token) return
    fetch('/api/user/chats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((items: { paper_id_hash: string; paper: Paper; messages: ChatMessage[]; pdf_text: string | null }[]) => {
        const newStatuses = new Map<string, PdfStatus>()
        setHistories(prev => {
          const next = new Map(prev)
          for (const item of items) {
            if (!next.has(item.paper.paper_id)) {
              next.set(item.paper.paper_id, item.messages)
            }
            if (item.pdf_text) {
              pdfTextsRef.current.set(item.paper.paper_id, item.pdf_text)
              newStatuses.set(item.paper.paper_id, 'ok')
            }
          }
          return next
        })
        if (newStatuses.size > 0) {
          setPdfStatuses(prev => {
            const m = new Map(prev)
            newStatuses.forEach((v, k) => m.set(k, v))
            return m
          })
        }
      })
      .catch(() => {})
  }, [isLoggedIn, token])

  const _saveToBackend = useCallback((paper: Paper, msgs: ChatMessage[], tok: string, updatePdf = false) => {
    const messages = msgs.filter(m => !m.isStreaming).map(m => ({ role: m.role, content: m.content }))
    const pdf_text = pdfTextsRef.current.get(paper.paper_id) ?? null
    fetch('/api/user/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ paper, messages, pdf_text, update_pdf: updatePdf }),
    }).catch(() => {})
  }, [])

  const getMessages = useCallback(
    (paperId: string) => histories.get(paperId) ?? [],
    [histories],
  )

  const getPdfStatus = useCallback(
    (paperId: string): PdfStatus => pdfStatuses.get(paperId) ?? 'idle',
    [pdfStatuses],
  )

  // 接收完整 Paper 对象，上传后立即持久化到后端
  const setPdfText = useCallback((paper: Paper, text: string) => {
    const paperId = paper.paper_id
    pdfTextsRef.current.set(paperId, text)
    setPdfStatuses(prev => new Map(prev).set(paperId, 'ok'))
    if (token) {
      const msgs = (histories.get(paperId) ?? [])
        .filter(m => !m.isStreaming)
        .map(m => ({ role: m.role, content: m.content }))
      fetch('/api/user/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper, messages: msgs, pdf_text: text, update_pdf: true }),
      }).catch(() => {})
    }
  }, [token, histories])

  const setPdfError = useCallback((paperId: string) => {
    setPdfStatuses(prev => new Map(prev).set(paperId, 'error'))
  }, [])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const sendMessage = useCallback(
    async (paper: Paper, userContent: string) => {
      const paperId = paper.paper_id
      const prevMessages = histories.get(paperId) ?? []
      const pdfText = pdfTextsRef.current.get(paperId)
      const userMsg: ChatMessage = { role: 'user', content: userContent }

      const controller = new AbortController()
      abortRef.current = controller

      setHistories(prev => {
        const next = new Map(prev)
        next.set(paperId, [...(prev.get(paperId) ?? []), userMsg, { role: 'assistant', content: '', isStreaming: true }])
        return next
      })
      setStreamingPaperId(paperId)

      try {
        const resp = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            stream: true,
            messages: buildApiMessages(paper, prevMessages, pdfText, userContent),
          }),
        })

        if (!resp.ok) {
          // 余额不足 / Key 无效专项错误
          if (resp.status === 402) throw new Error('__INSUFFICIENT_BALANCE__')
          if (resp.status === 401) throw new Error('__INVALID_KEY__')
          if (resp.status === 429) throw new Error('__RATE_LIMIT__')
          throw new Error(`HTTP ${resp.status}`)
        }

        const reader = resp.body!.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? ''
              accumulated += delta
              setHistories(prev => {
                const next = new Map(prev)
                const msgs = [...(prev.get(paperId) ?? [])]
                msgs[msgs.length - 1] = { role: 'assistant', content: accumulated, isStreaming: true }
                next.set(paperId, msgs)
                return next
              })
            } catch { /* skip malformed SSE line */ }
          }
        }

        setHistories(prev => {
          const next = new Map(prev)
          const msgs = [...(prev.get(paperId) ?? [])]
          msgs[msgs.length - 1] = { role: 'assistant', content: accumulated }
          next.set(paperId, msgs)
          if (token) _saveToBackend(paper, msgs, token)
          return next
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setHistories(prev => {
            const next = new Map(prev)
            const msgs = [...(prev.get(paperId) ?? [])]
            const last = msgs[msgs.length - 1]
            if (last?.isStreaming) {
              msgs[msgs.length - 1] = { role: 'assistant', content: last.content || '（已停止）' }
            }
            next.set(paperId, msgs)
            return next
          })
        } else {
          const errMsg = err instanceof Error ? err.message : String(err)
          let displayMsg = `请求失败：${errMsg}`
          if (errMsg === '__INSUFFICIENT_BALANCE__') {
            displayMsg = '⚠️ DeepSeek API 余额不足，请前往 [platform.deepseek.com](https://platform.deepseek.com) 充值后重试。'
          } else if (errMsg === '__INVALID_KEY__') {
            displayMsg = '⚠️ API Key 无效或已过期，请点击顶栏「换 Key」重新输入。'
          } else if (errMsg === '__RATE_LIMIT__') {
            displayMsg = '⚠️ 请求过于频繁（Rate Limit），请等待片刻后重试。'
          }
          setHistories(prev => {
            const next = new Map(prev)
            const msgs = [...(prev.get(paperId) ?? [])]
            msgs[msgs.length - 1] = { role: 'assistant', content: displayMsg }
            next.set(paperId, msgs)
            return next
          })
        }
      } finally {
        abortRef.current = null
        setStreamingPaperId(null)
      }
    },
    [apiKey, histories, token, _saveToBackend, model],
  )

  const regenerate = useCallback(async (paper: Paper) => {
    const paperId = paper.paper_id
    const msgs = histories.get(paperId) ?? []
    // 找最后一条 user 消息
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return
    const lastUserContent = msgs[lastUserIdx].content
    // 裁掉最后一个 user+assistant 对
    const truncated = msgs.slice(0, lastUserIdx)
    setHistories(prev => new Map(prev).set(paperId, truncated))
    await sendMessage(paper, lastUserContent)
  }, [histories, sendMessage])

  const removePdf = useCallback((paper: Paper) => {
    const paperId = paper.paper_id
    pdfTextsRef.current.delete(paperId)
    setPdfStatuses(prev => { const m = new Map(prev); m.delete(paperId); return m })
    if (token) {
      const msgs = (histories.get(paperId) ?? [])
        .filter(m => !m.isStreaming)
        .map(m => ({ role: m.role, content: m.content }))
      fetch('/api/user/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper, messages: msgs, pdf_text: null, update_pdf: true }),
      }).catch(() => {})
    }
  }, [token, histories])

  const clearChat = useCallback((paper: Paper, keepPdf = false) => {
    const paperId = paper.paper_id
    if (!keepPdf) {
      pdfTextsRef.current.delete(paperId)
      setPdfStatuses(prev => { const m = new Map(prev); m.delete(paperId); return m })
    }
    setHistories(prev => new Map(prev).set(paperId, []))
    if (token) {
      const pdf_text = keepPdf ? (pdfTextsRef.current.get(paperId) ?? null) : null
      fetch('/api/user/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper, messages: [], pdf_text, update_pdf: !keepPdf }),
      }).catch(() => {})
    }
  }, [token])

  return {
    getMessages,
    sendMessage,
    regenerate,
    stopStreaming,
    isStreaming: streamingPaperId !== null,
    streamingPaperId,
    getPdfStatus,
    setPdfText,
    setPdfError,
    removePdf,
    clearChat,
  }
}

function buildApiMessages(
  paper: Paper,
  prevMessages: ChatMessage[],
  pdfText: string | undefined,
  userContent: string,
): { role: string; content: string }[] {
  const system = buildSystemPrompt(paper)
  const history = prevMessages.map(m => ({ role: m.role, content: m.content }))

  const msgs: { role: string; content: string }[] = [{ role: 'system', content: system }, ...history]

  // 模拟 Claude.ai 的 document block：PDF 作为对话时间线中的一个节点
  if (pdfText) {
    msgs.push(
      { role: 'user', content: `【用户上传了论文全文，以下为完整内容】\n\n${pdfText}` },
      { role: 'assistant', content: '已收到论文全文，现在我将基于完整内容回答您后续的问题。' },
    )
  }

  msgs.push({ role: 'user', content: userContent })
  return msgs
}

function buildSystemPrompt(paper: Paper): string {
  const lines = [
    '你是一个学术论文分析助手，请根据以下论文信息回答用户的问题。请用中文回答，简洁专业。支持 Markdown 格式输出。',
    '',
    '【论文信息】',
    `标题：${paper.title}`,
  ]
  if (paper.authors.length > 0)
    lines.push(`作者：${paper.authors.slice(0, 5).join('、')}`)
  if (paper.venue) lines.push(`发表于：${paper.venue}`)
  if (paper.published_date) lines.push(`年份：${paper.published_date.slice(0, 4)}`)
  if (paper.abstract) lines.push(`\n摘要：${paper.abstract}`)
  return lines.join('\n')
}
