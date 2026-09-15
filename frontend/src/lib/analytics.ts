// 访问步骤统计：走自部署的 Umami（index.html 里加载的 /analytics/script.js），数据只在我们自己的服务器上。
// 脚本没加载（被拦截、本地开发）时静默忽略，统计永远不能影响正常使用。
//
// 站长排除自己的访问：在自己浏览器的控制台执行 localStorage.setItem('umami.disabled', '1')

type EventData = Record<string, string | number | boolean>

declare global {
  interface Window {
    umami?: { track: (event: string, data?: EventData) => void }
  }
}

export function track(event: string, data?: EventData) {
  try {
    window.umami?.track(event, data)
  } catch {
    /* ignore */
  }
}
