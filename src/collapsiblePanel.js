/**
 * @param {{ panelId: string, title: string, content: string, panelClass?: string, metaHtml?: string, expanded?: boolean, storageKey?: string, reorderId?: string }} opts
 */
export function collapsiblePanelHtml({
  panelId,
  title,
  content,
  panelClass = '',
  metaHtml = '',
  expanded = true,
  storageKey = '',
  reorderId = '',
}) {
  const toggleId = `${panelId}-toggle`
  const collapseId = `${panelId}-collapse`
  const storageAttr = storageKey ? ` data-collapsible-storage="${storageKey}"` : ''
  const reorderAttr = reorderId ? ` data-collapsible-reorder-id="${reorderId}"` : ''
  const dragHandle = reorderId
    ? '<span class="layout-collapsible-panel-drag" aria-hidden="true" title="拖拽排序">⠿</span>'
    : ''
  return `
    <div class="layout-collapsible-panel ${panelClass}" id="${panelId}" data-collapsible-panel${storageAttr}${reorderAttr}>
      <button
        type="button"
        class="layout-collapsible-panel-toggle"
        id="${toggleId}"
        aria-expanded="${expanded ? 'true' : 'false'}"
        aria-controls="${collapseId}"
      >
        ${dragHandle}
        <span class="layout-collapsible-panel-chevron" aria-hidden="true">▾</span>
        <span class="layout-collapsible-panel-title">${title}</span>
        ${metaHtml}
      </button>
      <div class="layout-collapsible-panel-collapse" id="${collapseId}">
        ${content}
      </div>
      <div
        class="layout-collapsible-panel-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖拽调整高度"
        title="拖拽调整高度"
      ></div>
    </div>`
}

/**
 * @param {ParentNode} scope
 * @param {{ storageKeyPrefix?: string }} [opts]
 */
export function mountCollapsiblePanels(scope, { storageKeyPrefix = '' } = {}) {
  scope.querySelectorAll('[data-collapsible-panel]').forEach((panelEl) => {
    if (panelEl.dataset.collapsibleMounted === '1') return
    panelEl.dataset.collapsibleMounted = '1'

    const toggleEl = panelEl.querySelector('.layout-collapsible-panel-toggle')
    const customKey = panelEl.dataset.collapsibleStorage
    const storageKey = customKey || `${storageKeyPrefix}${panelEl.id}-collapsed`

    function setCollapsed(collapsed) {
      panelEl.classList.toggle('is-collapsed', collapsed)
      toggleEl?.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
      const collapseEl = panelEl.querySelector('.layout-collapsible-panel-collapse')
      if (collapsed && collapseEl instanceof HTMLElement) {
        collapseEl.style.height = ''
        collapseEl.style.maxHeight = ''
        collapseEl.style.minHeight = ''
        collapseEl.style.flex = ''
        collapseEl.style.overflow = ''
        collapseEl.style.overflowY = ''
      }
      try {
        localStorage.setItem(storageKey, collapsed ? '1' : '0')
      } catch { /* ignore */ }
    }

    try {
      setCollapsed(localStorage.getItem(storageKey) === '1')
    } catch {
      setCollapsed(false)
    }

    toggleEl?.addEventListener('click', (e) => {
      if (e.target.closest('.layout-collapsible-panel-drag')) return
      setCollapsed(panelEl.classList.contains('is-collapsed') ? false : true)
    })
  })
}

/** @param {HTMLElement} container */
function getReorderableItems(container) {
  return [...container.children].filter((el) => el.dataset.collapsibleReorderId)
}

/** @param {HTMLElement} container */
function saveReorderOrder(container, storageKey) {
  const order = getReorderableItems(container).map((el) => el.dataset.collapsibleReorderId)
  try {
    localStorage.setItem(storageKey, JSON.stringify(order))
  } catch { /* ignore */ }
}

function isReorderAnchorEl(el) {
  if (!(el instanceof HTMLElement)) return false
  if (el.dataset.collapsibleReorderId) return false
  if (el.dataset.reorderPlaceholder === '1') return false
  if (el.hidden) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  return true
}

function getReorderInsertAnchor(container) {
  return [...container.children].find((el) => isReorderAnchorEl(el)) || null
}

/**
 * @param {string} orderStorageKey
 * @param {string[]} legacyKeys
 */
