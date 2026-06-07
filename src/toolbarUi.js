/** @type {Record<string, string>} */
const ICONS = {
  undo: '<path d="M9 7H5v4"/><path d="M5 11c1.5-3 4-5 7-5 4 0 7 3 7 7s-3 7-7 7"/>',
  redo: '<path d="M15 7h4v4"/><path d="M19 11c-1.5-3-4-5-7-5-4 0-7 3-7 7s3 7 7 7"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M16 16l4 4"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M16 16l4 4"/>',
  zoomFit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path d="M9 9l6 6"/>',
  zoomReset: '<path d="M12 8v8M8 12h8"/><circle cx="12" cy="12" r="9"/>',
  pan: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="M8 8l8 8M16 8l-8 8"/>',
  box: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  boxAdd: '<path d="M12 8v8M8 12h8"/><rect x="4" y="6" width="16" height="12" rx="1"/>',
  boxDel: '<path d="M8 12h8"/><rect x="4" y="6" width="16" height="12" rx="1"/>',
  rename: '<path d="M4 18h4l9-9-4-4-9 9v4z"/><path d="M13 5l4 4"/>',
  layerRef: '<path d="M4 8l8-4 8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  layerTpl: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  reset: '<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M5 19a8 8 0 0 0 14-2"/><path d="M19 5a8 8 0 0 0-14 2"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 11a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1"/>',
  export: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 18h16"/>',
  import: '<path d="M12 14V4M8 8l4-4 4 4"/><path d="M4 18h16"/>',
  fontSize: '<path d="M4 18V6h4"/><path d="M14 18V6h4"/><path d="M9 14h6"/>',
  lineHeight: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  font: '<path d="M6 18V6h4l4 12"/><path d="M14 6h6"/>',
  bounds: '<path d="M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z"/>',
  alignLeft: '<path d="M4 5v14M8 8h10M8 12h6"/>',
  alignCenterH: '<path d="M12 5v14M8 9h8M7 13h10"/>',
  alignRight: '<path d="M20 5v14M16 8H6M16 12h6"/>',
  alignTop: '<path d="M5 4h14M8 8v10M12 8v6"/>',
  alignCenterV: '<path d="M5 12h14M8 7v10M12 9v6"/>',
  alignBottom: '<path d="M5 20h14M8 6v10M12 8v8"/>',
  alignLabel: '<path d="M7 7h2v10H7zM15 7h2v6h-2z"/>',
  /* 编辑框对齐：参考线 + 矩形块 */
  boxHLeft: '<path d="M5 4v16"/><rect x="8" y="6" width="11" height="4" rx="0.5" fill="currentColor" stroke="none"/><rect x="8" y="14" width="7" height="4" rx="0.5" fill="currentColor" stroke="none"/>',
  boxHCenter: '<path d="M12 4v16"/><rect x="6.5" y="6" width="11" height="4" rx="0.5" fill="currentColor" stroke="none"/><rect x="8.5" y="14" width="7" height="4" rx="0.5" fill="currentColor" stroke="none"/>',
  boxHRight: '<path d="M19 4v16"/><rect x="5" y="6" width="11" height="4" rx="0.5" fill="currentColor" stroke="none"/><rect x="9" y="14" width="7" height="4" rx="0.5" fill="currentColor" stroke="none"/>',
  boxVTop: '<path d="M4 5h16"/><rect x="6" y="8" width="4" height="8" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="8" width="4" height="12" rx="0.5" fill="currentColor" stroke="none"/>',
  boxVCenter: '<path d="M4 12h16"/><rect x="6" y="8" width="4" height="8" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="6" width="4" height="12" rx="0.5" fill="currentColor" stroke="none"/>',
  boxVBottom: '<path d="M4 19h16"/><rect x="6" y="8" width="4" height="8" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="12" rx="0.5" fill="currentColor" stroke="none"/>',
  /* 文字水平对齐：左参考线 + 多行横线（左/中/右对齐） */
  textHLeft: '<path stroke-width="1" d="M4 6v12"/><path stroke-width="1" d="M6 8h11"/><path stroke-width="1" d="M6 11h8"/><path stroke-width="1" d="M6 14h9"/><path stroke-width="1" d="M6 17h6"/>',
  textHCenter: '<path stroke-width="1" d="M12 6v12"/><path stroke-width="1" d="M6 8h12"/><path stroke-width="1" d="M8 11h8"/><path stroke-width="1" d="M7 14h10"/><path stroke-width="1" d="M9 17h6"/>',
  textHRight: '<path stroke-width="1" d="M20 6v12"/><path stroke-width="1" d="M7 8h11"/><path stroke-width="1" d="M10 11h8"/><path stroke-width="1" d="M9 14h9"/><path stroke-width="1" d="M13 17h6"/>',
  /* 文字垂直对齐：顶/中/底参考线 + 竖条（顶/中/底对齐） */
  textVTop: '<path stroke-width="1" d="M4 6h16"/><path stroke-width="1" d="M7 6v5"/><path stroke-width="1" d="M11 6v7"/><path stroke-width="1" d="M15 6v4"/><path stroke-width="1" d="M19 6v3"/>',
  textVCenter: '<path stroke-width="1" d="M4 12h16"/><path stroke-width="1" d="M7 9v6"/><path stroke-width="1" d="M11 8v8"/><path stroke-width="1" d="M15 9v5"/><path stroke-width="1" d="M19 10v4"/>',
  textVBottom: '<path stroke-width="1" d="M4 18h16"/><path stroke-width="1" d="M7 13v5"/><path stroke-width="1" d="M11 11v7"/><path stroke-width="1" d="M15 14v4"/><path stroke-width="1" d="M19 16v2"/>',
  wrap: '<path d="M6 6h12v4H6zM6 14h8v4H6z"/>',
  shrink: '<path d="M6 8h10M6 12h6"/><path d="M18 8l-2 2 2 2"/>',
  distributeH: '<rect x="3" y="6" width="5" height="12" rx="1" fill="currentColor" stroke="none"/><line x1="10" y1="5" x2="10" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="11" y="6" width="5" height="12" rx="1" fill="currentColor" stroke="none"/><line x1="18" y1="5" x2="18" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="19" y="6" width="5" height="12" rx="1" fill="currentColor" stroke="none"/><line x1="26" y1="5" x2="26" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  distributeV: '<rect x="6" y="3" width="12" height="5" rx="1" fill="currentColor" stroke="none"/><line x1="5" y1="10" x2="19" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="6" y="11" width="12" height="5" rx="1" fill="currentColor" stroke="none"/><line x1="5" y1="18" x2="19" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="6" y="19" width="12" height="5" rx="1" fill="currentColor" stroke="none"/><line x1="5" y1="26" x2="19" y2="26" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  svg: '<path d="M4 4h16v16H4z"/><path d="M8 16l4-8 4 8"/>',
  table: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 10h16M10 6v12"/>',
  customBox: '<path d="M12 8v8M8 12h8"/><rect x="5" y="7" width="14" height="10" rx="1"/>',
}

