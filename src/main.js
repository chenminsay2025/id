import {
  COLUMNS,
  COLUMN_TO_FIELD,
  generateSvgFromRow,
  refillSvgRowText,
  setActiveFontCatalog,
  serializeSvgForExport,
  setReferenceLayerVisible,
  setTemplateDecorVisible,
  loadExcelData,
  parsePastedText,
  parseDataRowsFromClipboard,
  parseDataCellRowsFromTSVText,
  rowFromValues,
  isMultiCellClipboard,
  emptyRow,
  setSvgFieldHighlight,
  resolveColumnFromPreviewClick,
  getColumnLayout,
  isLayoutBoxActive,
} from './svgEngine.js'
import { exportSvgToPdf, exportRowsToSinglePdf } from './pdfExport.js'
import { loadFontCatalog, ensureCatalogFontFaces, setFontLoadErrorHandler } from './fontCatalog.js'
import { mountFontNoticeBar, showFontNoticeErrors } from './admin/fontNotice.js'
import { setFontReloadHook } from './fontReload.js'
import { mountLayoutEditor } from './layoutEditor.js'
import { mountLayoutPanel } from './layoutPanel.js'
import {
  copyLayoutBoxToClipboard,
  copyLayoutBoxesToClipboard,
  pasteLayoutBoxesFromClipboard,
  ensureLayoutBoxClipboardReady,
  initLayoutBoxClipboardSync,
  tryImportLayoutBoxFromPasteEvent,
  hasLayoutBoxClipboard,
} from './layoutBoxClipboard.js'
import {
  createLayoutBox,
  defaultNewBoxBounds,
  deleteLayoutBox,
  hideLayoutBoxes,
  renameLayoutBox,
  renameLayoutColumn,
  resolveBoxId,
  getPrimaryColumnForBox,
  getColumnsForBox,
  syncAutoColumnBindings,
  listLayoutBoxIds,
  listCustomLayoutBoxIds,
  pruneLayoutOverridesForTable,
  applyTableTemplateScopeFlag,
} from './layoutBinding.js'
import {
  buildLayoutSettingsPayload,
  loadLayoutSettingsOnStartup,
  scheduleLayoutSettingsSave,
  flushLayoutSettingsSave,
  flushLayoutSettingsSaveKeepalive,
  downloadLayoutSettings,
  importLayoutSettingsFromFileInput,
  linkLayoutSettingsFile,
} from './layoutSettings.js'
import { logLayoutOverrideChange, logPersistLoad } from './persistLog.js'
import {
  loadTableFromStorage,
  scheduleTableSave,
  flushTableSave,
} from './tableStorage.js'
import {
  initLayoutHistory,
  updateLayoutHistoryBaseline,
  recordLayoutHistory,
  undoLayout,
  redoLayout,
  getLayoutHistoryState,
} from './layoutHistory.js'
import {
  initTableHistory,
  recordTableHistory,
  undoTable,
  redoTable,
  getTableHistoryState,
} from './tableHistory.js'
import { mountPreviewViewport } from './previewViewport.js'
import { defaultPreviewUi, mountPreviewFloat, normalizePreviewUi } from './previewFloat.js'
import { bootLayoutSwitchDebugHint, logLayoutSwitch } from './layoutSwitchDebug.js'
import {
  DEFAULT_ROW_HEIGHT,
  shiftRowHeightsForDelete,
  shiftRowHeightsForInsert,
} from './rowHeightUtils.js'
import {
  loadPreviewSettings,
  savePreviewSettings,
  PREVIEW_LAYER_TOGGLE_DEFAULTS,
} from './previewSettingsStorage.js'
import {
  getDefaultLayoutSettings,
  loadBakedLayoutSettingsFromServer,
  buildDefaultLayoutSettingsFromCurrent,
  saveDefaultLayoutSettingsToProject,
  downloadDefaultLayoutSettings,
} from './defaultLayoutSettings.js'
import { EMPTY_SVG_TEMPLATE, loadSvgTemplateContentResult } from './svgTemplateLoader.js'
import { requireAdminSession } from './admin/guard.js'
import { mountCmsBar } from './admin/cms.js'
import { loadSiteConfig, applyDocumentTitle } from './siteConfig.js'
import { api } from './api/client.js'
import { mountSpreadsheetTable } from './spreadsheetTable.js'
import { formatImageCellValue } from './cellMedia.js'
import { importTableFromClipboard } from './clipboardPasteImport.js'
import { replaceDispImgCellsInRows } from './excelEmbeddedImages.js'
import { loadExcelDataAsync } from './excelLoadAsync.js'
import { loadExcelZipArchive } from './excelZipPreload.js'
import {
  showExcelImportProgress,
  setExcelImportProgress,
  hideExcelImportProgress,
  formatImportFileSize,
  appendExcelImportLog,
  reportImageImportProgress,
} from './excelImportProgress.js'
import { yieldToMain } from './asyncYield.js'
import { LruCache } from './lruCache.js'
import {
  sanitizeCertificateRows,
  mapExcelImportToTemplateRows,
  formatExcelImportColumnReportSummary,
  listUnmatchedExcelColumns,
  applySampleAdornmentsToDisplayRow,
  applyPresetCustomSamplesToDisplayRow,
} from './presetSampleRow.js'
import {
  DEFAULT_PAGE_WIDTH_MM,
  DEFAULT_PAGE_HEIGHT_MM,
  normalizePageSizeMm,
} from './pageSize.js'

/** @type {string} */
let fontUrl = ''
/** @type {import('./fontCatalog.js').FontCatalog | null} */
let fontCatalog = null
/** 可选示例数据；将 excel.xlsx 放在 public/ 下即可启用 */
const DEFAULT_EXCEL_URL = '/excel.xlsx'

/** @type {Record<string, string>[]} */
let tableData = []
/** @type {(number|null)[]} 每行布局模板；null 表示使用证书默认布局 */
let rowPresetIds = []
let selectedRow = 0
let selectedCol = 0
let templateSvg = EMPTY_SVG_TEMPLATE
/** @type {number | null} */
let templateId = null
let fontScale = 1
let pageWidthMm = DEFAULT_PAGE_WIDTH_MM
let pageHeightMm = DEFAULT_PAGE_HEIGHT_MM
let showLayoutBoxes = false
let showReferenceLayer = false
let showTemplateLayer = true
let overlayShowBorder = true
let overlayShowHandles = true
/** @type {Record<string, object>} */
let layoutOverrides = {}

const LEGACY_STORAGE_KEY = 'catSvgGenerator.state.v1'
let skipSave = false
let skipTableHistory = false
let tableHistoryReady = false
/** @type {string[] | null} */
let columnOrder = null
/** @type {string[] | null} 布局预设关联的表格模板列（Excel 导入对照用） */
let tableTemplateColumns = null
/** @type {Record<string, string>} 布局预设样例行中的自定义编辑框默认内容 */
let presetCustomSamples = {}
/** @type {Record<string, { prefix: string[], suffix: string[] }>} 布局预设编辑框前后缀 */
let presetSampleAdornments = {}
let layoutEditor = null
let layoutPanel = null
const layoutPanelRoot = () => $('#layout-panel')

function isCertLayoutReadonly() {
  return document.body.classList.contains('cert-layout-readonly')
}

const $ = (sel) => document.querySelector(sel)

const tableWrap = $('#table-wrap')
let spreadsheet = null
const previewArea = $('#preview-area')
const statusEl = $('#status')
const rowCountEl = $('#row-count')
const previewIndexEl = $('#preview-index')
const showLayoutBoxesInput = $('#show-layout-boxes')
const showReferenceLayerInput = $('#show-reference-layer')
const showTemplateLayerInput = $('#show-template-layer')
const previewLayerColumnEl = $('#preview-layer-column')
const previewZoomValueEl = $('#preview-zoom-value')

const storedPreviewSettings = loadPreviewSettings()
/** @type {{ scale: number, panX: number, panY: number } | null} */
let pendingRestorePreviewView = storedPreviewSettings.view
let previewViewportFitPending = !pendingRestorePreviewView
let savePreviewSettingsTimer = 0
/** 递增以丢弃过期的异步 updatePreview 结果（避免对齐/字号与重建预览竞态） */
let previewGeneration = 0
let previewSwitchGeneration = 0
/** @type {LruCache<number, SVGSVGElement>} */
const rowSvgCache = new LruCache(12)
let previewFontReady = false
/** @type {ReturnType<typeof mountPreviewFloat> | null} */
let previewFloatController = null
/** @type {ReturnType<typeof defaultPreviewUi>} */
let previewUiState = defaultPreviewUi()
/** 当前预览区实际显示的行（与 selectedRow 区分：表格会先改 selectedRow 再触发切页） */
let previewDisplayedRow = -1
let schedulePreviewRaf = 0
/** @type {{ rowIndex: number, options?: object } | null} */
let scheduledPreviewJob = null
let suppressSelectionClearSync = false
const previewViewport = mountPreviewViewport(previewArea, {
  onScaleChange(scale) {
    if (previewZoomValueEl) {
      previewZoomValueEl.textContent = `${Math.round(scale * 100)}%`
    }
  },
  onViewChange() {
    layoutEditor?.repositionOverlay?.()
    scheduleSavePreviewSettings()
  },
})

function collectPreviewSettings() {
  return {
    panMode: previewViewport.getPanMode?.() ?? false,
    view: previewViewport.getViewState?.() ?? null,
  }
}

function resetPreviewLayerToggles() {
  showLayoutBoxes = PREVIEW_LAYER_TOGGLE_DEFAULTS.showLayoutBoxes
  showReferenceLayer = PREVIEW_LAYER_TOGGLE_DEFAULTS.showReferenceLayer
  showTemplateLayer = PREVIEW_LAYER_TOGGLE_DEFAULTS.showTemplateLayer
  syncPreviewToolbarToggles()
}

function scheduleSavePreviewSettings() {
  clearTimeout(savePreviewSettingsTimer)
  savePreviewSettingsTimer = window.setTimeout(() => {
    savePreviewSettings(collectPreviewSettings())
  }, 300)
}

function flushSavePreviewSettings() {
  clearTimeout(savePreviewSettingsTimer)
  savePreviewSettings(collectPreviewSettings())
}

/** @param {ReturnType<typeof loadPreviewSettings>} [prefs] */
function applyPreviewToolbarSettings(prefs = storedPreviewSettings) {
  if (!prefs) return
  resetPreviewLayerToggles()
  fontScale = 1
  const panOn = isCertLayoutReadonly() ? true : !!prefs.panMode
  previewViewport.setPanMode(panOn)
  $('#btn-preview-pan')?.classList.toggle('active', panOn)
}

function syncPreviewLayerSelection(columnName) {
  if (!previewLayerColumnEl) return
  const cols = getTableColumns()
  const name = columnName ?? (selectedCol >= 0 ? cols[selectedCol] : null) ?? null
  previewLayerColumnEl.textContent = name || '未选择'
  previewLayerColumnEl.title = name || '点击表格单元格或预览区字段以联动'
}

function applyCertLayoutToolbarUi() {
  if (!isCertLayoutReadonly()) return
  const layoutToggleLabel = showLayoutBoxesInput?.closest('label')
  if (layoutToggleLabel) {
    layoutToggleLabel.title = '显示编辑框区域（只读查看，不可拖拽修改；与表格联动）'
  }
  syncPreviewLayerSelection()
}

function applyCertPreviewPanMode() {
  if (!isCertLayoutReadonly()) return
  previewViewport.setPanMode(true)
  $('#btn-preview-pan')?.classList.toggle('active', true)
  applyCertLayoutToolbarUi()
}

function restorePreviewViewIfNeeded() {
  if (!pendingRestorePreviewView) return
  if (!previewArea.querySelector('.preview-stage')) return
  previewViewport.setViewState(pendingRestorePreviewView)
  pendingRestorePreviewView = null
}

function afterPreviewViewportContentReady() {
  requestAnimationFrame(() => {
    if (previewViewportFitPending) {
      previewViewport.fitView()
      previewViewportFitPending = false
    } else {
      restorePreviewViewIfNeeded()
    }
  })
}

applyPreviewToolbarSettings()

function setStatus(msg, ms = 3000) {
  statusEl.textContent = msg
  if (ms > 0) setTimeout(() => { statusEl.textContent = '' }, ms)
}

function getLayoutSettingsPayload() {
  return buildLayoutSettingsPayload({
    layoutOverrides,
    fontScale,
    showLayoutBoxes,
    showReferenceLayer,
    showTemplateLayer,
  })
}

/** 仅保存编辑框布局到 JSON，不保存表格证书数据 */
function persistLayoutSettings(reason = '编辑框布局') {
  if (skipSave) return
  scheduleLayoutSettingsSave(() => getLayoutSettingsPayload(), (msg) => {
    if (msg) setStatus(msg, 2500)
  }, reason)
}

function persistTableData() {
  if (skipSave) return
  scheduleTableSave(tableData, selectedRow)
}

function syncPreviewToolbarToggles() {
  if (showLayoutBoxesInput) showLayoutBoxesInput.checked = showLayoutBoxes
  if (showReferenceLayerInput) showReferenceLayerInput.checked = showReferenceLayer
  if (showTemplateLayerInput) showTemplateLayerInput.checked = showTemplateLayer
  layoutEditor?.setVisible?.(showLayoutBoxes)
}

/** @param {object} data @param {string} [source] @param {{ applyToolbarToggles?: boolean, syncEditor?: boolean }} [opts] */
function applyLayoutSettings(data, source = 'JSON', opts = {}) {
  const { applyToolbarToggles = true, syncEditor = true } = opts
  if (!data) return
  logPersistLoad(source, data)
  if (data.layoutOverrides && typeof data.layoutOverrides === 'object') {
    layoutOverrides = data.layoutOverrides
  }
  fontScale = 1
  if (applyToolbarToggles) {
    if (data.showLayoutBoxes != null) {
      showLayoutBoxes = !!data.showLayoutBoxes
    }
    if (data.showReferenceLayer != null) {
      showReferenceLayer = !!data.showReferenceLayer
    }
    if (data.showTemplateLayer != null) {
      showTemplateLayer = !!data.showTemplateLayer
    }
    syncPreviewToolbarToggles()
  }
  if (layoutPanel) layoutPanel.setOverrides(layoutOverrides)
  if (syncEditor && layoutEditor) layoutEditor.setOverrides(layoutOverrides)
  initLayoutHistory(layoutOverrides)
}

function getSvgRowData(rowIndex) {
  const row = tableData[rowIndex]
  if (!row) return {}
  const display = applySampleAdornmentsToDisplayRow(
    row,
    getTableColumns(),
    layoutOverrides,
    presetSampleAdornments,
  )
  return applyPresetCustomSamplesToDisplayRow(
    display,
    getDefinedTableColumns(),
    layoutOverrides,
    presetCustomSamples,
  )
}

