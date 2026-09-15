import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'scholarscout_model'

export const DEFAULT_MODEL = 'deepseek-v4-flash'

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: '快速 · 日常搜索推荐' },
  { id: 'deepseek-v4-pro',   name: 'DeepSeek V4 Pro',   desc: '更强 · 复杂问题首选' },
  { id: 'deepseek-chat',     name: 'DeepSeek V3',        desc: '旧版 · 兼容原有 Key' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1',        desc: '推理 · 深度思维链' },
]

const CHANGE_EVENT = 'scholarscout:model-change'

function readModel(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_MODEL } catch { return DEFAULT_MODEL }
}

// 多处同时使用（顶部弹窗里切换、论文对话里读取），切换时通过事件通知其他实例同步
export function useModel() {
  const [model, setModelState] = useState<string>(readModel)

  useEffect(() => {
    const sync = () => setModelState(readModel())
    window.addEventListener(CHANGE_EVENT, sync)
    return () => window.removeEventListener(CHANGE_EVENT, sync)
  }, [])

  const setModel = useCallback((m: string) => {
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* ignore */ }
    setModelState(m)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { model, setModel }
}
