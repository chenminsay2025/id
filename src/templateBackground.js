import { normalizePageSizeMm } from './pageSize.js'

export const TEMPLATE_BACKGROUND_KEY = '__templateBackground'
/** 与 TEMPLATE_BACKGROUND_KEY 相同；旧版曾用 __templateBg 作 overlay id */
export const TEMPLATE_BACKGROUND_BOX_ID = TEMPLATE_BACKGROUND_KEY
export const TEMPLATE_BACKGROUND_LEGACY_BOX_ID = '__templateBg'

/** layout_overrides 中的底图元数据键，不是普通编辑框 */
export function isTemplateBackgroundMetaKey(key) {
  return key === TEMPLATE_BACKGROUND_KEY || key === TEMPLATE_BACKGROUND_LEGACY_BOX_ID
}

const SOURCE_W = 841.89
const SOURCE_H = 595.28

function hasBox(layout) {
  return (
    layout?.boxLeft != null
    && layout?.boxRight != null
    && layout?.boxTop != null
    && layout?.boxBottom != null
  )
}

/** @returns {{ locked: boolean, boxLeft: number, boxRight: number, boxTop: number, boxBottom: number }} */
export function getDefaultTemplateBackground(pageWidthMm, pageHeightMm) {
  const dims = pageWidthMm != null
    ? previewStageDimensionsForPage(pageWidthMm, pageHeightMm)
    : { width: SOURCE_W, height: SOURCE_H }
  return {
    locked: true,
    boxLeft: 0,
    boxTop: 0,
    boxRight: dims.width,
    boxBottom: dims.height,
  }
}

/** @param {object} layoutOverrides @param {number} [pageWidthMm] @param {number} [pageHeightMm] */
export function getTemplateBackground(layoutOverrides = {}, pageWidthMm, pageHeightMm) {
  const artboard = pageWidthMm != null
    ? previewStageDimensionsForPage(pageWidthMm, pageHeightMm)
    : { width: SOURCE_W, height: SOURCE_H }
  const stored = layoutOverrides?.[TEMPLATE_BACKGROUND_KEY]
  const defaults = getDefaultTemplateBackground(pageWidthMm, pageHeightMm)
  if (!stored || typeof stored !== 'object') return defaults
  const locked = stored.locked !== false
  if (locked) {
    return {
      locked: true,
      boxLeft: 0,
      boxTop: 0,
      boxRight: artboard.width,
      boxBottom: artboard.height,
    }
  }
  if (!hasBox(stored)) {
    return { ...defaults, locked: false }
  }
  return {
    locked: false,
    boxLeft: Number(stored.boxLeft),
    boxTop: Number(stored.boxTop),
    boxRight: Number(stored.boxRight),
    boxBottom: Number(stored.boxBottom),
  }
}

/** @param {object} layoutOverrides */
export function isTemplateBackgroundLocked(layoutOverrides = {}) {
  return getTemplateBackground(layoutOverrides).locked !== false
}

/** @param {object} layoutOverrides @param {boolean} locked @param {number} [pageWidthMm] @param {number} [pageHeightMm] */
export function withTemplateBackgroundLock(layoutOverrides, locked, pageWidthMm, pageHeightMm) {
  const bg = getTemplateBackground(layoutOverrides, pageWidthMm, pageHeightMm)
  const nextBg = locked
    ? { ...getDefaultTemplateBackground(pageWidthMm, pageHeightMm), locked: true }
    : { ...bg, locked: false }
  return { ...layoutOverrides, [TEMPLATE_BACKGROUND_KEY]: nextBg }
}

/** 预览区宽高比：保持 viewBox 宽度，按页面 mm 比例调整高度 */
export function previewStageHeightForPage(pageWidthMm, pageHeightMm) {
  const { pageWidthMm: w, pageHeightMm: h } = normalizePageSizeMm(pageWidthMm, pageHeightMm)
  return SOURCE_W * (h / w)
}

export function previewStageDimensionsForPage(pageWidthMm, pageHeightMm) {
  return {
    width: SOURCE_W,
    height: previewStageHeightForPage(pageWidthMm, pageHeightMm),
  }
}

export function applySvgPageDimensions(svgRoot, pageWidthMm, pageHeightMm) {
  const { pageWidthMm: w, pageHeightMm: h } = normalizePageSizeMm(pageWidthMm, pageHeightMm)
  const dims = previewStageDimensionsForPage(w, h)
  svgRoot.setAttribute('width', `${w}mm`)
  svgRoot.setAttribute('height', `${h}mm`)
  svgRoot.setAttribute('viewBox', `0 0 ${dims.width} ${dims.height}`)
}

export { SOURCE_W as TEMPLATE_SOURCE_WIDTH, SOURCE_H as TEMPLATE_SOURCE_HEIGHT }

const TEMPLATE_SOURCE_VIEWBOX_ATTR = 'data-template-source-viewbox'

function parseViewBoxNumbers(raw) {
  if (!raw) return null
  const parts = raw.trim().split(/[\s,]+/).map(Number)
  if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
    return {
      minX: Number.isFinite(parts[0]) ? parts[0] : 0,
      minY: Number.isFinite(parts[1]) ? parts[1] : 0,
      width: parts[2],
      height: parts[3],
    }
  }
  return null
}

/** 首次从模板字符串解析后写入，避免 applySvgPageDimensions 覆盖 viewBox 后丢失原始尺寸 */
export function cacheTemplateSourceDimensions(svgRoot) {
  if (!svgRoot || svgRoot.getAttribute(TEMPLATE_SOURCE_VIEWBOX_ATTR)) return
  const w = parseFloat(svgRoot.getAttribute('width') || '')
  const h = parseFloat(svgRoot.getAttribute('height') || '')
  const dims = parseViewBoxNumbers(svgRoot.getAttribute('viewBox'))
    || (w > 0 && h > 0 ? { minX: 0, minY: 0, width: w, height: h } : null)
    || { minX: 0, minY: 0, width: SOURCE_W, height: SOURCE_H }
  svgRoot.setAttribute(
    TEMPLATE_SOURCE_VIEWBOX_ATTR,
    `${dims.minX} ${dims.minY} ${dims.width} ${dims.height}`,
  )
}

/** 读取 SVG 模板原始 viewBox，用于底图缩放（勿用 applySvgPageDimensions 后的画板 viewBox） */
export function resolveTemplateSourceDimensions(svgRoot) {
  const cached = parseViewBoxNumbers(svgRoot?.getAttribute?.(TEMPLATE_SOURCE_VIEWBOX_ATTR))
  if (cached) return cached

  const fromViewBox = parseViewBoxNumbers(svgRoot?.getAttribute?.('viewBox'))
  if (fromViewBox) return fromViewBox

  const w = parseFloat(svgRoot?.getAttribute?.('width') || '')
  const h = parseFloat(svgRoot?.getAttribute?.('height') || '')
  if (w > 0 && h > 0) {
    return { minX: 0, minY: 0, width: w, height: h }
  }
  return { minX: 0, minY: 0, width: SOURCE_W, height: SOURCE_H }
}
