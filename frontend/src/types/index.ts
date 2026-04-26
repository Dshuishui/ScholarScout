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
  source_links?: { source: string; url: string }[]
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
  message: string
}

export type SearchErrorEvent = {
  type: 'error'
  message: string
}

export type SearchChatEvent = {
  type: 'chat'
  message: string
}

export type SearchEvent = SearchProgressEvent | SearchDoneEvent | SearchErrorEvent | SearchChatEvent

export type ParseResult =
  | { intent: 'chat'; reply: string }
  | { intent: 'search'; keywords: string[]; date_from: string | null; date_to: string | null }