const ALIGN_H_ICON = {
  left: 'textHLeft',
  center: 'textHCenter',
  right: 'textHRight',
}

const ALIGN_V_ICON = {
  top: 'textVTop',
  center: 'textVCenter',
  bottom: 'textVBottom',
}

const TEXT_ALIGN_H_TOOLTIPS = {
  left: '文字水平左对齐',
  center: '文字水平中对齐',
  right: '文字水平右对齐',
}

const TEXT_ALIGN_V_TOOLTIPS = {
  top: '文字垂直顶对齐',
  center: '文字垂直中对齐',
  bottom: '文字垂直底对齐',
}

const TEXT_FIT_ICON = {
  wrap: 'wrap',
  shrink: 'shrink',
}

const BOX_ALIGN_ICON = {
  left: 'boxHLeft',
  'center-h': 'boxHCenter',
  right: 'boxHRight',
  top: 'boxVTop',
  'center-v': 'boxVCenter',
  bottom: 'boxVBottom',
}

const BOX_ALIGN_TOOLTIPS = {
  left: '水平左对齐',
  'center-h': '水平中对齐',
  right: '水平右对齐',
  top: '垂直顶对齐',
  'center-v': '垂直中对齐',
  bottom: '垂直底对齐',
}

const BOX_DIST_ICON = {
  horizontal: 'distributeH',
  vertical: 'distributeV',
}

