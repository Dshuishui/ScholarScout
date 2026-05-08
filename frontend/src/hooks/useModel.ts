import { useState } from 'react'

const STORAGE_KEY = 'scholarscout_model'

export const DEFAULT_MODEL = 'deepseek-v4-flash'

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: '快速 · 日常搜索推荐' },
  { id: 'deepseek-v4-pro',   name: 'DeepSeek V4 Pro',   desc: '更强 · 复杂问题首选' },
  { id: 'deepseek-chat',     name: 'DeepSeek V3',        desc: '旧版 · 兼容原有 Key' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1',        desc: '推理 · 深度思维链' },
]

export function useModel() {
  const [model, setModelState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_MODEL
  )

  const setModel = (m: string) => {
    localStorage.setItem(STORAGE_KEY, m)
    setModelState(m)
  }

  return { model, setModel }
}
