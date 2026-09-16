import { useState, useEffect } from 'react'
import { DEEPSEEK_MODELS, useModel } from '../hooks/useModel'
import { useAccess } from '../hooks/useAccess'
import type { GateReason } from '../hooks/useAccess'
import { useAuth } from '../hooks/useAuth'
import { AuthModal } from './AuthModal'
import { LegalModal } from './LegalModal'
import { track } from '../lib/analytics'
import { useBackToClose } from '../hooks/useBackToClose'

// 次数用完 / 功能需要 Key / 用户主动点开时的引导窗口：注册领免费次数，或填写自己的 DeepSeek Key。
// 以前这是进站前必须经过的整页，访客不填 Key 就用不了，现在改成按需弹出。

const SAVED_KEYS_STORAGE = 'scholarscout_saved_keys'

interface SavedKey { key: string; lastUsed: number }

const loadSavedKeys = (): SavedKey[] => {
  try { return JSON.parse(localStorage.getItem(SAVED_KEYS_STORAGE) ?? '[]') }
  catch { return [] }
}

const persistKey = (key: string) => {
  try {
    const list = loadSavedKeys().filter(k => k.key !== key)
    localStorage.setItem(SAVED_KEYS_STORAGE, JSON.stringify([{ key, lastUsed: Date.now() }, ...list].slice(0, 5)))
  } catch { /* ignore */ }
}

const maskKey = (key: string) => `sk-···${key.slice(-4)}`

function headline(reason: GateReason, feature: string | undefined, signupBonus: number, canSignup: boolean) {
  const signupHint = canSignup && signupBonus > 0 ? `注册账号再送 ${signupBonus} 次免费搜索，或` : ''
  switch (reason) {
    case 'trial_exhausted':
      return { title: '免费体验次数用完了', desc: `${signupHint}填写自己的 DeepSeek API Key 继续使用。已经搜到的结果会保留在页面上。` }
    case 'credits_exhausted':
      return { title: '免费搜索次数用完了', desc: '填写自己的 DeepSeek API Key 即可继续使用，已经搜到的结果会保留在页面上。' }
    case 'trial_capacity':
      return { title: '今天的免费体验名额已满', desc: `${signupHint}填写自己的 DeepSeek API Key 继续使用，明天也可以再来试试。` }
    case 'key_required':
      return { title: '需要 DeepSeek API Key', desc: `${signupHint}填写自己的 DeepSeek API Key 后使用。` }
    case 'feature':
      return {
        title: `${feature ?? '这个功能'}需要你自己的 Key`,
        desc: feature === '论文对话'
          ? '免费对话条数已经用完。填写自己的 DeepSeek API Key 可以不限条数使用，还能基于上传的 PDF 全文回答。'
          : '多论文分析、多文献问答由你的浏览器直接调用 DeepSeek，需要填写自己的 API Key。论文搜索和单篇论文对话有免费额度，不需要 Key。',
      }
    default:
      return { title: '使用方式', desc: '免费次数用完后，填写自己的 DeepSeek API Key 即可不限次数使用。Key 只保存在你的浏览器里。' }
  }
}

