import type { SearchEvent, ParseResult, Paper, SearchSessionItem } from '../types'

const API_BASE = '/api'

/** 接口返回的业务错误。code 由后端给出（如 trial_exhausted），前端据此给出对应引导 */
export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const data = await response.json().catch(() => null)
  const detail = data?.detail
  if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
    return new ApiError(response.status, detail.code, detail.message ?? '请求失败')
  }
  const message = typeof detail === 'string' ? detail : `请求失败: ${response.status}`
  const code = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'server_error' : 'http_error'
  return new ApiError(response.status, code, message)
}

/** 没有自己的 Key 时的身份：登录用户用账号的免费次数，未登录访客用设备标识领体验次数 */
export interface TrialAuth {
  token?: string | null
  deviceId?: string
}

function requestHeaders(apiKey: string, trial?: TrialAuth): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!apiKey && trial) {
    if (trial.token) headers['Authorization'] = `Bearer ${trial.token}`
    else if (trial.deviceId) headers['X-Trial-Device'] = trial.deviceId
  }
  return headers
}

export async function parseQuery(
  query: string,
  apiKey: string,
  history: { role: string; content: string }[] = [],
  model?: string,
  trial?: TrialAuth,
): Promise<ParseResult> {
  const response = await fetch(`${API_BASE}/parse`, {
    method: 'POST',
    headers: requestHeaders(apiKey, trial),
    body: JSON.stringify({ query, api_key: apiKey || null, messages: history, model }),
  })
  if (!response.ok) throw await toApiError(response)
  return response.json()
}

export async function* searchPapers(
  query: string,
  apiKey: string,
  history: { role: string; content: string }[] = [],
  settings: { limitPerSource?: number; validatedLimit?: number; selectedSources?: string[] } = {},
  confirmed?: { keywords: string[]; date_from?: string | null; date_to?: string | null; domains?: string[] },
  model?: string,
  trial?: TrialAuth,
): AsyncGenerator<SearchEvent> {
  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: requestHeaders(apiKey, trial),
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
        domains: confirmed.domains ?? null,
      }),
    }),
  })

  if (!response.ok) throw await toApiError(response)
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
