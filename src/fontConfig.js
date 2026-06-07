/**
 * 中文字体加载地址（预览 / SVG / PDF 共用）
 * 默认走七牛 CDN，不将 ttf 打入 dist。
 * 构建时可用 VITE_FONT_URL 覆盖；离线部署可设为 /font/SourceHanSansCN-Medium.ttf
 */
export const FONT_CDN_URL = 'https://qiniu.uzzon.cn/fonts/SourceHanSansCN-Medium.ttf'

/** @returns {string} */
export function resolveFontUrl() {
  const env = import.meta.env?.VITE_FONT_URL?.trim()
  if (env) return env
  return FONT_CDN_URL
}

/** 当前页面使用的字体 URL */
export const fontUrl = resolveFontUrl()

/** PDF 等场景的拉取顺序：主 URL → CDN → 站点静态回退 */
export function getFontFetchCandidates(primaryUrl = fontUrl) {
  const list = [primaryUrl, FONT_CDN_URL, '/font/SourceHanSansCN-Medium.ttf']
  return [...new Set(list.filter(Boolean))]
}