function refreshPreviewLayout(restoreSelection = [], { affectedColumns = null } = {}) {
  const selection = restoreSelection.length
    ? restoreSelection
    : (layoutEditor?.getSelectedColumns?.() ?? layoutPanel?.getSelectedColumns?.() ?? [])

  const svgEl = previewArea.querySelector('.preview-stage svg')
  if (!svgEl || tableData.length === 0) return false

  const fillOpts = { fontScale, layoutOverrides, tableColumns: getDefinedTableColumns() }
  if (affectedColumns?.length) fillOpts.affectedColumns = affectedColumns
  refillSvgRowText(svgEl, getSvgRowData(selectedRow), fillOpts)
  rowSvgCache.set(rowCacheKey(selectedRow), /** @type {SVGSVGElement} */ (svgEl.cloneNode(true)))
  layoutPanel?.setOverrides(layoutOverrides)
  if (layoutEditor) {
    layoutEditor.syncOverrides?.(layoutOverrides) ?? layoutEditor.setOverrides(layoutOverrides)
    if (selection.length) layoutEditor.selectColumns(selection)
  }
  return true
}

function syncRowPresetIdsLength() {
  while (rowPresetIds.length < tableData.length) rowPresetIds.push(null)
  if (rowPresetIds.length > tableData.length) rowPresetIds.length = tableData.length
}

function setRowPresetId(rowIndex, presetId) {
  syncRowPresetIdsLength()
  if (rowIndex < 0 || rowIndex >= rowPresetIds.length) return
  rowPresetIds[rowIndex] = presetId != null && Number(presetId) > 0 ? Number(presetId) : null
  clearRowSvgCache()
}

function setAllRowPresetIds(presetId) {
  syncRowPresetIdsLength()
  const id = presetId != null && Number(presetId) > 0 ? Number(presetId) : null
  for (let i = 0; i < rowPresetIds.length; i++) {
    rowPresetIds[i] = id
  }
  clearRowSvgCache()
}

function setRowPresetIds(ids) {
  syncRowPresetIdsLength()
  const next = Array.isArray(ids) ? ids : []
  for (let i = 0; i < tableData.length; i++) {
    const presetId = i < next.length ? next[i] : null
    rowPresetIds[i] = presetId != null && Number(presetId) > 0 ? Number(presetId) : null
  }
  clearRowSvgCache()
}

function getRowPresetIds() {
  syncRowPresetIdsLength()
  return [...rowPresetIds]
}

function getEffectiveRowPresetId(rowIndex) {
  const rowId = rowPresetIds[rowIndex]
  if (rowId != null && Number(rowId) > 0) return Number(rowId)
  return window.__CAT_CMS__?.getDefaultPresetId?.() ?? null
}

function rowCacheKey(rowIndex) {
  return `${rowIndex}:${getEffectiveRowPresetId(rowIndex) ?? 'none'}`
}

function clearRowSvgCache() {
  rowSvgCache.clear()
  previewDisplayedRow = -1
}

function invalidateRowSvgCache(rowIndex) {
  const prefix = `${rowIndex}:`
  for (const key of rowSvgCache.keys()) {
    if (key === String(rowIndex) || String(key).startsWith(prefix)) {
      rowSvgCache.delete(key)
    }
  }
  if (previewDisplayedRow === rowIndex) previewDisplayedRow = -1
}

function getPreviewStage() {
  return previewArea.querySelector('.preview-stage')
}

function updatePreviewPagination() {
  const prevBtn = $('#btn-prev')
  const nextBtn = $('#btn-next')
  if (!previewIndexEl || !prevBtn || !nextBtn) return
  if (tableData.length === 0) {
    previewIndexEl.textContent = '- / -'
    prevBtn.disabled = true
    nextBtn.disabled = true
    return
  }
  selectedRow = Math.max(0, Math.min(selectedRow, tableData.length - 1))
  previewIndexEl.textContent = `${selectedRow + 1} / ${tableData.length}`
  prevBtn.disabled = selectedRow <= 0
  nextBtn.disabled = selectedRow >= tableData.length - 1
}

async function buildSvgForPreviewRow(rowIndex) {
  const tableCols = getDefinedTableColumns()
  const svgEl = await generateSvgFromRow(templateSvg, getSvgRowData(rowIndex), fontUrl, {
    fontScale,
    layoutOverrides,
    showReferenceLayer,
    showTemplateLayer,
    skipFontInject: previewFontReady,
    fontCatalog,
    pageWidthMm,
    pageHeightMm,
    tableColumns: tableCols,
    restrictToRowColumns: layoutOverrides.__tableTemplateScope === true,
  })
  previewFontReady = true
  return svgEl
}

function mountPreviewStageWithSvg(svgEl) {
  let stage = getPreviewStage()
  if (stage) {
    stage.replaceChildren(svgEl)
  } else {
    stage = document.createElement('div')
    stage.className = 'preview-stage'
    stage.appendChild(svgEl)
    previewViewport.setContent(stage)
  }
  return stage
}

function attachLayoutEditorToPreview(stage, restoreSelection = []) {
  const svgEl = stage.querySelector('svg')
  if (!svgEl) return

  destroyLayoutEditor()
  ensureLayoutPanel()
  layoutPanel?.setOverrides(layoutOverrides)

  layoutEditor = mountLayoutEditor(stage, svgEl, {
    layoutOverrides,
    readOnly: isCertLayoutReadonly(),
    visible: showLayoutBoxes,
    overlayShowBorder,
    overlayShowHandles,
    tableColumns: getTableColumns(),
    onDragDuplicate(idMap) {
      const row = tableData[selectedRow]
      if (!row) return
      for (const [oldId, newId] of Object.entries(idMap)) {
        row[newId] = getLayoutBoxPreviewContent(oldId)
      }
      persistTableData()
      clearRowSvgCache()
    },
    onRenameBox: (oldId, newId) => handleRenameLayoutBox(oldId, newId),
    onCommit(next, reason) {
      commitLayoutOverrides(next, {
        restoreSelection: layoutEditor?.getSelectedColumns?.() ?? [],
        reason: reason || '编辑框',
        flush: true,
        previewMode: 'light',
      })
      setStatus(reason === '拖拽复制编辑框' ? '已拖拽复制编辑框' : '布局已更新')
    },
    onSelectColumns(boxIds, { syncTable = true } = {}) {
      updateLayoutBoxToolbarButtons()

      if (boxIds.length === 0) {
        layoutPanel?.selectColumns([])
        layoutEditor?.clearVisualState?.()
        selectedCol = -1
        syncEditorSvgHighlight(null)
        ensureSpreadsheet().refreshColumnHighlight?.()
        if (syncTable && !suppressSelectionClearSync) {
          suppressSelectionClearSync = true
          ensureSpreadsheet().clearSelection?.()
          suppressSelectionClearSync = false
        }
        return
      }

      const panelCols = boxIds.map((id) => getPrimaryColumnForBox(id, layoutOverrides))
      layoutPanel?.selectColumns(panelCols)

      // 框选 / Shift 多选 / 多选：只更新布局工具栏，不滚动、不高亮表格列
      const shouldSyncTable = syncTable && boxIds.length <= 1
      if (!shouldSyncTable) return

      const boxId = boxIds[0]
      const tableCol = getPrimaryColumnForBox(boxId, layoutOverrides)
      const cols = getTableColumns()
      const ci = cols.indexOf(tableCol)
      const columnChanged = ci >= 0 && ci !== selectedCol
      if (ci >= 0) {
        selectedCol = ci
        ensureSpreadsheet().refreshColumnHighlight?.()
      }
      syncEditorSvgHighlight(tableCol)
      if (columnChanged) {
        ensureSpreadsheet().scrollToCell?.(selectedRow, ci, { moveSelection: false })
      }
    },
    onDeleteBoxes(boxIds) {
      if (!boxIds?.length) return
      const next = hideLayoutBoxes(layoutOverrides, boxIds)
      commitLayoutOverrides(next, {
        restoreSelection: [],
        reason: boxIds.length > 1 ? `隐藏 ${boxIds.length} 个编辑框` : `隐藏编辑框「${boxIds[0]}」`,
      })
      setStatus('已隐藏选中编辑框')
    },
    onCopyBox: handleCopyLayoutBoxes,
    onPasteBox: handlePasteLayoutBox,
    onUndo: performLayoutUndo,
    onRedo: performLayoutRedo,
    isShortcutScopeActive: () => {
      const editView = document.getElementById('cms-view-edit')
      if (editView && !editView.classList.contains('is-active')) return false
      const area = document.getElementById('preview-area')
      return !!(area?.isConnected && area.getClientRects().length > 0)
    },
  })

  if (restoreSelection.length) {
    layoutEditor.selectColumns(restoreSelection)
  }
  updateLayoutBoxToolbarButtons()
}

function getActivePreviewSvg() {
  return previewArea.querySelector('.preview-stage svg')
}

function syncEditorSvgHighlight(columnName) {
  const svg = getActivePreviewSvg()
  if (!svg) return
  const cols = getTableColumns()
  const name = columnName ?? (selectedCol >= 0 ? cols[selectedCol] : null) ?? null
  setSvgFieldHighlight(svg, name, layoutOverrides)
  syncPreviewLayerSelection(name)
}

function clearAllEditorSelection() {
  suppressSelectionClearSync = true
  selectedCol = -1
  syncEditorSvgHighlight(null)
  layoutEditor?.clearVisualState?.()
  layoutPanel?.selectColumns?.([])
  ensureSpreadsheet().clearSelection?.()
  ensureSpreadsheet().refreshColumnHighlight?.()
  updateLayoutBoxToolbarButtons()
  suppressSelectionClearSync = false
}

function isEscapeClearBlockedTarget(target) {
  if (!target || typeof target.closest !== 'function') return false
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true
  if (target.closest('#paste-modal')) return true
  return false
}

function focusEditorTableColumn(columnName, { scroll = true, syncLayout = true } = {}) {
  if (!columnName) return
  const cols = getTableColumns()
  const ci = cols.indexOf(columnName)
  if (ci < 0) return
  selectedCol = ci
  syncEditorSvgHighlight(columnName)
  if (syncLayout) {
    const boxId = resolveBoxId(columnName, layoutOverrides)
    layoutEditor?.selectColumns?.([boxId])
    layoutPanel?.selectColumns?.([columnName])
  }
  ensureSpreadsheet().refreshColumnHighlight?.()
  if (scroll) {
    const ss = ensureSpreadsheet()
    ss.scrollToCell(selectedRow, ci, {
      moveSelection: !ss.isFullRowSelection?.() && !ss.hasRectSelection?.(),
    })
  }
}

function renameColumn(colIndex, oldName, newName) {
  const cols = getTableColumns()
  const trimmed = String(newName || '').trim()
  if (!trimmed) {
    setStatus('列标题不能为空')
    return
  }
  if (trimmed === oldName) return
  if (cols.includes(trimmed)) {
    setStatus(`已存在列「${trimmed}」`)
    return
  }
  const colAtIndex = cols[colIndex]
  if (colAtIndex && colAtIndex !== oldName) {
    oldName = colAtIndex
  }
  const newCols = cols.map((c) => (c === oldName ? trimmed : c))
  layoutOverrides = renameLayoutColumn(layoutOverrides, oldName, trimmed, newCols)
  for (const row of tableData) {
    if (Object.prototype.hasOwnProperty.call(row, oldName)) {
      row[trimmed] = row[oldName]
    }
    delete row[oldName]
  }
  applyColumnOrder(newCols)
  selectedCol = newCols.indexOf(trimmed)
  ensureSpreadsheet().flushEdits?.()
  renderTable()
  clearRowSvgCache()
  persistTableData()
  commitTableStateToHistory()
  const boxId = resolveBoxId(trimmed, layoutOverrides)
  commitLayoutOverrides(layoutOverrides, {
    restoreSelection: [boxId],
    reason: '重命名列',
    previewMode: 'full',
  })
  layoutPanel?.selectColumns?.([trimmed])
  focusEditorTableColumn(trimmed, { scroll: false, syncLayout: true })
  window.__CAT_CMS__?.markDirty?.()
  if (listLayoutBoxIds(layoutOverrides).includes(boxId)) {
    if (boxId === trimmed) {
      setStatus(`列与编辑框已重命名为「${trimmed}」`)
    } else {
      setStatus(`列「${trimmed}」已与编辑框「${boxId}」绑定`)
    }
  } else {
    setStatus(`列已重命名为「${trimmed}」`)
  }
}

function updateLayoutBoxToolbarButtons() {
  const boxIds = layoutEditor?.getSelectedColumns?.() ?? []
  const hasOne = boxIds.length === 1
  const btnDel = $('#btn-delete-layout-box')
  const btnRen = $('#btn-rename-layout-box')
  if (btnDel) btnDel.disabled = !hasOne
  if (btnRen) btnRen.disabled = !hasOne
}

function getLayoutBoxPreviewContent(boxId) {
  const displayRow = getSvgRowData(selectedRow)
  const key = getPrimaryColumnForBox(boxId, layoutOverrides)
  if (displayRow[key] != null && String(displayRow[key]).trim() !== '') return displayRow[key]
  if (displayRow[boxId] != null) return displayRow[boxId]
  return ''
}

function getDefinedTableColumns() {
  return columnOrder?.length ? [...columnOrder] : []
}

function listCustomLayoutBoxIdsInEditor() {
  return listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns())
}

function isLayoutBoxVisibleInEditor(id) {
  const cols = getTableColumns()
  if (cols.includes(id)) {
    return isLayoutBoxActive(getColumnLayout(id, layoutOverrides))
  }
  const primary = getPrimaryColumnForBox(id, layoutOverrides)
  return isLayoutBoxActive(getColumnLayout(primary, layoutOverrides))
}

async function handleCopyLayoutBoxes(boxIds) {
  layoutEditor?.flushPendingState?.()
  const overrides = layoutEditor?.getPendingOverrides?.() ?? layoutOverrides
  const ids = [...new Set((Array.isArray(boxIds) ? boxIds : [boxIds]).filter(Boolean))]
  if (!ids.length) return

  const entries = ids.map((boxId) => ({
    boxId,
    content: getLayoutBoxPreviewContent(boxId),
  }))

  const ok = await copyLayoutBoxesToClipboard(entries, overrides, {
    tableColumns: getTableColumns(),
  })
  if (!ok) {
    setStatus('无法复制所选编辑框')
    return
  }
  if (ids.length === 1) {
    setStatus(`已复制编辑框「${resolveBoxId(ids[0], layoutOverrides)}」`)
  } else {
    setStatus(`已复制 ${ids.length} 个编辑框`)
  }
}

function pruneOrphanCustomBoxDataFromRow() {
  const activeIds = new Set(listLayoutBoxIds(layoutOverrides))
  const cols = new Set(getTableColumns())
  const row = tableData[selectedRow]
  if (!row) return
  for (const key of Object.keys(row)) {
    if (!cols.has(key) && !activeIds.has(key)) {
      delete row[key]
    }
  }
}

function pruneOrphanCustomBoxDataFromAllRows() {
  const activeIds = new Set(listLayoutBoxIds(layoutOverrides))
  const cols = new Set(getTableColumns())
  for (const row of tableData) {
    if (!row) continue
    for (const key of Object.keys(row)) {
      if (!cols.has(key) && !activeIds.has(key)) {
        delete row[key]
      }
    }
  }
}

function applyPresetCustomSamplesToRows() {
  const customIds = listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns())
  for (const boxId of customIds) {
    const sample = presetCustomSamples[boxId]
    if (sample == null || String(sample).trim() === '') continue
    for (const row of tableData) {
      const existing = row[boxId]
      if (existing == null || String(existing).trim() === '') {
        row[boxId] = sample
      }
    }
  }
}

