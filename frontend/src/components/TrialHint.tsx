import { useAccess } from '../hooks/useAccess'

/** 空状态里的免费次数提示：告诉新访客不用注册、不用 Key 就能直接搜 */
export function TrialHint({ className = '' }: { className?: string }) {
  const { mode, freeRemaining, trial, openGate } = useAccess()
  if (mode === 'own_key' || !trial.loaded || !trial.enabled) return null

  const remaining = freeRemaining ?? 0
  if (remaining > 0) {
    return (
      <p className={`inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 ${className}`}>
        ⚡ {mode === 'anon_trial' ? `无需注册，可免费试搜 ${remaining} 次` : `账号剩余 ${remaining} 次免费搜索`}
      </p>
    )
  }
  return (
    <button
      onClick={() => openGate(mode === 'anon_trial' ? 'trial_exhausted' : 'credits_exhausted')}
      className={`inline-flex items-center gap-1 text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-full px-2.5 py-1 transition-colors ${className}`}
    >
      免费次数已用完，{mode === 'anon_trial' && trial.signupBonus > 0 ? `注册再送 ${trial.signupBonus} 次` : '填写 Key 继续使用'} →
    </button>
  )
}
