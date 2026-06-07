/** 无模板时的占位 SVG（不打包外部文件） */
export const EMPTY_SVG_TEMPLATE = (
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 841.89 595.28"></svg>'
)

/** @type {Map<number, string>} */
const contentCache = new Map()

/** @param {number | null | undefined} id */
export function invalidateSvgTemplateCache(id) {
  if (id != null) contentCache.delete(Number(id))
  else contentCache.clear()
}

/**
 * 从服务器文件读取 SVG 模板内容（需登录）。
 * @param {import('./api/client.js').api} apiClient
 * @param {number | null | undefined} id
 * @param {{ fallback?: string }} [options]
 */
export async function loadSvgTemplateContent(apiClient, id, { fallback = EMPTY_SVG_TEMPLATE } = {}) {
  if (!id) return fallback
  const numId = Number(id)
  if (contentCache.has(numId)) return contentCache.get(numId)

  const text = await apiClient.getTemplateFile(numId)
  if (!text || !text.includes('<svg')) {
    throw new Error('SVG 模板文件无效或不存在')
  }
  contentCache.set(numId, text)
  return text
}

/**
 * @param {string | null | undefined} fileUrl
 * @param {{ fallback?: string, credentials?: RequestCredentials }} [options]
 */
export async function fetchSvgTemplateByUrl(fileUrl, { fallback = EMPTY_SVG_TEMPLATE, credentials = 'include' } = {}) {
  if (!fileUrl) return fallback
  const res = await fetch(fileUrl, { credentials, cache: 'no-store' })
  if (!res.ok) throw new Error(`无法加载 SVG 模板 (${res.status})`)
  const text = await res.text()
  if (!text.includes('<svg')) throw new Error('SVG 模板文件无效')
  return text
}
