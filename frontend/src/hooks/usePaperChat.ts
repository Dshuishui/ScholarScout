import { useState, useCallback, useEffect } from 'react'
import type { Paper } from '../types'
import { useAuth } from './useAuth'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export type PdfStatus = 'idle' | 'loading' | 'ok' | 'failed'

export function usePaperChat(apiKey: string, model: string = 'deepseek-v4-flash') {
  const { token, isLoggedIn } = useAuth()
  const [histories, setHistories] = useState<Map<string, ChatMessage[]>>(new Map())
  const [streamingPaperId, setStreamingPaperId] = useState<string | null>(null)
  const [pdfStatuses, setPdfStatuses] = useState<Map<string, PdfStatus>>(new Map())
  const [pdfTexts, setPdfTextsState] = useState<Map<string, string>>(new Map())

  // 登录后从后端加载历史对话
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

  // 自动获取论文 PDF
  const fetchPdf = useCallback(async (paper: Paper) => {
    const paperId = paper.paper_id
    const current = pdfStatuses.get(paperId)
    if (current === 'loading' || current === 'ok') return  // 已在进行中或已完成

    if (!paper.pdf_url) {
      setPdfStatuses(prev => new Map(prev).set(paperId, 'failed'))
      return
    }

    setPdfStatuses(prev => new Map(prev).set(paperId, 'loading'))
    try {
      const r = await fetch('/api/paper/fetch-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_url: paper.pdf_url }),
      })
      const data = await r.json()
      if (data.text) {
        setPdfTextsState(prev => new Map(prev).set(paperId, data.text))
        setPdfStatuses(prev => new Map(prev).set(paperId, 'ok'))
      } else {
        setPdfStatuses(prev => new Map(prev).set(paperId, 'failed'))
      }
    } catch {
      setPdfStatuses(prev => new Map(prev).set(paperId, 'failed'))
    }
  }, [pdfStatuses])

  // 手动设置 PDF 文本（用户上传后）
  const setPdfText = useCallback((paperId: string, text: string) => {
    setPdfTextsState(prev => new Map(prev).set(paperId, text))
    setPdfStatuses(prev => new Map(prev).set(paperId, 'ok'))
  }, [])

  const sendMessage = useCallback(
    async (paper: Paper, userContent: string) => {
      const paperId = paper.paper_id
      const prevMessages = histories.get(paperId) ?? []
      const pdfText = pdfTexts.get(paperId)
      const userMsg: ChatMessage = { role: 'user', content: userContent }

      setHistories(prev => {
        const next = new Map(prev)
        next.set(paperId, [...(prev.get(paperId) ?? []), userMsg, { role: 'assistant', content: '', isStreaming: true }])
        return next
      })
      setStreamingPaperId(paperId)

      try {
        const resp = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [
              { role: 'system', content: buildSystemPrompt(paper, pdfText) },
              ...prevMessages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userContent },
            ],
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
        const errMsg = err instanceof Error ? err.message : String(err)
        setHistories(prev => {
          const next = new Map(prev)
          const msgs = [...(prev.get(paperId) ?? [])]
          msgs[msgs.length - 1] = { role: 'assistant', content: `请求失败：${errMsg}` }
          next.set(paperId, msgs)
          return next
        })
      } finally {
        setStreamingPaperId(null)
      }
    },
    [apiKey, histories, token, _saveToBackend, pdfTexts, model],
  )

  const clearChat = useCallback((paper: Paper) => {
    const paperId = paper.paper_id
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
    isStreaming: streamingPaperId !== null,
    streamingPaperId,
    fetchPdf,
    getPdfStatus,
    setPdfText,
    clearChat,
  }
}

function buildSystemPrompt(paper: Paper, pdfText?: string): string {
  const lines = [
    '你是一个学术论文分析助手，请根据以下论文信息回答用户的问题。请用中文回答，简洁专业。',
    '',
    '【论文信息】',
    `标题：${paper.title}`,
  ]
  if (paper.authors.length > 0)
    lines.push(`作者：${paper.authors.slice(0, 5).join('、')}`)
  if (paper.venue) lines.push(`发表于：${paper.venue}`)
  if (paper.published_date) lines.push(`年份：${paper.published_date.slice(0, 4)}`)

  if (pdfText) {
    lines.push('\n【论文全文（节选）】')
    lines.push(pdfText)
  } else if (paper.abstract) {
    lines.push(`\n摘要：${paper.abstract}`)
  }

  return lines.join('\n')
}
