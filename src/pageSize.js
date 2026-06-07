export const DEFAULT_PAGE_WIDTH_MM = 297
export const DEFAULT_PAGE_HEIGHT_MM = 210
export const MM_TO_PT = 72 / 25.4

/** @returns {{ pageWidthMm: number, pageHeightMm: number }} */
export function normalizePageSizeMm(widthMm, heightMm) {
  const w = Number(widthMm)
  const h = Number(heightMm)
  return {
    pageWidthMm: Number.isFinite(w) && w > 0 ? w : DEFAULT_PAGE_WIDTH_MM,
    pageHeightMm: Number.isFinite(h) && h > 0 ? h : DEFAULT_PAGE_HEIGHT_MM,
  }
}

export function mmToPt(mm) {
  return mm * MM_TO_PT
}

/** @returns {{ pageWidthMm: number, pageHeightMm: number, pageWidthPt: number, pageHeightPt: number }} */
export function resolvePageSizePt(exportOptions = {}) {
  const { pageWidthMm, pageHeightMm } = normalizePageSizeMm(
    exportOptions.pageWidthMm ?? exportOptions.page_width_mm,
    exportOptions.pageHeightMm ?? exportOptions.page_height_mm,
  )
  return {
    pageWidthMm,
    pageHeightMm,
    pageWidthPt: mmToPt(pageWidthMm),
    pageHeightPt: mmToPt(pageHeightMm),
  }
}

/** @param {{ page_width_mm?: number, page_height_mm?: number } | null | undefined} preset */
export function pageSizeFromPreset(preset) {
  return normalizePageSizeMm(preset?.page_width_mm, preset?.page_height_mm)
}
