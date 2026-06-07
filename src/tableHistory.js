const MAX_TABLE_HISTORY = 50

/** @typedef {{ tableData: Record<string, string>[], selectedRow: number, selectedCol: number }} TableSnapshot */

/** @type {TableSnapshot[]} */
let history = []
let index = 0

export function snapshotTableState(tableData, selectedRow, selectedCol = 0) {
  return {
    tableData: structuredClone(tableData),
    selectedRow: selectedRow ?? 0,
    selectedCol: selectedCol ?? 0,
  }
}

/** @param {TableSnapshot} snapshot */
export function initTableHistory(snapshot) {
  history = [snapshotTableState(
    snapshot.tableData,
    snapshot.selectedRow,
    snapshot.selectedCol,
  )]
  index = 0
}

export function recordTableHistory(tableData, selectedRow, selectedCol = 0) {
  const snap = snapshotTableState(tableData, selectedRow, selectedCol)
  const cur = history[index]
  if (cur && JSON.stringify(cur) === JSON.stringify(snap)) return

  history = history.slice(0, index + 1)
  history.push(snap)
  if (history.length > MAX_TABLE_HISTORY) {
    history.shift()
  }
  index = history.length - 1
}

export function canUndoTable() {
  return index > 0
}

export function canRedoTable() {
  return index < history.length - 1
}

/** @returns {TableSnapshot | null} */
export function undoTable() {
  if (!canUndoTable()) return null
  index -= 1
  return snapshotTableState(
    history[index].tableData,
    history[index].selectedRow,
    history[index].selectedCol,
  )
}

/** @returns {TableSnapshot | null} */
export function redoTable() {
  if (!canRedoTable()) return null
  index += 1
  return snapshotTableState(
    history[index].tableData,
    history[index].selectedRow,
    history[index].selectedCol,
  )
}

export function getTableHistoryState() {
  return { canUndo: canUndoTable(), canRedo: canRedoTable() }
}
