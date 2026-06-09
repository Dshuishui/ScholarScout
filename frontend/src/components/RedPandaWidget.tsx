import { useState, useEffect, useCallback, useRef } from 'react'

const BUBBLES = [
  '你好！我是小熊猫 🐾',
  '觉得网站很不好？\n可以右下角留言投诉作者，\n作者有空会来学习的 😅',
  '今天也要好好查论文哦 📚',
  '10 个数据库都搜过啦！',
  '有 bug？右下角投诉我来传达 🐾',
  '点我点我！',
  '论文找到了吗？加油！',
  '注册 / 登录后可以\n收藏论文 + 保存 AI 对话记录哦 ✨',
]

const SLOW_SEARCH_BUBBLE = '搜索有点慢，耐心等一下 🐾\n后面作者有空会改进滴！'
const PANDA_W = 52
const PANDA_H = 65
const POS_KEY = 'scholarscout_panda_pos'

function getDefaultPos() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  return { x: w - PANDA_W - 80, y: h - PANDA_H - 80 }
}

export function RedPandaWidget({ isSearching = false }: { isSearching?: boolean }) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(POS_KEY)
      return saved ? JSON.parse(saved) : getDefaultPos()
    } catch { return getDefaultPos() }
  })
  const [bubble, setBubble] = useState<string | null>(null)
  const [bouncing, setBouncing] = useState(false)
  const [bubbleIdx, setBubbleIdx] = useState(0)
  const isDragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const hasMoved = useRef(false)

  const showBubble = useCallback(() => {
    setBubble(BUBBLES[bubbleIdx % BUBBLES.length])
    setBubbleIdx(i => i + 1)
    setBouncing(true)
    setTimeout(() => setBouncing(false), 500)
    setTimeout(() => setBubble(null), 4000)
  }, [bubbleIdx])

  useEffect(() => {
    const t = setTimeout(showBubble, 8000 + Math.random() * 12000)
    return () => clearTimeout(t)
  }, [bubbleIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isSearching) return
    const t = setTimeout(() => {
      setBubble(SLOW_SEARCH_BUBBLE)
      setTimeout(() => setBubble(null), 5000)
    }, 8000)
    return () => clearTimeout(t)
  }, [isSearching])

  // 鼠标拖拽
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      hasMoved.current = true
      const x = Math.max(0, Math.min(window.innerWidth - PANDA_W, e.clientX - dragOffset.current.x))
      const y = Math.max(0, Math.min(window.innerHeight - PANDA_H, e.clientY - dragOffset.current.y))
      setPos({ x, y })
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      setPos(prev => {
        localStorage.setItem(POS_KEY, JSON.stringify(prev))
        return prev
      })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // 触摸拖拽
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return
      hasMoved.current = true
      const touch = e.touches[0]
      const x = Math.max(0, Math.min(window.innerWidth - PANDA_W, touch.clientX - dragOffset.current.x))
      const y = Math.max(0, Math.min(window.innerHeight - PANDA_H, touch.clientY - dragOffset.current.y))
      setPos({ x, y })
      e.preventDefault()
    }
    const onTouchEnd = () => {
      if (!isDragging.current) return
      isDragging.current = false
      setPos(prev => {
        localStorage.setItem(POS_KEY, JSON.stringify(prev))
        return prev
      })
    }
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true
    hasMoved.current = false
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    isDragging.current = true
    hasMoved.current = false
    dragOffset.current = { x: touch.clientX - pos.x, y: touch.clientY - pos.y }
  }

  const handleClick = () => {
    if (!hasMoved.current) showBubble()
  }

  // 气泡位置：在熊猫左侧或右侧，避免超出屏幕
  const bubbleLeft = pos.x > window.innerWidth / 2
  const bubbleStyle: React.CSSProperties = bubbleLeft
    ? { right: PANDA_W + 8, bottom: 0 }
    : { left: PANDA_W + 8, bottom: 0 }

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 40, userSelect: 'none' }}
    >
      {bubble && (
        <div
          style={{
            position: 'absolute',
            width: '200px',
            animation: 'fadeInUp 0.2s ease',
            ...bubbleStyle,
          }}
          className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 shadow-lg text-xs text-gray-700 leading-relaxed whitespace-pre-line"
        >
          {bubble}
        </div>
      )}

      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={handleClick}
        style={{
          cursor: 'grab',
          animation: bouncing
            ? 'pandaBounce 0.4s ease'
            : 'pandaIdle 3s ease-in-out infinite',
        }}
        title="点我！可拖动到任意位置"
      >
        <svg width={PANDA_W} height={PANDA_H} viewBox="0 0 72 90" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="60" cy="72" rx="10" ry="7" fill="#C1440E" transform="rotate(-30 60 72)" />
          <ellipse cx="62" cy="70" rx="6" ry="4" fill="#3D1A00" transform="rotate(-30 62 70)" />
          <ellipse cx="64" cy="68" rx="4" ry="3" fill="#C1440E" transform="rotate(-30 64 68)" />
          <ellipse cx="36" cy="68" rx="20" ry="17" fill="#C1440E" />
          <ellipse cx="36" cy="70" rx="11" ry="10" fill="#F5DEB3" />
          <ellipse cx="20" cy="80" rx="8" ry="5" fill="#8B2500" />
          <ellipse cx="52" cy="80" rx="8" ry="5" fill="#8B2500" />
          <circle cx="36" cy="36" r="22" fill="#C1440E" />
          <ellipse cx="17" cy="19" rx="8" ry="9" fill="#C1440E" transform="rotate(-20 17 19)" />
          <ellipse cx="55" cy="19" rx="8" ry="9" fill="#C1440E" transform="rotate(20 55 19)" />
          <ellipse cx="17" cy="19" rx="4" ry="5" fill="#F5DEB3" opacity="0.7" transform="rotate(-20 17 19)" />
          <ellipse cx="55" cy="19" rx="4" ry="5" fill="#F5DEB3" opacity="0.7" transform="rotate(20 55 19)" />
          <ellipse cx="36" cy="40" rx="15" ry="13" fill="#F5DEB3" />
          <ellipse cx="26" cy="36" rx="5" ry="6" fill="#F5F5F5" />
          <ellipse cx="46" cy="36" rx="5" ry="6" fill="#F5F5F5" />
          <circle cx="26" cy="35" r="5" fill="#1A1A1A" />
          <circle cx="46" cy="35" r="5" fill="#1A1A1A" />
          <circle cx="27.5" cy="33" r="1.8" fill="white" />
          <circle cx="47.5" cy="33" r="1.8" fill="white" />
          <ellipse cx="36" cy="42" rx="3.5" ry="2.5" fill="#4A1A1A" />
          <path d="M32 46 Q36 50 40 46" stroke="#4A1A1A" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <line x1="15" y1="42" x2="26" y2="43" stroke="#888" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="15" y1="45" x2="26" y2="45" stroke="#888" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="46" y1="43" x2="57" y2="42" stroke="#888" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="46" y1="45" x2="57" y2="45" stroke="#888" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      </div>

      <style>{`
        @keyframes pandaIdle {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          25% { transform: translateY(-3px) rotate(-1deg); }
          75% { transform: translateY(-1px) rotate(1deg); }
        }
        @keyframes pandaBounce {
          0% { transform: translateY(0); }
          30% { transform: translateY(-18px) scale(1.05); }
          60% { transform: translateY(-6px) scale(0.98); }
          80% { transform: translateY(-10px); }
          100% { transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
