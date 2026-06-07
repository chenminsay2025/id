import {
  resolveBoxId,
  listLayoutBoxIds,
  getBindings,
  withBindings,
  getEffectiveBoxLayout,
  getPrimaryColumnForBox,
} from './layoutBinding.js'
import {
  layoutHasBox,
  clampLayoutBoxBounds,
} from './svgEngine.js'

const PASTE_OFFSET_X = 12
const PASTE_OFFSET_Y = 12
const CLIPBOARD_STORAGE_KEY = 'cat5-layout-box-clipboard'
const CLIPBOARD_VERSION = 3

/** @type {{ version: number, sourceBoxId?: string, layout?: object, content?: string, sampleAdornments?: object | null, items?: object[] } | null} */
let clipboard = null

function isValidClipboardItem(item) {
  return item?.layout && layoutHasBox(item.layout)
}

function normalizeClipboardItems(data) {
  if (!data) return []
  if (Array.isArray(data.items) && data.items.length) {
    return data.items.filter(isValidClipboardItem)
  }
  if (isValidClipboardItem(data)) {
    return [data]
  }
  return []
}

function syncClipboardFromSession() {
  try {
    const raw = sessionStorage.getItem(CLIPBOARD_STORAGE_KEY)
    if (!raw) {
      clipboard = null
      return
    }
    const data = JSON.parse(raw)
    clipboard = normalizeClipboardItems(data).length ? data : null
  } catch {
    clipboard = null
  }
}

function getClipboardItems() {
  syncClipboardFromSession()
  return normalizeClipboardItems(clipboard)
}

function saveClipboardToSession() {
  try {
    if (clipboard) {
      sessionStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(clipboard))
    } else {
      sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY)
    }
  } catch {
    /* sessionStorage unavailable */
  }
}

syncClipboardFromSession()

export function getLayoutBoxClipboard() {
  return clipboard
}

export function hasLayoutBoxClipboard() {
  return getClipboardItems().length > 0
}

export function clearLayoutBoxClipboard() {
  clipboard = null
  saveClipboardToSession()
}

/**
 * 复制到剪贴板时保留完整布局属性（仅去掉 boxHidden）。
 * @param {object} layout
 */
export function toPortableLayoutSnapshot(layout) {
  const next = structuredClone(layout)
  delete next.boxHidden

  if (!next.contentAlignH && next.align && ['left', 'center', 'right'].includes(next.align)) {
    next.contentAlignH = next.align
  }
  delete next.align

  return next
}

/**
 * @param {string} sourceBoxId
 * @param {object} layoutOverrides
 * @param {string[]} [tableColumns]
 * @param {string[]} [reservedIds] 仅存在于侧栏暂存、不在 overrides 中的框名
 */
export function generatePastedBoxId(sourceBoxId, layoutOverrides, tableColumns = [], reservedIds = []) {
  const taken = new Set([
    ...listLayoutBoxIds(layoutOverrides),
    ...tableColumns,
    ...reservedIds.filter(Boolean),
  ])
  const base = `${sourceBoxId}copy`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n += 1
  return `${base}${n}`
}

function pasteSingleClipboardItem(layoutOverrides, item, options = {}) {
  const tableColumns = options.tableColumns || []
  const customBoxIds = options.customBoxIds || []
  const reservedIds = options.reservedIds || []
  const offsetX = options.offsetX ?? PASTE_OFFSET_X
  const offsetY = options.offsetY ?? PASTE_OFFSET_Y
  const itemKind = resolveClipboardItemKind(item, tableColumns)

  const { boxId, mode, match } = resolvePasteTargetBoxId(item.sourceBoxId, layoutOverrides, {
    tableColumns,
    customBoxIds,
    reservedIds,
    isVisible: options.isVisible,
    sourceColumnTitle: itemKind === 'table' ? (item.sourceColumnTitle ?? null) : null,
    itemKind,
  })

  let layout = structuredClone(item.layout)
  // 仅在同模板内为避免与已显示框重叠而偏移；跨模板 / 新建框保留剪贴板坐标
  if (mode === 'copy' && layoutHasBox(layout)) {
    layout = {
      ...layout,
      ...clampLayoutBoxBounds({
        boxLeft: layout.boxLeft + offsetX,
        boxRight: layout.boxRight + offsetX,
        boxTop: layout.boxTop + offsetY,
        boxBottom: layout.boxBottom + offsetY,
      }),
    }
  }

  const overrides = applyPastedLayoutToOverrides(layoutOverrides, layout, boxId, tableColumns)

  return {
    overrides,
    boxId,
    content: item.content ?? '',
    sampleAdornments: item.sampleAdornments ?? null,
    mode,
    match,
    sourceBoxId: item.sourceBoxId,
  }
}

