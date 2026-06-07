const STORAGE_KEY = 'cat.editor.columnWidths.v1'

/** @returns {Record<string, number>} */
export function loadColumnWidthMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    return data
  } catch {
    return {}
  }
}

/** @param {Record<string, number>} map */
export function saveColumnWidthMap(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private mode
  }
}

export function getDefaultColumnWidth() {
  return 100
}

export function clampColumnWidth(px) {
  return Math.max(48, Math.min(480, Math.round(px)))
}

/** @param {string[]} columnNames */
export function buildColumnWidthsFromStorage(columnNames, defaultWidth = getDefaultColumnWidth()) {
  const saved = loadColumnWidthMap()
  return columnNames.map((name) => {
    const w = saved[name]
    if (typeof w === 'number' && w > 0) return clampColumnWidth(w)
    return defaultWidth
  })
}

/** @param {string[]} columnNames @param {number[]} widths */
export function persistColumnWidths(columnNames, widths) {
  const saved = loadColumnWidthMap()
  columnNames.forEach((name, i) => {
    if (widths[i] > 0) saved[name] = clampColumnWidth(widths[i])
  })
  saveColumnWidthMap(saved)
}
