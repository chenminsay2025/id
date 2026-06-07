import {
  renameLayoutColumn,
  pruneLayoutOverridesForTable,
  applyTableTemplateScopeFlag,
} from './layoutBinding.js'
import { SAMPLE_ADORN_KEY_PREFIX } from './sampleDialogSegments.js'
import { parsePageNavColumns, serializePageNavColumns } from './pageNavColumn.js'

const RENAME_TMP_PREFIX = '__cat_col_rename_tmp__'

/** @param {unknown} columns */
export function normalizeTemplateColumnList(columns) {
  return (columns || []).map((c) => String(c).trim()).filter(Boolean)
}

/**
 * 推断表格模板列名变更（重命名），不含纯增删列。
 * @param {string[]} oldColumns
 * @param {string[]} newColumns
 * @returns {{ from: string, to: string }[]}
 */
function sameColumnMultiset(old, next) {
  if (old.length !== next.length) return false
  const oldSet = new Set(old)
  const newSet = new Set(next)
  if (oldSet.size !== newSet.size) return false
  for (const c of oldSet) {
    if (!newSet.has(c)) return false
  }
  return true
}

export function computeColumnRenames(oldColumns, newColumns) {
  const old = normalizeTemplateColumnList(oldColumns)
  const next = normalizeTemplateColumnList(newColumns)
  if (!old.length || !next.length) return []

  const oldSet = new Set(old)
  const newSet = new Set(next)

  if (old.length === next.length) {
    const renames = []
    for (let i = 0; i < old.length; i += 1) {
      if (old[i] !== next[i]) renames.push({ from: old[i], to: next[i] })
    }
    if (!renames.length) return []
    if (sameColumnMultiset(old, next)) return []
    return filterValidRenames(renames, old, next)
  }

  const dropped = old.filter((c) => !newSet.has(c))
  const added = next.filter((c) => !oldSet.has(c))
  if (dropped.length !== added.length) return []

  if (dropped.length === 1 && added.length === 1) {
    return [{ from: dropped[0], to: added[0] }]
  }

  const renames = []
  const usedTo = new Set()
  for (let i = 0; i < old.length; i += 1) {
    const from = old[i]
    if (newSet.has(from)) continue
    const to = next[i]
    if (!to || oldSet.has(to) || usedTo.has(to)) continue
    renames.push({ from, to })
    usedTo.add(to)
  }
  return filterValidRenames(renames, old, next)
}

/** @param {{ from: string, to: string }[]} renames */
function filterValidRenames(renames, old, next) {
  if (!renames.length) return []
  const fromSet = new Set(old)
  const nextSet = new Set(next)
  const seenFrom = new Set()
  const seenTo = new Set()
  const out = []
  for (const r of renames) {
    if (!r.from || !r.to || r.from === r.to) continue
    if (!fromSet.has(r.from) || !nextSet.has(r.to)) continue
    if (seenFrom.has(r.from) || seenTo.has(r.to)) continue
    seenFrom.add(r.from)
    seenTo.add(r.to)
    out.push(r)
  }
  return out
}

/**
 * @param {object} layoutOverrides
 * @param {{ from: string, to: string }[]} renames
 * @param {string[]} tableColumns
 */
export function applyColumnRenamesToLayoutOverrides(layoutOverrides, renames, tableColumns = []) {
  if (!renames.length) return layoutOverrides
  let next = layoutOverrides
  const pending = renames.map((r) => ({ ...r }))

  while (pending.length) {
    const ready = pending.filter((r) => !pending.some((o) => o.to === r.from))
    if (ready.length) {
      for (const r of ready) {
        next = renameLayoutColumn(next, r.from, r.to, null)
        const idx = pending.indexOf(r)
        if (idx >= 0) pending.splice(idx, 1)
      }
      continue
    }
    for (const r of pending) {
      next = renameLayoutColumn(next, r.from, `${RENAME_TMP_PREFIX}${r.from}`, null)
    }
    for (const r of pending) {
      next = renameLayoutColumn(next, `${RENAME_TMP_PREFIX}${r.from}`, r.to, null)
    }
    pending.length = 0
  }

  const cols = normalizeTemplateColumnList(tableColumns)
  if (cols.length) {
    next = pruneLayoutOverridesForTable(next, cols)
    next = applyTableTemplateScopeFlag(next, cols)
  }
  return next
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ from: string, to: string }[]} renames
 */
export function applyColumnRenamesToPreviewSampleRow(row, renames) {
  let next = row && typeof row === 'object' ? { ...row } : {}
  for (const { from, to } of renames) {
    if (Object.prototype.hasOwnProperty.call(next, from)) {
      next[to] = next[from]
      delete next[from]
    }
    const adornFrom = `${SAMPLE_ADORN_KEY_PREFIX}${from}`
    const adornTo = `${SAMPLE_ADORN_KEY_PREFIX}${to}`
    if (Object.prototype.hasOwnProperty.call(next, adornFrom)) {
      next[adornTo] = next[adornFrom]
      delete next[adornFrom]
    }
  }
  return next
}

/**
 * @param {unknown} raw
 * @param {{ from: string, to: string }[]} renames
 */
export function applyColumnRenamesToPageNavColumn(raw, renames) {
  if (!renames.length) return serializePageNavColumns(raw)
  const map = new Map(renames.map((r) => [r.from, r.to]))
  const cols = parsePageNavColumns(raw).map((c) => map.get(c) ?? c)
  return serializePageNavColumns(cols)
}

/**
 * @param {Record<string, unknown>} obj
 * @param {{ from: string, to: string }[]} renames
 */
export function applyColumnRenamesToRecordKeys(obj, renames) {
  let next = obj && typeof obj === 'object' ? { ...obj } : {}
  for (const { from, to } of renames) {
    if (Object.prototype.hasOwnProperty.call(next, from)) {
      next[to] = next[from]
      delete next[from]
    }
  }
  return next
}
