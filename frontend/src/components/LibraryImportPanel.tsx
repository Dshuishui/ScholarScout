import { useRef, useState } from 'react'
import { toast } from './Toast'
import { track } from '../lib/analytics'

interface Direction {
  name: string
  keywords: string[]
}

interface Props<S> {
  token: string
  /** 已有订阅的关键词组合，用来标出"已订阅" */
  subscribed: string[][]
  onSubscribed: (sub: S) => void
}

const sameKeywords = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k.toLowerCase() === b[i].toLowerCase())

/** 上传 Zotero / EndNote 导出的文献库，AI 归纳出研究方向，一键订阅 */
export function LibraryImportPanel<S>({ token, subscribed, onSubscribed }: Props<S>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [directions, setDirections] = useState<Direction[] | null>(null)
  const [titleCount, setTitleCount] = useState(0)
  const [creating, setCreating] = useState<number | null>(null)

  const upload = async (file: File) => {
    setUploading(true)
    setDirections(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const r = await fetch('/api/subscriptions/suggest-from-library', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        toast.show(typeof data?.detail === 'string' ? data.detail : r.status === 413 ? '文件太大（上限 5 MB）' : '导入失败，请稍后重试')
        return
      }
      setDirections(data.directions ?? [])
      setTitleCount(data.titles ?? 0)
      track('library_import', { titles: data.titles ?? 0, directions: data.directions?.length ?? 0 })
    } catch {
      toast.show('网络错误，请稍后重试')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const subscribe = async (i: number, keywords: string[]) => {
    setCreating(i)
    try {
      const r = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keywords }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        toast.show(typeof data?.detail === 'string' ? data.detail : '订阅失败，请稍后重试')
        return
      }
      onSubscribed(data as S)
      toast.show('已订阅，明天 08:00 开始推送')
    } catch {
      toast.show('网络错误，请稍后重试')
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className="border border-dashed border-indigo-200 rounded-2xl p-4 mb-5 bg-indigo-50/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">从 Zotero / EndNote 导入研究兴趣</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            在 Zotero 里选中文献 → 右键「导出条目」→ 格式选 BibTeX 或 RIS，上传后 AI 帮你归纳成订阅关键词。
            只读取标题，文件不会保存。
          </p>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex-shrink-0 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
        >
          {uploading ? '正在归纳…' : '选择文件'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".bib,.ris,.csv,.txt"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
        />
      </div>

      {directions && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-gray-400">
            读到 {titleCount} 篇文献{directions.length ? `，归纳出 ${directions.length} 个方向：` : '，没能归纳出明确的方向，换一批文献试试'}
          </p>
          {directions.map((d, i) => {
            const done = subscribed.some(k => sameKeywords(k, d.keywords))
            return (
              <div key={i} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700">{d.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {d.keywords.map(k => (
                      <span key={k} className="text-[11px] text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">{k}</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => subscribe(i, d.keywords)}
                  disabled={done || creating !== null}
                  className="flex-shrink-0 text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors disabled:opacity-60 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                >
                  {done ? '已订阅' : creating === i ? '订阅中…' : '订阅'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
