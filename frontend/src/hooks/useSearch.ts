import { useState } from 'react'
import { searchPapers } from '../api/client'
import type { Message, Paper } from '../types'
import type { SearchSettings } from './useSettings'

const WELCOME: Message = {
  id: '0',
  role: 'assistant',
  content: '您好！请描述您想搜索的论文，例如：\n\n"找2023年后关于大模型幻觉问题的论文"\n"diffusion model 在医学图像生成的应用综述"',
}

export function useSearch(apiKey: string, settings: SearchSettings) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [papers, setPapers] = useState<Paper[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const updateAssistant = (assistantId: string, patch: Partial<Message>) =>
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, ...patch } : m))

  const search = async (query: string) => {
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query }
    const assistantId = (Date.now() + 1).toString()

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', isLoading: true },
    ])
    setIsLoading(true)
    setStatusMessage('')

    try {
      // 把当前对话历史格式化后传给后端（过滤欢迎语、加载中、空内容）
      const history = messages
        .filter(m => m.id !== '0' && !m.isLoading && m.content)
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))

      for await (const event of searchPapers(query, apiKey, history, settings)) {
        if (event.type === 'progress') {
          // 第一个 progress 说明是搜索意图，清空旧论文
          setPapers([])
          setStatusMessage(event.message)
          updateAssistant(assistantId, { content: event.message })

        } else if (event.type === 'done') {
          setPapers(event.papers)
          setStatusMessage(event.message)
          updateAssistant(assistantId, {
            content: event.message,
            isLoading: false,
            papers: event.papers,
          })

        } else if (event.type === 'chat') {
          // 普通对话：只更新消息气泡，不清空右侧论文结果
          updateAssistant(assistantId, { content: event.message, isLoading: false })

        } else if (event.type === 'error') {
          setStatusMessage('')
          updateAssistant(assistantId, {
            content: `出错了：${event.message}`,
            isLoading: false,
          })
        }
      }
    } catch {
      updateAssistant(assistantId, {
        content: '网络错误，请检查 Key 是否正确或稍后重试',
        isLoading: false,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return { messages, papers, isLoading, statusMessage, search }
}
