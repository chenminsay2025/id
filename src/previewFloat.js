import { normalizeRowHeightsMap } from './rowHeightUtils.js'
const MIN_FLOAT_H = 240
const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** @returns {{ mode: 'docked'|'floating', float: { x: number, y: number, w: number, h: number }|null, dock: { tableHeight: number|null } }} */
export function defaultPreviewUi() {
  return {
    mode: 'docked',
    float: null,
    dock: { tableHeight: null },
    rowHeights: {},
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max))
}

function computeDefaultFloatRect() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = clamp(Math.round(vw * 0.46), MIN_FLOAT_W, vw - 32)
  const h = clamp(Math.round(vh * 0.52), MIN_FLOAT_H, vh - 80)
  return {
    x: Math.max(16, Math.round((vw - w) / 2)),
    y: Math.max(56, Math.round((vh - h) / 2)),
    w,
    h,
  }
}

export function normalizePreviewUi(raw) {
  const base = defaultPreviewUi()
  if (!raw || typeof raw !== 'object') return base
  const mode = raw.mode === 'floating' ? 'floating' : 'docked'
  let float = null
  if (raw.float && typeof raw.float === 'object') {
    const x = Number(raw.float.x)
    const y = Number(raw.float.y)
    const w = Number(raw.float.w)
    const h = Number(raw.float.h)
    if ([x, y, w, h].every((n) => Number.isFinite(n) && n > 0)) {
      float = {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      }
    }
  }
  const dockHeight = Number(raw.dock?.tableHeight)
  return {
    mode,
    float,
    dock: {
      tableHeight: Number.isFinite(dockHeight) && dockHeight > 0 ? Math.round(dockHeight) : null,
    },
    rowHeights: normalizeRowHeightsMap(raw.rowHeights),
  }
}

/**
 * @param {{
 *   panel: HTMLElement,
 *   splitHandle?: HTMLElement|null,
 *   isEnabled: () => boolean,
 *   onChange?: (ui: ReturnType<typeof defaultPreviewUi>) => void,
 * }} options
 */
