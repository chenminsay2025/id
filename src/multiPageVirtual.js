/**
 * 多页预览虚拟布局：用数学计算页位，避免为每页创建 DOM 节点。
 */

/** @typedef {{ pageW: number, pageH: number, index: number }} MultiPageCellMeta */
/** @typedef {{ left: number, top: number, pageW: number, pageH: number }} MultiPageCellOffset */
/** @typedef {{ mode: 'multi-h' | 'multi-v', gap: number, count: number, offsets: MultiPageCellOffset[], cells: MultiPageCellMeta[] }} MultiPageLayoutMeta */

/**
 * @param {MultiPageCellMeta[]} cellsMeta
 * @param {number} gap
 * @param {'multi-h' | 'multi-v'} mode
 * @returns {MultiPageLayoutMeta}
 */
export function buildMultiPageLayoutMeta(cellsMeta, gap, mode) {
  /** @type {MultiPageCellOffset[]} */
  const offsets = []
  if (mode === 'multi-h') {
    let left = 0
    for (let i = 0; i < cellsMeta.length; i += 1) {
      const c = cellsMeta[i]
      offsets.push({ left, top: 0, pageW: c.pageW, pageH: c.pageH })
      left += c.pageW + gap
    }
  } else {
    let top = 0
    for (let i = 0; i < cellsMeta.length; i += 1) {
      const c = cellsMeta[i]
      offsets.push({ left: 0, top, pageW: c.pageW, pageH: c.pageH })
      top += c.pageH + gap
    }
  }
  return { mode, gap, count: cellsMeta.length, offsets, cells: cellsMeta }
}

/**
 * @param {MultiPageLayoutMeta} layout
 * @param {number} pageIndex
 * @param {number} scale
 */
export function getMultiPageCellRect(layout, pageIndex, scale) {
  const o = layout.offsets[pageIndex]
  if (!o) return null
  return {
    left: o.left * scale,
    top: o.top * scale,
    width: o.pageW * scale,
    height: o.pageH * scale,
  }
}

/**
 * @param {MultiPageLayoutMeta} layout
 * @param {number} scale
 * @param {number} panX
 * @param {number} panY
 * @param {number} vw
 * @param {number} vh
 * @returns {number[]}
 */
export function getVisiblePageIndicesFromLayout(layout, scale, panX, panY, vw, vh) {
  const viewLeft = -panX
  const viewTop = -panY
  const viewRight = viewLeft + vw
  const viewBottom = viewTop + vh
  /** @type {number[]} */
  const indices = []

  for (let i = 0; i < layout.count; i += 1) {
    const o = layout.offsets[i]
    const left = o.left * scale
    const top = o.top * scale
    const right = left + o.pageW * scale
    const bottom = top + o.pageH * scale
    const overlapW = Math.max(0, Math.min(right, viewRight) - Math.max(left, viewLeft))
    const overlapH = Math.max(0, Math.min(bottom, viewBottom) - Math.max(top, viewTop))
    if (overlapW > 0 && overlapH > 0) indices.push(i)
  }
  return indices
}

/**
 * @param {MultiPageLayoutMeta} layout
 * @param {number} scale
 * @param {number} panX
 * @param {number} panY
 * @param {number} vw
 * @param {number} vh
 * @returns {number | null}
 */
export function getVisiblePageIndexFromLayout(layout, scale, panX, panY, vw, vh) {
  const viewLeft = -panX
  const viewTop = -panY
  const viewRight = viewLeft + vw
  const viewBottom = viewTop + vh
  let bestIndex = null
  let bestVisible = -1

  for (let i = 0; i < layout.count; i += 1) {
    const o = layout.offsets[i]
    const left = o.left * scale
    const top = o.top * scale
    const right = left + o.pageW * scale
    const bottom = top + o.pageH * scale
    const overlapW = Math.max(0, Math.min(right, viewRight) - Math.max(left, viewLeft))
    const overlapH = Math.max(0, Math.min(bottom, viewBottom) - Math.max(top, viewTop))
    const visibleArea = overlapW * overlapH
    if (visibleArea > bestVisible) {
      bestVisible = visibleArea
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * @param {number[]} indices
 * @param {number} count
 * @param {number} buffer
 */
export function expandPageIndicesWithBuffer(indices, count, buffer) {
  if (!indices.length) return []
  let min = indices[0]
  let max = indices[0]
  for (const i of indices) {
    if (i < min) min = i
    if (i > max) max = i
  }
  min = Math.max(0, min - buffer)
  max = Math.min(count - 1, max + buffer)
  /** @type {number[]} */
  const out = []
  for (let i = min; i <= max; i += 1) out.push(i)
  return out
}
