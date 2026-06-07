const TABLE_STORAGE_KEY = 'catSvgGenerator.table.v1'
const LEGACY_STORAGE_KEY = 'catSvgGenerator.state.v1'

let saveTimer = null

export function buildTablePayload(rows, selectedRow) {
  return {
    v: 1,
    updatedAt: new Date().toISOString(),
    rows: rows ?? [],
    selectedRow: selectedRow ?? 0,
  }
}

/** @returns {{ rows: Record<string, string>[], selectedRow: number } | null} */
export function loadTableFromStorage() {
  try {
    const raw = localStorage.getItem(TABLE_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        return {
          rows: data.rows,
          selectedRow: Number(data.selectedRow) || 0,
        }
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw)
      if (Array.isArray(legacy.rows) && legacy.rows.length > 0) {
        return {
          rows: legacy.rows,
          selectedRow: Number(legacy.selectedRow) || 0,
        }
      }
    }
  } catch (err) {
    console.warn('[CAT 表格] localStorage 读取失败', err)
  }
  return null
}

function writeTable(rows, selectedRow) {
  try {
    localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(buildTablePayload(rows, selectedRow)))
  } catch (err) {
    console.warn('[CAT 表格] localStorage 保存失败', err)
  }
}

export function scheduleTableSave(rows, selectedRow) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => writeTable(rows, selectedRow), 300)
}

export function flushTableSave(rows, selectedRow) {
  clearTimeout(saveTimer)
  writeTable(rows, selectedRow)
}

export function clearTableStorage() {
  clearTimeout(saveTimer)
  try {
    localStorage.removeItem(TABLE_STORAGE_KEY)
  } catch {
    // ignore
  }
}
