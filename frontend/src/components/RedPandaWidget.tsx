import { useState, useEffect, useCallback } from 'react'

const BUBBLES = [
  '你好！我是小熊猫 🐾',
  '觉得网站很不好？\n可以右下角留言投诉作者，\n作者有空会来学习的 😅',
  '今天也要好好查论文哦 📚',
  '10 个数据库都搜过啦！',
  '有 bug？右下角投诉我来传达 🐾',
  '点我点我！',
  '论文找到了吗？加油！',
]

const SLOW_SEARCH_BUBBLE = '搜索有点慢，耐心等一下 🐾\n后面作者有空会改进滴！'

export function RedPandaWidget({ isSearching = false }: { isSearching?: boolean }) {
  const [bubble, setBubble] = useState<string | null>(null)
  const [bouncing, setBouncing] = useState(false)
  const [bubbleIdx, setBubbleIdx] = useState(0)

  const showBubble = useCallback(() => {
    setBubble(BUBBLES[bubbleIdx % BUBBLES.length])
    setBubbleIdx(i => i + 1)
    setBouncing(true)
    setTimeout(() => setBouncing(false), 500)
    setTimeout(() => setBubble(null), 4000)
  }, [bubbleIdx])

  // 随机自动冒泡
  useEffect(() => {
    const t = setTimeout(showBubble, 8000 + Math.random() * 12000)
    return () => clearTimeout(t)
  }, [bubbleIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // 搜索超过 8 秒自动吐槽
  useEffect(() => {
    if (!isSearching) return
    const t = setTimeout(() => {
      setBubble(SLOW_SEARCH_BUBBLE)
      setTimeout(() => setBubble(null), 5000)
    }, 8000)
    return () => clearTimeout(t)
  }, [isSearching])

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center select-none">
      {/* 小熊猫从顶部探出，脚踩在导航栏上 */}

      {/* 气泡在熊猫下方 */}
      {bubble && (
        <div
          className="mt-14 bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 shadow-lg text-xs text-gray-700 leading-relaxed max-w-[200px] whitespace-pre-line absolute top-0"
          style={{ animation: 'fadeInUp 0.2s ease', left: '50%', transform: 'translateX(10%)' }}
        >
          {bubble}
          <div className="absolute -top-1.5 left-4 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45" />
        </div>
      )}

      {/* 小熊猫 SVG */}
      <div
        onClick={showBubble}
        className="cursor-pointer"
        style={{
          animation: bouncing
            ? 'pandaBounce 0.4s ease'
            : 'pandaIdle 3s ease-in-out infinite',
        }}
        title="点我！"
      >
        <svg width="52" height="65" viewBox="0 0 72 90" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* 尾巴（在身体后面） */}
          <ellipse cx="60" cy="72" rx="10" ry="7" fill="#C1440E" transform="rotate(-30 60 72)" />
          <ellipse cx="62" cy="70" rx="6" ry="4" fill="#3D1A00" transform="rotate(-30 62 70)" />
          <ellipse cx="64" cy="68" rx="4" ry="3" fill="#C1440E" transform="rotate(-30 64 68)" />

          {/* 身体 */}
          <ellipse cx="36" cy="68" rx="20" ry="17" fill="#C1440E" />
          {/* 肚子 */}
          <ellipse cx="36" cy="70" rx="11" ry="10" fill="#F5DEB3" />

          {/* 前爪 */}
          <ellipse cx="20" cy="80" rx="8" ry="5" fill="#8B2500" />
          <ellipse cx="52" cy="80" rx="8" ry="5" fill="#8B2500" />

          {/* 头 */}
          <circle cx="36" cy="36" r="22" fill="#C1440E" />

          {/* 耳朵 */}
          <ellipse cx="17" cy="19" rx="8" ry="9" fill="#C1440E" transform="rotate(-20 17 19)" />
          <ellipse cx="55" cy="19" rx="8" ry="9" fill="#C1440E" transform="rotate(20 55 19)" />
          {/* 耳朵内 */}
          <ellipse cx="17" cy="19" rx="4" ry="5" fill="#F5DEB3" opacity="0.7" transform="rotate(-20 17 19)" />
          <ellipse cx="55" cy="19" rx="4" ry="5" fill="#F5DEB3" opacity="0.7" transform="rotate(20 55 19)" />

          {/* 脸部白色花纹（熊猫特征） */}
          <ellipse cx="36" cy="40" rx="15" ry="13" fill="#F5DEB3" />

          {/* 眼下泪纹（小熊猫特征） */}
          <ellipse cx="26" cy="36" rx="5" ry="6" fill="#F5F5F5" />
          <ellipse cx="46" cy="36" rx="5" ry="6" fill="#F5F5F5" />

          {/* 眼睛 */}
          <circle cx="26" cy="35" r="5" fill="#1A1A1A" />
          <circle cx="46" cy="35" r="5" fill="#1A1A1A" />
          {/* 眼睛高光 */}
          <circle cx="27.5" cy="33" r="1.8" fill="white" />
          <circle cx="47.5" cy="33" r="1.8" fill="white" />

          {/* 鼻子 */}
          <ellipse cx="36" cy="42" rx="3.5" ry="2.5" fill="#4A1A1A" />

          {/* 嘴 */}
          <path d="M32 46 Q36 50 40 46" stroke="#4A1A1A" strokeWidth="1.5" fill="none" strokeLinecap="round" />

          {/* 胡须 */}
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
