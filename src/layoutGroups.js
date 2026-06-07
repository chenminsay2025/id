/** 存在 layoutOverrides 内的用户编组（与 layout_overrides / 布局预设一并持久化） */
export const LAYOUT_GROUPS_KEY = '__layoutGroups'

/** @typedef {{ name?: string, boxIds: string[] }} LayoutGroup */

/** @param {object} layoutOverrides @returns {Record<string, LayoutGroup>} */
export function getLayoutGroups(layoutOverrides = {}) {
  const raw = layoutOverrides[LAYOUT_GROUPS_KEY]
  if (!raw || typeof raw !== 'object') return {}
  /** @type {Record<string, LayoutGroup>} */
  const out = {}
  for (const [id, g] of Object.entries(raw)) {
    if (!g || typeof g !== 'object') continue
    const boxIds = Array.isArray(g.boxIds) ? g.boxIds.filter(Boolean) : []
    if (boxIds.length < 2) continue
    out[id] = { name: g.name ? String(g.name) : undefined, boxIds: [...new Set(boxIds)] }
  }
  return out
}

/** @param {object} layoutOverrides @param {Record<string, LayoutGroup>} groups */
export function withLayoutGroups(layoutOverrides, groups) {
  const next = { ...layoutOverrides }
  const clean = {}
  for (const [id, g] of Object.entries(groups || {})) {
    const boxIds = Array.isArray(g?.boxIds) ? [...new Set(g.boxIds.filter(Boolean))] : []
    if (boxIds.length < 2) continue
    clean[id] = { name: g.name ? String(g.name) : undefined, boxIds }
  }
  if (Object.keys(clean).length) next[LAYOUT_GROUPS_KEY] = clean
  else delete next[LAYOUT_GROUPS_KEY]
  return next
}

export function isLayoutMetaKey(key) {
  return key === LAYOUT_GROUPS_KEY
}

function generateGroupId(groups) {
  let n = 1
  while (groups[`组${n}`]) n += 1
  return `组${n}`
}

/** @param {Record<string, LayoutGroup>} groups @param {string[]} boxIds */
function removeBoxesFromGroups(groups, boxIds) {
  const remove = new Set(boxIds)
  /** @type {Record<string, LayoutGroup>} */
  const next = {}
  for (const [id, g] of Object.entries(groups)) {
    const boxIdsLeft = g.boxIds.filter((b) => !remove.has(b))
    if (boxIdsLeft.length >= 2) {
      next[id] = { ...g, boxIds: boxIdsLeft }
    }
  }
  return next
}

/** @param {object} layoutOverrides @param {string} boxId @returns {string | null} */
export function findGroupIdForBox(layoutOverrides, boxId) {
  const groups = getLayoutGroups(layoutOverrides)
  for (const [id, g] of Object.entries(groups)) {
    if (g.boxIds.includes(boxId)) return id
  }
  return null
}

/** @param {object} layoutOverrides @param {string} boxId @returns {string[]} */
export function getGroupMembers(layoutOverrides, boxId) {
  const groups = getLayoutGroups(layoutOverrides)
  for (const g of Object.values(groups)) {
    if (g.boxIds.includes(boxId)) return [...g.boxIds]
  }
  return [boxId]
}

/** @param {object} layoutOverrides @param {string[]} boxIds @returns {string[]} */
export function expandBoxSelection(layoutOverrides, boxIds) {
  const expanded = new Set()
  for (const id of boxIds) {
    for (const m of getGroupMembers(layoutOverrides, id)) expanded.add(m)
  }
  return [...expanded]
}

/** @param {object} layoutOverrides @param {string[]} boxIds @param {string} [name] */
export function createLayoutGroup(layoutOverrides, boxIds, name) {
  const unique = [...new Set(boxIds.filter(Boolean))]
  if (unique.length < 2) return layoutOverrides
  let groups = getLayoutGroups(layoutOverrides)
  groups = removeBoxesFromGroups(groups, unique)
  const groupId = generateGroupId(groups)
  groups[groupId] = { name: name || groupId, boxIds: unique }
  return withLayoutGroups(layoutOverrides, groups)
}

/** @param {object} layoutOverrides @param {string[]} boxIds */
export function ungroupBoxes(layoutOverrides, boxIds) {
  const groups = removeBoxesFromGroups(getLayoutGroups(layoutOverrides), boxIds)
  return withLayoutGroups(layoutOverrides, groups)
}

/** @param {object} layoutOverrides @param {string} oldId @param {string} newId */
export function renameBoxInLayoutGroups(layoutOverrides, oldId, newId) {
  if (!oldId || !newId || oldId === newId) return layoutOverrides
  const groups = getLayoutGroups(layoutOverrides)
  let changed = false
  /** @type {Record<string, LayoutGroup>} */
  const next = {}
  for (const [id, g] of Object.entries(groups)) {
    if (!g.boxIds.includes(oldId)) {
      next[id] = g
      continue
    }
    changed = true
    const boxIds = [...new Set(g.boxIds.map((b) => (b === oldId ? newId : b)))]
    if (boxIds.length >= 2) next[id] = { ...g, boxIds }
  }
  return changed ? withLayoutGroups(layoutOverrides, next) : layoutOverrides
}

/** @param {object} layoutOverrides @param {string} boxId */
export function removeBoxFromLayoutGroups(layoutOverrides, boxId) {
  return ungroupBoxes(layoutOverrides, [boxId])
}

/** @param {object} layoutOverrides @param {string[]} selectedCols */
export function findMatchingGroupLabel(layoutOverrides, selectedCols) {
  const sel = new Set(selectedCols)
  if (sel.size < 2) return null
  for (const g of Object.values(getLayoutGroups(layoutOverrides))) {
    if (g.boxIds.length >= 2
      && g.boxIds.length === sel.size
      && g.boxIds.every((m) => sel.has(m))) {
      return g.name || '编组'
    }
  }
  return null
}

/** @param {object} layoutOverrides @param {string[]} selectedCols */
export function selectionHasGroupedBoxes(layoutOverrides, selectedCols) {
  return selectedCols.some((id) => findGroupIdForBox(layoutOverrides, id) != null)
}