function finalizeLayoutOverridesForEditor() {
  layoutOverrides = applyTableTemplateScopeFlag(
    pruneLayoutOverridesForTable(
      syncAutoColumnBindings(layoutOverrides, getTableColumns()),
      getDefinedTableColumns(),
    ),
    getDefinedTableColumns(),
  )
  pruneOrphanCustomBoxDataFromAllRows()
  applyPresetCustomSamplesToRows()
  if (layoutPanel) layoutPanel.setOverrides(layoutOverrides)
}

function applyPresetCustomSamplesToRow(rowIndex, { overwrite = false } = {}) {
  const row = tableData[rowIndex]
  if (!row) return
  const customIds = listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns())
  for (const boxId of customIds) {
    const sample = presetCustomSamples[boxId]
    if (sample == null || String(sample).trim() === '') continue
    const existing = row[boxId]
    if (overwrite || existing == null || String(existing).trim() === '') {
      row[boxId] = sample
    }
  }
}

/** 将新默认布局的自定义示例写入所有跟随默认 preset 的行（row preset 为 null） */
function applyPresetCustomSamplesToDefaultRows({ overwrite = true } = {}) {
  syncRowPresetIdsLength()
  for (let i = 0; i < tableData.length; i++) {
    const rowId = rowPresetIds[i]
    if (rowId != null && Number(rowId) > 0) continue
    applyPresetCustomSamplesToRow(i, { overwrite })
  }
}

/** 行级/同表切换布局：只替换 preset 布局上下文，不重建整张表格 */
async function applyPresetLayoutContext(bundle, {
  selectedRow: nextSelectedRow = selectedRow,
  targetRowIndex = null,
  overwriteRowCustomSamples = false,
  overwriteDefaultRowCustomSamples = false,
} = {}) {
  skipSave = true

  layoutOverrides = structuredClone(bundle.layoutOverrides || {})
  presetCustomSamples = bundle.presetCustomSamples && typeof bundle.presetCustomSamples === 'object'
    ? { ...bundle.presetCustomSamples }
    : {}
  presetSampleAdornments = bundle.presetSampleAdornments && typeof bundle.presetSampleAdornments === 'object'
    ? structuredClone(bundle.presetSampleAdornments)
    : {}

  if (bundle.fontScale != null) fontScale = bundle.fontScale
  const pageSize = normalizePageSizeMm(bundle.pageWidthMm, bundle.pageHeightMm)
  pageWidthMm = pageSize.pageWidthMm
  pageHeightMm = pageSize.pageHeightMm
  previewViewport.setPageAspectRatio(pageWidthMm, pageHeightMm)

  if (Array.isArray(bundle.columnOrder) && bundle.columnOrder.length) {
    const customIds = new Set(listCustomLayoutBoxIds(layoutOverrides, bundle.columnOrder))
    columnOrder = bundle.columnOrder.filter((col) => !customIds.has(col))
  }
  if (Array.isArray(bundle.tableTemplateColumns) && bundle.tableTemplateColumns.length) {
    tableTemplateColumns = [...bundle.tableTemplateColumns]
  }

  const nextTemplateId = bundle.templateId ?? templateId
  if (nextTemplateId !== templateId) {
    await loadTemplateById(nextTemplateId)
  }

  finalizeLayoutOverridesForEditor()

  const sampleRow = targetRowIndex ?? nextSelectedRow
  if (overwriteDefaultRowCustomSamples) {
    applyPresetCustomSamplesToDefaultRows({ overwrite: true })
  } else if (sampleRow >= 0 && sampleRow < tableData.length) {
    applyPresetCustomSamplesToRow(sampleRow, { overwrite: overwriteRowCustomSamples })
    if (!overwriteRowCustomSamples) {
      applyPresetCustomSamplesToRows()
    }
  } else {
    applyPresetCustomSamplesToRows()
  }
  pruneOrphanCustomBoxDataFromAllRows()

  selectedRow = Math.max(0, Math.min(nextSelectedRow, Math.max(0, tableData.length - 1)))
  renderTable()

  skipSave = false
  initLayoutHistory(layoutOverrides)
  updateLayoutHistoryBaseline(layoutOverrides)
  if (layoutPanel) layoutPanel.setOverrides(layoutOverrides)

  logLayoutSwitch('applyPresetLayoutContext', {
    selectedRow,
    targetRowIndex,
    templateId: nextTemplateId,
    overwriteDefaultRowCustomSamples,
    overwriteRowCustomSamples,
    customBoxIds: listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns()),
    layoutOverrideKeys: Object.keys(layoutOverrides || {}).filter((k) => !k.startsWith('__')),
  })

  previewDisplayedRow = -1
  clearRowSvgCache()
  const deferPreviewUpdate = targetRowIndex != null
    && targetRowIndex >= 0
    && targetRowIndex !== selectedRow
  if (!deferPreviewUpdate) {
    await updatePreview([])
  }
}

async function handlePasteLayoutBox() {
  const ready = await ensureLayoutBoxClipboardReady()
  if (!ready || !hasLayoutBoxClipboard()) {
    setStatus('剪贴板中没有已复制的编辑框')
    return
  }
  const result = pasteLayoutBoxesFromClipboard(layoutOverrides, {
    tableColumns: getTableColumns(),
    customBoxIds: listCustomLayoutBoxIdsInEditor(),
    isVisible: isLayoutBoxVisibleInEditor,
  })
  if (!result?.items?.length) {
    setStatus('粘贴失败')
    return
  }
  const { overrides, items, boxIds } = result
  const cols = getTableColumns()
  if (tableData[selectedRow]) {
    for (const item of items) {
      if (!cols.includes(item.boxId)) {
        tableData[selectedRow][item.boxId] = item.content
      }
    }
    persistTableData()
    clearRowSvgCache()
  }
  showLayoutBoxes = true
  if (showLayoutBoxesInput) showLayoutBoxesInput.checked = true
  layoutEditor?.setVisible(true)
  const reuseCount = items.filter((item) => item.mode === 'reuse').length
  commitLayoutOverrides(overrides, {
    restoreSelection: boxIds,
    reason: items.length > 1 ? '批量粘贴编辑框' : (reuseCount ? '粘贴并启用编辑框' : '粘贴编辑框'),
    previewMode: 'full',
  })
  layoutEditor?.selectColumns?.(boxIds)
  if (items.length === 1) {
    const { boxId, mode } = items[0]
    if (mode === 'reuse') {
      setStatus(`已启用编辑框「${boxId}」并应用复制的样式`)
    } else if (mode === 'new') {
      setStatus(`已粘贴为自定义编辑框「${boxId}」`)
    } else {
      setStatus(`已粘贴为自定义编辑框「${boxId}」（原框已启用）`)
    }
    return
  }
  const copyCount = items.length - reuseCount
  const parts = []
  if (reuseCount) parts.push(`启用 ${reuseCount} 个`)
  if (copyCount) parts.push(`新建 ${copyCount} 个`)
  setStatus(`已粘贴 ${items.length} 个编辑框${parts.length ? `（${parts.join('，')}）` : ''}`)
}

function handleAddLayoutBox() {
  showLayoutBoxes = true
  if (showLayoutBoxesInput) showLayoutBoxesInput.checked = true
  if (layoutEditor) layoutEditor.setVisible(true)
  const { overrides, boxId } = createLayoutBox(layoutOverrides, null, defaultNewBoxBounds())
  commitLayoutOverrides(overrides, {
    restoreSelection: [boxId],
    reason: '添加编辑框',
  })
  setStatus(`已添加编辑框「${boxId}」，可拖拽调整位置`)
}

function handleDeleteLayoutBox() {
  const boxIds = layoutEditor?.getSelectedColumns?.() ?? []
  if (boxIds.length !== 1) {
    setStatus('请先选中一个编辑框')
    return
  }
  const boxId = boxIds[0]
  const bound = getColumnsForBox(boxId, layoutOverrides)
  const msg = bound.length
    ? `删除编辑框「${boxId}」？以下列的数据绑定将解除：${bound.join('、')}`
    : `确定删除编辑框「${boxId}」？`
  if (!window.confirm(msg)) return
  const next = hideLayoutBoxes(layoutOverrides, [boxId])
  commitLayoutOverrides(next, {
    restoreSelection: [],
    reason: '隐藏编辑框',
  })
  setStatus(`已隐藏编辑框「${boxId}」，SVG 中对应文字不再显示`)
}

function handleRenameLayoutBox(oldId, newId) {
  const trimmed = String(newId || '').trim()
  if (!trimmed) {
    setStatus('编辑框名称不能为空')
    return
  }
  if (trimmed === oldId) return
  const cols = getTableColumns()
  if (layoutOverrides[trimmed] && trimmed !== oldId && !cols.includes(trimmed)) {
    setStatus(`已存在编辑框「${trimmed}」`)
    return
  }
  let next = renameLayoutBox(layoutOverrides, oldId, trimmed)
  next = syncAutoColumnBindings(next, cols)
  commitLayoutOverrides(next, {
    restoreSelection: [trimmed],
    reason: '重命名编辑框',
    previewMode: 'light',
  })
  if (cols.includes(trimmed)) {
    selectedCol = cols.indexOf(trimmed)
    focusEditorTableColumn(trimmed, { scroll: false })
    setStatus(`编辑框「${trimmed}」已与表格列自动绑定`)
  } else {
    setStatus(`编辑框已重命名为「${trimmed}」`)
  }
}

function promptRenameLayoutBox() {
  const boxIds = layoutEditor?.getSelectedColumns?.() ?? []
  if (boxIds.length !== 1) {
    setStatus('请先选中一个编辑框')
    return
  }
  const boxId = boxIds[0]
  const next = window.prompt('编辑框名称', boxId)
  if (next == null) return
  handleRenameLayoutBox(boxId, next)
}

function showSvgInPreview(svgEl, restoreSelection = []) {
  const stage = mountPreviewStageWithSvg(svgEl)
  syncLayerVisibilityOnPreview()
  attachLayoutEditorToPreview(stage, restoreSelection)
  syncEditorSvgHighlight(getTableColumns()[selectedCol])
  afterPreviewViewportContentReady()
}

function preloadAdjacentPreviewRows(center) {
  const centerPreset = getEffectiveRowPresetId(center)
  const run = () => {
    for (const i of [center - 1, center + 1]) {
      if (i < 0 || i >= tableData.length || rowSvgCache.has(rowCacheKey(i))) continue
      if (getEffectiveRowPresetId(i) !== centerPreset) continue
      buildSvgForPreviewRow(i)
        .then((svg) => { rowSvgCache.set(rowCacheKey(i), svg.cloneNode(true)) })
        .catch(() => {})
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2000 })
  } else {
    setTimeout(run, 100)
  }
}

function scheduleSelectPreviewRow(rowIndex, options = {}) {
  scheduledPreviewJob = { rowIndex, options }
  if (schedulePreviewRaf) return
  schedulePreviewRaf = requestAnimationFrame(() => {
    schedulePreviewRaf = 0
    const job = scheduledPreviewJob
    scheduledPreviewJob = null
    if (!job) return
    void selectPreviewRow(job.rowIndex, job.options)
  })
}

/** 切换预览行：缓存已生成 SVG，避免每次整页重建 */
async function selectPreviewRow(rowIndex, { restoreSelection = [], persistTable = false, skipEnsureLayout = false } = {}) {
  if (tableData.length === 0) {
    return updatePreview(restoreSelection)
  }

  const ri = Math.max(0, Math.min(rowIndex, tableData.length - 1))
  if (!skipEnsureLayout && window.__CAT_CMS__?.ensureLayoutForRow) {
    try {
      await window.__CAT_CMS__.ensureLayoutForRow(ri)
    } catch (err) {
      console.error('切换行布局失败', err)
    }
  } else {
    logLayoutSwitch('selectPreviewRow:skipEnsureLayout', {
      rowIndex: ri,
      effectivePreset: getEffectiveRowPresetId(ri),
      cacheKey: rowCacheKey(ri),
      templateId,
      layoutOverrideKeys: Object.keys(layoutOverrides || {}).filter((k) => !k.startsWith('__')),
    })
  }

  const cols = getTableColumns()
  const selectionToRestore = restoreSelection.length
    ? restoreSelection
    : (selectedCol >= 0 && cols[selectedCol]
      ? [resolveBoxId(cols[selectedCol], layoutOverrides)]
      : (layoutEditor?.getSelectedColumns?.() ?? []))

  if (
    ri === previewDisplayedRow
    && rowSvgCache.has(rowCacheKey(ri))
    && getPreviewStage()?.querySelector('svg')
  ) {
    logLayoutSwitch('selectPreviewRow:cache-hit-skip-rebuild', { rowIndex: ri, cacheKey: rowCacheKey(ri) })
    selectedRow = ri
    updatePreviewPagination()
    if (persistTable) persistTableData()
    ensureSpreadsheet().syncPageRowSelection?.(ri, selectedCol >= 0 ? selectedCol : -1)
    return
  }

  const gen = ++previewSwitchGeneration
  selectedRow = ri
  updatePreviewPagination()
  if (persistTable) persistTableData()
  ensureSpreadsheet().syncPageRowSelection?.(ri, selectedCol >= 0 ? selectedCol : -1)

  if (rowSvgCache.has(rowCacheKey(ri))) {
    logLayoutSwitch('selectPreviewRow:use-row-cache', { rowIndex: ri, cacheKey: rowCacheKey(ri) })
    if (gen !== previewSwitchGeneration) return
    showSvgInPreview(rowSvgCache.get(rowCacheKey(ri)).cloneNode(true), selectionToRestore)
    previewDisplayedRow = ri
    syncEditorSvgHighlight(getTableColumns()[selectedCol])
    preloadAdjacentPreviewRows(ri)
    return
  }

  try {
    logLayoutSwitch('selectPreviewRow:buildSvg', {
      rowIndex: ri,
      cacheKey: rowCacheKey(ri),
      effectivePreset: getEffectiveRowPresetId(ri),
      templateId,
      layoutOverrideKeys: Object.keys(layoutOverrides || {}).filter((k) => !k.startsWith('__')),
    })
    const svgEl = await buildSvgForPreviewRow(ri)
    if (gen !== previewSwitchGeneration) return
    rowSvgCache.set(rowCacheKey(ri), svgEl.cloneNode(true))
    showSvgInPreview(svgEl, selectionToRestore)
    previewDisplayedRow = ri
    syncEditorSvgHighlight(getTableColumns()[selectedCol])
    preloadAdjacentPreviewRows(ri)
  } catch (err) {
    console.error('预览行渲染失败', err)
  }
}

/** 将表格选中行与预览分页对齐到指定行（布局列下拉不会触发行选中） */
async function syncPreviewToRow(rowIndex) {
  if (tableData.length === 0) return
  const ri = Math.max(0, Math.min(rowIndex, tableData.length - 1))
  selectedRow = ri
  updatePreviewPagination()
  ensureSpreadsheet().syncPageRowSelection?.(ri, selectedCol >= 0 ? selectedCol : -1)
}

/** 布局模板切换后强制重建当前行预览（编辑器上下文已更新，不再走 ensureLayoutForRow） */
async function refreshPreviewForRow(rowIndex, options = {}) {
  previewDisplayedRow = -1
  clearRowSvgCache()
  selectedRow = Math.max(0, Math.min(rowIndex, Math.max(0, tableData.length - 1)))
  logLayoutSwitch('refreshPreviewForRow', {
    rowIndex: selectedRow,
    cacheKey: rowCacheKey(selectedRow),
    customBoxIds: listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns()),
  })
  await updatePreview(options.restoreSelection ?? [])
}

