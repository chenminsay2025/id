export const DEFAULT_ROW_HEIGHT = 40
export const MIN_ROW_HEIGHT = 24
export const MAX_ROW_HEIGHT = 320

export function clampRowHeight(px) {
  return Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.round(px)))
}

/** @param {Record<string, number> | null | undefined} raw */
export function normalizeRowHeightsMap(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    const h = Number(v)
    if (Number.isFinite(h) && h > 0) out[String(k)] = clampRowHeight(h)
  }
  return out
}

/** @param {Record<string, number>} map @param {number} insertAt */
export function shiftRowHeightsForInsert(map, insertAt) {
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k)
    if (Number.isNaN(i)) continue
    out[String(i >= insertAt ? i + 1 : i)] = v
  }
  return out
}

/** @param {Record<string, number>} map @param {number} deleteAt */
export function shiftRowHeightsForDelete(map, deleteAt) {
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k)
    if (Number.isNaN(i)) continue
    if (i === deleteAt) continue
    out[String(i > deleteAt ? i - 1 : i)] = v
  }
  return out
}
