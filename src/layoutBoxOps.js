import {
  getColumnLayout,
  applyColumnBoxBounds,
  layoutHasBox,
  clampLayoutBoxBounds,
  MIN_LAYOUT_BOX_WIDTH,
  MIN_LAYOUT_BOX_HEIGHT,
  TEMPLATE_VIEWBOX,
} from './svgEngine.js'

const round = (n) => Math.round(n * 100) / 100

/** @typedef {{ getLayout?: (column: string, overrides: object) => object, applyBounds?: (overrides: object, column: string, bounds: object, edge?: string) => object }} LayoutBoxBridge */

const defaultBridge = {
  getLayout: getColumnLayout,
  applyBounds: (overrides, column, bounds, edge) => applyColumnBoxBounds(overrides, column, bounds, edge),
}

function resolveBridge(bridge) {
  return bridge ? { ...defaultBridge, ...bridge } : defaultBridge
}

/** 多选编辑框的外接矩形 */
export function getSelectionUnionBounds(columns, overrides, bridge) {
  const { getLayout } = resolveBridge(bridge)
  const rects = columns.map((c) => getBoxRect(c, overrides, getLayout)).filter(Boolean)
  if (rects.length === 0) return null
  return {
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  }
}

/** 将选中列中过小的编辑框扩到最小尺寸（便于多选整体缩放） */
export function ensureSelectionMinBoxSizes(overrides, columns, bridge) {
  const { getLayout, applyBounds } = resolveBridge(bridge)
  let next = { ...overrides }
  for (const col of columns) {
    const layout = getLayout(col, next)
    if (!layoutHasBox(layout)) continue
    const clamped = clampLayoutBoxBounds({
      boxLeft: layout.boxLeft,
      boxRight: layout.boxRight,
      boxTop: layout.boxTop,
      boxBottom: layout.boxBottom,
    })
    if (
      clamped.boxLeft !== layout.boxLeft
      || clamped.boxRight !== layout.boxRight
      || clamped.boxTop !== layout.boxTop
      || clamped.boxBottom !== layout.boxBottom
    ) {
      next = applyBounds(next, col, clamped)
    }
  }
  return next
}

/** 从拖拽起点整体平移（不触发族谱组联动） */
export function moveBoxesFromSnapshot(overrides, columns, startLayouts, dx, dy, bridge) {
  const { applyBounds } = resolveBridge(bridge)
  let next = { ...overrides }
  for (const col of columns) {
    const s = startLayouts[col]
    if (!s) continue
    next = applyBounds(next, col, {
      boxLeft: round(s.boxLeft + dx),
      boxRight: round(s.boxRight + dx),
      boxTop: round(s.boxTop + dy),
      boxBottom: round(s.boxBottom + dy),
    })
  }
  return next
}

function clampGroupBounds(bounds, edge) {
  let { left, right, top, bottom } = bounds
  if (right - left < MIN_LAYOUT_BOX_WIDTH) {
    if (edge === 'w' || edge === 'nw' || edge === 'sw') left = right - MIN_LAYOUT_BOX_WIDTH
    else right = left + MIN_LAYOUT_BOX_WIDTH
  }
  if (bottom - top < MIN_LAYOUT_BOX_HEIGHT) {
    if (edge === 'n' || edge === 'nw' || edge === 'ne') top = bottom - MIN_LAYOUT_BOX_HEIGHT
    else bottom = top + MIN_LAYOUT_BOX_HEIGHT
  }
  return { left: round(left), right: round(right), top: round(top), bottom: round(bottom) }
}

