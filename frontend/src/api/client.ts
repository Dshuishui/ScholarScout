import type { SearchEvent } from '../types'

const API_BASE = '/api'

export async function* searchPapers(
  query: string,
  apiKey: string,
  history: { role: string; content: string }[] = []
): AsyncGenerator<SearchEvent> {
  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, api_key: apiKey, messages: history }),
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

export function getDownloadUrl(pdfUrl: string): string {
  return `${API_BASE}/download?url=${encodeURIComponent(pdfUrl)}`
}
