const STORAGE_KEY = 'cat.public.pageNavColumnsByCert.v1'

/** @returns {Record<string, string[]>} */
function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** @param {Record<string, string[]>} store */
function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * @param {number | string | null | undefined} certId
 * @returns {string[] | null} null 表示未设置用户覆盖
 */
export function loadPublicPageNavColumnOverride(certId) {
  if (certId == null || certId === '') return null
  const store = readStore()
  const key = String(certId)
  if (!Object.prototype.hasOwnProperty.call(store, key)) return null
  const cols = store[key]
  if (!Array.isArray(cols)) return null
  return cols.map((c) => String(c ?? '').trim()).filter(Boolean)
}

/**
 * @param {number | string | null | undefined} certId
 * @param {string[] | null} columns null 表示清除用户覆盖
 */
export function savePublicPageNavColumnOverride(certId, columns) {
  if (certId == null || certId === '') return
  const store = readStore()
  const key = String(certId)
  if (columns == null) {
    delete store[key]
  } else {
    store[key] = columns.map((c) => String(c ?? '').trim()).filter(Boolean)
  }
  writeStore(store)
}

/** @param {number | string | null | undefined} certId */
export function clearPublicPageNavColumnOverride(certId) {
  savePublicPageNavColumnOverride(certId, null)
}

/**
 * @param {string[]} columns
 * @param {string[]} tableColumns
 */
export function filterPageNavColumnsToTable(columns, tableColumns) {
  if (!Array.isArray(columns) || !columns.length) return []
  const allowed = new Set((tableColumns || []).map((c) => String(c).trim()).filter(Boolean))
  return columns.filter((c) => allowed.has(c))
}
