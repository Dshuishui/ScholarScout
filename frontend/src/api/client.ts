import type { SearchEvent, ParseResult, Paper, SearchSessionItem } from '../types'

const API_BASE = '/api'

export async function parseQuery(
  query: string,
  apiKey: string,
  history: { role: string; content: string }[] = [],
  model?: string,
  authToken?: string,
): Promise<ParseResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // 试用模式（无自己的 Key）：传 Bearer token 让后端用系统 Key
  if (!apiKey && authToken) headers['Authorization'] = `Bearer ${authToken}`

  const response = await fetch(`${API_BASE}/parse`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, api_key: apiKey || null, messages: history, model }),
  })
  if (!response.ok) throw new Error(`请求失败: ${response.status}`)
  return response.json()
}

export async function* searchPapers(
  query: string,
  apiKey: string,
  history: { role: string; content: string }[] = [],
  settings: { limitPerSource?: number; validatedLimit?: number; selectedSources?: string[] } = {},
  confirmed?: { keywords: string[]; date_from?: string | null; date_to?: string | null },
  model?: string,
  authToken?: string,
): AsyncGenerator<SearchEvent> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!apiKey && authToken) headers['Authorization'] = `Bearer ${authToken}`

  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      api_key: apiKey || null,
      messages: history,
      limit_per_source: settings.limitPerSource,
      validated_limit: settings.validatedLimit,
      sources: settings.selectedSources,
      model,
      ...(confirmed && {
        keywords: confirmed.keywords,
        date_from: confirmed.date_from ?? null,
        date_to: confirmed.date_to ?? null,
      }),
    }),
  })

  if (!response.ok) throw new Error(`请求失败: ${response.status}`)
  if (!response.body) throw new Error('响应无内容')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const eventLine = block.split('\n').find(l => l.startsWith('event:'))
      const dataLine = block.split('\n').find(l => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue

      const eventType = eventLine.replace('event:', '').trim()
      const data = JSON.parse(dataLine.replace('data:', '').trim())
      yield { type: eventType, ...data } as SearchEvent
    }
  }
}

export function getDownloadUrl(pdfUrl: string, doi?: string | null, paperId?: string | null): string {
  const params = new URLSearchParams({ url: pdfUrl })
  if (doi) params.set('doi', doi)
  if (paperId) params.set('paper_id', paperId)
  return `${API_BASE}/download?${params}`
}

// ── 搜索快照 API ────────────────────────────────────────────────────────────

export async function getSessions(token: string): Promise<SearchSessionItem[]> {
  const r = await fetch(`${API_BASE}/user/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) return []
  return r.json()
}

export async function createSession(
  token: string,
  data: { query: string | null; keywords: string[]; papers: Paper[] },
): Promise<{ id: number } | null> {
  try {
    const r = await fetch(`${API_BASE}/user/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    })
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

export async function saveSessionAnalysis(
  token: string,
  sessionId: number,
  mode: string,
  content: string,
): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/user/sessions/${sessionId}/analysis`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode, content }),
    })
    return r.ok
  } catch {
    return false
  }
}

export async function deleteSession(token: string, sessionId: number): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/user/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return r.ok
  } catch {
    return false
  }
}

// ── Semantic / RAG ────────────────────────────────────────────────────────────

export interface SemanticHit {
  paper_id: string
  title: string
  source: string
  year: string
  citations: number
  authors: string
  similarity: number
}

export async function semanticSearch(query: string, nResults = 10): Promise<SemanticHit[]> {
  try {
    const r = await fetch(`${API_BASE}/semantic/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, n_results: nResults }),
    })
    if (!r.ok) return []
    const data = await r.json()
    return data.results ?? []
  } catch {
    return []
  }
}

export async function findSimilarPapers(paperId: string, nResults = 5): Promise<SemanticHit[]> {
  try {
    const r = await fetch(`${API_BASE}/semantic/similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper_id: paperId, n_results: nResults }),
    })
    if (r.status === 404) return []
    if (!r.ok) return []
    const data = await r.json()
    return data.results ?? []
  } catch {
    return []
  }
}

export async function semanticStatus(): Promise<number> {
  try {
    const r = await fetch(`${API_BASE}/semantic/status`)
    if (!r.ok) return 0
    const data = await r.json()
    return data.indexed_count ?? 0
  } catch {
    return 0
  }
}