/** 表格数据变更后同步当前预览行（优先轻量重填，避免每次按键整页重建 SVG） */
function syncPreviewFromTable(rowIndex = selectedRow) {
  if (tableData.length === 0) return
  const ri = Math.max(0, Math.min(rowIndex, tableData.length - 1))
  if (ri !== selectedRow) {
    scheduleSelectPreviewRow(ri)
    return
  }
  invalidateRowSvgCache(ri)
  if (!refreshPreviewLayout()) {
    scheduleSelectPreviewRow(ri)
  }
}

function commitLayoutOverrides(next, {
  recordHistory = true,
  restoreSelection,
  reason = '布局编辑',
  flush = false,
  /** 'light' 仅重排 SVG 文字；'full' 重建预览（编辑框拖拽/改尺寸必须用 full） */
  previewMode = 'full',
  affectedColumns = null,
} = {}) {
  const prev = layoutOverrides
  const synced = syncAutoColumnBindings(next, getTableColumns())
  if (recordHistory) recordLayoutHistory(synced)
  layoutOverrides = synced
  logLayoutOverrideChange(reason, prev, synced)

  const selection = restoreSelection
    ?? layoutEditor?.getSelectedColumns?.()
    ?? (layoutPanel?.getSelectedColumns?.() ?? [])

  if (layoutPanel) {
    layoutPanel.setOverrides(layoutOverrides)
    layoutPanel.refreshHistoryButtons?.()
  }

  if (flush) {
    flushLayoutSettingsSave(() => getLayoutSettingsPayload(), (msg) => {
      if (msg) setStatus(msg, 2500)
    }, reason)
  } else {
    persistLayoutSettings(reason)
  }

  clearRowSvgCache()
  if (previewMode === 'light' && refreshPreviewLayout(selection, { affectedColumns })) {
    window.__CAT_CMS__?.markDirty?.()
    return
  }
  updatePreview(selection)
  window.__CAT_CMS__?.markDirty?.()
}

function performLayoutUndo() {
  const prev = undoLayout()
  if (!prev) return
  layoutOverrides = syncAutoColumnBindings(prev, getTableColumns())
  pruneOrphanCustomBoxDataFromRow()
  if (layoutPanel) {
    layoutPanel.setOverrides(layoutOverrides)
    layoutPanel.refreshHistoryButtons?.()
  }
  if (layoutEditor) {
    layoutEditor.syncOverrides?.(layoutOverrides) ?? layoutEditor.setOverrides(layoutOverrides)
  }
  clearRowSvgCache()
  void updatePreview([])
  persistLayoutSettings('撤销布局')
  setStatus('已撤销')
}

function performLayoutRedo() {
  const next = redoLayout()
  if (!next) return
  layoutOverrides = syncAutoColumnBindings(next, getTableColumns())
  pruneOrphanCustomBoxDataFromRow()
  if (layoutPanel) {
    layoutPanel.setOverrides(layoutOverrides)
    layoutPanel.refreshHistoryButtons?.()
  }
  if (layoutEditor) {
    layoutEditor.syncOverrides?.(layoutOverrides) ?? layoutEditor.setOverrides(layoutOverrides)
  }
  clearRowSvgCache()
  void updatePreview([])
  persistLayoutSettings('重做布局')
  setStatus('已重做')
}

function loadLegacyBrowserState() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function applyLegacyBrowserState(legacy) {
  if (!legacy) return false
  if (legacy.layoutOverrides && typeof legacy.layoutOverrides === 'object') {
    layoutOverrides = legacy.layoutOverrides
  }
  fontScale = 1
  await flushLayoutSettingsSave(() => getLayoutSettingsPayload(), (msg) => {
    if (msg) setStatus(`已从浏览器迁移编辑框布局：${msg}`, 4000)
    else setStatus('已迁移编辑框布局（请用 npm run dev 写入文件）', 5000)
  }, '迁移浏览器旧布局')
  return true
}

function refreshTableHistoryButtons() {
  const st = getTableHistoryState()
  const undoBtn = $('#btn-table-undo')
  const redoBtn = $('#btn-table-redo')
  if (undoBtn) undoBtn.disabled = !st.canUndo
  if (redoBtn) redoBtn.disabled = !st.canRedo
}

function commitTableStateToHistory() {
  if (skipTableHistory) return
  if (!tableHistoryReady) {
    initTableHistory({ tableData, selectedRow, selectedCol })
    tableHistoryReady = true
  } else {
    recordTableHistory(tableData, selectedRow, selectedCol)
  }
  refreshTableHistoryButtons()
}

/** @param {{ tableData: Record<string, string>[], selectedRow: number, selectedCol?: number }} snap */
function applyTableSnapshot(snap) {
  if (!snap) return
  skipTableHistory = true
  tableData = structuredClone(snap.tableData)
  selectedRow = Math.max(0, Math.min(snap.selectedRow ?? 0, tableData.length - 1))
  selectedCol = snap.selectedCol ?? 0
  const fromRows = columnOrderFromRows(tableData)
  columnOrder = fromRows?.length ? fromRows : null
  if (!columnOrder) syncColumnOrderFromTable()
  clearRowSvgCache()
  renderTable()
  void selectPreviewRow(selectedRow)
  persistTableData()
  if (!skipSave) window.__CAT_CMS__?.markDirty?.()
  skipTableHistory = false
  refreshTableHistoryButtons()
}

function performTableUndo() {
  const snap = undoTable()
  if (!snap) return false
  applyTableSnapshot(snap)
  setStatus('已撤销')
  return true
}

function performTableRedo() {
  const snap = redoTable()
  if (!snap) return false
  applyTableSnapshot(snap)
  setStatus('已重做')
  return true
}

function applyRows(data, newSelectedRow = 0, {
  preserveColumnOrder = false,
  strictColumnOrder = false,
  rowPresetIds: nextRowPresetIds = null,
  skipPreview = false,
} = {}) {
  tableData = data.length > 0 ? data : [emptyRow()]
  if (Array.isArray(nextRowPresetIds)) {
    rowPresetIds = nextRowPresetIds.map((id) => (id != null && Number(id) > 0 ? Number(id) : null))
  }
  syncRowPresetIdsLength()
  selectedRow = Math.max(0, Math.min(newSelectedRow, tableData.length - 1))
  if (preserveColumnOrder && columnOrder?.length) {
    if (!strictColumnOrder) mergeColumnOrderFromData()
    applyColumnOrder(columnOrder)
  } else {
    syncColumnOrderFromTable()
  }
  clearRowSvgCache()
  renderTable()
  if (!skipPreview) updatePreview()
  persistTableData()
  commitTableStateToHistory()
  if (!skipSave) window.__CAT_CMS__?.markDirty?.()
}

async function loadTemplateById(id) {
  if (!id) {
    templateId = null
    templateSvg = EMPTY_SVG_TEMPLATE
    clearRowSvgCache()
    previewFontReady = false
    return
  }
  const { template } = await api.getTemplate(id)
  templateId = template.id
  const svgResult = await loadSvgTemplateContentResult(api, templateId, { fallback: EMPTY_SVG_TEMPLATE })
  templateSvg = svgResult.content
  if (svgResult.missing) {
    const tplName = template?.name ? `「${template.name}」` : `#${templateId}`
    setStatus(`SVG 模板 ${tplName} 的文件已丢失，请在「本证书模板」中重新选择或到「SVG 模板库」重新上传`)
  }
  clearRowSvgCache()
  previewFontReady = false
}

function getEditorState() {
  const floatUi = previewFloatController?.getState() ?? previewUiState
  return {
    tableData: structuredClone(tableData),
    columnOrder: getTableColumns(),
    layoutOverrides: structuredClone(layoutOverrides),
    fontScale,
    pageWidthMm,
    pageHeightMm,
    showLayoutBoxes,
    showReferenceLayer,
    showTemplateLayer,
    templateId,
    selectedRow,
    rowPresetIds: getRowPresetIds(),
    previewUi: {
      ...floatUi,
      rowHeights: previewUiState.rowHeights ?? {},
    },
  }
}

async function loadEditorState(state) {
  skipSave = true
  tableHistoryReady = false
  // 编辑框/参考层/底图 显隐由预览工具栏偏好控制，不随证书或预设里的历史字段恢复
  applyLayoutSettings({
    layoutOverrides: structuredClone(state.layoutOverrides || {}),
  }, '服务器证书', { applyToolbarToggles: false, syncEditor: false })
  resetPreviewLayerToggles()
  if (state.templateId) {
    await loadTemplateById(state.templateId)
  } else {
    templateId = null
    templateSvg = EMPTY_SVG_TEMPLATE
  }
  if (Array.isArray(state.columnOrder) && state.columnOrder.length > 0) {
    const customIds = new Set(
      listCustomLayoutBoxIds(state.layoutOverrides || {}, state.columnOrder),
    )
    columnOrder = state.columnOrder.filter((col) => !customIds.has(col))
  } else {
    columnOrder = null
  }
  tableTemplateColumns = Array.isArray(state.tableTemplateColumns) && state.tableTemplateColumns.length
    ? [...state.tableTemplateColumns]
    : null
  presetCustomSamples = state.presetCustomSamples && typeof state.presetCustomSamples === 'object'
    ? { ...state.presetCustomSamples }
    : {}
  presetSampleAdornments = state.presetSampleAdornments && typeof state.presetSampleAdornments === 'object'
    ? structuredClone(state.presetSampleAdornments)
    : {}
  const pageSize = normalizePageSizeMm(state.pageWidthMm ?? state.page_width_mm, state.pageHeightMm ?? state.page_height_mm)
  pageWidthMm = pageSize.pageWidthMm
  pageHeightMm = pageSize.pageHeightMm
  previewViewport.setPageAspectRatio(pageWidthMm, pageHeightMm)
  applyRows(state.tableData?.length ? state.tableData : [emptyRow()], state.selectedRow ?? 0, {
    preserveColumnOrder: !!columnOrder?.length,
    strictColumnOrder: !!state.strictColumnOrder,
    rowPresetIds: Array.isArray(state.rowPresetIds) ? state.rowPresetIds : null,
    skipPreview: true,
  })
  finalizeLayoutOverridesForEditor()
  skipSave = false
  initLayoutHistory(layoutOverrides)
  updateLayoutHistoryBaseline(layoutOverrides)
  applyLoadedPreviewUi(state.previewUi)
  previewFloatController?.applyState?.()
  applyCertPreviewPanMode()
  logLayoutSwitch('loadEditorState:preview', {
    layoutOverrideKeys: Object.keys(layoutOverrides || {}).filter((k) => !k.startsWith('__')),
    customBoxIds: listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns()),
  })
  await updatePreview([])
}

function fillRowAtIndex(rowIndex, rowObj) {
  if (rowIndex < 0 || rowIndex >= tableData.length) return
  tableData[rowIndex] = { ...emptyRow(), ...rowObj }
}

function getActiveRowIndex() {
  const ae = document.activeElement
  if (ae?.dataset?.row != null) return Number(ae.dataset.row)
  return selectedRow
}

async function applyClipboardTableImport(clipboardData, { startRow = 0, text = null } = {}) {
  const templateCols = getTableColumns()
  const result = await importTableFromClipboard(
    clipboardData,
    templateCols,
    (file) => api.uploadMedia(file),
    text != null ? { text } : {},
  )
  if (!result) return { ok: false, reason: 'empty' }

  const { mapped, imageStats } = result
  const rows = sanitizeCertificateRows(
    mapped.rows,
    templateCols,
    layoutOverrides,
    presetCustomSamples,
  )

  while (tableData.length < startRow + rows.length) {
    tableData.push(emptyRow())
  }
  for (let i = 0; i < rows.length; i++) {
    tableData[startRow + i] = { ...emptyRow(), ...rows[i] }
  }
  if (startRow === 0 && rows.length > 0 && rows.length < tableData.length) {
    tableData.length = rows.length
    selectedRow = Math.min(selectedRow, Math.max(0, rows.length - 1))
  }

  clearRowSvgCache()
  renderTable()
  void updatePreview()
  persistTableData()
  commitTableStateToHistory()
  window.__CAT_CMS__?.markDirty?.()

  return {
    ok: true,
    rowCount: rows.length,
    imageStats,
    mapped,
  }
}

function formatPasteImportStatus({ rowCount, imageStats, mapped }) {
  const imgMsg = imageStats.uploaded
    ? `，${imageStats.uploaded} 张图片已导入`
    : (imageStats.missing
      ? `，图片未能从剪贴板解析（请用「导入 Excel」）`
      : '')
  const colMsg = mapped.missingInExcel?.length
    ? `，${mapped.missingInExcel.length} 列未匹配`
    : ''
  return { imgMsg, colMsg, rowCount }
}

function handleClipboardPaste(e) {
  const target = e.target
  if (!target?.closest) return

  const inTable = target.closest('#table-wrap')
  const inTplTable = target.closest('#tbl-tpl-table-wrap')
  const inPasteModal = target.closest('#paste-modal')
  const inPasteCapture = target.closest('#paste-capture')
  // 表格内粘贴由 spreadsheet 按当前列顺序处理，避免改列名/列顺序
  if (inTable || inTplTable) return
  if (document.activeElement?.closest?.('#tbl-tpl-table-wrap')) return
  if (target.closest('#paste-text')) return
  if (!inPasteModal && !inPasteCapture) return
  if (!e.clipboardData || !isMultiCellClipboard(e.clipboardData)) return

  e.preventDefault()
  e.stopPropagation()

  void (async () => {
    try {
      setStatus('正在解析粘贴内容…', 0)
      const result = await applyClipboardTableImport(e.clipboardData, { startRow: 0 })
      if (!result.ok) {
        setStatus('未能解析粘贴内容')
        return
      }

      const { imgMsg, colMsg, rowCount } = formatPasteImportStatus(result)

      if (inPasteCapture || inPasteModal) {
        $('#paste-modal')?.classList.remove('open')
        const cap = $('#paste-capture')
        if (cap) cap.textContent = ''
      }

      setStatus(`已粘贴 ${rowCount} 行${imgMsg}${colMsg}`)
    } catch (err) {
      console.error('粘贴导入失败', err)
      setStatus('粘贴导入失败: ' + (err?.message || '请尝试「导入 Excel」'))
    }
  })()
}

