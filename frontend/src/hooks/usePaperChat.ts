import { useState, useCallback } from 'react'
import type { Paper } from '../types'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export function usePaperChat(apiKey: string, model: string = 'deepseek-v4-flash') {
  const [histories, setHistories] = useState<Map<string, ChatMessage[]>>(new Map())
  const [streamingPaperId, setStreamingPaperId] = useState<string | null>(null)

  const getMessages = useCallback(
    (paperId: string) => histories.get(paperId) ?? [],
    [histories],
  )

  const sendMessage = useCallback(
    async (paper: Paper, userContent: string) => {
      const paperId = paper.paper_id
      const prevMessages = histories.get(paperId) ?? []
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
              { role: 'system', content: buildSystemPrompt(paper) },
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
    [apiKey, histories],
  )

  return {
    getMessages,
    sendMessage,
    isStreaming: streamingPaperId !== null,
    streamingPaperId,
  }
}

function buildSystemPrompt(paper: Paper): string {
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
  if (paper.abstract) lines.push(`\n摘要：${paper.abstract}`)
  return lines.join('\n')
}