/** 按外接矩形等比缩放多选框，每个子框不小于最小尺寸 */
export function resizeBoxesInGroup(overrides, columns, startGroup, newGroup, startLayouts, bridge) {
  const { applyBounds } = resolveBridge(bridge)
  const gW0 = startGroup.right - startGroup.left
  const gH0 = startGroup.bottom - startGroup.top
  const gW = gW0 > 1e-6 ? gW0 : MIN_LAYOUT_BOX_WIDTH
  const gH = gH0 > 1e-6 ? gH0 : MIN_LAYOUT_BOX_HEIGHT
  const nW = Math.max(newGroup.right - newGroup.left, MIN_LAYOUT_BOX_WIDTH)
  const nH = Math.max(newGroup.bottom - newGroup.top, MIN_LAYOUT_BOX_HEIGHT)

  let next = { ...overrides }
  for (const col of columns) {
    const s = startLayouts[col]
    if (!s) continue
    const relL = (s.boxLeft - startGroup.left) / gW
    const relT = (s.boxTop - startGroup.top) / gH
    const relR = (s.boxRight - startGroup.left) / gW
    const relB = (s.boxBottom - startGroup.top) / gH
    next = applyBounds(next, col, {
      boxLeft: round(newGroup.left + relL * nW),
      boxRight: round(newGroup.left + relR * nW),
      boxTop: round(newGroup.top + relT * nH),
      boxBottom: round(newGroup.top + relB * nH),
    })
  }
  return next
}

export function computeResizedGroupBounds(startGroup, edge, dx, dy, options = {}) {
  let left = startGroup.left
  let right = startGroup.right
  let top = startGroup.top
  let bottom = startGroup.bottom
  if (edge === 'w' || edge === 'nw' || edge === 'sw') left += dx
  if (edge === 'e' || edge === 'ne' || edge === 'se') right += dx
  if (edge === 'n' || edge === 'nw' || edge === 'ne') top += dy
  if (edge === 's' || edge === 'sw' || edge === 'se') bottom += dy

  if (options.fromCenter) {
    if (edge === 'w' || edge === 'nw' || edge === 'sw') right -= dx
    if (edge === 'e' || edge === 'ne' || edge === 'se') left -= dx
    if (edge === 'n' || edge === 'nw' || edge === 'ne') bottom -= dy
    if (edge === 's' || edge === 'sw' || edge === 'se') top -= dy
    const clamped = clampLayoutBoxBounds({
      boxLeft: left,
      boxRight: right,
      boxTop: top,
      boxBottom: bottom,
    })
    return {
      left: clamped.boxLeft,
      right: clamped.boxRight,
      top: clamped.boxTop,
      bottom: clamped.boxBottom,
    }
  }

  return clampGroupBounds({ left, right, top, bottom }, edge)
}

