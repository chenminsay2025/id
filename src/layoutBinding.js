import {
  layoutHasBox,
  isLayoutBoxActive,
  getColumnLayout,
  applyColumnBoxBounds,
  hasBuiltinColumnLayout,
  isPedigreeStyleTable,
  TEMPLATE_VIEWBOX,
} from './svgEngine.js'
import { TEMPLATE_BACKGROUND_KEY, isTemplateBackgroundMetaKey } from './templateBackground.js'
import {
  LAYOUT_GROUPS_KEY,
  removeBoxFromLayoutGroups,
  renameBoxInLayoutGroups,
} from './layoutGroups.js'

/** 存在 layoutOverrides 内的列名→编辑框 id 映射（与证书 layout_overrides 一并持久化） */
export const LAYOUT_BINDINGS_KEY = '__columnBoxBindings'

/** 布局模板库：当前表格非血统证书表时写入，禁止套用 SVG 内置列默认布局 */
export const TABLE_TEMPLATE_SCOPE_KEY = '__tableTemplateScope'

/** 运行时：当前表格模板列名（与 __tableTemplateScope 配套，不持久化） */
export const TABLE_TEMPLATE_COLUMNS_KEY = '__tableTemplateColumns'

export { LAYOUT_GROUPS_KEY }

const DEFAULT_NEW_BOX = {
  boxLeft: 200,
  boxRight: 400,
  boxTop: 200,
  boxBottom: 240,
  letterSpacing: 0,
  textScaleXPercent: 100,
  fontSize: 7.29,
  lineHeight: 8,
  contentAlignH: 'left',
  contentAlignV: 'center',
}

export function mergeCertificatePresetLayout(certOverrides = {}, presetOverrides = {}) {
  const cert = certOverrides && typeof certOverrides === 'object' ? certOverrides : {}
  const preset = presetOverrides && typeof presetOverrides === 'object' ? presetOverrides : {}

  const presetHas = listLayoutBoxIds(preset).length > 0
  const certHas = listLayoutBoxIds(cert).length > 0

  if (!presetHas && !certHas) return {}
  if (!presetHas) return { ...cert }
  if (!certHas) return { ...preset }

  const merged = { ...cert, ...preset }
  if (preset[LAYOUT_BINDINGS_KEY] || cert[LAYOUT_BINDINGS_KEY]) {
    merged[LAYOUT_BINDINGS_KEY] = {
      ...(cert[LAYOUT_BINDINGS_KEY] && typeof cert[LAYOUT_BINDINGS_KEY] === 'object'
        ? cert[LAYOUT_BINDINGS_KEY]
        : {}),
      ...(preset[LAYOUT_BINDINGS_KEY] && typeof preset[LAYOUT_BINDINGS_KEY] === 'object'
        ? preset[LAYOUT_BINDINGS_KEY]
        : {}),
    }
  }
  if (preset[LAYOUT_GROUPS_KEY] != null) {
    merged[LAYOUT_GROUPS_KEY] = preset[LAYOUT_GROUPS_KEY]
  } else if (cert[LAYOUT_GROUPS_KEY] != null) {
    merged[LAYOUT_GROUPS_KEY] = cert[LAYOUT_GROUPS_KEY]
  }
  if (preset[TABLE_TEMPLATE_SCOPE_KEY] != null) {
    merged[TABLE_TEMPLATE_SCOPE_KEY] = preset[TABLE_TEMPLATE_SCOPE_KEY]
  }
  return merged
}

export function getBindings(layoutOverrides = {}) {
  const raw = layoutOverrides[LAYOUT_BINDINGS_KEY]
  return raw && typeof raw === 'object' ? { ...raw } : {}
}

export function withBindings(layoutOverrides, bindings) {
  const next = { ...layoutOverrides }
  const clean = bindings && Object.keys(bindings).length
    ? bindings
    : null
  if (clean) next[LAYOUT_BINDINGS_KEY] = clean
  else delete next[LAYOUT_BINDINGS_KEY]
  return next
}

/** 表格列绑定的编辑框 id；未绑定时列名即编辑框 id */
export function resolveBoxId(column, layoutOverrides = {}) {
  const bindings = getBindings(layoutOverrides)
  return bindings[column] ?? column
}

/** 反查：哪些表格列绑定到该编辑框 */
export function getColumnsForBox(boxId, layoutOverrides = {}) {
  const bindings = getBindings(layoutOverrides)
  const cols = []
  for (const [col, bound] of Object.entries(bindings)) {
    if (bound === boxId) cols.push(col)
  }
  if (!cols.length && boxId && !bindings[boxId]) {
    cols.push(boxId)
  }
  return cols
}