/** @returns {'table' | 'custom'} */
function resolveClipboardItemKind(item, tableColumns = []) {
  if (item?.kind === 'table' || item?.kind === 'custom') return item.kind
  if (tableColumns.includes(item?.sourceBoxId)) return 'table'
  return 'custom'
}

/** 复制时判定：表格列 vs 独立自定义编辑框 */
function captureClipboardItemKind(boxId, resolved, layoutOverrides, tableColumns) {
  if (tableColumns.includes(boxId)) return 'table'
  const bindings = getBindings(layoutOverrides)
  for (const [col, bound] of Object.entries(bindings)) {
    if (tableColumns.includes(col) && bound === resolved) return 'table'
  }
  return 'custom'
}
/** 去掉「自定-」前缀与尾部 copy 后缀，便于匹配表格列名（仅表格列粘贴时使用） */
function normalizePasteColumnMatchId(boxId) {
  let id = String(boxId || '').trim()
  if (id.startsWith('自定-')) id = id.slice(3)
  while (/copy\d*$/i.test(id)) {
    id = id.replace(/copy\d*$/i, '')
  }
  return id
}

/** @returns {string | null} 与目标表格列名匹配的列 id */
function findTableColumnForPaste(sourceBoxId, sourceColumnTitle, layoutOverrides, tableColumns) {
  const candidates = new Set()
  if (sourceColumnTitle && tableColumns.includes(sourceColumnTitle)) {
    candidates.add(sourceColumnTitle)
  }
  if (sourceBoxId) candidates.add(sourceBoxId)
  const normalized = normalizePasteColumnMatchId(sourceBoxId)
  if (normalized) candidates.add(normalized)

  for (const col of tableColumns) {
    if (candidates.has(col)) return col
  }
  for (const col of tableColumns) {
    if (resolveBoxId(col, layoutOverrides) === sourceBoxId) return col
  }
  return null
}

/**
 * 在目标模板表格列中查找与源框对应的列（优先按列标题匹配）。
 * @returns {{ id: string, kind: 'table' | 'custom' } | null}
 */
export function findPickerMatchForPaste(
  sourceBoxId,
  layoutOverrides,
  tableColumns = [],
  customBoxIds = [],
  sourceColumnTitle = null,
  itemKind = null,
) {
  if (itemKind !== 'custom') {
    const tableCol = findTableColumnForPaste(sourceBoxId, sourceColumnTitle, layoutOverrides, tableColumns)
    if (tableCol) {
      return { id: tableCol, kind: 'table' }
    }
  }

  if (customBoxIds.includes(sourceBoxId)) {
    return { id: sourceBoxId, kind: 'custom' }
  }
  for (const customId of customBoxIds) {
    if (resolveBoxId(customId, layoutOverrides) === sourceBoxId) {
      return { id: customId, kind: 'custom' }
    }
  }
  return null
}

/**
 * 决定粘贴目标 id：列中存在且未启用则复用；已启用或重名则加 copy。
 * @returns {{ boxId: string, mode: 'reuse' | 'copy' | 'new', match: ReturnType<typeof findPickerMatchForPaste> }}
 */
export function resolvePasteTargetBoxId(sourceBoxId, layoutOverrides, options = {}) {
  const tableColumns = options.tableColumns || []
  const customBoxIds = options.customBoxIds || []
  const reservedIds = options.reservedIds || []
  const isVisible = options.isVisible || (() => false)
  const sourceColumnTitle = options.sourceColumnTitle ?? null
  const itemKind = options.itemKind ?? null

  const match = findPickerMatchForPaste(
    sourceBoxId,
    layoutOverrides,
    tableColumns,
    customBoxIds,
    sourceColumnTitle,
    itemKind,
  )
  if (match) {
    if (isVisible(match.id)) {
      return {
        boxId: generatePastedBoxId(sourceBoxId, layoutOverrides, tableColumns, reservedIds),
        mode: 'copy',
        match,
      }
    }
    return { boxId: match.id, mode: 'reuse', match }
  }

  const taken = new Set([
    ...listLayoutBoxIds(layoutOverrides),
    ...reservedIds.filter(Boolean),
  ])
  if (!taken.has(sourceBoxId)) {
    return { boxId: sourceBoxId, mode: 'new', match: null }
  }
  return {
    boxId: generatePastedBoxId(sourceBoxId, layoutOverrides, tableColumns, reservedIds),
    mode: 'copy',
    match: null,
  }
}

