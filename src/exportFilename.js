import { formatPageNavRowLabel, parsePageNavColumns } from './pageNavColumn.js'

/** @param {string} name */
export function sanitizeExportFilename(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'certificate'
}

/**
 * 用页码栏展示文案生成导出基名（与公开页页码栏显示一致）
 * @param {string} pageNavLabel
 * @param {{ pageIndex?: number, totalPages?: number, includePageNumber?: boolean }} [options]
 */
export function buildExportBasenameFromPageNavLabel(pageNavLabel, options = {}) {
  const label = String(pageNavLabel || '').trim()
  const pageIndex = options.pageIndex
  const totalPages = options.totalPages ?? 1
  const multiPage = options.includePageNumber === true

  if (multiPage && pageIndex != null) {
    const pageNum = pageIndex + 1
    if (label) return `${pageNum} ${label}`
    return `第${pageNum}页`
  }

  if (label) return label
  if (pageIndex != null) return `cert-${pageIndex + 1}`
  return 'certificate'
}

/**
 * 按「页码栏显示列」生成导出文件基名
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string | string[] | unknown} pageNavColumnRaw
 * @param {{ pageIndex?: number, totalPages?: number, includePageNumber?: boolean }} [options]
 */
export function buildRowExportBasename(row, pageNavColumnRaw, options = {}) {
  const cols = parsePageNavColumns(pageNavColumnRaw)
  const label = formatPageNavRowLabel(row, cols)
  return buildExportBasenameFromPageNavLabel(label, options)
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string | string[] | unknown} pageNavColumnRaw
 * @param {string} ext
 * @param {{ pageIndex?: number, totalPages?: number, includePageNumber?: boolean }} [options]
 */
export function buildRowExportFilename(row, pageNavColumnRaw, ext, options = {}) {
  const base = buildRowExportBasename(row, pageNavColumnRaw, options)
  const cleanExt = String(ext || '').replace(/^\./, '')
  return `${sanitizeExportFilename(base)}.${cleanExt}`
}
