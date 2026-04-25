import { useState } from 'react'

interface Props {
  onKeySubmit: (key: string) => void
}

export function KeySetupScreen({ onKeySubmit }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed.startsWith('sk-')) {
      setError('Key 格式不正确，应以 sk- 开头')
      return
    }
    setError('')
    onKeySubmit(trimmed)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">ScholarScout</h1>
          <p className="text-gray-500 text-sm">AI 驱动的学术论文搜索工具</p>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            DeepSeek API Key
          </label>
          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="sk-xxxxxxxxxxxxxxxx"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
        </div>

        <button
          onClick={handleSubmit}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors cursor-pointer"
        >
          开始使用
        </button>

        <p className="text-xs text-gray-400 mt-5 text-center leading-relaxed">
          Key 仅保存在本地浏览器，不会上传服务器。
          <br />
          <a
            href="https://platform.deepseek.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            没有 Key？点此注册 →
          </a>
        </p>
      </div>
    </div>
  )
}