/** 点击编辑框时优先返回已绑定的表格列名 */
export function getPrimaryColumnForBox(boxId, layoutOverrides = {}) {
  const bound = getColumnsForBox(boxId, layoutOverrides)
  return bound[0] ?? boxId
}

/** 解析编辑框当前生效的完整布局（含 COLUMN_LAYOUT 默认 + overrides） */
export function getEffectiveBoxLayout(boxId, layoutOverrides = {}) {
  const resolved = resolveBoxId(boxId, layoutOverrides)
  // 使用存储键（resolved）合并内置列默认；勿用 primaryCol，否则「证书编号→编号」会漏掉编号列默认样式
  return getColumnLayout(resolved, layoutOverrides)
}

export function listLayoutBoxIds(layoutOverrides = {}) {
  const ids = new Set()
  for (const key of Object.keys(layoutOverrides)) {
    if (key === LAYOUT_BINDINGS_KEY || key === LAYOUT_GROUPS_KEY) continue
    if (isTemplateBackgroundMetaKey(key)) continue
    const layout = layoutOverrides[key]
    if (layout && isLayoutBoxActive(layout)) ids.add(key)
  }
  for (const boxId of Object.values(getBindings(layoutOverrides))) {
    if (boxId) ids.add(boxId)
  }
  return [...ids]
}

/** 用于判断 overlay 是否需完整重建（同 id 不同位置时 syncOverrides 不能只 refresh 几何） */
export function layoutOverridesOverlaySignature(layoutOverrides = {}) {
  return listLayoutBoxIds(layoutOverrides).sort().map((id) => {
    const layout = getEffectiveBoxLayout(id, layoutOverrides)
    return [
      id,
      layout.boxLeft,
      layout.boxRight,
      layout.boxTop,
      layout.boxBottom,
      layout.boxHidden ? 1 : 0,
    ].join(':')
  }).join('\0')
}

/** 非表格列绑定的自定义编辑框 id */
export function listCustomLayoutBoxIds(layoutOverrides = {}, tableColumns = []) {
  const tableColSet = new Set(tableColumns)
  return listLayoutBoxIds(layoutOverrides).filter((id) => !tableColSet.has(id))
}

/**
 * @param {object} layoutOverrides
 * @param {string[]} [tableColumns]
 */
export function listLayoutBoxes(layoutOverrides = {}, tableColumns = []) {
  const bindings = getBindings(layoutOverrides)
  const ids = new Set(listLayoutBoxIds(layoutOverrides))
  for (const col of tableColumns) {
    ids.add(resolveBoxId(col, layoutOverrides))
  }
  const items = []
  for (const id of ids) {
    const layout = layoutOverrides[id]
    if (!layout || !layoutHasBox(layout)) continue
    const boundCols = getColumnsForBox(id, layoutOverrides)
    const boundLabel = boundCols.filter((c) => c !== id).join('、') || null
    items.push({
      id,
      boundColumns: boundCols,
      boundLabel,
      isBound: boundCols.some((c) => bindings[c] === id) || boundCols.includes(id),
    })
  }
  items.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))
  return items
}

/** 将误绑到 SVG 内置列的布局数据迁回表格列名（如「编号」→「证书编号」） */
function migrateBuiltinLayoutToColumn(next, column, builtinBoxId) {
  if (!column || !builtinBoxId || column === builtinBoxId) return next
  const from = next[builtinBoxId]
  if (!from || typeof from !== 'object' || !layoutHasBox(from)) return next
  const merged = { ...(next[column] || {}), ...from }
  if (!from.boxHidden) delete merged.boxHidden
  const result = { ...next, [column]: merged }
  delete result[builtinBoxId]
  return result
}

export function syncAutoColumnBindings(layoutOverrides, tableColumns = []) {
  const boxIds = new Set(listLayoutBoxIds(layoutOverrides))
  const bindings = getBindings(layoutOverrides)
  const nextBindings = { ...bindings }
  const tableColSet = new Set(tableColumns)
  let changed = false
  let next = layoutOverrides

  for (const col of tableColumns) {
    if (boxIds.has(col) && col in nextBindings) {
      delete nextBindings[col]
      changed = true
    }
  }

  for (const [col, boxId] of Object.entries(bindings)) {
    if (col === boxId) {
      delete nextBindings[col]
      changed = true
      continue
    }
    if (boxId && !boxIds.has(boxId)) {
      delete nextBindings[col]
      changed = true
      continue
    }
    // 表格列误绑到本表不存在的内置列（如「证书编号」→「编号」）时解除绑定并迁移布局
    if (tableColSet.has(col) && boxId !== col && hasBuiltinColumnLayout(boxId) && !tableColSet.has(boxId)) {
      next = migrateBuiltinLayoutToColumn(next, col, boxId)
      delete nextBindings[col]
      changed = true
    }
  }

  if (!changed) return layoutOverrides
  return withBindings(next, nextBindings)
}