/**
 * @param {string} name
 * @param {number} [size]
 */
export function toolbarIcon(name, size = 16, strokeWidth = 1.75) {
  const body = ICONS[name]
  if (!body) return ''
  return `<svg class="tb-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/**
 * @param {{
 *   id?: string,
 *   icon?: string,
 *   label?: string,
 *   title?: string,
 *   className?: string,
 *   disabled?: boolean,
 *   type?: string,
 *   hidden?: boolean,
 *   toggle?: boolean,
 *   dataset?: Record<string, string>,
 * }} opts
 */
export function toolbarBtnHtml(opts) {
  const {
    id,
    icon,
    label,
    title,
    className = '',
    disabled,
    type = 'button',
    hidden,
    toggle,
    dataset = {},
  } = opts
  const parts = ['tb-btn']
  if (toggle) parts.push('tb-btn--toggle')
  if (className) parts.push(className)
  const ds = Object.entries(dataset)
    .map(([k, v]) => ` data-${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('')
  const text = label || ''
  const iconHtml = icon ? toolbarIcon(icon) : ''
  const aria = title || label || ''
  return `<button type="${type}" class="${parts.join(' ')}"${id ? ` id="${id}"` : ''}${title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''}${aria ? ` aria-label="${aria.replace(/"/g, '&quot;')}"` : ''}${disabled ? ' disabled' : ''}${hidden ? ' hidden' : ''}${ds}>${iconHtml}${text}</button>`
}

export function toolbarSep() {
  return '<span class="tb-sep" role="separator" aria-hidden="true"></span>'
}

export function toolbarZoomGroupHtml({
  outId,
  inId,
  fitId,
  resetId,
  valueId,
  showReset = true,
  showPanId,
}) {
  let html = `<div class="tb-group tb-group--zoom" role="group" aria-label="缩放">`
  html += toolbarBtnHtml({ id: outId, label: '缩小', title: '缩小视图' })
  html += `<span class="tb-zoom-value" id="${valueId}">100%</span>`
  html += toolbarBtnHtml({ id: inId, label: '放大', title: '放大视图' })
  html += toolbarBtnHtml({ id: fitId, label: '适应', title: '适应窗口' })
  if (showReset && resetId) {
    html += toolbarBtnHtml({ id: resetId, label: '1:1', title: '100% 并居中' })
  }
  if (showPanId) {
    html += toolbarBtnHtml({
      id: showPanId,
      label: '平移',
      title: '抓手平移（空格或中键也可）',
      className: 'preview-pan-btn',
      toggle: true,
    })
  }
  html += '</div>'
  return html
}

export function toolbarLayerTogglesHtml({
  boxesId,
  referenceId,
  templateId,
  boxesChecked,
  templateChecked = true,
}) {
  return `<div class="tb-group tb-group--layers" role="group" aria-label="图层显示">
    <label class="tb-toggle" title="显示可拖拽的编辑框">
      <input type="checkbox" id="${boxesId}"${boxesChecked ? ' checked' : ''} />
      <span>编辑框</span>
    </label>
    <label class="tb-toggle" title="显示模板参考层（导出不含）">
      <input type="checkbox" id="${referenceId}" />
      <span>参考层</span>
    </label>
    <label class="tb-toggle" title="显示模板底图">
      <input type="checkbox" id="${templateId}"${templateChecked ? ' checked' : ''} />
      <span>底图</span>
    </label>
  </div>`
}