function mergeLegacyReorderOrders(orderStorageKey, legacyKeys = []) {
  try {
    const existingRaw = localStorage.getItem(orderStorageKey)
    const existing = existingRaw ? JSON.parse(existingRaw) : null
    const merged = Array.isArray(existing) ? existing.map(String) : []
    for (const legacyKey of legacyKeys) {
      if (!legacyKey || legacyKey === orderStorageKey) continue
      const raw = localStorage.getItem(legacyKey)
      if (!raw) continue
      const part = JSON.parse(raw)
      if (!Array.isArray(part)) continue
      for (const id of part.map(String)) {
        if (!merged.includes(id)) merged.push(id)
      }
    }
    if (merged.length) {
      localStorage.setItem(orderStorageKey, JSON.stringify(merged))
    }
  } catch { /* ignore */ }
}

/**
 * @param {HTMLElement} container
 * @param {string[]} orderIds
 */
function applyReorderOrder(container, orderIds) {
  const items = getReorderableItems(container)
  const map = new Map(items.map((el) => [el.dataset.collapsibleReorderId, el]))
  const anchor = getReorderInsertAnchor(container)
  for (const id of orderIds) {
    const el = map.get(id)
    if (el) container.insertBefore(el, anchor)
  }
  for (const el of items) {
    if (!orderIds.includes(el.dataset.collapsibleReorderId)) {
      container.insertBefore(el, anchor)
    }
  }
}

function isReorderDragActive() {
  return document.body.classList.contains('layout-collapsible-reorder-active')
}

/** @param {HTMLElement} beforeEl */
function reorderPlaceholderKey(beforeEl) {
  if (!beforeEl) return '__end__'
  return beforeEl.dataset.collapsibleReorderId || '__unknown__'
}

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} panelEl
 * @param {string} orderStorageKey
 */
function mountReorderGrip(container, panelEl, orderStorageKey) {
  const grip = panelEl.querySelector('.layout-collapsible-panel-drag')
  if (!grip || grip.dataset.reorderGripMounted === '1') return
  grip.dataset.reorderGripMounted = '1'

  grip.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const pointerId = e.pointerId
    try {
      grip.setPointerCapture(pointerId)
    } catch { /* ignore */ }

    let moved = false
    let finished = false
    let rafId = 0
    let pendingY = e.clientY
    let lastPlaceholderBefore = null

    const startRect = panelEl.getBoundingClientRect()
    const offsetY = e.clientY - startRect.top

    const placeholder = document.createElement('div')
    placeholder.className = 'layout-collapsible-reorder-placeholder'
    placeholder.style.height = `${Math.round(startRect.height)}px`
    placeholder.dataset.reorderPlaceholder = '1'
    container.insertBefore(placeholder, panelEl)

    const restoreStyles = {
      position: panelEl.style.position,
      top: panelEl.style.top,
      left: panelEl.style.left,
      width: panelEl.style.width,
      zIndex: panelEl.style.zIndex,
      margin: panelEl.style.margin,
      pointerEvents: panelEl.style.pointerEvents,
    }

    panelEl.classList.add('is-reorder-dragging')
    document.body.classList.add('layout-collapsible-reorder-active')
    panelEl.style.position = 'fixed'
    panelEl.style.left = `${startRect.left}px`
    panelEl.style.top = `${startRect.top}px`
    panelEl.style.width = `${startRect.width}px`
    panelEl.style.zIndex = '50'
    panelEl.style.margin = '0'
    panelEl.style.pointerEvents = 'none'

    function movePlaceholder(clientY) {
      const items = getReorderableItems(container).filter((el) => el !== panelEl)
      let beforeEl = null

      for (const sib of items) {
        const sibRect = sib.getBoundingClientRect()
        if (sibRect.height <= 0) continue
        const mid = sibRect.top + sibRect.height / 2
        if (clientY < mid) {
          beforeEl = sib
          break
        }
      }

      const key = reorderPlaceholderKey(beforeEl)
      if (key === lastPlaceholderBefore) return
      lastPlaceholderBefore = key

      if (beforeEl) {
        container.insertBefore(placeholder, beforeEl)
      } else {
        container.insertBefore(placeholder, getReorderInsertAnchor(container))
      }
    }

    function applyDragFrame(clientY) {
      panelEl.style.top = `${clientY - offsetY}px`
      panelEl.style.left = `${startRect.left}px`
      movePlaceholder(clientY)
    }

    function onMove(ev) {
      if (finished || ev.pointerId !== pointerId) return
      ev.preventDefault()
      moved = true
      pendingY = ev.clientY
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        applyDragFrame(pendingY)
      })
    }

    function finish(ev) {
      if (finished) return
      if (ev && ev.pointerId !== pointerId) return
      finished = true

      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }

      try {
        grip.releasePointerCapture(pointerId)
      } catch { /* ignore */ }

      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', finish, true)
      document.removeEventListener('pointercancel', finish, true)

      container.insertBefore(panelEl, placeholder)
      placeholder.remove()

      panelEl.classList.remove('is-reorder-dragging')
      document.body.classList.remove('layout-collapsible-reorder-active')
      panelEl.style.position = restoreStyles.position
      panelEl.style.top = restoreStyles.top
      panelEl.style.left = restoreStyles.left
      panelEl.style.width = restoreStyles.width
      panelEl.style.zIndex = restoreStyles.zIndex
      panelEl.style.margin = restoreStyles.margin
      panelEl.style.pointerEvents = restoreStyles.pointerEvents

      if (moved) saveReorderOrder(container, orderStorageKey)
    }

    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', finish, true)
  })
}