/**
 * @param {string} boxId
 * @param {object} layoutOverrides
 * @param {string[]} [tableColumns]
 */
export function captureLayoutBoxSnapshot(boxId, layoutOverrides, tableColumns = []) {
  const resolved = resolveBoxId(boxId, layoutOverrides)
  const merged = getEffectiveBoxLayout(resolved, layoutOverrides)
  if (!layoutHasBox(merged)) return null

  const kind = captureClipboardItemKind(boxId, resolved, layoutOverrides, tableColumns)
  let sourceColumnTitle = null
  if (kind === 'table') {
    if (tableColumns.includes(boxId)) {
      sourceColumnTitle = boxId
    } else {
      const bindings = getBindings(layoutOverrides)
      for (const [col, bound] of Object.entries(bindings)) {
        if (tableColumns.includes(col) && bound === resolved) {
          sourceColumnTitle = col
          break
        }
      }
      if (!sourceColumnTitle) {
        const primary = getPrimaryColumnForBox(resolved, layoutOverrides)
        if (tableColumns.includes(primary)) sourceColumnTitle = primary
      }
    }
  }

  return {
    sourceBoxId: resolved,
    sourceColumnTitle,
    kind,
    layout: toPortableLayoutSnapshot(merged),
  }
}

function normalizePastedLayout(layout) {
  return toPortableLayoutSnapshot(layout)
}

function applyPastedLayoutToOverrides(layoutOverrides, layout, boxId, tableColumns) {
  let next = { ...layoutOverrides }
  const cleanLayout = normalizePastedLayout(layout)

  if (tableColumns.includes(boxId)) {
    const storeId = resolveBoxId(boxId, next)
    next[storeId] = cleanLayout
    if (boxId !== storeId && next[boxId] && typeof next[boxId] === 'object') {
      const colOnly = { ...next[boxId] }
      delete colOnly.boxHidden
      if (!layoutHasBox(colOnly) || Object.keys(colOnly).every((k) => k === 'lineHeight' || colOnly[k] == null)) {
        const cleaned = { ...next }
        delete cleaned[boxId]
        next = cleaned
      }
    }
  } else {
    next[boxId] = cleanLayout
  }

  const bindings = getBindings(next)
  const nextBindings = { ...bindings }
  for (const col of tableColumns) {
    if (nextBindings[col] === boxId) delete nextBindings[col]
  }
  const storeId = resolveBoxId(boxId, next)
  if (nextBindings[storeId] === storeId) delete nextBindings[storeId]
  if (nextBindings[boxId] === boxId) delete nextBindings[boxId]
  return withBindings(next, nextBindings)
}

/**
 * @param {Array<{ boxId: string, content?: string, sampleAdornments?: object | null }>} entries
 * @param {object} layoutOverrides
 * @param {{ sourcePresetId?: number | null, tableColumns?: string[] }} [meta]
 */
export function copyLayoutBoxesToClipboard(entries, layoutOverrides, meta = {}) {
  const tableColumns = meta.tableColumns || []
  const items = []
  for (const entry of entries) {
    const snapshot = captureLayoutBoxSnapshot(entry.boxId, layoutOverrides, tableColumns)
    if (!snapshot) continue
    items.push({
      ...snapshot,
      content: entry.content != null ? String(entry.content) : '',
      sampleAdornments: entry.sampleAdornments
        ? structuredClone(entry.sampleAdornments)
        : null,
    })
  }
  if (!items.length) return false
  clipboard = structuredClone({
    version: CLIPBOARD_VERSION,
    ...meta,
    items,
  })
  saveClipboardToSession()
  syncClipboardFromSession()
  return normalizeClipboardItems(clipboard).length > 0
}

