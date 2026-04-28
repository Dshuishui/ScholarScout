import { useState, useEffect } from 'react'

interface Props {
  onKeySubmit: (key: string) => void
}

function useTypewriter(text: string, startDelay: number, speed = 70) {
  const [displayed, setDisplayed] = useState('')
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    let iv: ReturnType<typeof setInterval>
    t = setTimeout(() => {
      let i = 0
      iv = setInterval(() => { i++; setDisplayed(text.slice(0, i)); if (i >= text.length) clearInterval(iv) }, speed)
    }, startDelay)
    return () => { clearTimeout(t); clearInterval(iv) }
  }, [text, startDelay, speed])
  return displayed
}

const LINE1 = '用自然语言'
const LINE2 = '探索学术文献'
const L1_END = 400 + LINE1.length * 70

// 右侧优势条目
const BENEFITS = [
  { icon: '⚡', title: '10 个学术数据库并发搜索', desc: 'arXiv · Semantic Scholar · PubMed · CrossRef 等' },
  { icon: '✦', title: 'AI 智能筛选 + 论文独立对话', desc: '自动过滤低相关结果，每篇论文可开启独立 AI 分析' },
  { icon: '📄', title: 'PDF 深度查找 + Google Scholar 直达', desc: '多平台备用入口，跨库引用与引文一键可达' },
]

const STATS = [
  { value: '10+', label: '数据源' },
  { value: '近5年', label: '默认范围' },
  { value: 'AI', label: '智能筛选' },
]


