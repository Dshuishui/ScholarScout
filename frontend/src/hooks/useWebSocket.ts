import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from './useAuth'

export interface WsMessage {
  event: string
  data: Record<string, unknown>
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected'

const MAX_RETRIES = 10

export function useWebSocket() {
  const { token } = useAuth()
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null)
  const [status, setStatus] = useState<WsStatus>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(1000)
  const retryCount = useRef(0)
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (retryCount.current >= MAX_RETRIES) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams()
    if (token) params.set('token', token)
    params.set('cid', Math.random().toString(36).slice(2))

    const ws = new WebSocket(`${proto}://${window.location.host}/ws?${params}`)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => {
      setStatus('connected')
      retryDelay.current = 1000
      retryCount.current = 0
    }

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as WsMessage
        if (msg.event !== 'pong' && msg.event !== 'connected') {
          setLastMessage(msg)
        }
      } catch { /* noop */ }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      retryCount.current += 1
      if (retryCount.current >= MAX_RETRIES) return
      retryTimer.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 30_000)
        connect()
      }, retryDelay.current)
    }

    ws.onerror = () => ws.close()
  }, [token])

  useEffect(() => {
    connect()

    pingTimer.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25_000)

    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
      if (pingTimer.current) clearInterval(pingTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { lastMessage, status }
}
