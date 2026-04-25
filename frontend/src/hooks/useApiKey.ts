import { useState } from 'react'

const STORAGE_KEY = 'scholarscout_deepseek_key'

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? ''
  )

  const setApiKey = (key: string) => {
    localStorage.setItem(STORAGE_KEY, key)
    setApiKeyState(key)
  }

  const clearApiKey = () => {
    localStorage.removeItem(STORAGE_KEY)
    setApiKeyState('')
  }

  return { apiKey, setApiKey, clearApiKey, hasKey: apiKey.length > 0 }
}
