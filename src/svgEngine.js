import {
  getFontBase64,
  applyFontFamilyToSvg,
  normalizeSvgStylesForExport,
  buildFontFaceCss,
  FONT_NAMES,
} from './fontLoader.js'
import { scopeSvgStyleClasses } from './svgStyleScope.js'
import { parseExcelFromBufferAsync } from './excelRowParse.js'
import { isImageCellValue, imageCellUrl } from './cellMedia.js'
import {
  getBindings,
  resolveBoxId,
  listLayoutBoxIds,
  getPrimaryColumnForBox,
  LAYOUT_BINDINGS_KEY,
} from './layoutBinding.js'
import {
  ensureCatalogFontFaces,
  getLayoutFontFamily,
  getMeasureFontFamily,
  injectFontsForLayouts,
  injectCatalogFonts,
} from './fontCatalog.js'
import {
  FIELD_MAP,
  COLUMN_TO_FIELD,
  FIELD_ID_TO_COLUMN,
  COLUMNS,
} from './fieldMap.js'
import { yieldToMain } from './asyncYield.js'
import {
  getTemplateBackground,
  applySvgPageDimensions,
  previewStageDimensionsForPage,
  cacheTemplateSourceDimensions,
  resolveTemplateSourceDimensions,
} from './templateBackground.js'

/** @param {(() => boolean) | undefined} shouldAbort */
function throwIfSvgGenerationAborted(shouldAbort) {
  if (typeof shouldAbort === 'function' && shouldAbort()) {
    const err = new Error('SVG generation aborted')
    err.name = 'AbortError'
    throw err
  }
}

export { FIELD_MAP, COLUMN_TO_FIELD, FIELD_ID_TO_COLUMN, COLUMNS }

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 模板参考层 `<g id="_参考层">`（导出与公开预览不包含） */
export const REFERENCE_LAYER_ID = '_参考层'

/** @deprecated 请使用 REFERENCE_LAYER_ID；旧版误用 g.st9（实为 path 的 class） */
export const REFERENCE_LAYER_SELECTOR = `#${REFERENCE_LAYER_ID}`

/** 模板底图 `<g id="_模板底图">`（关闭后仅保留填充文字，便于校对） */
export const TEMPLATE_LAYER_ID = '_模板底图'

/** 旧版 SVG 模板底图 id */
export const LEGACY_TEMPLATE_LAYER_ID = '_图层_11'

/** @deprecated 请使用 TEMPLATE_LAYER_ID */
export const TEMPLATE_DECOR_LAYER_IDS = [TEMPLATE_LAYER_ID, LEGACY_TEMPLATE_LAYER_ID]

/** 无 field-* id 时，按标签文字匹配；猫舍在模板顶部有装饰性标签，只填 y>180 的数据位 */
const LABEL_FILTERS = {
  猫舍: { minY: 180 },
}

const RIGHT_ALIGN_FIELD_IDS = new Set([
  'field-fA1', 'field-fA2', 'field-fB1', 'field-fB2',
  'field-fC1', 'field-fC2', 'field-fD1', 'field-fD2',
])

const CENTER_ALIGN_FIELD_IDS = new Set([
  'field-fAB', 'field-fA', 'field-fB', 'field-fCD', 'field-fC', 'field-fD',
  'field-mAB', 'field-mA', 'field-mB', 'field-mCD', 'field-mC', 'field-mD',
])

const TEMPLATE_VIEWBOX_W = 841.89
const TEMPLATE_PAGE_W_MM = 297
const SIRE_LEFT_POLYLINE_X = 133.6
const DAM_RIGHT_POLYLINE_X = 708.59
const RIGHT_ALIGN_GAP_MM = 2
const SIRE_LEFT_TEXT_SCALE_X = 0.91
const CENTER_EXTRA_SHIFT_MM = 5
const PEDIGREE_LINE_HEIGHT = 8
const INTRO_LINE_HEIGHT = 20.2
const ST4_FONT_SIZE = 7.29
const ST5_FONT_SIZE = 7.29
const ST6_FONT_SIZE = 9.87
const PEDIGREE_WRAP_PADDING = 2

/** 族谱居中列格子水平范围（SVG1 竖线 / 折线坐标） */
export const SIRE_CENTER_BOX = { boxLeft: 156.25, boxRight: 223.5 }
/** 父系中间列：246.15–313.4（313.4–324.1 为折线边，324.1–357.28 为外侧格，与母系 518 段对称） */
export const SIRE_MID_BOX = { boxLeft: 246.15, boxRight: 313.4 }
/** 母系居中列：内容区在 618.69–685.94（左侧 607.99–618.69 为折线边，与父系 223.5 对称） */
export const DAM_CENTER_BOX = { boxLeft: 618.69, boxRight: 685.94 }
/** 母系中间列：518.09–596.04（484.91–518.09 为外侧格，与父系 324–357 段对称） */
export const DAM_MID_BOX = { boxLeft: 518.09, boxRight: 596.04 }

export const TEMPLATE_VIEWBOX = { width: TEMPLATE_VIEWBOX_W, height: 595.28 }

/** 族谱换行列：同组共享左右边界，各行独立上下边界 */
export const PEDIGREE_WRAP_GROUPS = {
  sireCenter: { columns: ['父A', '父B', '父C', '父D'] },
  sireMid: { columns: ['父AB', '父CD'] },
  damCenter: { columns: ['母A', '母B', '母C', '母D'] },
  damMid: { columns: ['母AB', '母CD'] },
}

export const PEDIGREE_WRAP_COLUMNS = [
  '父AB', '父A', '父B', '父CD', '父C', '父D',
  '母AB', '母A', '母B', '母CD', '母C', '母D',
]

/** 可在预览中编辑编辑框的全部列 */
export const LAYOUT_EDIT_COLUMNS = [...COLUMNS]

const SIRE_SIDE_BOX = { boxLeft: 110, boxRight: SIRE_LEFT_POLYLINE_X }
const DAM_SIDE_BOX = { boxLeft: DAM_RIGHT_POLYLINE_X, boxRight: 708.59 }
const HEADER_INFO_BOX = { boxLeft: 600, boxRight: 748 }

export function getGroupIdForColumn(column) {
  for (const [id, group] of Object.entries(PEDIGREE_WRAP_GROUPS)) {
    if (group.columns.includes(column)) return id
  }
  return null
}

export function getColumnLayout(column, layoutOverrides = {}) {
  const boxId = resolveBoxId(column, layoutOverrides)
  const boxOverride =
    layoutOverrides[boxId] && typeof layoutOverrides[boxId] === 'object'
      ? layoutOverrides[boxId]
      : {}
  const columnOverride =
    boxId !== column && layoutOverrides[column] && typeof layoutOverrides[column] === 'object'
      ? layoutOverrides[column]
      : {}
  const override = { ...columnOverride, ...boxOverride }
  const tableTemplateScope = layoutOverrides.__tableTemplateScope === true
  const scopeTableCols = layoutOverrides.__tableTemplateColumns
  const tableColSet = Array.isArray(scopeTableCols) ? new Set(scopeTableCols) : null
  const bindings = getBindings(layoutOverrides)
  const isBindingTarget = Object.values(bindings).includes(column) || Object.values(bindings).includes(boxId)
  const isScopedCustomBox = tableTemplateScope && tableColSet
    && !tableColSet.has(column)
    && !tableColSet.has(boxId)
    && !isBindingTarget
  const base = isScopedCustomBox ? {} : (COLUMN_LAYOUT[column] || {})

  if (tableTemplateScope || !COLUMN_LAYOUT[column]) {
    const merged = { lineHeight: PEDIGREE_LINE_HEIGHT, ...base, ...override }
    if (layoutHasBox(merged) || Object.keys(override).length > 0) {
      return merged
    }
    return isScopedCustomBox
      ? { lineHeight: PEDIGREE_LINE_HEIGHT, ...override }
      : { lineHeight: PEDIGREE_LINE_HEIGHT, ...base }
  }
  return { ...base, ...override }
}

export function hasBuiltinColumnLayout(column) {
  return !!COLUMN_LAYOUT[column]
}

/** 是否为血统证书默认表格（含介绍/父名/母名等列） */
export function isPedigreeStyleTable(columns = []) {
  const set = new Set(columns)
  return set.has('介绍') || set.has('父名') || set.has('母名')
}

export { LAYOUT_BINDINGS_KEY, resolveBoxId, listLayoutBoxIds, getBindings } from './layoutBinding.js'

export function applyHorizontalToWrapGroup(overrides, groupId, boxLeft, boxRight) {
  const group = PEDIGREE_WRAP_GROUPS[groupId]
  if (!group) return overrides
  const next = { ...overrides }
  for (const column of group.columns) {
    next[column] = { ...next[column], boxLeft, boxRight }
  }
  return next
}

/** 编辑框最小宽/高（SVG 用户单位） */
export const MIN_LAYOUT_BOX_WIDTH = 10
export const MIN_LAYOUT_BOX_HEIGHT = 10

const roundLayoutBox = (n) => Math.round(n * 100) / 100

/**
 * 限制编辑框不小于最小尺寸。
 * @param {{ boxLeft?: number, boxRight?: number, boxTop?: number, boxBottom?: number }} bounds
 * @param {'n'|'s'|'e'|'w'} [edge] 拖拽边；省略时从中心扩张
 */
export function clampLayoutBoxBounds(bounds, edge) {
  let { boxLeft, boxRight, boxTop, boxBottom } = bounds
  if (boxLeft == null || boxRight == null || boxTop == null || boxBottom == null) {
    return bounds
  }

  if (boxRight - boxLeft < MIN_LAYOUT_BOX_WIDTH) {
    if (edge === 'w' || edge === 'nw' || edge === 'sw') boxLeft = boxRight - MIN_LAYOUT_BOX_WIDTH
    else if (edge === 'e' || edge === 'ne' || edge === 'se') boxRight = boxLeft + MIN_LAYOUT_BOX_WIDTH
    else {
      const cx = (boxLeft + boxRight) / 2
      boxLeft = cx - MIN_LAYOUT_BOX_WIDTH / 2
      boxRight = cx + MIN_LAYOUT_BOX_WIDTH / 2
    }
  }

  if (boxBottom - boxTop < MIN_LAYOUT_BOX_HEIGHT) {
    if (edge === 'n' || edge === 'nw' || edge === 'ne') boxTop = boxBottom - MIN_LAYOUT_BOX_HEIGHT
    else if (edge === 's' || edge === 'sw' || edge === 'se') boxBottom = boxTop + MIN_LAYOUT_BOX_HEIGHT
    else {
      const cy = (boxTop + boxBottom) / 2
      boxTop = cy - MIN_LAYOUT_BOX_HEIGHT / 2
      boxBottom = cy + MIN_LAYOUT_BOX_HEIGHT / 2
    }
  }

  return {
    ...bounds,
    boxLeft: roundLayoutBox(boxLeft),
    boxRight: roundLayoutBox(boxRight),
    boxTop: roundLayoutBox(boxTop),
    boxBottom: roundLayoutBox(boxBottom),
  }
}

/** 单列编辑框边界（介绍、父名、编号等非族谱组列） */
export function applyColumnBoxBounds(overrides, column, bounds, edge) {
  const next = { ...overrides }
  const targetId = resolveBoxId(column, next)
  const clamped = clampLayoutBoxBounds(bounds, edge)
  next[targetId] = { ...next[targetId], ...clamped }
  if (targetId !== column && next[column] && typeof next[column] === 'object') {
    const alias = { ...next[column] }
    delete alias.boxLeft
    delete alias.boxRight
    delete alias.boxTop
    delete alias.boxBottom
    if (Object.keys(alias).length === 0) delete next[column]
    else next[column] = alias
  }
  return next
}

/** 编辑框内容水平对齐 */
export const CONTENT_ALIGN_H = ['label', 'left', 'center', 'right']
/** 编辑框内容垂直对齐 */
export const CONTENT_ALIGN_V = ['label', 'top', 'center', 'bottom']

export const CONTENT_ALIGN_H_LABELS = {
  label: '标签',
  left: '左',
  center: '中',
  right: '右',
}

export const CONTENT_ALIGN_V_LABELS = {
  label: '标签',
  top: '顶',
  center: '中',
  bottom: '底',
}