/**
 * @param {HTMLElement} container
 * @param {{ storageKey?: string }} [opts]
 */
export function mountCollapsiblePanelReorder(container, { storageKey = '', legacyStorageKeys = [] } = {}) {
  if (!container) return

  const orderStorageKey = storageKey || `${container.dataset.collapsibleReorderGroup || 'collapsible'}-order`

  if (container.dataset.collapsibleReorderMounted !== '1') {
    container.dataset.collapsibleReorderMounted = '1'
    mergeLegacyReorderOrders(orderStorageKey, legacyStorageKeys)
    try {
      const raw = localStorage.getItem(orderStorageKey)
      if (raw) {
        const order = JSON.parse(raw)
        if (Array.isArray(order)) applyReorderOrder(container, order.map(String))
      }
    } catch { /* ignore */ }
  } else if (legacyStorageKeys.length) {
    mergeLegacyReorderOrders(orderStorageKey, legacyStorageKeys)
    try {
      const raw = localStorage.getItem(orderStorageKey)
      if (raw) {
        const order = JSON.parse(raw)
        if (Array.isArray(order)) applyReorderOrder(container, order.map(String))
      }
    } catch { /* ignore */ }
  }

  getReorderableItems(container).forEach((panelEl) => {
    mountReorderGrip(container, panelEl, orderStorageKey)
  })
}

/** @param {ParentNode} scope */
function collectCollapsibleReorderContainers(scope) {
  const containers = []
  if (scope instanceof HTMLElement && scope.dataset.collapsibleReorderGroup) {
    containers.push(scope)
  }
  scope.querySelectorAll('[data-collapsible-reorder-group]').forEach((el) => {
    if (!containers.includes(el)) containers.push(el)
  })
  return containers
}

/**
 * @param {ParentNode} scope
 * @param {{ storageKeys?: Record<string, string>, minHeight?: number }} [opts]
 */
export function mountCollapsiblePanelResizeGroups(scope, { storageKeys = {}, minHeight = 56 } = {}) {
  collectCollapsibleReorderContainers(scope).forEach((container) => {
    const group = container.dataset.collapsibleReorderGroup || ''
    mountCollapsiblePanelResize(container, {
      storageKeyPrefix: storageKeys[group] || `${group}-panel-`,
      minHeight,
    })
  })
}

const DEFAULT_COLLAPSE_MIN_HEIGHT = 56

/** @param {HTMLElement} collapseEl */
function getPanelScrollTargets(collapseEl) {
  const targets = [collapseEl]
  collapseEl.querySelectorAll('[data-collapsible-resize-body], .layout-layers-list').forEach((el) => {
    if (el instanceof HTMLElement) targets.push(el)
  })
  return targets
}

/** @param {HTMLElement[]} targets */
function saveScrollPositions(targets) {
  return targets.map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }))
}

/** @param {{ el: HTMLElement, top: number, left: number }[]} saved */
function restoreScrollPositions(saved) {
  saved.forEach(({ el, top, left }) => {
    el.scrollTop = top
    el.scrollLeft = left
  })
}

