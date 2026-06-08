import { sampleSegmentsToDisplayText } from './sampleDialogSegments.js'
import {
  getColumnLayout,
  applyColumnBoxBounds,
  layoutHasBox,
  clampLayoutBoxBounds,
  listLayoutBoxIds,
} from './svgEngine.js'
import { getColumnsForBox, layoutOverridesOverlaySignature } from './layoutBinding.js'
import {
  expandBoxSelection,
  findMatchingGroupLabel,
} from './layoutGroups.js'
import {
  getSelectionUnionBounds,
  moveBoxesFromSnapshot,
  resizeBoxesInGroup,
  computeResizedGroupBounds,
  ensureSelectionMinBoxSizes,
} from './layoutBoxOps.js'
import { duplicateLayoutBoxesAtOffset, hasLayoutBoxClipboard } from './layoutBoxClipboard.js'
const KEY_NUDGE_STEP = 0.5
const KEY_NUDGE_STEP_SHIFT = 2
const KEY_NUDGE_DEBOUNCE_MS = 500
const MARQUEE_THRESHOLD_PX = 4
const RESIZE_HANDLE_EDGES = ['nw', 'ne', 'se', 'sw', 'n', 's', 'e', 'w']
const CORNER_HANDLE_CURSORS = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
}
/** 可见调整手柄：每条边 3 个（左/中/右 或 上/中/下），四角与中点共 8 个 */
const VISIBLE_BOX_HANDLES = [
  { id: 'nw', cursor: CORNER_HANDLE_CURSORS.nw },
  { id: 'n', cursor: 'ns-resize' },
  { id: 'ne', cursor: CORNER_HANDLE_CURSORS.ne },
  { id: 'e', cursor: 'ew-resize' },
  { id: 'se', cursor: CORNER_HANDLE_CURSORS.se },
  { id: 's', cursor: 'ns-resize' },
  { id: 'sw', cursor: CORNER_HANDLE_CURSORS.sw },
  { id: 'w', cursor: 'ew-resize' },
]

/** SVG 用户坐标 → stage 内像素（与 getScreenCTM 一致，避免 viewBox 留白导致错位） */
function createStageMapper(svgEl, stageEl) {
  const stageRect = stageEl.getBoundingClientRect()
  const ctm = svgEl.getScreenCTM?.()
  if (!ctm || !stageRect.width) return null
  return {
    toStage(svgX, svgY) {
      const pt = svgEl.createSVGPoint()
      pt.x = svgX
      pt.y = svgY
      const screen = pt.matrixTransform(ctm)
      return {
        left: screen.x - stageRect.left,
        top: screen.y - stageRect.top,
      }
    },
  }
}

function stagePxToSvg(svgEl, stageEl, px, py) {
  const stageRect = stageEl.getBoundingClientRect()
  const ctm = svgEl.getScreenCTM?.()
  if (!ctm) return null
  const pt = svgEl.createSVGPoint()
  pt.x = stageRect.left + px
  pt.y = stageRect.top + py
  const out = pt.matrixTransform(ctm.inverse())
  return { x: out.x, y: out.y }
}

/** stage 内像素位移 → SVG 用户坐标位移（与 toStage / getScreenCTM 互逆） */
function stageDeltaToSvg(svgEl, stageEl, stageDx, stageDy) {
  const origin = stagePxToSvg(svgEl, stageEl, 0, 0)
  const moved = stagePxToSvg(svgEl, stageEl, stageDx, stageDy)
  if (!origin || !moved) return null
  return { dx: moved.x - origin.x, dy: moved.y - origin.y }
}

function applyBoxStyle(boxEl, layout, mapper) {
  if (!layoutHasBox(layout) || !mapper) return
  const tl = mapper.toStage(layout.boxLeft, layout.boxTop)
  const br = mapper.toStage(layout.boxRight, layout.boxBottom)
  const left = Math.round(tl.left)
  const top = Math.round(tl.top)
  const right = Math.round(br.left)
  const bottom = Math.round(br.top)
  const width = Math.max(4, right - left)
  const height = Math.max(4, bottom - top)
  boxEl.style.left = `${left}px`
  boxEl.style.top = `${top}px`
  boxEl.style.width = `${width}px`
  boxEl.style.height = `${height}px`
  applyBoxVisualStyle(boxEl, layout)
}

function applyBoxVisualStyle(boxEl, _layout) {
  boxEl.style.background = ''
  boxEl.style.borderColor = ''
  boxEl.style.transform = ''
  boxEl.style.transformOrigin = ''
}

function appendBoxDashFrame(box) {
  if (box.querySelector('.layout-box-dash-frame')) return
  const dashFrame = document.createElement('div')
  dashFrame.className = 'layout-box-dash-frame'
  dashFrame.setAttribute('aria-hidden', 'true')
  for (const side of ['n-left', 'n-right', 's-left', 's-right', 'w-top', 'w-bottom', 'e-top', 'e-bottom']) {
    const seg = document.createElement('span')
    seg.className = `layout-box-dash-seg layout-box-dash-seg--${side}`
    dashFrame.appendChild(seg)
  }
  box.appendChild(dashFrame)
}

function appendBoxInteractionChrome(box) {
  for (const edge of ['n', 's', 'e', 'w']) {
    box.appendChild(createMoveEdge(`layout-move-edge-${edge}`))
  }
  for (const { id, cursor } of VISIBLE_BOX_HANDLES) {
    box.appendChild(createHandle(`layout-handle-${id}`, cursor))
  }
}

function appendBoxResizeChrome(box) {
  appendBoxDashFrame(box)
  appendBoxInteractionChrome(box)
}

function findResizeEdgeFromHandle(handle) {
  if (!handle) return null
  return RESIZE_HANDLE_EDGES.find((h) => handle.classList.contains(`layout-handle-${h}`)) || null
}

function applyGroupBoxStyle(groupEl, bounds, mapper) {
  if (!bounds || !mapper) return
  const tl = mapper.toStage(bounds.left, bounds.top)
  const br = mapper.toStage(bounds.right, bounds.bottom)
  const left = Math.round(tl.left)
  const top = Math.round(tl.top)
  const right = Math.round(br.left)
  const bottom = Math.round(br.top)
  groupEl.style.left = `${left}px`
  groupEl.style.top = `${top}px`
  groupEl.style.width = `${Math.max(4, right - left)}px`
  groupEl.style.height = `${Math.max(4, bottom - top)}px`
}

function createHandle(className, cursor) {
  const el = document.createElement('div')
  el.className = `layout-handle ${className}`
  el.style.cursor = cursor
  return el
}

function createMoveEdge(className) {
  const el = document.createElement('div')
  el.className = `layout-move-edge ${className}`
  return el
}

function boxesIntersectSvgRect(layout, x1, y1, x2, y2) {
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  const minY = Math.min(y1, y2)
  const maxY = Math.max(y1, y2)
  return !(
    layout.boxRight < minX
    || layout.boxLeft > maxX
    || layout.boxBottom < minY
    || layout.boxTop > maxY
  )
}

function refreshBoxes(boxes, columns, overrides, mapper, getLayout = getColumnLayout) {
  for (const col of columns) {
    const el = boxes.get(col)
    if (el) applyBoxStyle(el, getLayout(col, overrides), mapper)
  }
}

function refreshAllBoxes(boxes, overrides, mapper, getLayout = getColumnLayout) {
  refreshBoxes(boxes, [...boxes.keys()], overrides, mapper, getLayout)
}

function snapshotLayouts(columns, overrides, getLayout = getColumnLayout) {
  const startLayouts = {}
  for (const col of columns) {
    const l = getLayout(col, overrides)
    startLayouts[col] = {
      boxLeft: l.boxLeft,
      boxRight: l.boxRight,
      boxTop: l.boxTop,
      boxBottom: l.boxBottom,
    }
  }
  return startLayouts
}

function formatBoxLabel(boxId, layoutOverrides, auxiliaryBox) {
  if (auxiliaryBox?.id === boxId) return auxiliaryBox.label || boxId
  const cols = getColumnsForBox(boxId, layoutOverrides).filter((c) => c !== boxId)
  if (cols.length) return `${boxId} → ${cols.join('、')}`
  return boxId
}