/** 单行超出框宽时：换行 或 水平压窄 */
export const TEXT_FIT_MODES = ['wrap', 'shrink']
export const TEXT_FIT_MODE_LABELS = {
  wrap: '换行',
  shrink: '压窄',
}

/** 无 Canvas 时的回退比例（CJK 通常 ascender 偏高） */
const FALLBACK_ASCENT_RATIO = 0.88
const FALLBACK_DESCENT_RATIO = 0.12

/** @type {Map<string, { ascent: number, descent: number }>} */
const fontExtentsCache = new Map()

export function getTextFitMode(layout) {
  const v = layout.textFitMode
  return TEXT_FIT_MODES.includes(v) ? v : 'wrap'
}

export function getTemplateTextScaleX(layout) {
  if (layout.align === 'right' && layout.boxRight != null && layout.boxRight <= SIRE_LEFT_POLYLINE_X + 0.5) {
    return SIRE_LEFT_TEXT_SCALE_X
  }
  return 1
}

/** 字符水平缩放百分比（100 为默认；与模板 scaleX 相乘，换行仍生效） */
export const TEXT_SCALE_X_PERCENT_MIN = 25
export const TEXT_SCALE_X_PERCENT_MAX = 300

export function getTextScaleXPercent(layout) {
  const raw = Number(layout?.textScaleXPercent)
  if (!raw || Number.isNaN(raw)) return 100
  return Math.min(TEXT_SCALE_X_PERCENT_MAX, Math.max(TEXT_SCALE_X_PERCENT_MIN, raw))
}

export function getDefaultTextScaleXPercentForColumn(_column) {
  return 100
}

/** 模板 scaleX × 用户字宽百分比 */
export function getLayoutTextScaleX(layout) {
  return getTemplateTextScaleX(layout) * (getTextScaleXPercent(layout) / 100)
}

export function getContentAlignH(layout) {
  const v = layout.contentAlignH || layout.horizontalAnchor
  return CONTENT_ALIGN_H.includes(v) ? v : 'label'
}

export function getContentAlignV(layout) {
  if (layout.contentAlignV && CONTENT_ALIGN_V.includes(layout.contentAlignV)) {
    return layout.contentAlignV
  }
  if (layout.verticalAnchor && CONTENT_ALIGN_V.includes(layout.verticalAnchor)) {
    return layout.verticalAnchor
  }
  return 'label'
}

/** 拖拽移动编辑框：水平同组联动，垂直仅当前列 */
export function moveWrapBox(overrides, column, dx, dy) {
  const round = (n) => Math.round(n * 100) / 100
  const layout = getColumnLayout(column, overrides)
  const groupId = getGroupIdForColumn(column)
  let next = { ...overrides }

  if (dx !== 0 && layout.boxLeft != null && layout.boxRight != null) {
    const boxLeft = round(layout.boxLeft + dx)
    const boxRight = round(layout.boxRight + dx)
    if (groupId) {
      next = applyHorizontalToWrapGroup(next, groupId, boxLeft, boxRight)
    } else {
      next[column] = { ...next[column], boxLeft, boxRight }
    }
  }

  if (dy !== 0 && layout.boxTop != null && layout.boxBottom != null) {
    next[column] = {
      ...next[column],
      boxTop: round(layout.boxTop + dy),
      boxBottom: round(layout.boxBottom + dy),
    }
  }

  return next
}

/** 批量移动多个编辑框 */
export function moveWrapBoxes(overrides, columns, dx, dy) {
  let next = { ...overrides }
  for (const column of columns) {
    next = moveWrapBox(next, column, dx, dy)
  }
  return next
}

/** 同组共享水平/垂直对齐（中间列左右共享，居中列各自独立） */
export function applyAlignToWrapGroup(overrides, groupId, patch) {
  const group = PEDIGREE_WRAP_GROUPS[groupId]
  if (!group) return overrides
  const next = { ...overrides }
  for (const column of group.columns) {
    next[column] = { ...next[column], ...patch }
  }
  return next
}

export const FONT_SCALE_MIN = 0.5
export const FONT_SCALE_MAX = 2

export function normalizeFontScale(scale) {
  let s = Number(scale)
  if (!s || Number.isNaN(s) || s <= 0) s = 1
  if (s < FONT_SCALE_MIN) s = FONT_SCALE_MIN
  if (s > FONT_SCALE_MAX) s = FONT_SCALE_MAX
  return s
}

/** 按倍率缩放模板内 CSS font-size（预览 / 导出 SVG / PDF 共用） */
export function applySvgFontScale(svgRoot, scale) {
  const s = normalizeFontScale(scale)
  if (s === 1) return
  for (const node of svgRoot.querySelectorAll('style')) {
    const txt = node.textContent || ''
    node.textContent = txt.replace(/font-size:\s*([\d.]+)\s*px/gi, (m, num) => {
      const v = parseFloat(num)
      if (Number.isNaN(v)) return m
      return `font-size: ${(v * s).toFixed(2)}px`
    })
  }
}

function mmToSvgUserX(mm) {
  return (mm * TEMPLATE_VIEWBOX_W) / TEMPLATE_PAGE_W_MM
}

const CENTER_SHIFT_U = mmToSvgUserX(CENTER_EXTRA_SHIFT_MM)
const SIRE_RIGHT_ANCHOR_ROOT_X = SIRE_LEFT_POLYLINE_X - mmToSvgUserX(RIGHT_ALIGN_GAP_MM)
const DAM_LEFT_ANCHOR_ROOT_X = DAM_RIGHT_POLYLINE_X + mmToSvgUserX(RIGHT_ALIGN_GAP_MM)
/** 证书右上「所有人 / 繁育人 / 猫舍」样例文字右缘（SVG1 路径约 x=748） */
const HEADER_INFO_RIGHT_ANCHOR_ROOT_X = 748

const CENTER_ALIGN_ANCHOR_X = {
  'field-fAB': 30.15 + CENTER_SHIFT_U,
  'field-fA': 30.15 + CENTER_SHIFT_U,
  'field-fB': 20.97 + CENTER_SHIFT_U,
  'field-fCD': 20.97 + CENTER_SHIFT_U,
  'field-fC': 20.97 + CENTER_SHIFT_U,
  'field-fD': 20.97 + CENTER_SHIFT_U,
  'field-mAB': 20.43 + CENTER_SHIFT_U,
  'field-mA': 20.43 + CENTER_SHIFT_U,
  'field-mB': 16.06 + CENTER_SHIFT_U,
  'field-mCD': 16.06 + CENTER_SHIFT_U,
  'field-mC': 16.06 + CENTER_SHIFT_U,
  'field-mD': 16.06 + CENTER_SHIFT_U,
}

/** SVG1 标签占位符：对齐方式、行距、格子垂直范围（用于居中） */
const COLUMN_LAYOUT = {
  介绍: {
    align: 'left',
    lineHeight: INTRO_LINE_HEIGHT,
    verticalAnchor: 'start',
    fontSize: ST5_FONT_SIZE,
    boxLeft: 77,
    boxRight: 520,
    boxTop: 90,
    boxBottom: 210,
  },
  编号: {
    align: 'center',
    fieldId: 'field-regno',
    fontSize: ST6_FONT_SIZE,
    boxLeft: 553,
    boxRight: 691,
    boxTop: 157.34,
    boxBottom: 168,
  },
  父名: {
    align: 'left',
    fontSize: ST4_FONT_SIZE,
    lineHeight: PEDIGREE_LINE_HEIGHT,
    boxLeft: 162,
    boxRight: 380,
    boxTop: 295.21,
    boxBottom: 330.04,
  },
  母名: {
    align: 'left',
    fontSize: ST4_FONT_SIZE,
    lineHeight: PEDIGREE_LINE_HEIGHT,
    boxLeft: 553,
    boxRight: 720,
    boxTop: 295.21,
    boxBottom: 330.04,
  },
  父AB: { align: 'center', fieldId: 'field-fAB', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_MID_BOX, boxTop: 395.99, boxBottom: 449.69 },
  父A: { align: 'center', fieldId: 'field-fA', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_CENTER_BOX, boxTop: 369.04, boxBottom: 422.94 },
  父B: { align: 'center', fieldId: 'field-fB', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_CENTER_BOX, boxTop: 422.94, boxBottom: 476.35 },
  父CD: { align: 'center', fieldId: 'field-fCD', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_MID_BOX, boxTop: 449.69, boxBottom: 503.63 },
  父C: { align: 'center', fieldId: 'field-fC', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_CENTER_BOX, boxTop: 476.35, boxBottom: 503.63 },
  父D: { align: 'center', fieldId: 'field-fD', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_CENTER_BOX, boxTop: 503.63, boxBottom: 544.13 },
  母AB: { align: 'center', fieldId: 'field-mAB', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_MID_BOX, boxTop: 395.87, boxBottom: 449.69 },
  母A: { align: 'center', fieldId: 'field-mA', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_CENTER_BOX, boxTop: 368.92, boxBottom: 422.82 },
  母B: { align: 'center', fieldId: 'field-mB', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_CENTER_BOX, boxTop: 422.82, boxBottom: 476.22 },
  母CD: { align: 'center', fieldId: 'field-mCD', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_MID_BOX, boxTop: 449.69, boxBottom: 503.5 },
  母C: { align: 'center', fieldId: 'field-mC', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_CENTER_BOX, boxTop: 476.22, boxBottom: 503.5 },
  母D: { align: 'center', fieldId: 'field-mD', horizontalAnchor: 'label', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_CENTER_BOX, boxTop: 503.5, boxBottom: 544 },
  '父A-1': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 355.74, boxBottom: 382.17 },
  '父A-2': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 382.17, boxBottom: 409.72 },
  '父B-1': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 409.72, boxBottom: 436.16 },
  '父B-2': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 436.16, boxBottom: 463.71 },
  '父C-1': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 463.71, boxBottom: 490.14 },
  '父C-2': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 490.14, boxBottom: 517.69 },
  '父D-1': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 517.69, boxBottom: 544.13 },
  '父D-2': { align: 'right', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...SIRE_SIDE_BOX, boxTop: 544.13, boxBottom: 570.57 },
  '母A-1': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 355.61, boxBottom: 382.05 },
  '母A-2': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 382.05, boxBottom: 409.6 },
  '母B-1': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 409.6, boxBottom: 436.03 },
  '母B-2': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 436.03, boxBottom: 463.58 },
  '母C-1': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 463.58, boxBottom: 490.02 },
  '母C-2': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 490.02, boxBottom: 517.57 },
  '母D-1': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 517.57, boxBottom: 544 },
  '母D-2': { align: 'left', fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...DAM_SIDE_BOX, boxTop: 544, boxBottom: 570.43 },
  所有人: { align: 'right', anchorRootX: HEADER_INFO_RIGHT_ANCHOR_ROOT_X, fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...HEADER_INFO_BOX, boxTop: 206, boxBottom: 222 },
  繁育人: { align: 'right', anchorRootX: HEADER_INFO_RIGHT_ANCHOR_ROOT_X, fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, ...HEADER_INFO_BOX, boxTop: 222, boxBottom: 238 },
  猫舍: { align: 'right', anchorRootX: HEADER_INFO_RIGHT_ANCHOR_ROOT_X, fontSize: ST4_FONT_SIZE, lineHeight: PEDIGREE_LINE_HEIGHT, boxLeft: 680, boxRight: HEADER_INFO_RIGHT_ANCHOR_ROOT_X, boxTop: 236, boxBottom: 254 },
}

