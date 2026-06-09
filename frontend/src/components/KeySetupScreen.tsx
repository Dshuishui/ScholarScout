import { useState, useEffect } from 'react'
import { DEEPSEEK_MODELS, DEFAULT_MODEL } from '../hooks/useModel'
import { FeedbackWidget } from './FeedbackWidget'
import { RedPandaWidget } from './RedPandaWidget'
import { AuthModal } from './AuthModal'
import { useAuth } from '../hooks/useAuth'

const MODEL_STORAGE_KEY = 'scholarscout_model'

interface Props {
  onKeySubmit: (key: string) => void
  onGuestEnter?: () => void
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

// 左侧底部 4 个特性卡片（2×2）
const FEATURES = [
  { icon: '⚡', title: '10 源并发', detail: '10 个数据库同时搜索' },
  { icon: '✦', title: 'AI 精准筛选', detail: '过滤低相关论文' },
  { icon: '💬', title: '论文对话', detail: '独立上下文深度解析' },
  { icon: '📄', title: 'PDF 查找', detail: '8 个备用平台入口' },
]



const SAVED_KEYS_STORAGE = 'scholarscout_saved_keys'

interface SavedKey { key: string; lastUsed: number }

const loadSavedKeys = (): SavedKey[] => {
  try { return JSON.parse(localStorage.getItem(SAVED_KEYS_STORAGE) ?? '[]') }
  catch { return [] }
}

const persistKey = (key: string) => {
  const list = loadSavedKeys().filter(k => k.key !== key)
  localStorage.setItem(SAVED_KEYS_STORAGE,
    JSON.stringify([{ key, lastUsed: Date.now() }, ...list].slice(0, 5)))
}

const maskKey = (key: string) => `sk-···${key.slice(-4)}`

export function KeySetupScreen({ onKeySubmit, onGuestEnter }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [savedKeys, setSavedKeys] = useState<SavedKey[]>(() => loadSavedKeys())
  const [selectedModel, setSelectedModel] = useState<string>(
    () => localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL
  )
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('register')
  const { isLoggedIn, user, logout } = useAuth()
  const hasExhaustedTrial = isLoggedIn && (user?.freeSearches ?? 0) === 0

  const handleModelChange = (id: string) => {
    localStorage.setItem(MODEL_STORAGE_KEY, id)
    setSelectedModel(id)
  }
  const line1 = useTypewriter(LINE1, 400)
  const line2 = useTypewriter(LINE2, L1_END + 180)

  const useSavedKey = (key: string) => {
    persistKey(key)
    onKeySubmit(key)
  }

  const removeSavedKey = (key: string) => {
    const updated = loadSavedKeys().filter(k => k.key !== key)
    localStorage.setItem(SAVED_KEYS_STORAGE, JSON.stringify(updated))
    setSavedKeys(updated)
  }

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
        persistKey(t)
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
        @keyframes floatY {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes glowDrift {
          0%,100% { opacity:.22; transform:scale(1) translate(0,0); }
          33%      { opacity:.35; transform:scale(1.08) translate(20px,-15px); }
          66%      { opacity:.18; transform:scale(0.95) translate(-10px,10px); }
        }
        @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeIn {
          from { opacity:0; transform:translateY(12px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes cardIn {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .float-logo    { animation: floatY 4s ease-in-out infinite; }
        .glow-blue     { animation: glowDrift  9s ease-in-out infinite; }
        .glow-purple   { animation: glowDrift 12s ease-in-out infinite 2s; }
        .glow-cyan     { animation: glowDrift  7s ease-in-out infinite 4s; }
        .cursor        { animation: cursorBlink .9s step-end infinite; }
        .anim-in       { animation: fadeIn .7s ease forwards; opacity:0; }
        .card-in       { animation: cardIn .5s ease forwards; opacity:0; }
        .screenshot-tilt {
          transform: perspective(1100px) rotateY(-6deg) rotateX(2deg);
          transition: transform .7s ease;
        }
        .screenshot-tilt:hover {
          transform: perspective(1100px) rotateY(-2deg) rotateX(0deg);
        }
      `}</style>

      <div className="min-h-screen flex">

        {/* ══ 左侧 62% ══════════════════════════════════════ */}
        <div className="hidden lg:flex w-[62%] flex-col p-10 text-white relative overflow-hidden"
          style={{ backgroundColor: '#06060f', backgroundImage: 'radial-gradient(ellipse 75% 55% at 15% 10%, rgba(99,60,220,0.45) 0%, transparent 60%), radial-gradient(ellipse 55% 50% at 88% 88%, rgba(37,99,235,0.35) 0%, transparent 55%), radial-gradient(ellipse 45% 45% at 60% 42%, rgba(168,85,247,0.22) 0%, transparent 52%)' }}>

          {/* 网格底纹 */}
          <div className="absolute inset-0 pointer-events-none z-0"
            style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)', backgroundSize: '52px 52px' }} />

          {/* Noise 纹理 */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ opacity: 0.045 }} aria-hidden="true">
            <filter id="ss-noise">
              <feTurbulence type="fractalNoise" baseFrequency="0.68" numOctaves="3" stitchTiles="stitch"/>
              <feColorMatrix type="saturate" values="0"/>
            </filter>
            <rect width="100%" height="100%" filter="url(#ss-noise)"/>
          </svg>

          {/* 辉光球 */}
          <div className="glow-blue absolute -top-16 -right-16 w-[480px] h-[480px] rounded-full pointer-events-none z-0"
            style={{ background: 'radial-gradient(circle,rgba(59,130,246,0.7) 0%,transparent 68%)', filter: 'blur(80px)' }} />
          <div className="glow-purple absolute -bottom-28 -left-20 w-[520px] h-[520px] rounded-full pointer-events-none z-0"
            style={{ background: 'radial-gradient(circle,rgba(124,58,237,0.65) 0%,transparent 68%)', filter: 'blur(100px)' }} />
          <div className="glow-cyan absolute top-[38%] right-[18%] w-48 h-48 rounded-full pointer-events-none z-0"
            style={{ background: 'radial-gradient(circle,rgba(34,211,238,0.5) 0%,transparent 68%)', filter: 'blur(55px)' }} />

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
          <div className="relative z-10 mt-6 mb-4">
            <h2 className="text-7xl font-black leading-[1.05]" style={{ minHeight: '8rem', letterSpacing: '-0.03em' }}>
              <span className="block">{line1}{line1.length < LINE1.length && <span className="cursor text-blue-300">|</span>}</span>
              <span className="block bg-gradient-to-r from-white via-blue-100 to-cyan-300 bg-clip-text text-transparent">
                {line2}{line1.length >= LINE1.length && line2.length < LINE2.length && <span className="cursor text-blue-300">|</span>}
              </span>
            </h2>
            <p className="anim-in text-white/50 text-base mt-3 leading-relaxed"
              style={{ animationDelay: `${L1_END + LINE2.length * 70 + 200}ms` }}>
              AI 驱动 · 自然语言描述 · 秒级返回结果
            </p>
          </div>

          {/* ③ App 预览窗口 */}
          <div className="anim-in relative z-10 mb-5"
            style={{ animationDelay: `${L1_END + LINE2.length * 70 + 350}ms` }}>
            {/* 底部辉光 */}
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 w-3/4 h-10 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse, rgba(99,60,220,0.65) 0%, transparent 70%)', filter: 'blur(18px)' }} />
            {/* 3D 倾斜容器 */}
            <div className="screenshot-tilt relative"
              style={{ borderRadius: '12px', boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 28px 80px rgba(99,60,220,0.45), 0 6px 24px rgba(0,0,0,0.7)' }}>
              {/* 顶部高光线 */}
              <div className="absolute top-0 left-0 right-0 h-px z-10 rounded-t-xl"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)' }} />
              <div className="rounded-xl overflow-hidden">
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
          </div>

          {/* ④ 特性卡片一行 + 链接 */}
          <div className="relative z-10">
            <div className="grid grid-cols-4 gap-2 mb-5">
              {FEATURES.map((f, i) => (
                <div key={f.title}
                  className="card-in relative border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm rounded-xl p-3 overflow-hidden hover:border-purple-400/30 transition-all duration-300"
                  style={{ animationDelay: `${L1_END + LINE2.length * 70 + 650 + i * 80}ms` }}>
                  {/* 顶部高光线 */}
                  <div className="absolute top-0 left-0 right-0 h-px"
                    style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.55), transparent)' }} />
                  <div className="text-xl mb-1.5">{f.icon}</div>
                  <p className="text-sm font-semibold text-white/90 leading-snug">{f.title}</p>
                  <p className="text-xs text-blue-300/80 mt-0.5 leading-snug">{f.detail}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-5 text-sm text-white/40">
              <button
                onClick={onGuestEnter}
                className="hover:text-white transition-colors"
              >在线体验 →</button>
              <span className="text-white/15">|</span>
              <a href="https://github.com/Dshuishui/ScholarScout" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">GitHub 开源</a>
            </div>
          </div>
        </div>

        {/* ══ 右侧 38% ══════════════════════════════════════ */}
        <div className="flex-1 flex flex-col px-8 py-10 relative overflow-hidden"
          style={{ background: '#f8fafc' }}>
          {/* 左上角淡蓝辉光 */}
          <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle,#bfdbfe 0%,transparent 70%)', filter: 'blur(60px)', opacity: .7 }} />

          <div className="w-full max-w-sm mx-auto flex flex-col flex-1 relative z-10">

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
            <h2 className="text-5xl font-black mb-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent leading-tight">
              开始你的<br />学术探索
            </h2>
            <p className="text-gray-400 text-sm mb-5 leading-relaxed">
              AI 驱动 · 自然语言描述 · 10 个数据库并发搜索
            </p>

            {/* ── 免费试用额度已用完提示（已登录 + 0 次）────────────────────── */}
            {hasExhaustedTrial && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-amber-700">⚡ 免费额度已用完</span>
                  <button
                    onClick={logout}
                    className="text-xs text-amber-500 hover:text-amber-700 underline transition-colors"
                  >切换账号</button>
                </div>
                <p className="text-xs text-amber-600/80 mb-0.5">当前账号：{user?.email}</p>
                <p className="text-xs text-amber-600/70">输入自己的 DeepSeek API Key 即可无限使用。</p>
              </div>
            )}

            {/* ── 免费体验卡片（未登录）────────────────────────────────────── */}
            {!isLoggedIn && (
              <>
                <div className="relative rounded-2xl border border-indigo-200 overflow-hidden mb-4"
                  style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 60%, #fdf4ff 100%)' }}>
                  {/* 右上角装饰辉光 */}
                  <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.35) 0%, transparent 70%)', filter: 'blur(16px)' }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">⚡</span>
                      <span className="font-bold text-indigo-700 text-base">免费体验 3 次搜索</span>
                    </div>
                    <p className="text-xs text-indigo-600/80 mb-4 leading-relaxed">
                      注册并验证邮箱，立即获得 3 次免费搜索额度，<br />无需配置任何 API Key 即可体验全部功能。
                    </p>
                    <button
                      onClick={() => { setAuthModalTab('register'); setShowAuthModal(true) }}
                      className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-all shadow-md shadow-indigo-200/60 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-300/40"
                    >
                      免费注册开始体验 →
                    </button>
                    <p className="text-center text-xs text-indigo-400 mt-2.5">
                      已有账号？
                      <button
                        onClick={() => { setAuthModalTab('login'); setShowAuthModal(true) }}
                        className="underline ml-1 hover:text-indigo-600 transition-colors"
                      >登录</button>
                    </p>
                  </div>
                </div>

                {/* 分隔线 */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 flex-shrink-0">或使用自己的 Key</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              </>
            )}

            {/* 历史 Key */}
            {savedKeys.length > 0 && (
              <div className="mb-3">
                <p className="text-sm text-gray-400 mb-2">历史 Key</p>
                <div className="space-y-1.5">
                  {savedKeys.map(({ key }) => (
                    <div key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5 group hover:border-blue-200 transition-colors">
                      <span className="flex-1 text-sm font-mono text-gray-500 tracking-wide">
                        {maskKey(key)}
                      </span>
                      <button
                        onClick={() => useSavedKey(key)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-1.5 flex-shrink-0"
                      >
                        使用
                      </button>
                      <button
                        onClick={() => removeSavedKey(key)}
                        className="text-xs text-gray-300 hover:text-gray-500 flex-shrink-0 leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 输入框 */}
            <div className="mb-3">
              <label className="block text-sm font-semibold text-gray-600 mb-2">
                {savedKeys.length > 0 ? '输入新的 Key' : 'DeepSeek API Key'}
              </label>
              <input
                type="password"
                value={input}
                onChange={e => { setInput(e.target.value); setError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && !isValidating) handleSubmit() }}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder-gray-300 shadow-sm transition-all focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
              {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
            </div>

            {/* 模型选择 — 卡片式 */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-600 mb-2">
                论文 AI 对话模型
                <span className="ml-1.5 text-xs font-normal text-gray-400">仅影响论文对话，搜索始终用 Flash</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {DEEPSEEK_MODELS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModelChange(m.id)}
                    className={`text-left p-3 rounded-xl border transition-all focus:outline-none focus:ring-2 ${
                      selectedModel === m.id
                        ? 'border-blue-400 bg-blue-50 ring-blue-300/40 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/30 ring-transparent'
                    }`}
                  >
                    <p className={`text-sm font-semibold leading-tight ${selectedModel === m.id ? 'text-blue-700' : 'text-gray-800'}`}>
                      {m.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{m.desc}</p>
                  </button>
                ))}
              </div>
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

            <p className="text-center text-xs text-gray-400 mt-2.5">
              没有 Key？
              <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer"
                className="text-blue-500 hover:underline ml-1">免费注册 DeepSeek →</a>
            </p>

            {onGuestEnter && (
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 flex-shrink-0">或</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}
            {onGuestEnter && (
              <button
                onClick={onGuestEnter}
                className="w-full py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 text-sm font-medium transition-all"
              >
                不配置 Key，先进去看看 →
              </button>
            )}

            <div className="mt-auto pt-4 border-t border-gray-100 text-center space-y-1">
              <p className="text-sm text-gray-400">
                遇到问题或有改进建议？欢迎联系我 👋
              </p>
              <a href="mailto:dongyucong@sjtu.edu.cn"
                className="text-sm text-blue-500 hover:text-blue-700 hover:underline transition-colors block">
                dongyucong@sjtu.edu.cn
              </a>
              <p className="text-xs text-gray-300 pt-1">
                Built with{' '}
                <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer"
                  className="text-gray-400 hover:text-gray-600 transition-colors">Claude Code</a>
                {' '}· vibe coding ✨
              </p>
            </div>
          </div>
        </div>

      </div>

      {showAuthModal && (
        <AuthModal
          defaultTab={authModalTab}
          onClose={() => setShowAuthModal(false)}
        />
      )}
      <RedPandaWidget />
      <FeedbackWidget />
    </>
  )
}
