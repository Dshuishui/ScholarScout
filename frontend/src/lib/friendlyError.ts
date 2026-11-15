/** 把 HTTP 状态码翻译成普通用户看得懂、知道下一步怎么做的中文。
 *  以前直接显示 "HTTP 500""Rate Limit"，还让人点一个并不存在的「换 Key」按钮（顶栏实际叫「我的 Key」）。 */
export function aiErrorMessage(status: number): string {
  if (status === 401) return 'API Key 无效或已过期，请点顶栏的「我的 Key」重新填写。'
  if (status === 402) return 'DeepSeek 账户余额不足，请到 DeepSeek 开放平台（platform.deepseek.com）充值后再试。'
  if (status === 429) return '请求太多了，请等一会儿再试。'
  if (status >= 500) return 'AI 服务暂时不可用，请稍后再试。'
  return `请求没有成功（错误码 ${status}），请稍后再试。`
}

/** 批量下载 PDF 失败的原因 */
export function downloadErrorMessage(status: number): string {
  if (status === 401 || status === 403) return '需要登录或付费才能下载'
  if (status === 404) return '下载链接已失效'
  if (status === 429) return '下载太频繁，请稍后再试'
  return '暂时下载不了，可以打开论文链接手动下载'
}
