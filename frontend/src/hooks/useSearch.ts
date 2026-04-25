import { useState } from 'react'
import { searchPapers } from '../api/client'
import type { Message, Paper } from '../types'

const WELCOME: Message = {
  id: '0',
  role: 'assistant',
  content: '您好！请描述您想搜索的论文，例如：\n\n"找2023年后关于大模型幻觉问题的论文"\n"diffusion model 在医学图像生成的应用综述"',
}

export function useSearch(apiKey: string) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [papers, setPapers] = useState<Paper[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const search = async (query: string) => {
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
    }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setPapers([])
    setStatusMessage('')

    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', isLoading: true },
    ])

    try {
      for await (const event of searchPapers(query, apiKey)) {
        if (event.type === 'progress') {
          setStatusMessage(event.message)
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, content: event.message } : m
            )
          )
        } else if (event.type === 'done') {
          setPapers(event.papers)
          setStatusMessage(event.message)
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: event.message, isLoading: false, papers: event.papers }
                : m
            )
          )
        } else if (event.type === 'error') {
          setStatusMessage('')
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: `搜索出错：${event.message}`, isLoading: false }
                : m
            )
          )
        }
      }
    } catch (e) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: '网络错误，请检查 Key 是否正确或稍后重试', isLoading: false }
            : m
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  return { messages, papers, isLoading, statusMessage, search }
}