export function AccessModal() {
  const { gate, closeGate, apiKey, hasKey, setApiKey, clearApiKey, mode, freeRemaining, trial } = useAccess()
  const { isLoggedIn, user, logout } = useAuth()
  const [authTab, setAuthTab] = useState<'login' | 'register' | null>(null)
  const [showLegal, setShowLegal] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [savedKeys, setSavedKeys] = useState<SavedKey[]>(() => loadSavedKeys())
  const { model: selectedModel, setModel: handleModelChange } = useModel()
  useBackToClose(!!gate && !authTab, closeGate)

  useEffect(() => {
    if (!gate || authTab || showLegal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeGate() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gate, authTab, showLegal, closeGate])

  if (!gate) return null

  if (authTab) {
    return <AuthModal defaultTab={authTab} onClose={() => { setAuthTab(null); closeGate() }} />
  }

  const canSignup = !isLoggedIn && trial.enabled
  const { title, desc } = headline(gate.reason, gate.feature, trial.signupBonus, canSignup)
  const showSignup = canSignup && trial.signupBonus > 0 && gate.reason !== 'feature'

  const applyKey = (key: string, source: 'input' | 'saved') => {
    persistKey(key)
    setApiKey(key)
    track('key_saved', { source, reason: gate.reason })
    closeGate()
  }

  const removeSavedKey = (key: string) => {
    const updated = loadSavedKeys().filter(k => k.key !== key)
    try { localStorage.setItem(SAVED_KEYS_STORAGE, JSON.stringify(updated)) } catch { /* ignore */ }
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
      if (data.valid) applyKey(t, 'input')
      else setError(data.reason ?? 'Key 无效，请重新确认')
    } catch {
      setError('网络错误，请检查连接后重试')
    } finally {
      setIsValidating(false)
    }
  }

  const otherSavedKeys = savedKeys.filter(k => k.key !== apiKey)

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:px-4"
        onClick={closeGate}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-modal-title"
          className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl px-5 pt-5 sm:px-6 sm:pt-6"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 id="access-modal-title" className="text-base font-semibold text-gray-900">{title}</h2>
            <button onClick={closeGate} aria-label="关闭" className="-mt-1 -mr-1 p-1 text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>
          <p className="text-[13px] text-gray-500 leading-relaxed mb-4">{desc}</p>

          {/* 当前状态（主动打开时） */}
          {gate.reason === 'manual' && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 mb-4 text-sm">
              {mode === 'own_key' ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-600">正在使用自己的 Key <span className="font-mono text-gray-500">{maskKey(apiKey)}</span></span>
                  <button onClick={() => { clearApiKey(); track('key_removed') }} className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0">移除</button>
                </div>
              ) : (
                <span className="text-gray-600">
                  {mode === 'account_trial' ? '账号' : '免费体验'}剩余 <b className="text-indigo-600">{freeRemaining ?? 0}</b> 次免费搜索
                </span>
              )}
              {isLoggedIn && (
                <div className="flex items-center justify-between gap-2 mt-1.5 text-xs text-gray-400">
                  <span className="truncate">当前账号：{user?.email}</span>
                  <button onClick={logout} className="underline hover:text-gray-600 flex-shrink-0">退出登录</button>
                </div>
              )}
            </div>
          )}

          {/* 注册领免费次数 */}
          {showSignup && (
            <div className="rounded-2xl border border-indigo-200 p-4 mb-4"
              style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 60%, #fdf4ff 100%)' }}>
              <p className="font-semibold text-indigo-700 text-sm mb-1">⚡ 注册再送 {trial.signupBonus} 次免费搜索</p>
              <p className="text-xs text-indigo-600/80 mb-3 leading-relaxed">验证邮箱后到账，还能同步收藏、搜索快照和订阅推送。</p>
              <button
                onClick={() => { track('gate_register_click', { reason: gate.reason }); setAuthTab('register') }}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
              >免费注册</button>
              <p className="text-center text-xs text-indigo-400 mt-2">
                已有账号？
                <button onClick={() => { track('gate_login_click', { reason: gate.reason }); setAuthTab('login') }}
                  className="underline ml-1 hover:text-indigo-600">登录</button>
              </p>
            </div>
          )}

          {showSignup && (
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 flex-shrink-0">或使用自己的 Key</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          )}

          {/* 历史 Key */}
          {otherSavedKeys.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5">之前用过的 Key</p>
              <div className="space-y-1.5">
                {otherSavedKeys.map(({ key }) => (
                  <div key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                    <span className="flex-1 text-sm font-mono text-gray-500">{maskKey(key)}</span>
                    <button onClick={() => applyKey(key, 'saved')} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1">使用</button>
                    <button onClick={() => removeSavedKey(key)} aria-label="删除" className="text-xs text-gray-300 hover:text-gray-500 px-1.5 py-1">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 输入 Key */}
          <label className="block text-sm font-semibold text-gray-600 mb-1.5" htmlFor="access-key-input">
            {hasKey ? '更换 DeepSeek API Key' : 'DeepSeek API Key'}
          </label>
          <div className="flex gap-2">
            <input
              id="access-key-input"
              type="password"
              autoComplete="off"
              value={input}
              onChange={e => { setInput(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !isValidating) handleSubmit() }}
              placeholder="sk-xxxxxxxxxxxxxxxx"
              className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-base sm:text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              onClick={handleSubmit}
              disabled={isValidating || !input.trim()}
              className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl px-4 text-sm font-semibold transition-colors"
            >{isValidating ? '验证中…' : '使用'}</button>
          </div>
          {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">
            Key 只保存在你的浏览器里。还没有 Key？
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer"
              className="text-blue-500 hover:underline ml-0.5">去 DeepSeek 开放平台创建 →</a>
          </p>

          {/* 论文对话模型 */}
          <details className="mt-4 group">
            <summary className="text-xs text-gray-500 cursor-pointer select-none hover:text-gray-700">
              论文对话模型：{DEEPSEEK_MODELS.find(m => m.id === selectedModel)?.name ?? selectedModel}
            </summary>
            <p className="text-[11px] text-gray-400 mt-1.5 mb-2">只影响论文对话，搜索固定使用 Flash</p>
            <div className="grid grid-cols-2 gap-2">
              {DEEPSEEK_MODELS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModelChange(m.id)}
                  className={`text-left p-2.5 rounded-xl border transition-colors ${
                    selectedModel === m.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200'
                  }`}
                >
                  <p className={`text-xs font-semibold ${selectedModel === m.id ? 'text-blue-700' : 'text-gray-800'}`}>{m.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{m.desc}</p>
                </button>
              ))}
            </div>
          </details>

          <button onClick={() => setShowLegal(true)} className="mt-4 w-full text-center text-xs text-gray-400 hover:text-blue-500 transition-colors">
            隐私政策 · 服务条款
          </button>
        </div>
      </div>
      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
    </>
  )
}