function getBoxRect(column, overrides, getLayout = getColumnLayout) {
  const layout = getLayout(column, overrides)
  if (!layoutHasBox(layout)) return null
  const { boxLeft: left, boxRight: right, boxTop: top, boxBottom: bottom } = layout
  return {
    column,
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

function shiftBoxRect(rect, dx, dy) {
  return {
    ...rect,
    left: rect.left + dx,
    right: rect.right + dx,
    top: rect.top + dy,
    bottom: rect.bottom + dy,
    centerX: rect.centerX + dx,
    centerY: rect.centerY + dy,
  }
}

function rectToBounds(rect) {
  return clampLayoutBoxBounds({
    boxLeft: round(rect.left),
    boxRight: round(rect.right),
    boxTop: round(rect.top),
    boxBottom: round(rect.bottom),
  })
}

function applyRects(overrides, rects, bridge) {
  const { applyBounds } = resolveBridge(bridge)
  let next = { ...overrides }
  for (const rect of rects) {
    next = applyBounds(next, rect.column, rectToBounds(rect))
  }
  return next
}

/**
 * 多选编辑框对齐（移动框，不改变框尺寸；以 anchorColumn 为基准不动）
 * @param {'left'|'center-h'|'right'|'top'|'center-v'|'bottom'} mode
 * @param {string} [anchorColumn] 基准框（默认 columns 最后一项）
 */
export function alignLayoutBoxes(overrides, columns, mode, anchorColumn, bridge) {
  if (columns.length < 2) return overrides
  const { getLayout } = resolveBridge(bridge)
  const anchor = anchorColumn && columns.includes(anchorColumn)
    ? anchorColumn
    : columns[columns.length - 1]
  const anchorRect = getBoxRect(anchor, overrides, getLayout)
  if (!anchorRect) return overrides

  const nextRects = columns.map((col) => {
    const rect = getBoxRect(col, overrides, getLayout)
    if (!rect) return null
    if (col === anchor) return rect
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = anchorRect.left - rect.left
    else if (mode === 'right') dx = anchorRect.right - rect.right
    else if (mode === 'center-h') dx = anchorRect.centerX - rect.centerX
    else if (mode === 'top') dy = anchorRect.top - rect.top
    else if (mode === 'bottom') dy = anchorRect.bottom - rect.bottom
    else if (mode === 'center-v') dy = anchorRect.centerY - rect.centerY
    return shiftBoxRect(rect, dx, dy)
  }).filter(Boolean)

  return applyRects(overrides, nextRects, bridge)
}

/** SVG 画板外接矩形（用户坐标系，与 TEMPLATE_VIEWBOX 一致） */
export function getArtboardRect() {
  const { width, height } = TEMPLATE_VIEWBOX
  return {
    left: 0,
    right: width,
    top: 0,
    bottom: height,
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
  }
}

/**
 * 将编辑框相对 SVG 画板对齐（单选时使用）
 * @param {'left'|'center-h'|'right'|'top'|'center-v'|'bottom'} mode
 */
export function alignLayoutBoxesToArtboard(overrides, columns, mode, bridge) {
  const { getLayout } = resolveBridge(bridge)
  const artboard = getArtboardRect()
  const nextRects = columns.map((col) => {
    const rect = getBoxRect(col, overrides, getLayout)
    if (!rect) return null
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = artboard.left - rect.left
    else if (mode === 'right') dx = artboard.right - rect.right
    else if (mode === 'center-h') dx = artboard.centerX - rect.centerX
    else if (mode === 'top') dy = artboard.top - rect.top
    else if (mode === 'bottom') dy = artboard.bottom - rect.bottom
    else if (mode === 'center-v') dy = artboard.centerY - rect.centerY
    return shiftBoxRect(rect, dx, dy)
  }).filter(Boolean)
  return applyRects(overrides, nextRects, bridge)
}

/**
 * 多选编辑框等距分布（至少 3 个）
 * @param {'horizontal'|'vertical'} axis
 */
export function distributeLayoutBoxes(overrides, columns, axis, bridge) {
  const { getLayout } = resolveBridge(bridge)
  const rects = columns.map((c) => getBoxRect(c, overrides, getLayout)).filter(Boolean)
  if (rects.length < 3) return overrides

  const sorted = [...rects].sort((a, b) => (
    axis === 'horizontal' ? a.left - b.left : a.top - b.top
  ))

  if (axis === 'horizontal') {
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const totalSpan = last.right - first.left
    const totalWidth = sorted.reduce((s, r) => s + r.width, 0)
    const gap = (totalSpan - totalWidth) / (sorted.length - 1)
    let cursor = first.left
    const placed = sorted.map((rect) => {
      const next = {
        ...rect,
        left: cursor,
        right: cursor + rect.width,
        centerX: cursor + rect.width / 2,
      }
      cursor += rect.width + gap
      return next
    })
    return applyRects(overrides, placed, bridge)
  }

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const totalSpan = last.bottom - first.top
  const totalHeight = sorted.reduce((s, r) => s + r.height, 0)
  const gap = (totalSpan - totalHeight) / (sorted.length - 1)
  let cursor = first.top
  const placed = sorted.map((rect) => {
    const next = {
      ...rect,
      top: cursor,
      bottom: cursor + rect.height,
      centerY: cursor + rect.height / 2,
    }
    cursor += rect.height + gap
    return next
  })
  return applyRects(overrides, placed, bridge)
}

export const BOX_ALIGN_MODES = [
  { id: 'left', label: '左' },
  { id: 'center-h', label: '中' },
  { id: 'right', label: '右' },
  { id: 'top', label: '上' },
  { id: 'center-v', label: '中' },
  { id: 'bottom', label: '下' },
]

export const BOX_DISTRIBUTE_MODES = [
  { id: 'horizontal', label: '水平' },
  { id: 'vertical', label: '垂直' },
]
