import {
  COLUMNS,
  clipboardPastePayload,
  clipboardToPasteMatrix,
  parseClipboardPlainToMatrix,
  readClipboardHtml,
  readClipboardPlainText,
} from './svgEngine.js'
import {
  isImageCellValue,
  imageCellUrl,
  formatImageCellValue,
  IMAGE_CELL_ROW_HEIGHT_PX,
} from './cellMedia.js'
import { isDispImgFormula } from './excelEmbeddedImages.js'
import {
  collectClipboardImageFiles,
  readClipboardImageFilesAsync,
  pickWpsEmbeddedImageFile,
} from './clipboardPasteImport.js'
import { normalizeSearchText } from './searchNormalize.js'
import {
  buildColumnWidthsFromStorage,
  persistColumnWidths,
  clampColumnWidth,
  getDefaultColumnWidth,
} from './columnWidthStorage.js'
import { clampRowHeight, DEFAULT_ROW_HEIGHT } from './rowHeightUtils.js'

/** 序号列（#）固定宽度 */
export const ROW_HEAD_WIDTH_PX = 32

/**
 * 虚拟滚动默认关闭：大行数时仅渲染可见行会导致点击选格不稳定。
 * 保留单元格图片 IntersectionObserver 懒加载即可。
 * 若以后要恢复，将 ENABLE_VIRTUAL_ROWS 设为 true。
 */
const ENABLE_VIRTUAL_ROWS = false
const VIRTUAL_ROW_THRESHOLD = 100
const VIRTUAL_OVERSCAN = 12

/**
 * 可编辑数据表：单击/拖拽选区、双击编辑、方向键、Excel 粘贴。
 * @param {HTMLElement} container
 * @param {{
 *   getData: () => Record<string, string>[],
 *   setData: (rows: Record<string, string>[]) => void,
 *   getSelectedRow: () => number,
 *   setSelectedRow: (i: number) => void,
 *   getPreviewDisplayedRow?: () => number,
 *   getSelectedCol?: () => number,
 *   setSelectedCol?: (i: number) => void,
 *   readOnly?: boolean,
 *   onCellChange?: (rowIndex: number, col: string, value: string) => void,
 *   onCellFocus?: (rowIndex: number, col: string, colIndex: number) => void,
 *   onSelectionClear?: () => void,
 *   onBlankAreaPointerDown?: () => void,
 *   onRowSelect?: (rowIndex: number) => void,
 *   onColumnSelect?: (colIndex: number, colName: string) => void,
 *   onCellSelect?: (rowIndex: number, colName: string, colIndex: number) => void,
 *   parsePaste?: (text: string) => Record<string, string>[],
 *   onAddRowBelow?: (rowIndex: number) => void,
 *   onDeleteRow?: (rowIndex: number) => void,
 *   onDeleteRows?: (startRow: number, endRow: number) => void,
 *   onAddColumnRight?: (colIndex: number) => void,
 *   onDeleteColumn?: (colIndex: number) => void,
 *   onEditCommit?: () => void,
 *   onTableHistoryCommit?: () => void,
 *   getColumns?: () => string[],
 *   onReorderColumn?: (fromIndex: number, toIndex: number) => void,
 *   onRenameColumn?: (colIndex: number, oldName: string, newName: string) => void,
 *   onSetCellImage?: (rowIndex: number, colIndex: number, file: File | Blob) => Promise<void>,
 *   onPasteImageUnavailable?: () => void,
 *   onImportClipboardTable?: (clipboardData: DataTransfer, anchor: { startRow: number, startCol: number }) => Promise<boolean>,
 *   onPositionalPaste?: (info: { startRow: number, startCol: number, rowCount: number, colCount: number }) => void,
 *   onEnsureRowCount?: (count: number) => void,
 *   onPasteTrimRows?: (count: number) => void,
 *   syncDataAfterPaste?: boolean,
 *   documentPasteScope?: string | (() => boolean),
 *   getRowHeights?: () => Record<string, number>,
 *   onRowHeightsChange?: (heights: Record<string, number>, meta?: { persist?: boolean }) => void,
 *   getDefaultRowHeight?: () => number,
 *   getTrailingColumns?: () => Array<{ id: string, label: string, width?: number }>,
 *   renderTrailingColHead?: (metaCol: { id: string, label: string, width?: number }, metaIndex: number, colIndex: number) => string,
 *   renderTrailingCell?: (rowIndex: number, metaCol: { id: string, label: string, width?: number }, metaIndex: number, colIndex: number) => string,
 *   wireTrailingControls?: (container: HTMLElement) => void,
 * }} options
 */
