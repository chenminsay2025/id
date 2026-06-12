import { TEMPLATE_VIEWBOX } from './svgEngine.js'
import { previewStageDimensionsForPage } from './templateBackground.js'
import { DEFAULT_PAGE_WIDTH_MM, DEFAULT_PAGE_HEIGHT_MM } from './pageSize.js'
import { mmToSvgUserUnits } from './layoutUnits.js'
import {
  getMultiPageCellRect,
  getVisiblePageIndexFromLayout,
  getVisiblePageIndicesFromLayout,
} from './multiPageVirtual.js'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const WHEEL_ZOOM_FACTOR = 1.1

/** 对齐设备像素，减少缩放/平移后的文字与描边发糊 */
function snapCssPx(value) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.round(value * dpr) / dpr
}

/**
 * 预览区缩放 / 平移：通过改变 SVG 实际像素尺寸保持矢量清晰；
 * 滚轮以光标为中心缩放，抓手或中键拖拽平移。
 * @param {HTMLElement} previewArea
 * @param {{ workspacePaddingMm?: number, onScaleChange?: (scale: number) => void, onViewChange?: (state: { scale: number, panX: number, panY: number }) => void, onVisiblePageChange?: (pageIndex: number) => void, onNavigationActiveChange?: (active: boolean) => void, onMiddlePanActiveChange?: (active: boolean) => void, enableTouchGestures?: boolean, enablePageSwipe?: boolean | (() => boolean), canSwipePage?: (dir: 'prev' | 'next') => boolean, onSwipePage?: (dir: 'prev' | 'next') => void | Promise<void> }} [options]
 */
