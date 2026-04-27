import { useState, useEffect } from 'react'

interface Props {
  onKeySubmit: (key: string) => void
}

// 打字机 hook：delay 后开始，每 speed ms 输出一个字符
function useTypewriter(text: string, startDelay: number, speed = 75) {
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let interval: ReturnType<typeof setInterval>
    timer = setTimeout(() => {
      let i = 0
      interval = setInterval(() => {
        i++
        setDisplayed(text.slice(0, i))
        if (i >= text.length) clearInterval(interval)
      }, speed)
    }, startDelay)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [text, startDelay, speed])

  return displayed
}

const LINE1 = '用自然语言'
const LINE2 = '探索学术文献'
const LINE1_DONE_AT = 400 + LINE1.length * 75 // 打完 line1 的时刻

const FEATURES = [
  '10 个数据源并发搜索，AI 相关性过滤',
  '每篇论文独立 AI 对话，深入理解研究内容',
  'PDF 深度查找 + 8 个平台备用入口',
  '来源分组 · 批量下载 · 一键导出 CSV',
]

const STATS = [
  { value: '10+', label: '数据源' },
  { value: '近5年', label: '默认范围' },
  { value: 'AI', label: '智能筛选' },
]

export function KeySetupScreen({ onKeySubmit }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  const line1 = useTypewriter(LINE1, 400)
  const line2 = useTypewriter(LINE2, LINE1_DONE_AT + 180)

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
    <>
      {/* 自定义动画 */}
      <style>{`
        @keyframes gradientFlow {
          0%,100% { background-position: 0% 60%; }
          50%      { background-position: 100% 40%; }
        }
        @keyframes floatY {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-9px); }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0);    }
        }
        @keyframes cursorBlink {
          0%,100% { opacity:1; }
          50%      { opacity:0; }
        }
        .gradient-flow {
          background: linear-gradient(-45deg,#1d4ed8,#312e81,#1e3a8a,#4338ca,#1d4ed8);
          background-size: 350% 350%;
          animation: gradientFlow 11s ease infinite;
        }
        .float-logo { animation: floatY 4s ease-in-out infinite; }
        .circle-a   { animation: floatY 13s ease-in-out infinite; }
        .circle-b   { animation: floatY 17s ease-in-out infinite reverse; }
        .circle-c   { animation: floatY  9s ease-in-out infinite; }
        .fade-up    { opacity:0; animation: fadeUp .55s ease forwards; }
        .cursor     { animation: cursorBlink .9s step-end infinite; }
        .dot-grid {
          background-image: radial-gradient(circle, #cbd5e1 1px, transparent 1px);
          background-size: 22px 22px;
        }
      `}</style>

      <div className="min-h-screen flex">

        {/* ── 左侧：品牌 + 动效 ─────────────────────────── */}
        <div className="hidden lg:flex w-[56%] gradient-flow flex-col justify-between p-14 text-white relative overflow-hidden">
          {/* 装饰圆 */}
          <div className="circle-a absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5 pointer-events-none" />
          <div className="circle-b absolute -bottom-32 -left-16 w-[480px] h-[480px] rounded-full bg-white/5 pointer-events-none" />
          <div className="circle-c absolute top-1/2 right-8 w-52 h-52 rounded-full bg-indigo-400/10 pointer-events-none" />

          {/* Logo */}
          <div className="flex items-center gap-3 relative z-10">
            <div className="float-logo w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight">ScholarScout</span>
          </div>

          {/* 打字机标题 + 功能列表 */}
          <div className="relative z-10">
            {/* 保留高度，避免打字前塌陷 */}
            <h2 className="text-[3.25rem] font-bold leading-[1.18] mb-5 tracking-tight" style={{ minHeight: '7.5rem' }}>
              <span className="block">
                {line1}
                {line1.length < LINE1.length && (
                  <span className="cursor opacity-80">|</span>
                )}
              </span>
              <span className="block">
                {line2}
                {line1.length >= LINE1.length && line2.length < LINE2.length && (
                  <span className="cursor opacity-80">|</span>
                )}
              </span>
            </h2>

            <p
              className="fade-up text-blue-200 text-lg mb-10 leading-relaxed"
              style={{ animationDelay: `${LINE1_DONE_AT + LINE2.length * 75 + 350}ms` }}
            >
              AI 驱动 · 10 个学术数据库 · 论文独立对话
            </p>

            <div className="space-y-4">
              {FEATURES.map((f, i) => (
                <div
                  key={f}
                  className="fade-up flex items-start gap-3"
                  style={{ animationDelay: `${LINE1_DONE_AT + LINE2.length * 75 + 550 + i * 140}ms` }}
                >
                  <div className="w-5 h-5 rounded-full bg-blue-400/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-blue-100 text-[15px] leading-snug">{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 底部链接 */}
          <div className="relative z-10 flex items-center gap-5 text-sm text-blue-300">
            <a href="http://118.25.192.117" target="_blank" rel="noopener noreferrer"
              className="hover:text-white transition-colors">在线体验 →</a>
            <span className="text-blue-700">|</span>
            <a href="https://github.com/Dshuishui/ScholarScout" target="_blank" rel="noopener noreferrer"
              className="hover:text-white transition-colors">GitHub 开源</a>
          </div>
        </div>

        {/* ── 右侧：表单区 ──────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center p-8 dot-grid relative bg-white">
          {/* 点阵遮罩，让表单区域清晰 */}
          <div className="absolute inset-0 bg-white/75 pointer-events-none" />

          <div className="w-full max-w-sm relative z-10">

            {/* 移动端 logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-8">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <span className="text-lg font-bold text-gray-900">ScholarScout</span>
            </div>

            {/* 渐变标题 */}
            <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
              开始你的学术探索
            </h2>
            <p className="text-gray-400 text-sm mb-5 leading-relaxed">
              输入你的 DeepSeek API Key 继续。Key 仅存于本地浏览器，不会上传服务器。
            </p>

            {/* 数据徽章 */}
            <div className="flex items-center gap-2 mb-7">
              {STATS.map(s => (
                <div key={s.label}
                  className="flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                  <span className="font-bold text-slate-700">{s.value}</span>
                  <span className="text-slate-400">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Key 输入 */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                DeepSeek API Key
              </label>
              <input
                type="password"
                value={input}
                onChange={e => { setInput(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder-gray-300 transition-all focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.10)]"
              />
              {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
            </div>

            {/* 提交按钮：hover 上浮 + 阴影加深 */}
            <button
              onClick={handleSubmit}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl py-3 text-sm font-semibold transition-all shadow-md shadow-blue-200/60 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/50"
            >
              开始探索论文 →
            </button>

            <p className="text-center text-xs text-gray-400 mt-6">
              没有 Key？
              <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer"
                className="text-blue-500 hover:underline ml-1">
                免费注册 DeepSeek →
              </a>
            </p>
          </div>
        </div>

      </div>
    </>
  )
}