/** 介绍列：按行拆分单元格原文 */
export function buildIntroLines(introCell) {
  const lines = String(introCell || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines
}

function buildFourLineBlock(cell) {
  const lines = String(cell || '').split(/\r?\n/).map((l) => l.trim())
  while (lines.length < 4) lines.push('')
  return lines.slice(0, 4)
}

/** 自定义编辑框等：按回车拆成多行写入 SVG */
function splitCellTextToLines(value) {
  const s = String(value ?? '')
  if (!s) return []
  return s.split(/\r?\n/)
}

export function buildLinesForKey(key, value) {
  if (key === '介绍') return buildIntroLines(value)
  const spec = FIELD_MAP[key]
  if (!spec) {
    return splitCellTextToLines(value)
  }
  if (spec.n === 1) return [String(value || '')]
  if (spec.n === 3) {
    const lines = String(value || '').split(/\r?\n/).map((l) => l.trim())
    while (lines.length < 3) lines.push('')
    return lines.slice(0, 3)
  }
  return buildFourLineBlock(value)
}

let measureCanvasCtx = null

function getMeasureCanvasCtx() {
  if (measureCanvasCtx) return measureCanvasCtx
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  measureCanvasCtx = canvas.getContext('2d')
  return measureCanvasCtx
}

/** @type {import('./fontCatalog.js').FontCatalog | null} */
let activeFontCatalog = null

export function setActiveFontCatalog(catalog) {
  activeFontCatalog = catalog
  fontExtentsCache.clear()
}

/**
 * 用当前字体实测升部/降部，避免固定 0.75/0.25 导致中文在框内偏上。
 * @param {number} fontSize
 * @param {object} [layout]
 */
function getFontExtents(fontSize, layout = {}, { tight = false } = {}) {
  const size = Number(fontSize) || ST4_FONT_SIZE
  const family = getMeasureFontFamily(layout, activeFontCatalog)
  const key = `${Math.round(size * 1000)}|${family}|${tight ? 't' : 'l'}`
  if (fontExtentsCache.has(key)) return fontExtentsCache.get(key)

  let ascent = size * FALLBACK_ASCENT_RATIO
  let descent = size * FALLBACK_DESCENT_RATIO
  const ctx = getMeasureCanvasCtx()
  if (ctx) {
    ctx.font = getMeasureFont(size, layout)
    const m = ctx.measureText('国Mgpy')
    if (m.actualBoundingBoxAscent > 0) ascent = m.actualBoundingBoxAscent
    if (m.actualBoundingBoxDescent > 0) descent = m.actualBoundingBoxDescent
    if (!tight && m.fontBoundingBoxAscent > 0 && m.fontBoundingBoxDescent > 0) {
      ascent = Math.max(ascent, m.fontBoundingBoxAscent * 0.92)
      descent = Math.max(descent, m.fontBoundingBoxDescent * 0.92)
    }
  }

  const metrics = { ascent, descent }
  fontExtentsCache.set(key, metrics)
  return metrics
}

function resolveVerticalAlignMode(layout) {
  const alignV = getContentAlignV(layout)
  if (alignV === 'top' || alignV === 'bottom') return alignV
  if (layout.verticalAnchor === 'start') return 'top'
  if (layout.verticalAnchor === 'end') return 'bottom'
  return alignV
}

function applyTextBaselines(textEl, alignV = 'label') {
  const useHanging = alignV === 'top' || alignV === 'bottom'
  const baseline = useHanging ? 'hanging' : 'alphabetic'
  const alignment = useHanging ? 'hanging' : 'baseline'
  textEl.setAttribute('dominant-baseline', baseline)
  textEl.setAttribute('alignment-baseline', alignment)
  for (const tspan of textEl.querySelectorAll('tspan')) {
    tspan.setAttribute('dominant-baseline', baseline)
    tspan.setAttribute('alignment-baseline', alignment)
  }
}

function getMeasureFont(fontSize, layout = {}) {
  return `500 ${fontSize}px ${getMeasureFontFamily(layout, activeFontCatalog)}`
}

function applyTextFontFamily(textEl, layout) {
  const family = getLayoutFontFamily(layout, activeFontCatalog)
  textEl.setAttribute('font-family', family)
  for (const tspan of textEl.querySelectorAll('tspan')) {
    tspan.setAttribute('font-family', family)
  }
}

function measureTextWidth(text, fontSize, layout = {}, fontScale = 1) {
  const ctx = getMeasureCanvasCtx()
  const sample = String(text || '')
  const letterExtra = extraWidthForLetterSpacing(sample, getEffectiveLetterSpacing(layout, fontScale))
  if (!ctx) {
    return sample.length * fontSize * 0.52 + letterExtra
  }
  ctx.font = getMeasureFont(fontSize, layout)
  return ctx.measureText(sample).width + letterExtra
}

export function layoutHasWrapBox(layout) {
  return layout.boxLeft != null && layout.boxRight != null
}

export function layoutHasBox(layout) {
  return (
    layout.boxLeft != null
    && layout.boxRight != null
    && layout.boxTop != null
    && layout.boxBottom != null
  )
}

/** 编辑框在 overrides 中被标记为隐藏（保留布局数据，不渲染 SVG 数据层文字） */
export function isLayoutBoxHidden(layout) {
  return !!(layout && layout.boxHidden)
}

export function isLayoutBoxActive(layout) {
  return layoutHasBox(layout) && !isLayoutBoxHidden(layout)
}

function layoutHasFixedWrap(layout) {
  return layoutHasWrapBox(layout)
}

export function getDefaultFontSizeForColumn(column) {
  const base = COLUMN_LAYOUT[column]
  if (base?.fontSize != null) return base.fontSize
  if (column === '介绍') return ST5_FONT_SIZE
  if (column === '编号') return ST6_FONT_SIZE
  return ST4_FONT_SIZE
}

export function getDefaultLineHeightForColumn(column) {
  const base = COLUMN_LAYOUT[column]
  if (base?.lineHeight != null) return base.lineHeight
  if (column === '介绍') return INTRO_LINE_HEIGHT
  const fs = base?.fontSize ?? ST4_FONT_SIZE
  return Math.round(Math.max(PEDIGREE_LINE_HEIGHT, fs * 1.12) * 100) / 100
}

/** 字间距（SVG letter-spacing，单位与字号一致；0 为默认） */
export function getEffectiveLetterSpacing(layout, fontScale = 1) {
  const raw = Number(layout?.letterSpacing)
  if (!raw || Number.isNaN(raw)) return 0
  return (raw * normalizeFontScale(fontScale))
}

export function getDefaultLetterSpacingForColumn(column) {
  const base = COLUMN_LAYOUT[column]
  if (base?.letterSpacing != null) return base.letterSpacing
  return 0
}

function extraWidthForLetterSpacing(text, letterSpacing) {
  if (!letterSpacing) return 0
  const n = [...String(text || '')].length
  return letterSpacing * Math.max(0, n - 1)
}

/** 行距（SVG tspan dy，用户单位；不设下限，由编辑者自行控制） */
export function getEffectiveLineGap(layout, fontScale = 1) {
  const raw = layout.lineHeight ?? PEDIGREE_LINE_HEIGHT
  if (raw == null || Number.isNaN(Number(raw))) return PEDIGREE_LINE_HEIGHT
  return raw
}

export function getEffectiveFontSize(layout, fontScale = 1) {
  const base = layout.fontSize ?? ST4_FONT_SIZE
  return base * normalizeFontScale(fontScale)
}

/** 编辑框内可用于文字的水平宽度（SVG 用户单位，略留边避免压窄后仍溢出） */
function getWrapContentMaxRootWidth(layout) {
  return layout.boxRight - layout.boxLeft - PEDIGREE_WRAP_PADDING * 2 - 1
}

function getWrapMaxMeasureWidth(layout, fontScale = 1) {
  const scaleX = getLayoutTextScaleX(layout)
  if (!scaleX) return getWrapContentMaxRootWidth(layout)
  return getWrapContentMaxRootWidth(layout) / scaleX
}

function splitLongToken(token, maxWidth, fontSize, layout = {}, fontScale = 1) {
  if (!token.includes('-')) {
    return breakTextByWidth(token, maxWidth, fontSize, layout, fontScale)
  }

  const parts = token.split(/(?=-)/)
  const lines = []
  let current = ''

  for (const part of parts) {
    const test = current + part
    if (!current || measureTextWidth(test, fontSize, layout, fontScale) <= maxWidth) {
      current = test
      continue
    }
    if (current) lines.push(current)
    if (measureTextWidth(part, fontSize, layout, fontScale) <= maxWidth) {
      current = part
    } else {
      const chunks = breakTextByWidth(part, maxWidth, fontSize, layout, fontScale)
      if (chunks.length > 1) {
        lines.push(...chunks.slice(0, -1))
        current = chunks[chunks.length - 1]
      } else {
        current = chunks[0] || part
      }
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : [token]
}

/** 无空格长串（含中文）按字宽折行 */
function breakTextByWidth(text, maxWidth, fontSize, layout = {}, fontScale = 1) {
  const s = String(text || '')
  if (!s) return ['']
  if (measureTextWidth(s, fontSize, layout, fontScale) <= maxWidth) return [s]
  const chars = [...s]
  const parts = []
  let current = ''
  for (const ch of chars) {
    const test = current + ch
    if (!current || measureTextWidth(test, fontSize, layout, fontScale) <= maxWidth) {
      current = test
    } else {
      parts.push(current)
      current = ch
    }
  }
  if (current) parts.push(current)
  return parts.length ? parts : [s]
}

/** 按固定宽度换行：英文整词不换断，过长编号可在连字符处折行 */
export function wrapTextLine(text, maxWidth, fontSize, layout = {}, fontScale = 1) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ['']
  if (measureTextWidth(trimmed, fontSize, layout, fontScale) <= maxWidth) return [trimmed]

  const words = trimmed.match(/\S+/g) || []
  const lines = []
  let current = ''

  const flush = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }

  for (const word of words) {
    const segments = measureTextWidth(word, fontSize, layout, fontScale) <= maxWidth
      ? [word]
      : splitLongToken(word, maxWidth, fontSize, layout, fontScale)

    for (const seg of segments) {
      const needsSpace = current && !current.endsWith('-') && !seg.startsWith('-')
      const test = current ? `${current}${needsSpace ? ' ' : ''}${seg}` : seg
      if (measureTextWidth(test, fontSize, layout, fontScale) <= maxWidth) {
        current = test
      } else {
        flush()
        if (measureTextWidth(seg, fontSize, layout, fontScale) <= maxWidth) {
          current = seg
        } else {
          lines.push(seg)
        }
      }
    }
  }

  flush()
  return lines.length ? lines : ['']
}

function wrapPedigreeLines(lineTexts, layout, fontScale = 1) {
  if (!layoutHasWrapBox(layout)) return lineTexts
  if (getTextFitMode(layout) === 'shrink') {
    return lineTexts.map((l) => String(l ?? ''))
  }
  const fontSize = getEffectiveFontSize(layout, fontScale)
  const maxWidth = getWrapMaxMeasureWidth(layout, fontScale)
  const wrapped = []
  for (const line of lineTexts) {
    wrapped.push(...wrapTextLine(line, maxWidth, fontSize, layout, fontScale))
  }
  while (wrapped.length > 1 && !String(wrapped[wrapped.length - 1]).trim()) {
    wrapped.pop()
  }
  return wrapped
}

function computeShrinkScaleX(text, layout, fontScale = 1) {
  const sample = String(text || '').trim()
  if (!sample) return 1
  const fontSize = getEffectiveFontSize(layout, fontScale)
  const baseSx = getLayoutTextScaleX(layout)
  const maxRoot = getWrapContentMaxRootWidth(layout)
  const w = measureTextWidth(sample, fontSize, layout, fontScale)
  const visualW = w * baseSx
  if (visualW <= maxRoot || visualW <= 0) return 1
  return Math.max(0.25, maxRoot / visualW)
}

function resolveTextScaleX(_textEl, layout, lineTexts, fontScale = 1) {
  const base = getLayoutTextScaleX(layout)
  if (getTextFitMode(layout) !== 'shrink') return base
  const lines = Array.isArray(lineTexts) ? lineTexts : [lineTexts]
  let shrink = 1
  for (const line of lines) {
    shrink = Math.min(shrink, computeShrinkScaleX(line, layout, fontScale))
  }
  return base * shrink
}

function countDisplayLines(lineTexts) {
  const lines = lineTexts.map((l) => String(l || ''))
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop()
  return Math.max(lines.length, 1)
}

function getTextContent(textEl) {
  const tspan = textEl.querySelector('tspan')
  return (tspan ? tspan.textContent : textEl.textContent) || ''
}

function parseTextTranslate(textEl) {
  const t = textEl.getAttribute('transform') || ''
  const tm = t.match(/translate\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*\)/i)
  if (!tm) return { tx: null, ty: null, scaleX: 1 }
  const sm = t.match(/scale\s*\(\s*([\d.-]+)/i)
  return {
    tx: parseFloat(tm[1]),
    ty: parseFloat(tm[2]),
    scaleX: sm ? parseFloat(sm[1]) : 1,
  }
}

function parseTextTranslateY(textEl) {
  return parseTextTranslate(textEl).ty
}

function parseTextTranslateX(textEl) {
  return parseTextTranslate(textEl).tx
}

function setTextTranslate(textEl, tx, ty, scaleXOverride = null) {
  const parsed = parseTextTranslate(textEl)
  const scaleX = scaleXOverride != null ? scaleXOverride : parsed.scaleX
  if (tx == null || ty == null || Number.isNaN(tx) || Number.isNaN(ty)) return
  const scalePart = scaleX !== 1 ? ` scale(${Math.round(scaleX * 10000) / 10000} 1)` : ''
  const rtx = Math.round(tx * 100) / 100
  const rty = Math.round(ty * 100) / 100
  textEl.setAttribute('transform', `translate(${rtx} ${rty})${scalePart}`)
}

function setTextTranslateY(textEl, ty) {
  const { tx } = parseTextTranslate(textEl)
  if (tx == null) return
  setTextTranslate(textEl, tx, ty)
}

function applyTextFill(textEl, layout) {
  if (layout.textFill) {
    textEl.setAttribute('fill', layout.textFill)
    for (const tspan of textEl.querySelectorAll('tspan')) {
      tspan.setAttribute('fill', layout.textFill)
    }
  }
}

function resolveTextStroke(layout) {
  return layout.textStroke || layout.overlayOutline || ''
}

function resolveTextRotation(layout) {
  const v = layout.textRotation ?? layout.overlayRotation
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function applyTextStroke(textEl, layout) {
  const stroke = resolveTextStroke(layout)
  const apply = (el) => {
    if (!stroke) {
      el.removeAttribute('stroke')
      el.removeAttribute('stroke-width')
      el.removeAttribute('paint-order')
      return
    }
    el.setAttribute('stroke', stroke)
    el.setAttribute('stroke-width', '0.6')
    el.setAttribute('paint-order', 'stroke fill')
  }
  apply(textEl)
  for (const tspan of textEl.querySelectorAll('tspan')) apply(tspan)
}

function appendTextRotationToTransform(textEl, layout, rootX, rootY) {
  const rot = resolveTextRotation(layout)
  if (!rot) return
  const t = textEl.getAttribute('transform') || ''
  const withoutRotate = t.replace(/\s*rotate\([^)]*\)/gi, '').trim()
  const rotatePart = ` rotate(${rot} ${rootX} ${rootY})`
  textEl.setAttribute('transform', `${withoutRotate}${rotatePart}`)
}

function applyTextLetterSpacing(textEl, layout, fontScale = 1) {
  const ls = getEffectiveLetterSpacing(layout, fontScale)
  const rounded = Math.round(ls * 1000) / 1000
  const apply = (el) => {
    if (!rounded) el.removeAttribute('letter-spacing')
    else el.setAttribute('letter-spacing', String(rounded))
  }
  apply(textEl)
  for (const tspan of textEl.querySelectorAll('tspan')) apply(tspan)
}

function applyTextFontSize(textEl, layout, fontScale = 1) {
  const size = getEffectiveFontSize(layout, fontScale)
  textEl.setAttribute('font-size', String(Math.round(size * 100) / 100))
  for (const tspan of textEl.querySelectorAll('tspan')) {
    tspan.setAttribute('font-size', String(Math.round(size * 100) / 100))
  }
  applyTextFontFamily(textEl, layout)
  applyTextFill(textEl, layout)
  applyTextLetterSpacing(textEl, layout, fontScale)
}

function countNonEmptyLines(lineTexts) {
  const n = lineTexts.filter((l) => String(l || '').trim()).length
  return n > 0 ? n : lineTexts.length
}

function getLayoutForColumn(column, layoutOverrides = {}) {
  return getColumnLayout(column, layoutOverrides)
}

function resolveBoxAnchorX(layout) {
  const pad = PEDIGREE_WRAP_PADDING
  const alignH = getContentAlignH(layout)
  const centerX = (layout.boxLeft + layout.boxRight) / 2

  if (layout.align === 'right') {
    if (alignH === 'left') return { rootX: layout.boxLeft + pad, anchor: 'start' }
    if (alignH === 'center') return { rootX: centerX, anchor: 'middle' }
    // 有编辑框边界时以 boxRight 为准，避免 anchorRootX 固定导致拖框后文字不随 X 移动
    const rootX = layoutHasBox(layout)
      ? layout.boxRight - pad
      : (layout.anchorRootX ?? layout.boxRight - pad)
    return { rootX, anchor: 'end' }
  }
  if (layout.align === 'left') {
    if (alignH === 'right') return { rootX: layout.boxRight - pad, anchor: 'end' }
    if (alignH === 'center') return { rootX: centerX, anchor: 'middle' }
    return { rootX: layout.boxLeft + pad, anchor: 'start' }
  }
  if (alignH === 'left') return { rootX: layout.boxLeft + pad, anchor: 'start' }
  if (alignH === 'right') return { rootX: layout.boxRight - pad, anchor: 'end' }
  return { rootX: centerX, anchor: 'middle' }
}

function getTextBlockVisualMetrics(lineCount, layout, fontScale = 1, { tight = false } = {}) {
  const lineGap = getEffectiveLineGap(layout, fontScale)
  const fontSize = getEffectiveFontSize(layout, fontScale)
  const { ascent, descent } = getFontExtents(fontSize, layout, { tight })
  const lines = Math.max(lineCount, 1)
  const blockSpan = Math.max(0, lines - 1) * lineGap
  const visualHeight = ascent + blockSpan + descent
  return { blockSpan, visualHeight, ascent, descent, lineGap, lineExtent: ascent + descent }
}

function resolveBoxAnchorY(layout, lineTexts, fontScale = 1) {
  const lineCount = countDisplayLines(lineTexts)
  const alignMode = resolveVerticalAlignMode(layout)
  const pad = PEDIGREE_WRAP_PADDING
  const edgeAlign = alignMode === 'top' || alignMode === 'bottom'
  const { blockSpan, visualHeight, ascent, descent, lineExtent } = getTextBlockVisualMetrics(
    lineCount,
    layout,
    fontScale,
    { tight: edgeAlign },
  )

  if (alignMode === 'top') {
    return layout.boxTop
  }
  if (alignMode === 'bottom') {
    return layout.boxBottom - blockSpan - lineExtent
  }

  const innerTop = layout.boxTop + pad
  const innerBottom = layout.boxBottom - pad
  const innerHeight = innerBottom - innerTop
  const visualTop = innerTop + Math.max(0, (innerHeight - visualHeight) / 2)
  return visualTop + ascent
}

function applyTspanAtRoot(textEl, anchor) {
  textEl.setAttribute('text-anchor', anchor)
  for (const tspan of textEl.querySelectorAll('tspan')) {
    tspan.setAttribute('x', '0')
    tspan.setAttribute('text-anchor', anchor)
  }
}

/** 按编辑框与对齐方式定位文字（拖拽框后内容随框移动） */
function applyBoxTextLayout(textEl, layout, lineTexts, fontScale = 1) {
  const alignMode = resolveVerticalAlignMode(layout)
  applyTextFontSize(textEl, layout, fontScale)
  applyTextBaselines(textEl, alignMode)
  if (!layoutHasBox(layout)) return

  const { rootX, anchor } = resolveBoxAnchorX(layout)
  const rootY = resolveBoxAnchorY(layout, lineTexts, fontScale)
  const scaleX = resolveTextScaleX(textEl, layout, lineTexts, fontScale)
  setTextTranslate(textEl, rootX, rootY, scaleX)
  applyTspanAtRoot(textEl, anchor)
  applyTextStroke(textEl, layout)
  appendTextRotationToTransform(textEl, layout, rootX, rootY)
}

function applyVerticalCenterAtAnchor(textEl, layout, lineTexts, anchorTy, fontScale = 1) {
  if (layoutHasBox(layout)) {
    applyBoxTextLayout(textEl, layout, lineTexts, fontScale)
    return
  }

  const lineCount = countNonEmptyLines(lineTexts)

  if (anchorTy != null && !Number.isNaN(anchorTy)) {
    let newTy
    if (lineCount <= 1 || layout.verticalAnchor === 'start') {
      newTy = anchorTy
    } else {
      const lineGap = getEffectiveLineGap(layout, fontScale)
      const fontSize = getEffectiveFontSize(layout, fontScale)
      const { ascent, descent } = getFontExtents(fontSize, layout)
      const blockSpan = (lineCount - 1) * lineGap
      const visualHeight = ascent + blockSpan + descent
      newTy = anchorTy - visualHeight / 2 + ascent
    }
    setTextTranslateY(textEl, newTy)
  }
}

function applyColumnTextLayout(textEl, column, lineTexts, anchorTy, layoutOverrides = {}, fontScale = 1) {
  const layout = getLayoutForColumn(column, layoutOverrides)
  applyBoxTextLayout(textEl, layout, lineTexts, fontScale)
  if (!layoutHasBox(layout)) {
    applyVerticalCenterAtAnchor(textEl, layout, lineTexts, anchorTy, fontScale)
  }
}

function applyFieldGroupBoxLayout(groupEl, layout, lineTexts, fontScale = 1) {
  if (!groupEl) return
  const textEls = [...groupEl.querySelectorAll(':scope text')]
  if (textEls.length === 0) return

  if (textEls.length === 1) {
    applyBoxTextLayout(textEls[0], layout, lineTexts, fontScale)
    return
  }

  if (!layoutHasBox(layout)) return

  const lineGap = getEffectiveLineGap(layout, fontScale)
  const { rootX, anchor } = resolveBoxAnchorX(layout)
  const startTy = resolveBoxAnchorY(layout, lineTexts, fontScale)
  const alignMode = resolveVerticalAlignMode(layout)

  textEls.forEach((textEl, i) => {
    applyTextFontSize(textEl, layout, fontScale)
    applyTextBaselines(textEl, alignMode)
    const line = lineTexts[i] ?? ''
    const scaleX = resolveTextScaleX(textEl, layout, [line], fontScale)
    setTextTranslate(textEl, rootX, startTy + i * lineGap, scaleX)
    applyTspanAtRoot(textEl, anchor)
  })
}

function setSingleLineText(textEl, line) {
  const tspans = textEl.querySelectorAll('tspan')
  if (tspans.length > 0) {
    tspans[0].textContent = line
    for (let i = 1; i < tspans.length; i++) tspans[i].remove()
  } else {
    textEl.textContent = line
  }
}

/** 在同一 text 元素内写入多行（用于无 field-* 分组的标签占位符） */
function setMultilineOnTextElement(textEl, lineTexts, lineHeight = PEDIGREE_LINE_HEIGHT) {
  while (textEl.firstChild) textEl.removeChild(textEl.firstChild)
  lineTexts.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, 'tspan')
    if (i === 0) {
      tspan.setAttribute('x', '0')
      tspan.setAttribute('y', '0')
    } else {
      tspan.setAttribute('x', '0')
      tspan.setAttribute('dy', String(lineHeight))
    }
    tspan.textContent = line
    textEl.appendChild(tspan)
  })
}

