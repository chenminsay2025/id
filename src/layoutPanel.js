import { resolveBoxId, patchLayoutBox, getPrimaryColumnForBox } from './layoutBinding.js'
import {
  TEXT_FIT_MODES,
  TEXT_FIT_MODE_LABELS,
  getColumnLayout,
  getGroupIdForColumn,
  applyAlignToWrapGroup,
  applyHorizontalToWrapGroup,
  applyColumnBoxBounds,
  clampLayoutBoxBounds,
  layoutHasBox,
  getDefaultFontSizeForColumn,
  getDefaultLineHeightForColumn,
  getDefaultLetterSpacingForColumn,
  getDefaultTextScaleXPercentForColumn,
  getContentAlignH,
  getContentAlignV,
  TEXT_SCALE_X_PERCENT_MIN,
  TEXT_SCALE_X_PERCENT_MAX,
  PEDIGREE_WRAP_GROUPS,
  readColumnTextFillFromSvg,
  readColumnTextStrokeFromSvg,
} from './svgEngine.js'
import {
  alignLayoutBoxes,
  alignLayoutBoxesToArtboard,
  distributeLayoutBoxes,
} from './layoutBoxOps.js'
import {
  createLayoutGroup,
  ungroupBoxes,
  selectionHasGroupedBoxes,
  findMatchingGroupLabel,
} from './layoutGroups.js'
import {
  svgUserUnitsToMm,
  mmToSvgUserUnits,
  formatMmBoundInput,
} from './layoutUnits.js'
import { openColorPicker, swatchBackground, parseColor, formatColor } from './colorPicker.js'
import {
  toolbarBtnHtml,
  toolbarSep,
  mountToolbarToggleGroup,
  mountBoxOpButtons,
  ALIGN_H_ICON,
  ALIGN_V_ICON,
  TEXT_FIT_ICON,
  TEXT_ALIGN_H_TOOLTIPS,
  TEXT_ALIGN_V_TOOLTIPS,
} from './toolbarUi.js'
import { collapsiblePanelHtml, mountCollapsiblePanels, mountCollapsiblePanelReorder, mountCollapsiblePanelResize } from './collapsiblePanel.js'

/**
 * @param {HTMLElement} root
 * @param {{ layoutOverrides: object, idPrefix?: string, overlayShowBorder?: boolean, overlayShowHandles?: boolean, showFileButtons?: boolean, showOverlayVisual?: boolean, hideHistoryToolbar?: boolean, hideSelectionToolbar?: boolean, selectionColumnEl?: HTMLElement | null, contentStyleOnly?: boolean, getPreviewSvg?: () => (SVGElement | null | undefined), onOverlayVisualChange?: (patch: { showBorder?: boolean, showHandles?: boolean }) => void, onChange: (next: object, meta?: object) => void, onUndo?: () => void, onRedo?: () => void, getHistoryState?: () => { canUndo: boolean, canRedo: boolean }, getFontCatalog?: () => import('./fontCatalog.js').FontCatalog | null, onStartPropertyPick?: (targets: string[], onPicked: (sourceBoxId: string) => void) => void, onCancelPropertyPick?: () => void }} options
 */
