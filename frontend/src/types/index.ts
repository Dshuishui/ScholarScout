export interface Paper {
  paper_id: string
  title: string
  authors: string[]
  abstract?: string
  published_date?: string
  doi?: string
  pdf_url?: string
  url?: string
  source: string
  citations: number
  relevance_reason?: string
  relevance_score?: number
  tldr?: string
  source_links?: { source: string; url: string }[]
  venue?: string
  fallback_links?: { name: string; url: string }[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  papers?: Paper[]
  isLoading?: boolean
}

export type SearchProgressEvent = {
  type: 'progress'
  message: string
}

export type SearchDoneEvent = {
  type: 'done'
  papers: Paper[]
  rejected_papers?: Paper[]
  message: string
  /** 没有找到相关论文时本次不计次数，附带退还后的剩余次数 */
  refunded?: boolean
  remaining?: number
}

export type SearchErrorEvent = {
  type: 'error'
  message: string
  refunded?: boolean
  remaining?: number
}

/** 用免费次数搜索时，开始搜索前服务端告知扣减后的剩余次数 */
export type SearchQuotaEvent = {
  type: 'quota'
  remaining: number
  kind: 'anon' | 'account'
}

export type SearchChatEvent = {
  type: 'chat'
  message: string
}

export type SearchPdfFindingEvent = {
  type: 'pdf_finding'
  message: string
}

export type SearchPdfUpdateEvent = {
  type: 'pdf_update'
  updates: { paper_id: string; pdf_url: string | null; fallback_links: { name: string; url: string }[] }[]
  message: string
}

export type SearchStartEvent = {
  type: 'search_start'
  sources: string[]
  date_from?: string | null
  date_to?: string | null
}

export type SourceDoneEvent = {
  type: 'source_done'
  source: string
  count: number
}

export type SearchEvent = SearchQuotaEvent | SearchProgressEvent | SearchDoneEvent | SearchErrorEvent | SearchChatEvent | SearchPdfFindingEvent | SearchPdfUpdateEvent | SearchStartEvent | SourceDoneEvent

export type ParseResult =
  | { intent: 'chat'; reply: string }
  | { intent: 'search'; keywords: string[]; date_from: string | null; date_to: string | null; domains?: string[] }

export interface SearchSessionItem {
  id: number
  query: string | null
  keywords: string[]
  papers: Paper[]
  analysis: Record<string, string>
  created_at: string
}