export function stripLayoutOverrideMeta(layoutOverrides = {}) {
  if (!layoutOverrides || typeof layoutOverrides !== 'object') return {}
  const next = { ...layoutOverrides }
  delete next[TABLE_TEMPLATE_SCOPE_KEY]
  delete next[TABLE_TEMPLATE_COLUMNS_KEY]
  return next
}

/**
 * 仅保留当前表格模板相关的编辑框与绑定，剥离血统内置列及其它表遗留数据。
 * @param {object} layoutOverrides
 * @param {string[]} tableColumns
 */
export function pruneLayoutOverridesForTable(layoutOverrides, tableColumns = []) {
  const base = stripLayoutOverrideMeta(layoutOverrides)
  let next = syncAutoColumnBindings(base, tableColumns)
  const tableColSet = new Set(tableColumns)
  const bindings = getBindings(next)
  const keepIds = new Set()

  for (const col of tableColumns) {
    keepIds.add(col)
    keepIds.add(resolveBoxId(col, next))
  }
  for (const boxId of Object.values(bindings)) {
    if (boxId) keepIds.add(boxId)
  }

  for (const key of Object.keys(next)) {
    if (key === LAYOUT_BINDINGS_KEY || key === LAYOUT_GROUPS_KEY || key === TEMPLATE_BACKGROUND_KEY) continue
    if (tableColSet.has(key)) continue
    const layout = next[key]
    const isBindingTarget = Object.values(getBindings(next)).includes(key)
    const hasLayout = layout && typeof layout === 'object' && layoutHasBox(layout)
    // 自定义编辑框可能在 layout_overrides 中有显式几何，即使 id 与血统内置列同名也应保留
    if (isBindingTarget || hasLayout) {
      keepIds.add(key)
    }
  }

  for (const key of Object.keys(next)) {
    if (key === LAYOUT_BINDINGS_KEY || key === LAYOUT_GROUPS_KEY || key === TEMPLATE_BACKGROUND_KEY) continue
    if (keepIds.has(key)) continue
    delete next[key]
  }

  return syncAutoColumnBindings(next, tableColumns)
}

/** 与布局模板库一致：非血统表启用 __tableTemplateScope，避免 SVG 内置列默认布局覆盖 preset */
export function applyTableTemplateScopeFlag(layoutOverrides, tableColumns = []) {
  const next = { ...layoutOverrides }
  const cols = (tableColumns || []).map((c) => String(c).trim()).filter(Boolean)
  if (!isPedigreeStyleTable(cols)) {
    next[TABLE_TEMPLATE_SCOPE_KEY] = true
    next[TABLE_TEMPLATE_COLUMNS_KEY] = cols
  } else {
    delete next[TABLE_TEMPLATE_SCOPE_KEY]
    delete next[TABLE_TEMPLATE_COLUMNS_KEY]
  }
  return next
}

export function bindColumnToBox(layoutOverrides, column, boxId) {
  const bindings = getBindings(layoutOverrides)
  const nextBindings = { ...bindings }
  if (!boxId || boxId === column) {
    delete nextBindings[column]
  } else {
    nextBindings[column] = boxId
  }
  return withBindings(layoutOverrides, nextBindings)
}

export function generateLayoutBoxId(layoutOverrides = {}) {
  let n = 1
  while (layoutOverrides[`编辑框${n}`]) n += 1
  return `编辑框${n}`
}

export function createLayoutBox(layoutOverrides, boxId, bounds = DEFAULT_NEW_BOX) {
  const id = boxId || generateLayoutBoxId(layoutOverrides)
  let overrides = applyColumnBoxBounds(layoutOverrides, id, bounds)
  overrides = unhideLayoutBoxes(overrides, [id])
  return {
    overrides,
    boxId: id,
  }
}

/**
 * 表格列重命名：同步 layoutOverrides 中的编辑框键、列绑定与分组引用。
 * @param {object} layoutOverrides
 * @param {string} oldName
 * @param {string} newName
 * @param {string[]} [tableColumns] 重命名后的表格列顺序（用于清理绑定）
 */