/**
 * @param {string} boxId
 * @param {object} layoutOverrides
 * @param {string} [content]
 * @param {{ sampleAdornments?: { prefix?: unknown[], suffix?: unknown[] } | null }} [extras]
 */
export function copyLayoutBoxToClipboard(boxId, layoutOverrides, content = '', extras = {}) {
  return copyLayoutBoxesToClipboard([{
    boxId,
    content,
    sampleAdornments: extras.sampleAdornments ?? null,
  }], layoutOverrides)
}

/**
 * @param {object} layoutOverrides
 * @param {{
 *   tableColumns?: string[],
 *   customBoxIds?: string[],
 *   offsetX?: number,
 *   offsetY?: number,
 *   reservedIds?: string[],
 *   isVisible?: (id: string) => boolean,
 * }} [options]
 */
export function pasteLayoutBoxesFromClipboard(layoutOverrides, options = {}) {
  const items = getClipboardItems()
  if (!items.length) return null

  let next = layoutOverrides
  /** @type {ReturnType<typeof pasteSingleClipboardItem>[]} */
  const results = []
  const reservedIds = [...(options.reservedIds || [])]

  for (const item of items) {
    const result = pasteSingleClipboardItem(next, item, {
      ...options,
      reservedIds,
    })
    if (!result) continue
    next = result.overrides
    results.push(result)
    reservedIds.push(result.boxId)
  }

  if (!results.length) return null

  return {
    overrides: next,
    items: results,
    boxIds: results.map((r) => r.boxId),
  }
}

/**
 * @param {object} layoutOverrides
 * @param {{
 *   tableColumns?: string[],
 *   customBoxIds?: string[],
 *   offsetX?: number,
 *   offsetY?: number,
 *   reservedIds?: string[],
 *   isVisible?: (id: string) => boolean,
 * }} [options]
 */
export function pasteLayoutBoxFromClipboard(layoutOverrides, options = {}) {
  const batch = pasteLayoutBoxesFromClipboard(layoutOverrides, options)
  if (!batch?.items?.length) return null
  return batch.items[0]
}

/**
 * 拖拽复制：在 layoutOverrides 中复制多个编辑框并平移到新位置（源框不动）
 * @param {object} layoutOverrides
 * @param {string[]} sourceBoxIds
 * @param {number} dx SVG 用户单位水平位移
 * @param {number} dy SVG 用户单位垂直位移
 * @param {{ tableColumns?: string[], reservedIds?: string[] }} [options]
 */
export function duplicateLayoutBoxesAtOffset(
  layoutOverrides,
  sourceBoxIds,
  dx,
  dy,
  options = {},
) {
  const tableColumns = options.tableColumns || []
  const reservedIds = options.reservedIds || []
  const sources = [...new Set(sourceBoxIds.filter(Boolean))]
  if (!sources.length) return null

  let next = { ...layoutOverrides }
  /** @type {Record<string, string>} */
  const idMap = {}
  const newBoxIds = []

  for (const boxId of sources) {
    const snapshot = captureLayoutBoxSnapshot(boxId, next)
    if (!snapshot) continue

    const newId = generatePastedBoxId(
      snapshot.sourceBoxId,
      next,
      tableColumns,
      [...reservedIds, ...newBoxIds],
    )
    let layout = structuredClone(snapshot.layout)
    if (layoutHasBox(layout)) {
      layout = {
        ...layout,
        ...clampLayoutBoxBounds({
          boxLeft: layout.boxLeft + dx,
          boxRight: layout.boxRight + dx,
          boxTop: layout.boxTop + dy,
          boxBottom: layout.boxBottom + dy,
        }),
      }
    }
    layout = normalizePastedLayout(layout)
    next[newId] = layout
    idMap[boxId] = newId
    newBoxIds.push(newId)
  }

  if (!newBoxIds.length) return null

  const bindings = getBindings(next)
  const nextBindings = { ...bindings }
  for (const col of tableColumns) {
    if (newBoxIds.includes(nextBindings[col])) delete nextBindings[col]
  }
  for (const newId of newBoxIds) {
    if (nextBindings[newId] === newId) delete nextBindings[newId]
  }
  next = withBindings(next, nextBindings)

  return { overrides: next, idMap, newBoxIds }
}