export function mountPreviewViewport(previewArea, options = {}) {
  const { onScaleChange, onViewChange, onVisiblePageChange, onNavigationActiveChange } = options
  let workspacePaddingMm = Math.max(0, Number(options.workspacePaddingMm) || 0)
  let pageWidthMm = DEFAULT_PAGE_WIDTH_MM
  let pageHeightMm = DEFAULT_PAGE_HEIGHT_MM
  let baseWidth = TEMPLATE_VIEWBOX.width
  let baseHeight = TEMPLATE_VIEWBOX.height
  let artboardWidth = TEMPLATE_VIEWBOX.width
  let artboardHeight = TEMPLATE_VIEWBOX.height
  let workspacePadX = 0
  let workspacePadY = 0

  previewArea.classList.add('preview-area--viewport')
  if (workspacePaddingMm > 0) {
    previewArea.classList.add('preview-area--layout-workspace')
  } else {
    previewArea.classList.add('preview-area--artboard-clip')
  }
  previewArea.innerHTML = ''

  const viewport = document.createElement('div')
  viewport.className = 'preview-viewport'
  viewport.tabIndex = 0

  const layer = document.createElement('div')
  layer.className = 'preview-transform-layer'

  const slot = document.createElement('div')
  slot.className = 'preview-content-slot'

  layer.appendChild(slot)
  viewport.appendChild(layer)
  previewArea.appendChild(viewport)

  let scale = 1
  let panX = 0
  let panY = 0
  let rotation = 0
  let fitScaleCache = 1
  let swipeOffsetX = 0
  let pageSwipeAnimating = false
  let panMode = false
  let isPanning = false
  let panPointerId = null
  let panTriggerButton = null
  let middlePanNotified = false
  let panStart = { x: 0, y: 0, panX: 0, panY: 0 }
  let spaceHeld = false
  let viewportHovered = false
  /** @type {'single' | 'multi-v' | 'multi-h'} */
  let navigationMode = 'single'
  /** @type {{ width: number, height: number } | null} */
  let contentBoundsOverride = null

  const VIEW_PAD = 24
  const SCROLL_PAD = 12
  let suppressVisiblePageNotify = false
  let visiblePageNotifyRaf = 0

  /** 拖拽 / 滚轮平移 / 触摸平移期间为 true，用于推迟重 DOM 操作 */
  let navActiveMask = 0
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let navWheelIdleTimer = 0
  const NAV_POINTER = 1
  const NAV_WHEEL = 2
  const NAV_TOUCH = 4
  const NAV_PAGE_SCROLL = 8

  /** @type {number} */
  let pageScrollAnimRaf = 0
  /** @type {(() => void) | null} */
  let pageScrollAnimCancel = null

  function setNavigationActive(source, active) {
    const prev = navActiveMask !== 0
    if (active) navActiveMask |= source
    else navActiveMask &= ~source
    const now = navActiveMask !== 0
    if (now === prev) return
    onNavigationActiveChange?.(now)
  }

  function bumpWheelNavigation() {
    if (!isScrollNavigation()) return
    setNavigationActive(NAV_WHEEL, true)
    if (navWheelIdleTimer) clearTimeout(navWheelIdleTimer)
    navWheelIdleTimer = setTimeout(() => {
      navWheelIdleTimer = 0
      setNavigationActive(NAV_WHEEL, false)
    }, 200)
  }

  function isScrollNavigation() {
    return navigationMode === 'multi-v' || navigationMode === 'multi-h'
  }

  /** @type {(() => import('./multiPageVirtual.js').MultiPageLayoutMeta | null) | null} */
  let pageLayoutGetter = null

  function getPageLayout() {
    return pageLayoutGetter?.() ?? null
  }

  function getLayoutCellMetrics(pageIndex) {
    const layout = getPageLayout()
    if (!layout || pageIndex < 0 || pageIndex >= layout.count) return null
    const rect = getMultiPageCellRect(layout, pageIndex, scale)
    if (!rect) return null
    return {
      left: snapCssPx(rect.left),
      top: snapCssPx(rect.top),
      width: snapCssPx(rect.width),
      height: snapCssPx(rect.height),
    }
  }

  function setPageLayoutGetter(getter) {
    pageLayoutGetter = typeof getter === 'function' ? getter : null
  }

  function setNavigationMode(mode = 'single') {
    navigationMode = mode === 'multi-v' || mode === 'multi-h' ? mode : 'single'
    previewArea.classList.toggle('preview-area--nav-scroll', isScrollNavigation())
    previewArea.classList.toggle('preview-area--nav-multi-v', navigationMode === 'multi-v')
    previewArea.classList.toggle('preview-area--nav-multi-h', navigationMode === 'multi-h')
    updatePanVisuals()
  }

  function clampPanValues(px, py) {
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    if (vw < 2 || vh < 2) return { panX: px, panY: py }
    const contentW = baseWidth * scale
    const contentH = baseHeight * scale
    let nextX = px
    let nextY = py

    if (navigationMode === 'multi-v') {
      nextX = contentW <= vw
        ? (vw - contentW) / 2
        : Math.min(SCROLL_PAD, Math.max(vw - contentW - SCROLL_PAD, px))
      nextY = contentH <= vh
        ? (vh - contentH) / 2
        : Math.min(SCROLL_PAD, Math.max(vh - contentH - SCROLL_PAD, py))
      return { panX: nextX, panY: nextY }
    }

    nextY = contentH <= vh
      ? (vh - contentH) / 2
      : Math.min(SCROLL_PAD, Math.max(vh - contentH - SCROLL_PAD, py))
    nextX = contentW <= vw
      ? (vw - contentW) / 2
      : Math.min(SCROLL_PAD, Math.max(vw - contentW - SCROLL_PAD, px))
    return { panX: nextX, panY: nextY }
  }

  function clampPan() {
    if (!isScrollNavigation()) return
    const clamped = clampPanValues(panX, panY)
    panX = clamped.panX
    panY = clamped.panY
  }

  /** @param {number} pageIndex @param {{ center?: boolean }} [opts] */
  function computePanForPage(pageIndex, opts = {}) {
    if (!isScrollNavigation()) return { panX, panY }
    const metrics = getLayoutCellMetrics(pageIndex)
    const cell = !metrics ? slot.querySelector(`.preview-page-cell[data-page-index="${pageIndex}"]`) : null
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    let cellTop
    let cellLeft
    let cellH
    let cellW
    if (metrics) {
      cellLeft = metrics.left
      cellTop = metrics.top
      cellW = metrics.width
      cellH = metrics.height
    } else if (cell) {
      cellTop = cell.offsetTop
      cellLeft = cell.offsetLeft
      cellH = cell.offsetHeight
      cellW = cell.offsetWidth
    } else {
      return { panX, panY }
    }
    let targetPanX = panX
    let targetPanY = panY

    if (opts.center) {
      if (navigationMode === 'multi-v') {
        targetPanY = -((cellTop + cellH / 2) - vh / 2)
      } else {
        targetPanX = -((cellLeft + cellW / 2) - vw / 2)
      }
      return clampPanValues(targetPanX, targetPanY)
    }

    if (navigationMode === 'multi-v') {
      const viewTop = -panY + SCROLL_PAD
      const viewBottom = -panY + vh - SCROLL_PAD
      if (cellTop < viewTop) targetPanY = -(cellTop - SCROLL_PAD)
      else if (cellTop + cellH > viewBottom) targetPanY = -(cellTop + cellH - vh + SCROLL_PAD)
    } else {
      const viewLeft = -panX + SCROLL_PAD
      const viewRight = -panX + vw - SCROLL_PAD
      if (cellLeft < viewLeft) targetPanX = -(cellLeft - SCROLL_PAD)
      else if (cellLeft + cellW > viewRight) targetPanX = -(cellLeft + cellW - vw + SCROLL_PAD)
    }
    return clampPanValues(targetPanX, targetPanY)
  }

  function cancelPageScrollAnimation() {
    if (pageScrollAnimRaf) {
      cancelAnimationFrame(pageScrollAnimRaf)
      pageScrollAnimRaf = 0
    }
    if (pageScrollAnimCancel) {
      pageScrollAnimCancel()
      pageScrollAnimCancel = null
    }
    setNavigationActive(NAV_PAGE_SCROLL, false)
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
  }

  /**
   * 丝滑滚动到指定页（多页模式）
   * @param {number} pageIndex
   * @param {{ onFrame?: () => void }} [options]
   */
  function animateScrollToPage(pageIndex, options = {}) {
    if (!isScrollNavigation()) return Promise.resolve()
    cancelPageScrollAnimation()

    const target = computePanForPage(pageIndex, { center: true })
    const startPanX = panX
    const startPanY = panY
    const dist = Math.hypot(target.panX - startPanX, target.panY - startPanY)
    if (dist < 1.5) return Promise.resolve()

    const duration = Math.min(820, Math.max(380, 340 + dist * 0.28))
    previewArea.classList.add('preview-area--page-scroll-jump')
    suppressVisiblePageNotify = true
    setNavigationActive(NAV_PAGE_SCROLL, true)

    return new Promise((resolve) => {
      const startTime = performance.now()
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        pageScrollAnimRaf = 0
        pageScrollAnimCancel = null
        panX = target.panX
        panY = target.panY
        clampPan()
        applyTransform()
        previewArea.classList.remove('preview-area--page-scroll-jump')
        suppressVisiblePageNotify = true
        requestAnimationFrame(() => {
          suppressVisiblePageNotify = false
          setNavigationActive(NAV_PAGE_SCROLL, false)
          resolve()
        })
      }

      pageScrollAnimCancel = finish

      const tick = (now) => {
        const elapsed = now - startTime
        const t = Math.min(1, elapsed / duration)
        const eased = easeInOutCubic(t)
        panX = startPanX + (target.panX - startPanX) * eased
        panY = startPanY + (target.panY - startPanY) * eased
        clampPan()
        applyTransform()
        options.onFrame?.()
        if (t >= 1) finish()
        else pageScrollAnimRaf = requestAnimationFrame(tick)
      }

      pageScrollAnimRaf = requestAnimationFrame(tick)
    })
  }

  /** @returns {number | null} */
  function getVisiblePageIndex() {
    if (!isScrollNavigation()) return null
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    const layout = getPageLayout()
    if (layout) {
      return getVisiblePageIndexFromLayout(layout, scale, panX, panY, vw, vh)
    }
    const cells = slot.querySelectorAll('.preview-page-cell')
    if (!cells.length) return null

    const viewLeft = -panX
    const viewTop = -panY
    const viewRight = viewLeft + vw
    const viewBottom = viewTop + vh

    let bestIndex = null
    let bestVisible = -1

    cells.forEach((cell) => {
      const index = Number(cell.dataset.pageIndex)
      if (!Number.isFinite(index)) return

      const left = cell.offsetLeft
      const top = cell.offsetTop
      const right = left + cell.offsetWidth
      const bottom = top + cell.offsetHeight

      const overlapW = Math.max(0, Math.min(right, viewRight) - Math.max(left, viewLeft))
      const overlapH = Math.max(0, Math.min(bottom, viewBottom) - Math.max(top, viewTop))
      const visibleArea = overlapW * overlapH

      if (visibleArea > bestVisible) {
        bestVisible = visibleArea
        bestIndex = index
      }
    })

    return bestIndex
  }

  /** 与视口有交集的页码（仅多页滚动模式） */
  function getVisiblePageIndices() {
    if (!isScrollNavigation()) return []
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    const layout = getPageLayout()
    if (layout) {
      return getVisiblePageIndicesFromLayout(layout, scale, panX, panY, vw, vh)
    }
    const cells = slot.querySelectorAll('.preview-page-cell')
    if (!cells.length) return []

    const viewLeft = -panX
    const viewTop = -panY
    const viewRight = viewLeft + vw
    const viewBottom = viewTop + vh

    /** @type {number[]} */
    const indices = []
    cells.forEach((cell) => {
      const index = Number(cell.dataset.pageIndex)
      if (!Number.isFinite(index)) return

      const pw = Number(cell.dataset.pageW) || artboardWidth
      const ph = Number(cell.dataset.pageH) || artboardHeight
      const w = cell.offsetWidth || Math.round(pw * scale)
      const h = cell.offsetHeight || Math.round(ph * scale)
      const left = cell.offsetLeft
      const top = cell.offsetTop
      const right = left + w
      const bottom = top + h

      const overlapW = Math.max(0, Math.min(right, viewRight) - Math.max(left, viewLeft))
      const overlapH = Math.max(0, Math.min(bottom, viewBottom) - Math.max(top, viewTop))
      if (overlapW > 0 && overlapH > 0) indices.push(index)
    })
    return indices.sort((a, b) => a - b)
  }

  function notifyVisiblePageChange() {
    if (!isScrollNavigation() || !onVisiblePageChange || suppressVisiblePageNotify) return
    if (visiblePageNotifyRaf) cancelAnimationFrame(visiblePageNotifyRaf)
    visiblePageNotifyRaf = requestAnimationFrame(() => {
      visiblePageNotifyRaf = 0
      const index = getVisiblePageIndex()
      if (index != null) onVisiblePageChange(index)
    })
  }

  /** @param {number} pageIndex */
  function scrollPageIntoView(pageIndex) {
    if (!isScrollNavigation()) return
    cancelPageScrollAnimation()
    const target = computePanForPage(pageIndex)
    suppressVisiblePageNotify = true
    panX = target.panX
    panY = target.panY
    clampPan()
    applyTransform()
    requestAnimationFrame(() => {
      suppressVisiblePageNotify = false
    })
  }

  function recomputeBaseDimensions() {
    const dims = previewStageDimensionsForPage(pageWidthMm, pageHeightMm)
    artboardWidth = dims.width
    artboardHeight = dims.height
    if (contentBoundsOverride) {
      baseWidth = contentBoundsOverride.width
      baseHeight = contentBoundsOverride.height
      return
    }
    if (workspacePaddingMm > 0) {
      workspacePadX = mmToSvgUserUnits(workspacePaddingMm, 'x', pageWidthMm, pageHeightMm)
      workspacePadY = mmToSvgUserUnits(workspacePaddingMm, 'y', pageWidthMm, pageHeightMm)
      baseWidth = artboardWidth + workspacePadX * 2
      baseHeight = artboardHeight + workspacePadY * 2
    } else {
      workspacePadX = 0
      workspacePadY = 0
      baseWidth = artboardWidth
      baseHeight = artboardHeight
    }
  }

  recomputeBaseDimensions()

  function notifyScale() {
    onScaleChange?.(scale)
  }

  /** 用真实宽高缩放 SVG，避免 transform: scale 导致栅格化模糊 */
  function applyContentSize() {
    const stage = slot.querySelector('.preview-stage')
    if (!stage) return
    const w = Math.round(snapCssPx(baseWidth * scale))
    const h = Math.round(snapCssPx(baseHeight * scale))
    stage.style.width = `${w}px`
    stage.style.height = `${h}px`

    const isMultiLayout = stage.classList.contains('preview-stage--pages-h')
      || stage.classList.contains('preview-stage--pages-v')
    if (isMultiLayout) {
      const gap = Number(stage.dataset.pageGap) || 16
      const isVirtual = stage.classList.contains('preview-stage--virtual')
      if (!isVirtual) {
        stage.style.gap = `${Math.round(snapCssPx(gap * scale))}px`
      } else {
        stage.style.gap = '0'
      }
      stage.querySelectorAll('.preview-page-cell').forEach((cell) => {
        const pageIndex = Number(cell.dataset.pageIndex)
        const pw = Number(cell.dataset.pageW) || artboardWidth
        const ph = Number(cell.dataset.pageH) || artboardHeight
        const cw = Math.round(snapCssPx(pw * scale))
        const ch = Math.round(snapCssPx(ph * scale))
        cell.style.width = `${cw}px`
        cell.style.height = `${ch}px`
        if (isVirtual && Number.isFinite(pageIndex)) {
          const metrics = getLayoutCellMetrics(pageIndex)
          if (metrics) {
            cell.style.left = `${metrics.left}px`
            cell.style.top = `${metrics.top}px`
          }
        }
        const svg = cell.querySelector('svg')
        if (svg) {
          svg.setAttribute('width', String(cw))
          svg.setAttribute('height', String(ch))
          svg.style.width = `${cw}px`
          svg.style.height = `${ch}px`
          svg.style.display = 'block'
        }
      })
      return
    }

    const artboard = stage.querySelector('.preview-artboard')
    if (artboard) {
      const aw = Math.round(snapCssPx(artboardWidth * scale))
      const ah = Math.round(snapCssPx(artboardHeight * scale))
      artboard.style.width = `${aw}px`
      artboard.style.height = `${ah}px`
      artboard.style.marginLeft = ''
      artboard.style.marginTop = ''
      const svg = artboard.querySelector('svg')
      if (svg) {
        svg.setAttribute('width', String(aw))
        svg.setAttribute('height', String(ah))
        svg.style.width = `${aw}px`
        svg.style.height = `${ah}px`
        svg.style.display = 'block'
      }
      return
    }

    const svg = stage.querySelector('svg')
    if (svg) {
      svg.setAttribute('width', String(w))
      svg.setAttribute('height', String(h))
      svg.style.width = `${w}px`
      svg.style.height = `${h}px`
      svg.style.display = 'block'
    }
  }

  function notifyView() {
    onViewChange?.({ scale, panX, panY, rotation })
  }

  function getContentPivot() {
    return {
      x: snapCssPx((baseWidth * scale) / 2),
      y: snapCssPx((baseHeight * scale) / 2),
    }
  }

  let lastAppliedContentScale = NaN

  function applyTransform() {
    const tx = snapCssPx(panX + swipeOffsetX)
    const ty = snapCssPx(panY)
    const pivot = getContentPivot()
    const rot = rotation
    if (Math.abs(rot) > 0.01) {
      layer.style.transform = [
        `translate(${tx}px, ${ty}px)`,
        `translate(${pivot.x}px, ${pivot.y}px)`,
        `rotate(${rot}deg)`,
        `translate(${-pivot.x}px, ${-pivot.y}px)`,
      ].join(' ')
    } else {
      layer.style.transform = `translate(${tx}px, ${ty}px)`
    }
    if (lastAppliedContentScale !== scale) {
      applyContentSize()
      lastAppliedContentScale = scale
    }
    notifyScale()
    notifyView()
    notifyVisiblePageChange()
  }

  function invalidateContentSizeCache() {
    lastAppliedContentScale = NaN
  }

  function refreshContentSize() {
    invalidateContentSizeCache()
    applyContentSize()
    lastAppliedContentScale = scale
  }

  function setLayerTransition(on) {
    layer.style.transition = on
      ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none'
  }

  /** @param {number} target @param {() => void} [onDone] */
  function animateSwipeOffset(target, onDone) {
    if (Math.abs(target - swipeOffsetX) < 0.5) {
      swipeOffsetX = target
      setLayerTransition(false)
      applyTransform()
      onDone?.()
      return
    }
    pageSwipeAnimating = true
    previewArea.classList.add('preview-area--page-swipe-anim')
    setLayerTransition(true)
    swipeOffsetX = target
    applyTransform()
    const finish = () => {
      layer.removeEventListener('transitionend', finish)
      setLayerTransition(false)
      pageSwipeAnimating = false
      previewArea.classList.remove('preview-area--page-swipe-anim')
      onDone?.()
    }
    layer.addEventListener('transitionend', finish, { once: true })
  }

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = viewport.getBoundingClientRect()
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const contentX = (cx - panX) / scale
    const contentY = (cy - panY) / scale
    const next = clampZoom(scale * factor)
    if (next === scale) return
    panX = cx - contentX * next
    panY = cy - contentY * next
    scale = next
    clampPan()
    applyTransform()
  }

  function zoomByFactor(factor) {
    const rect = viewport.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  function isPanActive() {
    return panMode || spaceHeld
  }

  function updatePanVisuals() {
    const active = isPanActive()
    const scrollNav = isScrollNavigation()
    previewArea.classList.toggle('preview-pan-mode', active)
    previewArea.classList.toggle('preview-area--scroll-nav', scrollNav)
    viewport.classList.toggle('preview-viewport--pan', active || scrollNav)
    viewport.classList.toggle('preview-viewport--scroll-nav', scrollNav)
  }

  function setPanMode(on) {
    panMode = !!on
    updatePanVisuals()
  }

  function shouldPanPointer(e) {
    if (e.button === 1) return true
    if (isScrollNavigation() && e.button === 0) return true
    if (!isPanActive() || e.button !== 0) return false
    return true
  }

  function notifyMiddlePanActive(active) {
    if (active) {
      if (middlePanNotified) return
      middlePanNotified = true
      options.onMiddlePanActiveChange?.(true)
      return
    }
    if (!middlePanNotified) return
    middlePanNotified = false
    options.onMiddlePanActiveChange?.(false)
  }

  function startPan(e) {
    if (!shouldPanPointer(e)) return
    isPanning = true
    panPointerId = e.pointerId
    panTriggerButton = e.button
    panStart = { x: e.clientX, y: e.clientY, panX, panY }
    if (e.button === 1) notifyMiddlePanActive(true)
    if (isScrollNavigation()) setNavigationActive(NAV_POINTER, true)
    viewport.classList.add('preview-viewport--panning')
    previewArea.classList.add('preview-area--panning')
    try {
      viewport.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    e.preventDefault()
  }

  function movePan(e) {
    if (!isPanning || e.pointerId !== panPointerId) return
    panX = panStart.panX + (e.clientX - panStart.x)
    panY = panStart.panY + (e.clientY - panStart.y)
    clampPan()
    applyTransform()
    e.preventDefault()
  }

  function endPan(e) {
    if (!isPanning || (e.pointerId != null && e.pointerId !== panPointerId)) return
    const wasMiddlePan = panTriggerButton === 1
    isPanning = false
    panPointerId = null
    panTriggerButton = null
    viewport.classList.remove('preview-viewport--panning')
    previewArea.classList.remove('preview-area--panning')
    if (isScrollNavigation()) setNavigationActive(NAV_POINTER, false)
    if (wasMiddlePan) notifyMiddlePanActive(false)
    try {
      viewport.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  function resetView() {
    scale = 1
    panX = 0
    panY = 0
    rotation = 0
    applyTransform()
  }

  function fitView(options = {}) {
    if (!slot.querySelector('.preview-stage')) {
      resetView()
      fitScaleCache = scale
      return
    }
    const anchorPage = options.anchorPageIndex ?? (isScrollNavigation() ? getVisiblePageIndex() : null)
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    if (vw < 2 || vh < 2) return
    const pad = VIEW_PAD
    let fitScale
    if (navigationMode === 'multi-v') {
      fitScale = clampZoom((vw - pad) / baseWidth)
    } else if (navigationMode === 'multi-h') {
      fitScale = clampZoom((vh - pad) / baseHeight)
    } else {
      fitScale = clampZoom(
        Math.min((vw - pad) / baseWidth, (vh - pad) / baseHeight),
      )
    }
    scale = fitScale
    rotation = 0
    viewport.scrollTop = 0
    viewport.scrollLeft = 0
    if (navigationMode === 'multi-v') {
      panX = (vw - baseWidth * scale) / 2
      panY = SCROLL_PAD
    } else if (navigationMode === 'multi-h') {
      panX = SCROLL_PAD
      panY = (vh - baseHeight * scale) / 2
    } else {
      panX = (vw - baseWidth * scale) / 2
      panY = (vh - baseHeight * scale) / 2
    }
    clampPan()
    fitScaleCache = scale
    suppressVisiblePageNotify = true
    applyTransform()
    requestAnimationFrame(() => {
      suppressVisiblePageNotify = false
      if (anchorPage != null) scrollPageIntoView(anchorPage)
    })
  }

  let scheduleFitRaf1 = 0
  let scheduleFitRaf2 = 0
  /** @type {ResizeObserver | null} */
  let scheduleFitObserver = null
  let scheduleFitObserverUntil = 0

  function clearScheduleFit() {
    if (scheduleFitRaf1) cancelAnimationFrame(scheduleFitRaf1)
    if (scheduleFitRaf2) cancelAnimationFrame(scheduleFitRaf2)
    scheduleFitRaf1 = 0
    scheduleFitRaf2 = 0
    scheduleFitObserver?.disconnect()
    scheduleFitObserver = null
    scheduleFitObserverUntil = 0
  }

  /** 等预览区尺寸稳定后再 fit，避免 flex 未完成时 pan 偏大、画布视觉偏下 */
  function scheduleFitView() {
    clearScheduleFit()
    let lastW = 0
    let lastH = 0
    let stablePasses = 0

    const tryFit = () => {
      const w = viewport.clientWidth
      const h = viewport.clientHeight
      if (w < 2 || h < 2) return false
      fitView()
      if (w === lastW && h === lastH) stablePasses += 1
      else {
        lastW = w
        lastH = h
        stablePasses = 0
      }
      return stablePasses >= 1
    }

    const armResizeObserver = () => {
      if (typeof ResizeObserver === 'undefined') return
      scheduleFitObserverUntil = performance.now() + 2000
      scheduleFitObserver = new ResizeObserver(() => {
        if (performance.now() > scheduleFitObserverUntil) {
          clearScheduleFit()
          return
        }
        if (tryFit()) clearScheduleFit()
      })
      scheduleFitObserver.observe(viewport)
    }

    scheduleFitRaf1 = requestAnimationFrame(() => {
      scheduleFitRaf1 = 0
      tryFit()
      scheduleFitRaf2 = requestAnimationFrame(() => {
        scheduleFitRaf2 = 0
        if (!tryFit()) armResizeObserver()
      })
    })
  }

  function setContent(node) {
    while (slot.firstChild) {
      slot.removeChild(slot.firstChild)
    }
    if (node) slot.appendChild(node)
    invalidateContentSizeCache()
    applyTransform()
  }

  /** @param {{ scale?: number, panX?: number, panY?: number, rotation?: number } | null} state */
  function setViewState(state) {
    if (!state) {
      resetView()
      return
    }
    scale = clampZoom(Number(state.scale) || 1)
    panX = Number(state.panX) || 0
    panY = Number(state.panY) || 0
    rotation = Number(state.rotation) || 0
    applyTransform()
  }

  function getViewState() {
    return { scale, panX, panY, rotation }
  }

  let wheelRaf = 0
  /** @type {{ clientX: number, clientY: number, factor: number } | null} */
  let pendingWheel = null

  viewport.addEventListener(
    'wheel',
    (e) => {
      if (!slot.querySelector('.preview-stage')) return

      if (isScrollNavigation() && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        bumpWheelNavigation()
        if (navigationMode === 'multi-v') {
          panY -= e.deltaY
          if (Math.abs(e.deltaX) > 0.5) panX -= e.deltaX
        } else {
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          panX -= delta
        }
        clampPan()
        applyTransform()
        return
      }

      e.preventDefault()
      const step = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR
      if (!pendingWheel) {
        pendingWheel = { clientX: e.clientX, clientY: e.clientY, factor: step }
      } else {
        pendingWheel.clientX = e.clientX
        pendingWheel.clientY = e.clientY
        pendingWheel.factor *= step
      }
      if (wheelRaf) return
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0
        const w = pendingWheel
        pendingWheel = null
        if (w) zoomAt(w.clientX, w.clientY, w.factor)
      })
    },
    { passive: false },
  )

  viewport.addEventListener('mouseenter', () => { viewportHovered = true })
  viewport.addEventListener('mouseleave', () => { viewportHovered = false })

  viewport.addEventListener('pointerdown', startPan, { capture: true })
  viewport.addEventListener('pointermove', movePan)
  viewport.addEventListener('pointerup', endPan)
  viewport.addEventListener('pointercancel', endPan)

  viewport.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault()
  })

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return
    if (e.target?.matches('input, textarea, select, [contenteditable="true"]')) return
    if (!viewportHovered) return
    spaceHeld = true
    updatePanVisuals()
    e.preventDefault()
  })

  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return
    spaceHeld = false
    updatePanVisuals()
    viewport.classList.remove('preview-viewport--panning')
    previewArea.classList.remove('preview-area--panning')
    endPan(e)
  })

  if (options.enableTouchGestures) {
    previewArea.classList.add('preview-area--touch-gestures')

    /** @type {{ mode: 'swipe' | 'pan' | 'pinch', startX?: number, startY?: number, startPanX?: number, startPanY?: number, startScale?: number, startRotation?: number, startAngle?: number, startDist?: number, startCenterX?: number, startCenterY?: number } | null} */
    let touchGesture = null
    const SWIPE_MIN_PX = 52
    const ZOOMED_THRESHOLD = 1.08
    const SWIPE_RUBBER_MAX = 56

    function touchDist(a, b) {
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }

    function touchMid(a, b) {
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
    }

    function touchAngle(a, b) {
      return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
    }

    function isZoomedIn() {
      return scale > fitScaleCache * ZOOMED_THRESHOLD
    }

    function isViewTransformed() {
      return isZoomedIn() || Math.abs(rotation) > 0.5
    }

    function applyPinchTransform(start, t0, t1) {
      const rect = viewport.getBoundingClientRect()
      const dist = touchDist(t0, t1)
      const mid = touchMid(t0, t1)
      const angle = touchAngle(t0, t1)
      const startDist = start.startDist || dist
      const startScale = start.startScale ?? scale
      const nextScale = clampZoom(startScale * (dist / startDist))

      rotation = (start.startRotation ?? 0) + (angle - (start.startAngle ?? angle)) * (180 / Math.PI)

      const cx = mid.x - rect.left
      const cy = mid.y - rect.top
      const startCx = (start.startCenterX ?? mid.x) - rect.left
      const startCy = (start.startCenterY ?? mid.y) - rect.top
      const ux = (startCx - (start.startPanX ?? panX)) / startScale
      const uy = (startCy - (start.startPanY ?? panY)) / startScale

      scale = nextScale
      panX = cx - ux * nextScale
      panY = cy - uy * nextScale
      clampPan()
      applyTransform()
    }

    function isPageSwipeEnabled() {
      const v = options.enablePageSwipe
      if (v === false) return false
      if (typeof v === 'function') return !!v()
      return true
    }

    function canSwipe(dir) {
      if (!isPageSwipeEnabled()) return false
      return options.canSwipePage?.(dir) ?? true
    }

    function initialTouchMode() {
      if (isScrollNavigation()) return 'pan'
      if (!isPageSwipeEnabled()) return 'pan'
      return isViewTransformed() ? 'pan' : 'swipe'
    }

    function rubberBandOffset(dx) {
      const sign = Math.sign(dx) || 1
      const abs = Math.abs(dx)
      return sign * SWIPE_RUBBER_MAX * (1 - Math.exp(-abs / 140))
    }

    function clampSwipeOffset(dx) {
      if (dx > 0 && !canSwipe('prev')) return rubberBandOffset(dx)
      if (dx < 0 && !canSwipe('next')) return rubberBandOffset(dx)
      return dx
    }

    function resetSwipeOffset(immediate = true) {
      swipeOffsetX = 0
      if (immediate) {
        setLayerTransition(false)
        applyTransform()
      }
    }

    async function commitPageSwipe(dir) {
      const vw = Math.max(viewport.clientWidth, 320)
      const exitOffset = dir === 'next' ? -vw : vw
      const enterOffset = dir === 'next' ? vw : -vw

      animateSwipeOffset(exitOffset, () => {
        swipeOffsetX = enterOffset
        setLayerTransition(false)
        applyTransform()
        Promise.resolve(options.onSwipePage?.(dir)).finally(() => {
          requestAnimationFrame(() => {
            animateSwipeOffset(0)
          })
        })
      })
    }

    viewport.addEventListener('touchstart', (e) => {
      if (!slot.querySelector('.preview-stage') || pageSwipeAnimating) return
      if (e.touches.length === 2) {
        resetSwipeOffset()
        previewArea.classList.remove('preview-area--page-swiping', 'preview-area--touch-rotating')
        const t0 = e.touches[0]
        const t1 = e.touches[1]
        const mid = touchMid(t0, t1)
        touchGesture = {
          mode: 'pinch',
          startDist: touchDist(t0, t1),
          startAngle: touchAngle(t0, t1),
          startScale: scale,
          startRotation: rotation,
          startPanX: panX,
          startPanY: panY,
          startCenterX: mid.x,
          startCenterY: mid.y,
        }
      } else if (e.touches.length === 1) {
        resetSwipeOffset()
        previewArea.classList.remove('preview-area--page-swiping', 'preview-area--touch-rotating')
        const t = e.touches[0]
        touchGesture = {
          mode: initialTouchMode(),
          startX: t.clientX,
          startY: t.clientY,
          startPanX: panX,
          startPanY: panY,
        }
      }
    }, { passive: true })

    viewport.addEventListener('touchmove', (e) => {
      if (!touchGesture || !slot.querySelector('.preview-stage') || pageSwipeAnimating) return
      if (e.touches.length === 2 && touchGesture.mode === 'pinch') {
        e.preventDefault()
        previewArea.classList.remove('preview-area--page-swiping')
        previewArea.classList.add('preview-area--touch-rotating')
        applyPinchTransform(touchGesture, e.touches[0], e.touches[1])
        return
      }
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - (touchGesture.startX ?? t.clientX)
      const dy = t.clientY - (touchGesture.startY ?? t.clientY)
      if (touchGesture.mode === 'swipe' && isPageSwipeEnabled() && (Math.abs(dx) > 14 || Math.abs(dy) > 14)) {
        if (Math.abs(dx) > Math.abs(dy) * 1.25) {
          touchGesture.mode = 'swipe'
        } else if (isViewTransformed()) {
          touchGesture.mode = 'pan'
          previewArea.classList.remove('preview-area--page-swiping', 'preview-area--touch-rotating')
        }
      }
      if (touchGesture.mode === 'swipe' && isPageSwipeEnabled() && !isViewTransformed()) {
        if (Math.abs(dx) > Math.abs(dy) * 1.1) {
          e.preventDefault()
          previewArea.classList.add('preview-area--page-swiping')
          swipeOffsetX = clampSwipeOffset(dx)
          setLayerTransition(false)
          applyTransform()
        }
        return
      }
      if (touchGesture.mode === 'pan' || (touchGesture.mode === 'swipe' && isViewTransformed())) {
        e.preventDefault()
        touchGesture.mode = 'pan'
        previewArea.classList.remove('preview-area--page-swiping', 'preview-area--touch-rotating')
        if (isScrollNavigation()) setNavigationActive(NAV_TOUCH, true)
        panX = (touchGesture.startPanX ?? panX) + dx
        panY = (touchGesture.startPanY ?? panY) + dy
        clampPan()
        applyTransform()
      }
    }, { passive: false })

    viewport.addEventListener('touchend', (e) => {
      if (!touchGesture || pageSwipeAnimating) return
      if (e.touches.length === 1 && touchGesture.mode === 'pinch') {
        const t = e.touches[0]
        touchGesture = {
          mode: initialTouchMode(),
          startX: t.clientX,
          startY: t.clientY,
          startPanX: panX,
          startPanY: panY,
        }
        return
      }
      if (e.touches.length > 0) return
      previewArea.classList.remove('preview-area--page-swiping', 'preview-area--touch-rotating')
      if (isScrollNavigation()) setNavigationActive(NAV_TOUCH, false)
      if (touchGesture.mode === 'swipe' && isPageSwipeEnabled() && !isViewTransformed()) {
        const dx = swipeOffsetX
        const dy = (e.changedTouches[0]?.clientY ?? 0) - (touchGesture.startY ?? 0)
        const vw = viewport.clientWidth
        const threshold = Math.min(SWIPE_MIN_PX, vw * 0.2)
        const horizontal = Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.3
        if (horizontal && dx < 0 && canSwipe('next')) {
          touchGesture = null
          void commitPageSwipe('next')
          return
        }
        if (horizontal && dx > 0 && canSwipe('prev')) {
          touchGesture = null
          void commitPageSwipe('prev')
          return
        }
        if (Math.abs(dx) > 0.5) {
          animateSwipeOffset(0)
        } else {
          resetSwipeOffset()
        }
      }
      touchGesture = null
    }, { passive: true })

    viewport.addEventListener('touchcancel', () => {
      previewArea.classList.remove('preview-area--page-swiping', 'preview-area--touch-rotating')
      if (touchGesture?.mode === 'swipe' && Math.abs(swipeOffsetX) > 0.5) {
        animateSwipeOffset(0)
      } else {
        resetSwipeOffset()
      }
      touchGesture = null
    }, { passive: true })
  }

  function setPageAspectRatio(w = DEFAULT_PAGE_WIDTH_MM, h = DEFAULT_PAGE_HEIGHT_MM) {
    pageWidthMm = w
    pageHeightMm = h
    recomputeBaseDimensions()
    invalidateContentSizeCache()
    applyContentSize()
    lastAppliedContentScale = scale
  }

  /** 多页预览时覆盖内容区总尺寸；传 null 恢复单页尺寸 */
  function setContentBounds(width, height) {
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      contentBoundsOverride = { width, height }
    } else {
      contentBoundsOverride = null
    }
    recomputeBaseDimensions()
    invalidateContentSizeCache()
    applyContentSize()
    lastAppliedContentScale = scale
  }

  return {
    setContent,
    setPanMode,
    getPanMode: () => panMode,
    setNavigationMode,
    scrollPageIntoView,
    animateScrollToPage,
    cancelPageScrollAnimation,
    getVisiblePageIndex,
    getVisiblePageIndices,
    isNavigationActive: () => navActiveMask !== 0,
    isPageScrollAnimating: () => (navActiveMask & NAV_PAGE_SCROLL) !== 0,
    refreshContentSize,
    zoomIn: () => zoomByFactor(WHEEL_ZOOM_FACTOR),
    zoomOut: () => zoomByFactor(1 / WHEEL_ZOOM_FACTOR),
    resetView,
    fitView,
    scheduleFitView,
    getScale: () => scale,
    getViewState,
    setViewState,
    setPageAspectRatio,
    setContentBounds,
    setPageLayoutGetter,
    getWorkspacePaddingMm: () => workspacePaddingMm,
  }
}