/** @param {HTMLElement} collapseEl */
function measureCollapseNaturalHeight(collapseEl) {
  if (!collapseEl) return 0

  const savedScroll = saveScrollPositions(getPanelScrollTargets(collapseEl))

  collapseEl.classList.add('layout-collapsible-panel-collapse--measure-natural')
  const natural = collapseEl.scrollHeight
  collapseEl.classList.remove('layout-collapsible-panel-collapse--measure-natural')

  restoreScrollPositions(savedScroll)
  return natural
}

function clearPanelCollapseInlineSize(collapseEl) {
  collapseEl.style.height = ''
  collapseEl.style.maxHeight = ''
  collapseEl.style.minHeight = ''
  collapseEl.style.flex = ''
  collapseEl.style.overflow = ''
  collapseEl.style.overflowY = ''
}

/**
 * @param {HTMLElement} panelEl
 * @param {HTMLElement} collapseEl
 * @param {number} height
 * @param {number} naturalHeight
 * @param {number} minHeight
 */
function applyPanelCollapseHeight(panelEl, collapseEl, height, naturalHeight, minHeight) {
  const isAuto = height >= naturalHeight - 1
  if (isAuto) {
    if (!panelEl.classList.contains('is-height-resized') && !collapseEl.style.height) {
      panelEl.dataset.collapseHeight = 'auto'
      return
    }
    const savedScroll = saveScrollPositions(getPanelScrollTargets(collapseEl))
    clearPanelCollapseInlineSize(collapseEl)
    panelEl.classList.remove('is-height-resized')
    panelEl.dataset.collapseHeight = 'auto'
    restoreScrollPositions(savedScroll)
    return
  }

  const clamped = Math.max(minHeight, Math.min(height, naturalHeight))
  const rounded = Math.round(clamped)
  const px = `${rounded}px`
  if (
    panelEl.classList.contains('is-height-resized')
    && panelEl.dataset.collapseHeight === String(rounded)
    && collapseEl.style.height === px
  ) {
    return
  }

  const savedScroll = saveScrollPositions(getPanelScrollTargets(collapseEl))

  collapseEl.style.height = px
  collapseEl.style.maxHeight = px
  collapseEl.style.minHeight = '0'
  collapseEl.style.flex = '0 0 auto'
  if (panelEl.classList.contains('layout-layers-panel')) {
    collapseEl.style.overflow = 'hidden'
    collapseEl.style.overflowY = 'hidden'
  } else {
    collapseEl.style.overflow = 'hidden'
    collapseEl.style.overflowY = 'auto'
  }
  panelEl.classList.add('is-height-resized')
  panelEl.dataset.collapseHeight = String(rounded)

  restoreScrollPositions(savedScroll)
}

/**
 * @param {ParentNode} scope
 * @param {{ storageKeyPrefix?: string, minHeight?: number }} [opts]
 */
