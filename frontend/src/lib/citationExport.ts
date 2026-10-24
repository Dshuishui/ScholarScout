import type { Paper } from '../types'

// 导出给文献管理软件：BibTeX（Zotero、EndNote、JabRef、知网研学、Overleaf 都能导入）和 RIS（EndNote、NoteExpress 更习惯这个）

const year = (p: Paper) => p.published_date?.slice(0, 4) ?? ''

const ARXIV_ID = /^\d{4}\.\d{4,5}(v\d+)?$/

/** BibTeX 里这些字符有特殊含义，原样写进去会让整个文件解析失败 */
function bibEscape(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}&%$#_])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 引用键：第一作者的姓 + 年份 + 标题第一个实词，如 vaswani2017attention；重复时加 a、b、c */
function citeKey(p: Paper, used: Set<string>): string {
  const last = (p.authors[0] ?? '').trim().split(/\s+/).pop() ?? ''
  const word = p.title.toLowerCase().split(/[^a-z0-9]+/)
    .find(w => w.length > 3 && !['with', 'from', 'that', 'this', 'towards', 'using', 'based'].includes(w)) ?? ''
  const base = (last.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '') || 'paper') + year(p) + word
  let key = base
  for (let i = 0; used.has(key); i++) key = base + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(i) : '')
  used.add(key)
  return key
}

export function toBibTeX(papers: Paper[], withNote = false): string {
  const used = new Set<string>()
  return papers.map(p => {
    const fields: [string, string][] = [['title', `{${bibEscape(p.title)}}`]]
    if (p.authors.length) fields.push(['author', bibEscape(p.authors.join(' and '))])
    if (year(p)) fields.push(['year', year(p)])
    if (p.venue) fields.push(['journal', bibEscape(p.venue)])
    // doi、url 在 BibLaTeX 里按原样读，转义了反而会把反斜杠带进 Zotero
    if (p.doi) fields.push(['doi', p.doi.replace(/[{}]/g, '')])
    if (ARXIV_ID.test(p.paper_id)) fields.push(['eprint', p.paper_id], ['archivePrefix', 'arXiv'])
    if (p.url) fields.push(['url', p.url.replace(/[{}]/g, '')])
    if (p.abstract) fields.push(['abstract', bibEscape(p.abstract)])
    if (withNote && p.relevance_reason) fields.push(['note', bibEscape(`AI 相关性分析：${p.relevance_reason}`)])
    const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')
    return `@${p.venue ? 'article' : 'misc'}{${citeKey(p, used)},\n${body}\n}`
  }).join('\n\n') + '\n'
}

export function toRIS(papers: Paper[], withNote = false): string {
  const one = (s: string) => s.replace(/\s+/g, ' ').trim()
  return papers.map(p => {
    const lines: string[] = [`TY  - ${p.venue ? 'JOUR' : 'GEN'}`, `TI  - ${one(p.title)}`]
    p.authors.forEach(a => lines.push(`AU  - ${one(a)}`))
    if (year(p)) lines.push(`PY  - ${year(p)}`)
    if (p.published_date && p.published_date.length >= 10) lines.push(`DA  - ${p.published_date.slice(0, 10).replace(/-/g, '/')}`)
    if (p.venue) lines.push(`T2  - ${one(p.venue)}`)
    if (p.doi) lines.push(`DO  - ${p.doi}`)
    if (p.url) lines.push(`UR  - ${p.url}`)
    if (p.pdf_url) lines.push(`L1  - ${p.pdf_url}`)
    if (p.abstract) lines.push(`AB  - ${one(p.abstract)}`)
    if (withNote && p.relevance_reason) lines.push(`N1  - AI 相关性分析：${one(p.relevance_reason)}`)
    lines.push('ER  - ')
    return lines.join('\r\n')
  }).join('\r\n\r\n') + '\r\n'
}

export function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
