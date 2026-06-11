/** Excel / WPS 导入嵌入图压缩默认配置 */
export function defaultExcelImportImageConfig() {
  return {
    enabled: true,
    maxWidth: 1920,
    maxHeight: 1920,
    maxFileSizeKb: 800,
    quality: 0.85,
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** @param {unknown} input */
export function normalizeExcelImportImageConfig(input) {
  const base = defaultExcelImportImageConfig()
  if (!input || typeof input !== 'object') return { ...base }
  const enabled = input.enabled !== false && input.enabled !== 0 && input.enabled !== '0'
  const maxWidth = clampInt(input.maxWidth ?? input.max_width, 0, 8192, base.maxWidth)
  const maxHeight = clampInt(input.maxHeight ?? input.max_height, 0, 8192, base.maxHeight)
  const maxFileSizeKb = clampInt(input.maxFileSizeKb ?? input.max_file_size_kb, 0, 10240, base.maxFileSizeKb)
  let quality = input.quality
  if (quality > 1) quality = quality / 100
  quality = clampFloat(quality, 0.35, 1, base.quality)
  return { enabled, maxWidth, maxHeight, maxFileSizeKb, quality }
}

/** @param {ReturnType<typeof defaultExcelImportImageConfig>} cfg */
export function describeExcelImportImageConfig(cfg) {
  const c = normalizeExcelImportImageConfig(cfg)
  if (!c.enabled) return '未启用压缩'
  const parts = []
  if (c.maxWidth > 0 || c.maxHeight > 0) {
    const w = c.maxWidth > 0 ? c.maxWidth : '不限'
    const h = c.maxHeight > 0 ? c.maxHeight : '不限'
    parts.push(`尺寸 ≤ ${w}×${h}`)
  }
  if (c.maxFileSizeKb > 0) parts.push(`单张 ≤ ${c.maxFileSizeKb} KB`)
  parts.push(`质量 ${Math.round(c.quality * 100)}%`)
  return parts.join(' · ')
}