function markDataColumn(el, column) {
  if (!el || !column) return
  el.setAttribute('data-cat-column', column)
  el.classList.add('cat-data-field')
}

/** @param {ParentNode | null | undefined} svgRoot @param {string} column @param {object} [layoutOverrides] @returns {SVGTextElement | null} */
export function findColumnDataTextElement(svgRoot, column, layoutOverrides = {}) {
  if (!svgRoot || !column) return null
  const keys = [...new Set([column, getPrimaryColumnForBox(column, layoutOverrides)].filter(Boolean))]
  for (const key of keys) {
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key
    const candidates = [
      ...svgRoot.querySelectorAll(`#cat-data-layer [data-cat-data-column="${esc}"]`),
      ...svgRoot.querySelectorAll(`#cat-data-layer [data-cat-column="${esc}"]`),
    ]
    for (const el of candidates) {
      if (el instanceof SVGTextElement) return el
      const text = el.querySelector('text')
      if (text instanceof SVGTextElement) return text
    }
  }
  return null
}

/** @param {SVGElement} el @param {'fill' | 'stroke'} attr */
function readSvgTextPaint(el, attr) {
  const readOn = (node) => {
    if (!(node instanceof SVGElement)) return ''
    const own = node.getAttribute(attr)
    if (own && own !== 'none' && own !== 'inherit') return own
    return ''
  }

  const direct = readOn(el)
  if (direct) return direct
  for (const tspan of el.querySelectorAll('tspan')) {
    const ts = readOn(tspan)
    if (ts) return ts
  }
  try {
    const computed = getComputedStyle(el)
    const value = attr === 'fill' ? computed.fill : computed.stroke
    if (value && value !== 'none' && value !== 'transparent') return value
  } catch { /* ignore */ }
  return ''
}