export function renameLayoutColumn(layoutOverrides, oldName, newName, tableColumns = null) {
  if (!oldName || !newName || oldName === newName) {
    return layoutOverrides
  }
  const resolvedBoxId = resolveBoxId(oldName, layoutOverrides)
  const cols = tableColumns ?? []
  let next = layoutOverrides

  if (resolvedBoxId === oldName) {
    next = renameLayoutBox(next, oldName, newName)
  } else {
    const bindings = getBindings(next)
    const nextBindings = { ...bindings }
    delete nextBindings[oldName]
    nextBindings[newName] = resolvedBoxId
    next = withBindings(next, nextBindings)
    if (next[oldName] && oldName !== resolvedBoxId) {
      delete next[oldName]
    }
  }

  if (cols.length) {
    return syncAutoColumnBindings(next, cols)
  }
  return next
}

export function patchLayoutBox(layoutOverrides, columnOrBoxId, patch) {
  const boxId = resolveBoxId(columnOrBoxId, layoutOverrides)
  const next = { ...layoutOverrides }
  next[boxId] = { ...(next[boxId] || {}), ...patch }
  return next
}

/** 隐藏编辑框：保留布局与绑定，SVG 数据层不再渲染该列文字 */
export function hideLayoutBoxes(layoutOverrides, boxIds) {
  let next = layoutOverrides
  for (const id of boxIds) {
    if (!id) continue
    const full = getColumnLayout(id, next)
    if (!layoutHasBox(full)) continue
    const resolved = resolveBoxId(id, next)
    next = patchLayoutBox(next, resolved, { ...full, boxHidden: true })
  }
  return next
}

/** 取消隐藏（若 overrides 中无记录则写入当前合并布局） */
export function unhideLayoutBoxes(layoutOverrides, boxIds) {
  let next = layoutOverrides
  for (const id of boxIds) {
    if (!id) continue
    const resolved = resolveBoxId(id, next)
    const full = { ...getColumnLayout(id, next), ...(next[resolved] || {}) }
    if (!layoutHasBox(full)) continue
    const stored = { ...(next[resolved] || {}), ...full }
    delete stored.boxHidden
    next = { ...next, [resolved]: stored }
    if (id !== resolved && next[id] && typeof next[id] === 'object') {
      const colStored = { ...next[id] }
      delete colStored.boxHidden
      if (layoutHasBox(colStored)) {
        next = { ...next, [id]: colStored }
      } else if (Object.keys(colStored).every((k) => k === 'lineHeight' || colStored[k] == null)) {
        const cleaned = { ...next }
        delete cleaned[id]
        next = cleaned
      } else {
        next = { ...next, [id]: colStored }
      }
    }
  }
  return next
}

export function deleteLayoutBox(layoutOverrides, boxId) {
  if (!boxId) return layoutOverrides
  let next = { ...layoutOverrides }
  delete next[boxId]
  const bindings = getBindings(next)
  const nextBindings = { ...bindings }
  for (const [col, bound] of Object.entries(bindings)) {
    if (bound === boxId) delete nextBindings[col]
  }
  next = withBindings(next, nextBindings)
  return removeBoxFromLayoutGroups(next, boxId)
}

export function renameLayoutBox(layoutOverrides, oldId, newId) {
  const trimmed = String(newId || '').trim()
  if (!oldId || !trimmed || oldId === trimmed) return layoutOverrides
  if (trimmed === LAYOUT_BINDINGS_KEY || trimmed === LAYOUT_GROUPS_KEY) return layoutOverrides
  let next = { ...layoutOverrides }
  if (next[oldId]) {
    if (next[trimmed]) {
      next[trimmed] = { ...next[trimmed], ...next[oldId] }
    } else {
      next[trimmed] = next[oldId]
    }
    delete next[oldId]
  }
  const bindings = getBindings(next)
  const nextBindings = {}
  for (const [col, bound] of Object.entries(bindings)) {
    nextBindings[col] = bound === oldId ? trimmed : bound
  }
  if (!bindings[oldId] && !nextBindings[trimmed] && !next[trimmed]) {
    next[trimmed] = {}
  }
  next = withBindings(next, nextBindings)
  return renameBoxInLayoutGroups(next, oldId, trimmed)
}

export function defaultNewBoxBounds() {
  const w = TEMPLATE_VIEWBOX.width
  const h = TEMPLATE_VIEWBOX.height
  return {
    ...DEFAULT_NEW_BOX,
    boxLeft: Math.round(w * 0.25),
    boxRight: Math.round(w * 0.55),
    boxTop: Math.round(h * 0.35),
    boxBottom: Math.round(h * 0.45),
  }
}
