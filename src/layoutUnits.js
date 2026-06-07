import { previewStageDimensionsForPage } from './templateBackground.js'
import { normalizePageSizeMm } from './pageSize.js'

/** @returns {{ width: number, height: number }} SVG 用户坐标系下的画板尺寸 */
export function getArtboardSvgDimensions(pageWidthMm, pageHeightMm) {
  return previewStageDimensionsForPage(pageWidthMm, pageHeightMm)
}

/** SVG 用户单位 → mm（x/宽 用页宽，y/高 用页高） */
export function svgUserUnitsToMm(value, axis, pageWidthMm, pageHeightMm) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  const { pageWidthMm: w, pageHeightMm: h } = normalizePageSizeMm(pageWidthMm, pageHeightMm)
  const { width, height } = getArtboardSvgDimensions(w, h)
  if (axis === 'x' || axis === 'w') return n * w / width
  return n * h / height
}

/** mm → SVG 用户单位 */
export function mmToSvgUserUnits(value, axis, pageWidthMm, pageHeightMm) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  const { pageWidthMm: w, pageHeightMm: h } = normalizePageSizeMm(pageWidthMm, pageHeightMm)
  const { width, height } = getArtboardSvgDimensions(w, h)
  if (axis === 'x' || axis === 'w') return n * width / w
  return n * height / h
}

export function formatMmBoundInput(value) {
  if (value == null || Number.isNaN(value)) return ''
  const n = Number(value)
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}
