import { FONT_CDN_URL, getFontFetchCandidates } from './fontConfig.js'
import { clearFontCatalogCache, loadFontCatalog, getEnabledFontUrls } from './fontCatalog.js'

/** 默认字体 URL（兼容 PDF 等仍传单 URL 的路径） */
export async function resolveRuntimeFontUrl() {
  const catalog = await loadFontCatalog()
  return catalog.defaultUrl
}

export function clearFontUrlCache() {
  clearFontCatalogCache()
}

export async function getRuntimeFontFetchCandidates() {
  const catalog = await loadFontCatalog()
  const urls = catalog.sources.flatMap((s) => getEnabledFontUrls(s)).filter(Boolean)
  if (!urls.length) return getFontFetchCandidates(FONT_CDN_URL)
  return [...new Set(urls.flatMap((u) => getFontFetchCandidates(u)))]
}