function ensureSpreadsheet() {
  if (spreadsheet) return spreadsheet
  spreadsheet = mountSpreadsheetTable(tableWrap, {
    getData: () => tableData,
    getColumns: () => getTableColumns(),
    documentPasteScope: () => {
      const cmsEdit = document.getElementById('cms-view-edit')
      if (cmsEdit && !cmsEdit.classList.contains('is-active')) return false
      return spreadsheet?.hasActiveSelection?.() ?? false
    },
    setData: (rows) => {
      applyRows(rows, 0)
    },
    getSelectedRow: () => selectedRow,
    setSelectedRow: (i) => { selectedRow = i },
    getPreviewDisplayedRow: () => previewDisplayedRow,
    getSelectedCol: () => selectedCol,
    setSelectedCol: (i) => { selectedCol = i },
    onCellChange: (ri) => {
      invalidateRowSvgCache(ri)
      syncPreviewFromTable(ri)
      persistTableData()
      window.__CAT_CMS__?.markDirty?.()
    },
    onCellFocus: (ri, colName, ci) => {
      if (ci >= 0) selectedCol = ci
      requestAnimationFrame(() => {
        syncEditorSvgHighlight(colName)
        layoutEditor?.selectColumns?.([resolveBoxId(colName, layoutOverrides)])
        layoutPanel?.selectColumns?.([colName])
      })
      if (ri !== previewDisplayedRow) {
        scheduleSelectPreviewRow(ri, { persistTable: true })
      }
    },
    onRowSelect: (ri) => {
      selectedRow = ri
      updatePreviewPagination()
      const cols = getTableColumns()
      const restore = selectedCol >= 0 && cols[selectedCol]
        ? [resolveBoxId(cols[selectedCol], layoutOverrides)]
        : []
      scheduleSelectPreviewRow(ri, { persistTable: true, restoreSelection: restore })
    },
    onColumnSelect: (ci, colName) => {
      selectedCol = ci
      focusEditorTableColumn(colName || getTableColumns()[ci], { scroll: false })
    },
    onSelectionClear: () => {
      selectedCol = -1
      syncEditorSvgHighlight(null)
      layoutPanel?.selectColumns?.([])
      updateLayoutBoxToolbarButtons()
      if (suppressSelectionClearSync) return
      layoutEditor?.clearVisualState?.()
    },
    onBlankAreaPointerDown: () => {
      clearAllEditorSelection()
    },
    onReorderColumn: (from, to) => reorderColumns(from, to),
    onSetCellImage: (rowIndex, colIndex, file) => setCellImageAt(rowIndex, colIndex, file),
    onPasteImageUnavailable: () => {
      setStatus('WPS 剪贴板未提供嵌入原图（仅有整格截图），请使用「导入 Excel」', 8000)
    },
    onImportClipboardTable: async (clipboardData, { startRow = 0 } = {}) => {
      setStatus('正在解析粘贴内容…', 0)
      const result = await applyClipboardTableImport(clipboardData, { startRow })
      if (!result.ok) return false
      const { imgMsg, colMsg, rowCount } = formatPasteImportStatus(result)
      setStatus(`已粘贴 ${rowCount} 行${imgMsg}${colMsg}`)
      return true
    },
    onPositionalPaste: ({ rowCount, colCount }) => {
      clearRowSvgCache()
      void updatePreview()
      persistTableData()
      window.__CAT_CMS__?.markDirty?.()
      setStatus(colCount > 1 ? `已粘贴 ${rowCount} 行 × ${colCount} 列` : `已粘贴 ${rowCount} 行`)
    },
    parsePaste: (text) => parseDataCellRowsFromTSVText(text).map(
      (cells) => rowFromValues(cells, getTableColumns()),
    ),
    onEnsureRowCount: (count) => {
      const cols = getTableColumns()
      while (tableData.length < count) {
        tableData.push(emptyRow())
      }
      for (let i = 0; i < tableData.length; i++) {
        for (const col of cols) {
          if (!(col in tableData[i])) tableData[i][col] = ''
        }
      }
    },
    onPasteTrimRows: (count) => {
      if (count > 0 && count < tableData.length) {
        tableData.length = count
        selectedRow = Math.min(selectedRow, Math.max(0, count - 1))
        clearRowSvgCache()
      }
    },
    onAddRowBelow: (rowIndex) => addRowBelow(rowIndex),
    onDeleteRow: (rowIndex) => deleteRow(rowIndex),
    onDeleteRows: (startRow, endRow) => deleteRowsInRange(startRow, endRow),
    onAddColumnRight: (colIndex) => addColumn(colIndex),
    onDeleteColumn: (colIndex) => deleteColumn(colIndex),
    onRenameColumn: (ci, oldName, newName) => renameColumn(ci, oldName, newName),
    onEditCommit: () => commitTableStateToHistory(),
    onTableHistoryCommit: () => commitTableStateToHistory(),
    getRowHeights: () => previewUiState.rowHeights ?? {},
    onRowHeightsChange: (map, { persist = true } = {}) => setRowHeightsMap(map, { persist }),
    getDefaultRowHeight: () => DEFAULT_ROW_HEIGHT,
    getTrailingColumns: () => window.__CAT_CMS__?.getLayoutPresetTrailingColumns?.() ?? [],
    renderTrailingColHead: (metaCol, metaIndex, colIndex) => (
      window.__CAT_CMS__?.renderLayoutPresetColHead?.(metaCol, metaIndex, colIndex) ?? ''
    ),
    renderTrailingCell: (rowIndex, metaCol, metaIndex, colIndex) => (
      window.__CAT_CMS__?.renderLayoutPresetCell?.(rowIndex, metaCol, metaIndex, colIndex) ?? ''
    ),
    wireTrailingControls: (container) => {
      window.__CAT_CMS__?.wireLayoutPresetControls?.(container)
    },
  })
  return spreadsheet
}

window.__CAT_SPREADSHEET__ = {
  setSearchQuery(q) {
    return ensureSpreadsheet().setSearchQuery(q)
  },
  gotoNextSearchMatch() {
    return ensureSpreadsheet().gotoNextSearchMatch()
  },
  gotoPrevSearchMatch() {
    return ensureSpreadsheet().gotoPrevSearchMatch()
  },
  getSearchState() {
    return ensureSpreadsheet().getSearchState?.() ?? { query: '', total: 0, current: 0 }
  },
  hasActiveSelection() {
    return ensureSpreadsheet().hasActiveSelection()
  },
}

function renderTable() {
  rowCountEl && (rowCountEl.textContent = `${tableData.length} 行`)
  ensureSpreadsheet().render()
}

function buildColumnsFromData() {
  const customIds = new Set(listCustomLayoutBoxIds(layoutOverrides, getDefinedTableColumns()))
  const keys = new Set()
  for (const row of tableData) {
    for (const k of Object.keys(row)) {
      if (!customIds.has(k)) keys.add(k)
    }
  }
  const merged = [...COLUMNS]
  for (const k of keys) {
    if (!merged.includes(k)) merged.push(k)
  }
  return merged
}

function columnOrderFromRows(rows) {
  const customIds = new Set(listCustomLayoutBoxIds(layoutOverrides, columnOrder || []))
  if (!rows?.length) return null
  const order = []
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (customIds.has(k)) continue
      if (!order.includes(k)) order.push(k)
    }
  }
  return order.length ? order : null
}

function getTableColumns() {
  if (columnOrder?.length) return [...columnOrder]
  return buildColumnsFromData()
}

function syncColumnOrderFromTable() {
  columnOrder = buildColumnsFromData()
}

/** 将数据里存在但未列入 columnOrder 的列追加到末尾 */
function mergeColumnOrderFromData() {
  if (!columnOrder?.length) {
    syncColumnOrderFromTable()
    return
  }
  const customIds = new Set(listCustomLayoutBoxIds(layoutOverrides, columnOrder || []))
  const fromData = buildColumnsFromData().filter((col) => !customIds.has(col))
  const merged = [...columnOrder]
  for (const col of fromData) {
    if (!merged.includes(col)) merged.push(col)
  }
  columnOrder = merged
}

/**
 * 应用表格模板列结构。
 * @param {string[]} templateColumns
 * @param {{ strict?: boolean }} [options] strict 为 true 时不保留旧证书中多余的列
 */
function applyTableTemplateColumns(templateColumns, { strict = false } = {}) {
  const templateCols = (templateColumns || []).map((c) => String(c).trim()).filter(Boolean)
  if (templateCols.length === 0) {
    setStatus('表格模板无有效列')
    return
  }
  const existingCols = getTableColumns()
  const merged = strict
    ? [...templateCols]
    : (() => {
      const next = [...templateCols]
      for (const col of existingCols) {
        if (!next.includes(col)) next.push(col)
      }
      return next
    })()
  applyColumnOrder(merged)
  for (let i = 0; i < tableData.length; i++) {
    for (const col of templateCols) {
      if (!(col in tableData[i])) tableData[i][col] = ''
    }
  }
  clearRowSvgCache()
  renderTable()
  updatePreview()
  persistTableData()
  window.__CAT_CMS__?.markDirty?.()
  commitTableStateToHistory()
  setStatus(`已应用表格模板（${templateCols.length} 列）`)
}

function applyColumnOrder(newCols) {
  columnOrder = [...newCols]
  const colSet = new Set(columnOrder)
  for (let i = 0; i < tableData.length; i++) {
    const old = tableData[i]
    const next = {}
    for (const key of Object.keys(old)) {
      if (!colSet.has(key)) next[key] = old[key]
    }
    for (const col of columnOrder) {
      next[col] = old[col] ?? ''
    }
    tableData[i] = next
  }
}

function reorderColumns(fromIndex, toIndex) {
  const cols = getTableColumns()
  const from = Math.max(0, Math.min(fromIndex, cols.length - 1))
  let to = Math.max(0, Math.min(toIndex, cols.length - 1))
  if (from === to) return
  const next = [...cols]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  const prevCol = cols[selectedCol]
  applyColumnOrder(next)
  selectedCol = Math.max(0, next.indexOf(prevCol))
  renderTable()
  persistTableData()
  window.__CAT_CMS__?.markDirty?.()
  commitTableStateToHistory()
  setStatus('已移动列')
}

async function setCellImageAt(rowIndex, colIndex, file) {
  const cols = getTableColumns()
  const col = cols[colIndex]
  if (!col || rowIndex < 0 || rowIndex >= tableData.length) return
  setStatus('正在上传图片…', 0)
  try {
    const { url } = await api.uploadMedia(file)
    tableData[rowIndex][col] = formatImageCellValue(url)
    invalidateRowSvgCache(rowIndex)
    renderTable()
    syncPreviewFromTable(rowIndex)
    persistTableData()
    window.__CAT_CMS__?.markDirty?.()
    commitTableStateToHistory()
    setStatus('图片已上传')
  } catch (err) {
    console.error(err)
    setStatus('图片上传失败: ' + (err.message || '请检查登录与后端'))
  }
}

/** @param {number | null} insertAfterColIndex 在该列右侧插入；null 表示追加到末尾 */
function addColumn(insertAfterColIndex = null) {
  const cols = getTableColumns()
  let name = `新列${cols.length + 1}`
  let n = cols.length + 1
  while (cols.includes(name)) {
    n += 1
    name = `新列${n}`
  }
  const insertAt = insertAfterColIndex == null
    ? cols.length
    : Math.min(insertAfterColIndex + 1, cols.length)
  const newCols = [...cols.slice(0, insertAt), name, ...cols.slice(insertAt)]
  applyColumnOrder(newCols)
  selectedCol = insertAt
  renderTable()
  persistTableData()
  window.__CAT_CMS__?.markDirty?.()
  commitTableStateToHistory()
  setStatus(`已添加列「${name}」`)
}

function addRowBelow(rowIndex) {
  const ri = Math.max(0, Math.min(rowIndex, tableData.length - 1))
  tableData.splice(ri + 1, 0, emptyRow())
  syncRowPresetIdsLength()
  rowPresetIds.splice(ri + 1, 0, null)
  previewUiState.rowHeights = shiftRowHeightsForInsert(previewUiState.rowHeights ?? {}, ri + 1)
  selectedRow = ri + 1
  clearRowSvgCache()
  renderTable()
  void selectPreviewRow(selectedRow, { persistTable: true })
  persistTableData()
  window.__CAT_CMS__?.markDirty?.()
  if (isCertLayoutReadonly()) saveCertPreviewUiToServer()
  commitTableStateToHistory()
  setStatus('已在下方添加一行')
}

function deleteColumn(colIndex = selectedCol) {
  const cols = getTableColumns()
  if (cols.length <= 1) {
    setStatus('至少保留一列')
    return
  }
  const ci = Math.max(0, Math.min(colIndex, cols.length - 1))
  const colName = cols[ci]
  const newCols = cols.filter((_, i) => i !== ci)
  applyColumnOrder(newCols)
  if (selectedCol >= cols.length - 1) selectedCol = Math.max(0, cols.length - 2)
  else if (selectedCol > ci) selectedCol--
  clearRowSvgCache()
  renderTable()
  if (selectedRow >= 0) updatePreview()
  persistTableData()
  window.__CAT_CMS__?.markDirty?.()
  commitTableStateToHistory()
  setStatus(`已删除列「${colName}」`)
}

function deleteRow(rowIndex) {
  deleteRowsInRange(rowIndex, rowIndex)
}

function deleteRowsInRange(startRow, endRow) {
  const r1 = Math.max(0, Math.min(startRow, endRow))
  const r2 = Math.max(startRow, endRow)
  const count = r2 - r1 + 1
  if (tableData.length <= count) {
    setStatus('至少保留一行')
    return
  }
  clearRowSvgCache()
  tableData.splice(r1, count)
  syncRowPresetIdsLength()
  rowPresetIds.splice(r1, count)
  let rowHeights = previewUiState.rowHeights ?? {}
  for (let i = r2; i >= r1; i--) {
    rowHeights = shiftRowHeightsForDelete(rowHeights, i)
  }
  previewUiState.rowHeights = rowHeights
  if (selectedRow > r2) selectedRow -= count
  else if (selectedRow >= r1) selectedRow = Math.max(0, r1 - 1)
  if (selectedRow >= tableData.length) selectedRow = Math.max(0, tableData.length - 1)
  renderTable()
  ensureSpreadsheet().selectEntireRow?.(selectedRow)
  updatePreview()
  persistTableData()
  window.__CAT_CMS__?.markDirty?.()
  if (isCertLayoutReadonly()) saveCertPreviewUiToServer()
  commitTableStateToHistory()
  setStatus(count > 1 ? `已删除 ${count} 行` : '已删除一行')
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;')
}

function getGenerator() {
  return async (row, rowIndex = selectedRow) => {
    const ri = Math.max(0, Math.min(Number(rowIndex) || 0, Math.max(0, tableData.length - 1)))
    if (window.__CAT_CMS__?.ensureLayoutForRow) {
      await window.__CAT_CMS__.ensureLayoutForRow(ri)
    }
    const tableCols = getDefinedTableColumns()
    return generateSvgFromRow(templateSvg, applySampleAdornmentsToDisplayRow(
      row,
      getTableColumns(),
      layoutOverrides,
      presetSampleAdornments,
    ), fontUrl, {
      fontScale,
      layoutOverrides,
      showReferenceLayer,
      showTemplateLayer,
      fontCatalog,
      pageWidthMm,
      pageHeightMm,
      tableColumns: tableCols,
      restrictToRowColumns: layoutOverrides.__tableTemplateScope === true,
    })
  }
}

async function resolvePdfExportOptions() {
  const base = pdfExportOptionsFromApp()
  const fresh = await window.__CAT_CMS__?.getLinkedPresetPageSize?.()
  if (fresh) {
    pageWidthMm = fresh.pageWidthMm
    pageHeightMm = fresh.pageHeightMm
    previewViewport.setPageAspectRatio(pageWidthMm, pageHeightMm)
    return { ...base, pageWidthMm: fresh.pageWidthMm, pageHeightMm: fresh.pageHeightMm }
  }
  return base
}

function pdfExportOptionsFromApp() {
  return { ttfUrl: fontUrl, fontCatalog, pageWidthMm, pageHeightMm }
}