export function KeySetupScreen({ onKeySubmit }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const line1 = useTypewriter(LINE1, 400)
  const line2 = useTypewriter(LINE2, L1_END + 180)

  const handleSubmit = async () => {
    const t = input.trim()
    if (!t) return
    if (!t.startsWith('sk-')) {
      setError('Key 格式不正确，应以 sk- 开头')
      return
    }
    setError('')
    setIsValidating(true)
    try {
      const res = await fetch('/api/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: t }),
      })
      const data = await res.json()
      if (data.valid) {
        onKeySubmit(t)
      } else {
        setError(data.reason ?? 'Key 无效，请重新确认')
      }
    } catch {
      setError('网络错误，请检查连接后重试')
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes gradientFlow {
          0%,100% { background-position: 0% 60%; }
          50%      { background-position: 100% 40%; }
        }
        @keyframes floatY {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes glowPulse {
          0%,100% { opacity:.18; transform:scale(1); }
          50%      { opacity:.30; transform:scale(1.07); }
        }
        @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeIn {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .gradient-bg {
          background: linear-gradient(-45deg,#0f172a,#1e1b4b,#0c1445,#1e3a8a,#0f172a);
          background-size: 400% 400%;
          animation: gradientFlow 14s ease infinite;
        }
        .float-logo  { animation: floatY 4s ease-in-out infinite; }
        .glow-blue   { animation: glowPulse  7s ease-in-out infinite; }
        .glow-purple { animation: glowPulse  9s ease-in-out infinite 1s; }
        .glow-cyan   { animation: glowPulse  6s ease-in-out infinite 2s; }
        .cursor      { animation: cursorBlink .9s step-end infinite; }
        .anim-in     { animation: fadeIn .6s ease forwards; opacity:0; }
      `}</style>

      <div className="min-h-screen flex">

        {/* ══ 左侧 62% ══════════════════════════════════════ */}
        <div className="hidden lg:flex w-[62%] gradient-bg flex-col p-10 text-white relative overflow-hidden">

          {/* 辉光球 */}
          <div className="glow-blue absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle,#3b82f6 0%,transparent 70%)', filter: 'blur(70px)' }} />
          <div className="glow-purple absolute -bottom-32 -left-24 w-[560px] h-[560px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle,#7c3aed 0%,transparent 70%)', filter: 'blur(90px)' }} />
          <div className="glow-cyan absolute top-[40%] right-[20%] w-56 h-56 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle,#22d3ee 0%,transparent 70%)', filter: 'blur(60px)' }} />

          {/* ① Logo */}
          <div className="relative z-10 flex items-center gap-3">
            <div className="float-logo w-11 h-11 rounded-xl bg-white/10 border border-white/20 backdrop-blur flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">ScholarScout</span>
          </div>

          {/* ② 标题 */}
          <div className="relative z-10 mt-8 mb-6">
            <h2 className="text-7xl font-black leading-[1.05] tracking-tight" style={{ minHeight: '8rem' }}>
              <span className="block">{line1}{line1.length < LINE1.length && <span className="cursor text-blue-300">|</span>}</span>
              <span className="block bg-gradient-to-r from-white via-blue-100 to-cyan-300 bg-clip-text text-transparent">
                {line2}{line1.length >= LINE1.length && line2.length < LINE2.length && <span className="cursor text-blue-300">|</span>}
              </span>
            </h2>
            <p className="anim-in text-blue-200 text-base mt-3 leading-relaxed"
              style={{ animationDelay: `${L1_END + LINE2.length * 70 + 200}ms` }}>
              AI 驱动 · 自然语言描述 · 秒级返回结果
            </p>
          </div>

          {/* ③ App 预览窗口 */}
          <div className="anim-in relative z-10 flex-1 flex flex-col justify-center mb-6"
            style={{ animationDelay: `${L1_END + LINE2.length * 70 + 350}ms` }}>
            <div className="rounded-xl overflow-hidden w-full"
              style={{ boxShadow: '0 30px 70px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.1)' }}>
              {/* macOS 标题栏 */}
              <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 border-b border-gray-200">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <div className="flex-1 mx-3">
                  <div className="bg-white border border-gray-200 rounded px-2 py-0.5 text-[9px] text-gray-400 text-center truncate">
                    RAG · retrieval augmented generation — ScholarScout
                  </div>
                </div>
              </div>
              {/* 真实截图 */}
              <div className="overflow-hidden bg-slate-50">
                <img
                  src="/preview.png"
                  alt="ScholarScout AI 对话功能演示"
                  className="w-full object-cover object-top"
                  style={{ maxHeight: '240px' }}
                />
              </div>
            </div>
          </div>

          {/* ④ Bento 特性网格 + 链接 */}
          <div className="anim-in relative z-10"
            style={{ animationDelay: `${L1_END + LINE2.length * 70 + 600}ms` }}>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {/* 大卡：左列占两行 */}
              <div className="row-span-2 border border-white/15 bg-white/10 backdrop-blur-sm rounded-xl p-4 hover:bg-white/15 transition-colors flex flex-col justify-between">
                <div className="text-2xl">⚡</div>
                <div>
                  <p className="text-sm font-bold text-white leading-snug">10 源并发搜索</p>
                  <p className="text-xs text-blue-300 mt-1 leading-snug">arXiv · S2 · PubMed · CrossRef 等同时检索</p>
                </div>
                <div className="text-xs text-white/30 font-semibold tabular-nums mt-3">10+ 数据库</div>
              </div>
              {/* 右上小卡 */}
              <div className="border border-white/15 bg-white/8 backdrop-blur-sm rounded-xl p-3 hover:bg-white/12 transition-colors">
                <div className="text-lg mb-1">✦</div>
                <p className="text-sm font-bold text-white leading-snug">AI 精准筛选</p>
                <p className="text-[11px] text-blue-300 mt-0.5">过滤低相关论文</p>
              </div>
              {/* 右下小卡 */}
              <div className="border border-white/15 bg-white/8 backdrop-blur-sm rounded-xl p-3 hover:bg-white/12 transition-colors">
                <div className="text-lg mb-1">💬</div>
                <p className="text-sm font-bold text-white leading-snug">论文对话</p>
                <p className="text-[11px] text-blue-300 mt-0.5">独立上下文深度解析</p>
              </div>
              {/* 横跨底部宽卡 */}
              <div className="col-span-2 border border-white/15 bg-white/8 backdrop-blur-sm rounded-xl px-4 py-3 hover:bg-white/12 transition-colors flex items-center gap-3">
                <div className="text-xl flex-shrink-0">📄</div>
                <div>
                  <p className="text-sm font-bold text-white leading-tight">PDF 深度查找</p>
                  <p className="text-[11px] text-blue-300 mt-0.5">Kimi 联网搜索 + 8 平台备用入口</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-5 text-sm text-blue-400">
              <a href="http://118.25.192.117" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">在线体验 →</a>
              <span className="text-blue-800">|</span>
              <a href="https://github.com/Dshuishui/ScholarScout" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">GitHub 开源</a>
            </div>
          </div>
        </div>

        {/* ══ 右侧 38% ══════════════════════════════════════ */}
        <div className="flex-1 flex items-center justify-center px-10 py-12 relative overflow-hidden"
          style={{ background: '#f8fafc' }}>
          {/* 左上角淡蓝辉光 */}
          <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle,#bfdbfe 0%,transparent 70%)', filter: 'blur(60px)', opacity: .7 }} />

          <div className="w-full max-w-xs relative z-10">

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

            {/* 优势列表（填充右侧空间） */}
            <div className="space-y-2.5 mb-8">
              {BENEFITS.map(b => (
                <div key={b.title}
                  className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
                  <span className="text-lg flex-shrink-0 mt-0.5">{b.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 leading-snug">{b.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-snug">{b.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 mb-7">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 flex-shrink-0">输入 Key 开始使用</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* 渐变标题 */}
            <h2 className="text-2xl font-bold mb-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
              开始你的学术探索
            </h2>
            <p className="text-gray-400 text-xs mb-5 leading-relaxed">
              Key 仅存于本地浏览器，不会上传服务器。
            </p>

            {/* 数据徽章 */}
            <div className="flex items-center gap-2 mb-5">
              {STATS.map(s => (
                <div key={s.label}
                  className="flex items-center gap-1 text-xs bg-white border border-slate-200 rounded-full px-2.5 py-1 shadow-sm">
                  <span className="font-bold text-slate-700">{s.value}</span>
                  <span className="text-slate-400">{s.label}</span>
                </div>
              ))}
            </div>

            {/* 输入框 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">DeepSeek API Key</label>
              <input
                type="password"
                value={input}
                onChange={e => { setInput(e.target.value); setError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && !isValidating) handleSubmit() }}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder-gray-300 shadow-sm transition-all focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.08)]"
              />
              {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
            </div>

            {/* 按钮 */}
            <button
              onClick={handleSubmit}
              disabled={isValidating || !input.trim()}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-blue-400 disabled:to-indigo-400 text-white rounded-xl py-3 text-sm font-semibold transition-all shadow-md shadow-blue-200/60 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none"
            >
              {isValidating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  正在验证 Key...
                </span>
              ) : '开始探索论文 →'}
            </button>

            <p className="text-center text-xs text-gray-400 mt-5">
              没有 Key？
              <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer"
                className="text-blue-500 hover:underline ml-1">免费注册 DeepSeek →</a>
            </p>
          </div>
        </div>

      </div>
    </>
  )
}
