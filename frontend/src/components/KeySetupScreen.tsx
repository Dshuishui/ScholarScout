import { useState } from 'react'

interface Props {
  onKeySubmit: (key: string) => void
}

const FEATURES = [
  { icon: '🔍', label: '10 个学术数据库' },
  { icon: '✦', label: 'AI 相关性过滤' },
  { icon: '📄', label: 'PDF 深度查找' },
  { icon: '💬', label: '论文独立对话' },
]

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-300/40 mb-5">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-2">ScholarScout</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            用自然语言探索学术文献<br />
            <span className="text-gray-400">搜索 · 筛选 · 阅读 · 对话，一站完成</span>
          </p>
        </div>

        {/* Feature chips */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {FEATURES.map(f => (
            <span
              key={f.label}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white border border-blue-100 text-blue-700 shadow-sm font-medium"
            >
              <span>{f.icon}</span>
              {f.label}
            </span>
          ))}
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-blue-100/60 border border-gray-100 p-8">
          <p className="text-sm font-semibold text-gray-800 mb-1">输入 DeepSeek API Key 开始使用</p>
          <p className="text-xs text-gray-400 mb-5">
            Key 仅存于本地浏览器，不会上传服务器。
            <a
              href="https://platform.deepseek.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline ml-1"
            >
              没有 Key？免费注册 →
            </a>
          </p>

          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="sk-xxxxxxxxxxxxxxxx"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all placeholder-gray-300 mb-1"
          />
          {error
            ? <p className="text-red-500 text-xs mt-1 mb-3">{error}</p>
            : <div className="mb-3" />
          }

          <button
            onClick={handleSubmit}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:from-blue-800 active:to-indigo-800 text-white rounded-xl py-3 text-sm font-semibold transition-all shadow-md shadow-blue-200 cursor-pointer"
          >
            开始探索论文 →
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-5 leading-relaxed">
          在线体验：
          <a href="http://118.25.192.117" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
            118.25.192.117
          </a>
          &ensp;·&ensp;开源于
          <a href="https://github.com/Dshuishui/ScholarScout" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline ml-1">
            GitHub
          </a>
        </p>
      </div>
    </div>
  )
}
