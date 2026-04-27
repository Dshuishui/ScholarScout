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

const FEATURES = [
  { icon: '⚡', text: '10 个学术数据库并发搜索' },
  { icon: '✦', text: 'AI 相关性筛选与深度分析' },
  { icon: '💬', text: '每篇论文独立 AI 对话' },
  { icon: '📄', text: 'PDF 深度查找 + 备用入口' },
]

const STATS = [
  { value: '10+', label: '数据源' },
  { value: '近5年', label: '默认范围' },
  { value: 'AI', label: '智能筛选' },
]

// 仿真 App 预览中的小论文卡片
function MiniCard({ bar, title, badge, badgeColor, cite }: {
  bar: string; title: string; badge: string; badgeColor: string; cite: string
}) {
  return (
    <div className="relative bg-white rounded-lg border border-gray-100 px-3 py-2 overflow-hidden shadow-sm">
      <div className={`absolute inset-y-0 left-0 w-[3px] ${bar}`} />
      <div className="pl-1">
        <div className="text-[9px] font-semibold text-gray-800 leading-tight mb-1 line-clamp-1">{title}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full border font-medium ${badgeColor}`}>{badge}</span>
          <span className="text-[8px] text-gray-400">{cite}</span>
          <div className="ml-auto flex gap-1">
            <span className="text-[7px] px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-600 font-medium">Scholar</span>
            <span className="text-[7px] px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-600 font-medium">AI 对话</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function KeySetupScreen({ onKeySubmit }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const line1 = useTypewriter(LINE1, 400)
  const line2 = useTypewriter(LINE2, L1_END + 180)

  const handleSubmit = () => {
    const t = input.trim()
    if (!t.startsWith('sk-')) { setError('Key 格式不正确，应以 sk- 开头'); return }
    setError('')
    onKeySubmit(t)
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
          50%      { transform: translateY(-10px); }
        }
        @keyframes glowPulse {
          0%,100% { opacity: .18; transform: scale(1); }
          50%      { opacity: .30; transform: scale(1.08); }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(14px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        .gradient-bg {
          background: linear-gradient(-45deg,#0f172a,#1e1b4b,#0c1445,#1e3a8a,#0f172a);
          background-size: 400% 400%;
          animation: gradientFlow 14s ease infinite;
        }
        .float-logo { animation: floatY 4s ease-in-out infinite; }
        .glow-blue   { animation: glowPulse 7s ease-in-out infinite; }
        .glow-purple { animation: glowPulse 9s ease-in-out infinite 1s; }
        .glow-cyan   { animation: glowPulse 6s ease-in-out infinite 2s; }
        .fade-up { opacity:0; animation: fadeUp .5s ease forwards; }
        .cursor { animation: cursorBlink .9s step-end infinite; }
        .preview-float { animation: floatY 6s ease-in-out infinite; }
      `}</style>

      <div className="min-h-screen flex">

        {/* ── 左侧 ─────────────────────────────────────── */}
        <div className="hidden lg:flex w-[56%] gradient-bg flex-col justify-between p-12 text-white relative overflow-hidden">

          {/* 三色辉光球 */}
          <div className="glow-blue absolute -top-20 -right-20 w-[480px] h-[480px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="glow-purple absolute -bottom-32 -left-20 w-[520px] h-[520px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)', filter: 'blur(80px)' }} />
          <div className="glow-cyan absolute top-1/3 right-1/4 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #22d3ee 0%, transparent 70%)', filter: 'blur(60px)' }} />

          {/* Logo */}
          <div className="relative z-10 flex items-center gap-3">
            <div className="float-logo w-11 h-11 rounded-xl bg-white/10 border border-white/20 backdrop-blur flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">ScholarScout</span>
          </div>

          {/* 超大打字机标题 + App 预览 */}
          <div className="relative z-10 flex-1 flex flex-col justify-center py-6">

            {/* 标题 */}
            <h2 className="text-7xl font-black leading-[1.05] tracking-tight mb-6" style={{ minHeight: '8.5rem' }}>
              <span className="block">{line1}{line1.length < LINE1.length && <span className="cursor text-blue-300">|</span>}</span>
              <span className="block bg-gradient-to-r from-white via-blue-100 to-cyan-200 bg-clip-text text-transparent">
                {line2}{line1.length >= LINE1.length && line2.length < LINE2.length && <span className="cursor text-blue-300">|</span>}
              </span>
            </h2>

            {/* App 预览窗口 */}
            <div
              className="preview-float fade-up w-full max-w-[420px]"
              style={{ animationDelay: `${L1_END + LINE2.length * 70 + 300}ms` }}
            >
              {/* macOS 风格窗口边框 */}
              <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10" style={{ boxShadow: '0 25px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08)' }}>
                {/* 标题栏 */}
                <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-100/95 border-b border-gray-200">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  <div className="flex-1 mx-3">
                    <div className="bg-white border border-gray-200 rounded px-2 py-0.5 text-[9px] text-gray-400 text-center truncate">
                      RAG · retrieval augmented generation — ScholarScout
                    </div>
                  </div>
                </div>
                {/* App 内容 */}
                <div className="bg-slate-50 px-3 pt-2 pb-3 space-y-1.5">
                  {/* 统计行 */}
                  <div className="text-[8px] text-gray-400 pb-1">
                    共找到 <span className="text-gray-700 font-semibold">47</span> 篇 · AI 筛选保留 <span className="text-blue-600 font-semibold">12</span> 篇 · 过滤 35 篇低相关
                  </div>
                  <MiniCard
                    bar="bg-green-500"
                    title="Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
                    badge="arXiv" badgeColor="bg-green-50 text-green-700 border-green-200"
                    cite="引用 6,842"
                  />
                  <MiniCard
                    bar="bg-blue-500"
                    title="REALM: Retrieval-Augmented Language Model Pre-Training"
                    badge="Semantic Scholar" badgeColor="bg-blue-50 text-blue-700 border-blue-200"
                    cite="引用 2,341"
                  />
                  {/* 第三张半截，暗示更多内容 */}
                  <div className="relative bg-white rounded-lg border border-gray-100 px-3 py-2 overflow-hidden shadow-sm opacity-60">
                    <div className="absolute inset-y-0 left-0 w-[3px] bg-violet-500" />
                    <div className="pl-1 text-[9px] font-semibold text-gray-700 line-clamp-1">
                      Dense Passage Retrieval for Open-Domain Question Answering
                    </div>
                  </div>
                  {/* 渐变遮罩暗示更多 */}
                  <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none" style={{ background: 'linear-gradient(to bottom, transparent, #f8fafc)' }} />
                </div>
              </div>
            </div>

          </div>

          {/* 特性列表（2列紧凑）+ 底部链接 */}
          <div className="relative z-10">
            <div
              className="fade-up grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6"
              style={{ animationDelay: `${L1_END + LINE2.length * 70 + 700}ms` }}
            >
              {FEATURES.map(f => (
                <div key={f.text} className="flex items-start gap-2">
                  <span className="text-sm mt-0.5 flex-shrink-0">{f.icon}</span>
                  <span className="text-blue-100 text-xs leading-snug">{f.text}</span>
                </div>
              ))}
            </div>

            <div
              className="fade-up flex items-center gap-5 text-sm text-blue-400"
              style={{ animationDelay: `${L1_END + LINE2.length * 70 + 900}ms` }}
            >
              <a href="http://118.25.192.117" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">在线体验 →</a>
              <span className="text-blue-800">|</span>
              <a href="https://github.com/Dshuishui/ScholarScout" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">GitHub 开源</a>
            </div>
          </div>
        </div>

        {/* ── 右侧 ─────────────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden" style={{ background: '#f8fafc' }}>
          {/* 左上角淡蓝辉光 */}
          <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #bfdbfe 0%, transparent 70%)', filter: 'blur(60px)', opacity: .6 }} />

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
                <div key={s.label} className="flex items-center gap-1 text-xs bg-white border border-slate-200 rounded-full px-2.5 py-1 shadow-sm">
                  <span className="font-bold text-slate-700">{s.value}</span>
                  <span className="text-slate-400">{s.label}</span>
                </div>
              ))}
            </div>

            {/* 输入框 */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">DeepSeek API Key</label>
              <input
                type="password"
                value={input}
                onChange={e => { setInput(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder-gray-300 transition-all focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.08)] shadow-sm"
              />
              {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
            </div>

            {/* 按钮 */}
            <button
              onClick={handleSubmit}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl py-3 text-sm font-semibold transition-all shadow-md shadow-blue-200/60 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40"
            >
              开始探索论文 →
            </button>

            <p className="text-center text-xs text-gray-400 mt-6">
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
