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

function isMissingTemplateError(err) {
  if (!err) return false
  if (err.status === 404) return true
  return /不存在|无效|not found/i.test(String(err.message || ''))
}

/**
 * 从服务器文件读取 SVG 模板内容（需登录）。
 * @param {import('./api/client.js').api} apiClient
 * @param {number | null | undefined} id
 * @param {{ fallback?: string }} [options]
 * @returns {Promise<{ content: string, missing: boolean, templateId: number | null, message: string }>}
 */
export async function loadSvgTemplateContentResult(apiClient, id, { fallback = EMPTY_SVG_TEMPLATE } = {}) {
  if (!id) {
    return { content: fallback, missing: false, templateId: null, message: '' }
  }
  const numId = Number(id)
  if (contentCache.has(numId)) {
    return { content: contentCache.get(numId), missing: false, templateId: numId, message: '' }
  }

  try {
    const text = await apiClient.getTemplateFile(numId)
    if (!text || !text.includes('<svg')) {
      return {
        content: fallback,
        missing: true,
        templateId: numId,
        message: 'SVG 模板文件无效或不存在',
      }
    }
    contentCache.set(numId, text)
    return { content: text, missing: false, templateId: numId, message: '' }
  } catch (err) {
    if (isMissingTemplateError(err)) {
      return {
        content: fallback,
        missing: true,
        templateId: numId,
        message: err.message || '模板文件不存在',
      }
    }
    throw err
  }
}

/**
 * @param {import('./api/client.js').api} apiClient
 * @param {number | null | undefined} id
 * @param {{ fallback?: string }} [options]
 */
export async function loadSvgTemplateContent(apiClient, id, options = {}) {
  const result = await loadSvgTemplateContentResult(apiClient, id, options)
  return result.content
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