/** @param {ParentNode | null | undefined} svgRoot @param {string} column @param {object} [layoutOverrides] */
export function readColumnTextFillFromSvg(svgRoot, column, layoutOverrides = {}) {
  const el = findColumnDataTextElement(svgRoot, column, layoutOverrides)
  return el ? readSvgTextPaint(el, 'fill') : ''
}

/** @param {ParentNode | null | undefined} svgRoot @param {string} column @param {object} [layoutOverrides] */
export function readColumnTextStrokeFromSvg(svgRoot, column, layoutOverrides = {}) {
  const el = findColumnDataTextElement(svgRoot, column, layoutOverrides)
  return el ? readSvgTextPaint(el, 'stroke') : ''
}

/** 写入 field 组：多个独立 text 或单个 text 多 tspan */
function setFieldGroupLines(groupEl, lineTexts, column, fontScale = 1, layoutOverrides = {}) {
  if (!groupEl) return
  markDataColumn(groupEl, column)
  const layout = getLayoutForColumn(column, layoutOverrides)
  const lineGap = getEffectiveLineGap(layout, fontScale)
  const displayLines = wrapPedigreeLines(lineTexts, layout, fontScale)
  const textEls = [...groupEl.querySelectorAll(':scope text')]

  if (textEls.length >= 2) {
    textEls.forEach((textEl, i) => setSingleLineText(textEl, displayLines[i] ?? ''))
    applyFieldGroupBoxLayout(groupEl, layout, displayLines, fontScale)
    return
  }

  if (textEls.length === 1) {
    const anchorTy = parseTextTranslateY(textEls[0])
    if (displayLines.length <= 1) {
      setSingleLineText(textEls[0], displayLines[0] ?? '')
      applyColumnTextLayout(textEls[0], column, displayLines, anchorTy, layoutOverrides, fontScale)
    } else {
      setMultilineOnTextElement(textEls[0], displayLines, lineGap)
      applyColumnTextLayout(textEls[0], column, displayLines, anchorTy, layoutOverrides, fontScale)
    }
    return
  }

  const tspans = groupEl.querySelectorAll('tspan')
  const n = Math.min(tspans.length, displayLines.length)
  for (let k = 0; k < n; k++) tspans[k].textContent = displayLines[k] || ''
}

function findTextElementsByLabel(svgRoot, label, options = {}) {
  const results = []
  svgRoot.querySelectorAll('text').forEach((textEl) => {
    if (getTextContent(textEl).trim() !== label) return
    const y = parseTextTranslateY(textEl)
    if (options.minY != null && y != null && y < options.minY) return
    if (options.maxY != null && y != null && y > options.maxY) return
    results.push(textEl)
  })
  return results
}

function ensureDataLayer(svgRoot) {
  let layer = svgRoot.querySelector('#cat-data-layer')
  if (!layer) {
    layer = document.createElementNS(SVG_NS, 'g')
    layer.id = 'cat-data-layer'
    layer.setAttribute('pointer-events', 'none')
    svgRoot.appendChild(layer)
  }
  return layer
}

function resetDataOverlay(svgRoot) {
  const layer = svgRoot.querySelector('#cat-data-layer')
  if (layer) layer.replaceChildren()
  const imgLayer = svgRoot.querySelector('#cat-cell-images')
  if (imgLayer) imgLayer.replaceChildren()
}

/** 仅移除数据叠加层中该列的文字（不改动模板内原文） */
function removeColumnDataText(svgRoot, column) {
  svgRoot.querySelectorAll(`[data-cat-data-column="${column}"]`).forEach((el) => el.remove())
}

function removeColumnImage(svgRoot, column) {
  svgRoot.querySelectorAll(`[data-cat-image-column="${column}"]`).forEach((el) => el.remove())
}

function getColumnImageRect(svgRoot, column, layoutOverrides = {}) {
  const layout = getColumnLayout(column, layoutOverrides)
  const pad = PEDIGREE_WRAP_PADDING
  if (!layoutHasBox(layout)) return null
  return {
    x: layout.boxLeft + pad,
    y: layout.boxTop + pad,
    w: Math.max(1, layout.boxRight - layout.boxLeft - pad * 2),
    h: Math.max(1, layout.boxBottom - layout.boxTop - pad * 2),
    layout,
  }
}

function layoutImageAlignFromLayout(layout) {
  let alignH = getContentAlignH(layout)
  if (!['left', 'center', 'right'].includes(alignH)) alignH = 'center'
  let alignV = getContentAlignV(layout)
  if (!['top', 'center', 'bottom'].includes(alignV)) alignV = 'center'
  return { h: alignH, v: alignV }
}

function preserveAspectRatioFromAlign(alignH, alignV) {
  const x = alignH === 'left' ? 'xMin' : alignH === 'right' ? 'xMax' : 'xMid'
  const y = alignV === 'top' ? 'YMin' : alignV === 'bottom' ? 'YMax' : 'YMid'
  return `${x}${y} meet`
}

function applyImageElementGeometry(img, rect, layout) {
  const { h: alignH, v: alignV } = layoutImageAlignFromLayout(layout)
  img.setAttribute('x', String(rect.x))
  img.setAttribute('y', String(rect.y))
  img.setAttribute('width', String(rect.w))
  img.setAttribute('height', String(rect.h))
  img.setAttribute('preserveAspectRatio', preserveAspectRatioFromAlign(alignH, alignV))
}

function ensureCellImagesLayer(svgRoot) {
  let layer = svgRoot.querySelector('#cat-cell-images')
  if (!layer) {
    layer = document.createElementNS(SVG_NS, 'g')
    layer.id = 'cat-cell-images'
    layer.setAttribute('pointer-events', 'none')
    svgRoot.appendChild(layer)
  }
  return layer
}

/** 在编辑框区域内渲染图片（替代文字路径） */
function fillImageForColumn(svgRoot, column, rawValue, layoutOverrides = {}) {
  const columnLayout = getColumnLayout(column, layoutOverrides)
  if (isLayoutBoxHidden(columnLayout)) {
    removeColumnImage(svgRoot, column)
    return false
  }
  const url = imageCellUrl(rawValue)
  if (!url) return false
  const box = getColumnImageRect(svgRoot, column, layoutOverrides)
  if (!box) return false
  const { layout, ...rect } = box

  removeColumnDataText(svgRoot, column)
  removeColumnImage(svgRoot, column)

  const href = resolveImageFetchUrl(url) || url
  const layer = ensureCellImagesLayer(svgRoot)
  const img = document.createElementNS(SVG_NS, 'image')
  img.setAttribute('data-cat-image-column', column)
  img.setAttribute('data-cat-column', column)
  applyImageElementGeometry(img, rect, layout)

  img.setAttribute('href', href)
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href)
  layer.appendChild(img)

  return true
}

function columnsForRowFill(rowData, layoutOverrides = {}, options = {}) {
  const tableColumns = options.tableColumns?.length
    ? options.tableColumns
    : (Array.isArray(layoutOverrides.__tableTemplateColumns) ? layoutOverrides.__tableTemplateColumns : [])
  const tableTemplateScope = layoutOverrides.__tableTemplateScope === true

  if (tableTemplateScope && tableColumns.length) {
    const cols = new Set()
    for (const col of tableColumns) {
      cols.add(col)
      cols.add(getPrimaryColumnForBox(col, layoutOverrides))
    }
    for (const boxId of listLayoutBoxIds(layoutOverrides)) {
      cols.add(boxId)
      cols.add(getPrimaryColumnForBox(boxId, layoutOverrides))
    }
    return [...cols].filter((k) => k && k !== LAYOUT_BINDINGS_KEY && !String(k).startsWith('__'))
  }

  if (options.restrictToRowColumns) {
    const cols = new Set(Object.keys(rowData || {}))
    for (const boxId of listLayoutBoxIds(layoutOverrides)) {
      cols.add(getPrimaryColumnForBox(boxId, layoutOverrides))
    }
    return [...cols].filter((k) => k !== LAYOUT_BINDINGS_KEY)
  }
  return [...new Set([
    ...COLUMNS,
    ...Object.keys(rowData || {}),
    ...Object.keys(layoutOverrides || {}),
    ...Object.keys(getBindings(layoutOverrides)),
  ])].filter((k) => k !== LAYOUT_BINDINGS_KEY && !String(k).startsWith('__'))
}

/** 在编辑框区域内叠加表格文字（不修改模板内原有 text） */
function fillByLayoutBox(svgRoot, column, lineTexts, fontScale = 1, layoutOverrides = {}) {
  const layout = getLayoutForColumn(column, layoutOverrides)
  if (!layoutHasBox(layout)) return false

  removeColumnDataText(svgRoot, column)
  if (isLayoutBoxHidden(layout)) return true

  const displayLines = wrapPedigreeLines(lineTexts, layout, fontScale)
  const hasContent = displayLines.some((l) => String(l || '').trim())
  if (!hasContent) return true

  const layer = ensureDataLayer(svgRoot)
  const lineHeight = getEffectiveLineGap(layout, fontScale)
  const textEl = document.createElementNS(SVG_NS, 'text')
  textEl.setAttribute('data-cat-data-column', column)
  markDataColumn(textEl, column)
  layer.appendChild(textEl)

  if (displayLines.length <= 1) {
    setSingleLineText(textEl, displayLines[0] ?? '')
    applyBoxTextLayout(textEl, layout, displayLines, fontScale)
  } else {
    setMultilineOnTextElement(textEl, displayLines, lineHeight)
    applyBoxTextLayout(textEl, layout, displayLines, fontScale)
  }
  return true
}

function getSireLeftRightAlignAnchorXForTx(tx) {
  if (tx == null || Number.isNaN(tx)) return null
  const rootRight = SIRE_LEFT_POLYLINE_X - mmToSvgUserX(RIGHT_ALIGN_GAP_MM)
  return (rootRight - tx) / SIRE_LEFT_TEXT_SCALE_X
}

function forceFieldAlign(svgRoot, fieldId, column) {
  if (!RIGHT_ALIGN_FIELD_IDS.has(fieldId) && !CENTER_ALIGN_FIELD_IDS.has(fieldId)) return
  const el = svgRoot.getElementById(fieldId)
  if (!el) return
  const textEls = el.querySelectorAll('text')
  if (!textEls.length) return

  if (RIGHT_ALIGN_FIELD_IDS.has(fieldId)) {
    for (const te of textEls) {
      const tx = parseTextTranslateX(te)
      let anchorX = getSireLeftRightAlignAnchorXForTx(tx)
      if (anchorX == null) continue
      anchorX = Math.round(anchorX * 100) / 100
      for (const tspan of te.querySelectorAll('tspan')) {
        tspan.setAttribute('x', String(anchorX))
        tspan.setAttribute('text-anchor', 'end')
      }
    }
    return
  }

  const anchorLocal = CENTER_ALIGN_ANCHOR_X[fieldId]
  if (anchorLocal == null) return
  const tx0 = parseTextTranslateX(textEls[0])
  if (tx0 == null || Number.isNaN(tx0)) return
  const centerRootX = tx0 + anchorLocal * SIRE_LEFT_TEXT_SCALE_X

  for (const teC of textEls) {
    const txC = parseTextTranslateX(teC)
    if (txC == null || Number.isNaN(txC)) continue
    let anchorXC = textEls.length === 1
      ? anchorLocal
      : (centerRootX - txC) / SIRE_LEFT_TEXT_SCALE_X
    anchorXC = Math.round(anchorXC * 100) / 100
    for (const tspan of teC.querySelectorAll('tspan')) {
      tspan.setAttribute('x', String(anchorXC))
      tspan.setAttribute('text-anchor', 'middle')
    }
  }
}

