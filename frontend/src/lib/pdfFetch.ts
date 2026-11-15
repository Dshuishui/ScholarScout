import type { Paper } from '../types'

/* 先让浏览器直接下 arXiv 的 PDF：arXiv 允许跨域，用户自己的网络通常比我们的服务器快得多
 * （服务器下 arXiv 一篇 2MB 的 PDF 实测要近两分钟，批量下载时常超时）。页面 CSP 的 connect-src
 * 只放行了 arxiv.org 和 export.arxiv.org，其他站点仍走服务器代下（/api/download）。 */
export const DIRECT_PDF_TIMEOUT_MS = 40_000

const ARXIV_HOSTS = ['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']

/** 论文的 arXiv PDF 直链：pdf_url 是 arXiv 的，或 DOI 是 arXiv 的（10.48550/arXiv.<id>）；都不是返回 null */
export function arxivDirectUrl(paper: Pick<Paper, 'pdf_url' | 'doi'>): string | null {
  if (paper.pdf_url) {
    try {
      const u = new URL(paper.pdf_url)
      if (ARXIV_HOSTS.includes(u.hostname) && u.pathname.startsWith('/pdf/')) return `https://arxiv.org${u.pathname}`
    } catch { /* 不是合法 URL，看 DOI */ }
  }
  const m = /^10\.48550\/arxiv\.(.+)$/i.exec(paper.doi ?? '')
  return m ? `https://arxiv.org/pdf/${m[1]}` : null
}

/** 下载并确认真是 PDF（不少"PDF 链接"其实返回登录页或落地页） */
export async function fetchPdfBlob(url: string, timeoutMs: number): Promise<Blob> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(String(r.status))
    const blob = await r.blob()
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
    if (String.fromCharCode(...head) !== '%PDF-') throw new Error('not a pdf')
    return blob
  } finally {
    clearTimeout(timer)
  }
}

/** arXiv 论文先浏览器直连；不是 arXiv 或直连失败返回 null，调用方再走服务器代下 */
export async function fetchArxivDirect(paper: Pick<Paper, 'pdf_url' | 'doi'>): Promise<Blob | null> {
  const url = arxivDirectUrl(paper)
  if (!url) return null
  try {
    return await fetchPdfBlob(url, DIRECT_PDF_TIMEOUT_MS)
  } catch {
    return null
  }
}