export function mountPreviewFloat(options) {
  const { panel, splitHandle = null, isEnabled, onChange } = options
  const header = panel.querySelector('.panel-header--svg')
  const titleEl = panel.querySelector('.panel-header-title')
  const toggleBtn = document.getElementById('btn-preview-float-toggle')
  const previewArea = panel.querySelector('#preview-area')

  /** @type {ReturnType<typeof defaultPreviewUi>} */
  let state = defaultPreviewUi()
  let notifyTimer = 0
  let dragSession = null
  let resizeSession = null

  const resizeLayer = document.createElement('div')
  resizeLayer.className = 'preview-float-resize-layer'
  resizeLayer.setAttribute('aria-hidden', 'true')
  for (const edge of RESIZE_EDGES) {
    const h = document.createElement('div')
    h.className = `preview-float-resize-handle preview-float-resize-handle--${edge}`
    h.dataset.edge = edge
    resizeLayer.appendChild(h)
  }
  panel.appendChild(resizeLayer)

  function notifyChange() {
    clearTimeout(notifyTimer)
    notifyTimer = window.setTimeout(() => {
      onChange?.(getState())
    }, 200)
  }

  function notifyChangeImmediate() {
    clearTimeout(notifyTimer)
    onChange?.(getState())
  }

  function ensureFloatRect() {
    if (!state.float) state.float = computeDefaultFloatRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    state.float.w = clamp(state.float.w, MIN_FLOAT_W, vw - 16)
    state.float.h = clamp(state.float.h, MIN_FLOAT_H, vh - 16)
    state.float.x = clamp(state.float.x, 0, Math.max(0, vw - state.float.w))
    state.float.y = clamp(state.float.y, 0, Math.max(0, vh - state.float.h))
  }

  function applyFloatStyles() {
    ensureFloatRect()
    panel.style.left = `${state.float.x}px`
    panel.style.top = `${state.float.y}px`
    panel.style.width = `${state.float.w}px`
    panel.style.height = `${state.float.h}px`
  }

  function clearFloatStyles() {
    panel.style.left = ''
    panel.style.top = ''
    panel.style.width = ''
    panel.style.height = ''
  }

  function updateToggleUi() {
    const floating = state.mode === 'floating'
    document.body.classList.toggle('preview-floating', floating && isEnabled())
    panel.classList.toggle('preview-panel--floating', floating && isEnabled())
    if (splitHandle) splitHandle.hidden = floating && isEnabled()
    if (toggleBtn) {
      toggleBtn.textContent = floating ? '固定' : '浮动'
      toggleBtn.title = floating ? '固定到下方预览区' : '变为可拖拽浮动窗口'
      toggleBtn.setAttribute('aria-pressed', floating ? 'true' : 'false')
    }
    if (titleEl) {
      titleEl.title = isEnabled()
        ? (floating ? '双击或点击「固定」回到下方预览区' : '双击预览区或点击「浮动」变为弹窗')
        : ''
    }
  }

  function applyState() {
    if (!isEnabled()) {
      document.body.classList.remove('preview-floating')
      panel.classList.remove('preview-panel--floating')
      clearFloatStyles()
      if (splitHandle) splitHandle.hidden = false
      return
    }
    updateToggleUi()
    if (state.mode === 'floating') {
      applyFloatStyles()
    } else {
      clearFloatStyles()
      window.__CAT_EDITOR_SPLIT__?.restore?.()
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }

  function setMode(mode, { immediate = false } = {}) {
    if (mode === 'floating' && !state.float) state.float = computeDefaultFloatRect()
    state.mode = mode === 'floating' ? 'floating' : 'docked'
    applyState()
    if (immediate) notifyChangeImmediate()
    else notifyChange()
  }

  function toggleMode() {
    if (!isEnabled()) return
    setMode(state.mode === 'floating' ? 'docked' : 'floating', { immediate: true })
  }

  function getState() {
    return structuredClone(state)
  }

  function setState(next) {
    state = normalizePreviewUi(next)
    applyState()
  }

  function setDockHeight(px, { notify = true } = {}) {
    const h = Math.round(Number(px))
    if (!Number.isFinite(h) || h <= 0) return
    state.dock.tableHeight = h
    if (notify) notifyChange()
  }

  function onDragMove(clientX, clientY) {
    if (!dragSession) return
    const dx = clientX - dragSession.x
    const dy = clientY - dragSession.y
    if (!state.float) state.float = computeDefaultFloatRect()
    state.float.x = dragSession.left + dx
    state.float.y = dragSession.top + dy
    applyFloatStyles()
  }

  function onResizeMove(clientX, clientY) {
    if (!resizeSession || !state.float) return
    const { edge, startX, startY, rect } = resizeSession
    let { x, y, w, h } = { ...rect }
    const dx = clientX - startX
    const dy = clientY - startY

    if (edge.includes('e')) w = rect.w + dx
    if (edge.includes('w')) {
      w = rect.w - dx
      x = rect.x + dx
    }
    if (edge.includes('s')) h = rect.h + dy
    if (edge.includes('n')) {
      h = rect.h - dy
      y = rect.y + dy
    }

    if (w < MIN_FLOAT_W) {
      if (edge.includes('w')) x -= MIN_FLOAT_W - w
      w = MIN_FLOAT_W
    }
    if (h < MIN_FLOAT_H) {
      if (edge.includes('n')) y -= MIN_FLOAT_H - h
      h = MIN_FLOAT_H
    }

    state.float = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
    ensureFloatRect()
    applyFloatStyles()
  }

  function stopSessions(persist = false) {
    const wasActive = !!(dragSession || resizeSession)
    dragSession = null
    resizeSession = null
    document.body.classList.remove('preview-float-dragging', 'preview-float-resizing')
    if (persist && wasActive) notifyChange()
  }

  header?.addEventListener('mousedown', (e) => {
    if (!isEnabled() || state.mode !== 'floating') return
    if (e.button !== 0) return
    if (e.target.closest('button, input, label, .preview-toolbar, .preview-float-resize-handle')) return
    if (!state.float) state.float = computeDefaultFloatRect()
    dragSession = {
      x: e.clientX,
      y: e.clientY,
      left: state.float.x,
      top: state.float.y,
    }
    document.body.classList.add('preview-float-dragging')
    e.preventDefault()
  })

  resizeLayer.addEventListener('mousedown', (e) => {
    if (!isEnabled() || state.mode !== 'floating') return
    const handle = e.target.closest('.preview-float-resize-handle')
    if (!handle) return
    if (!state.float) state.float = computeDefaultFloatRect()
    resizeSession = {
      edge: handle.dataset.edge || 'se',
      startX: e.clientX,
      startY: e.clientY,
      rect: { ...state.float },
    }
    document.body.classList.add('preview-float-resizing')
    e.preventDefault()
    e.stopPropagation()
  })

  window.addEventListener('mousemove', (e) => {
    if (dragSession) onDragMove(e.clientX, e.clientY)
    if (resizeSession) onResizeMove(e.clientX, e.clientY)
  })
  window.addEventListener('mouseup', () => stopSessions(true))

  titleEl?.addEventListener('click', (e) => {
    if (!isEnabled()) return
    e.preventDefault()
    toggleMode()
  })

  toggleBtn?.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    toggleMode()
  })

  previewArea?.addEventListener('dblclick', (e) => {
    if (!isEnabled()) return
    if (e.target.closest('button, input, label, a')) return
    toggleMode()
  })

  window.addEventListener('resize', () => {
    if (!isEnabled() || state.mode !== 'floating') return
    applyFloatStyles()
  })

  applyState()

  return {
    getState,
    setState,
    setDockHeight,
    setMode,
    toggleMode,
    applyState,
  }
}