function templateHasFieldIds(svgRoot) {
  return !!svgRoot.querySelector('[id^="field-"]')
}

export function queryReferenceLayers(svgRoot) {
  const layers = []
  const byId = svgRoot.getElementById(REFERENCE_LAYER_ID)
  if (byId) layers.push(byId)
  if (!layers.length) {
    const byName = svgRoot.querySelector('g[data-name="参考层"]')
    if (byName) layers.push(byName)
  }
  return layers
}

/** 后台预览：显示或隐藏参考层（不删节点，便于对照位置） */
export function setReferenceLayerVisible(svgRoot, visible) {
  for (const el of queryReferenceLayers(svgRoot)) {
    el.style.display = visible ? '' : 'none'
  }
}

export function queryTemplateLayers(svgRoot) {
  const layers = []
  const byId = svgRoot.getElementById(TEMPLATE_LAYER_ID)
  if (byId) layers.push(byId)
  if (!layers.length) {
    const byName = svgRoot.querySelector('g[data-name="模板底图"]')
    if (byName) layers.push(byName)
  }
  if (!layers.length) {
    const legacy = svgRoot.getElementById(LEGACY_TEMPLATE_LAYER_ID)
    if (legacy) layers.push(legacy)
  }
  return layers
}

/** 后台预览：显示或隐藏模板底图 */
export function setTemplateDecorVisible(svgRoot, visible) {
  for (const el of queryTemplateLayers(svgRoot)) {
    el.style.display = visible ? '' : 'none'
  }
}

/** 导出 / 证书预览：仅保留画板内可见区域 */
export function applyArtboardClipToSvg(svgRoot, pageWidthMm, pageHeightMm) {
  const { width, height } = previewStageDimensionsForPage(pageWidthMm, pageHeightMm)
  svgRoot.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svgRoot.setAttribute('overflow', 'hidden')
}

/** 布局模板库编辑预览：允许画板外内容可见 */
export function applyArtboardEditorOverflow(svgRoot) {
  svgRoot.setAttribute('overflow', 'visible')
}

/** 按布局中底图区域缩放模板底图图层 */
function resolveTemplateSourceFromLayers(svgRoot) {
  for (const layer of queryTemplateLayers(svgRoot)) {
    const prev = layer.getAttribute('transform')
    layer.removeAttribute('transform')
    try {
      const bbox = layer.getBBox()
      if (bbox.width > 0 && bbox.height > 0) {
        return {
          minX: bbox.x,
          minY: bbox.y,
          width: bbox.width,
          height: bbox.height,
        }
      }
    } catch {
      /* getBBox 在不可见或未挂载时可能失败 */
    } finally {
      if (prev != null) layer.setAttribute('transform', prev)
      else layer.removeAttribute('transform')
    }
  }
  return null
}

export function applyTemplateBackgroundTransform(svgRoot, layoutOverrides = {}, pageWidthMm, pageHeightMm) {
  const bg = getTemplateBackground(layoutOverrides, pageWidthMm, pageHeightMm)
  const targetW = bg.boxRight - bg.boxLeft
  const targetH = bg.boxBottom - bg.boxTop
  if (!(targetW > 0 && targetH > 0)) return

  let src = resolveTemplateSourceDimensions(svgRoot)
  if (!svgRoot.getAttribute('data-template-source-viewbox')) {
    const fromLayer = resolveTemplateSourceFromLayers(svgRoot)
    if (fromLayer) {
      src = fromLayer
      svgRoot.setAttribute(
        'data-template-source-viewbox',
        `${fromLayer.minX} ${fromLayer.minY} ${fromLayer.width} ${fromLayer.height}`,
      )
    }
  }
  const sx = targetW / src.width
  const sy = targetH / src.height
  const tx = bg.boxLeft - src.minX * sx
  const ty = bg.boxTop - src.minY * sy
  const transform = `translate(${tx} ${ty}) scale(${sx} ${sy})`

  for (const layer of queryTemplateLayers(svgRoot)) {
    layer.setAttribute('transform', transform)
  }
}

/** 导出前从 DOM 移除参考层 */
export function removeReferenceLayers(svgRoot) {
  for (const el of queryReferenceLayers(svgRoot)) {
    el.remove()
  }
}

/** 显示可编辑层，隐藏标注层；参考层与模板底图由选项控制 */
function prepareLayers(svgRoot, { showReferenceLayer = false, showTemplateLayer = true } = {}) {
  const textLayer = svgRoot.querySelector('#_文字')
  const textNewLayer = svgRoot.querySelector('#_文字新')
  const labelLayer = svgRoot.querySelector('#_图层_4')

  if (textLayer) textLayer.style.display = 'block'
  if (textNewLayer) textNewLayer.style.display = 'none'
  if (labelLayer) labelLayer.style.display = 'none'
  setReferenceLayerVisible(svgRoot, showReferenceLayer)
  setTemplateDecorVisible(svgRoot, showTemplateLayer)
}

/** DOM 点击目标 → 表格列名 */
export function resolveColumnFromDomTarget(el) {
  let node = el
  while (node) {
    if (node instanceof Element) {
      const tagged = node.getAttribute('data-cat-column')
      if (tagged) return tagged
      if (node.id?.startsWith('field-')) {
        const col = FIELD_ID_TO_COLUMN[node.id]
        if (col) return col
      }
    }
    node = node.parentNode
  }
  return null
}

/** SVG 坐标点 → 最内层编辑框列（按框面积最小优先） */
export function resolveColumnAtSvgPoint(svgRoot, x, y, layoutOverrides = {}) {
  let best = null
  let bestArea = Infinity
  const boxIds = listLayoutBoxIds(layoutOverrides)
  for (const boxId of boxIds) {
    const column = getPrimaryColumnForBox(boxId, layoutOverrides)
    const layout = getColumnLayout(column, layoutOverrides)
    if (!layoutHasBox(layout)) continue
    const { boxLeft, boxRight, boxTop, boxBottom } = layout
    if (x < boxLeft || x > boxRight || y < boxTop || y > boxBottom) continue
    const area = (boxRight - boxLeft) * (boxBottom - boxTop)
    if (area < bestArea) {
      bestArea = area
      best = column
    }
  }
  return best
}

/** 屏幕坐标 → SVG 用户坐标 */
export function clientPointToSvg(svgRoot, clientX, clientY) {
  if (!svgRoot?.createSVGPoint) return null
  const pt = svgRoot.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svgRoot.getScreenCTM?.()
  if (!ctm) return null
  const out = pt.matrixTransform(ctm.inverse())
  return { x: out.x, y: out.y }
}

/** 高亮当前字段（预览 ↔ 表格联动） */
export function setSvgFieldHighlight(svgRoot, column, layoutOverrides = {}) {
  if (!svgRoot) return
  let layer = svgRoot.querySelector('#cat-field-highlight-layer')
  if (!layer) {
    layer = document.createElementNS(SVG_NS, 'g')
    layer.id = 'cat-field-highlight-layer'
    layer.setAttribute('pointer-events', 'none')
    svgRoot.appendChild(layer)
  }
  layer.replaceChildren()
  if (!column) return

  const appendHighlightRect = (x, y, w, h) => {
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', String(w))
    rect.setAttribute('height', String(h))
    rect.setAttribute('rx', '2')
    rect.setAttribute('class', 'cat-field-highlight-rect')
    rect.setAttribute('fill', 'rgba(37, 99, 235, 0.14)')
    rect.setAttribute('stroke', '#2563eb')
    rect.setAttribute('stroke-width', '1.2')
    layer.appendChild(rect)
  }

  const layout = getColumnLayout(column, layoutOverrides)
  if (isLayoutBoxActive(layout)) {
    appendHighlightRect(
      layout.boxLeft,
      layout.boxTop,
      layout.boxRight - layout.boxLeft,
      layout.boxBottom - layout.boxTop,
    )
    return
  }

  for (const el of svgRoot.querySelectorAll(
    `#cat-data-layer [data-cat-column="${column}"], #cat-cell-images [data-cat-column="${column}"]`,
  )) {
    try {
      const box = el.getBBox()
      appendHighlightRect(box.x - 1, box.y - 1, box.width + 2, box.height + 2)
    } catch {
      // getBBox may fail on empty/hidden nodes
    }
  }
}

/** 解析预览区点击对应的列 */
export function resolveColumnFromPreviewClick(svgRoot, target, clientX, clientY, layoutOverrides = {}) {
  const fromDom = resolveColumnFromDomTarget(target)
  if (fromDom) return fromDom
  const pt = clientPointToSvg(svgRoot, clientX, clientY)
  if (!pt) return null
  return resolveColumnAtSvgPoint(svgRoot, pt.x, pt.y, layoutOverrides)
}

async function injectFont(svgRoot, fontUrl) {
  const base64 = await getFontBase64(fontUrl)
  let defs = svgRoot.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs')
    svgRoot.prepend(defs)
  }

  if (!defs.querySelector('#cat-font-face')) {
    const style = document.createElementNS(SVG_NS, 'style')
    style.id = 'cat-font-face'
    style.textContent = buildFontFaceCss(base64)
    defs.appendChild(style)
  }
}

export function fillSvgDocument(svgRoot, rowData, options = {}) {
  const fontScale = normalizeFontScale(options.fontScale)
  const layoutOverrides = options.layoutOverrides || {}
  const data = rowData || {}
  const restrictToRowColumns = !!options.restrictToRowColumns

  resetDataOverlay(svgRoot)

  for (const column of columnsForRowFill(data, layoutOverrides, options)) {
    const raw = data[column]

    if (restrictToRowColumns && (raw == null || String(raw).trim() === '')) {
      removeColumnDataText(svgRoot, column)
      removeColumnImage(svgRoot, column)
      continue
    }

    if (isImageCellValue(raw)) {
      removeColumnDataText(svgRoot, column)
      fillImageForColumn(svgRoot, column, raw, layoutOverrides)
      continue
    }

    removeColumnImage(svgRoot, column)
    const lineTexts = buildLinesForKey(column, raw)
    fillByLayoutBox(svgRoot, column, lineTexts, fontScale, layoutOverrides)
  }
}

/**
 * 根据一行表格数据生成 SVG 元素
 * @param {string} templateSvg - 原始 SVG 字符串
 * @param {Record<string, string>} rowData - 列名→值
 * @param {string} fontUrl - 字体 URL
 * @param {{ fontScale?: number, layoutOverrides?: Record<string, object>, showReferenceLayer?: boolean, showTemplateLayer?: boolean, skipFontInject?: boolean, shouldAbort?: () => boolean }} [options]
 * @returns {SVGSVGElement}
 */