export function mountLayoutPanel(root, options) {
  const showFileButtons = options.showFileButtons !== false
  const showOverlayVisual = options.showOverlayVisual !== false
  const hideHistoryToolbar = !!options.hideHistoryToolbar
  const hideSelectionToolbar = !!options.hideSelectionToolbar
  const dockFontPropsGroup = !!options.dockFontPropsGroup
  const contentStyleOnly = !!options.contentStyleOnly
  const boundsInMm = !!options.boundsInMm
  const idPrefix = options.idPrefix ? String(options.idPrefix) : ''
  const pid = (id) => (idPrefix ? `${idPrefix}${id}` : id)
  const queryRoot = options.queryRoot || root
  const qs = (id) => queryRoot.querySelector(`#${CSS.escape(pid(id))}`)
  const basicOpsSlot = options.basicOpsSlot || null
  const dockStackSlot = options.dockStackSlot || null
  const reorderStorageKey = options.reorderStorageKey || `${idPrefix || 'layout-'}dock-order`
  const dockResizeStorageKeyPrefix = options.dockResizeStorageKeyPrefix || `${idPrefix || 'layout-'}dock-panel-`
  const fillLabel = contentStyleOnly ? '填色' : '填色'
  const fillTitle = contentStyleOnly ? '文字填色' : '框填色与文字颜色'
  const outlineTitle = contentStyleOnly ? '文字轮廓' : '编辑框轮廓颜色'
  /** @type {string[]} */
  let selectedColumns = []
  let pendingOverrides = { ...options.layoutOverrides }

  const fontMetricsFieldsHtml = `
          <label class="tb-field tb-field--compact" title="字段字号 (px)">
            <span class="tb-field__label">字号</span>
            <input type="number" id="${pid('layout-field-font-size')}" name="${pid('layout-field-font-size')}" class="layout-font-input tb-input-num" min="1" step="0.1" disabled />
          </label>
          <label class="tb-field tb-field--compact" title="行距 (px)">
            <span class="tb-field__label">行距</span>
            <input type="number" id="${pid('layout-field-line-height')}" name="${pid('layout-field-line-height')}" class="layout-font-input tb-input-num" step="0.1" disabled />
          </label>
          <label class="tb-field tb-field--compact" title="字间距 (px)，0 为默认">
            <span class="tb-field__label">字距</span>
            <input type="number" id="${pid('layout-field-letter-spacing')}" name="${pid('layout-field-letter-spacing')}" class="layout-font-input tb-input-num" step="0.1" disabled />
          </label>
          <label class="tb-field tb-field--compact" title="字符水平宽度百分比，100 为默认；小于 100 压窄，大于 100 拉宽（换行仍生效）">
            <span class="tb-field__label">字宽%</span>
            <input type="number" id="${pid('layout-field-text-scale-x')}" name="${pid('layout-field-text-scale-x')}" class="layout-font-input tb-input-num layout-input-pct" min="${TEXT_SCALE_X_PERCENT_MIN}" max="${TEXT_SCALE_X_PERCENT_MAX}" step="1" disabled />
          </label>`

  const fontSelectFieldHtml = `
          <label class="tb-field tb-field--select layout-font-props-font-field" title="字体源中已启用的字体">
            <span class="tb-field__label">字体</span>
            <select id="${pid('layout-field-font-source')}" name="${pid('layout-field-font-source')}" class="layout-font-select" disabled>
              <option value="">—</option>
            </select>
          </label>`

  const textAlignGroupHtml = `
        <div class="tb-group tb-group--align-text layout-font-props-align">
          <div id="${pid('layout-align-h')}"></div>
          <div id="${pid('layout-align-v')}"></div>
        </div>`

  const textFitGroupHtml = `
        <div class="tb-group tb-group--fit layout-font-props-fit" id="${pid('layout-text-fit-row')}">
          <span class="tb-group-title">溢出<span class="layout-panel-sublabel" id="${pid('layout-text-fit-hint')}"></span></span>
          <div id="${pid('layout-text-fit')}"></div>
        </div>`

  const classicTextGroupHtml = `
        <div class="tb-group tb-group--text">
          ${fontMetricsFieldsHtml}
          ${fontSelectFieldHtml}
        </div>`

  const boundsXYFieldsHtml = `
            <label class="layout-bounds-field" title="${boundsInMm ? '左上角横坐标 (mm)' : '左上角横坐标'}"><span>X</span><input type="text" inputmode="decimal" id="${pid('layout-box-x')}" name="${pid('layout-box-x')}" class="layout-bounds-input" disabled /></label>
            <label class="layout-bounds-field" title="${boundsInMm ? '左上角纵坐标 (mm)' : '左上角纵坐标'}"><span>Y</span><input type="text" inputmode="decimal" id="${pid('layout-box-y')}" name="${pid('layout-box-y')}" class="layout-bounds-input" disabled /></label>`

  const boundsWHFieldsHtml = `
            <label class="layout-bounds-field" title="${boundsInMm ? '宽度 (mm)' : '编辑框宽度'}"><span>宽</span><input type="text" inputmode="decimal" id="${pid('layout-box-width')}" name="${pid('layout-box-width')}" class="layout-bounds-input" disabled /></label>
            <label class="layout-bounds-field" title="${boundsInMm ? '高度 (mm)' : '编辑框高度'}"><span>高</span><input type="text" inputmode="decimal" id="${pid('layout-box-height')}" name="${pid('layout-box-height')}" class="layout-bounds-input" disabled /></label>`

  const boundsGridHtml = `
          <div class="layout-box-bounds-grid layout-box-bounds-grid--inline">
            ${boundsXYFieldsHtml}
            ${boundsWHFieldsHtml}
          </div>`

  const fontPropsPanelInner = `
            <div class="layout-font-props-metrics-row">
              ${fontMetricsFieldsHtml}
            </div>
            ${fontSelectFieldHtml}
            ${textFitGroupHtml}
            ${textAlignGroupHtml}`

  const dockPanel = (key, title, inner, panelClass = '') => collapsiblePanelHtml({
    panelId: pid(`dock-panel-${key}`),
    title,
    content: inner,
    panelClass,
    storageKey: `${idPrefix || 'layout-'}dock-${key}-collapsed`,
    reorderId: key,
  })

  const dockGroupActionsHtml = `
        <div class="tb-group tb-group--group layout-toolbar-group layout-toolbar-group--group layout-toolbar-group--disabled layout-dock-quick-body layout-dock-group-actions" id="${pid('layout-group-section')}">
          ${toolbarBtnHtml({ id: pid('btn-layout-group'), label: '编组', title: '将所选编辑框编为一组，点击成员可整组选中', disabled: true })}
          ${toolbarBtnHtml({ id: pid('btn-layout-ungroup'), label: '解组', title: '解除所选编辑框的编组', disabled: true })}
          ${toolbarBtnHtml({ id: pid('btn-layout-copy-props'), label: '复制属性自', title: '先选中目标框，再点此按钮，然后点击源框并选择要复制的属性', disabled: true })}
        </div>`

  const dockColorsSectionHtml = `
        <div class="tb-group tb-group--colors layout-toolbar-group layout-toolbar-group--colors layout-toolbar-group--disabled layout-dock-quick-body" id="${pid('layout-color-section')}">
          <button type="button" class="tb-color-btn" id="${pid('btn-layout-fill')}" disabled title="${fillTitle}">
            <span class="tb-color-btn__swatch" id="${pid('layout-fill-swatch')}" aria-hidden="true"></span>
            <span>${fillLabel}</span>
          </button>
          <button type="button" class="tb-color-btn" id="${pid('btn-layout-outline')}" disabled title="${outlineTitle}">
            <span class="tb-color-btn__swatch" id="${pid('layout-outline-swatch')}" aria-hidden="true"></span>
            <span>轮廓</span>
          </button>
        </div>`

  const basicOpsSlotHtml = `
        <div class="layout-basic-ops-block layout-basic-ops-block--bounds">
          <div class="tb-group tb-group--bounds layout-toolbar-group layout-toolbar-group--bounds layout-toolbar-group--disabled layout-dock-panel-body" id="${pid('layout-box-bounds-section')}">
            <div class="layout-basic-ops-colors-xy-row">
              ${dockColorsSectionHtml}
              <div class="layout-box-bounds-grid layout-box-bounds-grid--inline layout-box-bounds-grid--xy">
                ${boundsXYFieldsHtml}
              </div>
            </div>
            <div class="layout-box-bounds-xy-actions">
              <div class="layout-box-bounds-grid layout-box-bounds-grid--inline layout-box-bounds-grid--wh">
                ${boundsWHFieldsHtml}
              </div>
              ${dockGroupActionsHtml}
            </div>
          </div>
        </div>`

  const dockPanelsHtml = `
      ${collapsiblePanelHtml({
        panelId: pid('layout-font-props-panel'),
        title: '字体属性',
        panelClass: 'layout-font-props-panel layout-presets-dock-panel',
        storageKey: `${idPrefix || 'layout-'}font-props-collapsed`,
        reorderId: 'font-props',
        content: fontPropsPanelInner,
      })}
      ${dockPanel('align', '对齐', `
        <div class="tb-group tb-group--box-ops layout-toolbar-group layout-toolbar-group--box layout-toolbar-group--disabled layout-dock-panel-body" id="${pid('layout-box-ops-section')}">
          <div id="${pid('layout-box-align')}"></div>
          <div id="${pid('layout-box-distribute')}"></div>
        </div>`, 'layout-dock-align-panel layout-presets-dock-panel')}`

  const dockStackToolbarHtml = `
    <div class="layout-toolbar layout-toolbar--dock-stack" role="toolbar" aria-label="编辑框布局" data-collapsible-reorder-group="layout-preset-dock">
      ${dockPanelsHtml}
    </div>`

  const classicToolbarHtml = `
    <div class="layout-toolbar layout-toolbar--compact" role="toolbar" aria-label="编辑框布局">
      <div class="layout-toolbar-row layout-toolbar-row--primary">
        ${hideHistoryToolbar ? '' : `<div class="tb-group tb-group--history">
          ${toolbarBtnHtml({ id: pid('btn-layout-undo'), label: '撤销', title: '撤销 (Ctrl+Z)', disabled: true })}
          ${toolbarBtnHtml({ id: pid('btn-layout-redo'), label: '重做', title: '重做 (Ctrl+Shift+Z)', disabled: true })}
        </div>
        ${toolbarSep()}`}
        ${hideSelectionToolbar ? '' : `<div class="tb-group tb-group--selection">
          <span class="tb-kicker" title="框内可点选；拖边移动/缩放；框外框选多选">选中</span>
          <span class="layout-panel-column" id="${pid('layout-panel-column')}">未选择</span>
        </div>
        ${toolbarSep()}`}
        ${classicTextGroupHtml}
        ${toolbarSep()}
        <div class="tb-group tb-group--bounds layout-toolbar-group layout-toolbar-group--bounds layout-toolbar-group--disabled" id="${pid('layout-box-bounds-section')}">
          <span class="tb-group-title">${boundsInMm ? '框 (mm)' : '框'}</span>
          ${boundsGridHtml}
        </div>
        ${toolbarSep()}${textFitGroupHtml}
      </div>
      <div class="layout-toolbar-row layout-toolbar-row--secondary">
        <div class="tb-group tb-group--box-ops layout-toolbar-group layout-toolbar-group--box layout-toolbar-group--disabled" id="${pid('layout-box-ops-section')}">
          <div id="${pid('layout-box-align')}"></div>
          <div id="${pid('layout-box-distribute')}"></div>
        </div>
        ${toolbarSep()}
        <div class="tb-group tb-group--group layout-toolbar-group layout-toolbar-group--group layout-toolbar-group--disabled" id="${pid('layout-group-section')}">
          ${toolbarBtnHtml({ id: pid('btn-layout-group'), label: '编组', title: '将所选编辑框编为一组，点击成员可整组选中', disabled: true })}
          ${toolbarBtnHtml({ id: pid('btn-layout-ungroup'), label: '解组', title: '解除所选编辑框的编组', disabled: true })}
          ${toolbarBtnHtml({ id: pid('btn-layout-copy-props'), label: '复制属性自', title: '先选中目标框，再点此按钮，然后点击源框并选择要复制的属性', disabled: true })}
        </div>
        ${toolbarSep()}${textAlignGroupHtml}${toolbarSep()}
        ${showOverlayVisual ? `
        <div class="tb-group tb-group--overlay-visual" id="${pid('layout-overlay-visual-section')}">
          <span class="tb-group-title">视图</span>
          <label class="tb-toggle" title="显示页面上全部编辑框的虚线边框（仅编辑时可见）"><input type="checkbox" id="${pid('layout-overlay-border')}" name="${pid('layout-overlay-border')}" ${options.overlayShowBorder !== false ? 'checked' : ''} /><span>虚线框</span></label>
          <label class="tb-toggle" title="显示页面上全部编辑框的拖拽缩放点（仅编辑时可见）"><input type="checkbox" id="${pid('layout-overlay-handles')}" name="${pid('layout-overlay-handles')}" ${options.overlayShowHandles !== false ? 'checked' : ''} /><span>角点</span></label>
        </div>
        ${toolbarSep()}` : ''}
        <div class="tb-group tb-group--colors layout-toolbar-group layout-toolbar-group--colors layout-toolbar-group--disabled" id="${pid('layout-color-section')}">
          <button type="button" class="tb-color-btn" id="${pid('btn-layout-fill')}" disabled title="${fillTitle}">
            <span class="tb-color-btn__swatch" id="${pid('layout-fill-swatch')}" aria-hidden="true"></span>
            <span>${fillLabel}</span>
          </button>
          <button type="button" class="tb-color-btn" id="${pid('btn-layout-outline')}" disabled title="${outlineTitle}">
            <span class="tb-color-btn__swatch" id="${pid('layout-outline-swatch')}" aria-hidden="true"></span>
            <span>轮廓</span>
          </button>
        </div>
        ${showFileButtons ? `${toolbarSep()}
        <div class="tb-group tb-group--files layout-toolbar-group layout-toolbar-group--files">
          ${toolbarBtnHtml({ id: pid('btn-link-layout-file'), label: '链接', title: '链接 layout-settings.json' })}
          ${toolbarBtnHtml({ id: pid('btn-export-layout-json'), label: '导出', title: '导出编辑框布局 JSON' })}
          ${toolbarBtnHtml({ id: pid('btn-import-layout-json'), label: '导入', title: '导入编辑框布局 JSON' })}
          <input type="file" id="${pid('layout-json-file')}" name="${pid('layout-json-file')}" accept=".json,application/json" hidden />
        </div>` : ''}
      </div>
    </div>`

  if (dockFontPropsGroup && dockStackSlot) {
    dockStackSlot.insertAdjacentHTML('beforeend', dockPanelsHtml)
    root.innerHTML = ''
  } else {
    root.innerHTML = dockFontPropsGroup ? dockStackToolbarHtml : classicToolbarHtml
  }

  if (dockFontPropsGroup && basicOpsSlot) {
    basicOpsSlot.innerHTML = basicOpsSlotHtml
  }

  const columnEl = options.selectionColumnEl ?? qs('layout-panel-column')
  const alignHGroup = qs('layout-align-h')
  const alignVGroup = qs('layout-align-v')
  const boxOpsSection = qs('layout-box-ops-section')
  const boxAlignGrid = qs('layout-box-align')
  const boxDistributeRow = qs('layout-box-distribute')
  const fontSizeInput = qs('layout-field-font-size')
  const lineHeightInput = qs('layout-field-line-height')
  const letterSpacingInput = qs('layout-field-letter-spacing')
  const textScaleXInput = qs('layout-field-text-scale-x')
  const fontSourceSelect = qs('layout-field-font-source')
  const boxBoundsSection = qs('layout-box-bounds-section')
  const boxXInput = qs('layout-box-x')
  const boxYInput = qs('layout-box-y')
  const boxWidthInput = qs('layout-box-width')
  const boxHeightInput = qs('layout-box-height')
  const textFitGroup = qs('layout-text-fit')
  const textFitHint = qs('layout-text-fit-hint')
  const btnUndo = qs('btn-layout-undo')
  const btnRedo = qs('btn-layout-redo')
  const overlayBorderInput = qs('layout-overlay-border')
  const overlayHandlesInput = qs('layout-overlay-handles')
  const btnFillColor = qs('btn-layout-fill')
  const btnOutlineColor = qs('btn-layout-outline')
  const groupSection = qs('layout-group-section')
  const colorSection = qs('layout-color-section')
  const btnGroup = qs('btn-layout-group')
  const btnUngroup = qs('btn-layout-ungroup')
  const btnCopyProps = qs('btn-layout-copy-props')

  /** @type {string[]} */
  let formatPainterTargets = []
  /** @type {HTMLDialogElement | null} */
  let formatPainterDialog = null

  function resolveLayoutStroke(layout) {
    return layout.textStroke || layout.overlayOutline || ''
  }

  function formatBoundInput(value) {
    if (value == null || Number.isNaN(value)) return ''
    const n = Number(value)
    const rounded = Math.round(n * 100) / 100
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  }

  function formatBoundsDisplay(value) {
    return boundsInMm ? formatMmBoundInput(value) : formatBoundInput(value)
  }

  function svgBoundForDisplay(svgValue, axis) {
    if (!boundsInMm || typeof options.getPageSizeMm !== 'function') return svgValue
    const { pageWidthMm, pageHeightMm } = options.getPageSizeMm()
    return svgUserUnitsToMm(svgValue, axis, pageWidthMm, pageHeightMm)
  }

  function inputBoundToSvg(inputValue, axis) {
    if (!boundsInMm || typeof options.getPageSizeMm !== 'function') return inputValue
    const { pageWidthMm, pageHeightMm } = options.getPageSizeMm()
    return mmToSvgUserUnits(inputValue, axis, pageWidthMm, pageHeightMm)
  }

  function pickDisplayXYWH(layout) {
    return {
      x: svgBoundForDisplay(layout.boxLeft, 'x'),
      y: svgBoundForDisplay(layout.boxTop, 'y'),
      w: svgBoundForDisplay(layout.boxRight - layout.boxLeft, 'w'),
      h: svgBoundForDisplay(layout.boxBottom - layout.boxTop, 'h'),
    }
  }

  function roundParam(value, decimals = 2) {
    const n = Number(value)
    if (Number.isNaN(n)) return value
    const f = 10 ** decimals
    return Math.round(n * f) / f
  }

  /** 多选时：数值按小数位比较，避免 7.29 与 7.2900001 被判为不同 */
  function allEqual(values, { numeric = false, decimals = 2 } = {}) {
    if (values.length <= 1) return true
    if (numeric) {
      const first = roundParam(values[0], decimals)
      return values.every((v) => roundParam(v, decimals) === first)
    }
    return values.every((v) => v === values[0])
  }

  function resolveToolbarAlignV(layout) {
    const v = getContentAlignV(layout)
    if (v !== 'label') return v
    if (layout.verticalAnchor === 'start') return 'top'
    if (layout.verticalAnchor === 'end') return 'bottom'
    return v
  }

  function ensureFormatPainterDialog() {
    if (formatPainterDialog) return formatPainterDialog
    formatPainterDialog = document.createElement('dialog')
    formatPainterDialog.className = 'layout-format-dialog'
    formatPainterDialog.innerHTML = `
      <form method="dialog" class="layout-format-dialog-inner">
        <h3 class="layout-sample-dialog-title">属性修改</h3>
        <p class="layout-sample-dialog-hint" id="layout-format-dialog-hint"></p>
        <div class="layout-format-dialog-options">
          <label><input type="checkbox" name="prop" value="size" checked /> 尺寸（宽、高）</label>
          <label><input type="checkbox" name="prop" value="text" checked /> 文本（字号、行距、字距、字宽%、对齐、字体等）</label>
          <label><input type="checkbox" name="prop" value="fill" checked /> 填色（图形和文字）</label>
          <label><input type="checkbox" name="prop" value="stroke" checked /> 轮廓色</label>
        </div>
        <div class="layout-sample-dialog-actions">
          <button type="button" class="button button-sm layout-format-dialog-cancel">取消</button>
          <button type="submit" class="button button-sm button-primary" value="ok">确定</button>
        </div>
      </form>
    `
    document.body.appendChild(formatPainterDialog)
    formatPainterDialog.querySelector('.layout-format-dialog-cancel')?.addEventListener('click', () => {
      formatPainterDialog?.close('cancel')
    })
    formatPainterDialog.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!formatPainterDialog) return
      formatPainterDialog.returnValue = 'ok'
      formatPainterDialog.close('ok')
    })
    formatPainterDialog.addEventListener('close', () => {
      if (formatPainterDialog?.returnValue !== 'ok') {
        formatPainterTargets = []
        return
      }
      const sourceId = formatPainterDialog.dataset.sourceId
      const targets = [...formatPainterTargets]
      formatPainterTargets = []
      if (!sourceId || !targets.length) return
      const picked = [...formatPainterDialog.querySelectorAll('input[name="prop"]:checked')].map((el) => el.value)
      if (!picked.length) return
      applyFormatPainterProps(sourceId, targets, picked)
    })
    return formatPainterDialog
  }

  function applyFormatPainterProps(sourceId, targetBoxIds, propKeys) {
    const sourceLayout = getColumnLayout(sourceId, pendingOverrides)
    const copySize = propKeys.includes('size')
    const srcW = copySize ? sourceLayout.boxRight - sourceLayout.boxLeft : 0
    const srcH = copySize ? sourceLayout.boxBottom - sourceLayout.boxTop : 0

    const textPatch = {}
    if (propKeys.includes('text')) {
      if (sourceLayout.fontSize != null) textPatch.fontSize = sourceLayout.fontSize
      if (sourceLayout.lineHeight != null) textPatch.lineHeight = sourceLayout.lineHeight
      if (sourceLayout.letterSpacing != null) textPatch.letterSpacing = sourceLayout.letterSpacing
      if (sourceLayout.textScaleXPercent != null) textPatch.textScaleXPercent = sourceLayout.textScaleXPercent
      if (sourceLayout.contentAlignH != null) textPatch.contentAlignH = sourceLayout.contentAlignH
      if (sourceLayout.contentAlignV != null) textPatch.contentAlignV = sourceLayout.contentAlignV
      if (sourceLayout.textFitMode != null) textPatch.textFitMode = sourceLayout.textFitMode
      if (sourceLayout.fontSourceId != null) textPatch.fontSourceId = sourceLayout.fontSourceId
    }

    const stylePatch = {}
    if (propKeys.includes('fill')) {
      stylePatch.textFill = sourceLayout.textFill || undefined
    }
    if (propKeys.includes('stroke')) {
      stylePatch.textStroke = resolveLayoutStroke(sourceLayout) || undefined
    }

    let next = { ...pendingOverrides }
    for (const boxId of targetBoxIds) {
      const col = resolveBoxId(boxId, next)
      if (copySize) {
        const targetLayout = getColumnLayout(col, next)
        if (layoutHasBox(targetLayout)) {
          next = applyColumnBoxBounds(next, col, clampLayoutBoxBounds({
            boxLeft: targetLayout.boxLeft,
            boxTop: targetLayout.boxTop,
            boxRight: targetLayout.boxLeft + srcW,
            boxBottom: targetLayout.boxTop + srcH,
          }))
        }
      }
      const patch = { ...textPatch, ...stylePatch }
      if (!Object.keys(patch).length) continue
      const groupId = getGroupIdForColumn(col)
      if (patch.contentAlignH != null && groupId) {
        next = applyAlignToWrapGroup(next, groupId, { contentAlignH: patch.contentAlignH })
        const { contentAlignH, ...rest } = patch
        if (Object.keys(rest).length) next = patchLayoutBox(next, col, rest)
      } else {
        next = patchLayoutBox(next, col, patch)
      }
    }
    commit(next, { reason: '复制属性自', previewLight: !copySize })
  }

  function openFormatPainterDialog(sourceBoxId) {
    const dlg = ensureFormatPainterDialog()
    dlg.dataset.sourceId = sourceBoxId
    const hint = dlg.querySelector('#layout-format-dialog-hint')
    if (hint) {
      hint.textContent = `从「${sourceBoxId}」复制到已选的 ${formatPainterTargets.length} 个编辑框`
    }
    dlg.showModal()
  }

  mountToolbarToggleGroup(alignHGroup, ['left', 'center', 'right'], TEXT_ALIGN_H_TOOLTIPS, ALIGN_H_ICON, 'h', '', { iconStrokeWidth: 1 })
  mountToolbarToggleGroup(alignVGroup, ['top', 'center', 'bottom'], TEXT_ALIGN_V_TOOLTIPS, ALIGN_V_ICON, 'v', '', { iconStrokeWidth: 1 })
  mountToolbarToggleGroup(textFitGroup, TEXT_FIT_MODES, TEXT_FIT_MODE_LABELS, TEXT_FIT_ICON, 'fit')
  mountBoxOpButtons(boxAlignGrid, boxDistributeRow)

  function refreshFontSourceOptions() {
    if (!fontSourceSelect) return
    const catalog = options.getFontCatalog?.()
    fontSourceSelect.innerHTML = ''
    if (!catalog?.sources?.length) {
      fontSourceSelect.appendChild(new Option('（无可用字体）', ''))
      fontSourceSelect.disabled = true
      return
    }
    const defId = catalog.defaultSourceId || catalog.sources[0]?.id || ''
    for (const src of catalog.sources) {
      fontSourceSelect.appendChild(new Option(src.label, src.id))
    }
    fontSourceSelect.disabled = selectedColumns.length === 0
  }

  function resolveBoxLayout(boxId, overrides = pendingOverrides) {
    return options.getBoxLayout?.(boxId, overrides) ?? getColumnLayout(boxId, overrides)
  }

  function applyBoxBounds(overrides, boxId, bounds, edge) {
    if (options.applyBoxBounds) {
      return options.applyBoxBounds(overrides, boxId, bounds, edge)
    }
    return applyColumnBoxBounds(overrides, resolveBoxId(boxId, overrides), bounds, edge)
  }

  function getLayoutBoxBridge() {
    if (options.getLayoutBoxBridge) return options.getLayoutBoxBridge()
    return {
      getLayout: resolveBoxLayout,
      applyBounds: (overrides, boxId, bounds, edge) => applyBoxBounds(overrides, boxId, bounds, edge),
    }
  }

  function isLayoutOnlyBox(boxId) {
    return options.isLayoutOnlyBox?.(boxId) === true
  }

  function syncGroupActionButtons() {
    const hasSelection = selectedColumns.length > 0
    const onlyLayoutOnly = hasSelection && selectedColumns.every((c) => isLayoutOnlyBox(c))
    const exactGroup = findMatchingGroupLabel(pendingOverrides, selectedColumns) != null
    const hasGrouped = selectionHasGroupedBoxes(pendingOverrides, selectedColumns)

    if (!hasSelection || onlyLayoutOnly) {
      groupSection?.classList.add('layout-toolbar-group--disabled')
      if (btnCopyProps) btnCopyProps.disabled = true
      if (btnGroup) btnGroup.disabled = true
      if (btnUngroup) btnUngroup.disabled = true
      return
    }

    groupSection?.classList.remove('layout-toolbar-group--disabled')
    if (btnCopyProps) btnCopyProps.disabled = false
    if (btnGroup) btnGroup.disabled = selectedColumns.length < 2 || exactGroup
    if (btnUngroup) btnUngroup.disabled = !hasGrouped
  }

  function syncLayoutOnlyControls() {
    fontSizeInput.disabled = true
    fontSizeInput.value = ''
    lineHeightInput.disabled = true
    lineHeightInput.value = ''
    letterSpacingInput.disabled = true
    letterSpacingInput.value = ''
    textScaleXInput.disabled = true
    textScaleXInput.value = ''
    if (fontSourceSelect) {
      fontSourceSelect.disabled = true
      fontSourceSelect.value = ''
    }
    alignHGroup.querySelectorAll('button').forEach((b) => { b.disabled = true })
    alignVGroup.querySelectorAll('button').forEach((b) => { b.disabled = true })
    textFitGroup.querySelectorAll('button').forEach((b) => { b.disabled = true })
    if (textFitHint) textFitHint.textContent = ''
    colorSection?.classList.add('layout-toolbar-group--disabled')
    syncGroupActionButtons()
    if (btnFillColor) btnFillColor.disabled = true
    if (btnOutlineColor) btnOutlineColor.disabled = true
  }

  function syncHistoryButtons() {
    const st = options.getHistoryState?.() ?? { canUndo: false, canRedo: false }
    if (btnUndo) btnUndo.disabled = !st.canUndo
    if (btnRedo) btnRedo.disabled = !st.canRedo
  }

  function queryPanelEl(id) {
    const sel = `#${CSS.escape(pid(id))}`
    if (basicOpsSlot) {
      const inSlot = basicOpsSlot.querySelector(sel)
      if (inSlot instanceof HTMLElement) return inSlot
    }
    return queryRoot.querySelector(sel)
  }

  function colorSwatchEls() {
    return {
      fill: queryPanelEl('layout-fill-swatch'),
      outline: queryPanelEl('layout-outline-swatch'),
    }
  }

  function applySwatchColor(el, color) {
    if (!(el instanceof HTMLElement)) return
    el.style.background = swatchBackground(color || '')
  }

  function normalizeSwatchColor(color) {
    if (!color) return ''
    const parsed = parseColor(color)
    return parsed ? formatColor(parsed, { alpha: true }) : color
  }

  function resolveBoxTextFill(boxId) {
    const svg = options.getPreviewSvg?.()
    if (svg) {
      const fromSvg = readColumnTextFillFromSvg(svg, boxId, pendingOverrides)
      if (fromSvg) return normalizeSwatchColor(fromSvg)
    }
    const layout = resolveBoxLayout(boxId, pendingOverrides)
    return normalizeSwatchColor(layout.textFill || '')
  }

  function resolveBoxTextStroke(boxId) {
    const svg = options.getPreviewSvg?.()
    if (svg) {
      const fromSvg = readColumnTextStrokeFromSvg(svg, boxId, pendingOverrides)
      if (fromSvg) return normalizeSwatchColor(fromSvg)
    }
    return normalizeSwatchColor(resolveLayoutStroke(resolveBoxLayout(boxId, pendingOverrides)))
  }

  function syncColorSwatches() {
    const { fill: fillEl, outline: outlineEl } = colorSwatchEls()
    if (!fillEl || !outlineEl) return
    const mixed = 'repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 8px 8px'
    if (selectedColumns.length === 0) {
      applySwatchColor(fillEl, '')
      applySwatchColor(outlineEl, '')
      return
    }
    const fills = selectedColumns.map((c) => resolveBoxTextFill(c))
    const sameFill = allEqual(fills)
    fillEl.style.background = sameFill ? swatchBackground(fills[0]) : mixed
    const outlines = selectedColumns.map((c) => resolveBoxTextStroke(c))
    const sameOutline = allEqual(outlines)
    outlineEl.style.background = sameOutline ? swatchBackground(outlines[0]) : mixed
  }

  function syncButtons() {
    syncHistoryButtons()

    const canAlign = selectedColumns.length >= 1
    const canDistribute = selectedColumns.length >= 3

    boxOpsSection.classList.toggle('layout-toolbar-group--disabled', !canAlign)
    boxAlignGrid.querySelectorAll('button').forEach((b) => { b.disabled = !canAlign })
    boxDistributeRow.querySelectorAll('button').forEach((b) => { b.disabled = !canDistribute })

    refreshFontSourceOptions()

    if (selectedColumns.length === 0) {
      if (columnEl) columnEl.textContent = '未选择'
      colorSection?.classList.add('layout-toolbar-group--disabled')
      syncGroupActionButtons()
      if (btnFillColor) btnFillColor.disabled = true
      if (btnOutlineColor) btnOutlineColor.disabled = true
      fontSizeInput.disabled = true
      fontSizeInput.value = ''
      lineHeightInput.disabled = true
      lineHeightInput.value = ''
      letterSpacingInput.disabled = true
      letterSpacingInput.value = ''
      textScaleXInput.disabled = true
      textScaleXInput.value = ''
      if (fontSourceSelect) {
        fontSourceSelect.disabled = true
        fontSourceSelect.value = ''
      }
      boxBoundsSection.classList.add('layout-toolbar-group--disabled')
      if (textFitHint) textFitHint.textContent = ''
      textFitGroup.querySelectorAll('button').forEach((b) => { b.disabled = true })
      alignHGroup.querySelectorAll('.layout-align-btn').forEach((b) => b.classList.remove('active'))
      alignVGroup.querySelectorAll('.layout-align-btn').forEach((b) => b.classList.remove('active'))
      textFitGroup.querySelectorAll('.layout-align-btn').forEach((b) => b.classList.remove('active'))
      alignHGroup.querySelectorAll('button').forEach((b) => { b.disabled = true })
      alignVGroup.querySelectorAll('button').forEach((b) => { b.disabled = true })
      syncColorSwatches()
      return
    }

    const onlyLayoutOnly = selectedColumns.every((c) => isLayoutOnlyBox(c))
    if (onlyLayoutOnly) {
      const primary = selectedColumns[0]
      if (columnEl) columnEl.textContent = options.getBoxLabel?.(primary) || primary
      syncLayoutOnlyControls()

      const boxedColumns = selectedColumns.filter((c) =>
        layoutHasBox(resolveBoxLayout(c, pendingOverrides)),
      )
      const canEditBounds = boxedColumns.length > 0
      boxBoundsSection.classList.toggle('layout-toolbar-group--disabled', !canEditBounds)
      const boundsInputs = [boxXInput, boxYInput, boxWidthInput, boxHeightInput]
      boundsInputs.forEach((inp) => { inp.disabled = !canEditBounds })

      const pickXYWH = (key) => {
        const vals = boxedColumns.map((c) => {
          const l = resolveBoxLayout(c, pendingOverrides)
          const d = pickDisplayXYWH(l)
          return d[key]
        })
        const same = allEqual(vals, { numeric: true })
        return { same, value: vals[0] }
      }

      if (canEditBounds) {
        const X = pickXYWH('x')
        const Y = pickXYWH('y')
        const W = pickXYWH('w')
        const H = pickXYWH('h')
        boxXInput.value = X.same ? formatBoundsDisplay(X.value) : ''
        boxYInput.value = Y.same ? formatBoundsDisplay(Y.value) : ''
        boxWidthInput.value = W.same ? formatBoundsDisplay(W.value) : ''
        boxHeightInput.value = H.same ? formatBoundsDisplay(H.value) : ''
        boxXInput.placeholder = X.same ? '' : '多个值'
        boxYInput.placeholder = Y.same ? '' : '多个值'
        boxWidthInput.placeholder = W.same ? '' : '多个值'
        boxHeightInput.placeholder = H.same ? '' : '多个值'
      } else {
        boundsInputs.forEach((inp) => {
          inp.value = ''
          inp.placeholder = ''
        })
      }
      syncColorSwatches()
      syncGroupActionButtons()
      return
    }

    alignHGroup.querySelectorAll('button').forEach((b) => { b.disabled = false })
    alignVGroup.querySelectorAll('button').forEach((b) => { b.disabled = false })
    textFitGroup.querySelectorAll('button').forEach((b) => { b.disabled = false })

    colorSection?.classList.remove('layout-toolbar-group--disabled')
    syncGroupActionButtons()
    if (btnFillColor) btnFillColor.disabled = false
    if (btnOutlineColor) btnOutlineColor.disabled = false

    const primary = selectedColumns[0]
    if (selectedColumns.length === 1) {
      const groupId = getGroupIdForColumn(primary)
      const groupHint = groupId && PEDIGREE_WRAP_GROUPS[groupId]?.columns.length > 1
        ? '（同组宽）'
        : ''
      if (columnEl) columnEl.textContent = `${primary}${groupHint}`
    } else {
      if (columnEl) columnEl.textContent = `已选 ${selectedColumns.length} 项`
    }

    const layout = getColumnLayout(primary, pendingOverrides)
    syncColorSwatches()
    const catalog = options.getFontCatalog?.()
    const defFontId = catalog?.defaultSourceId || catalog?.sources?.[0]?.id || ''
    if (fontSourceSelect) {
      fontSourceSelect.disabled = false
      const fontIds = selectedColumns.map((c) => {
        const l = getColumnLayout(c, pendingOverrides)
        return l.fontSourceId || defFontId
      })
      const sameFont = allEqual(fontIds)
      fontSourceSelect.value = sameFont ? (fontIds[0] || defFontId) : ''
      fontSourceSelect.title = sameFont ? '' : '多选且字体不一致，修改后将统一应用'
    }

    const alignHs = selectedColumns.map((c) => getContentAlignH(getColumnLayout(c, pendingOverrides)))
    const sameAlignH = allEqual(alignHs)
    const alignH = sameAlignH ? alignHs[0] : null

    const alignVs = selectedColumns.map((c) => resolveToolbarAlignV(getColumnLayout(c, pendingOverrides)))
    const sameAlignV = allEqual(alignVs)
    const alignV = sameAlignV ? alignVs[0] : null

    const sizes = selectedColumns.map((c) => {
      const l = getColumnLayout(c, pendingOverrides)
      return l.fontSize ?? getDefaultFontSizeForColumn(c)
    })
    const sameSize = allEqual(sizes, { numeric: true })
    fontSizeInput.disabled = false
    fontSizeInput.value = sameSize ? String(roundParam(sizes[0])) : ''
    fontSizeInput.placeholder = sameSize ? '' : '多个值'

    const lineHeights = selectedColumns.map((c) => {
      const l = getColumnLayout(c, pendingOverrides)
      return l.lineHeight ?? getDefaultLineHeightForColumn(c)
    })
    const sameLineHeight = allEqual(lineHeights, { numeric: true })
    lineHeightInput.disabled = false
    lineHeightInput.value = sameLineHeight ? String(roundParam(lineHeights[0])) : ''
    lineHeightInput.placeholder = sameLineHeight ? '' : '多个值'

    const letterSpacings = selectedColumns.map((c) => {
      const l = getColumnLayout(c, pendingOverrides)
      return l.letterSpacing ?? getDefaultLetterSpacingForColumn(c)
    })
    const sameLetterSpacing = allEqual(letterSpacings, { numeric: true })
    letterSpacingInput.disabled = false
    letterSpacingInput.value = sameLetterSpacing ? String(roundParam(letterSpacings[0])) : ''
    letterSpacingInput.placeholder = sameLetterSpacing ? '' : '多个值'

    const textScalePercents = selectedColumns.map((c) => {
      const l = getColumnLayout(c, pendingOverrides)
      return l.textScaleXPercent ?? getDefaultTextScaleXPercentForColumn(c)
    })
    const sameTextScaleX = allEqual(textScalePercents, { numeric: true, decimals: 0 })
    textScaleXInput.disabled = false
    textScaleXInput.value = sameTextScaleX ? String(roundParam(textScalePercents[0], 0)) : ''
    textScaleXInput.placeholder = sameTextScaleX ? '' : '多个值'

    alignHGroup.querySelectorAll('.layout-align-btn').forEach((b) => {
      b.classList.toggle('active', alignH != null && alignH !== 'label' && b.dataset.value === alignH)
    })
    alignVGroup.querySelectorAll('.layout-align-btn').forEach((b) => {
      b.classList.toggle('active', alignV != null && alignV !== 'label' && b.dataset.value === alignV)
    })

    const fitModes = selectedColumns.map((c) => {
      const l = getColumnLayout(c, pendingOverrides)
      return l.textFitMode === 'shrink' ? 'shrink' : 'wrap'
    })
    const sameFit = allEqual(fitModes)
    textFitGroup.querySelectorAll('.layout-align-btn').forEach((b) => {
      b.classList.toggle('active', sameFit && b.dataset.value === fitModes[0])
    })
    if (textFitHint) {
      if (selectedColumns.length > 1) {
        textFitHint.textContent = sameFit
          ? `（${selectedColumns.length} 项，批量）`
          : `（${selectedColumns.length} 项·混合，点击批量应用）`
      } else {
        textFitHint.textContent = ''
      }
    }

    const boxedColumns = selectedColumns.filter((c) =>
      layoutHasBox(resolveBoxLayout(c, pendingOverrides)),
    )
    const canEditBounds = boxedColumns.length > 0
    boxBoundsSection.classList.toggle('layout-toolbar-group--disabled', !canEditBounds)
    const boundsInputs = [boxXInput, boxYInput, boxWidthInput, boxHeightInput]
    boundsInputs.forEach((inp) => { inp.disabled = !canEditBounds })

    const pickXYWH = (key) => {
      const vals = boxedColumns.map((c) => {
        const l = resolveBoxLayout(c, pendingOverrides)
        const d = pickDisplayXYWH(l)
        return d[key]
      })
      const same = allEqual(vals, { numeric: true })
      return { same, value: vals[0] }
    }

    if (canEditBounds) {
      const X = pickXYWH('x')
      const Y = pickXYWH('y')
      const W = pickXYWH('w')
      const H = pickXYWH('h')
      boxXInput.value = X.same ? formatBoundsDisplay(X.value) : ''
      boxYInput.value = Y.same ? formatBoundsDisplay(Y.value) : ''
      boxWidthInput.value = W.same ? formatBoundsDisplay(W.value) : ''
      boxHeightInput.value = H.same ? formatBoundsDisplay(H.value) : ''
      boxXInput.placeholder = X.same ? '' : '多个值'
      boxYInput.placeholder = Y.same ? '' : '多个值'
      boxWidthInput.placeholder = W.same ? '' : '多个值'
      boxHeightInput.placeholder = H.same ? '' : '多个值'
    } else {
      boundsInputs.forEach((inp) => {
        inp.value = ''
        inp.placeholder = ''
      })
    }
  }

  function commit(next, meta = {}) {
    pendingOverrides = next
    const affectedColumns = selectedColumns.length
      ? [...new Set(selectedColumns.map((c) => getPrimaryColumnForBox(c, pendingOverrides)))]
      : undefined
    options.onChange({ ...pendingOverrides }, { previewLight: true, affectedColumns, ...meta })
    syncButtons()
  }

  function patchSelectedColumns(patch) {
    let next = { ...pendingOverrides }
    for (const col of selectedColumns) {
      const groupId = getGroupIdForColumn(col)
      if (patch.contentAlignH != null && groupId) {
        next = applyAlignToWrapGroup(next, groupId, { contentAlignH: patch.contentAlignH })
      } else {
        next = patchLayoutBox(next, col, patch)
      }
    }
    return next
  }

  function onAlignClick(e) {
    const btn = e.target.closest('.layout-align-btn')
    if (!btn || selectedColumns.length === 0) return

    const axis = btn.dataset.axis
    const value = btn.dataset.value
    let next = { ...pendingOverrides }

    if (axis === 'fit') {
      commit(patchSelectedColumns({ textFitMode: value }), {
        previewLight: true,
        reason: '布局面板（文字适应）',
      })
      return
    }

    if (axis === 'h') {
      for (const col of selectedColumns) {
        const groupId = getGroupIdForColumn(col)
        if (groupId) {
          next = applyAlignToWrapGroup(next, groupId, { contentAlignH: value })
        } else {
          next = patchLayoutBox(next, col, { contentAlignH: value })
        }
      }
    } else {
      next = patchSelectedColumns({ contentAlignV: value })
    }

    commit(next, { reason: '布局面板（文字对齐）' })
  }

  function onFontSizeChange() {
    if (selectedColumns.length === 0) return
    const v = parseFloat(fontSizeInput.value)
    if (Number.isNaN(v) || v <= 0) return
    let next = { ...pendingOverrides }
    for (const col of selectedColumns) {
      next = patchLayoutBox(next, col, {
        fontSize: Math.round(v * 100) / 100,
      })
    }
    commit(next, { reason: '布局面板（字号）' })
  }

  function onLineHeightChange() {
    if (selectedColumns.length === 0) return
    const v = parseFloat(lineHeightInput.value)
    if (Number.isNaN(v) || v < 0) return
    let next = { ...pendingOverrides }
    for (const col of selectedColumns) {
      next = patchLayoutBox(next, col, {
        lineHeight: Math.round(v * 100) / 100,
      })
    }
    commit(next, { reason: '布局面板（行距）' })
  }

  function onLetterSpacingChange() {
    if (selectedColumns.length === 0) return
    const v = parseFloat(letterSpacingInput.value)
    if (Number.isNaN(v)) return
    let next = { ...pendingOverrides }
    for (const col of selectedColumns) {
      next = patchLayoutBox(next, col, {
        letterSpacing: Math.round(v * 100) / 100,
      })
    }
    commit(next, { reason: '布局面板（字间距）' })
  }

  function onTextScaleXPercentChange() {
    if (selectedColumns.length === 0) return
    const v = parseFloat(textScaleXInput.value)
    if (Number.isNaN(v)) return
    const clamped = Math.min(TEXT_SCALE_X_PERCENT_MAX, Math.max(TEXT_SCALE_X_PERCENT_MIN, v))
    let next = { ...pendingOverrides }
    for (const col of selectedColumns) {
      next = patchLayoutBox(next, col, {
        textScaleXPercent: Math.round(clamped),
      })
    }
    commit(next, { reason: '布局面板（字宽%）' })
  }

  function parseBoundsField(input) {
    const raw = String(input?.value ?? '').trim()
    if (raw === '') return null
    const n = parseFloat(raw)
    return Number.isNaN(n) ? null : n
  }

  function onBoxBoundsChange() {
    if (selectedColumns.length === 0) return

    const newX = parseBoundsField(boxXInput)
    const newY = parseBoundsField(boxYInput)
    const newW = parseBoundsField(boxWidthInput)
    const newH = parseBoundsField(boxHeightInput)

    if (newX == null && newY == null && newW == null && newH == null) return

    let next = { ...pendingOverrides }
    let changed = false

    for (const col of selectedColumns) {
      const colLayout = resolveBoxLayout(col, pendingOverrides)
      if (!layoutHasBox(colLayout)) continue

      const curLeft = colLayout.boxLeft
      const curTop = colLayout.boxTop
      const curRight = colLayout.boxRight
      const curBottom = colLayout.boxBottom
      const curW = curRight - curLeft
      const curH = curBottom - curTop

      const boxLeft = newX != null ? inputBoundToSvg(newX, 'x') : curLeft
      const boxTop = newY != null ? inputBoundToSvg(newY, 'y') : curTop
      const w = newW != null ? inputBoundToSvg(newW, 'w') : curW
      const h = newH != null ? inputBoundToSvg(newH, 'h') : curH

      const bounds = clampLayoutBoxBounds({
        boxLeft,
        boxTop,
        boxRight: boxLeft + w,
        boxBottom: boxTop + h,
      })

      next = applyBoxBounds(next, col, bounds)
      changed = true

      if (isLayoutOnlyBox(col)) continue

      const groupId = getGroupIdForColumn(col)
      if (groupId && (newX != null || newW != null) && bounds.boxLeft != null && bounds.boxRight != null) {
        next = applyHorizontalToWrapGroup(next, groupId, bounds.boxLeft, bounds.boxRight)
      }
    }

    if (!changed) return
    commit(next, { reason: '布局面板（编辑框尺寸）' })
  }

  let fontTimer = null
  let lineHeightTimer = null
  let letterSpacingTimer = null
  let textScaleXTimer = null
  let boundsTimer = null
  fontSizeInput.addEventListener('input', () => {
    clearTimeout(fontTimer)
    fontTimer = setTimeout(onFontSizeChange, 300)
  })
  fontSizeInput.addEventListener('change', onFontSizeChange)
  lineHeightInput.addEventListener('input', () => {
    clearTimeout(lineHeightTimer)
    lineHeightTimer = setTimeout(onLineHeightChange, 300)
  })
  lineHeightInput.addEventListener('change', onLineHeightChange)
  letterSpacingInput.addEventListener('input', () => {
    clearTimeout(letterSpacingTimer)
    letterSpacingTimer = setTimeout(onLetterSpacingChange, 300)
  })
  letterSpacingInput.addEventListener('change', onLetterSpacingChange)
  textScaleXInput.addEventListener('input', () => {
    clearTimeout(textScaleXTimer)
    textScaleXTimer = setTimeout(onTextScaleXPercentChange, 300)
  })
  textScaleXInput.addEventListener('change', onTextScaleXPercentChange)

  function onFontSourceChange() {
    if (selectedColumns.length === 0 || !fontSourceSelect) return
    const id = fontSourceSelect.value
    if (!id) return
    let next = { ...pendingOverrides }
    for (const col of selectedColumns) {
      next = patchLayoutBox(next, col, { fontSourceId: id })
    }
    commit(next, { reason: '布局面板（字体）', previewLight: false })
  }

  fontSourceSelect?.addEventListener('change', onFontSourceChange)

  const boundsInputs = [boxXInput, boxYInput, boxWidthInput, boxHeightInput]
  const onBoundsInput = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(onBoxBoundsChange, 300)
  }
  boundsInputs.forEach((inp) => {
    inp.addEventListener('input', onBoundsInput)
    inp.addEventListener('change', onBoxBoundsChange)
  })

  function onBoxOpClick(e) {
    const btn = e.target.closest('.layout-box-op-btn')
    if (!btn || btn.disabled || selectedColumns.length === 0) return

    const op = btn.dataset.op
    const value = btn.dataset.value
    let next = pendingOverrides
    const bridge = getLayoutBoxBridge()

    if (op === 'align' && selectedColumns.length >= 1) {
      if (selectedColumns.length >= 2) {
        const anchor = selectedColumns[selectedColumns.length - 1]
        next = alignLayoutBoxes(pendingOverrides, selectedColumns, value, anchor, bridge)
      } else {
        next = alignLayoutBoxesToArtboard(pendingOverrides, selectedColumns, value, bridge)
      }
    } else if (op === 'distribute' && selectedColumns.length >= 3) {
      next = distributeLayoutBoxes(pendingOverrides, selectedColumns, value, bridge)
    }

    commit(next, { reason: '布局面板（框对齐/分布）', previewLight: op !== 'distribute' })
  }

  alignHGroup.addEventListener('click', onAlignClick)
  alignVGroup.addEventListener('click', onAlignClick)
  textFitGroup.addEventListener('click', onAlignClick)
  boxAlignGrid.addEventListener('click', onBoxOpClick)
  boxDistributeRow.addEventListener('click', onBoxOpClick)

  btnUndo?.addEventListener('click', () => options.onUndo?.())
  btnRedo?.addEventListener('click', () => options.onRedo?.())

  if (!hideHistoryToolbar) {
    root.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        options.onUndo?.()
      } else if (key === 'z' && e.shiftKey) {
        e.preventDefault()
        options.onRedo?.()
      }
    })
  }

  function commitOverlayPatch(patch) {
    if (selectedColumns.length === 0) return
    commit(patchSelectedColumns(patch), { reason: '布局面板（框样式）', previewLight: true })
  }

  overlayBorderInput?.addEventListener('change', () => {
    options.onOverlayVisualChange?.({ showBorder: overlayBorderInput.checked })
  })
  overlayHandlesInput?.addEventListener('change', () => {
    options.onOverlayVisualChange?.({ showHandles: overlayHandlesInput.checked })
  })

  function openFillColorPicker(anchorEl) {
    if (selectedColumns.length === 0) return
    const primary = selectedColumns[0]
    const textFill = resolveBoxTextFill(primary)
    openColorPicker({
      title: '文字填色',
      value: textFill || '#000000',
      allowAlpha: true,
      anchorEl,
      onLiveChange: (val) => {
        applySwatchColor(colorSwatchEls().fill, val)
        commitOverlayPatch({ textFill: val || undefined })
      },
      onApply: (val) => {
        applySwatchColor(colorSwatchEls().fill, val)
        commit(patchSelectedColumns({ textFill: val || undefined }), { reason: '布局面板（填色）', previewLight: true })
      },
      onClear: () => {
        applySwatchColor(colorSwatchEls().fill, '')
        commit(patchSelectedColumns({ textFill: undefined }), { reason: '布局面板（填色）', previewLight: true })
      },
    })
  }

  function openOutlineColorPicker(anchorEl) {
    if (selectedColumns.length === 0) return
    const primary = selectedColumns[0]
    const outline = resolveBoxTextStroke(primary)
    openColorPicker({
      title: '文字轮廓',
      value: outline,
      allowAlpha: true,
      anchorEl,
      onLiveChange: (val) => {
        applySwatchColor(colorSwatchEls().outline, val)
        commitOverlayPatch({ textStroke: val })
      },
      onApply: (val) => {
        applySwatchColor(colorSwatchEls().outline, val)
        commit(patchSelectedColumns({ textStroke: val }), { reason: '布局面板（轮廓）', previewLight: true })
      },
      onClear: () => {
        applySwatchColor(colorSwatchEls().outline, '')
        commit(patchSelectedColumns({ textStroke: '' }), { reason: '布局面板（轮廓）', previewLight: true })
      },
    })
  }

  if (basicOpsSlot) {
    basicOpsSlot.addEventListener('click', (e) => {
      const fillBtn = e.target.closest(`#${CSS.escape(pid('btn-layout-fill'))}`)
      if (fillBtn instanceof HTMLElement) {
        e.preventDefault()
        openFillColorPicker(fillBtn)
        return
      }
      const outlineBtn = e.target.closest(`#${CSS.escape(pid('btn-layout-outline'))}`)
      if (outlineBtn instanceof HTMLElement) {
        e.preventDefault()
        openOutlineColorPicker(outlineBtn)
      }
    })
  } else {
    btnFillColor?.addEventListener('click', () => openFillColorPicker(btnFillColor))
    btnOutlineColor?.addEventListener('click', () => openOutlineColorPicker(btnOutlineColor))
  }

  btnGroup?.addEventListener('click', () => {
    if (selectedColumns.length < 2) return
    if (findMatchingGroupLabel(pendingOverrides, selectedColumns)) return
    const next = createLayoutGroup(pendingOverrides, selectedColumns)
    commit(next, { reason: '布局面板（编组）', previewLight: true })
  })

  btnUngroup?.addEventListener('click', () => {
    if (!selectionHasGroupedBoxes(pendingOverrides, selectedColumns)) return
    const next = ungroupBoxes(pendingOverrides, selectedColumns)
    commit(next, { reason: '布局面板（解组）', previewLight: true })
  })

  btnCopyProps?.addEventListener('click', () => {
    if (selectedColumns.length === 0) return
    formatPainterTargets = selectedColumns.map((col) => resolveBoxId(col, pendingOverrides))
    options.onStartPropertyPick?.(formatPainterTargets, (sourceBoxId) => {
      openFormatPainterDialog(sourceBoxId)
    })
  })

  if (dockFontPropsGroup) {
    const panelScope = dockStackSlot || root
    mountCollapsiblePanels(panelScope)
    const reorderContainer = dockStackSlot
      || root.querySelector('[data-collapsible-reorder-group]')
      || root
    if (reorderContainer instanceof HTMLElement) {
      mountCollapsiblePanelReorder(reorderContainer, {
        storageKey: reorderStorageKey,
        legacyStorageKeys: dockStackSlot ? ['layout-preset-panel-dock-order'] : [],
      })
      mountCollapsiblePanelResize(reorderContainer, {
        storageKeyPrefix: dockStackSlot ? dockResizeStorageKeyPrefix : `${idPrefix || 'layout-'}dock-panel-`,
      })
    }
  }

  return {
    setOverrides(overrides) {
      pendingOverrides = { ...overrides }
      syncButtons()
    },
    refreshFontCatalog() {
      refreshFontSourceOptions()
    },
    selectColumn(column) {
      selectedColumns = column ? [column] : []
      syncButtons()
    },
    selectColumns(columns) {
      selectedColumns = columns ? [...columns] : []
      syncButtons()
    },
    getSelectedColumn() {
      return selectedColumns[0] ?? null
    },
    getSelectedColumns() {
      return [...selectedColumns]
    },
    refreshHistoryButtons: syncHistoryButtons,
    refreshColorSwatches: syncColorSwatches,
    setOverlayVisual({ showBorder, showHandles } = {}) {
      if (overlayBorderInput && showBorder != null) overlayBorderInput.checked = !!showBorder
      if (overlayHandlesInput && showHandles != null) overlayHandlesInput.checked = !!showHandles
    },
    cancelPropertyPick() {
      formatPainterTargets = []
      options.onCancelPropertyPick?.()
    },
    destroy() {
      formatPainterDialog?.remove()
      formatPainterDialog = null
      alignHGroup.removeEventListener('click', onAlignClick)
      alignVGroup.removeEventListener('click', onAlignClick)
      textFitGroup.removeEventListener('click', onAlignClick)
      boxAlignGrid.removeEventListener('click', onBoxOpClick)
      boxDistributeRow.removeEventListener('click', onBoxOpClick)
      clearTimeout(fontTimer)
      clearTimeout(lineHeightTimer)
      clearTimeout(letterSpacingTimer)
      clearTimeout(textScaleXTimer)
      clearTimeout(boundsTimer)
    },
  }
}
