import { normalizeSearchText } from './searchNormalize.js'

const IMAGE_CELL_PREFIX = 'cat-img:'

/** @param {unknown} val @param {string[]} parts */
function collectSearchableParts(val, parts) {
  if (val == null) return
  if (typeof val === 'string') {
    const s = val.trim()
    if (!s) return
    if (s.startsWith(IMAGE_CELL_PREFIX)) {
      parts.push(s.slice(IMAGE_CELL_PREFIX.length))
      const base = s.slice(IMAGE_CELL_PREFIX.length).split('/').pop()
      if (base) parts.push(base)
      return
    }
    parts.push(s)
    return
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    parts.push(String(val))
    return
  }
  if (Array.isArray(val)) {
    for (const item of val) collectSearchableParts(item, parts)
    return
  }
  if (typeof val === 'object') {
    for (const v of Object.values(val)) collectSearchableParts(v, parts)
  }
}

/** @param {unknown} rowData */
export function extractSearchableTextFromRowData(rowData) {
  const parts = []
  if (typeof rowData === 'string') {
    try {
      collectSearchableParts(JSON.parse(rowData), parts)
    } catch {
      collectSearchableParts(rowData, parts)
    }
  } else {
    collectSearchableParts(rowData, parts)
  }
  return normalizeSearchText(parts.join(' ').replace(/\s+/g, ' ').trim())
}

/**
 * @param {{ title?: string, group_name?: string | null }} cert
 * @param {string[]} rowDataJsonList
 * @param {number} [maxLen]
 */
export function buildCertificateSearchText(cert, rowDataJsonList, maxLen = 128000) {
  const chunks = [
    String(cert.title || '').trim(),
    String(cert.group_name || '').trim(),
  ]
  for (const raw of rowDataJsonList) {
    const t = extractSearchableTextFromRowData(raw)
    if (t) chunks.push(t)
  }
  let text = normalizeSearchText(chunks.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim())
  if (maxLen > 0 && text.length > maxLen) text = text.slice(0, maxLen)
  return text
}

/** 仅证书表格行内容，不含标题/组名（前端列表搜索用） */
export function buildCertificateTableSearchText(rowDataJsonList, maxLen = 128000) {
  const chunks = []
  for (const raw of rowDataJsonList) {
    const t = extractSearchableTextFromRowData(raw)
    if (t) chunks.push(t)
  }
  let text = normalizeSearchText(chunks.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim())
  if (maxLen > 0 && text.length > maxLen) text = text.slice(0, maxLen)
  return text
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object[]} certificates
 */
export function attachSearchTextToCertificates(db, certificates) {
  if (!certificates.length) return certificates
  const ids = certificates.map((c) => c.id)
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT certificate_id, row_data
    FROM certificate_rows
    WHERE certificate_id IN (${placeholders})
    ORDER BY certificate_id, sort_order
  `).all(...ids)
  /** @type {Map<number, string[]>} */
  const byCert = new Map()
  for (const row of rows) {
    const list = byCert.get(row.certificate_id) || []
    list.push(row.row_data)
    byCert.set(row.certificate_id, list)
  }
  for (const cert of certificates) {
    cert.search_text = buildCertificateSearchText(cert, byCert.get(cert.id) || [])
  }
  return certificates
}

/**
 * 为证书列表附加仅含表格内容的搜索字段 table_search_text
 * @param {import('better-sqlite3').Database} db
 * @param {object[]} certificates
 */
export function attachTableSearchTextToCertificates(db, certificates) {
  if (!certificates.length) return certificates
  const ids = certificates.map((c) => c.id)
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT certificate_id, row_data
    FROM certificate_rows
    WHERE certificate_id IN (${placeholders})
    ORDER BY certificate_id, sort_order
  `).all(...ids)
  /** @type {Map<number, string[]>} */
  const byCert = new Map()
  for (const row of rows) {
    const list = byCert.get(row.certificate_id) || []
    list.push(row.row_data)
    byCert.set(row.certificate_id, list)
  }
  for (const cert of certificates) {
    cert.table_search_text = buildCertificateTableSearchText(byCert.get(cert.id) || [])
  }
  return certificates
}