/**
 * @param {{ borderId?: string, handlesId?: string, borderChecked?: boolean, handlesChecked?: boolean }} [opts]
 */
export function toolbarOverlayVisualHtml(opts = {}) {
  const {
    borderId = 'layout-overlay-border',
    handlesId = 'layout-overlay-handles',
    borderChecked = true,
    handlesChecked = true,
    showTitle = true,
  } = opts
  return `<div class="tb-group tb-group--overlay-visual" role="group" aria-label="编辑框视图">
    ${showTitle ? '<span class="tb-group-title">视图</span>' : ''}
    <label class="tb-toggle" title="显示页面上全部编辑框的虚线边框（仅编辑时可见）"><input type="checkbox" id="${borderId}"${borderChecked ? ' checked' : ''} /><span>虚线框</span></label>
    <label class="tb-toggle" title="显示页面上全部编辑框的拖拽缩放点（仅编辑时可见）"><input type="checkbox" id="${handlesId}"${handlesChecked ? ' checked' : ''} /><span>角点</span></label>
  </div>`
}

/**
 * @param {HTMLElement} container
 * @param {string[]} values
 * @param {Record<string, string>} tooltips
 * @param {Record<string, string>} iconMap
 * @param {string} axis
 * @param {string} extraClass
 * @param {{ iconStrokeWidth?: number }} [opts]
 */
export function mountToolbarToggleGroup(container, values, tooltips, iconMap, axis, extraClass = '', opts = {}) {
  const iconStrokeWidth = opts.iconStrokeWidth ?? 1.75
  container.innerHTML = ''
  container.className = `tb-toggle-group ${extraClass}`.trim()
  for (const value of values) {
    const tip = tooltips[value] || value
    const iconName = iconMap[value]
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tb-btn tb-btn--toggle tb-btn--icon layout-align-btn'
    btn.dataset.axis = axis
    btn.dataset.value = value
    btn.title = tip
    btn.setAttribute('aria-label', tip)
    if (iconName) btn.innerHTML = toolbarIcon(iconName, 16, iconStrokeWidth)
    container.appendChild(btn)
  }
}

export function mountBoxOpButtons(boxAlignGrid, boxDistributeRow) {
  boxAlignGrid.innerHTML = ''
  boxAlignGrid.className = 'tb-toggle-group layout-box-align-grid layout-box-align-grid--inline'
  for (const id of ['left', 'center-h', 'right', 'top', 'center-v', 'bottom']) {
    const tip = BOX_ALIGN_TOOLTIPS[id] || id
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tb-btn tb-btn--toggle tb-btn--icon layout-box-op-btn'
    btn.dataset.op = 'align'
    btn.dataset.value = id
    btn.title = tip
    btn.setAttribute('aria-label', tip)
    btn.innerHTML = toolbarIcon(BOX_ALIGN_ICON[id])
    boxAlignGrid.appendChild(btn)
  }

  boxDistributeRow.innerHTML = ''
  boxDistributeRow.className = 'tb-toggle-group layout-box-distribute-row'
  for (const { id, label, icon } of [
    { id: 'horizontal', label: '水平均匀分布', icon: 'distributeH' },
    { id: 'vertical', label: '垂直均匀分布', icon: 'distributeV' },
  ]) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tb-btn tb-btn--toggle tb-btn--icon layout-box-op-btn'
    btn.dataset.op = 'distribute'
    btn.dataset.value = id
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.innerHTML = toolbarIcon(icon)
    boxDistributeRow.appendChild(btn)
  }
}

export {
  ALIGN_H_ICON,
  ALIGN_V_ICON,
  TEXT_FIT_ICON,
  TEXT_ALIGN_H_TOOLTIPS,
  TEXT_ALIGN_V_TOOLTIPS,
  BOX_ALIGN_ICON,
  BOX_ALIGN_TOOLTIPS,
}