function syncLayerVisibilityOnPreview() {
  const svgEl = previewArea.querySelector('.preview-stage svg')
  if (!svgEl) return
  setReferenceLayerVisible(svgEl, showReferenceLayer)
  setTemplateDecorVisible(svgEl, showTemplateLayer)
}

function destroyLayoutEditor() {
  if (layoutEditor) {
    layoutEditor.destroy()
    layoutEditor = null
  }
}

function ensureLayoutPanel() {
  const panel = layoutPanelRoot()
  if (!panel || layoutPanel || isCertLayoutReadonly()) return
  layoutPanel = mountLayoutPanel(panel, {
    layoutOverrides,
    overlayShowBorder,
    overlayShowHandles,
    onOverlayVisualChange({ showBorder, showHandles }) {
      if (showBorder != null) overlayShowBorder = !!showBorder
      if (showHandles != null) overlayShowHandles = !!showHandles
      layoutEditor?.setOverlayVisual?.({ showBorder, showHandles })
    },
    getFontCatalog: () => fontCatalog,
    onChange: (next, meta) => {
      commitLayoutOverrides(next, {
        restoreSelection: layoutPanel?.getSelectedColumns?.() ?? [],
        reason: meta?.reason || '布局面板',
        previewMode: meta?.previewLight ? 'light' : 'full',
        affectedColumns: meta?.affectedColumns,
      })
      setStatus('布局已更新')
    },
    onUndo: performLayoutUndo,
    onRedo: performLayoutRedo,
    getHistoryState: getLayoutHistoryState,
    onStartPropertyPick(_targets, onPicked) {
      layoutEditor?.startPropertyPick?.(onPicked)
      setStatus('请点击要复制属性的源编辑框（Esc 取消）')
    },
    onCancelPropertyPick() {
      layoutEditor?.cancelPropertyPick?.()
    },
    getPreviewSvg: getActivePreviewSvg,
  })
  wireLayoutPanelFileButtons(panel)
}

function wireLayoutPanelFileButtons(panel) {
  panel.querySelector('#btn-export-layout-json')?.addEventListener('click', () => {
    const payload = getLayoutSettingsPayload()
    console.group('[CAT 编辑框] 导出 JSON（下载）')
    console.log('payload', structuredClone(payload))
    console.groupEnd()
    downloadLayoutSettings(payload)
    setStatus('编辑框布局 JSON 已下载')
  })

  const fileInput = panel.querySelector('#layout-json-file')
  panel.querySelector('#btn-import-layout-json')?.addEventListener('click', () => {
    fileInput?.click()
  })
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = await importLayoutSettingsFromFileInput(file)
      applyLayoutSettings(data, '导入 JSON 文件')
      updatePreview()
      persistLayoutSettings('导入编辑框布局后保存')
      setStatus('已从 JSON 导入编辑框布局')
    } catch {
      setStatus('JSON 解析失败')
    }
    e.target.value = ''
  })

  panel.querySelector('#btn-link-layout-file')?.addEventListener('click', async () => {
    const ok = await linkLayoutSettingsFile((msg) => setStatus(msg, 4000))
    if (ok) persistLayoutSettings('链接 JSON 文件后保存')
  })
}

async function updatePreview(restoreSelection = []) {
  const gen = ++previewGeneration
  ++previewSwitchGeneration

  const selectionToRestore = restoreSelection.length
    ? restoreSelection
    : (layoutEditor?.getSelectedColumns?.() ?? [])

  destroyLayoutEditor()
  clearRowSvgCache()

  if (tableData.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'preview-empty-msg'
    empty.textContent = '请添加或导入数据'
    previewViewport.setContent(empty)
    previewViewportFitPending = false
    previewDisplayedRow = -1
    updatePreviewPagination()
    return
  }

  updatePreviewPagination()

  try {
    const svgEl = await buildSvgForPreviewRow(selectedRow)
    if (gen !== previewGeneration) return

    rowSvgCache.set(rowCacheKey(selectedRow), svgEl.cloneNode(true))
    previewDisplayedRow = selectedRow

    if (previewViewportFitPending) {
      const stage = document.createElement('div')
      stage.className = 'preview-stage'
      stage.appendChild(svgEl)
      previewViewport.setContent(stage)
      attachLayoutEditorToPreview(getPreviewStage(), selectionToRestore)
      preloadAdjacentPreviewRows(selectedRow)
      afterPreviewViewportContentReady()
      return
    }

    showSvgInPreview(svgEl, selectionToRestore)
    preloadAdjacentPreviewRows(selectedRow)
  } catch (err) {
    console.error('预览更新失败', err)
  }
}

/**
 * @param {ArrayBuffer} buf
 * @param {string[]} templateColumns
 * @param {(percent: number, label: string) => void} [reportProgress]
 */
function reportImportProgress(percent, phaseLabel, detailLines, opts) {
  setExcelImportProgress(percent, phaseLabel, detailLines, opts)
}

async function loadExcelRowsWithEmbeddedImages(buf, templateColumns, reportProgress) {
  const report = reportProgress || reportImportProgress
  let lastParseLogPct = -1
  const mapParseProgress = (pct, label, detail) => {
    const mapped = 8 + Math.round((pct / 62) * 47)
    const shortLabel = String(label || '').replace(/…$/, '').split('（')[0].trim() || '解析 Excel'
    const lines = String(detail || '').split('\n').filter(Boolean)
    const logLine = pct >= lastParseLogPct + 15 || pct >= 60
      ? (lines[0] || shortLabel)
      : undefined
    if (logLine) lastParseLogPct = pct
    report(Math.min(55, mapped), shortLabel, lines.length ? lines : ['处理中…'], { logLine })
  }

  const { columns, data, worksheet, headerRow, excelRowNumbers } = await loadExcelDataAsync(buf, {
    templateColumns,
  }, { onProgress: mapParseProgress })

  if (!data.length) return { columns, data, imageStats: { uploaded: 0, missing: 0 } }

  report(
    58,
    '嵌入图片',
    [
      `表格数据 ${data.length} 行，准备扫描 DISPIMG 公式`,
      '将上传图片到服务器并写回单元格',
    ],
    { logLine: `开始处理嵌入图（${data.length} 行）` },
  )
  await yieldToMain()
  const largeFile = buf.byteLength >= 8 * 1024 * 1024
  const { data: resolvedData, stats } = await replaceDispImgCellsInRows(
    buf,
    worksheet,
    data,
    headerRow || columns,
    excelRowNumbers,
    (file) => api.uploadMedia(file),
    {
      onProgress: (info) => reportImageImportProgress(info, report),
      loadZipWithProgress: largeFile
        ? (zipBuf) => loadExcelZipArchive(zipBuf, (info) => {
          const mapped = 58 + Math.round((info.percent / 62) * 10)
          const lines = String(info.detail || '').split('\n').filter(Boolean)
          report(mapped, '解压图片包', lines.length ? lines : [info.label || '解压中'], {
            logLine: info.percent >= 35 ? '图片资源解压完成' : undefined,
          })
        })
        : null,
    },
  )
  if (stats.uploaded > 0 || stats.missing > 0) {
    report(
      85,
      '嵌入图完成',
      [
        `成功上传 ${stats.uploaded} 张`,
        stats.missing ? `未匹配/失败 ${stats.missing} 张` : '全部匹配成功',
      ],
      { logLine: `嵌入图：成功 ${stats.uploaded}，失败 ${stats.missing}` },
    )
  }
  return { columns, data: resolvedData, imageStats: stats }
}

async function loadDefaultExcel() {
  try {
    const res = await fetch(DEFAULT_EXCEL_URL)
    if (!res.ok) return
    const buf = await res.arrayBuffer()
    const { data } = await loadExcelData(buf)
    if (data.length > 0) {
      skipSave = true
      applyRows(data, 0)
      skipSave = false
      setStatus(`已加载示例数据 ${data.length} 行`)
    }
  } catch {
    // 无默认 excel 时忽略
  }
}

// --- 事件绑定 ---

document.addEventListener('paste', handleClipboardPaste, true)

document.addEventListener('paste', (e) => {
  const editView = document.getElementById('cms-view-edit')
  if (editView && !editView.classList.contains('is-active')) return
  if (e.target?.closest?.('#table-wrap, #tbl-tpl-table-wrap')) return
  if (document.querySelector('.spreadsheet-cell.is-editing')) return
  if (!tryImportLayoutBoxFromPasteEvent(e)) return
  e.preventDefault()
  e.stopPropagation()
  void handlePasteLayoutBox()
}, true)

initLayoutBoxClipboardSync(() => {
  updateLayoutBoxToolbarButtons()
})

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  const editView = document.getElementById('cms-view-edit')
  if (editView && !editView.classList.contains('is-active')) return
  const area = document.getElementById('preview-area')
  if (!area?.isConnected || !area.getClientRects().length) return
  if (e.target?.closest?.('#table-wrap, #tbl-tpl-table-wrap, .table-templates-panel')) return
  if (document.querySelector('.spreadsheet-cell.is-editing')) return
  if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return

  const key = e.key.toLowerCase()
  if (key === 'c') {
    const boxIds = layoutEditor?.getSelectedColumns?.() ?? []
    if (!boxIds.length) return
    e.preventDefault()
    e.stopImmediatePropagation()
    handleCopyLayoutBoxes(boxIds)
  } else if (key === 'v') {
    e.preventDefault()
    e.stopImmediatePropagation()
    void handlePasteLayoutBox()
  }
}, true)

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat) return
  if (isEscapeClearBlockedTarget(e.target)) return
  if (document.querySelector('.spreadsheet-cell.is-editing')) return
  clearAllEditorSelection()
})

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  const t = e.target
  if (!t || typeof t.closest !== 'function') return
  if (!t.closest('#table-wrap')) return
  if (t.closest('.layout-panel') || t.closest('.layout-overlay')) return
  if (document.querySelector('.spreadsheet-cell.is-editing')) return

  const key = e.key.toLowerCase()
  if (key === 'z' && !e.shiftKey) {
    if (performTableUndo()) {
      e.preventDefault()
      e.stopPropagation()
    }
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    if (performTableRedo()) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
}, true)

$('#btn-table-undo')?.addEventListener('click', () => {
  performTableUndo()
})

$('#btn-table-redo')?.addEventListener('click', () => {
  performTableRedo()
})

$('#btn-paste').addEventListener('click', () => {
  $('#paste-modal').classList.add('open')
  $('#paste-text').value = ''
  const cap = $('#paste-capture')
  if (cap) cap.textContent = ''
  $('#paste-capture')?.focus()
})

$('#btn-paste-from-clipboard')?.addEventListener('click', () => {
  const cap = $('#paste-capture')
  cap?.focus()
  setStatus('请在下方区域按 Ctrl+V 粘贴', 3500)
})

$('#btn-paste-cancel').addEventListener('click', () => {
  $('#paste-modal').classList.remove('open')
})

$('#btn-paste-confirm').addEventListener('click', () => {
  void (async () => {
    const text = $('#paste-text').value
    if (!text.trim()) {
      setStatus('请先粘贴或输入数据')
      return
    }
    setStatus('正在解析粘贴内容…', 0)
    const result = await applyClipboardTableImport(null, { startRow: 0, text })
    if (!result.ok) {
      setStatus('未能解析数据，请检查格式')
      return
    }
    $('#paste-modal').classList.remove('open')
    const { imgMsg, colMsg, rowCount } = formatPasteImportStatus(result)
    setStatus(`已导入 ${rowCount} 行${imgMsg}${colMsg}`)
  })()
})

$('#btn-paste-excel-file')?.addEventListener('click', () => {
  $('#paste-excel-file')?.click()
})

$('#paste-excel-file')?.addEventListener('change', async (e) => {
  const input = e.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  $('#paste-modal').classList.remove('open')
  await importExcelFile(file)
})

$('#btn-import-excel').addEventListener('click', () => {
  $('#file-excel').click()
})

function clearTableData() {
  const cols = getTableColumns()
  applyRows([emptyRow(cols.length ? cols : undefined)], 0, {
    preserveColumnOrder: !!columnOrder?.length,
    strictColumnOrder: !!columnOrder?.length,
  })
  selectedCol = -1
  ensureSpreadsheet().clearSelection?.()
  setStatus('已清空表格数据')
}

const excelImportReportDialog = $('#excel-import-report-dialog')
const excelImportReportSummaryEl = $('#excel-import-report-summary')
const excelImportReportTbody = $('#excel-import-report-tbody')
const excelImportExtraListEl = $('#excel-import-extra-list')
const excelImportReportCancelBtn = $('#excel-import-report-cancel')
const excelImportReportConfirmBtn = $('#excel-import-report-confirm')

/** @type {null | { data: Record<string, string>[], columns: string[], templateCols: string[] }} */
let pendingExcelImport = null

/** @type {null | { extraCols: string[], unmatchedExcelCols: string[] }} */
let excelImportDialogState = null

function finishExcelImportStatus(mapped, rowCount) {
  const reportSummary = formatExcelImportColumnReportSummary({
    rowCount,
    matchedCount: mapped.matchedCount,
    templateColumnCount: mapped.templateColumnCount,
    missingInExcel: mapped.missingInExcel,
    extraInExcel: mapped.extraInExcel,
  })
  const hasColumnMismatch = mapped.missingInExcel.length > 0 || mapped.extraInExcel.length > 0
  setStatus(reportSummary, hasColumnMismatch ? 10000 : 4000)
}

async function applyExcelImport(data, excelColumns, templateCols, columnMappings = {}, reportProgress) {
  const report = reportProgress || reportImportProgress
  const rowCount = data?.length || 0
  const heavy = rowCount > 80

  report(
    86,
    '整理数据',
    [
      `按模板 ${templateCols.length} 列映射 Excel 数据`,
      `共 ${rowCount} 行待写入表格`,
    ],
    { logLine: `列映射与清洗（${rowCount} 行）` },
  )
  await yieldToMain()

  const mapped = mapExcelImportToTemplateRows(data, excelColumns, templateCols, columnMappings)
  const sanitized = sanitizeCertificateRows(
    mapped.rows,
    templateCols,
    layoutOverrides,
    presetCustomSamples,
  )

  columnOrder = templateCols.length ? [...templateCols] : null

  report(
    92,
    heavy ? '渲染表格' : '更新表格',
    [
      `写入 ${sanitized.length} 行到编辑器`,
      heavy ? '行数较多，生成 DOM 可能需要数秒' : '',
    ],
    { logLine: `渲染表格 ${sanitized.length} 行` },
  )
  await yieldToMain()

  applyRows(sanitized, 0, {
    preserveColumnOrder: !!templateCols.length,
    strictColumnOrder: !!templateCols.length,
    skipPreview: heavy,
  })

  if (heavy) {
    report(97, '更新预览', [`渲染证书预览（${sanitized.length} 行）`])
    await yieldToMain()
    updatePreview()
  }

  report(100, '导入完成', [`已写入 ${sanitized.length} 行`], {
    logLine: `导入完成，共 ${sanitized.length} 行`,
  })
  finishExcelImportStatus(mapped, sanitized.length)
  return mapped
}

