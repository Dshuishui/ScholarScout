import { useEffect, useRef } from 'react'

// 打开全屏页面、抽屉、弹窗时往浏览器历史里压一条记录，这样手机上的返回手势 / 返回键
// 关掉的是当前浮层，而不是直接离开网站。多个浮层叠加时只关最上面那个。

interface Entry { close: () => void; popped: boolean }

const stack: Entry[] = []
let ignorePops = 0
let installed = false

function installListener() {
  if (installed) return
  installed = true
  window.addEventListener('popstate', () => {
    // 通过界面按钮关闭时我们自己调用了 history.back()，这次 popstate 不应该再关别的浮层
    if (ignorePops > 0) {
      ignorePops--
      return
    }
    const top = stack.pop()
    if (top) {
      top.popped = true
      top.close()
    }
  })
}

export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    installListener()
    const entry: Entry = { close: () => closeRef.current(), popped: false }
    stack.push(entry)
    window.history.pushState({ ...(window.history.state ?? {}), scholarscoutOverlay: stack.length }, '')
    return () => {
      const idx = stack.indexOf(entry)
      if (idx >= 0) stack.splice(idx, 1)
      if (!entry.popped) {
        ignorePops++
        window.history.back()
      }
    }
  }, [open])
}