export function mountSpreadsheetTable(container, options) {
  container.classList.add('spreadsheet-wrap')
  if (options.readOnly) container.classList.add('spreadsheet-wrap--readonly')

  /** @type {{ anchorRow: number, anchorCol: number, focusRow: number, focusCol: number }} */
  let selection = { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 }
  let selectionActive = true
  /** @type {{ row: number, col: number, colName: string }[]} */
  let searchMatches = []
  let searchMatchIndex = -1
  let searchQuery = ''
  /** @type {{ row: number, col: number } | null} */
  let editing = null
  /** 双击进入编辑后延迟定位光标；用户在 rAF 前点击时应取消 */
  let caretPlacementRaf = 0
  let isDragging = false
  let isFillDragging = false
  /** @type {{ r1: number, r2: number, c1: number, c2: number } | null} */
  let fillSourceBounds = null
  let interactionWired = false
  let readOnlyChromeWired = false
  /** @type {HTMLElement | null} */
  let selectionOverlay = null
  /** @type {HTMLElement | null} */
  let contextMenuEl = null
  let colHeadDropdownEl = null
  /** @type {HTMLElement | null} */
  let openColHeadMenuTh = null
  /** @type {number[] | null} */
  let columnWidths = null
  let scrollRaf = 0
  /** @type {HTMLInputElement | null} */
  let imageFileInput = null
  let imagePickRow = 0
  let imagePickCol = 0
  let colResizeIndex = null
  let colResizeStartX = 0
  let colResizeStartW = 0
  let colResizeSaveTimer = 0
  let isRowHeadDragging = false
  let rowHeadDragStartRow = 0
  let rowHeadDragMoved = false
  let isColHeadDragging = false
  let colHeadDragStartCol = 0
  let colHeadDragMoved = false
  /** @type {number[] | null} */
  let rowResizeTargets = null
  let rowResizeStartY = 0
  /** @type {Record<string, number>} */
  let rowResizeStartHeights = {}
  /** @type {Record<string, number> | null} */
  let rowHeightsOverride = null
  /** @type {{ row: number, wasPersisted: boolean } | null} */
  let editRowHeightLock = null
  let useVirtualRows = false
  /** @type {{ start: number, end: number }} */
  let virtualRange = { start: 0, end: 0 }
  let virtualScrollRaf = 0
  /** 行高前缀和缓存版本（行数/行高变化时递增） */
  let rowGeometryVersion = 0
  /** @type {{ version: number, length: number, offsets: number[] } | null} */
  let rowGeometryCache = null
  /** @type {Map<number, boolean>} */
  const imageRowCache = new Map()
  let cellEditorsDelegated = false
  let rowResizersDelegated = false
  let rowHeadPointerDelegated = false
  let pointerSelectionCaptureWired = false
  let syncPreviewRaf = 0
  let lastRenderedDataLen = -1
  /** @type {IntersectionObserver | null} */
  let lazyImageObserver = null
  /** 本会话已加载过的单元格图片 URL（虚拟滚动重绘时直接复用，不重复懒加载） */
  const loadedCellImageSrcs = new Set()
  /** @type {{ x: number, y: number, ri: number, ci: number } | null} */
  let cellPointerDown = null
  /** @type {Map<string, { r: number, c: number }> | null} */
  let disjointCells = null
  /** @type {{ x: number, y: number } | null} */
  let autoScrollPointer = null
  let autoScrollRaf = 0
  const AUTO_SCROLL_EDGE_PX = 36
  const AUTO_SCROLL_MAX_SPEED = 18
  let disposed = false
  /** @type {((e: ClipboardEvent) => void) | null} */
  let documentPasteHandler = null

  function getTrailingColumns() {
    return options.getTrailingColumns?.() ?? []
  }

  function getDataColumnCount() {
    return getColumns().length
  }

  function getColumns() {
    if (options.getColumns) return options.getColumns()
    const data = options.getData()
    if (!data.length) return [...COLUMNS]
    const keys = new Set()
    for (const row of data) {
      for (const k of Object.keys(row)) keys.add(k)
    }
    const merged = [...COLUMNS]
    for (const k of keys) {
      if (!merged.includes(k)) merged.push(k)
    }
    return merged
  }

  function cellSearchableText(val) {
    if (val == null) return ''
    const s = String(val).trim()
    if (!s) return ''
    if (isImageCellValue(s)) {
      const url = imageCellUrl(s)
      const base = url.split('/').pop() || ''
      return normalizeSearchText(`${url} ${base}`)
    }
    return normalizeSearchText(s)
  }

  function rebuildSearchMatches() {
    const q = normalizeSearchText(searchQuery)
    if (!q) {
      searchMatches = []
      searchMatchIndex = -1
      return
    }
    const data = options.getData()
    const cols = getColumns()
    /** @type {{ row: number, col: number, colName: string }[]} */
    const next = []
    data.forEach((row, ri) => {
      cols.forEach((col, ci) => {
        if (cellSearchableText(row[col]).includes(q)) {
          next.push({ row: ri, col: ci, colName: col })
        }
      })
    })
    searchMatches = next
    searchMatchIndex = next.length ? 0 : -1
  }

  function applySearchHighlights() {
    container.querySelectorAll('td.spreadsheet-cell[data-row][data-col-idx]').forEach((cell) => {
      const ri = Number(cell.dataset.row)
      const ci = Number(cell.dataset.colIdx)
      const isHit = searchMatches.some((m) => m.row === ri && m.col === ci)
      const current = searchMatchIndex >= 0 && searchMatches[searchMatchIndex]
      const isCurrent = isHit && current?.row === ri && current?.col === ci
      cell.classList.toggle('spreadsheet-cell--search-hit', isHit)
      cell.classList.toggle('spreadsheet-cell--search-current', isCurrent)
    })
  }

  function getSearchState() {
    return {
      query: searchQuery,
      total: searchMatches.length,
      current: searchMatchIndex >= 0 ? searchMatchIndex + 1 : 0,
    }
  }

  function focusSearchMatch(index) {
    if (!searchMatches.length) {
      applySearchHighlights()
      return getSearchState()
    }
    const len = searchMatches.length
    searchMatchIndex = ((index % len) + len) % len
    const m = searchMatches[searchMatchIndex]
    applySearchHighlights()
    scrollToCell(m.row, m.col, { moveSelection: true })
    options.onCellFocus?.(m.row, m.colName, m.col)
    return getSearchState()
  }

  function setSearchQuery(q, { focusMatch = false } = {}) {
    searchQuery = String(q || '')
    rebuildSearchMatches()
    if (searchMatches.length) {
      if (focusMatch) {
        focusSearchMatch(0)
      } else {
        searchMatchIndex = 0
        applySearchHighlights()
        const m = searchMatches[0]
        scrollToCell(m.row, m.col, { moveSelection: false })
      }
    } else {
      applySearchHighlights()
    }
    return getSearchState()
  }

  function gotoNextSearchMatch() {
    if (!searchMatches.length) return getSearchState()
    return focusSearchMatch(searchMatchIndex + 1)
  }

  function gotoPrevSearchMatch() {
    if (!searchMatches.length) return getSearchState()
    return focusSearchMatch(searchMatchIndex - 1)
  }

  function invalidateRowGeometry() {
    rowGeometryVersion += 1
    rowGeometryCache = null
    imageRowCache.clear()
  }

  function rowHasImageCell(rowIndex) {
    if (imageRowCache.has(rowIndex)) return imageRowCache.get(rowIndex)
    const row = options.getData()[rowIndex]
    if (!row) {
      imageRowCache.set(rowIndex, false)
      return false
    }
    for (const col of getColumns()) {
      if (isImageCellValue(row[col])) {
        imageRowCache.set(rowIndex, true)
        return true
      }
    }
    imageRowCache.set(rowIndex, false)
    return false
  }

  function ensureRowOffsets(dataLength) {
    if (
      rowGeometryCache
      && rowGeometryCache.version === rowGeometryVersion
      && rowGeometryCache.length === dataLength
    ) {
      return rowGeometryCache.offsets
    }
    const offsets = new Array(dataLength + 1)
    offsets[0] = 0
    for (let i = 0; i < dataLength; i++) {
      offsets[i + 1] = offsets[i] + getRowHeightPx(i)
    }
    rowGeometryCache = { version: rowGeometryVersion, length: dataLength, offsets }
    return offsets
  }

  function lowerBoundOffset(offsets, value) {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (offsets[mid] < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  function rememberLoadedCellImageSrc(src) {
    const url = String(src || '').trim()
    if (url) loadedCellImageSrcs.add(url)
  }

  function isCellImageSrcCached(src) {
    return loadedCellImageSrcs.has(String(src || '').trim())
  }

  function activateCellImage(img) {
    if (!(img instanceof HTMLImageElement)) return
    const src = String(img.dataset.src || '').trim()
    if (!src || img.classList.contains('is-loaded')) return
    if (isCellImageSrcCached(src)) {
      img.src = src
      img.classList.add('is-loaded')
      lazyImageObserver?.unobserve(img)
      return
    }
    const finish = () => {
      rememberLoadedCellImageSrc(src)
      lazyImageObserver?.unobserve(img)
    }
    img.addEventListener('load', finish, { once: true })
    img.addEventListener('error', () => lazyImageObserver?.unobserve(img), { once: true })
    img.src = src
    img.classList.add('is-loaded')
  }

  function hydrateCachedCellImage(img) {
    if (!(img instanceof HTMLImageElement)) return false
    const src = String(img.dataset.src || '').trim()
    if (!src || !isCellImageSrcCached(src)) return false
    activateCellImage(img)
    return true
  }

  function formatCellContent(val) {
    if (isImageCellValue(val)) {
      const src = escapeAttr(imageCellUrl(val))
      const cached = isCellImageSrcCached(src)
      const loadedClass = cached ? ' is-loaded' : ''
      const srcAttr = cached ? ` src="${src}"` : ''
      const lazyAttr = cached ? '' : ` data-src="${src}"`
      return (
        '<span class="spreadsheet-cell-img-slot">'
        + `<img class="spreadsheet-cell-img${loadedClass}"${lazyAttr}${srcAttr} alt="" draggable="false" decoding="async" />`
        + '</span>'
      )
    }
    return escapeHtml(val)
  }

  function ensureLazyImageObserver() {
    if (lazyImageObserver) return lazyImageObserver
    lazyImageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const img = entry.target
        if (!(img instanceof HTMLImageElement)) continue
        activateCellImage(img)
      }
    }, { root: container, rootMargin: '200px 0px', threshold: 0.01 })
    return lazyImageObserver
  }

  function observeCellImageIfNeeded(img) {
    if (!(img instanceof HTMLImageElement)) return
    if (img.classList.contains('is-loaded')) return
    if (hydrateCachedCellImage(img)) return
    ensureLazyImageObserver().observe(img)
  }

  function wireLazyCellImages(root = container) {
    root.querySelectorAll('img.spreadsheet-cell-img:not(.is-loaded)').forEach((img) => {
      observeCellImageIfNeeded(img)
    })
  }

  function sumRowHeightsPx(fromIncl, toIncl) {
    if (fromIncl > toIncl) return 0
    const dataLength = options.getData().length
    if (dataLength > VIRTUAL_ROW_THRESHOLD) {
      const offsets = ensureRowOffsets(dataLength)
      return offsets[toIncl + 1] - offsets[fromIncl]
    }
    let sum = 0
    for (let i = fromIncl; i <= toIncl; i++) sum += getRowHeightPx(i)
    return sum
  }

  function getRowOffsetTopPx(rowIndex) {
    return sumRowHeightsPx(0, Math.max(0, rowIndex - 1))
  }

  function computeVirtualRowRange(dataLength) {
    if (dataLength <= VIRTUAL_ROW_THRESHOLD) {
      return { start: 0, end: Math.max(0, dataLength - 1) }
    }
    const scrollTop = Math.max(0, container.scrollTop)
    const viewH = container.clientHeight || 600
    const bottom = scrollTop + viewH
    const offsets = ensureRowOffsets(dataLength)
    const firstVisible = Math.min(dataLength - 1, Math.max(0, lowerBoundOffset(offsets, scrollTop + 1) - 1))
    const lastVisible = Math.min(
      dataLength - 1,
      Math.max(0, lowerBoundOffset(offsets, bottom) - 1),
    )
    const start = Math.max(0, firstVisible - VIRTUAL_OVERSCAN)
    const end = Math.min(dataLength - 1, lastVisible + VIRTUAL_OVERSCAN)
    return { start, end: Math.max(start, end) }
  }

  function ensureVirtualRowVisible(rowIndex) {
    prepareVirtualRowForInteraction(rowIndex)
  }

  function scheduleVirtualScrollUpdate() {
    if (!useVirtualRows) return
    if (virtualScrollRaf) return
    virtualScrollRaf = requestAnimationFrame(() => {
      virtualScrollRaf = 0
      const dataLen = options.getData().length
      const next = computeVirtualRowRange(dataLen)
      if (next.start === virtualRange.start && next.end === virtualRange.end) return
      virtualRange = next
      patchVirtualTableBody()
    })
  }

  function buildVirtualSpacerRow(heightPx, colspan) {
    if (heightPx <= 0) return ''
    return `<tr class="spreadsheet-virtual-spacer" aria-hidden="true"><td colspan="${colspan}" style="height:${heightPx}px;padding:0;border:none;pointer-events:none;line-height:0;"></td></tr>`
  }

  function setCellDomContent(cell, val) {
    if (isImageCellValue(val)) {
      cell.innerHTML = formatCellContent(val)
      cell.dataset.imageCell = '1'
      const img = cell.querySelector('img.spreadsheet-cell-img')
      if (img) observeCellImageIfNeeded(img)
    } else {
      cell.textContent = val
      delete cell.dataset.imageCell
    }
  }

  function imageValueFromImgSrc(src) {
    const raw = String(src || '').trim()
    if (!raw) return ''
    try {
      const path = /^https?:\/\//i.test(raw) ? new URL(raw, window.location.origin).pathname : raw
      return formatImageCellValue(path)
    } catch {
      return formatImageCellValue(raw)
    }
  }

  function cellValueFromDom(cell) {
    const dataRef = options.getData()
    const ri = Number(cell.dataset.row)
    const col = cell.dataset.col
    const existing = dataRef[ri]?.[col]
    if (cell.dataset.imageCell === '1' && isImageCellValue(existing)) {
      return existing
    }
    const img = cell.querySelector('img.spreadsheet-cell-img')
    if (img) {
      const fromImg = imageValueFromImgSrc(img.getAttribute('src') || img.dataset.src || '')
      if (fromImg) return fromImg
    }
    const text = (cell.textContent || '').trim()
    if (/^(\/uploads\/|https?:\/\/).+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(text)) {
      return formatImageCellValue(text)
    }
    return text
  }

  function selectEntireColumn(colIndex, { extend = false } = {}) {
    clearDisjointSelection()
    selectionActive = true
    const data = options.getData()
    const cols = getColumns()
    const ci = Math.max(0, Math.min(colIndex, cols.length - 1))
    const maxR = Math.max(0, data.length - 1)
    if (extend) {
      const a = Math.min(selection.anchorCol, ci)
      const b = Math.max(selection.focusCol, ci)
      selection.anchorCol = a
      selection.focusCol = b
    } else {
      selection.anchorCol = ci
      selection.focusCol = ci
    }
    selection.anchorRow = 0
    selection.focusRow = maxR
    options.setSelectedCol?.(selection.focusCol)
    applySelectionVisuals()
    focusGrid()
  }

  function selectEntireRow(rowIndex, { extend = false } = {}) {
    clearDisjointSelection()
    selectionActive = true
    const data = options.getData()
    const cols = getColumns()
    const maxC = Math.max(0, cols.length - 1)
    const ri = Math.max(0, Math.min(rowIndex, Math.max(0, data.length - 1)))
    if (extend) {
      const a = Math.min(selection.anchorRow, ri)
      const b = Math.max(selection.focusRow, ri)
      selection.anchorRow = a
      selection.focusRow = b
    } else {
      selection.anchorRow = ri
      selection.focusRow = ri
    }
    selection.anchorCol = 0
    selection.focusCol = maxC
    options.setSelectedRow?.(selection.focusRow)
    options.setSelectedCol?.(0)
    applySelectionVisuals()
    focusGrid()
  }

  function selectAllData() {
    clearDisjointSelection()
    selectionActive = true
    const data = options.getData()
    const cols = getColumns()
    if (!data.length || !cols.length) return
    selection.anchorRow = 0
    selection.focusRow = Math.max(0, data.length - 1)
    selection.anchorCol = 0
    selection.focusCol = Math.max(0, cols.length - 1)
    options.setSelectedRow?.(selection.focusRow)
    options.setSelectedCol?.(0)
    applySelectionVisuals()
    focusGrid()
  }

  function visibleRowPageSize() {
    const rowH = options.getDefaultRowHeight?.() ?? DEFAULT_ROW_HEIGHT
    const viewH = container.clientHeight || 480
    return Math.max(1, Math.floor(viewH / Math.max(rowH, 1)) - 1)
  }

  function moveTabFromCell(row, col, reverse = false) {
    const cols = getColumns()
    const maxR = Math.max(0, options.getData().length - 1)
    let nr = row
    let nc = col + (reverse ? -1 : 1)
    if (nc >= cols.length) {
      nc = 0
      nr = Math.min(nr + 1, maxR)
    } else if (nc < 0) {
      nc = cols.length - 1
      nr = Math.max(nr - 1, 0)
    }
    moveSelection(nr, nc)
    focusGrid()
  }

  function cellKey(r, c) {
    return `${r}:${c}`
  }

  function clearDisjointSelection() {
    disjointCells = null
  }

  function hasDisjointSelection() {
    return !!disjointCells?.size
  }

  function ensureDisjointFromRect() {
    if (disjointCells) return
    disjointCells = new Map()
    const { r1, r2, c1, c2 } = selectionBounds()
    for (let ri = r1; ri <= r2; ri++) {
      for (let ci = c1; ci <= c2; ci++) {
        disjointCells.set(cellKey(ri, ci), { r: ri, c: ci })
      }
    }
  }

  function toggleDisjointCell(ri, ci) {
    ensureDisjointFromRect()
    const key = cellKey(ri, ci)
    if (disjointCells.has(key)) {
      disjointCells.delete(key)
      if (!disjointCells.size) disjointCells = null
    } else {
      disjointCells.set(key, { r: ri, c: ci })
    }
  }

  function selectionBounds() {
    return {
      r1: Math.min(selection.anchorRow, selection.focusRow),
      r2: Math.max(selection.anchorRow, selection.focusRow),
      c1: Math.min(selection.anchorCol, selection.focusCol),
      c2: Math.max(selection.anchorCol, selection.focusCol),
    }
  }

  function isFullRowSelection(bounds = selectionBounds()) {
    const maxC = Math.max(0, getColumns().length - 1)
    return bounds.c1 === 0 && bounds.c2 === maxC
  }

  function isFullColumnSelection(bounds = selectionBounds()) {
    const maxR = Math.max(0, options.getData().length - 1)
    return bounds.r1 === 0 && bounds.r2 === maxR
  }

  function isMultiColFullSelection(bounds = selectionBounds()) {
    return isFullColumnSelection(bounds) && bounds.c2 > bounds.c1
  }

  function isColumnHighlighted(ci, bounds = selectionActive ? selectionBounds() : null) {
    if (bounds && isFullColumnSelection(bounds)) {
      return ci >= bounds.c1 && ci <= bounds.c2
    }
    return ci === options.getSelectedCol?.()
  }

  function isMultiRowFullSelection(bounds = selectionBounds()) {
    return isFullRowSelection(bounds) && bounds.r2 > bounds.r1
  }

  function isRowInMultiRowFullSelection(rowIndex) {
    if (!selectionActive || !isMultiRowFullSelection()) return false
    const { r1, r2 } = selectionBounds()
    return rowIndex >= r1 && rowIndex <= r2
  }

  function isRowHighlighted(ri, bounds = selectionActive ? selectionBounds() : null) {
    if (bounds && isMultiRowFullSelection(bounds)) {
      return ri >= bounds.r1 && ri <= bounds.r2
    }
    return ri === options.getSelectedRow()
  }

  function extendedFillBounds() {
    if (!fillSourceBounds) return selectionBounds()
    const { r1, r2, c1, c2 } = fillSourceBounds
    const fr = selection.focusRow
    const fc = selection.focusCol
    return {
      r1: Math.min(r1, fr),
      r2: Math.max(r2, fr),
      c1: Math.min(c1, fc),
      c2: Math.max(c2, fc),
    }
  }

  function overlayBounds() {
    return isFillDragging && fillSourceBounds ? extendedFillBounds() : selectionBounds()
  }

  function syncSelectionFromOptions() {
    const sr = options.getSelectedRow?.() ?? 0
    const sc = options.getSelectedCol?.() ?? -1
    selection.anchorRow = sr
    selection.focusRow = sr
    if (sc >= 0) {
      selectionActive = true
      selection.anchorCol = sc
      selection.focusCol = sc
    }
  }

  function refreshSelectionVisuals() {
    syncSelectionFromOptions()
    applySelectionVisuals()
    refreshColumnHighlight()
  }

  function wireReadOnlyChrome() {
    if (readOnlyChromeWired) return
    readOnlyChromeWired = true
    container.tabIndex = 0
    container.classList.add('spreadsheet-wrap--selectable')
    ensurePointerSelectionCapture()
    const onScroll = () => {
      scheduleOverlayUpdate()
      scheduleVirtualScrollUpdate()
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
  }

  function selectReadOnlyCell(ri, ci, colName) {
    clearDisjointSelection()
    selectionActive = true
    selection.anchorRow = ri
    selection.focusRow = ri
    selection.anchorCol = ci
    selection.focusCol = ci
    options.setSelectedRow?.(ri)
    options.setSelectedCol?.(ci)
    applySelectionVisuals()
    refreshColumnHighlight()
    if (colName) options.onCellSelect?.(ri, colName, ci)
    requestAnimationFrame(() => updateSelectionOverlay())
  }

  function hasRectSelection(bounds = selectionBounds()) {
    if (!selectionActive || hasDisjointSelection()) return false
    return bounds.r1 !== bounds.r2 || bounds.c1 !== bounds.c2
  }

  function clampSelection() {
    const data = options.getData()
    const cols = getColumns()
    const maxR = Math.max(0, data.length - 1)
    const maxC = Math.max(0, cols.length - 1)
    for (const key of ['anchorRow', 'focusRow']) {
      selection[key] = Math.max(0, Math.min(selection[key], maxR))
    }
    for (const key of ['anchorCol', 'focusCol']) {
      selection[key] = Math.max(0, Math.min(selection[key], maxC))
    }
  }

  function getCellElement(row, colIndex) {
    ensureVirtualRowVisible(row)
    return container.querySelector(
      `td.spreadsheet-cell[data-row="${row}"][data-col-idx="${colIndex}"]`,
    )
  }

  function ensureSelectionOverlay() {
    if (!selectionOverlay) {
      selectionOverlay = document.createElement('div')
      selectionOverlay.className = 'spreadsheet-selection-overlay'
      selectionOverlay.setAttribute('aria-hidden', 'true')
      selectionOverlay.innerHTML = '<div class="spreadsheet-selection-frame"></div><div class="spreadsheet-selection-handle"></div>'
      container.appendChild(selectionOverlay)
      const handle = selectionOverlay.querySelector('.spreadsheet-selection-handle')
      if (handle) {
        handle.addEventListener('mousedown', onFillHandleMouseDown)
      }
    }
  }

  function onFillHandleMouseDown(e) {
    if (options.readOnly || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    exitEdit(true)
    ensureColumnWidthsArray()
    applyColumnWidths()
    fillSourceBounds = selectionBounds()
    isFillDragging = true
    isDragging = false
    document.body.classList.add('spreadsheet-fill-dragging')
    focusGrid()
  }

  function updateSelectionOverlay() {
    ensureSelectionOverlay()
    if (!selectionOverlay) return

    if (!selectionActive || editing) {
      selectionOverlay.hidden = true
      return
    }

    if (hasDisjointSelection()) {
      selectionOverlay.hidden = true
      return
    }

    const { r1, r2, c1, c2 } = overlayBounds()
    const tl = getCellElement(r1, c1)
    const br = getCellElement(r2, c2)
    if (!tl || !br) {
      selectionOverlay.hidden = true
      return
    }

    const containerRect = container.getBoundingClientRect()
    const tlRect = tl.getBoundingClientRect()
    const brRect = br.getBoundingClientRect()

    const pad = 1
    const left = tlRect.left - containerRect.left + container.scrollLeft - pad
    const top = tlRect.top - containerRect.top + container.scrollTop - pad
    const width = brRect.right - tlRect.left + pad * 2
    const height = brRect.bottom - tlRect.top + pad * 2

    selectionOverlay.hidden = false
    selectionOverlay.style.left = `${left}px`
    selectionOverlay.style.top = `${top}px`
    selectionOverlay.style.width = `${Math.max(0, width)}px`
    selectionOverlay.style.height = `${Math.max(0, height)}px`
  }

  function scheduleOverlayUpdate() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf)
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      updateSelectionOverlay()
    })
  }

  function getVisibleRowIndexRange() {
    const dataLen = options.getData().length
    if (!useVirtualRows || dataLen <= VIRTUAL_ROW_THRESHOLD) {
      return { start: 0, end: Math.max(0, dataLen - 1) }
    }
    const pad = VIRTUAL_OVERSCAN + 4
    return {
      start: Math.max(0, virtualRange.start - pad),
      end: Math.min(dataLen - 1, virtualRange.end + pad),
    }
  }

  function applySelectionVisuals() {
    const bounds = selectionActive && !hasDisjointSelection() ? selectionBounds() : null
    const isMultiCell = bounds && (bounds.r1 !== bounds.r2 || bounds.c1 !== bounds.c2)
    const { start: visStart, end: visEnd } = getVisibleRowIndexRange()
    for (let ri = visStart; ri <= visEnd; ri++) {
      const tr = container.querySelector(`tbody tr[data-row="${ri}"]`)
      if (!tr) continue
      tr.classList.toggle('selected', isRowHighlighted(ri, bounds))
      tr.querySelectorAll('.spreadsheet-cell').forEach((cell) => {
        const ci = Number(cell.dataset.colIdx)
        const isEditing = editing?.row === ri && editing?.col === ci
        const inDisjoint = disjointCells?.has(cellKey(ri, ci))
        const isFocus = selectionActive
          && ri === selection.focusRow
          && ci === selection.focusCol
        const inRange = bounds
          && ri >= bounds.r1 && ri <= bounds.r2
          && ci >= bounds.c1 && ci <= bounds.c2
        cell.classList.toggle('is-editing', isEditing)
        cell.classList.toggle('spreadsheet-cell--multi-selected', !!inDisjoint)
        cell.classList.toggle('spreadsheet-cell--focus', !!inDisjoint && isFocus)
        cell.classList.toggle('spreadsheet-cell--in-range', !!inRange && !!isMultiCell)
        cell.classList.toggle('spreadsheet-cell--focus-cell', !!inRange && isFocus && !!isMultiCell)
      })
    }
    refreshColumnHighlight()
    scheduleOverlayUpdate()
    if (options.readOnly) {
      updateSelectionOverlay()
    }
  }

  function selectionToTsv() {
    const cols = getColumns()
    const data = options.getData()

    if (disjointCells?.size) {
      const byRow = new Map()
      for (const { r, c } of disjointCells.values()) {
        if (!byRow.has(r)) byRow.set(r, new Map())
        byRow.get(r).set(c, data[r]?.[cols[c]] ?? '')
      }
      const lines = [...byRow.keys()].sort((a, b) => a - b).map((ri) => {
        const colMap = byRow.get(ri)
        const colIdxs = [...colMap.keys()].sort((a, b) => a - b)
        const rowCells = []
        for (let ci = colIdxs[0]; ci <= colIdxs[colIdxs.length - 1]; ci++) {
          const raw = colMap.has(ci) ? colMap.get(ci) : ''
          rowCells.push(isImageCellValue(raw) ? imageCellUrl(raw) : raw)
        }
        return rowCells.join('\t')
      })
      return lines.join('\n')
    }

    const { r1, r2, c1, c2 } = selectionBounds()
    const lines = []
    for (let ri = r1; ri <= r2; ri++) {
      const rowCells = []
      for (let ci = c1; ci <= c2; ci++) {
        const col = cols[ci]
        const raw = data[ri]?.[col] ?? ''
        rowCells.push(isImageCellValue(raw) ? imageCellUrl(raw) : raw)
      }
      lines.push(rowCells.join('\t'))
    }
    return lines.join('\n')
  }

  function refreshCellContents(bounds = null) {
    const data = options.getData()
    const cols = getColumns()
    const b = bounds ?? {
      r1: 0,
      r2: data.length - 1,
      c1: 0,
      c2: cols.length - 1,
    }
    for (let row = b.r1; row <= b.r2; row++) {
      for (let colIdx = b.c1; colIdx <= b.c2; colIdx++) {
        const cell = getCellElement(row, colIdx)
        if (!cell) continue
        const col = cols[colIdx]
        const val = data[row]?.[col] ?? ''
        const cur = cell.dataset.imageCell === '1'
          ? (data[row]?.[col] ?? '')
          : (cell.textContent || '')
        if (cur !== val) setCellDomContent(cell, val)
      }
    }
    applyColumnWidths()
    scheduleOverlayUpdate()
  }

  function ensureColumnWidthsArray() {
    const cols = getColumns()
    if (!columnWidths || columnWidths.length !== cols.length) {
      columnWidths = buildColumnWidthsFromStorage(cols, getDefaultColumnWidth())
    }
    return columnWidths
  }

  function applyColumnWidths() {
    const widths = ensureColumnWidthsArray()
    const table = container.querySelector('table.spreadsheet-table')
    if (!table) return
    table.classList.add('spreadsheet-table--fixed-cols')
    const rowHeadPx = `${ROW_HEAD_WIDTH_PX}px`
    container.querySelectorAll('.spreadsheet-row-head').forEach((el) => {
      el.style.width = rowHeadPx
      el.style.minWidth = rowHeadPx
      el.style.maxWidth = rowHeadPx
    })
    let total = ROW_HEAD_WIDTH_PX
    widths.forEach((w, ci) => {
      total += w
      const px = `${w}px`
      container.querySelectorAll(`td.spreadsheet-cell[data-col-idx="${ci}"], th.spreadsheet-col-head[data-col-idx="${ci}"]`).forEach((el) => {
        el.style.width = px
        el.style.minWidth = px
        el.style.maxWidth = px
      })
    })
    const trailing = getTrailingColumns()
    const dataColCount = getDataColumnCount()
    trailing.forEach((metaCol, mi) => {
      const absIdx = dataColCount + mi
      const w = metaCol.width ?? 120
      total += w
      const px = `${w}px`
      container.querySelectorAll(`[data-col-idx="${absIdx}"]`).forEach((el) => {
        el.style.width = px
        el.style.minWidth = px
        el.style.maxWidth = px
      })
    })
    table.style.width = `${total}px`
  }

  function schedulePersistColumnWidths() {
    if (colResizeSaveTimer) clearTimeout(colResizeSaveTimer)
    colResizeSaveTimer = window.setTimeout(() => {
      colResizeSaveTimer = 0
      const cols = getColumns()
      if (columnWidths?.length) persistColumnWidths(cols, columnWidths)
    }, 200)
  }

  function flushPersistColumnWidths() {
    if (colResizeSaveTimer) {
      clearTimeout(colResizeSaveTimer)
      colResizeSaveTimer = 0
    }
    const cols = getColumns()
    if (columnWidths?.length) persistColumnWidths(cols, columnWidths)
  }

  function stopColumnResize() {
    if (colResizeIndex == null) return
    colResizeIndex = null
    document.body.classList.remove('spreadsheet-col-resizing')
    flushPersistColumnWidths()
    scheduleOverlayUpdate()
  }

  function onColumnResizeMove(clientX) {
    if (colResizeIndex == null || !columnWidths) return
    const delta = clientX - colResizeStartX
    columnWidths[colResizeIndex] = clampColumnWidth(colResizeStartW + delta)
    applyColumnWidths()
    scheduleOverlayUpdate()
    schedulePersistColumnWidths()
  }

  function wireColumnResizers() {
    container.querySelectorAll('.spreadsheet-col-resizer').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        if (options.readOnly) return
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const ci = Number(handle.dataset.resizeCol)
        if (Number.isNaN(ci)) return
        ensureColumnWidthsArray()
        colResizeIndex = ci
        colResizeStartX = e.clientX
        colResizeStartW = columnWidths[ci]
        document.body.classList.add('spreadsheet-col-resizing')
      })
    })
  }

  function getDefaultRowHeightPx() {
    return options.getDefaultRowHeight?.() ?? DEFAULT_ROW_HEIGHT
  }

  function getRowHeightsMap() {
    return rowHeightsOverride ?? options.getRowHeights?.() ?? {}
  }

  function getRowHeightPx(rowIndex) {
    const h = getRowHeightsMap()[String(rowIndex)]
    if (typeof h === 'number' && h > 0) return clampRowHeight(h)
    if (rowHasImageCell(rowIndex)) return clampRowHeight(IMAGE_CELL_ROW_HEIGHT_PX)
    return getDefaultRowHeightPx()
  }

  function getRowElement(rowIndex) {
    return container.querySelector(`tbody tr[data-row="${rowIndex}"]`)
  }

  function measureRowHeightPx(rowIndex) {
    const tr = getRowElement(rowIndex)
    if (!tr) return getRowHeightPx(rowIndex)
    const h = Math.round(tr.getBoundingClientRect().height)
    return h > 0 ? h : getRowHeightPx(rowIndex)
  }

  function lockRowHeightForEdit(row) {
    const tr = getRowElement(row)
    if (!tr) return
    const map = getRowHeightsMap()
    const wasPersisted = typeof map[String(row)] === 'number' && map[String(row)] > 0
    const h = measureRowHeightPx(row)
    applyRowHeightToRow(tr, clampRowHeight(h))
    editRowHeightLock = { row, wasPersisted }
  }

  function releaseEditRowHeightLock() {
    if (!editRowHeightLock) return
    const { row, wasPersisted } = editRowHeightLock
    editRowHeightLock = null
    if (!wasPersisted) {
      clearRowHeightStyles(getRowElement(row))
    }
  }

  function clearRowHeightStyles(tr) {
    if (!tr) return
    tr.style.height = ''
    tr.querySelectorAll('td').forEach((td) => {
      td.style.height = ''
      td.style.minHeight = ''
      td.style.maxHeight = ''
      td.style.overflow = ''
    })
  }

  function applyRowHeightToRow(tr, h) {
    if (!tr) return
    const px = `${h}px`
    tr.style.height = px
    tr.querySelectorAll('td').forEach((td) => {
      td.style.boxSizing = 'border-box'
      td.style.height = px
      td.style.minHeight = px
      td.style.maxHeight = px
      td.style.overflow = 'hidden'
    })
  }

  function applyRowHeightsFromMap(map) {
    const data = options.getData()
    data.forEach((_, ri) => {
      const tr = getRowElement(ri)
      const key = String(ri)
      const h = map[key]
      if (typeof h === 'number' && h > 0) {
        applyRowHeightToRow(tr, clampRowHeight(h))
      } else {
        clearRowHeightStyles(tr)
      }
    })
    scheduleOverlayUpdate()
  }

  function applyRowHeights() {
    const map = getRowHeightsMap()
    if (useVirtualRows) {
      for (let ri = virtualRange.start; ri <= virtualRange.end; ri++) {
        const tr = getRowElement(ri)
        const h = map[String(ri)]
        if (typeof h === 'number' && h > 0) applyRowHeightToRow(tr, clampRowHeight(h))
        else clearRowHeightStyles(tr)
      }
    } else {
      applyRowHeightsFromMap(map)
    }
    scheduleOverlayUpdate()
  }

  function publishRowHeights(map, persist = true) {
    options.onRowHeightsChange?.(map, { persist })
  }

  function getRowResizeTargets(dragRowIndex) {
    if (!selectionActive) return [dragRowIndex]
    const { r1, r2, c1, c2 } = selectionBounds()
    const maxC = Math.max(0, getColumns().length - 1)
    const spansMultipleRows = r2 > r1
    const isFullRowSelection = c1 === 0 && c2 === maxC
    if (spansMultipleRows && isFullRowSelection && dragRowIndex >= r1 && dragRowIndex <= r2) {
      const rows = []
      for (let r = r1; r <= r2; r++) rows.push(r)
      return rows
    }
    return [dragRowIndex]
  }

  function beginRowResize(dragRowIndex, clientY) {
    rowResizeTargets = getRowResizeTargets(dragRowIndex)
    rowResizeStartY = clientY
    rowResizeStartHeights = {}
    const map = { ...(options.getRowHeights?.() ?? {}) }
    for (const r of rowResizeTargets) {
      const h = measureRowHeightPx(r)
      rowResizeStartHeights[String(r)] = h
      map[String(r)] = h
    }
    rowHeightsOverride = map
    document.body.classList.add('spreadsheet-row-resizing')
  }

  function stopRowResize() {
    if (!rowResizeTargets?.length) return
    const finalMap = { ...(options.getRowHeights?.() ?? {}), ...(rowHeightsOverride ?? {}) }
    for (const r of rowResizeTargets) {
      const key = String(r)
      const h = finalMap[key] ?? rowResizeStartHeights[key]
      if (Number.isFinite(h) && h > 0) finalMap[key] = clampRowHeight(h)
    }
    rowResizeTargets = null
    rowResizeStartHeights = {}
    rowHeightsOverride = null
    document.body.classList.remove('spreadsheet-row-resizing')
    publishRowHeights(finalMap, true)
    applyRowHeightsFromMap(finalMap)
    invalidateRowGeometry()
  }

  function onRowResizeMove(clientY) {
    if (!rowResizeTargets?.length) return
    const delta = clientY - rowResizeStartY
    const map = { ...(options.getRowHeights?.() ?? {}), ...(rowHeightsOverride ?? {}) }
    for (const r of rowResizeTargets) {
      const startH = rowResizeStartHeights[String(r)] ?? measureRowHeightPx(r)
      const h = clampRowHeight(startH + delta)
      map[String(r)] = h
      applyRowHeightToRow(getRowElement(r), h)
    }
    rowHeightsOverride = map
    scheduleOverlayUpdate()
  }

  function ensureRowResizerDelegation() {
    if (rowResizersDelegated) return
    rowResizersDelegated = true
    container.addEventListener('mousedown', (e) => {
      if (options.readOnly || e.button !== 0) return
      const handle = e.target.closest('.spreadsheet-row-resizer')
      if (!handle || !container.contains(handle)) return
      e.preventDefault()
      e.stopPropagation()
      const ri = Number(handle.dataset.resizeRow)
      if (Number.isNaN(ri)) return
      beginRowResize(ri, e.clientY)
    }, true)
  }

  function wireRowResizers() {
    ensureRowResizerDelegation()
  }

  function ensureRowResizeListeners() {
    if (container.dataset.rowResizeWired === '1') return
    container.dataset.rowResizeWired = '1'
    document.addEventListener('mousemove', (e) => {
      if (!rowResizeTargets?.length) return
      onRowResizeMove(e.clientY)
    })
    document.addEventListener('mouseup', () => {
      if (!rowResizeTargets?.length) return
      stopRowResize()
    })
  }

  function isVirtualScrollEnabled() {
    return ENABLE_VIRTUAL_ROWS && options.getData().length > VIRTUAL_ROW_THRESHOLD
  }

  function resolvePointerCell(clientX, clientY) {
    const cols = getColumns()
    if (!cols.length) return null

    const el = document.elementFromPoint(clientX, clientY)
    if (el && container.contains(el)) {
      const cell = el.closest('.spreadsheet-cell')
      if (cell && container.contains(cell)) {
        const ri = Number(cell.dataset.row)
        const ci = Number(cell.dataset.colIdx)
        if (!Number.isNaN(ri) && !Number.isNaN(ci) && ci >= 0 && ci < cols.length) {
          return { ri, ci }
        }
      }
    }

    if (!isVirtualScrollEnabled()) return null

    const ri = rowIndexFromClientY(clientY)
    const ci = colIndexFromClientX(clientX)
    if (ri == null || ci == null || Number.isNaN(ri) || Number.isNaN(ci)) return null
    if (ci < 0 || ci >= cols.length) return null
    return { ri, ci }
  }

  function prepareVirtualRowForInteraction(rowIndex) {
    if (!isVirtualScrollEnabled()) return
    const dataLen = options.getData().length
    const ri = Math.max(0, Math.min(rowIndex, dataLen - 1))
    if (ri >= virtualRange.start && ri <= virtualRange.end) return

    const offsets = ensureRowOffsets(dataLen)
    const rowTop = offsets[ri]
    const rowBottom = offsets[ri + 1]
    const viewH = container.clientHeight || 400
    let nextScroll = container.scrollTop
    if (rowTop < nextScroll) nextScroll = rowTop
    else if (rowBottom > nextScroll + viewH) nextScroll = Math.max(0, rowBottom - viewH)

    if (nextScroll !== container.scrollTop) {
      container.scrollTop = nextScroll
    }

    virtualRange = {
      start: Math.max(0, ri - VIRTUAL_OVERSCAN),
      end: Math.min(dataLen - 1, ri + VIRTUAL_OVERSCAN),
    }
    patchVirtualTableBody()
  }

  function beginPointerCellSelection(ri, ci, e) {
    if (editing && (editing.row !== ri || editing.col !== ci)) exitEdit(true)
    prepareVirtualRowForInteraction(ri)

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      toggleDisjointCell(ri, ci)
      selectionActive = !!disjointCells?.size
      cellPointerDown = null
      if (selectionActive) {
        selection.focusRow = ri
        selection.focusCol = ci
        selection.anchorRow = ri
        selection.anchorCol = ci
        options.setSelectedRow?.(ri)
        options.setSelectedCol?.(ci)
      }
      applySelectionVisuals()
      focusGrid()
      return
    }

    clearDisjointSelection()
    selectionActive = true
    cellPointerDown = { x: e.clientX, y: e.clientY, ri, ci }
    isDragging = false

    if (e.shiftKey) {
      selection.focusRow = ri
      selection.focusCol = ci
    } else {
      selection.anchorRow = ri
      selection.anchorCol = ci
      selection.focusRow = ri
      selection.focusCol = ci
    }
    options.setSelectedRow?.(ri)
    options.setSelectedCol?.(ci)
    applySelectionVisuals()
    focusGrid()
  }

  function ensurePointerSelectionCapture() {
    if (pointerSelectionCaptureWired) return
    pointerSelectionCaptureWired = true
    container.addEventListener('mousedown', (e) => {
      if (disposed || options.readOnly || e.button !== 0) return
      if (!isVirtualScrollEnabled()) return
      if (e.target.closest(
        '.spreadsheet-col-resizer, .spreadsheet-row-resizer, .spreadsheet-selection-handle,'
        + ' .spreadsheet-col-head, .spreadsheet-meta-col-head, td.spreadsheet-row-head[data-row]',
      )) return

      const directCell = e.target.closest('.spreadsheet-cell')
      if (directCell && container.contains(directCell) && !e.target.closest('.spreadsheet-virtual-spacer')) {
        return
      }

      const hit = resolvePointerCell(e.clientX, e.clientY)
      if (!hit) return

      e.preventDefault()
      e.stopPropagation()
      hideContextMenu()
      beginPointerCellSelection(hit.ri, hit.ci, e)
    }, true)
  }

  function rowIndexFromClientY(clientY) {
    const dataLen = options.getData().length
    if (isVirtualScrollEnabled()) {
      const rect = container.getBoundingClientRect()
      const yInContent = Math.max(0, clientY - rect.top + container.scrollTop)
      const offsets = ensureRowOffsets(dataLen)
      const total = offsets[dataLen] ?? 0
      const clampedY = Math.min(Math.max(0, yInContent), Math.max(0, total - 1))
      const idx = Math.min(dataLen - 1, Math.max(0, lowerBoundOffset(offsets, clampedY + 1) - 1))
      return idx
    }
    const rows = container.querySelectorAll('tbody tr[data-row]')
    if (!rows.length) return null
    for (const tr of rows) {
      const rect = tr.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return Number(tr.dataset.row)
      }
    }
    const firstRect = rows[0].getBoundingClientRect()
    const lastRect = rows[rows.length - 1].getBoundingClientRect()
    if (clientY < firstRect.top) return Number(rows[0].dataset.row)
    if (clientY > lastRect.bottom) return Number(rows[rows.length - 1].dataset.row)
    return null
  }

  function colIndexFromClientX(clientX) {
    const heads = container.querySelectorAll('thead .spreadsheet-col-head')
    if (!heads.length) return null
    for (const th of heads) {
      const rect = th.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right) {
        return Number(th.dataset.colIdx)
      }
    }
    const firstRect = heads[0].getBoundingClientRect()
    const lastRect = heads[heads.length - 1].getBoundingClientRect()
    if (clientX < firstRect.left) return Number(heads[0].dataset.colIdx)
    if (clientX > lastRect.right) return Number(heads[heads.length - 1].dataset.colIdx)
    return null
  }

  function rowIndexFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)
    const host = el?.closest?.('.spreadsheet-row-head[data-row], tr[data-row] .spreadsheet-cell')
    if (host) {
      const rowHost = host.classList?.contains?.('spreadsheet-cell')
        ? host.closest('tr[data-row]')
        : host
      const ri = Number(rowHost?.dataset?.row ?? host.dataset?.row)
      if (!Number.isNaN(ri)) return ri
    }
    return rowIndexFromClientY(clientY)
  }

  function cellIndicesFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)
    const cell = el?.closest?.('.spreadsheet-cell')
    if (cell && container.contains(cell)) {
      return {
        ri: Number(cell.dataset.row),
        ci: Number(cell.dataset.colIdx),
      }
    }
    const ri = rowIndexFromClientY(clientY)
    const ci = colIndexFromClientX(clientX)
    if (ri == null || ci == null || Number.isNaN(ri) || Number.isNaN(ci)) return null
    return { ri, ci }
  }

  function isSelectionDragActive() {
    return isDragging || isRowHeadDragging || isColHeadDragging || isFillDragging
  }

  function computeAutoScrollDelta(clientX, clientY) {
    const rect = container.getBoundingClientRect()
    let dx = 0
    let dy = 0

    const speedForDistance = (distance, edge) => {
      if (distance <= 0) return AUTO_SCROLL_MAX_SPEED
      if (distance >= edge) return 0
      return Math.max(1, Math.ceil((1 - distance / edge) * AUTO_SCROLL_MAX_SPEED))
    }

    if (clientY < rect.top) {
      dy = -AUTO_SCROLL_MAX_SPEED
    } else if (clientY > rect.bottom) {
      dy = AUTO_SCROLL_MAX_SPEED
    } else if (clientY < rect.top + AUTO_SCROLL_EDGE_PX) {
      dy = -speedForDistance(clientY - rect.top, AUTO_SCROLL_EDGE_PX)
    } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
      dy = speedForDistance(rect.bottom - clientY, AUTO_SCROLL_EDGE_PX)
    }

    if (clientX < rect.left) {
      dx = -AUTO_SCROLL_MAX_SPEED
    } else if (clientX > rect.right) {
      dx = AUTO_SCROLL_MAX_SPEED
    } else if (clientX < rect.left + AUTO_SCROLL_EDGE_PX) {
      dx = -speedForDistance(clientX - rect.left, AUTO_SCROLL_EDGE_PX)
    } else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
      dx = speedForDistance(rect.right - clientX, AUTO_SCROLL_EDGE_PX)
    }

    return { dx, dy }
  }

  function updateDragSelectionFromPoint(clientX, clientY) {
    if (isRowHeadDragging) {
      updateRowHeadDragSelection(clientX, clientY)
      return
    }
    const hit = cellIndicesFromPoint(clientX, clientY)
    if (!hit) return
    const { ri, ci } = hit
    if (ri === selection.focusRow && ci === selection.focusCol) return
    selection.focusRow = ri
    selection.focusCol = ci
    applySelectionVisuals()
  }

  function autoScrollStep() {
    autoScrollRaf = 0
    if (!autoScrollPointer || !isSelectionDragActive()) {
      autoScrollPointer = null
      return
    }

    const { x, y } = autoScrollPointer
    const { dx, dy } = computeAutoScrollDelta(x, y)
    if (dx === 0 && dy === 0) return

    container.scrollLeft += dx
    container.scrollTop += dy
    updateDragSelectionFromPoint(x, y)
    autoScrollRaf = requestAnimationFrame(autoScrollStep)
  }

  function scheduleAutoScroll(clientX, clientY) {
    if (!isSelectionDragActive()) return
    autoScrollPointer = { x: clientX, y: clientY }
    const { dx, dy } = computeAutoScrollDelta(clientX, clientY)
    if (dx === 0 && dy === 0) {
      stopAutoScroll()
      return
    }
    if (autoScrollRaf) return
    autoScrollRaf = requestAnimationFrame(autoScrollStep)
  }

  function stopAutoScroll() {
    autoScrollPointer = null
    if (autoScrollRaf) {
      cancelAnimationFrame(autoScrollRaf)
      autoScrollRaf = 0
    }
  }

  function updateRowHeadDragSelection(clientX, clientY) {
    const ri = rowIndexFromPoint(clientX, clientY)
    if (ri == null) return
    rowHeadDragMoved = true
    const maxC = Math.max(0, getColumns().length - 1)
    selectionActive = true
    selection.anchorRow = rowHeadDragStartRow
    selection.focusRow = ri
    selection.anchorCol = 0
    selection.focusCol = maxC
    refreshRowHighlight()
    applySelectionVisuals()
  }

  function updateColHeadDragSelection(clientX, clientY) {
    const ci = colIndexFromClientX(clientX)
    if (ci == null || Number.isNaN(ci)) return
    colHeadDragMoved = true
    const maxR = Math.max(0, options.getData().length - 1)
    selectionActive = true
    selection.anchorCol = colHeadDragStartCol
    selection.focusCol = ci
    selection.anchorRow = 0
    selection.focusRow = maxR
    refreshColumnHighlight()
    applySelectionVisuals()
  }

  function wireColHeadInteraction() {
    container.querySelectorAll('.spreadsheet-col-head').forEach((th) => {
      th.addEventListener('mousedown', (e) => {
        if (options.readOnly) return
        if (e.button !== 0) return
        if (e.target.closest('.spreadsheet-col-resizer')) return
        e.preventDefault()
        e.stopPropagation()
        const ci = Number(th.dataset.colIdx)
        if (Number.isNaN(ci)) return
        exitEdit(true)
        hideColHeadDropdown()
        isColHeadDragging = true
        colHeadDragMoved = false
        colHeadDragStartCol = ci
        if (e.shiftKey) selectEntireColumn(ci, { extend: true })
        else selectEntireColumn(ci)
        refreshColumnHighlight()
        applySelectionVisuals()
        document.body.classList.add('spreadsheet-col-dragging')
        focusGrid()
      })

      th.addEventListener('contextmenu', (e) => {
        if (options.readOnly) return
        if (e.target.closest('.spreadsheet-col-resizer')) return
        if (!options.onRenameColumn && !options.onAddColumnRight && !options.onDeleteColumn) return
        e.preventDefault()
        e.stopPropagation()
        hideContextMenu()
        const ci = Number(th.dataset.colIdx)
        if (Number.isNaN(ci)) return
        const colName = th.dataset.col || getColumns()[ci] || ''
        exitEdit(true)
        selectEntireColumn(ci)
        options.onColumnSelect?.(ci, colName)
        refreshColumnHighlight()
        showColHeadContextMenu(e.clientX, e.clientY, ci, colName, th)
      })
    })

    if (container.dataset.colHeadWired === '1') return
    container.dataset.colHeadWired = '1'

    document.addEventListener('mousemove', (e) => {
      if (!isColHeadDragging) return
      updateColHeadDragSelection(e.clientX, e.clientY)
      scheduleAutoScroll(e.clientX, e.clientY)
    })

    document.addEventListener('mouseup', () => {
      if (!isColHeadDragging) return
      isColHeadDragging = false
      stopAutoScroll()
      document.body.classList.remove('spreadsheet-col-dragging')
      options.setSelectedCol?.(selection.focusCol)
      const cols = getColumns()
      options.onColumnSelect?.(selection.focusCol, cols[selection.focusCol] || '')
      refreshColumnHighlight()
      applySelectionVisuals()
      if (colHeadDragMoved) {
        setTimeout(() => { colHeadDragMoved = false }, 0)
      }
    })
  }

  function ensureRowHeadPointerDelegation() {
    if (rowHeadPointerDelegated) return
    rowHeadPointerDelegated = true
    container.addEventListener('mousedown', (e) => {
      if (options.readOnly || e.button !== 0) return
      const rowHead = e.target.closest('td.spreadsheet-row-head[data-row]')
      if (!rowHead || !container.contains(rowHead)) return
      if (e.target.closest('.spreadsheet-row-resizer')) return
      e.preventDefault()
      e.stopPropagation()
      const ri = Number(rowHead.dataset.row)
      if (Number.isNaN(ri)) return
      exitEdit(true)
      isRowHeadDragging = true
      rowHeadDragMoved = false
      rowHeadDragStartRow = ri
      if (e.shiftKey) selectEntireRow(ri, { extend: true })
      else selectEntireRow(ri)
      refreshRowHighlight()
      applySelectionVisuals()
      document.body.classList.add('spreadsheet-row-dragging')
      focusGrid()
    }, true)

    if (container.dataset.rowHeadWired === '1') return
    container.dataset.rowHeadWired = '1'

    document.addEventListener('mousemove', (e) => {
      if (!isRowHeadDragging) return
      updateRowHeadDragSelection(e.clientX, e.clientY)
      scheduleAutoScroll(e.clientX, e.clientY)
    })

    document.addEventListener('mouseup', () => {
      if (!isRowHeadDragging) return
      isRowHeadDragging = false
      stopAutoScroll()
      document.body.classList.remove('spreadsheet-row-dragging')
      options.setSelectedRow?.(selection.focusRow)
      options.onRowSelect?.(selection.focusRow)
      refreshRowHighlight()
      applySelectionVisuals()
      scheduleSyncPreviewRow()
      if (rowHeadDragMoved) {
        setTimeout(() => { rowHeadDragMoved = false }, 0)
      }
    })
  }

  function wireRowHeadInteraction() {
    ensureRowHeadPointerDelegation()
  }

  function ensureColumnResizeListeners() {
    if (container.dataset.colResizeWired === '1') return
    container.dataset.colResizeWired = '1'
    document.addEventListener('mousemove', (e) => {
      if (colResizeIndex == null) return
      onColumnResizeMove(e.clientX)
    })
    document.addEventListener('mouseup', () => {
      if (colResizeIndex == null) return
      stopColumnResize()
    })
  }

  function commitTableHistory() {
    options.onTableHistoryCommit?.()
  }

  function clearCellSelection() {
    hideContextMenu()
    if (editing) exitEdit(true)
    selectionActive = false
    clearDisjointSelection()
    options.setSelectedCol?.(-1)
    refreshColumnHighlight()
    applySelectionVisuals()
    options.onSelectionClear?.()
  }

  function clearSelectedCells() {
    if (!selectionActive) return false
    const cols = getColumns()
    const dataRef = options.getData()
    let changed = false

    if (disjointCells?.size) {
      const touchedRows = new Set()
      for (const { r, c } of disjointCells.values()) {
        const col = cols[c]
        if (dataRef[r] && col && dataRef[r][col] !== '') {
          dataRef[r][col] = ''
          changed = true
          touchedRows.add(r)
        }
      }
      if (changed) {
        options.onCellChange?.(selection.focusRow, cols[selection.focusCol] || '', '')
        for (const ri of touchedRows) {
          const rowCells = [...disjointCells.values()].filter(({ r }) => r === ri)
          if (!rowCells.length) continue
          const cs = rowCells.map(({ c }) => c)
          refreshCellContents({
            r1: ri,
            r2: ri,
            c1: Math.min(...cs),
            c2: Math.max(...cs),
          })
        }
        commitTableHistory()
      }
      return changed
    }

    const bounds = selectionBounds()
    for (let row = bounds.r1; row <= bounds.r2; row++) {
      for (let colIdx = bounds.c1; colIdx <= bounds.c2; colIdx++) {
        const col = cols[colIdx]
        if (dataRef[row] && dataRef[row][col] !== '') {
          dataRef[row][col] = ''
          changed = true
        }
      }
    }
    if (changed) {
      options.onCellChange?.(selection.focusRow, cols[selection.focusCol] || '', '')
      refreshCellContents(bounds)
      commitTableHistory()
    }
    return changed
  }

  async function copySelection() {
    if (!selectionActive) return
    const tsv = selectionToTsv()
    try {
      await navigator.clipboard.writeText(tsv)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = tsv
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
  }

  function parseTsvGrid(text) {
    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n')
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    if (lines.length === 0) return []
    return lines.map((line) => line.split('\t'))
  }

  function getSourceGridFromBounds(bounds) {
    const { r1, r2, c1, c2 } = bounds
    const cols = getColumns()
    const data = options.getData()
    const grid = []
    for (let ri = r1; ri <= r2; ri++) {
      const row = []
      for (let ci = c1; ci <= c2; ci++) {
        row.push(data[ri]?.[cols[ci]] ?? '')
      }
      grid.push(row)
    }
    return grid
  }

  function gridSize(grid) {
    const h = grid.length
    const w = h ? Math.max(...grid.map((row) => row.length)) : 0
    return { h, w }
  }

  function normalizePasteGrid(grid) {
    if (!grid.length) return []
    const w = Math.max(1, ...grid.map((row) => row.length))
    return grid.map((row) => {
      const cells = row.map((cell) => String(cell ?? ''))
      while (cells.length < w) cells.push('')
      return cells
    })
  }

  /** 用源网格平铺填充矩形区域（Excel 填充柄 / 单值刷满选区） */
  function fillRectWithGrid(target, source, grid) {
    const cols = getColumns()
    const dataRef = options.getData()
    const { h: srcH, w: srcW } = gridSize(grid)
    if (!srcH || !srcW) return false

    let changed = false
    for (let ri = target.r1; ri <= target.r2; ri++) {
      if (ri >= dataRef.length) continue
      for (let ci = target.c1; ci <= target.c2; ci++) {
        if (ci >= cols.length) continue
        const dr = ri - source.r1
        const dc = ci - source.c1
        const val = grid[((dr % srcH) + srcH) % srcH][((dc % srcW) + srcW) % srcW] ?? ''
        const col = cols[ci]
        if (dataRef[ri][col] !== val) changed = true
        dataRef[ri][col] = val
      }
    }
    return changed
  }

  function fillSelectionWithGrid(grid) {
    const target = selectionBounds()
    const changed = fillRectWithGrid(target, target, grid)
    if (changed) {
      const cols = getColumns()
      options.onCellChange?.(selection.focusRow, cols[selection.focusCol] || '', '')
      refreshCellContents(target)
      commitTableHistory()
    }
    return changed
  }

  function applyFillDrag() {
    if (!fillSourceBounds) return false
    const extended = extendedFillBounds()
    const grid = getSourceGridFromBounds(fillSourceBounds)
    const changed = fillRectWithGrid(extended, fillSourceBounds, grid)
    selection.anchorRow = extended.r1
    selection.anchorCol = extended.c1
    selection.focusRow = extended.r2
    selection.focusCol = extended.c2
    return changed
  }

  function finishFillDrag() {
    if (!isFillDragging) return
    isFillDragging = false
    document.body.classList.remove('spreadsheet-fill-dragging')
    const changed = applyFillDrag()
    fillSourceBounds = null
    if (changed) {
      const cols = getColumns()
      const bounds = selectionBounds()
      options.onCellChange?.(selection.focusRow, cols[selection.focusCol] || '', '')
      refreshCellContents(bounds)
      commitTableHistory()
    } else {
      applySelectionVisuals()
    }
    scheduleSyncPreviewRow()
  }

  function pasteGrid(grid) {
    grid = normalizePasteGrid(grid)
    if (!grid.length) return false
    const sel = selectionBounds()
    const { h: gridH, w: gridW } = gridSize(grid)
    const selH = sel.r2 - sel.r1 + 1
    const selW = sel.c2 - sel.c1 + 1

    if (gridH === 1 && gridW === 1 && (selH > 1 || selW > 1)) {
      const changed = fillSelectionWithGrid(grid)
      if (changed) {
        syncDataAfterPaste()
        render()
      }
      return changed
    }

    const { r1, c1 } = sel
    const cols = getColumns()
    const dataRef = options.getData()
    const needRows = r1 + gridH
    if (options.onEnsureRowCount) {
      options.onEnsureRowCount(needRows)
    } else {
      while (dataRef.length < needRows) {
        const empty = Object.fromEntries(cols.map((col) => [col, '']))
        dataRef.push(empty)
      }
    }

    let changed = false
    grid.forEach((cells, dr) => {
      const ri = r1 + dr
      if (ri >= dataRef.length) return
      cells.forEach((val, dc) => {
        const ci = c1 + dc
        if (ci >= cols.length) return
        const col = cols[ci]
        if (dataRef[ri][col] !== val) changed = true
        dataRef[ri][col] = val
      })
    })

    const singleAnchor = selH === 1 && selW === 1 && (gridH > 1 || gridW > 1)
    if (singleAnchor && r1 === 0 && options.onPasteTrimRows) {
      options.onPasteTrimRows(needRows)
      changed = true
    }

    if (changed) {
      options.onCellChange?.(selection.focusRow, cols[selection.focusCol] || '', '')
      options.onPositionalPaste?.({
        startRow: r1,
        startCol: c1,
        rowCount: gridH,
        colCount: gridW,
      })
      const maxGridW = Math.max(1, ...grid.map((row) => row.length))
      refreshCellContents({
        r1,
        r2: Math.min(r1 + grid.length - 1, dataRef.length - 1),
        c1,
        c2: Math.min(c1 + maxGridW - 1, cols.length - 1),
      })
      commitTableHistory()
      syncDataAfterPaste()
      render()
    }
    return changed
  }

  function syncDataAfterPaste() {
    if (!options.syncDataAfterPaste || !options.setData) return
    options.setData(options.getData())
  }

  function hideColHeadDropdown() {
    if (colHeadDropdownEl) colHeadDropdownEl.hidden = true
    if (openColHeadMenuTh) {
      openColHeadMenuTh.classList.remove('spreadsheet-col-head--menu-open')
      openColHeadMenuTh = null
    }
  }

  function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.hidden = true
    hideColHeadDropdown()
  }

  function ensureContextMenu() {
    if (contextMenuEl) return contextMenuEl
    contextMenuEl = document.createElement('div')
    contextMenuEl.className = 'spreadsheet-context-menu'
    contextMenuEl.hidden = true
    contextMenuEl.innerHTML = `
      <button type="button" data-action="upload-image">上传图片</button>
      <button type="button" data-action="add-row">在下方插入行</button>
      <button type="button" data-action="delete-row">删除行</button>
      <button type="button" data-action="add-col">在右侧插入列</button>
      <button type="button" data-action="delete-col">删除列</button>
    `
    document.body.appendChild(contextMenuEl)

    imageFileInput = document.createElement('input')
    imageFileInput.type = 'file'
    imageFileInput.accept = 'image/*'
    imageFileInput.hidden = true
    document.body.appendChild(imageFileInput)
    imageFileInput.addEventListener('change', async () => {
      const file = imageFileInput.files?.[0]
      imageFileInput.value = ''
      if (!file || !options.onSetCellImage) return
      try {
        await options.onSetCellImage(imagePickRow, imagePickCol, file)
      } catch (err) {
        console.error(err)
      }
    })

    contextMenuEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]')
      if (!btn) return
      const row = Number(contextMenuEl.dataset.row)
      const col = Number(contextMenuEl.dataset.col)
      hideContextMenu()
      if (btn.dataset.action === 'upload-image') {
        imagePickRow = row
        imagePickCol = col
        imageFileInput?.click()
      } else if (btn.dataset.action === 'add-row') options.onAddRowBelow?.(row)
      else if (btn.dataset.action === 'delete-row') {
        const r1 = contextMenuEl.dataset.deleteR1
        const r2 = contextMenuEl.dataset.deleteR2
        if (r1 != null && r2 != null && options.onDeleteRows) {
          options.onDeleteRows(Number(r1), Number(r2))
        } else {
          options.onDeleteRow?.(row)
        }
      } else if (btn.dataset.action === 'add-col') options.onAddColumnRight?.(col)
      else if (btn.dataset.action === 'delete-col') options.onDeleteColumn?.(col)
    })

    document.addEventListener('click', (e) => {
      if (!contextMenuEl || contextMenuEl.hidden) return
      if (e.target.closest('.spreadsheet-context-menu')) return
      hideContextMenu()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideContextMenu()
    })
    window.addEventListener('scroll', hideContextMenu, true)
    window.addEventListener('resize', hideContextMenu)

    return contextMenuEl
  }

  function ensureColHeadDropdown() {
    if (colHeadDropdownEl) return colHeadDropdownEl
    colHeadDropdownEl = document.createElement('div')
    colHeadDropdownEl.className = 'spreadsheet-context-menu spreadsheet-colhead-dropdown'
    colHeadDropdownEl.hidden = true
    colHeadDropdownEl.innerHTML = `
      <button type="button" data-action="rename-col">修改标题</button>
      <hr class="spreadsheet-context-menu-sep" />
      <button type="button" data-action="add-col">在右侧插入列</button>
      <button type="button" data-action="delete-col">删除列</button>
    `
    document.body.appendChild(colHeadDropdownEl)

    colHeadDropdownEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]')
      if (!btn) return
      const ci = Number(colHeadDropdownEl.dataset.col)
      const oldName = getColumns()[ci] || colHeadDropdownEl.dataset.colName || ''
      hideContextMenu()
      if (btn.dataset.action === 'rename-col') {
        const next = window.prompt('列标题', oldName)
        if (next == null) return
        const trimmed = String(next).trim()
        if (!trimmed || trimmed === oldName) return
        options.onRenameColumn?.(ci, oldName, trimmed)
      } else if (btn.dataset.action === 'add-col') {
        options.onAddColumnRight?.(ci)
      } else if (btn.dataset.action === 'delete-col') {
        options.onDeleteColumn?.(ci)
      }
    })

    return colHeadDropdownEl
  }

  function showColHeadContextMenu(clientX, clientY, colIndex, colName, th) {
    const menu = ensureColHeadDropdown()
    menu.dataset.col = String(colIndex)
    menu.dataset.colName = colName
    const renameBtn = menu.querySelector('[data-action="rename-col"]')
    const addBtn = menu.querySelector('[data-action="add-col"]')
    const deleteBtn = menu.querySelector('[data-action="delete-col"]')
    const sep = menu.querySelector('.spreadsheet-context-menu-sep')
    if (renameBtn) {
      renameBtn.hidden = !options.onRenameColumn
      renameBtn.textContent = '修改标题'
    }
    if (addBtn) addBtn.hidden = !options.onAddColumnRight
    if (deleteBtn) deleteBtn.hidden = !options.onDeleteColumn
    if (sep) {
      sep.hidden = !options.onRenameColumn || (!options.onAddColumnRight && !options.onDeleteColumn)
    }
    if (openColHeadMenuTh && openColHeadMenuTh !== th) {
      openColHeadMenuTh.classList.remove('spreadsheet-col-head--menu-open')
    }
    openColHeadMenuTh = th
    th?.classList.add('spreadsheet-col-head--menu-open')
    menu.hidden = false
    menu.style.left = '0'
    menu.style.top = '0'
    const menuRect = menu.getBoundingClientRect()
    const pad = 8
    let left = clientX
    let top = clientY
    if (left + menuRect.width > window.innerWidth - pad) {
      left = window.innerWidth - menuRect.width - pad
    }
    if (left < pad) left = pad
    if (top + menuRect.height > window.innerHeight - pad) {
      top = window.innerHeight - menuRect.height - pad
    }
    if (top < pad) top = pad
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  function showContextMenu(clientX, clientY, rowIndex, colIndex) {
    const menu = ensureContextMenu()
    menu.dataset.row = String(rowIndex)
    menu.dataset.col = String(colIndex)
    const deleteBtn = menu.querySelector('[data-action="delete-row"]')
    if (deleteBtn && selectionActive && isMultiRowFullSelection()) {
      const { r1, r2 } = selectionBounds()
      deleteBtn.textContent = `删除 ${r2 - r1 + 1} 行`
      menu.dataset.deleteR1 = String(r1)
      menu.dataset.deleteR2 = String(r2)
    } else {
      if (deleteBtn) deleteBtn.textContent = '删除行'
      delete menu.dataset.deleteR1
      delete menu.dataset.deleteR2
    }
    menu.hidden = false
    menu.style.left = '0'
    menu.style.top = '0'
    const rect = menu.getBoundingClientRect()
    const pad = 8
    let left = clientX
    let top = clientY
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad
    }
    menu.style.left = `${Math.max(pad, left)}px`
    menu.style.top = `${Math.max(pad, top)}px`
  }

  function syncPreviewRow() {
    if (!selectionActive) return
    const bounds = selectionBounds()
    const ri = selection.focusRow
    const previewRow = options.getPreviewDisplayedRow?.() ?? options.getSelectedRow()
    if (ri !== previewRow) {
      options.setSelectedRow(ri)
      options.onRowSelect?.(ri)
      return
    }
    if (isFullRowSelection(bounds)) {
      options.setSelectedCol?.(0)
      return
    }
    if (hasRectSelection(bounds)) {
      options.setSelectedCol?.(selection.focusCol)
      return
    }
    const cols = getColumns()
    const colName = cols[selection.focusCol] || ''
    options.setSelectedCol?.(selection.focusCol)
    options.onCellFocus?.(ri, colName, selection.focusCol)
  }

  /** 合并同一帧内的预览同步，避免每次点击触发沉重布局/SVG 更新 */
  function scheduleSyncPreviewRow() {
    if (syncPreviewRaf) return
    syncPreviewRaf = requestAnimationFrame(() => {
      syncPreviewRaf = 0
      syncPreviewRow()
    })
  }

  /** 将表格 DOM 中的单元格写回 getData()（保存前调用） */
  function flushEdits() {
    exitEdit(true)
    const dataRef = options.getData()
    const cols = getColumns()
    let maxRi = -1
    container.querySelectorAll('tbody .spreadsheet-cell').forEach((cell) => {
      const ri = Number(cell.dataset.row)
      if (!Number.isNaN(ri)) maxRi = Math.max(maxRi, ri)
    })
    while (dataRef.length <= maxRi) {
      dataRef.push(Object.fromEntries(cols.map((c) => [c, ''])))
    }
    container.querySelectorAll('tbody .spreadsheet-cell').forEach((cell) => {
      const ri = Number(cell.dataset.row)
      const col = cell.dataset.col
      if (Number.isNaN(ri) || !col || !dataRef[ri]) return
      dataRef[ri][col] = cellValueFromDom(cell)
    })
  }

  function exitEdit(save = true) {
    if (!editing) return
    if (caretPlacementRaf) {
      cancelAnimationFrame(caretPlacementRaf)
      caretPlacementRaf = 0
    }
    const cell = getCellElement(editing.row, editing.col)
    if (cell) {
      const ri = editing.row
      const col = cell.dataset.col
      const dataRef = options.getData()
      if (save && dataRef[ri] && col) {
        dataRef[ri][col] = cellValueFromDom(cell)
        options.onCellChange?.(ri, col, dataRef[ri][col])
        options.onEditCommit?.()
      }
      cell.contentEditable = 'false'
      setCellDomContent(cell, dataRef[ri]?.[col] ?? '')
    }
    editing = null
    releaseEditRowHeightLock()
    applySelectionVisuals()
  }

  function collapseSelectionToFocusCell() {
    clearDisjointSelection()
    let { focusRow, focusCol } = selection
    if (isFullRowSelection()) {
      focusCol = 0
      selection.focusCol = 0
    }
    selection.anchorRow = focusRow
    selection.anchorCol = focusCol
    selection.focusRow = focusRow
    selection.focusCol = focusCol
    options.setSelectedRow?.(focusRow)
    options.setSelectedCol?.(focusCol)
    applySelectionVisuals()
  }

  function isDirectTypingKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
    if (e.key.length !== 1) return false
    if (e.key === '\n' || e.key === '\t') return false
    return true
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  function enterEdit(row, colIndex, opts = {}) {
    const { placeCaretAtEndOnStart = false } = opts
    selectionActive = true
    isDragging = false
    if (options.readOnly) return
    exitEdit(true)
    ensureVirtualRowVisible(row)
    const cell = getCellElement(row, colIndex)
    if (!cell) return
    editing = { row, col: colIndex }
    lockRowHeightForEdit(row)
    const dataRef = options.getData()
    const col = cell.dataset.col
    const val = dataRef[row]?.[col] ?? ''
    if (isImageCellValue(val)) {
      cell.textContent = imageCellUrl(val)
      delete cell.dataset.imageCell
    }
    cell.contentEditable = 'true'
    cell.focus()
    if (caretPlacementRaf) {
      cancelAnimationFrame(caretPlacementRaf)
      caretPlacementRaf = 0
    }
    // 仅双击进入编辑时：延迟一帧把光标放到末尾，避免浏览器按“选词”整格全选
    if (placeCaretAtEndOnStart) {
      caretPlacementRaf = requestAnimationFrame(() => {
        caretPlacementRaf = 0
        if (!editing || editing.row !== row || editing.col !== colIndex) return
        if (!cell.isConnected) return
        placeCaretAtEnd(cell)
      })
    }
    applySelectionVisuals()
  }

  function moveSelection(row, colIndex, opts = {}) {
    clearDisjointSelection()
    selectionActive = true
    const { extend = false } = opts
    const cols = getColumns()
    const data = options.getData()
    const maxR = Math.max(0, data.length - 1)
    const maxC = Math.max(0, cols.length - 1)
    const nr = Math.max(0, Math.min(row, maxR))
    const nc = Math.max(0, Math.min(colIndex, maxC))
    if (extend) {
      selection.focusRow = nr
      selection.focusCol = nc
    } else {
      selection.anchorRow = nr
      selection.anchorCol = nc
      selection.focusRow = nr
      selection.focusCol = nc
    }
    options.setSelectedCol?.(nc)
    applySelectionVisuals()
    scheduleSyncPreviewRow()
    focusGrid()
  }

  function focusGrid() {
    container.focus({ preventScroll: true })
  }

  function wireInteraction() {
    if (interactionWired) return
    interactionWired = true
    container.tabIndex = 0
    container.classList.add('spreadsheet-wrap--selectable')
    ensurePointerSelectionCapture()

    const onScroll = () => {
      scheduleOverlayUpdate()
      scheduleVirtualScrollUpdate()
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      if (e.target.closest(
        '.spreadsheet-cell, .spreadsheet-meta-cell, .spreadsheet-col-head, .spreadsheet-meta-col-head, .spreadsheet-row-head, .spreadsheet-selection-handle, .spreadsheet-col-resizer, .spreadsheet-row-resizer',
      )) return
      if (options.onBlankAreaPointerDown) {
        options.onBlankAreaPointerDown()
      } else {
        clearCellSelection()
      }
      if (!options.readOnly) focusGrid()
    })

    container.addEventListener('contextmenu', (e) => {
      if (options.readOnly) return
      if (e.target.closest('.spreadsheet-row-resizer')) return

      const colHead = e.target.closest('.spreadsheet-col-head')
      if (colHead && container.contains(colHead)) {
        if (e.target.closest('.spreadsheet-col-resizer')) return
        if (!options.onRenameColumn && !options.onAddColumnRight && !options.onDeleteColumn) return
        e.preventDefault()
        hideContextMenu()
        const ci = Number(colHead.dataset.colIdx)
        if (Number.isNaN(ci)) return
        const colName = colHead.dataset.col || getColumns()[ci] || ''
        exitEdit(true)
        selectEntireColumn(ci)
        options.onColumnSelect?.(ci, colName)
        refreshRowHighlight()
        showColHeadContextMenu(e.clientX, e.clientY, ci, colName, colHead)
        return
      }

      if (!options.onAddRowBelow && !options.onDeleteRow && !options.onDeleteRows
        && !options.onAddColumnRight && !options.onDeleteColumn) return

      const rowHead = e.target.closest('td.spreadsheet-row-head[data-row]')
      if (rowHead && container.contains(rowHead)) {
        e.preventDefault()
        const ri = Number(rowHead.dataset.row)
        if (Number.isNaN(ri)) return
        if (editing) exitEdit(true)
        if (!isRowInMultiRowFullSelection(ri)) {
          selectEntireRow(ri)
        } else {
          selectionActive = true
          selection.focusRow = ri
          options.setSelectedRow?.(ri)
          applySelectionVisuals()
        }
        showContextMenu(e.clientX, e.clientY, ri, 0)
        return
      }

      const cell = e.target.closest('.spreadsheet-cell')
      if (!cell || !container.contains(cell)) return
      e.preventDefault()
      const ri = Number(cell.dataset.row)
      const ci = Number(cell.dataset.colIdx)
      if (Number.isNaN(ri) || Number.isNaN(ci)) return
      if (editing && (editing.row !== ri || editing.col !== ci)) exitEdit(true)

      if (isRowInMultiRowFullSelection(ri)) {
        selectionActive = true
        selection.focusRow = ri
        options.setSelectedRow?.(ri)
        applySelectionVisuals()
      } else {
        selectionActive = true
        selection.anchorRow = ri
        selection.focusRow = ri
        selection.anchorCol = ci
        selection.focusCol = ci
        options.setSelectedRow?.(ri)
        options.setSelectedCol?.(ci)
        applySelectionVisuals()
        scheduleSyncPreviewRow()
      }
      showContextMenu(e.clientX, e.clientY, ri, ci)
    })

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      if (e.button === 0) hideContextMenu()
      if (e.target.closest('.spreadsheet-selection-handle')) return

      const cornerHead = e.target.closest('thead .spreadsheet-corner-head')
      if (cornerHead && container.contains(cornerHead)) {
        e.preventDefault()
        if (!options.readOnly) exitEdit(true)
        selectAllData()
        return
      }

      if (options.readOnly) return
      const cell = e.target.closest('.spreadsheet-cell')
      if (!cell || !container.contains(cell)) return

      const ri = Number(cell.dataset.row)
      const ci = Number(cell.dataset.colIdx)
      if (editing) {
        if (editing.row === ri && editing.col === ci) {
          isDragging = false
          if (caretPlacementRaf) {
            cancelAnimationFrame(caretPlacementRaf)
            caretPlacementRaf = 0
          }
          return
        }
        exitEdit(true)
      }

      e.preventDefault()
      selectionActive = true
      cellPointerDown = { x: e.clientX, y: e.clientY, ri, ci }
      isDragging = false

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        toggleDisjointCell(ri, ci)
        selectionActive = !!disjointCells?.size
        cellPointerDown = null
        if (selectionActive) {
          selection.focusRow = ri
          selection.focusCol = ci
          selection.anchorRow = ri
          selection.anchorCol = ci
          options.setSelectedRow?.(ri)
          options.setSelectedCol?.(ci)
        }
        applySelectionVisuals()
        scheduleSyncPreviewRow()
        focusGrid()
        return
      }

      clearDisjointSelection()
      prepareVirtualRowForInteraction(ri)
      if (e.shiftKey) {
        selection.focusRow = ri
        selection.focusCol = ci
      } else {
        selection.anchorRow = ri
        selection.anchorCol = ci
        selection.focusRow = ri
        selection.focusCol = ci
      }
      options.setSelectedRow?.(ri)
      options.setSelectedCol?.(ci)
      applySelectionVisuals()
      focusGrid()
    })

    document.addEventListener('mousemove', (e) => {
      if (options.readOnly || editing) return

      if (isFillDragging) {
        updateDragSelectionFromPoint(e.clientX, e.clientY)
        scheduleAutoScroll(e.clientX, e.clientY)
        return
      }

      if (cellPointerDown && !isDragging) {
        const dx = e.clientX - cellPointerDown.x
        const dy = e.clientY - cellPointerDown.y
        if (Math.hypot(dx, dy) >= 4) {
          clearDisjointSelection()
          isDragging = true
        }
      }

      if (!isDragging) return
      updateDragSelectionFromPoint(e.clientX, e.clientY)
      scheduleAutoScroll(e.clientX, e.clientY)
    })

    document.addEventListener('mouseup', () => {
      if (isFillDragging) {
        stopAutoScroll()
        finishFillDrag()
        return
      }
      const hadPointerDown = !!cellPointerDown
      const wasDragging = isDragging
      cellPointerDown = null
      stopAutoScroll()
      if (!wasDragging && !hadPointerDown) return
      isDragging = false
      scheduleSyncPreviewRow()
    })

    container.addEventListener('dblclick', (e) => {
      if (options.readOnly) return
      const cell = e.target.closest('.spreadsheet-cell')
      if (!cell || !container.contains(cell)) return
      e.preventDefault()
      enterEdit(Number(cell.dataset.row), Number(cell.dataset.colIdx), {
        placeCaretAtEndOnStart: true,
      })
    })

    container.addEventListener('keydown', (e) => {
      const cols = getColumns()
      const { focusRow: ri, focusCol: ci } = selection

      if (e.key === 'Escape') {
        hideContextMenu()
        if (editing && !options.readOnly) {
          e.preventDefault()
          const cell = getCellElement(editing.row, editing.col)
          if (cell) {
            const dataRef = options.getData()
            const col = cell.dataset.col
            if (dataRef[editing.row] && col) {
              cell.textContent = dataRef[editing.row][col] ?? ''
            }
          }
          exitEdit(false)
          focusGrid()
          return
        }
        if (!editing) {
          e.preventDefault()
          clearCellSelection()
        }
        return
      }

      if (options.readOnly) return

      if (editing) return

      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        selectAllData()
        return
      }

      if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        copySelection()
        return
      }

      if ((e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        copySelection().then(() => clearSelectedCells())
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        clearSelectedCells()
        return
      }

      if (isDirectTypingKey(e) && selectionActive) {
        e.preventDefault()
        collapseSelectionToFocusCell()
        const { focusRow: typeRow, focusCol: typeCol } = selection
        const col = cols[typeCol]
        const dataRef = options.getData()
        if (col && dataRef[typeRow]) {
          dataRef[typeRow][col] = e.key
          options.onCellChange?.(typeRow, col, e.key)
        }
        enterEdit(typeRow, typeCol, { placeCaretAtEndOnStart: true })
        return
      }

      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault()
        enterEdit(ri, ci, { placeCaretAtEndOnStart: true })
        return
      }

      if (e.key === ' ' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        selectEntireRow(ri, { extend: e.shiftKey })
        return
      }

      if (e.key === ' ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        selectEntireColumn(ci)
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        const nextCi = e.shiftKey ? ci - 1 : ci + 1
        if (nextCi >= 0 && nextCi < cols.length) moveSelection(ri, nextCi)
        else if (!e.shiftKey && ri + 1 < options.getData().length) moveSelection(ri + 1, 0)
        else if (e.shiftKey && ri > 0) moveSelection(ri - 1, cols.length - 1)
        return
      }

      let nr = ri
      let nc = ci
      const extend = e.shiftKey
      const mod = e.ctrlKey || e.metaKey
      const maxR = options.getData().length - 1
      const maxC = cols.length - 1

      if (e.key === 'Home') {
        e.preventDefault()
        nr = mod ? 0 : ri
        nc = mod ? 0 : 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nr = mod ? maxR : ri
        nc = mod ? maxC : maxC
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        nr = Math.max(0, ri - visibleRowPageSize())
        container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight * 0.85)
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        nr = Math.min(maxR, ri + visibleRowPageSize())
        container.scrollTop += container.clientHeight * 0.85
      } else if (e.key === 'ArrowUp' && ri > 0) { e.preventDefault(); nr = ri - 1 }
      else if (e.key === 'ArrowDown' && ri < maxR) { e.preventDefault(); nr = ri + 1 }
      else if (e.key === 'ArrowLeft' && ci > 0) { e.preventDefault(); nc = ci - 1 }
      else if (e.key === 'ArrowRight' && ci < maxC) { e.preventDefault(); nc = ci + 1 }
      else return

      moveSelection(nr, nc, { extend })
    })

    container.addEventListener('copy', (e) => {
      if (options.readOnly || editing) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', selectionToTsv())
    })

    async function tryPasteCellImageFromClipboard(clipboardData, { singleCell = false } = {}) {
      if (!options.onSetCellImage || !clipboardData) return false
      let files = collectClipboardImageFiles(clipboardData)
      if (!files.length) {
        files = await readClipboardImageFilesAsync()
      }
      if (!files.length) return false

      const html = readClipboardHtml(clipboardData)
      const file = pickWpsEmbeddedImageFile(files, html, { singleCell })
      if (!file) return false

      const { focusRow: ri, focusCol: ci } = selection
      try {
        await options.onSetCellImage(ri, ci, file)
        return true
      } catch (err) {
        console.error(err)
        return false
      }
    }

    function isSingleCellDispImgPaste(clipboardData, grid) {
      const plain = readClipboardPlainText(clipboardData)
      if (isDispImgFormula(plain) && !plain.includes('\t') && !plain.includes('\n')) return true
      if (grid.length === 1 && grid[0].length === 1 && isDispImgFormula(grid[0][0])) return true
      return false
    }

    function isMultiCellTablePaste(clipboardData, grid) {
      const plain = readClipboardPlainText(clipboardData)
      if (plain.includes('\t')) return true
      if (grid.length > 1) return true
      if (grid.length === 1 && grid[0].length > 1) return true
      return false
    }

    function clipboardNeedsRichTableImport(clipboardData, grid) {
      if (/clip_cell_image\d+/i.test(readClipboardHtml(clipboardData))) return true
      return grid.some((row) => row.some((cell) => isDispImgFormula(String(cell ?? ''))))
    }

    async function applyClipboardPaste(clipboardData) {
      if (options.readOnly || !clipboardData) return false

      const payload = clipboardPastePayload(clipboardData)
      let grid = payload.grid
      if (!grid.length) {
        const plain = readClipboardPlainText(clipboardData)
        if (plain.trim()) {
          grid = parseClipboardPlainToMatrix(plain)
        }
      }

      if (editing) {
        if (isMultiCellTablePaste(clipboardData, grid) && grid.length) {
          exitEdit(true)
        } else {
          return false
        }
      }

      if (isSingleCellDispImgPaste(clipboardData, grid)) {
        const ok = await tryPasteCellImageFromClipboard(clipboardData, { singleCell: true })
        if (ok) {
          syncDataAfterPaste()
          render()
          return true
        }
        options.onPasteImageUnavailable?.()
        return true
      }

      if (
        isMultiCellTablePaste(clipboardData, grid)
        && grid.length
        && options.onImportClipboardTable
        && clipboardNeedsRichTableImport(clipboardData, grid)
      ) {
        const { r1 } = selectionBounds()
        try {
          const ok = await options.onImportClipboardTable(clipboardData, { startRow: r1, startCol: selectionBounds().c1 })
          if (ok) {
            syncDataAfterPaste()
            render()
            return true
          }
        } catch (err) {
          console.error(err)
        }
      }

      if (grid.length) {
        pasteGrid(grid)
        return true
      }

      if (options.onSetCellImage && clipboardData.items?.length) {
        const ok = await tryPasteCellImageFromClipboard(clipboardData)
        if (ok) return true
      }

      return false
    }

    function isDocumentPasteScopeActive(e) {
      const scope = options.documentPasteScope
      if (!scope) return false
      if (typeof scope === 'function') return !!scope()
      return !!(e.target?.closest?.(scope) || document.activeElement?.closest?.(scope))
    }

    function shouldIgnoreDocumentPasteTarget(target) {
      if (!target?.closest) return false
      if (target.closest('.spreadsheet-wrap')) return false
      return !!target.closest('input, textarea, select, [contenteditable="true"]')
    }

    container.addEventListener('paste', async (e) => {
      if (!e.clipboardData) return
      const handled = await applyClipboardPaste(e.clipboardData)
      if (!handled) return
      e.preventDefault()
      e.stopPropagation()
    })

    if (options.documentPasteScope) {
      documentPasteHandler = async (e) => {
        if (disposed || !container.isConnected) return
        if (!e.clipboardData) return
        if (!isDocumentPasteScopeActive(e)) return
        if (shouldIgnoreDocumentPasteTarget(e.target)) return
        const handled = await applyClipboardPaste(e.clipboardData)
        if (!handled) return
        e.preventDefault()
        e.stopPropagation()
        if (!container.contains(document.activeElement)) {
          focusGrid()
        }
      }
      document.addEventListener('paste', documentPasteHandler, true)
    }
  }

  function ensureCellEditorDelegation() {
    if (cellEditorsDelegated) return
    cellEditorsDelegated = true

    const notifyCellChange = (e) => {
      if (!editing) return
      const cell = e.target.closest('.spreadsheet-cell')
      if (!cell || !container.contains(cell)) return
      const ri = Number(cell.dataset.row)
      const col = cell.dataset.col
      if (ri !== editing.row || Number(cell.dataset.colIdx) !== editing.col) return
      const dataRef = options.getData()
      if (!dataRef[ri] || !col) return
      dataRef[ri][col] = cellValueFromDom(cell)
      options.onCellChange?.(ri, col, dataRef[ri][col])
    }

    container.addEventListener('input', notifyCellChange)
    container.addEventListener('compositionend', notifyCellChange)

    container.addEventListener('keydown', (e) => {
      if (!editing) return
      const cell = getCellElement(editing.row, editing.col)
      if (!cell) return
      const target = e.target
      if (target !== cell && !cell.contains(target)) return

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        exitEdit(true)
        const maxR = Math.max(0, options.getData().length - 1)
        moveSelection(Math.min(editing.row + 1, maxR), editing.col)
        focusGrid()
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        exitEdit(true)
        moveTabFromCell(editing.row, editing.col, e.shiftKey)
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        const dataRef = options.getData()
        const col = cell.dataset.col
        if (dataRef[editing.row] && col) {
          cell.textContent = dataRef[editing.row][col] ?? ''
        }
        exitEdit(false)
        focusGrid()
        return
      }
      if (
        e.key === 'Enter'
        || e.key === 'ArrowUp'
        || e.key === 'ArrowDown'
        || e.key === 'ArrowLeft'
        || e.key === 'ArrowRight'
        || e.key === 'Home'
        || e.key === 'End'
      ) {
        e.stopPropagation()
      }
    }, true)
  }

  function wireCellEditors() {
    ensureCellEditorDelegation()
  }

  function refreshRowHighlight() {
    const bounds = selectionActive ? selectionBounds() : null
    container.querySelectorAll('tbody tr[data-row]').forEach((tr) => {
      tr.classList.toggle('selected', isRowHighlighted(Number(tr.dataset.row), bounds))
    })
  }

  function refreshColumnHighlight() {
    const bounds = selectionActive && isFullColumnSelection() ? selectionBounds() : null
    container.querySelectorAll('.spreadsheet-col-head').forEach((th) => {
      const ci = Number(th.dataset.colIdx)
      th.classList.toggle('selected-col', isColumnHighlighted(ci, bounds))
    })
    container.querySelectorAll('.spreadsheet-cell').forEach((cell) => {
      const ci = Number(cell.dataset.colIdx)
      cell.classList.toggle('selected-col', isColumnHighlighted(ci, bounds))
    })
  }

  function buildDataRowsHtml(startRi, endRi, data, cols, trailingCols, readOnly, selectionBoundsForRender, fullColBounds) {
    const dataColCount = cols.length
    let html = ''
    for (let ri = startRi; ri <= endRi; ri++) {
      const row = data[ri]
      const sel = isRowHighlighted(ri, selectionBoundsForRender) ? ' selected' : ''
      html += `<tr class="${sel}" data-row="${ri}">`
      html += `<td class="spreadsheet-row-head" data-row="${ri}" title="拖拽选择多行；拖动下边缘调整行高">`
      html += `<span class="spreadsheet-row-head-num">${ri + 1}</span>`
      if (!readOnly) {
        html += `<span class="spreadsheet-row-resizer" data-resize-row="${ri}" title="拖动调整行高"></span>`
      }
      html += `</td>`
      cols.forEach((col, ci) => {
        const val = row[col] ?? ''
        const colSel = isColumnHighlighted(ci, fullColBounds) ? ' selected-col' : ''
        const editable = readOnly ? '' : ' contenteditable="false"'
        const imageAttr = isImageCellValue(val) ? ' data-image-cell="1"' : ''
        html += `<td class="spreadsheet-cell${colSel}"${editable} spellcheck="false"`
        html += ` data-row="${ri}" data-col="${escapeAttr(col)}" data-col-idx="${ci}"${imageAttr}>${formatCellContent(val)}</td>`
      })
      trailingCols.forEach((metaCol, mi) => {
        const absIdx = dataColCount + mi
        const cellContent = options.renderTrailingCell?.(ri, metaCol, mi, absIdx) ?? ''
        html += `<td class="spreadsheet-meta-cell" data-row="${ri}" data-meta-col="${escapeAttr(metaCol.id)}" data-col-idx="${absIdx}">${cellContent}</td>`
      })
      html += '</tr>'
    }
    return html
  }

  function buildTbodyHtml(data, cols, trailingCols, readOnly, selectionBoundsForRender, fullColBounds) {
    const colspan = 1 + cols.length + trailingCols.length
    if (useVirtualRows && data.length > VIRTUAL_ROW_THRESHOLD) {
      const { start, end } = virtualRange
      const topPad = sumRowHeightsPx(0, start - 1)
      const bottomPad = sumRowHeightsPx(end + 1, data.length - 1)
      return (
        buildVirtualSpacerRow(topPad, colspan)
        + buildDataRowsHtml(start, end, data, cols, trailingCols, readOnly, selectionBoundsForRender, fullColBounds)
        + buildVirtualSpacerRow(bottomPad, colspan)
      )
    }
    return buildDataRowsHtml(0, data.length - 1, data, cols, trailingCols, readOnly, selectionBoundsForRender, fullColBounds)
  }

  function patchVirtualTableBody() {
    const data = options.getData()
    const readOnly = !!options.readOnly
    const cols = getColumns()
    const trailingCols = getTrailingColumns()
    const selectionBoundsForRender = selectionActive ? selectionBounds() : null
    const fullColBounds = selectionBoundsForRender && isFullColumnSelection(selectionBoundsForRender)
      ? selectionBoundsForRender
      : null
    const tbody = container.querySelector('tbody.spreadsheet-tbody')
    if (!tbody) return
    const preserveEdit = editing
    tbody.innerHTML = buildTbodyHtml(data, cols, trailingCols, readOnly, selectionBoundsForRender, fullColBounds)
    if (!readOnly) {
      ensureCellEditorDelegation()
      ensureRowResizerDelegation()
      if (preserveEdit) {
        enterEdit(preserveEdit.row, preserveEdit.col)
      } else {
        applySelectionVisuals()
      }
    }
    applyRowHeights()
    wireLazyCellImages()
    applySearchHighlights()
    refreshRowHighlight()
    options.wireTrailingControls?.(container)
    requestAnimationFrame(() => updateSelectionOverlay())
  }

  function render() {
    const data = options.getData()
    const selectedRow = options.getSelectedRow()
    const readOnly = !!options.readOnly
    const cols = getColumns()

    if (data.length !== lastRenderedDataLen) {
      lastRenderedDataLen = data.length
      invalidateRowGeometry()
    }

    clampSelection()
    if (
      !isMultiRowFullSelection()
      && !hasRectSelection()
      && selection.focusRow !== selectedRow
    ) {
      selection.focusRow = selectedRow
      selection.anchorRow = selectedRow
    }

    useVirtualRows = isVirtualScrollEnabled()
    if (useVirtualRows) {
      virtualRange = computeVirtualRowRange(data.length)
    } else {
      virtualRange = { start: 0, end: Math.max(0, data.length - 1) }
    }

    const preserveEdit = editing
    const selectionBoundsForRender = selectionActive ? selectionBounds() : null
    const fullColBounds = selectionBoundsForRender && isFullColumnSelection(selectionBoundsForRender)
      ? selectionBoundsForRender
      : null

    const trailingCols = getTrailingColumns()
    let html = '<table class="spreadsheet-table"><thead><tr>'
    html += '<th class="spreadsheet-row-head spreadsheet-corner-head" title="点击全选">#</th>'
    cols.forEach((c, ci) => {
      const colSel = isColumnHighlighted(ci, fullColBounds) ? ' selected-col' : ''
      html += `<th class="spreadsheet-col-head${colSel}" data-col-idx="${ci}" data-col="${escapeAttr(c)}" title="点击选中整列；Shift+点击扩展；拖拽多选列">`
      html += `<span class="spreadsheet-col-head-inner">`
      html += `<span class="spreadsheet-col-head-label">${escapeHtml(c)}</span>`
      html += `</span>`
      html += `<span class="spreadsheet-col-resizer" data-resize-col="${ci}" title="拖动调整本列宽度"></span></th>`
    })
    const dataColCount = cols.length
    trailingCols.forEach((metaCol, mi) => {
      const absIdx = dataColCount + mi
      const headContent = options.renderTrailingColHead?.(metaCol, mi, absIdx)
        ?? `<span class="spreadsheet-col-head-label">${escapeHtml(metaCol.label)}</span>`
      html += `<th class="spreadsheet-meta-col-head" data-meta-col="${escapeAttr(metaCol.id)}" data-col-idx="${absIdx}" title="${escapeAttr(metaCol.label)}">`
      html += `<span class="spreadsheet-col-head-inner">${headContent}</span></th>`
    })
    html += `</tr></thead><tbody class="spreadsheet-tbody">`
    html += buildTbodyHtml(data, cols, trailingCols, readOnly, selectionBoundsForRender, fullColBounds)
    html += '</tbody></table>'
    container.innerHTML = html
    selectionOverlay = null
    columnWidths = buildColumnWidthsFromStorage(cols, getDefaultColumnWidth())

    if (!readOnly) {
      ensureColumnResizeListeners()
      ensureRowResizeListeners()
      wireRowHeadInteraction()
      wireColHeadInteraction()

      wireInteraction()
      wireCellEditors()
      wireRowResizers()

      if (preserveEdit) {
        enterEdit(preserveEdit.row, preserveEdit.col)
      } else {
        applySelectionVisuals()
      }
      wireColumnResizers()
    }

    applyColumnWidths()
    applyRowHeights()
    wireLazyCellImages()
    options.wireTrailingControls?.(container)
    applySearchHighlights()

    if (readOnly) {
      wireReadOnlyChrome()
      syncSelectionFromOptions()
      container.querySelectorAll('tbody tr[data-row]').forEach((tr) => {
        tr.classList.add('spreadsheet-row-clickable')
        tr.addEventListener('click', (e) => {
          const cell = e.target.closest('.spreadsheet-cell')
          const ri = Number(tr.dataset.row)
          if (Number.isNaN(ri)) return

          if (cell) {
            const colName = cell.dataset.col || ''
            const ci = Number(cell.dataset.colIdx)
            if (Number.isNaN(ci) || !colName) return
            const previewRow = options.getPreviewDisplayedRow?.() ?? options.getSelectedRow()
            const rowChanged = previewRow !== ri
            selectReadOnlyCell(ri, ci, colName)
            scrollToRow(ri)
            if (rowChanged) {
              options.onRowSelect?.(ri)
            }
            return
          }

          const previewRow = options.getPreviewDisplayedRow?.() ?? options.getSelectedRow()
          const rowChanged = previewRow !== ri
          if (rowChanged) {
            options.onRowSelect?.(ri)
          }
          selectEntireRow(ri)
          scrollToRow(ri)
        })
      })
      applySelectionVisuals()
      refreshColumnHighlight()
      requestAnimationFrame(() => updateSelectionOverlay())
    }
  }

  function scrollToRow(rowIndex) {
    const data = options.getData()
    const ri = Math.max(0, Math.min(rowIndex, Math.max(0, data.length - 1)))
    if (useVirtualRows) {
      container.scrollTop = getRowOffsetTopPx(ri)
      virtualRange = computeVirtualRowRange(data.length)
      patchVirtualTableBody()
    }
    const tr = container.querySelector(`tbody tr[data-row="${ri}"]`)
    tr?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: useVirtualRows ? 'auto' : 'smooth' })
  }

  /** 预览翻页后与表格行对齐：多格选区时仅滚动，不收拢为单格 */
  function syncPageRowSelection(rowIndex, colIndex) {
    const data = options.getData()
    if (!data.length) return
    const ri = Math.max(0, Math.min(rowIndex, data.length - 1))
    const cols = getColumns()
    const ci = colIndex ?? options.getSelectedCol?.() ?? -1
    options.setSelectedRow?.(ri)

    if (hasRectSelection()) {
      selectionActive = true
      applySelectionVisuals()
      scrollToCell(selection.focusRow, selection.focusCol, { moveSelection: false })
      requestAnimationFrame(() => updateSelectionOverlay())
      return
    }

    if (ci >= 0 && ci < cols.length) {
      clearDisjointSelection()
      selectionActive = true
      selection.anchorRow = ri
      selection.focusRow = ri
      selection.anchorCol = ci
      selection.focusCol = ci
      options.setSelectedCol?.(ci)
      applySelectionVisuals()
      refreshColumnHighlight()
      scrollToCell(ri, ci, { moveSelection: false })
      requestAnimationFrame(() => updateSelectionOverlay())
      return
    }

    selectEntireRow(ri)
    scrollToRow(ri)
    requestAnimationFrame(() => updateSelectionOverlay())
  }

  function scrollToCell(rowIndex, colIndex, { moveSelection: shouldMove } = {}) {
    const cell = getCellElement(rowIndex, colIndex)
    if (!cell) return
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    if (shouldMove === undefined) {
      shouldMove = !options.readOnly && !isFullRowSelection()
    }
    if (shouldMove) {
      moveSelection(rowIndex, colIndex)
      focusGrid()
    }
  }

  function dispose() {
    disposed = true
    stopAutoScroll()
    lazyImageObserver?.disconnect()
    lazyImageObserver = null
    loadedCellImageSrcs.clear()
    interactionWired = false
    pointerSelectionCaptureWired = false
    readOnlyChromeWired = false
    cellEditorsDelegated = false
    rowResizersDelegated = false
    rowHeadPointerDelegated = false
    if (documentPasteHandler) {
      document.removeEventListener('paste', documentPasteHandler, true)
      documentPasteHandler = null
    }
  }

  return {
    render,
    getColumns,
    flushEdits,
    scrollToCell,
    scrollToRow,
    syncPageRowSelection,
    refreshRowHighlight,
    refreshColumnHighlight,
    refreshSelectionVisuals,
    selectEntireColumn,
    selectEntireRow,
    clearSelection: clearCellSelection,
    hasActiveSelection: () => selectionActive,
    isFullRowSelection: () => selectionActive && !hasDisjointSelection() && isFullRowSelection(),
    isMultiRowFullSelection: () => selectionActive && !hasDisjointSelection() && isMultiRowFullSelection(),
    hasRectSelection: () => hasRectSelection(),
    hasDisjointSelection,
    dispose,
    setSearchQuery,
    gotoNextSearchMatch,
    gotoPrevSearchMatch,
    getSearchState,
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;')
}
