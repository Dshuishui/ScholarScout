import { useState, useCallback, useEffect, useRef } from 'react'
import type { Paper } from '../types'
import { useAuth } from './useAuth'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export type PdfStatus = 'idle' | 'ok' | 'error'

const SS_PDF_PREFIX = 'ss_pdf_'

function loadPdfFromStorage(): Map<string, string> {
  const m = new Map<string, string>()
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(SS_PDF_PREFIX)) {
        const text = localStorage.getItem(key)
        if (text) m.set(key.slice(SS_PDF_PREFIX.length), text)
      }
    }
  } catch {}
  return m
}

export function usePaperChat(apiKey: string, model: string = 'deepseek-v4-flash') {
  const { token, isLoggedIn } = useAuth()
  const [histories, setHistories] = useState<Map<string, ChatMessage[]>>(new Map())
  const [streamingPaperId, setStreamingPaperId] = useState<string | null>(null)
  const [pdfStatuses, setPdfStatuses] = useState<Map<string, PdfStatus>>(() => {
    const restored = new Map<string, PdfStatus>()
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(SS_PDF_PREFIX)) restored.set(key.slice(SS_PDF_PREFIX.length), 'ok')
      }
    } catch {}
    return restored
  })
  // useRef 不支持 factory，直接调用初始化函数
  const pdfTextsRef = useRef<Map<string, string>>(loadPdfFromStorage())
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!isLoggedIn || !token) return
    fetch('/api/user/chats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((items: { paper_id_hash: string; paper: Paper; messages: ChatMessage[] }[]) => {
        setHistories(prev => {
          const next = new Map(prev)
          for (const item of items) {
            if (!next.has(item.paper.paper_id)) {
              next.set(item.paper.paper_id, item.messages)
            }
          }
          return next
        })
      })
      .catch(() => {})
  }, [isLoggedIn, token])

  const _saveToBackend = useCallback((paper: Paper, msgs: ChatMessage[], tok: string) => {
    const messages = msgs.filter(m => !m.isStreaming).map(m => ({ role: m.role, content: m.content }))
    fetch('/api/user/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ paper, messages }),
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

  const setPdfText = useCallback((paperId: string, text: string) => {
    pdfTextsRef.current.set(paperId, text)
    setPdfStatuses(prev => new Map(prev).set(paperId, 'ok'))
    try { localStorage.setItem(`${SS_PDF_PREFIX}${paperId}`, text) } catch {}
  }, [])

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

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

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
          // 用户手动停止：保留已生成内容，标记为非流式
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
          setHistories(prev => {
            const next = new Map(prev)
            const msgs = [...(prev.get(paperId) ?? [])]
            msgs[msgs.length - 1] = { role: 'assistant', content: `请求失败：${errMsg}` }
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

  const clearChat = useCallback((paper: Paper, keepPdf = false) => {
    const paperId = paper.paper_id
    if (!keepPdf) {
      pdfTextsRef.current.delete(paperId)
      setPdfStatuses(prev => { const m = new Map(prev); m.delete(paperId); return m })
      try { localStorage.removeItem(`${SS_PDF_PREFIX}${paperId}`) } catch {}
    }
    setHistories(prev => new Map(prev).set(paperId, []))
    if (token) {
      fetch('/api/user/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper, messages: [] }),
      }).catch(() => {})
    }
  }, [token])

  return {
    getMessages,
    sendMessage,
    stopStreaming,
    isStreaming: streamingPaperId !== null,
    streamingPaperId,
    getPdfStatus,
    setPdfText,
    setPdfError,
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
  // 放在历史消息之后、当前问题之前，AI 能清晰区分"上传前"和"上传后"
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
