import { track } from '../lib/analytics'

// 知网、万方、维普没有开放接口，我们搜不到它们独有的论文：给好跳转链接，用户点一下就在那边搜同样的词
const DATABASES: { name: string; url: (q: string) => string }[] = [
  { name: '知网', url: q => `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodeURIComponent(q)}` },
  { name: '万方', url: q => `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(q)}` },
  { name: '维普', url: q => `https://www.cqvip.com/search?k=${encodeURIComponent(q)}` },
  { name: '百度学术', url: q => `https://xueshu.baidu.com/s?wd=${encodeURIComponent(q)}` },
]

interface Props {
  keywords: string[]
  /** 没搜到论文时更醒目，并换一句说明 */
  prominent?: boolean
}

export function ChineseDbLinks({ keywords, prominent = false }: Props) {
  if (keywords.length === 0) return null
  const q = keywords.join(' ')
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${prominent ? 'justify-center' : ''}`}>
      <span className={prominent ? 'text-gray-500 w-full text-center mb-1' : 'text-gray-400'}>
        {prominent ? '去中文库里搜搜看：' : '知网、万方里的中文论文这里搜不到，可以直接去搜：'}
      </span>
      {DATABASES.map(db => (
        <a
          key={db.name}
          href={db.url(q)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('zh_db_link', { db: db.name })}
          className="inline-flex items-center gap-0.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-full px-2.5 py-0.5 transition-colors"
        >
          {db.name}
          <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      ))}
    </div>
  )
}