export async function generateSvgFromRow(templateSvg, rowData, fontUrl, options = {}) {
  const shouldAbort = options.shouldAbort
  throwIfSvgGenerationAborted(shouldAbort)

  const fontScale = normalizeFontScale(options.fontScale)
  const showReferenceLayer = !!options.showReferenceLayer
  const showTemplateLayer = options.showTemplateLayer !== false
  const catalog = options.fontCatalog || activeFontCatalog
  const prevCatalog = activeFontCatalog
  if (options.fontCatalog) activeFontCatalog = options.fontCatalog

  const parser = new DOMParser()
  const doc = parser.parseFromString(templateSvg, 'image/svg+xml')
  const svgRoot = doc.documentElement

  try {
    scopeSvgStyleClasses(svgRoot)
    prepareLayers(svgRoot, { showReferenceLayer, showTemplateLayer })
    cacheTemplateSourceDimensions(svgRoot)
    applyTemplateBackgroundTransform(
      svgRoot,
      options.layoutOverrides || {},
      options.pageWidthMm,
      options.pageHeightMm,
    )
    if (options.pageWidthMm != null || options.pageHeightMm != null) {
      applySvgPageDimensions(svgRoot, options.pageWidthMm, options.pageHeightMm)
    }
    throwIfSvgGenerationAborted(shouldAbort)
    await yieldToMain()
    throwIfSvgGenerationAborted(shouldAbort)
    fillSvgDocument(svgRoot, rowData, {
      fontScale,
      layoutOverrides: options.layoutOverrides || {},
      restrictToRowColumns: options.restrictToRowColumns,
      tableColumns: options.tableColumns,
    })
    applySvgFontScale(svgRoot, fontScale)
    throwIfSvgGenerationAborted(shouldAbort)
    await yieldToMain()
    throwIfSvgGenerationAborted(shouldAbort)
    if (!options.skipFontInject) {
      if (catalog) {
        await ensureCatalogFontFaces(catalog)
        throwIfSvgGenerationAborted(shouldAbort)
        await injectFontsForLayouts(svgRoot, catalog, options.layoutOverrides || {})
      } else if (fontUrl) {
        await injectFont(svgRoot, fontUrl)
        applyFontFamilyToSvg(svgRoot, false)
      }
    }
    throwIfSvgGenerationAborted(shouldAbort)

    if (options.editorPreview) {
      applyArtboardEditorOverflow(svgRoot)
    } else if (options.clipToArtboard !== false) {
      applyArtboardClipToSvg(svgRoot, options.pageWidthMm, options.pageHeightMm)
    }

    return /** @type {SVGSVGElement} */ (document.importNode(svgRoot, true))
  } finally {
    if (options.fontCatalog) activeFontCatalog = prevCatalog
  }
}

/** 仅更新指定列的数据层（不重置整个 overlay，避免照片等列闪烁） */
export function updateSvgColumns(svgRoot, rowData, columnNames, options = {}) {
  const fontScale = normalizeFontScale(options.fontScale)
  const layoutOverrides = options.layoutOverrides || {}
  const restrictToRowColumns = options.restrictToRowColumns !== false

  for (const column of columnNames) {
    const layoutColumn = getPrimaryColumnForBox(column, layoutOverrides)
    const rowKey = rowData[column] != null
      ? column
      : (rowData[layoutColumn] != null ? layoutColumn : column)
    const raw = rowData[rowKey]
    const layout = getColumnLayout(column, layoutOverrides)

    if (isLayoutBoxHidden(layout) || raw == null || (restrictToRowColumns && String(raw).trim() === '')) {
      removeColumnDataText(svgRoot, layoutColumn)
      removeColumnImage(svgRoot, layoutColumn)
      continue
    }

    if (isImageCellValue(raw)) {
      removeColumnDataText(svgRoot, layoutColumn)
      fillImageForColumn(svgRoot, layoutColumn, raw, layoutOverrides)
    } else {
      removeColumnImage(svgRoot, layoutColumn)
      const lineTexts = buildLinesForKey(layoutColumn, raw)
      fillByLayoutBox(svgRoot, layoutColumn, lineTexts, fontScale, layoutOverrides)
    }
  }
  applySvgFontScale(svgRoot, fontScale)
}

/** 在已有 SVG 上重填文字与编辑框布局（不重建 DOM，用于面板参数即时预览） */
export function refillSvgRowText(svgRoot, rowData, options = {}) {
  const fontScale = normalizeFontScale(options.fontScale)
  const layoutOverrides = options.layoutOverrides || {}
  const affected = options.affectedColumns
  if (Array.isArray(affected) && affected.length) {
    updateSvgColumns(svgRoot, rowData, affected, options)
  } else {
    fillSvgDocument(svgRoot, rowData, {
      fontScale,
      layoutOverrides,
      restrictToRowColumns: options.restrictToRowColumns,
      tableColumns: options.tableColumns,
    })
    applySvgFontScale(svgRoot, fontScale)
  }
  applyTemplateBackgroundTransform(
    svgRoot,
    layoutOverrides,
    options.pageWidthMm,
    options.pageHeightMm,
  )
  if (options.pageWidthMm != null || options.pageHeightMm != null) {
    applySvgPageDimensions(svgRoot, options.pageWidthMm, options.pageHeightMm)
  }
}

/** SVG 元素序列化为字符串 */
export function serializeSvg(svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const serializer = new XMLSerializer()
  return serializer.serializeToString(clone)
}

const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** @type {Map<string, string>} */
const exportImageDataUrlCache = new Map()

function resolveImageFetchUrl(href) {
  const s = String(href || '').trim()
  if (!s || s.startsWith('data:')) return null
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  if (typeof window !== 'undefined' && s.startsWith('/')) {
    return `${window.location.origin}${s}`
  }
  if (typeof window !== 'undefined') {
    try {
      return new URL(s, window.location.href).href
    } catch {
      return null
    }
  }
  return s
}

async function fetchImageAsDataUrl(url) {
  if (exportImageDataUrlCache.has(url)) return exportImageDataUrlCache.get(url)
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('readAsDataURL failed'))
    reader.readAsDataURL(blob)
  })
  exportImageDataUrlCache.set(url, dataUrl)
  return dataUrl
}

/** 导出前将 &lt;image href="/uploads/..."&gt; 内嵌为 data URL，便于离线 SVG/PDF */
export async function embedSvgImages(svgRoot) {
  const images = [...svgRoot.querySelectorAll('image')]
  for (const img of images) {
    const href = img.getAttribute('href')
      || img.getAttributeNS(XLINK_NS, 'href')
      || ''
    const fetchUrl = resolveImageFetchUrl(href)
    if (!fetchUrl) continue
    try {
      const dataUrl = await fetchImageAsDataUrl(fetchUrl)
      img.setAttribute('href', dataUrl)
      img.setAttributeNS(XLINK_NS, 'xlink:href', dataUrl)
    } catch (err) {
      console.warn('[CAT 导出] 嵌入图片失败:', fetchUrl, err)
    }
  }
}

/** 移除仅用于编辑预览的 SVG 图层 */
export function removeExportUiLayers(svgRoot) {
  removeReferenceLayers(svgRoot)
  svgRoot.querySelector('#cat-field-highlight-layer')?.remove()
}

function finalizeSvgForPdfExport(svgRoot) {
  const dataLayer = svgRoot.querySelector('#cat-data-layer')
  if (dataLayer) {
    dataLayer.removeAttribute('pointer-events')
    svgRoot.appendChild(dataLayer)
  }
  const imgLayer = svgRoot.querySelector('#cat-cell-images')
  if (imgLayer) {
    imgLayer.removeAttribute('pointer-events')
    svgRoot.appendChild(imgLayer)
  }
}

/** 克隆并准备可导出的 SVG（内嵌图片、规范化样式） */
export async function prepareSvgElementForExport(svgEl, options = {}) {
  const clone = svgEl.cloneNode(true)
  removeExportUiLayers(clone)
  if (!options.forPdf) {
    normalizeSvgStylesForExport(clone)
  } else {
    finalizeSvgForPdfExport(clone)
    if (options.fontCatalog) {
      await injectCatalogFonts(clone, options.fontCatalog)
    }
  }
  await embedSvgImages(clone)
  if (options.pageWidthMm != null || options.pageHeightMm != null) {
    applyArtboardClipToSvg(clone, options.pageWidthMm, options.pageHeightMm)
  } else {
    clone.setAttribute('overflow', 'hidden')
  }
  return clone
}

/** 导出 SVG 文件用（字体名匹配 Illustrator / 系统，内嵌图片） */
export async function serializeSvgForExport(svgEl) {
  const clone = await prepareSvgElementForExport(svgEl)
  return serializeSvg(clone)
}

export function clearExportImageCache() {
  exportImageDataUrlCache.clear()
}

export async function loadExcelData(buffer, options = {}) {
  return parseExcelFromBufferAsync(buffer, options)
}

/** 粘贴 TSV/CSV 文本解析为行数据（兼容 Excel 引号与单元格内换行） */
export function parseTSVExcel(text) {
  text = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!text.trim()) return []

  const rows = []
  let row = []
  let cell = ''
  let i = 0
  let inQ = false

  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"') {
      inQ = true
      i++
      continue
    }
    if (c === '\t') {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
      continue
    }
    cell += c
    i++
  }

  row.push(cell)
  rows.push(row)

  while (rows.length && isBlankMatrixRow(rows[rows.length - 1])) {
    rows.pop()
  }

  return rows
}

function isBlankMatrixRow(row) {
  if (!row?.length) return true
  return row.every((c) => !String(c ?? '').replace(/\u00a0/g, ' ').trim())
}

export function sanitizePasteMatrix(matrix) {
  if (!matrix?.length) return []
  const grid = matrix.map((row) => row.map((cell) => String(cell ?? '').replace(/\u00a0/g, ' ')))
  while (grid.length && isBlankMatrixRow(grid[grid.length - 1])) {
    grid.pop()
  }
  return grid
}

function safeClipboardHtml(html) {
  return String(html || '')
    .replace(/(<img\b[^>]*\s)src\s*=\s*["']file:[^"']*["']/gi, '$1src=""')
    .replace(/src\s*=\s*["']file:[^"']*["']/gi, 'src=""')
}

function getClipboardCellText(el) {
  const raw = el?.innerText ?? el?.textContent ?? ''
  return normalizeMultilineCellText(raw)
}

