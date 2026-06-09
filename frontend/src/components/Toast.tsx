/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect } from 'react'

type Listener = (msg: string) => void
let _listener: Listener | null = null

export const toast = {
  show: (msg: string) => _listener?.(msg),
}

export function ToastContainer() {
  const [msg, setMsg] = useState('')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    _listener = (m: string) => {
      setMsg(m)
      setVisible(true)
      setTimeout(() => setVisible(false), 2800)
    }
    return () => { _listener = null }
  }, [])

  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-2.5 bg-gray-900 text-white text-sm px-5 py-3 rounded-full shadow-xl">
        <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        {msg}
      </div>
    </div>
  )
}
