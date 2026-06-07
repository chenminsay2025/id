/** 单元格内图片引用前缀，值为 URL 路径 */
export const IMAGE_CELL_PREFIX = 'cat-img:'

/** 表格单元格内图片展示区域高度（与 CSS 一致，加载前后占位不变） */
export const IMAGE_CELL_SLOT_HEIGHT_PX = 72

/** 含图片单元格行的默认行高（展示区域 + td 上下 padding 各 6px） */
export const IMAGE_CELL_ROW_HEIGHT_PX = IMAGE_CELL_SLOT_HEIGHT_PX + 12

const IMAGE_URL_RE = /^(\/uploads\/|https?:\/\/).+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i

export function isImageCellValue(val) {
  if (val == null) return false
  const s = String(val).trim()
  if (!s) return false
  if (s.startsWith(IMAGE_CELL_PREFIX)) return true
  return IMAGE_URL_RE.test(s)
}

export function imageCellUrl(val) {
  const s = String(val).trim()
  if (s.startsWith(IMAGE_CELL_PREFIX)) return s.slice(IMAGE_CELL_PREFIX.length)
  return s
}

export function formatImageCellValue(url) {
  const u = String(url).trim()
  if (!u) return ''
  if (u.startsWith(IMAGE_CELL_PREFIX)) return u
  return `${IMAGE_CELL_PREFIX}${u}`
}

export function imageExtFromMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg') return 'jpg'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/svg+xml') return 'svg'
  return 'png'
}