function extractCellImageDataUrl(cell) {
  if (!cell?.querySelector) return null

  const img = cell.querySelector('img')
  if (img?.src?.startsWith('data:image')) return img.src

  const srcset = img?.srcset?.split(',')[0]?.trim().split(/\s+/)[0]
  if (srcset?.startsWith('data:image')) return srcset

  for (const el of cell.querySelectorAll('[src]')) {
    const src = el.getAttribute('src')
    if (src?.startsWith('data:image')) return src
  }

  const html = cell.innerHTML || ''
  const fromHtml = html.match(/src\s*=\s*["'](data:image[^"']+)["']/i)
  if (fromHtml) return fromHtml[1]

  const style = cell.getAttribute('style') || ''
  const bg = style.match(/background-image:\s*url\(['"]?(data:image[^'")]+)/i)
  if (bg) return bg[1]

  return null
}

/** 从 HTML 剪贴板解析表格矩阵及单元格内嵌图片（WPS/Excel 复制） */
export function parseHtmlClipboardRichMatrix(html) {
  if (!html || !/<(table|tr|td|th)/i.test(html)) {
    return { matrix: [], images: [] }
  }

  const div = document.createElement('div')
  div.innerHTML = safeClipboardHtml(html)
  const trs = [...div.querySelectorAll('table tr, tr')]
  const matrix = []
  /** @type {{ row: number, col: number, dataUrl: string }[]} */
  const images = []

  for (const tr of trs) {
    const cells = [...tr.querySelectorAll('th, td')]
    if (!cells.length) continue

    const row = []
    const rowImages = []
    cells.forEach((cell, colIdx) => {
      const dataUrl = extractCellImageDataUrl(cell)
      if (dataUrl) rowImages.push({ col: colIdx, dataUrl })
      row.push(getClipboardCellText(cell))
    })

    const hasImage = rowImages.length > 0
    if (!hasImage && isBlankMatrixRow(row)) continue

    const rowIdx = matrix.length
    matrix.push(row)
    for (const im of rowImages) {
      images.push({ row: rowIdx, col: im.col, dataUrl: im.dataUrl })
    }
  }

  return { matrix: sanitizePasteMatrix(matrix), images }
}

export function readClipboardHtml(data) {
  if (!data || typeof data.getData !== 'function') return ''
  try {
    return data.getData('text/html') || ''
  } catch {
    return ''
  }
}

/** 剪贴板 → 文本网格 + 单元格图片（相对网格坐标） */
export function clipboardPastePayload(data) {
  const grid = clipboardToPasteMatrix(data)
  const html = readClipboardHtml(data)
  const rich = html ? parseHtmlClipboardRichMatrix(html) : { matrix: [], images: [] }

  let finalGrid = grid.length ? grid : rich.matrix
  let images = [...rich.images]

  if (grid.length && rich.images.length) {
    if (rich.matrix.length === grid.length) {
      images = rich.images
    } else {
      images = rich.images.filter((im) => im.row < grid.length)
    }
  } else if (!grid.length && rich.matrix.length) {
    finalGrid = rich.matrix
  }

  return { grid: finalGrid, images }
}

/** 清理 Excel/HTML 粘贴单元格：去掉段落缩进、软换行多余空格 */
export function normalizeMultilineCellText(text) {
  let t = String(text ?? '').replace(/\uFEFF/, '').replace(/\u00a0/g, ' ')
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const lines = t.split('\n')
  if (lines.length <= 1) {
    return t.trim()
  }

  const indents = lines.slice(1)
    .filter((line) => line.trim())
    .map((line) => (line.match(/^(\s+)/) || ['', ''])[1].length)
  if (indents.length) {
    const common = Math.min(...indents)
    if (common > 0) {
      t = lines
        .map((line, i) => {
          if (i === 0) return line.trimEnd()
          return line.length >= common ? line.slice(common) : line
        })
        .join('\n')
    }
  }

  // Excel 自动换行软断行：「Sen Yu」+ 换行 + 「Ni」→ 合并为空格
  t = t.replace(/\n +(?=\S)/g, ' ')

  const finalLines = t.split('\n')
  if (finalLines.length === 2) {
    const head = finalLines[0].trimEnd()
    const tail = finalLines[1].trim()
    if (head && tail && head.length < 80 && !/^[\d"'(]/.test(tail)) {
      return `${head} ${tail}`.trim()
    }
  }

  return t.trim()
}

function tryParseQuotedPlainCell(plain) {
  const raw = plain.replace(/^\uFEFF/, '')
  const trimmed = raw.trim()
  if (!trimmed.startsWith('"')) return null

  const matrix = parseTSVExcel(raw)
  if (matrix.length === 1 && matrix[0].length === 1) {
    return [[normalizeMultilineCellText(matrix[0][0])]]
  }

  if (trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1).replace(/""/g, '"')
    return [[normalizeMultilineCellText(inner)]]
  }

  return null
}

/** HTML 表格中只有 1 个单元格 → 单个多行单元格（保留换行） */
function parseHtmlSingleCellMatrix(html) {
  if (!html || !/<(table|tr|td|th)/i.test(html)) return null
  const div = document.createElement('div')
  div.innerHTML = safeClipboardHtml(html)
  const cells = [...div.querySelectorAll('td, th')]
  if (cells.length !== 1) return null
  return [[getClipboardCellText(cells[0])]]
}

function parseHtmlClipboardSingleRow(html) {
  if (!html || !/<(table|tr|td|th)/i.test(html)) return null
  const div = document.createElement('div')
  div.innerHTML = safeClipboardHtml(html)
  const trs = [...div.querySelectorAll('table tr, tr')].filter((tr) => {
    const cells = [...tr.querySelectorAll('th,td')]
    return cells.some((el) => getClipboardCellText(el).trim() !== '')
  })
  if (trs.length !== 1) return null
  const cells = [...trs[0].querySelectorAll('th,td')].map((el) => getClipboardCellText(el))
  return cells.length ? cells : null
}

function parseHtmlClipboardMatrix(html) {
  if (!html || !/<(table|tr|td|th)/i.test(html)) return null
  const div = document.createElement('div')
  div.innerHTML = safeClipboardHtml(html)
  const trs = div.querySelectorAll('table tr, tr')
  if (!trs?.length) return null

  const matrix = []
  for (const tr of trs) {
    const cells = [...tr.querySelectorAll('th,td')].map((el) => getClipboardCellText(el))
    if (cells.length && !isBlankMatrixRow(cells)) matrix.push(cells)
  }
  return matrix.length ? matrix : null
}

/**
 * 纯文本剪贴板 → 二维矩阵。无 Tab 且含换行时，不在此处拆行（留给单格/TSV 引号逻辑）。
 */
export function parseClipboardPlainToMatrix(text) {
  const raw = String(text ?? '')
  if (!raw.trim()) return []

  if (raw.includes('\t')) {
    return parseTSVExcel(raw)
  }

  const hasLf = raw.includes('\n')
  const hasCr = raw.includes('\r')

  // Excel 复制单行多列：cell1\rcell2\rcell3（无 \t、无 \n）
  if (!hasLf && hasCr) {
    const cells = raw.split(/\r+/).map((s) => s.replace(/\u00a0/g, ' '))
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.length > 1) return [cells]
  }

  // 引号包裹的多行单格
  if (raw.trim().startsWith('"')) {
    const quoted = parseTSVExcel(raw)
    if (quoted.length === 1 && quoted[0].length === 1) {
      return quoted
    }
  }

  // 无 Tab 的多行 plain：默认整块为单个单元格（Excel 单格内换行）
  if (hasLf || hasCr) {
    return [[normalizeMultilineCellText(raw)]]
  }

  return [[raw.replace(/\u00a0/g, ' ').trim()]]
}

/**
 * 从剪贴板解析为粘贴矩阵（行×列），供 spreadsheet 使用。
 */
export function readClipboardPlainText(data) {
  if (!data || typeof data.getData !== 'function') return ''
  let plain = ''
  try {
    plain = data.getData('text/plain') || ''
  } catch {
    // ignore
  }
  if (!plain.trim()) {
    try {
      plain = data.getData('text/csv') || ''
    } catch {
      // ignore
    }
  }
  return plain.replace(/^\uFEFF/, '')
}

export function clipboardToPasteMatrix(data) {
  if (!data || typeof data.getData !== 'function') return []

  const plain = readClipboardPlainText(data)

  let html = ''
  try {
    html = data.getData('text/html') || ''
  } catch {
    // ignore
  }

  // 多列结构：Tab 分隔
  if (plain.includes('\t')) {
    return sanitizePasteMatrix(parseTSVExcel(plain))
  }

  // Excel 单格多行：plain 常以引号包裹
  const quotedCell = tryParseQuotedPlainCell(plain)
  if (quotedCell) return quotedCell

  // HTML 仅 1 个 td → 单个多行单元格
  const htmlSingleCell = html ? parseHtmlSingleCellMatrix(html) : null
  if (htmlSingleCell) return sanitizePasteMatrix(htmlSingleCell)

  const plainCore = plain.replace(/\uFEFF/, '').replace(/\u00a0/g, ' ')
  if (plainCore.trim() && !/[\r\n]/.test(plainCore)) {
    return [[plainCore.trim()]]
  }

  // HTML 仅 1 行多列
  const singleHtmlRow = html ? parseHtmlClipboardSingleRow(html) : null
  if (singleHtmlRow?.length) {
    return sanitizePasteMatrix([singleHtmlRow])
  }

  const htmlMatrix = html ? sanitizePasteMatrix(parseHtmlClipboardMatrix(html)) : null

  // HTML 为 N 行×1 列：若第 2 行起有共同缩进，多为单格内 <p> 段落，合并为一个单元格
  if (htmlMatrix?.length > 1 && htmlMatrix.every((r) => r.length === 1)) {
    const texts = htmlMatrix.map((r) => r[0])
    const indents = texts.slice(1)
      .filter((t) => String(t).trim())
      .map((t) => (String(t).match(/^(\s+)/) || ['', ''])[1].length)
    if (indents.length && Math.min(...indents) > 0) {
      return [[normalizeMultilineCellText(texts.join('\n'))]]
    }
  }

  // HTML 为 N 行×1 列且无缩进：整列粘贴（每行一个单元格）
  if (htmlMatrix?.length && htmlMatrix.every((r) => r.length === 1)) {
    const rowCount = htmlMatrix.length
    const trs = html ? (() => {
      const div = document.createElement('div')
      div.innerHTML = safeClipboardHtml(html)
      return [...div.querySelectorAll('table tr, tr')].filter((tr) => {
        const cells = [...tr.querySelectorAll('th,td')]
        return cells.some((el) => getClipboardCellText(el).trim() !== '')
      })
    })() : []
    if (rowCount > 1 && trs.length === rowCount) {
      return htmlMatrix
    }
  }

  // 其余：plain 无 Tab 时整块作为单格（含换行）
  return sanitizePasteMatrix(parseClipboardPlainToMatrix(plain))
}

/** 从 ClipboardEvent 取 TSV（纯文本或 HTML 表格） */
export function clipboardDataToTSV(data) {
  const matrix = clipboardToPasteMatrix(data)
  if (!matrix.length) return null
  return matrix.map((row) => row.join('\t')).join('\n')
}

export function isMultiCellClipboard(data) {
  const t = clipboardDataToTSV(data)
  if (t && t.includes('\t')) return true
  const { grid, images } = clipboardPastePayload(data)
  if (images.length) return true
  if (grid.length > 1) return true
  return !!(grid.length === 1 && grid[0].length > 1)
}

export function parsePastePayloadFromClipboard(data, columns = COLUMNS) {
  const { grid, images } = clipboardPastePayload(data)
  if (!grid.length) return { rows: [], images: [], usedHeader: false }

  const firstCells = grid[0]?.map((c) => String(c ?? '').trim()) ?? []
  const usedHeader = firstRowMatchesColumnTitles(firstCells, columns)
  let rows
  let adjustedImages = images

  if (usedHeader) {
    const headers = firstCells
    rows = grid.slice(1)
      .filter((row) => !rowMatrixIsEmpty(row))
      .map((cells) => {
        const record = {}
        headers.forEach((h, j) => {
          if (h) record[h] = cells[j] != null ? String(cells[j]) : ''
        })
        return record
      })
    adjustedImages = images
      .filter((im) => im.row > 0)
      .map((im) => ({ ...im, row: im.row - 1 }))
  } else {
    rows = sliceDataCellMatrix(grid).map((cells) => rowFromValues(cells, columns))
    const skippedHeader = grid.length > rows.length && grid[0]
    if (skippedHeader && String(grid[0][0] || '').replace(/\s/g, '') === '介绍') {
      adjustedImages = images
        .filter((im) => im.row > 0)
        .map((im) => ({ ...im, row: im.row - 1 }))
    }
  }

  return { rows, images: adjustedImages, usedHeader }
}

function rowMatrixIsEmpty(cells) {
  if (!cells?.length) return true
  return cells.every((c) => !String(c || '').trim())
}

function sliceDataCellMatrix(matrix) {
  if (!matrix?.length) return []
  let start = 0
  if (matrix[0].length && String(matrix[0][0]).replace(/\s/g, '') === '介绍') {
    start = 1
  }
  return matrix.slice(start).filter((row) => !rowMatrixIsEmpty(row))
}

export function rowFromValues(cells, columns = COLUMNS) {
  const row = {}
  for (let i = 0; i < columns.length; i++) {
    row[columns[i]] = cells[i] != null ? String(cells[i]) : ''
  }
  return row
}

export function parseDataCellRowsFromTSVText(text) {
  return sliceDataCellMatrix(parseTSVExcel(text))
}

export function parseDataRowsFromTSVText(text, columns = COLUMNS) {
  return parseDataCellRowsFromTSVText(text).map((cells) => rowFromValues(cells, columns))
}

export function parseDataRowsFromClipboard(data, columns = COLUMNS) {
  const tsv = clipboardDataToTSV(data)
  if (!tsv) return []
  return parseDataRowsFromTSVText(tsv, columns)
}

function firstRowMatchesColumnTitles(firstCells, columns) {
  if (!columns.length || !firstCells.length) return false
  let matches = 0
  for (let i = 0; i < Math.min(firstCells.length, columns.length); i++) {
    if (String(firstCells[i] || '').trim() === columns[i]) matches += 1
    else break
  }
  return matches >= Math.min(3, columns.length)
}

/** 粘贴 TSV/CSV 文本解析为行数据 */
export function parsePastedText(text, columns = COLUMNS) {
  const matrix = parseDataCellRowsFromTSVText(text)
  if (matrix.length === 0) return []

  const firstCells = parseTSVExcel(text)[0]?.map((c) => c.trim()) ?? []
  const hasHeader = firstRowMatchesColumnTitles(firstCells, columns)

  if (hasHeader) {
    const headers = firstCells
    const data = []
    for (const cells of matrix) {
      const record = {}
      headers.forEach((h, j) => {
        if (h) record[h] = cells[j] != null ? String(cells[j]) : ''
      })
      data.push(record)
    }
    return data
  }

  return matrix.map((cells) => rowFromValues(cells, columns))
}

export function emptyRow(columns = COLUMNS) {
  return Object.fromEntries(columns.map((c) => [c, '']))
}