export function mountCollapsiblePanelResize(scope, { storageKeyPrefix = '', minHeight = DEFAULT_COLLAPSE_MIN_HEIGHT } = {}) {
  scope.querySelectorAll('[data-collapsible-panel]').forEach((panelEl) => {
    if (!(panelEl instanceof HTMLElement)) return
    if (panelEl.dataset.collapsibleResizeMounted === '1') return
    panelEl.dataset.collapsibleResizeMounted = '1'

    const collapseEl = panelEl.querySelector('.layout-collapsible-panel-collapse')
    const resizeEl = panelEl.querySelector('.layout-collapsible-panel-resize')
    if (!(collapseEl instanceof HTMLElement) || !(resizeEl instanceof HTMLElement)) return

    const storageKey = `${storageKeyPrefix}${panelEl.id}-height`
    let naturalHeight = measureCollapseNaturalHeight(collapseEl)

    const syncResizeHandle = () => {
      resizeEl.hidden = panelEl.classList.contains('is-collapsed')
    }

    const isHeightInteractionActive = () => (
      panelEl.classList.contains('is-height-resizing')
    )

    const refreshNaturalHeight = () => {
      if (isHeightInteractionActive()) return
      if (panelEl.classList.contains('is-collapsed')) return
      naturalHeight = measureCollapseNaturalHeight(collapseEl)
      const current = panelEl.dataset.collapseHeight
      if (current && current !== 'auto') {
        const h = Number(current)
        if (Number.isFinite(h) && h > naturalHeight) {
          applyPanelCollapseHeight(panelEl, collapseEl, naturalHeight, naturalHeight, minHeight)
          try {
            localStorage.setItem(storageKey, 'auto')
          } catch { /* ignore */ }
        }
      }
    }

    const restoreSavedHeight = () => {
      if (isHeightInteractionActive()) return
      if (panelEl.classList.contains('is-collapsed')) return
      naturalHeight = measureCollapseNaturalHeight(collapseEl)
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved && saved !== 'auto') {
          const h = Number(saved)
          if (Number.isFinite(h)) {
            applyPanelCollapseHeight(panelEl, collapseEl, h, naturalHeight, minHeight)
            return
          }
        }
      } catch { /* ignore */ }
      applyPanelCollapseHeight(panelEl, collapseEl, naturalHeight, naturalHeight, minHeight)
    }

    if (panelEl.classList.contains('is-collapsed')) {
      clearPanelCollapseInlineSize(collapseEl)
      syncResizeHandle()
    } else {
      restoreSavedHeight()
      syncResizeHandle()
    }

    const classObserver = new MutationObserver(() => {
      syncResizeHandle()
      if (isReorderDragActive()) return
      if (panelEl.classList.contains('is-collapsed')) {
        clearPanelCollapseInlineSize(collapseEl)
        return
      }
      if (isHeightInteractionActive()) return
      requestAnimationFrame(restoreSavedHeight)
    })
    classObserver.observe(panelEl, { attributes: true, attributeFilter: ['class'] })

    const contentObserver = new ResizeObserver(() => {
      if (isReorderDragActive()) return
      if (panelEl.classList.contains('is-collapsed')) return
      if (isHeightInteractionActive()) return
      if (panelEl.classList.contains('is-height-resized')) return
      requestAnimationFrame(refreshNaturalHeight)
    })
    contentObserver.observe(collapseEl)

    let dragging = false
    let startY = 0
    let startHeight = 0

    resizeEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || panelEl.classList.contains('is-collapsed')) return
      e.preventDefault()
      e.stopPropagation()
      naturalHeight = measureCollapseNaturalHeight(collapseEl)
      startHeight = collapseEl.offsetHeight || collapseEl.getBoundingClientRect().height
      startY = e.clientY
      dragging = true
      panelEl.classList.add('is-height-resizing')
      document.body.classList.add('layout-collapsible-height-resizing')

      const onMove = (ev) => {
        if (!dragging) return
        ev.preventDefault()
        naturalHeight = measureCollapseNaturalHeight(collapseEl)
        const next = Math.max(minHeight, Math.min(startHeight + (ev.clientY - startY), naturalHeight))
        applyPanelCollapseHeight(panelEl, collapseEl, next, naturalHeight, minHeight)
      }

      const finishResize = () => {
        if (!dragging) return
        dragging = false
        panelEl.classList.remove('is-height-resizing')
        document.body.classList.remove('layout-collapsible-height-resizing')
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', finishResize, true)
        document.removeEventListener('pointercancel', finishResize, true)

        naturalHeight = measureCollapseNaturalHeight(collapseEl)
        const savedH = Number(panelEl.dataset.collapseHeight)
        if (Number.isFinite(savedH) && savedH > 0 && savedH < naturalHeight - 1) {
          applyPanelCollapseHeight(panelEl, collapseEl, savedH, naturalHeight, minHeight)
          try {
            localStorage.setItem(storageKey, String(Math.round(savedH)))
          } catch { /* ignore */ }
        } else {
          applyPanelCollapseHeight(panelEl, collapseEl, naturalHeight, naturalHeight, minHeight)
          try {
            localStorage.setItem(storageKey, 'auto')
          } catch { /* ignore */ }
        }
      }

      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', finishResize, true)
      document.addEventListener('pointercancel', finishResize, true)
    })

    panelEl.addEventListener('collapsible-panel:destroy', () => {
      classObserver.disconnect()
      contentObserver.disconnect()
    }, { once: true })
  })
}

/**
 * @param {ParentNode} scope
 * @param {{ storageKeys?: Record<string, string> }} [opts]
 */
export function mountCollapsiblePanelReorderGroups(scope, { storageKeys = {}, legacyStorageKeys = {} } = {}) {
  collectCollapsibleReorderContainers(scope).forEach((container) => {
    const group = container.dataset.collapsibleReorderGroup || ''
    mountCollapsiblePanelReorder(container, {
      storageKey: storageKeys[group] || `${group}-order`,
      legacyStorageKeys: legacyStorageKeys[group] || [],
    })
  })
}