function buildExcelMappingSelect(templateCol, unmatchedExcelCols, selected = '') {
  const select = document.createElement('select')
  select.dataset.templateCol = templateCol
  select.className = 'excel-import-map-select'

  const emptyOpt = document.createElement('option')
  emptyOpt.value = ''
  emptyOpt.textContent = '（留空）'
  select.appendChild(emptyOpt)

  for (const col of unmatchedExcelCols) {
    const opt = document.createElement('option')
    opt.value = col
    opt.textContent = col
    if (col === selected) opt.selected = true
    select.appendChild(opt)
  }

  return select
}

function collectExcelColumnMappings() {
  /** @type {Record<string, string>} */
  const mappings = {}
  if (!excelImportReportTbody) return mappings

  const usedExcel = new Set()
  for (const select of excelImportReportTbody.querySelectorAll('select[data-template-col]')) {
    const templateCol = select.dataset.templateCol
    const excelCol = select.value
    if (!templateCol || !excelCol) continue
    if (usedExcel.has(excelCol)) {
      throw new Error(`Excel 列「${excelCol}」被重复映射到多个模板列，请调整后再导入`)
    }
    usedExcel.add(excelCol)
    mappings[templateCol] = excelCol
  }
  return mappings
}

function refreshExcelImportMappingDialog() {
  if (!excelImportDialogState || !excelImportReportTbody) return

  const { extraCols, unmatchedExcelCols } = excelImportDialogState
  const usedExcel = new Set()
  for (const select of excelImportReportTbody.querySelectorAll('select[data-template-col]')) {
    if (select.value) usedExcel.add(select.value)
  }

  if (excelImportExtraListEl) {
    const remaining = extraCols.filter((col) => !usedExcel.has(col))
    excelImportExtraListEl.replaceChildren()
    if (remaining.length) {
      for (const col of remaining) {
        const li = document.createElement('li')
        li.textContent = col
        excelImportExtraListEl.appendChild(li)
      }
    } else {
      const li = document.createElement('li')
      li.className = 'excel-import-extra-list__empty'
      li.textContent = '无'
      excelImportExtraListEl.appendChild(li)
    }
  }

  const selects = [...excelImportReportTbody.querySelectorAll('select[data-template-col]')]
  for (const select of selects) {
    const templateCol = select.dataset.templateCol
    if (!templateCol) continue
    const current = select.value
    const available = unmatchedExcelCols.filter(
      (col) => col === current || !usedExcel.has(col),
    )
    select.replaceWith(buildExcelMappingSelect(templateCol, available, current))
  }
}

function showExcelImportMappingDialog({ data, columns, templateCols, mapped }) {
  const missing = mapped.missingInExcel || []
  const extra = mapped.extraInExcel || []
  const unmatchedExcelCols = listUnmatchedExcelColumns(columns, templateCols)

  if (!excelImportReportDialog || !excelImportReportSummaryEl || !excelImportReportTbody) {
    void (async () => {
      showExcelImportProgress('正在导入 Excel')
      try {
        await applyExcelImport(data, columns, templateCols, {}, reportImportProgress)
      } finally {
        hideExcelImportProgress()
      }
    })()
    return
  }

  pendingExcelImport = { data, columns, templateCols }

  excelImportReportSummaryEl.textContent =
    `共 ${data.length} 行，列匹配 ${mapped.matchedCount}/${mapped.templateColumnCount}`

  excelImportReportTbody.replaceChildren()
  for (let i = 0; i < missing.length; i++) {
    const tr = document.createElement('tr')
    const tdMissing = document.createElement('td')
    const tdMap = document.createElement('td')

    tdMissing.textContent = missing[i]
    const suggested = extra[i] && unmatchedExcelCols.includes(extra[i]) ? extra[i] : ''
    tdMap.appendChild(buildExcelMappingSelect(missing[i], unmatchedExcelCols, suggested))

    tr.append(tdMissing, tdMap)
    excelImportReportTbody.appendChild(tr)
  }

  excelImportDialogState = { extraCols: [...extra], unmatchedExcelCols }
  refreshExcelImportMappingDialog()

  excelImportReportDialog.showModal()
}

excelImportReportTbody?.addEventListener('change', (e) => {
  if (!e.target.matches('.excel-import-map-select')) return
  refreshExcelImportMappingDialog()
})

excelImportReportCancelBtn?.addEventListener('click', () => {
  pendingExcelImport = null
  excelImportDialogState = null
  excelImportReportDialog?.close()
  setStatus('已取消 Excel 导入')
})

excelImportReportConfirmBtn?.addEventListener('click', async () => {
  if (!pendingExcelImport) {
    excelImportReportDialog?.close()
    return
  }
  try {
    const mappings = collectExcelColumnMappings()
    const { data, columns, templateCols } = pendingExcelImport
    pendingExcelImport = null
    excelImportDialogState = null
    excelImportReportDialog?.close()

    showExcelImportProgress('正在导入 Excel')
    try {
      await applyExcelImport(data, columns, templateCols, mappings, reportImportProgress)
    } finally {
      hideExcelImportProgress()
    }
  } catch (err) {
    hideExcelImportProgress()
    window.alert(err?.message || '列映射无效')
  }
})

excelImportReportDialog?.addEventListener('cancel', (e) => {
  e.preventDefault()
  pendingExcelImport = null
  excelImportDialogState = null
  setStatus('已取消 Excel 导入')
  excelImportReportDialog?.close()
})

$('#btn-clear-table').addEventListener('click', () => {
  if (tableData.length === 0 || (tableData.length === 1 && !Object.values(tableData[0] || {}).some((v) => String(v ?? '').trim()))) {
    setStatus('表格已是空的')
    return
  }
  if (!window.confirm('确定清空全部表格数据？\n\n列结构会保留，可用「撤销」恢复。')) return
  clearTableData()
})

$('#file-excel').addEventListener('change', async (e) => {
  const input = e.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await importExcelFile(file)
})

async function importExcelFile(file) {
  showExcelImportProgress('正在导入 Excel', {
    fileName: file?.name || 'Excel',
    fileSize: file?.size,
  })
  try {
    reportImportProgress(2, '读取文件', [
      file?.name ? `本地文件：${file.name}` : '正在读取所选文件',
    ])
    await yieldToMain()
    const buf = await file.arrayBuffer()
    let templateCols = tableTemplateColumns?.length
      ? [...tableTemplateColumns]
      : getTableColumns()

    reportImportProgress(6, '解析 Excel', [
      `已读入内存 ${formatImportFileSize(buf.byteLength)}`,
      buf.byteLength >= 8 * 1024 * 1024 ? '大文件：将先显示解压进度，再解析 XML' : '正在后台解析工作簿',
    ], { logLine: `开始解析（${formatImportFileSize(buf.byteLength)}）` })
    const { columns, data, imageStats } = await loadExcelRowsWithEmbeddedImages(
      buf,
      templateCols,
      reportImportProgress,
    )

    if (data.length === 0) {
      setStatus('Excel 中没有有效数据（请确认有表头行且下方有数据）')
      return
    }

    if (!templateCols.length && columns.length) {
      const customIds = new Set(listCustomLayoutBoxIds(layoutOverrides, []))
      templateCols = columns.filter((c) => !customIds.has(c))
    }

    if (!templateCols.length) {
      reportImportProgress(90, '渲染表格', [
        `生成 ${data.length} 行表格 DOM`,
      ], { logLine: `渲染 ${data.length} 行` })
      await yieldToMain()
      const heavy = data.length > 80
      applyRows(data, 0, { skipPreview: heavy })
      if (heavy) {
        await yieldToMain()
        updatePreview()
      }
      reportImportProgress(100, '导入完成', [`共 ${data.length} 行`], { logLine: '导入完成' })
      const imgMsg = imageStats.uploaded > 0
        ? `，嵌入图片 ${imageStats.uploaded} 张${imageStats.missing ? `（${imageStats.missing} 张未匹配）` : ''}`
        : ''
      setStatus(`已导入 ${data.length} 行（未配置表格模板列，已按 Excel 列导入${imgMsg}）`)
      return
    }

    reportImportProgress(85, '对照列', [
      `Excel ${columns.length} 列，表格模板 ${templateCols.length} 列`,
      `数据 ${data.length} 行`,
    ])
    await yieldToMain()
    const mapped = mapExcelImportToTemplateRows(data, columns, templateCols)

    if (mapped.missingInExcel.length > 0) {
      hideExcelImportProgress()
      showExcelImportMappingDialog({ data, columns, templateCols, mapped })
      return
    }

    await applyExcelImport(data, columns, templateCols, {}, reportImportProgress)
  } catch (err) {
    console.error('Excel 导入失败', err)
    setStatus('Excel 导入失败: ' + (err?.message || '文件格式无法识别'))
  } finally {
    hideExcelImportProgress()
  }
}

$('#btn-clear-save').addEventListener('click', async () => {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // ignore
  }
  layoutOverrides = {}
  fontScale = 1
  showLayoutBoxes = false
  showLayoutBoxesInput.checked = false
  initLayoutHistory({})
  if (layoutPanel) layoutPanel.setOverrides(layoutOverrides)
  if (layoutEditor) layoutEditor.setOverrides(layoutOverrides)
  await flushLayoutSettingsSave(() => getLayoutSettingsPayload(), (msg) => {
    setStatus(msg || '已重置编辑框布局（表格数据未改动）')
  }, '重置编辑框布局')
})

$('#btn-save-as-default').addEventListener('click', async () => {
  const payload = buildDefaultLayoutSettingsFromCurrent({
    layoutOverrides,
    fontScale,
    showLayoutBoxes,
    showReferenceLayer,
    showTemplateLayer,
  })
  const colCount = Object.keys(payload.layoutOverrides).length
  const ok = window.confirm(
    `将当前编辑框布局写入项目内置默认配置？\n\n`
    + `· 目标文件：src/default-layout-settings.json\n`
    + `· 共 ${colCount} 个编辑框列\n`
    + `· 「恢复默认编辑框」将使用此配置\n\n`
    + `需在 npm run dev 下才能写入磁盘；写入后建议刷新页面。`,
  )
  if (!ok) return

  const saved = await saveDefaultLayoutSettingsToProject(payload)
  if (saved) {
    setStatus(`已写入默认配置（${colCount} 列），请刷新页面使「恢复默认编辑框」生效`, 6000)
  } else {
    downloadDefaultLayoutSettings(payload)
    setStatus('无法写入项目文件，已下载 default-layout-settings.json，请手动替换 src/ 下同名文件', 8000)
  }
})

$('#btn-prev').addEventListener('click', () => {
  if (selectedRow > 0) {
    void selectPreviewRow(selectedRow - 1, { persistTable: true })
  }
})

$('#btn-next').addEventListener('click', () => {
  if (selectedRow < tableData.length - 1) {
    void selectPreviewRow(selectedRow + 1, { persistTable: true })
  }
})

$('#btn-preview-zoom-in').addEventListener('click', () => {
  previewViewport.zoomIn()
  flushSavePreviewSettings()
})
$('#btn-preview-zoom-out').addEventListener('click', () => {
  previewViewport.zoomOut()
  flushSavePreviewSettings()
})
$('#btn-preview-zoom-fit').addEventListener('click', () => {
  previewViewport.fitView()
  flushSavePreviewSettings()
})
$('#btn-preview-zoom-reset').addEventListener('click', () => {
  previewViewport.resetView()
  flushSavePreviewSettings()
})

const btnPreviewPan = $('#btn-preview-pan')
btnPreviewPan.addEventListener('click', () => {
  if (isCertLayoutReadonly()) return
  const on = !previewViewport.getPanMode()
  previewViewport.setPanMode(on)
  btnPreviewPan.classList.toggle('active', on)
  flushSavePreviewSettings()
})

let editorPreviewPointerMoved = false
/** @type {{ x: number, y: number } | null} */
let editorPreviewPointerStart = null

previewArea.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.layout-handle, .layout-group-box, .layout-box')) return
  editorPreviewPointerMoved = false
  editorPreviewPointerStart = { x: e.clientX, y: e.clientY }
})

previewArea.addEventListener('pointermove', (e) => {
  if (!editorPreviewPointerStart) return
  const dx = e.clientX - editorPreviewPointerStart.x
  const dy = e.clientY - editorPreviewPointerStart.y
  if (Math.hypot(dx, dy) > 4) editorPreviewPointerMoved = true
})

function handlePreviewColumnSelect(e) {
  const layoutHit = e.target.closest(
    '.layout-box, .layout-box-label, .layout-move-edge, .layout-handle, .layout-group-box, .layout-group-box-label',
  )
  if (layoutHit) {
    const box = layoutHit.closest('.layout-box')
    const boxId = box?.dataset?.column
    if (!boxId) return
    const column = getPrimaryColumnForBox(boxId, layoutOverrides) || boxId
    focusEditorTableColumn(column, { scroll: true })
    return
  }
  const svg = getActivePreviewSvg()
  if (!svg) return
  const column = resolveColumnFromPreviewClick(
    svg,
    e.target,
    e.clientX,
    e.clientY,
    layoutOverrides,
  )
  if (!column) {
    clearAllEditorSelection()
    return
  }
  focusEditorTableColumn(column, { scroll: true })
}

previewArea.addEventListener('pointerup', (e) => {
  const wasClick = !!editorPreviewPointerStart && !editorPreviewPointerMoved
  editorPreviewPointerStart = null
  if (!isCertLayoutReadonly() || !wasClick || e.button !== 0) {
    editorPreviewPointerMoved = false
    return
  }
  editorPreviewPointerMoved = false
  handlePreviewColumnSelect(e)
})

previewArea.addEventListener('click', (e) => {
  if (editorPreviewPointerMoved) return
  if (isCertLayoutReadonly()) return
  if (previewViewport.getPanMode?.()) return
  handlePreviewColumnSelect(e)
})

document.querySelector('.panel-left')?.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (e.target.closest('#table-wrap')) return
  clearAllEditorSelection()
})

document.querySelector('.layout-panel--toolbar')?.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (e.target.closest('button, input, select, label, .layout-panel-btn')) return
  clearAllEditorSelection()
})

$('#btn-add-layout-box')?.addEventListener('click', () => handleAddLayoutBox())
$('#btn-copy-layout-box')?.addEventListener('click', () => {
  layoutEditor?.flushPendingState?.()
  const boxIds = layoutEditor?.getSelectedColumns?.() ?? []
  if (!boxIds.length) {
    setStatus('请先选中至少一个编辑框')
    return
  }
  handleCopyLayoutBoxes(boxIds)
})
$('#btn-paste-layout-box')?.addEventListener('click', () => handlePasteLayoutBox())
$('#btn-delete-layout-box')?.addEventListener('click', () => handleDeleteLayoutBox())
$('#btn-rename-layout-box')?.addEventListener('click', () => promptRenameLayoutBox())

showLayoutBoxesInput.addEventListener('change', () => {
  showLayoutBoxes = showLayoutBoxesInput.checked
  if (layoutEditor) layoutEditor.setVisible(showLayoutBoxes)
  if (showLayoutBoxes && selectedCol >= 0) {
    const colName = getTableColumns()[selectedCol]
    if (colName) {
      layoutEditor?.selectColumns?.([resolveBoxId(colName, layoutOverrides)])
    }
  }
})

showReferenceLayerInput?.addEventListener('change', () => {
  showReferenceLayer = showReferenceLayerInput.checked
  clearRowSvgCache()
  void selectPreviewRow(selectedRow)
})

