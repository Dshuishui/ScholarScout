import type { Message } from '../types'

interface Props {
  message: Message
  /** AI 直接回答了问题、没去搜论文时，点按钮按原问题搜论文 */
  onForceSearch?: (query: string) => void
}

export function MessageBubble({ message, onForceSearch }: Props) {
  const isUser = message.role === 'user'
  const searchable = !isUser && !message.isLoading && message.searchableQuery

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
        }`}
      >
        {message.isLoading ? (
          <span className="flex items-center gap-1.5 py-0.5">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        ) : (
          <span className="whitespace-pre-line leading-relaxed">{message.content}</span>
        )}
      </div>
      {searchable && onForceSearch && (
        <button
          onClick={() => onForceSearch(searchable)}
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-full px-3 py-1 transition-colors"
        >
          🔍 这是 AI 的直接回答，按这个问题搜论文
        </button>
      )}
    </div>
  )
}
