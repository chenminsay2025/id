const MAX_LAYOUT_HISTORY = 50

/** @typedef {{ history: Record<string, object>[], index: number }} LayoutHistoryStore */

/** @type {Map<string, LayoutHistoryStore>} */
const stores = new Map()

function getStore(context = 'main') {
  let store = stores.get(context)
  if (!store) {
    store = { history: [], index: -1 }
    stores.set(context, store)
  }
  return store
}

export function snapshotLayoutOverrides(overrides) {
  return JSON.parse(JSON.stringify(overrides || {}))
}

function trimLayoutHistory(store) {
  while (store.history.length > MAX_LAYOUT_HISTORY) {
    if (store.history.length <= 1) break
    store.history.splice(1, 1)
    store.index = Math.max(0, store.index - 1)
  }
}

/**
 * @param {Record<string, object>} [overrides]
 * @param {string} [context] 'main' 证书编辑页；'presets' 布局模板库
 */
export function initLayoutHistory(overrides = {}, context = 'main') {
  const store = getStore(context)
  store.history = [snapshotLayoutOverrides(overrides)]
  store.index = 0
}

/**
 * @param {Record<string, object>} overrides
 * @param {string} [context]
 */
export function updateLayoutHistoryBaseline(overrides, context = 'main') {
  const store = getStore(context)
  const snap = snapshotLayoutOverrides(overrides)
  if (store.history.length === 0) {
    initLayoutHistory(snap, context)
    return
  }
  if (store.index === 0 && store.history.length === 1) {
    store.history[0] = snap
  }
}

/**
 * @param {Record<string, object>} overrides
 * @param {string} [context]
 */
export function recordLayoutHistory(overrides, context = 'main') {
  const store = getStore(context)
  const snap = snapshotLayoutOverrides(overrides)
  if (store.history.length === 0 || store.index < 0) {
    initLayoutHistory(snap, context)
    return
  }

  const cur = store.history[store.index]
  if (JSON.stringify(cur) === JSON.stringify(snap)) return

  store.history = store.history.slice(0, store.index + 1)
  store.history.push(snap)
  trimLayoutHistory(store)
  store.index = store.history.length - 1
}

/**
 * @param {string} [context]
 */
export function canUndoLayout(context = 'main') {
  const store = getStore(context)
  return store.index > 0
}

/**
 * @param {string} [context]
 */
export function canRedoLayout(context = 'main') {
  const store = getStore(context)
  return store.index >= 0 && store.index < store.history.length - 1
}

/**
 * @param {string} [context]
 * @returns {Record<string, object> | null}
 */
export function undoLayout(context = 'main') {
  if (!canUndoLayout(context)) return null
  const store = getStore(context)
  store.index -= 1
  return snapshotLayoutOverrides(store.history[store.index])
}

/**
 * @param {string} [context]
 * @returns {Record<string, object> | null}
 */
export function redoLayout(context = 'main') {
  if (!canRedoLayout(context)) return null
  const store = getStore(context)
  store.index += 1
  return snapshotLayoutOverrides(store.history[store.index])
}

/**
 * @param {string} [context]
 */
export function getLayoutHistoryState(context = 'main') {
  return { canUndo: canUndoLayout(context), canRedo: canRedoLayout(context) }
}

/** 布局模板库专用上下文（与证书编辑页历史栈隔离） */
export const LAYOUT_HISTORY_PRESETS = 'presets'