showTemplateLayerInput?.addEventListener('change', () => {
  showTemplateLayer = showTemplateLayerInput.checked
  clearRowSvgCache()
  void selectPreviewRow(selectedRow)
})

$('#btn-reset-layout').addEventListener('click', () => {
  const def = getDefaultLayoutSettings()
  applyLayoutSettings(def, '内置默认编辑框（src/default-layout-settings.json）', {
    applyToolbarToggles: false,
  })
  resetPreviewLayerToggles()
  commitLayoutOverrides(structuredClone(def.layoutOverrides), {
    restoreSelection: [],
    reason: '恢复内置默认编辑框',
    flush: true,
  })
  initLayoutHistory(layoutOverrides)
  setStatus('已恢复内置默认编辑框布局')
  flushSavePreviewSettings()
})

$('#btn-export-svg').addEventListener('click', async () => {
  if (tableData.length === 0) return setStatus('没有数据')
  setStatus('正在导出 SVG（嵌入图片）…', 0)
  try {
    const svgEl = await getGenerator()(tableData[selectedRow], selectedRow)
    const blob = new Blob([await serializeSvgForExport(svgEl)], { type: 'image/svg+xml;charset=utf-8' })
    const name = tableData[selectedRow]['编号'] || `cert-${selectedRow + 1}`
    downloadBlob(blob, `${sanitizeFilename(name)}.svg`)
    setStatus('SVG 已导出')
  } catch (err) {
    console.error(err)
    setStatus('SVG 导出失败: ' + (err.message || '请确认已登录且图片可访问'))
  }
})

$('#btn-export-pdf').addEventListener('click', async () => {
  if (tableData.length === 0) return setStatus('没有数据')
  setStatus('正在生成 PDF…', 0)
  try {
    const svgEl = await getGenerator()(tableData[selectedRow], selectedRow)
    const name = tableData[selectedRow]['编号'] || `cert-${selectedRow + 1}`
    await exportSvgToPdf(svgEl, `${sanitizeFilename(name)}.pdf`, await resolvePdfExportOptions())
    setStatus('PDF 已导出')
  } catch (err) {
    console.error(err)
    setStatus('PDF 导出失败: ' + err.message)
  }
})

$('#btn-export-batch').addEventListener('click', async () => {
  if (tableData.length === 0) return setStatus('没有数据')
  const btn = $('#btn-export-batch')
  btn.disabled = true
  setStatus('正在生成多页 PDF…', 0)
  try {
    const cmsTitle = document.getElementById('cms-cert-title')?.value?.trim()
    const filename = `${sanitizeFilename(cmsTitle || `certificates-${tableData.length}`)}.pdf`
    await exportRowsToSinglePdf(tableData, getGenerator(), await resolvePdfExportOptions(), filename, (info) => {
      setStatus(info?.detail || '正在生成…', 0)
    })
    setStatus(`已导出 ${tableData.length} 页 PDF`)
  } catch (err) {
    console.error(err)
    setStatus('导出失败: ' + err.message)
  } finally {
    btn.disabled = false
  }
})

function sanitizeFilename(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'certificate'
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

window.addEventListener('beforeunload', () => {
  flushSavePreviewSettings()
  if (skipSave) return
  flushTableSave(tableData, selectedRow)
  flushLayoutSettingsSaveKeepalive(() => getLayoutSettingsPayload(), '关闭页面前保存编辑框')
})

const EDITOR_SPLIT_STORAGE_KEY_H = 'cat.editor.leftPanelWidthPx'
const EDITOR_SPLIT_STORAGE_KEY_V = 'cat.editor.topPanelHeightPx'
const EDITOR_SPLIT_MIN_LEFT = 280
const EDITOR_SPLIT_MIN_RIGHT = 320
const EDITOR_SPLIT_MIN_TOP = 200
const EDITOR_SPLIT_MIN_BOTTOM = 240

const editorMain = document.querySelector('.main')
const editorPanelLeft = document.querySelector('.panel-left')
const editorSplitHandle = document.getElementById('editor-split-handle')

function isVerticalEditorSplit() {
  return isCertLayoutReadonly()
}

function getEditorSplitStorageKey() {
  return isVerticalEditorSplit() ? EDITOR_SPLIT_STORAGE_KEY_V : EDITOR_SPLIT_STORAGE_KEY_H
}

function clampEditorSplitPrimary(px) {
  if (!editorMain || !editorSplitHandle) return px
  if (isVerticalEditorSplit()) {
    const total = editorMain.clientHeight - editorSplitHandle.offsetHeight
    const max = Math.max(EDITOR_SPLIT_MIN_TOP, total - EDITOR_SPLIT_MIN_BOTTOM)
    return Math.max(EDITOR_SPLIT_MIN_TOP, Math.min(px, max))
  }
  const total = editorMain.clientWidth - editorSplitHandle.offsetWidth
  const max = Math.max(EDITOR_SPLIT_MIN_LEFT, total - EDITOR_SPLIT_MIN_RIGHT)
  return Math.max(EDITOR_SPLIT_MIN_LEFT, Math.min(px, max))
}

function applyEditorSplitPrimary(px, persist = false) {
  if (!editorPanelLeft || !editorMain) return
  if (window.matchMedia('(max-width: 960px)').matches) return
  if (isVerticalEditorSplit()) {
    const h = clampEditorSplitPrimary(px)
    editorPanelLeft.style.flex = `0 0 ${h}px`
    editorPanelLeft.style.height = `${h}px`
    editorPanelLeft.style.maxHeight = `${h}px`
    editorPanelLeft.style.width = '100%'
    editorPanelLeft.style.maxWidth = 'none'
    if (editorSplitHandle) {
      editorSplitHandle.setAttribute('aria-orientation', 'horizontal')
      editorSplitHandle.title = '拖动调整上下高度'
    }
  } else {
    const w = clampEditorSplitPrimary(px)
    editorPanelLeft.style.flex = `0 0 ${w}px`
    editorPanelLeft.style.width = `${w}px`
    editorPanelLeft.style.maxWidth = `${w}px`
    editorPanelLeft.style.height = ''
    editorPanelLeft.style.maxHeight = ''
    if (editorSplitHandle) {
      editorSplitHandle.setAttribute('aria-orientation', 'vertical')
      editorSplitHandle.title = '拖动调整左右宽度'
    }
  }
  if (persist) {
    if (isVerticalEditorSplit()) {
      const h = clampEditorSplitPrimary(px)
      previewFloatController?.setDockHeight?.(Math.round(h), { notify: false })
      syncPreviewUiFromController()
      saveCertPreviewUiToServer()
    } else {
      try {
        localStorage.setItem(getEditorSplitStorageKey(), String(Math.round(px)))
      } catch {
        // ignore
      }
    }
  }
}

function syncPreviewUiFromController() {
  if (!previewFloatController) return
  const floatUi = previewFloatController.getState()
  previewUiState = {
    ...floatUi,
    rowHeights: previewUiState.rowHeights ?? {},
  }
}

function setRowHeightsMap(map, { persist = true } = {}) {
  previewUiState.rowHeights = structuredClone(map)
  if (persist && isCertLayoutReadonly()) {
    saveCertPreviewUiToServer()
  } else if (persist) {
    window.__CAT_CMS__?.markDirty?.()
  }
}

function applyLoadedPreviewUi(rawPreviewUi) {
  previewUiState = structuredClone(normalizePreviewUi(rawPreviewUi))
  previewFloatController?.setState(previewUiState)

  const applyDockSplit = () => {
    if (previewUiState.mode === 'floating') return
    const dockH = previewUiState.dock?.tableHeight
    if (Number.isFinite(dockH) && dockH > 0) {
      applyEditorSplitPrimary(dockH)
      return
    }
    restoreEditorSplit()
  }

  applyDockSplit()
  requestAnimationFrame(() => {
    requestAnimationFrame(applyDockSplit)
  })
}

function saveCertPreviewUiToServer() {
  if (!isCertLayoutReadonly()) return
  if (!window.__CAT_CMS__?.getCurrentCertId?.()) return
  syncPreviewUiFromController()
  void window.__CAT_CMS__?.saveCertificate?.(true)?.catch((err) => {
    console.warn('[预览布局] 保存失败', err)
  })
}

function restoreEditorSplit() {
  if (!editorMain || !editorPanelLeft) return
  if (isVerticalEditorSplit()) {
    const fromUi = previewUiState?.dock?.tableHeight
    if (Number.isFinite(fromUi) && fromUi > 0) {
      applyEditorSplitPrimary(fromUi)
      return
    }
    applyEditorSplitPrimary(editorMain.clientHeight * 0.42)
    return
  }
  const saved = Number(localStorage.getItem(getEditorSplitStorageKey()))
  if (saved > 0) {
    applyEditorSplitPrimary(saved)
    return
  }
  applyEditorSplitPrimary(editorMain.clientWidth * 0.36)
}

const certPreviewPanel = document.getElementById('cert-preview-panel')

previewFloatController = mountPreviewFloat({
  panel: certPreviewPanel || document.querySelector('.panel-right'),
  splitHandle: editorSplitHandle,
  isEnabled: isCertLayoutReadonly,
  onChange(ui) {
    previewUiState = structuredClone(ui)
    window.__CAT_CMS__?.markDirty?.()
  },
})

window.__CAT_PREVIEW_FLOAT__ = previewFloatController
window.__CAT_SET_CERT_PREVIEW_PAN__ = applyCertPreviewPanMode

function mountEditorSplitResize() {
  if (!editorSplitHandle || !editorPanelLeft || !editorMain) return

  restoreEditorSplit()

  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 960px)').matches) return
    const rect = editorPanelLeft.getBoundingClientRect()
    applyEditorSplitPrimary(isVerticalEditorSplit() ? rect.height : rect.width)
  })

  let dragging = false

  const onMove = (clientX, clientY) => {
    if (!dragging) return
    const rect = editorMain.getBoundingClientRect()
    if (isVerticalEditorSplit()) {
      applyEditorSplitPrimary(clientY - rect.top)
    } else {
      applyEditorSplitPrimary(clientX - rect.left)
    }
  }

  const stopDrag = () => {
    if (!dragging) return
    dragging = false
    document.body.classList.remove('editor-split-dragging')
    const rect = editorPanelLeft.getBoundingClientRect()
    applyEditorSplitPrimary(isVerticalEditorSplit() ? rect.height : rect.width, true)
    window.dispatchEvent(new Event('resize'))
  }

  editorSplitHandle.addEventListener('mousedown', (e) => {
    if (window.matchMedia('(max-width: 960px)').matches) return
    dragging = true
    document.body.classList.add('editor-split-dragging')
    e.preventDefault()
  })

  editorSplitHandle.addEventListener(
    'touchstart',
    (e) => {
      if (window.matchMedia('(max-width: 960px)').matches) return
      dragging = true
      document.body.classList.add('editor-split-dragging')
      e.preventDefault()
    },
    { passive: false },
  )

  window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY))
  window.addEventListener('mouseup', stopDrag)
  window.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY)
    },
    { passive: true },
  )
  window.addEventListener('touchend', stopDrag)
  window.addEventListener('touchcancel', stopDrag)

  editorSplitHandle.addEventListener('keydown', (e) => {
    if (window.matchMedia('(max-width: 960px)').matches) return
    const step = e.shiftKey ? 24 : 8
    const rect = editorPanelLeft.getBoundingClientRect()
    if (isVerticalEditorSplit()) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? step : -step
      applyEditorSplitPrimary(rect.height + delta, true)
      window.dispatchEvent(new Event('resize'))
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? step : -step
      applyEditorSplitPrimary(rect.width + delta, true)
      window.dispatchEvent(new Event('resize'))
    }
  })
}

window.__CAT_EDITOR_SPLIT__ = { restore: restoreEditorSplit }

mountEditorSplitResize()
mountFontNoticeBar()
setFontLoadErrorHandler(showFontNoticeErrors)
setFontReloadHook(async (catalog, { errors }) => {
  fontCatalog = catalog
  fontUrl = catalog.defaultUrl
  layoutPanel?.refreshFontCatalog?.()
  clearRowSvgCache()
  if (!errors.length) {
    await updatePreview()
  } else {
    setStatus(`仍有 ${errors.length} 个字体源加载失败`, 6000)
  }
})

// 启动：登录 → CMS → 预加载字体
renderTable()

requireAdminSession()
  .then(async (user) => {
    if (!user) return null

    bootLayoutSwitchDebugHint()

    const siteConfig = await loadSiteConfig()
    applyDocumentTitle()

    const cms = mountCmsBar($('#cms-root'), {
      user,
      siteConfig,
      getEditorState,
      loadEditorState,
      applyPresetLayoutContext,
      invalidateRowPresetCache: invalidateRowSvgCache,
      applyTableTemplate: applyTableTemplateColumns,
      setRowPresetId,
      setAllRowPresetIds,
      setRowPresetIds,
      getRowPresetIds,
      onTableRefreshNeeded: () => renderTable(),
      refreshPreviewForRow,
      getPreviewDisplayedRow: () => previewDisplayedRow,
      syncPreviewToRow,
      onStatus: setStatus,
    })
    cms.mountEditor(document.querySelector('.app'))
    mountFontNoticeBar()

    fontCatalog = await loadFontCatalog()
    setActiveFontCatalog(fontCatalog)
    const fontLoad = await ensureCatalogFontFaces(fontCatalog)
    if (fontLoad.errors.length) {
      setStatus(`部分字体源加载失败（${fontLoad.errors.length} 项），详见顶部红色提示`, 8000)
    }
    fontUrl = fontCatalog.defaultUrl
    layoutPanel?.refreshFontCatalog?.()

    const legacy = loadLegacyBrowserState()
    const { data: fileData, source: layoutSource } = await loadLayoutSettingsOnStartup(
      loadBakedLayoutSettingsFromServer,
    )
    if (fileData) {
      applyLayoutSettings(fileData, layoutSource, { applyToolbarToggles: false })
    } else if (legacy) {
      await applyLegacyBrowserState(legacy)
    }
    applyPreviewToolbarSettings(loadPreviewSettings())
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // ignore
    }

    const loadedFromServer = await cms.init()
    applyPreviewToolbarSettings(loadPreviewSettings())
    if (!loadedFromServer) {
      const savedTable = loadTableFromStorage()
      if (savedTable) {
        skipSave = true
        applyRows(savedTable.rows, savedTable.selectedRow)
        skipSave = false
        setStatus(`已恢复 ${savedTable.rows.length} 行表格数据（本地缓存）`)
      } else if (tableData.length === 0) {
        await loadDefaultExcel()
      }
    }

    if (fileData?.hadLegacyRows) {
      persistLayoutSettings('清除旧版 JSON 中的表格数据')
    }

    layoutOverrides = syncAutoColumnBindings(layoutOverrides, getTableColumns())
    if (layoutPanel) layoutPanel.setOverrides(layoutOverrides)

    initLayoutHistory(layoutOverrides)
    updateLayoutHistoryBaseline(layoutOverrides)
    ensureLayoutPanel()
    await updatePreview()
    tableHistoryReady = false
    commitTableStateToHistory()
    return cms
  })
  .catch((err) => {
    console.error(err)
    setStatus('启动失败: ' + (err.message || '请刷新页面'))
  })

// 暴露列映射供调试
window.__CAT_COLUMNS__ = COLUMNS
window.__CAT_FIELD_MAP__ = COLUMN_TO_FIELD
