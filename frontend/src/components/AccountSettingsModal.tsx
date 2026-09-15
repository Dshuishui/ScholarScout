import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { toast } from './Toast'

interface Props {
  onClose: () => void
  onOpenLegal: () => void
}

async function readError(r: Response, fallback: string): Promise<string> {
  const data = await r.json().catch(() => null)
  return (data && typeof data.detail === 'string') ? data.detail : fallback
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export function AccountSettingsModal({ onClose, onOpenLegal }: Props) {
  const { user, token, loginWithToken, logout } = useAuth()

  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwdLoading, setPwdLoading] = useState(false)

  const [exporting, setExporting] = useState(false)

  const [showDelete, setShowDelete] = useState(false)
  const [deletePwd, setDeletePwd] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!user || !token) return null
  const authHeader = { Authorization: `Bearer ${token}` }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdMsg(null)
    setPwdLoading(true)
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      })
      if (!r.ok) {
        setPwdMsg({ ok: false, text: await readError(r, '修改失败，请稍后重试') })
        return
      }
      const data = await r.json()
      await loginWithToken(data.access_token)  // 旧凭证已失效，换成新凭证继续保持登录
      setCurrentPwd('')
      setNewPwd('')
      setPwdMsg({ ok: true, text: '密码已修改，其他设备上的登录已失效' })
    } catch {
      setPwdMsg({ ok: false, text: '网络错误，请稍后重试' })
    } finally {
      setPwdLoading(false)
    }
  }

  const exportData = async () => {
    setExporting(true)
    try {
      const r = await fetch('/api/auth/export', { headers: authHeader })
      if (!r.ok) {
        toast.show(await readError(r, '导出失败，请稍后重试'))
        return
      }
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `scholarscout-my-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.show('导出失败，请检查网络后重试')
    } finally {
      setExporting(false)
    }
  }

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setDeleteError('')
    setDeleting(true)
    try {
      const r = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ password: deletePwd }),
      })
      if (!r.ok) {
        setDeleteError(await readError(r, '注销失败，请稍后重试'))
        return
      }
      logout()
      onClose()
      toast.show('账号已注销，相关数据已删除')
    } catch {
      setDeleteError('网络错误，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">账号设置</h2>
          <button onClick={onClose} aria-label="关闭" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-400 mb-5 truncate">{user.email}</p>

        {/* 修改密码 */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">修改密码</h3>
          <form onSubmit={changePassword} className="space-y-2.5">
            <input type="password" autoComplete="current-password" placeholder="当前密码" required
              value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} className={inputCls} />
            <input type="password" autoComplete="new-password" placeholder="新密码（至少 8 位）" required minLength={8}
              value={newPwd} onChange={e => setNewPwd(e.target.value)} className={inputCls} />
            {pwdMsg && (
              <p className={`text-xs rounded-lg px-3 py-2 ${pwdMsg.ok ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>{pwdMsg.text}</p>
            )}
            <button type="submit" disabled={pwdLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {pwdLoading ? '请稍候…' : '修改密码'}
            </button>
          </form>
        </section>

        {/* 导出数据 */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">导出我的数据</h3>
          <p className="text-xs text-gray-500 mb-2.5 leading-relaxed">下载服务器上保存的你的全部数据（收藏、阅读记录、AI 对话、搜索快照、订阅、留言），JSON 格式。</p>
          <button onClick={exportData} disabled={exporting}
            className="w-full border border-gray-200 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 rounded-lg py-2 text-sm font-medium transition-colors">
            {exporting ? '正在导出…' : '导出数据'}
          </button>
        </section>

        {/* 注销账号 */}
        <section className="border-t border-gray-100 pt-5">
          <h3 className="text-sm font-semibold text-red-600 mb-1">注销账号</h3>
          <p className="text-xs text-gray-500 mb-2.5 leading-relaxed">
            将永久删除账号及收藏、阅读记录、AI 对话、搜索快照和订阅，<b>无法恢复</b>。留言板上的留言会保留内容但显示为匿名。建议先导出数据。
          </p>
          {!showDelete ? (
            <button onClick={() => setShowDelete(true)}
              className="w-full border border-red-200 text-red-600 hover:bg-red-50 rounded-lg py-2 text-sm font-medium transition-colors">
              注销账号…
            </button>
          ) : (
            <form onSubmit={deleteAccount} className="space-y-2.5">
              <input type="password" autoComplete="current-password" placeholder="输入密码确认身份" required
                value={deletePwd} onChange={e => setDeletePwd(e.target.value)} className={inputCls} />
              <input placeholder="输入「注销」两个字确认" required
                value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} className={inputCls} />
              {deleteError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{deleteError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowDelete(false); setDeletePwd(''); setDeleteConfirm(''); setDeleteError('') }}
                  className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2 text-sm transition-colors">取消</button>
                <button type="submit" disabled={deleting || deleteConfirm.trim() !== '注销'}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors">
                  {deleting ? '正在注销…' : '永久注销'}
                </button>
              </div>
            </form>
          )}
        </section>

        <button onClick={onOpenLegal} className="mt-5 w-full text-center text-xs text-gray-400 hover:text-blue-500 transition-colors">
          隐私政策 · 服务条款
        </button>
      </div>
    </div>
  )
}
