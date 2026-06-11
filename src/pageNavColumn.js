/** @param {unknown} raw */
export function parsePageNavColumns(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    const seen = new Set()
    const out = []
    for (const item of raw) {
      const col = String(item ?? '').trim()
      if (!col || seen.has(col)) continue
      seen.add(col)
      out.push(col)
    }
    return out
  }
  const s = String(raw).trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) {
        const seen = new Set()
        const out = []
        for (const item of parsed) {
          const col = String(item ?? '').trim()
          if (!col || seen.has(col)) continue
          seen.add(col)
          out.push(col)
        }
        return out
      }
    } catch {
      /* legacy plain string */
    }
  }
  return [s]
}

/** @param {string[] | string | unknown} cols */
export function serializePageNavColumns(cols) {
  const list = Array.isArray(cols)
    ? serializePageNavColumnsFromArray(cols)
    : parsePageNavColumns(cols)
  if (!list.length) return ''
  if (list.length === 1) return list[0]
  return JSON.stringify(list)
}

/** @param {string[]} cols */
function serializePageNavColumnsFromArray(cols) {
  const seen = new Set()
  const unique = []
  for (const col of cols) {
    const trimmed = String(col ?? '').trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

/** @param {unknown} a @param {unknown} b */
export function pageNavColumnsEqual(a, b) {
  return serializePageNavColumns(a) === serializePageNavColumns(b)
}

/** @param {unknown} raw */
export function normalizePageNavColumnStorage(raw) {
  return serializePageNavColumns(raw)
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string[]} cols
 */
export function formatPageNavRowLabel(row, cols) {
  if (!row || !cols?.length) return ''
  const parts = []
  for (const col of cols) {
    const val = row[col]
    if (val == null || val === '') continue
    const trimmed = String(val).trim()
    if (trimmed) parts.push(trimmed)
  }
  return parts.join(' · ')
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string[]} cols
 * @returns {string[]}
 */
export function getPageNavRowValues(row, cols) {
  if (!row || !cols?.length) return []
  const values = []
  for (const col of cols) {
    const val = row[col]
    if (val == null || val === '') continue
    const trimmed = String(val).trim()
    if (trimmed) values.push(trimmed)
  }
  return values
}
