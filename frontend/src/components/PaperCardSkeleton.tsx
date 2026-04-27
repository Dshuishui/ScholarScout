// 骨架屏：形状与真实卡片（紧凑模式）对齐
export function PaperCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="relative bg-white border border-gray-100 rounded-xl overflow-hidden"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {/* 左侧彩条 */}
      <div className="absolute inset-y-0 left-0 w-[3px] shimmer" />

      <div className="pl-5 pr-4 py-4">
        {/* 标题行 */}
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1 space-y-2">
            <div className="shimmer h-4 rounded-md w-[88%]" />
            <div className="shimmer h-4 rounded-md w-[65%]" />
          </div>
          <div className="shimmer w-3.5 h-3.5 rounded flex-shrink-0 mt-0.5" />
        </div>

        {/* 作者 + venue */}
        <div className="flex justify-between mb-2.5 gap-4">
          <div className="shimmer h-3 rounded w-2/5" />
          <div className="shimmer h-3 rounded w-1/4" />
        </div>

        {/* Meta 行 */}
        <div className="flex items-center gap-2 mb-2">
          <div className="shimmer h-3 rounded w-8" />
          <div className="shimmer h-5 rounded-full w-24" />
          <div className="shimmer h-3 rounded w-14" />
        </div>

        {/* 展开摘要横条占位 */}
        <div className="shimmer h-7 rounded my-2.5" />

        {/* 操作按钮行 */}
        <div className="flex items-center gap-2 mt-1">
          <div className="shimmer h-6 rounded-lg w-14" />
          <div className="shimmer h-6 rounded-lg w-10" />
          <div className="ml-auto shimmer h-9 rounded-lg w-32" />
          <div className="shimmer h-9 rounded-lg w-20" />
        </div>
      </div>
    </div>
  )
}