/**
 * @param {HTMLElement} stage
 * @param {SVGSVGElement} svgEl
 * @param {{ layoutOverrides: object, visible?: boolean, readOnly?: boolean, overlayShowBorder?: boolean, overlayShowHandles?: boolean, sampleInputs?: boolean, sampleDialogHint?: string, getSampleText?: (boxId: string) => string, getSampleDialogSegments?: (boxId: string) => { prefix: string[], core: string, suffix: string[] }, isSampleCoreReadonly?: (boxId: string) => boolean, onSampleChange?: (boxId: string, segments: { prefix: string[], core: string, suffix: string[] }) => void, tableColumns?: string[], getReservedBoxIds?: () => string[], onDragDuplicate?: (idMap: Record<string, string>) => void, onCommit: (next: object, reason?: string) => void, onSelectColumns?: (boxIds: string[]) => void, onRenameBox?: (oldId: string, newId: string) => void, onDeleteBoxes?: (boxIds: string[]) => void, onCopyBox?: (boxId: string) => void, onPasteBox?: () => void, onUndo?: () => void, onRedo?: () => void, isShortcutScopeActive?: () => boolean }} options
 */
export function mountLayoutEditor(stage, svgEl, options) {
  const readOnly = !!options.readOnly
  let overlayVisible = options.visible !== false
  let overlayShowBorder = options.overlayShowBorder !== false
  let overlayShowHandles = options.overlayShowHandles !== false
  const overlay = document.createElement('div')
  overlay.className = 'layout-overlay'
  if (options.visible === false) overlay.classList.add('layout-overlay--hidden')
  if (readOnly) overlay.classList.add('layout-overlay--readonly')
  stage.appendChild(overlay)

  function isAuxBox(boxId) {
    const aux = options.auxiliaryBox
    return !!aux && aux.id === boxId && aux.isActive?.() !== false
  }

  function isAuxActive() {
    const aux = options.auxiliaryBox
    return !!aux && aux.isActive?.() !== false
  }

  function getLayoutForBox(boxId, overrides = pendingOverrides) {
    if (isAuxBox(boxId)) {
      return options.auxiliaryBox.getLayout(overrides)
    }
    return getColumnLayout(boxId, overrides)
  }

  function applyBoundsForBox(overrides, boxId, bounds, edge) {
    if (isAuxBox(boxId)) {
      const merged = clampLayoutBoxBounds({
        ...getLayoutForBox(boxId, overrides),
        ...bounds,
      }, edge)
      return options.auxiliaryBox.setLayout(overrides, merged)
    }
    return applyColumnBoxBounds(overrides, boxId, bounds, edge)
  }

  function getLayoutBridge() {
    return {
      getLayout: getLayoutForBox,
      applyBounds: applyBoundsForBox,
    }
  }

  function isNonEditableAux(boxId) {
    if (!isAuxBox(boxId)) return false
    const aux = options.auxiliaryBox
    return !!(aux.noDelete || aux.noCopy || aux.noRename || aux.noDuplicate)
  }

  function listOverlayBoxIds(overrides = pendingOverrides) {
    const ids = listLayoutBoxIds(overrides)
    if (isAuxActive()) ids.push(options.auxiliaryBox.id)
    return ids
  }

  function applyOverlayVisibility() {
    const auxActive = isAuxActive()
    const auxOnly = auxActive && !overlayVisible
    overlay.classList.toggle('layout-overlay--hidden', !overlayVisible && !auxActive)
    overlay.classList.toggle('layout-overlay--aux-only', auxOnly)
  }

  function applyOverlayVisualClasses() {
    overlay.classList.toggle('layout-overlay--no-border', !overlayShowBorder)
    overlay.classList.toggle('layout-overlay--no-handles', !overlayShowHandles)
  }
  applyOverlayVisualClasses()
  applyOverlayVisibility()

  const marqueeRoot =
    stage.closest('.preview-area--viewport')
    || stage.closest('.preview-area')
    || stage.closest('.preview-viewport')
    || stage

  const marqueeRect = document.createElement('div')
  marqueeRect.className = 'layout-marquee-rect'
  marqueeRect.hidden = true
  marqueeRoot.appendChild(marqueeRect)

  /** @type {((e: PointerEvent) => void) | null} */
  let onMarqueeRootPointerDown = null

  const copyGhostLayer = document.createElement('div')
  copyGhostLayer.className = 'layout-copy-ghost-layer'
  overlay.appendChild(copyGhostLayer)

  const dragCopyCursor = document.createElement('div')
  dragCopyCursor.className = 'layout-drag-copy-cursor'
  dragCopyCursor.hidden = true
  dragCopyCursor.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="7" width="3.5" height="10" rx="0.75" fill="currentColor"/><line x1="6.75" y1="6" x2="6.75" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="8.25" y="7" width="3.5" height="10" rx="0.75" fill="currentColor"/><line x1="13" y1="6" x2="13" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="14.5" y="7" width="3.5" height="10" rx="0.75" fill="currentColor"/><line x1="19.25" y1="6" x2="19.25" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="20.75" y="7" width="3.5" height="10" rx="0.75" fill="currentColor"/></svg>`
  document.body.appendChild(dragCopyCursor)

  let pendingOverrides = { ...options.layoutOverrides }
  let dragState = null
  /** @type {Set<string>} */
  let selectedColumns = new Set()
  let selectionNotifyTimer = null
  /** 本次选中是否同步表格列定位（框选 / Shift 多选为 false） */
  let pendingSelectionSyncTable = true

  const boxes = new Map()
  /** @type {HTMLDialogElement | null} */
  let sampleDialog = null
  /** @type {HTMLElement | null} */
  let sampleDialogPrefixList = null
  /** @type {HTMLTextAreaElement | null} */
  let sampleDialogCoreText = null
  /** @type {HTMLElement | null} */
  let sampleDialogSuffixList = null
  /** @type {HTMLElement | null} */
  let sampleDialogTitle = null
  /** @type {string | null} */
  let sampleDialogBoxId = null
  /** @type {HTMLButtonElement | null} */
  let sampleDialogStrip = null
  /** @type {null | { onPick: (sourceBoxId: string) => void }} */
  let propertyPickState = null

  /** @type {(label: HTMLSpanElement, boxId: string) => void} */
  let wireBoxLabel = () => {}

  function truncateSampleText(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim()
    if (!normalized) return '双击输入示例'
    const preview = normalized.replace(/\n/g, ' ↵ ')
    return preview.length > 24 ? `${preview.slice(0, 24)}…` : preview
  }

  function updateSampleStripText(strip, text) {
    strip.textContent = truncateSampleText(text)
    strip.dataset.fullText = text || ''
    strip.classList.toggle('layout-box-sample--empty', !String(text || '').trim())
  }

  function createSampleSegmentRow(value = '', { onRemove } = {}) {
    const row = document.createElement('div')
    row.className = 'layout-sample-dialog-segment-row'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'layout-sample-dialog-segment-input'
    input.value = value
    input.placeholder = '自定义内容'
    row.appendChild(input)
    if (onRemove) {
      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className = 'layout-sample-dialog-segment-remove'
      removeBtn.title = '移除此行'
      removeBtn.setAttribute('aria-label', '移除此行')
      removeBtn.textContent = '×'
      removeBtn.addEventListener('click', () => {
        row.remove()
      })
      row.appendChild(removeBtn)
    }
    return { row, input }
  }

  function clearSampleDialogSegmentLists() {
    if (sampleDialogPrefixList) sampleDialogPrefixList.innerHTML = ''
    if (sampleDialogSuffixList) sampleDialogSuffixList.innerHTML = ''
  }

  function addSampleDialogPrefixRow(value = '', { focus = true } = {}) {
    if (!sampleDialogPrefixList) return null
    const { row, input } = createSampleSegmentRow(value, { onRemove: true })
    sampleDialogPrefixList.appendChild(row)
    if (focus) input.focus()
    return input
  }

  function addSampleDialogSuffixRow(value = '', { focus = true } = {}) {
    if (!sampleDialogSuffixList) return null
    const { row, input } = createSampleSegmentRow(value, { onRemove: true })
    sampleDialogSuffixList.appendChild(row)
    if (focus) input.focus()
    return input
  }

  function collectSampleDialogSegments() {
    const prefix = sampleDialogPrefixList
      ? [...sampleDialogPrefixList.querySelectorAll('.layout-sample-dialog-segment-input')].map((el) => el.value)
      : []
    const core = sampleDialogCoreText?.value ?? ''
    const suffix = sampleDialogSuffixList
      ? [...sampleDialogSuffixList.querySelectorAll('.layout-sample-dialog-segment-input')].map((el) => el.value)
      : []
    return { prefix, core, suffix }
  }

  function populateSampleDialogSegments(segments, { coreReadonly = false } = {}) {
    clearSampleDialogSegmentLists()
    for (const line of segments.prefix || []) {
      addSampleDialogPrefixRow(line, { focus: false })
    }
    for (const line of segments.suffix || []) {
      addSampleDialogSuffixRow(line, { focus: false })
    }
    if (sampleDialogCoreText) {
      sampleDialogCoreText.value = segments.core ?? ''
      sampleDialogCoreText.readOnly = coreReadonly
      sampleDialogCoreText.classList.toggle('layout-sample-dialog-core-text--readonly', coreReadonly)
    }
  }

  function ensureSampleDialog() {
    if (sampleDialog) return sampleDialog
    sampleDialog = document.createElement('dialog')
    sampleDialog.className = 'layout-sample-dialog'
    sampleDialog.innerHTML = `
      <form method="dialog" class="layout-sample-dialog-inner">
        <h3 class="layout-sample-dialog-title">示例内容</h3>
        <p class="layout-sample-dialog-hint"></p>
        <div class="layout-sample-dialog-insert-actions">
          <button type="button" class="button button-sm layout-sample-dialog-add-prefix">前加内容</button>
          <button type="button" class="button button-sm layout-sample-dialog-add-suffix">后加内容</button>
        </div>
        <div class="layout-sample-dialog-segments">
          <div class="layout-sample-dialog-prefix-list" aria-label="前置内容"></div>
          <label class="layout-sample-dialog-core">
            <span class="layout-sample-dialog-core-label">原内容</span>
            <textarea class="layout-sample-dialog-core-text" rows="4"></textarea>
          </label>
          <div class="layout-sample-dialog-suffix-list" aria-label="后置内容"></div>
        </div>
        <div class="layout-sample-dialog-actions">
          <button type="button" class="button button-sm layout-sample-dialog-cancel">取消</button>
          <button type="submit" class="button button-sm button-primary">确定</button>
        </div>
      </form>
    `
    document.body.appendChild(sampleDialog)
    sampleDialogTitle = sampleDialog.querySelector('.layout-sample-dialog-title')
    const hintEl = sampleDialog.querySelector('.layout-sample-dialog-hint')
    if (hintEl) {
      hintEl.textContent = options.sampleDialogHint
        || '用于布局预览，不影响证书数据。可在原内容前后追加自定义文字。'
    }
    sampleDialogPrefixList = sampleDialog.querySelector('.layout-sample-dialog-prefix-list')
    sampleDialogCoreText = sampleDialog.querySelector('.layout-sample-dialog-core-text')
    sampleDialogSuffixList = sampleDialog.querySelector('.layout-sample-dialog-suffix-list')
    sampleDialog.querySelector('.layout-sample-dialog-add-prefix')?.addEventListener('click', () => {
      addSampleDialogPrefixRow('')
    })
    sampleDialog.querySelector('.layout-sample-dialog-add-suffix')?.addEventListener('click', () => {
      addSampleDialogSuffixRow('')
    })
    sampleDialog.querySelector('.layout-sample-dialog-cancel')?.addEventListener('click', () => {
      sampleDialog?.close('cancel')
    })
    sampleDialog.addEventListener('close', () => {
      if (sampleDialog?.returnValue !== 'ok' || !sampleDialogBoxId) return
      const segments = collectSampleDialogSegments()
      const displayText = sampleSegmentsToDisplayText(segments)
      options.onSampleChange?.(sampleDialogBoxId, segments)
      if (sampleDialogStrip) updateSampleStripText(sampleDialogStrip, displayText)
      sampleDialogBoxId = null
      sampleDialogStrip = null
    })
    sampleDialog.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      sampleDialog.returnValue = 'ok'
      sampleDialog.close('ok')
    })
    return sampleDialog
  }

  function canEditSampleOnBox() {
    return !readOnly && typeof options.getSampleText === 'function' && typeof options.onSampleChange === 'function'
  }

  function openSampleDialog(boxId, currentText, strip, anchorEvent) {
    const dlg = ensureSampleDialog()
    sampleDialogBoxId = boxId
    sampleDialogStrip = strip
    const hintEl = dlg.querySelector('.layout-sample-dialog-hint')
    if (hintEl) {
      hintEl.textContent = options.sampleDialogHint
        || '用于布局预览，不影响证书数据。可在原内容前后追加自定义文字。'
    }
    if (sampleDialogTitle) {
      sampleDialogTitle.textContent = `示例内容 · ${formatBoxLabel(boxId, pendingOverrides)}`
    }
    const segments = options.getSampleDialogSegments?.(boxId)
      ?? { prefix: [], core: currentText, suffix: [] }
    const coreReadonly = options.isSampleCoreReadonly?.(boxId) === true
    populateSampleDialogSegments(segments, { coreReadonly })
    dlg.showModal()
    const firstPrefix = sampleDialogPrefixList?.querySelector('.layout-sample-dialog-segment-input')
    const focusTarget = firstPrefix || sampleDialogCoreText
    focusTarget?.focus()
    if (focusTarget === sampleDialogCoreText && !coreReadonly) {
      sampleDialogCoreText.select()
    }
  }

  function isPreviewPanMode(e) {
    const area = stage.closest('.preview-area')
    if (area?.classList.contains('preview-pan-mode')) return true
    if (area?.classList.contains('preview-area--panning')) return true
    if (e?.button === 1) return true
    if (e?.buttons != null && (e.buttons & 4)) return true
    return false
  }

  function notifyLayoutPreview(overrides) {
    options.onLayoutPreview?.(overrides)
  }

  function isCustomLayoutBoxId(boxId) {
    if (isAuxBox(boxId)) return false
    const tableCols = options.tableColumns || []
    return !tableCols.includes(boxId)
  }

  function createBoxElement(boxId) {
    const layout = getLayoutForBox(boxId, pendingOverrides)
    if (!layoutHasBox(layout)) return null

    const box = document.createElement('div')
    box.className = 'layout-box'
    if (isAuxBox(boxId)) {
      box.classList.add('layout-template-bg-box')
      if (options.auxiliaryBox.className) box.classList.add(options.auxiliaryBox.className)
    } else if (isCustomLayoutBoxId(boxId)) {
      box.classList.add('layout-box--custom')
    }
    box.dataset.column = boxId
    const mapper = createStageMapper(svgEl, stage)
    if (mapper) applyBoxStyle(box, layout, mapper)

    const label = document.createElement('span')
    label.className = 'layout-box-label'
    if (isCustomLayoutBoxId(boxId)) label.classList.add('layout-box-label--custom')
    label.textContent = formatBoxLabel(boxId, pendingOverrides, options.auxiliaryBox)
    label.title = isAuxBox(boxId)
      ? 'SVG 底图区域'
      : (readOnly ? '只读查看' : '双击重命名编辑框')
    if (!isAuxBox(boxId)) wireBoxLabel(label, boxId)
    box.appendChild(label)

    if (options.sampleInputs && !isAuxBox(boxId)) {
      const sampleStrip = document.createElement('button')
      sampleStrip.type = 'button'
      sampleStrip.className = 'layout-box-sample'
      sampleStrip.title = '双击编辑示例内容'
      updateSampleStripText(sampleStrip, options.getSampleText?.(boxId) ?? '')
      for (const evt of ['mousedown', 'pointerdown', 'click']) {
        sampleStrip.addEventListener(evt, (e) => e.stopPropagation())
      }
      sampleStrip.addEventListener('dblclick', (e) => {
        e.preventDefault()
        e.stopPropagation()
        openSampleDialog(boxId, options.getSampleText?.(boxId) ?? '', sampleStrip, e)
      })
      box.appendChild(sampleStrip)
    } else if (canEditSampleOnBox()) {
      box.title = '双击编辑框编辑示例内容（标签上双击可重命名）'
      box.addEventListener('dblclick', (e) => {
        if (e.target.closest('.layout-box-label, .layout-handle, .layout-box-sample')) return
        e.preventDefault()
        e.stopPropagation()
        openSampleDialog(boxId, options.getSampleText?.(boxId) ?? '', null, e)
      })
    }

    appendBoxDashFrame(box)
    if (!readOnly) {
      appendBoxInteractionChrome(box)
      if (!isAuxBox(boxId) || !options.auxiliaryBox?.noDelete) {
        box.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          e.stopPropagation()
          setSelected([boxId], { syncTable: true })
          showBoxContextMenu(boxId, e.clientX, e.clientY)
        })
      }
    }

    overlay.insertBefore(box, groupBox)
    return box
  }

  let boxContextMenuEl = null

  function hideBoxContextMenu() {
    if (boxContextMenuEl) {
      boxContextMenuEl.remove()
      boxContextMenuEl = null
    }
  }

  function showBoxContextMenu(boxId, clientX, clientY) {
    if (readOnly) return
    if (isAuxBox(boxId) && options.auxiliaryBox?.noDelete && options.auxiliaryBox?.noCopy) return
    hideBoxContextMenu()

    const canCopy = typeof options.onCopyBox === 'function'
      && !(isAuxBox(boxId) && options.auxiliaryBox?.noCopy)
    const canPaste = typeof options.onPasteBox === 'function'
      && hasLayoutBoxClipboard()
    const canDelete = typeof options.onDeleteBoxes === 'function'
      && !(isAuxBox(boxId) && options.auxiliaryBox?.noDelete)

    if (!canCopy && !canPaste && !canDelete) return

    const buttons = []
    if (canCopy) {
      buttons.push('<button type="button" data-action="copy">复制编辑框</button>')
    }
    if (canPaste) {
      buttons.push('<button type="button" data-action="paste">粘贴编辑框</button>')
    }
    if (canDelete) {
      buttons.push('<button type="button" data-action="delete">删除编辑框</button>')
    }

    boxContextMenuEl = document.createElement('div')
    boxContextMenuEl.className = 'layout-box-context-menu'
    boxContextMenuEl.innerHTML = buttons.join('')
    boxContextMenuEl.style.left = `${clientX}px`
    boxContextMenuEl.style.top = `${clientY}px`
    document.body.appendChild(boxContextMenuEl)
    const rect = boxContextMenuEl.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      boxContextMenuEl.style.left = `${Math.max(8, clientX - rect.width)}px`
    }
    if (rect.bottom > window.innerHeight - 8) {
      boxContextMenuEl.style.top = `${Math.max(8, clientY - rect.height)}px`
    }
    boxContextMenuEl.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      hideBoxContextMenu()
      options.onCopyBox?.([boxId])
    })
    boxContextMenuEl.querySelector('[data-action="paste"]')?.addEventListener('click', () => {
      hideBoxContextMenu()
      options.onPasteBox?.()
    })
    boxContextMenuEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      hideBoxContextMenu()
      options.onDeleteBoxes?.([boxId])
    })
  }

  let canvasContextMenuEl = null

  function hideCanvasContextMenu() {
    if (canvasContextMenuEl) {
      canvasContextMenuEl.remove()
      canvasContextMenuEl = null
    }
  }

  function showCanvasContextMenu(clientX, clientY) {
    if (readOnly) return
    hideAllContextMenus()

    const canPaste = typeof options.onPasteBox === 'function' && hasLayoutBoxClipboard()
    const canSelectAll = boxes.size > 0

    if (!canPaste && !canSelectAll) return

    const buttons = []
    if (canPaste) {
      buttons.push('<button type="button" data-action="paste">粘贴编辑框</button>')
    }
    if (canSelectAll) {
      buttons.push('<button type="button" data-action="select-all">全选编辑框</button>')
    }

    canvasContextMenuEl = document.createElement('div')
    canvasContextMenuEl.className = 'layout-box-context-menu layout-canvas-context-menu'
    canvasContextMenuEl.innerHTML = buttons.join('')
    canvasContextMenuEl.style.left = `${clientX}px`
    canvasContextMenuEl.style.top = `${clientY}px`
    document.body.appendChild(canvasContextMenuEl)
    const rect = canvasContextMenuEl.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      canvasContextMenuEl.style.left = `${Math.max(8, clientX - rect.width)}px`
    }
    if (rect.bottom > window.innerHeight - 8) {
      canvasContextMenuEl.style.top = `${Math.max(8, clientY - rect.height)}px`
    }
    canvasContextMenuEl.querySelector('[data-action="paste"]')?.addEventListener('click', () => {
      hideCanvasContextMenu()
      options.onPasteBox?.()
    })
    canvasContextMenuEl.querySelector('[data-action="select-all"]')?.addEventListener('click', () => {
      hideCanvasContextMenu()
      const all = [...boxes.keys()]
      if (all.length) setSelected(all)
    })
  }

  function rebuildBoxes() {
    boxes.forEach((el) => el.remove())
    boxes.clear()
    for (const boxId of listLayoutBoxIds(pendingOverrides)) {
      const el = createBoxElement(boxId)
      if (el) boxes.set(boxId, el)
    }
    if (isAuxActive()) {
      const el = createBoxElement(options.auxiliaryBox.id)
      if (el) boxes.set(options.auxiliaryBox.id, el)
    }
    applyOverlayVisibility()
    updateGroupBox({ notify: false })
  }

  function refreshBoxLabels() {
    for (const [boxId, el] of boxes) {
      const label = el.querySelector('.layout-box-label')
      if (label) label.textContent = formatBoxLabel(boxId, pendingOverrides, options.auxiliaryBox)
    }
    refreshSampleInputs()
  }

  function refreshSampleInputs() {
    if (!options.sampleInputs) return
    for (const [boxId, el] of boxes) {
      const strip = el.querySelector('.layout-box-sample')
      if (strip && options.getSampleText) {
        updateSampleStripText(strip, options.getSampleText(boxId) ?? '')
      }
    }
  }

  const groupBox = document.createElement('div')
  groupBox.className = 'layout-group-box'
  groupBox.hidden = true
  const groupLabel = document.createElement('span')
  groupLabel.className = 'layout-group-box-label'
  groupLabel.textContent = '整体'
  groupBox.appendChild(groupLabel)
  appendBoxDashFrame(groupBox)
  if (!readOnly) {
    appendBoxInteractionChrome(groupBox)
  }
  overlay.appendChild(groupBox)

  function notifySelection() {
    if (!options.onSelectColumns) return
    clearTimeout(selectionNotifyTimer)
    const syncTable = pendingSelectionSyncTable
    selectionNotifyTimer = setTimeout(() => {
      selectionNotifyTimer = null
      options.onSelectColumns([...selectedColumns], { syncTable })
    }, 0)
  }

  function refreshOverlayGeometry() {
    const mapper = createStageMapper(svgEl, stage)
    if (!mapper) return
    refreshAllBoxes(boxes, pendingOverrides, mapper, getLayoutForBox)
    if (selectedColumns.size > 1) {
      const bounds = getSelectionUnionBounds([...selectedColumns], pendingOverrides, getLayoutBridge())
      applyGroupBoxStyle(groupBox, bounds, mapper)
    }
  }

  function resetAllBoxesToNormalUi() {
    groupBox.hidden = true
    marqueeRect.hidden = true
    overlay.classList.remove('layout-overlay--multi-select')
    for (const el of boxes.values()) {
      el.classList.remove('layout-box-selected', 'layout-box-in-multi', 'layout-box-anchor')
    }
    document.body.classList.remove(
      'layout-dragging',
      'layout-moving',
      'layout-resizing',
      'layout-marquee-active',
      'layout-drag-copy-active',
    )
  }

  function updateGroupBox({ notify = true } = {}) {
    const cols = [...selectedColumns]
    const isMulti = cols.length > 1
    const anchorCol = isMulti ? cols[cols.length - 1] : null
    groupBox.hidden = !isMulti
    overlay.classList.toggle('layout-overlay--multi-select', isMulti)

    const groupLabel = groupBox.querySelector('.layout-group-box-label')
    if (groupLabel) {
      groupLabel.textContent = findMatchingGroupLabel(pendingOverrides, cols) || '整体'
    }

    boxes.forEach((el, col) => {
      el.classList.remove('layout-box-selected', 'layout-box-in-multi', 'layout-box-anchor')
      if (selectedColumns.has(col)) {
        el.classList.add('layout-box-selected')
        if (isMulti) {
          if (col === anchorCol) el.classList.add('layout-box-anchor')
          else el.classList.add('layout-box-in-multi')
        }
      }
    })

    if (isMulti) {
      const mapper = createStageMapper(svgEl, stage)
      const bounds = getSelectionUnionBounds(cols, pendingOverrides, getLayoutBridge())
      if (mapper) applyGroupBoxStyle(groupBox, bounds, mapper)
    }
    if (notify) notifySelection()
  }

  function normalizeSelectionInput(columns, { expandGroups = true } = {}) {
    const list = (Array.isArray(columns) ? columns : [columns]).filter((c) => boxes.has(c))
    if (!expandGroups || list.length === 0) return list
    const expanded = expandBoxSelection(pendingOverrides, list)
    return expanded.filter((c) => boxes.has(c))
  }

  function setSelected(columns, { append = false, toggle = false, syncTable = true, expandGroups = true } = {}) {
    const list = normalizeSelectionInput(columns, { expandGroups: expandGroups && !toggle })
    if (!append && !toggle) {
      selectedColumns = new Set(list)
    } else if (toggle) {
      const next = append ? new Set(selectedColumns) : new Set()
      const raw = Array.isArray(columns) ? columns : [columns]
      for (const c of raw) {
        if (!boxes.has(c)) continue
        const members = expandGroups ? expandBoxSelection(pendingOverrides, [c]) : [c]
        const allIn = members.every((m) => next.has(m))
        for (const m of members) {
          if (!boxes.has(m)) continue
          if (allIn) next.delete(m)
          else next.add(m)
        }
      }
      selectedColumns = next
    } else {
      const next = new Set(selectedColumns)
      for (const c of list) {
        if (boxes.has(c)) next.add(c)
      }
      selectedColumns = next
    }
    pendingSelectionSyncTable = syncTable
    updateGroupBox()
    // 选择编辑框时将焦点从表格等"外来区域"移出，确保后续复制/粘贴快捷键不被 isForeignShortcutTarget 拦截
    if (selectedColumns.size > 0 && document.activeElement?.closest?.('#table-wrap, #tbl-tpl-table-wrap, .table-templates-panel')) {
      document.activeElement.blur()
    }
  }

  function clearSelection({ syncTable = true, notify = true } = {}) {
    selectedColumns = new Set()
    pendingSelectionSyncTable = syncTable
    resetAllBoxesToNormalUi()
    if (notify) {
      updateGroupBox({ notify: true })
    } else {
      clearTimeout(selectionNotifyTimer)
      selectionNotifyTimer = null
    }
  }

  function clearVisualState() {
    clearSelection({ notify: false })
  }

  function clientDeltaToSvgDelta(clientX, clientY, startClientX, startClientY) {
    const cur = clientToStageLocal(clientX, clientY)
    const start = clientToStageLocal(startClientX, startClientY)
    return stageDeltaToSvg(svgEl, stage, cur.x - start.x, cur.y - start.y)
  }

  /** Ctrl 拖拽时按位移较大的轴锁定水平或垂直 */
  function applyCtrlAxisMoveConstraint(dragState, dx, dy, ctrlKey) {
    if (!ctrlKey) {
      dragState.constrainAxis = null
      return { dx, dy }
    }
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)
    if (!dragState.constrainAxis && (adx > 0.5 || ady > 0.5)) {
      dragState.constrainAxis = adx >= ady ? 'x' : 'y'
    }
    if (dragState.constrainAxis === 'x') return { dx, dy: 0 }
    if (dragState.constrainAxis === 'y') return { dx: 0, dy }
    return { dx, dy }
  }

  function getDragMoveDelta(e, state) {
    const delta = clientDeltaToSvgDelta(e.clientX, e.clientY, state.startX, state.startY)
    if (!delta) return { dx: 0, dy: 0 }
    return applyCtrlAxisMoveConstraint(state, delta.dx, delta.dy, e.ctrlKey || e.metaKey)
  }

  function clearCopyDragGhosts(columns) {
    copyGhostLayer.innerHTML = ''
    if (dragState?.ghostEls) dragState.ghostEls.clear()
    const cols = columns || dragState?.columns || []
    for (const col of cols) {
      boxes.get(col)?.classList.remove('layout-box--drag-copy-source')
    }
  }

  function hideDragCopyCursor() {
    dragCopyCursor.hidden = true
    document.body.classList.remove('layout-drag-copy-active')
  }

  function updateDragCopyCursor(e) {
    if (!dragState?.copyMode) {
      hideDragCopyCursor()
      return
    }
    dragCopyCursor.hidden = false
    document.body.classList.add('layout-drag-copy-active')
    dragCopyCursor.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 8}px)`
  }

  function teardownDragCopyListeners() {
    document.removeEventListener('contextmenu', onDragCopyBlockMenu, true)
    document.removeEventListener('pointerdown', onDragCopyTogglePointer, true)
  }

  function setupDragCopyListeners() {
    document.addEventListener('contextmenu', onDragCopyBlockMenu, true)
    document.addEventListener('pointerdown', onDragCopyTogglePointer, true)
  }

  function onDragCopyBlockMenu(e) {
    if (!dragState || dragState.mode !== 'move' || readOnly) return
    e.preventDefault()
    e.stopPropagation()
  }

  function onDragCopyTogglePointer(e) {
    if (!dragState || dragState.mode !== 'move' || readOnly || e.button !== 2) return
    e.preventDefault()
    e.stopPropagation()
    toggleDragCopyMode(e)
  }

  function toggleDragCopyMode(e) {
    if (!dragState || dragState.mode !== 'move') return
    dragState.copyMode = !dragState.copyMode
    if (!dragState.copyMode) {
      clearCopyDragGhosts()
      hideDragCopyCursor()
    } else {
      if (!dragState.ghostEls) dragState.ghostEls = new Map()
      updateDragCopyCursor(e)
    }
    previewDrag(e)
  }

  function overridesWithColumnsAtSnapshot(overrides, columns, startLayouts) {
    let next = { ...overrides }
    for (const col of columns) {
      const s = startLayouts[col]
      if (!s) continue
      next = applyBoundsForBox(next, col, s)
    }
    return next
  }

  function refreshCopyDragGhosts(columns, movedOverrides, mapper) {
    if (!dragState.ghostEls) dragState.ghostEls = new Map()
    for (const col of columns) {
      let ghost = dragState.ghostEls.get(col)
      if (!ghost) {
        ghost = document.createElement('div')
        ghost.className = 'layout-box layout-box-copy-ghost'
        if (isCustomLayoutBoxId(col)) ghost.classList.add('layout-box--custom')
        copyGhostLayer.appendChild(ghost)
        dragState.ghostEls.set(col, ghost)
      }
      applyBoxStyle(ghost, getLayoutForBox(col, movedOverrides), mapper)
    }
    for (const [col, ghost] of dragState.ghostEls) {
      if (!columns.includes(col)) {
        ghost.remove()
        dragState.ghostEls.delete(col)
      }
    }
  }

  function clearDragCopyUi(columns) {
    clearCopyDragGhosts(columns)
    hideDragCopyCursor()
    teardownDragCopyListeners()
  }

  function beginGroupDrag(e, mode, edge = null) {
    const columns = [...selectedColumns]
    const bridge = getLayoutBridge()
    if (mode === 'group-resize') {
      pendingOverrides = ensureSelectionMinBoxSizes(pendingOverrides, columns, bridge)
      refreshOverlayGeometry()
      updateGroupBox({ notify: false })
    }
    const startLayouts = snapshotLayouts(columns, pendingOverrides, getLayoutForBox)
    const startGroup = getSelectionUnionBounds(columns, pendingOverrides, bridge)

    dragState = {
      mode,
      edge,
      columns,
      startX: e.clientX,
      startY: e.clientY,
      startLayouts,
      startGroup,
      constrainAxis: null,
      copyMode: false,
      ghostEls: null,
    }
    document.body.classList.add('layout-dragging')
    if (mode === 'move') {
      document.body.classList.add('layout-moving')
      setupDragCopyListeners()
    }
    if (mode === 'group-resize') document.body.classList.add('layout-resizing')
  }

  function armBoxMoveFromPointerDown(e, captureEl) {
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const onMove = (ev) => {
      if (dragging) {
        previewDrag(ev)
        return
      }
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < MARQUEE_THRESHOLD_PX) return
      dragging = true
      captureEl.setPointerCapture(ev.pointerId)
      beginGroupDrag(e, 'move')
    }

    const onUp = (ev) => {
      captureEl.removeEventListener('pointermove', onMove)
      captureEl.removeEventListener('pointerup', onUp)
      captureEl.removeEventListener('pointercancel', onUp)
      try {
        captureEl.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }
      if (dragging) endDrag(ev)
    }

    captureEl.addEventListener('pointermove', onMove)
    captureEl.addEventListener('pointerup', onUp)
    captureEl.addEventListener('pointercancel', onUp)
  }

  function beginSingleResize(e, column, edge) {
    const startLayouts = snapshotLayouts([column], pendingOverrides, getLayoutForBox)
    dragState = {
      mode: 'single-resize',
      edge,
      columns: [column],
      column,
      startX: e.clientX,
      startY: e.clientY,
      startLayouts,
      startLayout: startLayouts[column],
    }
    document.body.classList.add('layout-dragging')
    document.body.classList.add('layout-resizing')
  }

  function clientToMarqueeLocal(clientX, clientY) {
    const r = marqueeRoot.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  function clientToStageLocal(clientX, clientY) {
    const r = stage.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  function isMarqueeBackgroundTarget(target) {
    if (!target || !marqueeRoot.contains(/** @type {Node} */ (target))) return false
    if (target.closest(
      '.layout-box, .layout-handle, .layout-move-edge, .layout-box-label,'
      + ' .layout-box-sample, .layout-group-box, .layout-group-box-label',
    )) return false
    if (target.closest('input, textarea, button, select, dialog, a')) return false
    return true
  }

  function startMarquee(e) {
    const rootPt = clientToMarqueeLocal(e.clientX, e.clientY)
    const stagePt = clientToStageLocal(e.clientX, e.clientY)
    dragState = {
      mode: 'marquee',
      startX: e.clientX,
      startY: e.clientY,
      originRootX: rootPt.x,
      originRootY: rootPt.y,
      originStageX: stagePt.x,
      originStageY: stagePt.y,
      append: e.shiftKey,
    }
    marqueeRect.hidden = false
    marqueeRect.style.left = `${rootPt.x}px`
    marqueeRect.style.top = `${rootPt.y}px`
    marqueeRect.style.width = '0'
    marqueeRect.style.height = '0'
    document.body.classList.add('layout-dragging')
    document.body.classList.add('layout-marquee-active')
  }

  onMarqueeRootPointerDown = (e) => {
    if (readOnly || e.button !== 0 || isPreviewPanMode(e)) return
    if (!isMarqueeBackgroundTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    try {
      marqueeRoot.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    startMarquee(e)
  }
  marqueeRoot.addEventListener('pointerdown', onMarqueeRootPointerDown, { capture: true })

  function cancelPropertyPick() {
    propertyPickState = null
    overlay.classList.remove('layout-overlay--property-pick')
    stage.classList.remove('layout-property-pick-mode')
  }

  function startPropertyPick(onPick) {
    if (readOnly || typeof onPick !== 'function') return
    propertyPickState = { onPick }
    overlay.classList.add('layout-overlay--property-pick')
    stage.classList.add('layout-property-pick-mode')
  }

  groupBox.addEventListener('pointerdown', (e) => {
    if (readOnly || e.button !== 0 || selectedColumns.size < 2 || isPreviewPanMode(e)) return
    const handle = e.target.closest('.layout-handle')
    if (handle) {
      const edge = findResizeEdgeFromHandle(handle)
      if (!edge) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      beginGroupDrag(e, 'group-resize', edge)
      return
    }
    const dragSurface = e.target.closest('.layout-group-box-label, .layout-move-edge')
    if (!dragSurface) return
    e.preventDefault()
    e.stopPropagation()
    dragSurface.setPointerCapture(e.pointerId)
    beginGroupDrag(e, 'move')
  })

  overlay.addEventListener('pointerdown', (e) => {
    if (isPreviewPanMode(e)) return
    if (e.button !== 0) return

    if (readOnly) {
      const boxEl = e.target.closest('.layout-box, .layout-box-label')
      if (!boxEl) return
      const box = boxEl.closest('.layout-box') || boxEl
      const col = box?.dataset?.column
      if (!col) return
      setSelected([col], { syncTable: true })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (propertyPickState && e.button === 0) {
      const pickBox = e.target.closest('.layout-box')
      if (pickBox?.dataset.column) {
        e.preventDefault()
        e.stopPropagation()
        const sourceId = pickBox.dataset.column
        const cb = propertyPickState.onPick
        cancelPropertyPick()
        cb(sourceId)
      }
      return
    }

    const groupHandle = e.target.closest('.layout-group-box .layout-handle')
    if (groupHandle) return

    const boxBody = e.target.closest('.layout-box')
    if (
      boxBody
      && e.button === 0
      && !e.target.closest('.layout-handle, .layout-box-label, .layout-move-edge, .layout-box-sample')
    ) {
      const col = boxBody.dataset.column
      if (e.shiftKey) {
        setSelected([col], { append: true, toggle: true, syncTable: false })
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!selectedColumns.has(col)) {
        setSelected([col], { syncTable: true })
      }
      e.preventDefault()
      e.stopPropagation()
      armBoxMoveFromPointerDown(e, boxBody)
      return
    }

    const handle = e.target.closest('.layout-box .layout-handle')
    if (handle) {
      const box = handle.closest('.layout-box')
      if (!box) return
      const edge = findResizeEdgeFromHandle(handle)
      if (!edge) return
      if (selectedColumns.size > 1) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      beginSingleResize(e, box.dataset.column, edge)
      return
    }

    const dragSurface = e.target.closest('.layout-box-label, .layout-move-edge')
    if (!dragSurface) return

    const box = dragSurface.closest('.layout-box')
    if (!box) return

    const col = box.dataset.column
    if (e.shiftKey) {
      setSelected([col], { append: true, toggle: true, syncTable: false })
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (!selectedColumns.has(col)) {
      setSelected([col], { syncTable: true })
    }

    e.preventDefault()
    e.stopPropagation()
    box.setPointerCapture(e.pointerId)

    if (selectedColumns.size > 1) {
      beginGroupDrag(e, 'move')
    } else {
      beginGroupDrag(e, 'move')
    }
  })

  function finishMarquee(e) {
    const stagePt = clientToStageLocal(e.clientX, e.clientY)
    const x1 = dragState.originStageX
    const y1 = dragState.originStageY
    const x2 = stagePt.x
    const y2 = stagePt.y

    marqueeRect.hidden = true

    if (Math.abs(x2 - x1) >= MARQUEE_THRESHOLD_PX || Math.abs(y2 - y1) >= MARQUEE_THRESHOLD_PX) {
      const p1 = stagePxToSvg(svgEl, stage, x1, y1)
      const p2 = stagePxToSvg(svgEl, stage, x2, y2)
      const hit = []
      for (const col of boxes.keys()) {
        const layout = getLayoutForBox(col, pendingOverrides)
        if (boxesIntersectSvgRect(layout, p1.x, p1.y, p2.x, p2.y)) {
          hit.push(col)
        }
      }
      if (hit.length > 0) {
        const expanded = expandBoxSelection(pendingOverrides, hit).filter((c) => boxes.has(c))
        setSelected(expanded, { append: dragState.append, syncTable: false })
      } else if (!dragState.append) {
        clearSelection({ syncTable: true })
      }
    } else if (!dragState.append) {
      clearSelection({ syncTable: true })
    }
  }

  function previewDrag(e) {
    if (!dragState) return

    if (dragState.mode === 'marquee') {
      const rootPt = clientToMarqueeLocal(e.clientX, e.clientY)
      const x1 = dragState.originRootX
      const y1 = dragState.originRootY
      const x2 = rootPt.x
      const y2 = rootPt.y
      marqueeRect.style.left = `${Math.min(x1, x2)}px`
      marqueeRect.style.top = `${Math.min(y1, y2)}px`
      marqueeRect.style.width = `${Math.abs(x2 - x1)}px`
      marqueeRect.style.height = `${Math.abs(y2 - y1)}px`
      return
    }

    const delta = clientDeltaToSvgDelta(e.clientX, e.clientY, dragState.startX, dragState.startY)
    if (!delta) return
    let dx = delta.dx
    let dy = delta.dy

    if (dragState.mode === 'move') {
      ;({ dx, dy } = applyCtrlAxisMoveConstraint(
        dragState,
        dx,
        dy,
        e.ctrlKey || e.metaKey,
      ))
      const mapper = createStageMapper(svgEl, stage)
      const bridge = getLayoutBridge()
      if (dragState.copyMode) {
        updateDragCopyCursor(e)
        const originalDisplay = overridesWithColumnsAtSnapshot(
          pendingOverrides,
          dragState.columns,
          dragState.startLayouts,
        )
        const moved = moveBoxesFromSnapshot(
          pendingOverrides,
          dragState.columns,
          dragState.startLayouts,
          dx,
          dy,
          bridge,
        )
        dragState.previewOverrides = null
        dragState.copyDelta = { dx, dy }
        if (mapper) {
          for (const col of dragState.columns) {
            boxes.get(col)?.classList.add('layout-box--drag-copy-source')
          }
          refreshBoxes(boxes, dragState.columns, originalDisplay, mapper, getLayoutForBox)
          refreshCopyDragGhosts(dragState.columns, moved, mapper)
          if (dragState.columns.length > 1) {
            applyGroupBoxStyle(
              groupBox,
              getSelectionUnionBounds(dragState.columns, originalDisplay, bridge),
              mapper,
            )
          }
        }
        return
      }

      clearCopyDragGhosts()
      hideDragCopyCursor()
      const next = moveBoxesFromSnapshot(
        pendingOverrides,
        dragState.columns,
        dragState.startLayouts,
        dx,
        dy,
        bridge,
      )
      dragState.previewOverrides = next
      dragState.copyDelta = null
      notifyLayoutPreview(next)
      if (mapper) {
        refreshBoxes(boxes, dragState.columns, next, mapper, getLayoutForBox)
        if (dragState.columns.length > 1) {
          applyGroupBoxStyle(groupBox, getSelectionUnionBounds(dragState.columns, next, bridge), mapper)
        }
      }
      return
    }

    if (dragState.mode === 'group-resize') {
      const resizeOpts = { fromCenter: !!e.shiftKey }
      const bridge = getLayoutBridge()
      const newGroup = computeResizedGroupBounds(
        dragState.startGroup,
        dragState.edge,
        dx,
        dy,
        resizeOpts,
      )
      const next = resizeBoxesInGroup(
        pendingOverrides,
        dragState.columns,
        dragState.startGroup,
        newGroup,
        dragState.startLayouts,
        bridge,
      )
      dragState.previewOverrides = next
      notifyLayoutPreview(next)
      const mapper = createStageMapper(svgEl, stage)
      if (mapper) {
        refreshBoxes(boxes, dragState.columns, next, mapper, getLayoutForBox)
        applyGroupBoxStyle(groupBox, newGroup, mapper)
      }
      return
    }

    if (dragState.mode === 'single-resize') {
      const { edge, column, startLayout } = dragState
      const fromCenter = !!e.shiftKey
      const bounds = computeResizedGroupBounds(
        {
          left: startLayout.boxLeft,
          right: startLayout.boxRight,
          top: startLayout.boxTop,
          bottom: startLayout.boxBottom,
        },
        edge,
        dx,
        dy,
        { fromCenter },
      )
      const next = applyBoundsForBox(pendingOverrides, column, {
        boxLeft: bounds.left,
        boxRight: bounds.right,
        boxTop: bounds.top,
        boxBottom: bounds.bottom,
      }, fromCenter ? undefined : edge)
      dragState.previewOverrides = next
      notifyLayoutPreview(next)
      const el = boxes.get(column)
      const mapper = createStageMapper(svgEl, stage)
      if (el && mapper) {
        applyBoxStyle(el, getLayoutForBox(column, next), mapper)
      }
    }
  }

  function commitReasonForDragMode(state) {
    if (state.mode === 'move' && state.copyMode) return '拖拽复制编辑框'
    if (state.mode === 'move') return '拖放移动编辑框'
    if (state.mode === 'group-resize') return '多选整体缩放编辑框'
    if (state.mode === 'single-resize') return '拖放缩放编辑框'
    return '编辑框'
  }

  function endDrag(e) {
    if (!dragState) return

    if (dragState.mode === 'marquee') {
      finishMarquee(e)
      dragState = null
      document.body.classList.remove('layout-dragging', 'layout-marquee-active')
      e?.stopPropagation?.()
      return
    }

    const finished = dragState
    const wasCopyMode = finished.mode === 'move' && finished.copyMode

    if (wasCopyMode && !readOnly) {
      const { dx, dy } = finished.copyDelta ?? getDragMoveDelta(e, finished)
      const copyColumns = finished.columns.filter((c) => !isNonEditableAux(c) || !options.auxiliaryBox?.noDuplicate)
      const result = copyColumns.length
        ? duplicateLayoutBoxesAtOffset(
          pendingOverrides,
          copyColumns,
          dx,
          dy,
          {
            tableColumns: options.tableColumns || [],
            reservedIds: options.getReservedBoxIds?.() || [],
          },
        )
        : null
      if (result) {
        pendingOverrides = result.overrides
        options.onDragDuplicate?.(result.idMap)
        rebuildBoxes()
        setSelected(result.newBoxIds, { syncTable: false })
        options.onCommit({ ...pendingOverrides }, commitReasonForDragMode(finished))
      }
    } else if (finished.previewOverrides && !readOnly) {
      pendingOverrides = finished.previewOverrides
      options.onCommit({ ...pendingOverrides }, commitReasonForDragMode(finished))
    } else if (wasCopyMode) {
      refreshOverlayGeometry()
    }

    clearDragCopyUi(finished.columns)

    dragState = null
    updateGroupBox()
    document.body.classList.remove('layout-dragging', 'layout-moving', 'layout-resizing')
  }

  overlay.addEventListener('pointermove', previewDrag)
  marqueeRoot.addEventListener('pointermove', previewDrag)
  groupBox.addEventListener('pointermove', previewDrag)
  overlay.addEventListener('pointerup', endDrag)
  overlay.addEventListener('pointercancel', endDrag)
  marqueeRoot.addEventListener('pointerup', endDrag)
  marqueeRoot.addEventListener('pointercancel', endDrag)
  groupBox.addEventListener('pointerup', endDrag)
  groupBox.addEventListener('pointercancel', endDrag)

  // 画板（空白区）右键菜单：粘贴、全选
  // 注意：overlay 本身 pointer-events:none，右键空白区会穿透到 stage
  const onCanvasContextMenu = (e) => {
    if (readOnly) return
    if (e.target.closest('.layout-box, .layout-group-box')) return
    e.preventDefault()
    e.stopPropagation()
    showCanvasContextMenu(e.clientX, e.clientY)
  }
  stage.addEventListener('contextmenu', onCanvasContextMenu)
  marqueeRoot !== stage && marqueeRoot.addEventListener('contextmenu', onCanvasContextMenu)
  groupBox.addEventListener('contextmenu', (e) => {
    // 多选框的右键也走画板菜单（无独立操作）
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    showCanvasContextMenu(e.clientX, e.clientY)
  })

  wireBoxLabel = (label, boxId) => {
    if (readOnly) return

    label.addEventListener('dblclick', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!options.onRenameBox) return
      const currentId = label.closest('.layout-box')?.dataset.column || boxId
      const next = window.prompt('编辑框名称', currentId)
      if (next == null) return
      const trimmed = String(next).trim()
      if (!trimmed || trimmed === currentId) return
      options.onRenameBox(currentId, trimmed)
    })

    label.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isPreviewPanMode(e)) return

      if (propertyPickState) {
        e.preventDefault()
        e.stopPropagation()
        const box = label.closest('.layout-box')
        const sourceId = box?.dataset.column
        if (sourceId) {
          const cb = propertyPickState.onPick
          cancelPropertyPick()
          cb(sourceId)
        }
        return
      }

      // 阻止 overlay 在 pointerdown 上 preventDefault，否则浏览器不会触发 dblclick
      e.stopPropagation()

      const box = label.closest('.layout-box')
      if (!box) return
      const col = box.dataset.column || boxId

      if (e.shiftKey) {
        setSelected([col], { append: true, toggle: true, syncTable: false })
        return
      }
      if (!selectedColumns.has(col)) {
        setSelected([col], { syncTable: true })
      }

      const startX = e.clientX
      const startY = e.clientY
      let dragging = false

      const onMove = (ev) => {
        if (dragging) {
          previewDrag(ev)
          return
        }
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < MARQUEE_THRESHOLD_PX) return
        dragging = true
        label.setPointerCapture(ev.pointerId)
        beginGroupDrag(e, 'move')
      }

      const onUp = (ev) => {
        label.removeEventListener('pointermove', onMove)
        label.removeEventListener('pointerup', onUp)
        label.removeEventListener('pointercancel', onUp)
        try {
          label.releasePointerCapture(ev.pointerId)
        } catch {
          // ignore
        }
        if (dragging) endDrag(ev)
      }

      label.addEventListener('pointermove', onMove)
      label.addEventListener('pointerup', onUp)
      label.addEventListener('pointercancel', onUp)
    })
  }

  rebuildBoxes()

  function nudgeSelected(dx, dy) {
    if (readOnly || selectedColumns.size === 0) return false
    const columns = [...selectedColumns]
    const bridge = getLayoutBridge()
    const startLayouts = snapshotLayouts(columns, pendingOverrides, getLayoutForBox)
    const next = moveBoxesFromSnapshot(pendingOverrides, columns, startLayouts, dx, dy, bridge)
    pendingOverrides = next
    notifyLayoutPreview(next)
    refreshOverlayGeometry()
    updateGroupBox({ notify: false })
    options.onCommit({ ...pendingOverrides }, '方向键微调编辑框')
    return true
  }

  let pendingNudgeCount = 0
  let nudgeCommitTimer = null

  /** 仅提交到主流程（重绘 SVG、历史、保存），编辑框已在按键时实时移动 */
  function commitPendingKeyboardNudge() {
    nudgeCommitTimer = null
    if (pendingNudgeCount === 0) return
    const count = pendingNudgeCount
    pendingNudgeCount = 0
    const reason = count > 1
      ? `方向键微调编辑框（合并 ${count} 次）`
      : '方向键微调编辑框'
    options.onCommit({ ...pendingOverrides }, reason)
  }

  function cancelPendingKeyboardNudge() {
    clearTimeout(nudgeCommitTimer)
    nudgeCommitTimer = null
    pendingNudgeCount = 0
  }

  function applyKeyboardNudgeVisual(dx, dy) {
    if (selectedColumns.size === 0) return false
    const columns = [...selectedColumns]
    const bridge = getLayoutBridge()
    const startLayouts = snapshotLayouts(columns, pendingOverrides, getLayoutForBox)
    const next = moveBoxesFromSnapshot(pendingOverrides, columns, startLayouts, dx, dy, bridge)
    pendingOverrides = next
    notifyLayoutPreview(next)
    refreshOverlayGeometry()
    updateGroupBox({ notify: false })
    return true
  }

  function queueKeyboardNudge(dx, dy) {
    if (!applyKeyboardNudgeVisual(dx, dy)) return false
    pendingNudgeCount += 1
    clearTimeout(nudgeCommitTimer)
    nudgeCommitTimer = setTimeout(commitPendingKeyboardNudge, KEY_NUDGE_DEBOUNCE_MS)
    return true
  }

  function editorShortcutActive() {
    return stage.isConnected && stage.getClientRects().length > 0
  }

  function isShortcutScopeActive() {
    if (typeof options.isShortcutScopeActive === 'function') {
      return !!options.isShortcutScopeActive()
    }
    return editorShortcutActive()
  }

  function isForeignShortcutTarget(e) {
    const target = e.target
    const active = document.activeElement
    if (target?.closest?.('#table-wrap, #tbl-tpl-table-wrap, .table-templates-panel')) return true
    if (active?.closest?.('#table-wrap, #tbl-tpl-table-wrap, .table-templates-panel')) return true
    if (window.__CAT_SPREADSHEET__?.hasActiveSelection?.()) return true
    return false
  }

  function isTextInputShortcutTarget(target) {
    const el = target?.closest?.('input, textarea, select, [contenteditable="true"]')
    if (!el) return false
    if (el.matches('[contenteditable="true"], textarea, select')) return true
    if (el.tagName === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase()
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(type)
    }
    return false
  }

  function onKeyDown(e) {
    if (readOnly) return
    if (document.querySelector('.spreadsheet-cell.is-editing')) return
    if (isTextInputShortcutTarget(e.target)) return
    if (isForeignShortcutTarget(e)) return
    if (!isShortcutScopeActive()) return

    const key = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    const isUndo = mod && key === 'z' && !e.shiftKey
    const isRedo = mod && key === 'z' && e.shiftKey

    if (isUndo || isRedo) {
      if (!editorShortcutActive()) return
      commitPendingKeyboardNudge()
      e.preventDefault()
      e.stopPropagation()
      if (isUndo) options.onUndo?.()
      else options.onRedo?.()
      return
    }

    if (mod && key === 'c') {
      if (!editorShortcutActive()) return
      if (propertyPickState) return
      const baseCols = typeof options.getSelectedBoxIdsForCopy === 'function'
        ? (options.getSelectedBoxIdsForCopy() || [])
        : [...selectedColumns]
      const copyCols = baseCols.filter((c) => !(isAuxBox(c) && options.auxiliaryBox?.noCopy))
      if (copyCols.length === 0) return
      commitPendingKeyboardNudge()
      if (typeof options.onCopyBox !== 'function') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      options.onCopyBox(copyCols)
      return
    }
    if (mod && key === 'v') {
      if (!editorShortcutActive()) return
      if (propertyPickState) return
      commitPendingKeyboardNudge()
      if (typeof options.onPasteBox !== 'function') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      options.onPasteBox()
      return
    }
    if (mod && key === 'a') {
      if (!editorShortcutActive()) return
      if (propertyPickState) return
      commitPendingKeyboardNudge()
      e.preventDefault()
      e.stopPropagation()
      const all = [...boxes.keys()]
      if (all.length) setSelected(all)
      else clearSelection()
      return
    }

    if (selectedColumns.size === 0) return

    const step = e.shiftKey ? KEY_NUDGE_STEP_SHIFT : KEY_NUDGE_STEP
    let dx = 0
    let dy = 0
    if (e.key === 'Delete' || e.key === 'Backspace') {
      commitPendingKeyboardNudge()
      e.preventDefault()
      const deleteCols = [...selectedColumns].filter((c) => !(isAuxBox(c) && options.auxiliaryBox?.noDelete))
      if (typeof options.onDeleteBoxes === 'function' && deleteCols.length > 0) {
        options.onDeleteBoxes(deleteCols)
      }
      return
    }

    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    else return

    e.preventDefault()
    queueKeyboardNudge(dx, dy)
  }

  function onDocumentKeydown(e) {
    if (e.key === 'Escape') {
      hideAllContextMenus()
      if (propertyPickState) cancelPropertyPick()
    }
  }

  function hideAllContextMenus() {
    hideBoxContextMenu()
    hideCanvasContextMenu()
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', hideAllContextMenus)
  document.addEventListener('keydown', onDocumentKeydown)

  let repositionRaf = 0
  const reposition = () => {
    if (repositionRaf) return
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = 0
      refreshOverlayGeometry()
      updateGroupBox({ notify: false })
    })
  }
  const resizeObserver = new ResizeObserver(reposition)
  resizeObserver.observe(svgEl)
  resizeObserver.observe(stage)

  return {
    destroy() {
      commitPendingKeyboardNudge()
      hideAllContextMenus()
      clearTimeout(selectionNotifyTimer)
      if (repositionRaf) cancelAnimationFrame(repositionRaf)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('click', hideAllContextMenus)
      document.removeEventListener('keydown', onDocumentKeydown)
      resizeObserver.disconnect()
      teardownDragCopyListeners()
      if (onMarqueeRootPointerDown) {
        marqueeRoot.removeEventListener('pointerdown', onMarqueeRootPointerDown, { capture: true })
      }
      marqueeRect.remove()
      overlay.remove()
      sampleDialog?.remove()
      sampleDialog = null
      sampleDialogPrefixList = null
      sampleDialogCoreText = null
      sampleDialogSuffixList = null
      sampleDialogTitle = null
      sampleDialogBoxId = null
      sampleDialogStrip = null
      document.body.classList.remove('layout-dragging', 'layout-moving', 'layout-resizing', 'layout-marquee-active', 'layout-drag-copy-active')
      dragCopyCursor.remove()
    },
    selectColumn(column) {
      if (column) setSelected([column])
      else clearSelection()
    },
    selectColumns(columns) {
      if (columns?.length) setSelected(columns)
      else clearSelection({ notify: false })
    },
    selectAllBoxes() {
      const all = [...boxes.keys()]
      if (all.length) setSelected(all)
      else clearSelection()
    },
    clearVisualState,
    getSelectedColumn() {
      return [...selectedColumns][0] ?? null
    },
    getSelectedColumns() {
      return [...selectedColumns]
    },
    nudge(dx, dy) {
      return nudgeSelected(dx, dy)
    },
    setOverrides(overrides) {
      cancelPendingKeyboardNudge()
      pendingOverrides = { ...overrides }
      rebuildBoxes()
      refreshBoxLabels()
      refreshOverlayGeometry()
      updateGroupBox({ notify: false })
    },
    /** 仅同步 overrides 与 overlay 位置（不重建 DOM，供轻量预览刷新） */
    syncOverrides(overrides) {
      cancelPendingKeyboardNudge()
      const curIds = [...boxes.keys()].sort().join('\0')
      const curSig = layoutOverridesOverlaySignature(pendingOverrides)
      pendingOverrides = { ...overrides }
      const nextIds = listOverlayBoxIds(pendingOverrides).sort().join('\0')
      const nextSig = layoutOverridesOverlaySignature(pendingOverrides)
      if (nextIds !== curIds || nextSig !== curSig) {
        rebuildBoxes()
      } else {
        applyOverlayVisibility()
        refreshBoxLabels()
        refreshOverlayGeometry()
      }
      updateGroupBox({ notify: false })
    },
    setVisible(visible) {
      overlayVisible = !!visible
      applyOverlayVisibility()
    },
    setOverlayVisual({ showBorder, showHandles } = {}) {
      if (showBorder != null) overlayShowBorder = !!showBorder
      if (showHandles != null) overlayShowHandles = !!showHandles
      applyOverlayVisualClasses()
    },
    refreshSampleInputs,
    startPropertyPick,
    cancelPropertyPick,
    cancelPendingKeyboardNudge,
    flushPendingState() {
      commitPendingKeyboardNudge()
    },
    getPendingOverrides() {
      return { ...pendingOverrides }
    },
    isEditorShortcutActive: editorShortcutActive,
    isPropertyPickActive() {
      return !!propertyPickState
    },
    repositionOverlay() {
      reposition()
    },
  }
}
