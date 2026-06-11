import { extractSearchableTextFromRowData } from '../certificateSearch.js'
import { normalizeSearchText, searchTextIncludes } from '../searchNormalize.js'

const STORAGE_KEY = 'public-relation-map-v1'
const SEARCH_DEBOUNCE_MS = 280
const MAX_HITS = 300
const VIEWPORT_MARGIN = 8
const FAB_SIZE = 52
const DEFAULT_PANEL_WIDTH = 320
const DEFAULT_PANEL_HEIGHT = 400
const MIN_PANEL_WIDTH = 260
const MIN_PANEL_HEIGHT = 220

/** @typedef {{
 *   query: string,
 *   expanded: boolean,
 *   left: number | null,
 *   top: number | null,
 *   width: number | null,
 *   height: number | null,
 * }} RelationMapPrefs */
/** @typedef {{ certId: number, certTitle: string, rowIndex: number, pageNavLabel: string, preview: string }} RelationMapHit */

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max)
}

/** @returns {RelationMapPrefs} */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        query: '',
        expanded: false,
        left: null,
        top: null,
        width: null,
        height: null,
      }
    }
    const parsed = JSON.parse(raw)
    const expanded = typeof parsed.expanded === 'boolean' ? parsed.expanded : false
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      expanded,
      left: Number.isFinite(parsed.left) ? parsed.left : null,
      top: Number.isFinite(parsed.top) ? parsed.top : null,
      width: Number.isFinite(parsed.width) ? parsed.width : null,
      height: Number.isFinite(parsed.height) ? parsed.height : null,
    }
  } catch {
    return {
      query: '',
      expanded: false,
      left: null,
      top: null,
      width: null,
      height: null,
    }
  }
}

/** @param {Partial<RelationMapPrefs>} patch */
function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储满或隐私模式时忽略
  }
}

/** @param {Record<string, unknown> | null | undefined} row @param {string} query */
function findMatchPreview(row, query) {
  if (!row || typeof row !== 'object') return ''
  for (const [col, val] of Object.entries(row)) {
    if (!searchTextIncludes(val, query)) continue
    let text = String(val ?? '').trim()
    if (text.startsWith('cat-img:')) text = text.slice('cat-img:'.length).split('/').pop() || text
    if (text.length > 56) text = `${text.slice(0, 56)}…`
    return col ? `${col}：${text}` : text
  }
  return ''
}

/**
 * @param {{
 *   getCatalogItems: () => { id: number, title?: string }[],
 *   getCertificateRows: (certId: number) => Promise<unknown[]>,
 *   getRowPageNavLabel: (certId: number, rowIndex: number) => string,
 *   getCurrentCertId: () => number | null,
 *   getSelectedRow: () => number,
 *   onJumpToHit: (hit: { certId: number, rowIndex: number }) => void,
 * }} ctx
 */
export function mountPublicRelationMap(ctx) {
  let prefs = loadPrefs()
  /** @type {RelationMapHit[]} */
  let hits = []
  /** @type {RelationMapHit[]} */
  let allHits = []
  let selectedCertId = null
  let selectedRow = -1
  let searchGen = 0
  /** @type {ReturnType<typeof setTimeout> | null} */
  let searchTimer = null
  let catalogCount = 0
  let searching = false
  let hitsTruncated = false

  const root = document.createElement('div')
  root.id = 'public-relation-map'
  root.className = 'public-relation-map'
  root.setAttribute('role', 'complementary')
  root.setAttribute('aria-label', '关联信息图')
  root.dataset.expanded = prefs.expanded ? 'true' : 'false'

  root.innerHTML = `
    <button
      type="button"
      class="public-relation-map-fab"
      id="public-relation-map-fab"
      aria-label="打开关联信息图"
      title="关联信息图"
    >
      <span class="public-relation-map-fab-pulse" aria-hidden="true"></span>
      <span class="public-relation-map-fab-pulse public-relation-map-fab-pulse--delay" aria-hidden="true"></span>
      <span class="public-relation-map-fab-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
          <circle cx="5.5" cy="12" r="2.4" fill="currentColor"/>
          <circle cx="18.5" cy="6" r="2.4" fill="currentColor"/>
          <circle cx="18.5" cy="18" r="2.4" fill="currentColor"/>
          <path d="M7.6 11.1 L16.4 7.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
          <path d="M7.6 12.9 L16.4 16.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
        </svg>
      </span>
      <span class="public-relation-map-fab-badge" id="public-relation-map-fab-badge" hidden></span>
    </button>
    <div class="public-relation-map-panel" id="public-relation-map-panel">
      <header class="public-relation-map-head" title="拖动可移动位置">
        <span class="public-relation-map-title">关联信息图</span>
        <span class="public-relation-map-count" id="public-relation-map-count" aria-live="polite"></span>
        <button type="button" class="public-relation-map-collapse" id="public-relation-map-collapse" aria-expanded="true" title="收起到图标">×</button>
      </header>
      <div class="public-relation-map-body" id="public-relation-map-body">
        <label class="public-relation-map-search-wrap">
          <input
            type="search"
            id="public-relation-map-input"
            class="public-relation-map-input"
            placeholder="搜索全部列表与全部行…"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <p class="public-relation-map-summary" id="public-relation-map-summary" aria-live="polite"></p>
        <ul class="public-relation-map-results" id="public-relation-map-results" role="list"></ul>
      </div>
      <div
        class="public-relation-map-resize"
        id="public-relation-map-resize"
        role="separator"
        aria-orientation="both"
        aria-label="拖动调整面板大小"
        title="拖动调整大小"
      ></div>
    </div>
  `
  document.body.appendChild(root)

  const fabEl = /** @type {HTMLButtonElement | null} */ (root.querySelector('#public-relation-map-fab'))
  const panelEl = /** @type {HTMLDivElement | null} */ (root.querySelector('#public-relation-map-panel'))
  const fabBadgeEl = root.querySelector('#public-relation-map-fab-badge')
  const countEl = root.querySelector('#public-relation-map-count')
  const collapseBtn = root.querySelector('#public-relation-map-collapse')
  const resizeEl = root.querySelector('#public-relation-map-resize')
  const inputEl = /** @type {HTMLInputElement | null} */ (root.querySelector('#public-relation-map-input'))
  const summaryEl = root.querySelector('#public-relation-map-summary')
  const resultsEl = root.querySelector('#public-relation-map-results')
  const headEl = root.querySelector('.public-relation-map-head')

  if (inputEl) inputEl.value = prefs.query

  function maxPanelWidth() {
    return Math.max(MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
  }

  function maxPanelHeight() {
    return Math.max(MIN_PANEL_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2)
  }

  function normalizedPanelSize() {
    const width = clamp(
      prefs.width ?? DEFAULT_PANEL_WIDTH,
      MIN_PANEL_WIDTH,
      maxPanelWidth(),
    )
    const height = clamp(
      prefs.height ?? DEFAULT_PANEL_HEIGHT,
      MIN_PANEL_HEIGHT,
      maxPanelHeight(),
    )
    return { width, height }
  }

  function applyPanelSize() {
    if (!panelEl) return
    const { width, height } = normalizedPanelSize()
    panelEl.style.width = `${width}px`
    panelEl.style.height = `${height}px`
    prefs.width = width
    prefs.height = height
  }

  function getFabDefaultPosition() {
    const left = window.innerWidth - FAB_SIZE - 16
    const top = window.innerHeight - FAB_SIZE - 16
    return { left, top }
  }

  function getCurrentRootRect() {
    const rect = root.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
    if (prefs.left != null && prefs.top != null) {
      const size = prefs.expanded ? normalizedPanelSize() : { width: FAB_SIZE, height: FAB_SIZE }
      return {
        left: prefs.left,
        top: prefs.top,
        right: prefs.left + size.width,
        bottom: prefs.top + size.height,
        width: size.width,
        height: size.height,
      }
    }
    const def = getFabDefaultPosition()
    return {
      left: def.left,
      top: def.top,
      right: def.left + FAB_SIZE,
      bottom: def.top + FAB_SIZE,
      width: FAB_SIZE,
      height: FAB_SIZE,
    }
  }

  function clampPosition(left, top, width, height) {
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
    return {
      left: clamp(left, VIEWPORT_MARGIN, maxLeft),
      top: clamp(top, VIEWPORT_MARGIN, maxTop),
    }
  }

  function applyRootPosition(left, top) {
    root.style.left = `${left}px`
    root.style.top = `${top}px`
    root.style.right = 'auto'
    root.style.bottom = 'auto'
    prefs.left = Math.round(left)
    prefs.top = Math.round(top)
  }

  function clampPanelToViewport() {
    if (!prefs.expanded || !panelEl) return
    applyPanelSize()
    const { width, height } = normalizedPanelSize()
    const rect = getCurrentRootRect()
    const next = clampPosition(rect.left, rect.top, width, height)
    applyRootPosition(next.left, next.top)
  }

  function applyPosition() {
    if (prefs.left != null && prefs.top != null) {
      const width = prefs.expanded ? normalizedPanelSize().width : FAB_SIZE
      const height = prefs.expanded ? normalizedPanelSize().height : FAB_SIZE
      const next = clampPosition(prefs.left, prefs.top, width, height)
      applyRootPosition(next.left, next.top)
      return
    }
    root.style.left = ''
    root.style.top = ''
    root.style.right = '16px'
    root.style.bottom = '16px'
  }

  function anchorExpandFromFab() {
    const { width, height } = normalizedPanelSize()
    const fabRect = fabEl?.getBoundingClientRect() ?? getCurrentRootRect()
    let left = fabRect.right - width
    let top = fabRect.bottom - height
    const next = clampPosition(left, top, width, height)
    applyRootPosition(next.left, next.top)
  }

  function playExpandAnimation() {
    if (!panelEl) return
    panelEl.classList.remove('is-opening')
    void panelEl.offsetWidth
    panelEl.classList.add('is-opening')
    const onEnd = () => {
      panelEl?.classList.remove('is-opening')
    }
    panelEl.addEventListener('animationend', onEnd, { once: true })
  }

  function setExpanded(expanded, { animate = false } = {}) {
    const wasExpanded = prefs.expanded
    prefs.expanded = expanded
    root.dataset.expanded = expanded ? 'true' : 'false'
    collapseBtn?.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    savePrefs({ expanded })

    if (expanded) {
      applyPanelSize()
      if (!wasExpanded) {
        if (prefs.left == null || prefs.top == null) anchorExpandFromFab()
        else clampPanelToViewport()
        applyPosition()
        if (animate) playExpandAnimation()
      } else {
        clampPanelToViewport()
      }
      if ((inputEl?.value ?? '').trim()) void runSearchNow()
      else renderResults()
    } else if (wasExpanded && panelEl && prefs.left != null && prefs.top != null) {
      const rect = panelEl.getBoundingClientRect()
      const next = clampPosition(rect.right - FAB_SIZE, rect.bottom - FAB_SIZE, FAB_SIZE, FAB_SIZE)
      applyRootPosition(next.left, next.top)
      savePrefs({ left: prefs.left, top: prefs.top })
    } else {
      applyPosition()
    }
    syncFabBadge()
  }

  function syncFabBadge() {
    if (!fabBadgeEl) return
    const query = (inputEl?.value ?? '').trim()
    if (!prefs.expanded && query && allHits.length > 0) {
      fabBadgeEl.hidden = false
      fabBadgeEl.textContent = allHits.length > 99 ? '99+' : String(allHits.length)
    } else {
      fabBadgeEl.hidden = true
      fabBadgeEl.textContent = ''
    }
  }

  function isHitActive(hit) {
    return hit.certId === selectedCertId && hit.rowIndex === selectedRow
  }

  function renderResults() {
    const query = (inputEl?.value ?? '').trim()
    catalogCount = ctx.getCatalogItems().length

    if (countEl) {
      if (prefs.expanded && query && allHits.length) countEl.textContent = String(allHits.length)
      else countEl.textContent = ''
    }

    if (!summaryEl || !resultsEl) return

    if (!prefs.expanded) {
      syncFabBadge()
      return
    }

    if (!catalogCount) {
      summaryEl.textContent = '暂无已发布内容'
      resultsEl.innerHTML = ''
      syncFabBadge()
      return
    }

    if (!query) {
      summaryEl.textContent = `共 ${catalogCount} 份内容，输入关键词搜索全部行`
      resultsEl.innerHTML = ''
      syncFabBadge()
      return
    }

    if (searching) {
      summaryEl.textContent = `正在搜索全部 ${catalogCount} 份内容…`
      if (!hits.length) resultsEl.innerHTML = ''
    } else if (!allHits.length) {
      summaryEl.textContent = `未找到包含「${query}」的行（已搜索 ${catalogCount} 份内容）`
      resultsEl.innerHTML = ''
      syncFabBadge()
      return
    } else {
      const truncNote = hitsTruncated ? `，仅显示前 ${MAX_HITS} 条` : ''
      summaryEl.textContent = `共 ${allHits.length} 行匹配（${catalogCount} 份内容）${truncNote}`
    }

    resultsEl.innerHTML = hits.map((hit) => {
      const n = hit.rowIndex + 1
      const active = isHitActive(hit) ? ' is-active' : ''
      const certTitle = escapeHtml(hit.certTitle)
      const pageNav = hit.pageNavLabel
        ? `<span class="public-relation-map-hit-pagenav">${escapeHtml(hit.pageNavLabel)}</span>`
        : ''
      const preview = hit.preview
        ? `<span class="public-relation-map-hit-preview">${escapeHtml(hit.preview)}</span>`
        : ''
      const ariaPageNav = hit.pageNavLabel ? `，${hit.pageNavLabel}` : ''
      return `<li><button type="button" class="public-relation-map-hit${active}" data-cert-id="${hit.certId}" data-row="${hit.rowIndex}" aria-label="打开 ${certTitle} 第 ${n} 行${ariaPageNav}"><span class="public-relation-map-hit-cert">${certTitle}</span><span class="public-relation-map-hit-num">第 ${n} 行</span>${pageNav}${preview}</button></li>`
    }).join('')
    syncFabBadge()
  }

  async function runSearchNow() {
    if (!prefs.expanded) return

    const gen = ++searchGen
    const query = inputEl?.value ?? ''
    prefs.query = query
    savePrefs({ query })

    const q = normalizeSearchText(query)
    catalogCount = ctx.getCatalogItems().length

    if (!q) {
      searching = false
      hits = []
      allHits = []
      hitsTruncated = false
      renderResults()
      return
    }

    if (!catalogCount) {
      searching = false
      hits = []
      allHits = []
      hitsTruncated = false
      renderResults()
      return
    }

    searching = true
    renderResults()

    const items = ctx.getCatalogItems()
    const found = /** @type {RelationMapHit[]} */ ([])

    for (const item of items) {
      if (gen !== searchGen) return
      let rows = []
      try {
        rows = await ctx.getCertificateRows(item.id)
      } catch {
        continue
      }
      const certTitle = String(item.title || '').trim() || '—'
      rows.forEach((row, i) => {
        const blob = extractSearchableTextFromRowData(row)
        if (!searchTextIncludes(blob, query)) return
        found.push({
          certId: item.id,
          certTitle,
          rowIndex: i,
          pageNavLabel: ctx.getRowPageNavLabel(item.id, i),
          preview: findMatchPreview(/** @type {Record<string, unknown>} */ (row), query),
        })
      })
      if (found.length > MAX_HITS) break
    }

    if (gen !== searchGen) return

    searching = false
    allHits = found
    hitsTruncated = found.length > MAX_HITS
    hits = found.slice(0, MAX_HITS)
    renderResults()
    syncActiveHitHighlight()
  }

  function scheduleSearch() {
    if (!prefs.expanded) return
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      void runSearchNow()
    }, SEARCH_DEBOUNCE_MS)
  }

  function scrollActiveHitIntoView() {
    const active = resultsEl?.querySelector('.public-relation-map-hit.is-active')
    active?.scrollIntoView({ block: 'nearest' })
  }

  function syncActiveHitHighlight() {
    selectedCertId = ctx.getCurrentCertId()
    selectedRow = ctx.getSelectedRow()
    resultsEl?.querySelectorAll('.public-relation-map-hit').forEach((btn) => {
      const certId = Number(btn.getAttribute('data-cert-id'))
      const row = Number(btn.getAttribute('data-row'))
      btn.classList.toggle('is-active', certId === selectedCertId && row === selectedRow)
    })
    scrollActiveHitIntoView()
  }

  collapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    setExpanded(false)
  })

  inputEl?.addEventListener('input', () => scheduleSearch())

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !hits.length) return
    e.preventDefault()
    const currentId = ctx.getCurrentCertId()
    const currentRow = ctx.getSelectedRow()
    const target = hits.find((h) => !(h.certId === currentId && h.rowIndex === currentRow)) ?? hits[0]
    ctx.onJumpToHit({ certId: target.certId, rowIndex: target.rowIndex })
  })

  resultsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.public-relation-map-hit')
    if (!btn) return
    const certId = Number(btn.dataset.certId)
    const rowIndex = Number(btn.dataset.row)
    if (!Number.isFinite(certId) || !Number.isFinite(rowIndex)) return
    ctx.onJumpToHit({ certId, rowIndex })
  })

  let dragging = false
  let dragMoved = false
  let dragStartX = 0
  let dragStartY = 0
  let dragOriginLeft = 0
  let dragOriginTop = 0

  const getDragBoxSize = () => {
    if (prefs.expanded && panelEl) {
      const { width, height } = normalizedPanelSize()
      return { width, height }
    }
    return { width: FAB_SIZE, height: FAB_SIZE }
  }

  const startDrag = (clientX, clientY) => {
    dragging = true
    dragMoved = false
    document.body.classList.add('public-relation-map-dragging')
    const rect = getCurrentRootRect()
    dragStartX = clientX
    dragStartY = clientY
    dragOriginLeft = rect.left
    dragOriginTop = rect.top
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  }

  const onDragMove = (clientX, clientY) => {
    if (!dragging) return
    const dx = clientX - dragStartX
    const dy = clientY - dragStartY
    if (Math.hypot(dx, dy) > 4) dragMoved = true
    const { width, height } = getDragBoxSize()
    const next = clampPosition(dragOriginLeft + dx, dragOriginTop + dy, width, height)
    applyRootPosition(next.left, next.top)
  }

  const stopDrag = () => {
    if (!dragging) return
    dragging = false
    document.body.classList.remove('public-relation-map-dragging')
    savePrefs({ left: prefs.left, top: prefs.top })
  }

  fabEl?.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    startDrag(e.clientX, e.clientY)
    e.preventDefault()
  })

  fabEl?.addEventListener('click', () => {
    if (dragMoved) {
      dragMoved = false
      return
    }
    setExpanded(true, { animate: true })
    requestAnimationFrame(() => {
      inputEl?.focus()
      inputEl?.select()
    })
  })

  headEl?.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input')) return
    startDrag(e.clientX, e.clientY)
    e.preventDefault()
  })

  let resizing = false
  let resizeStartX = 0
  let resizeStartY = 0
  let resizeOriginW = 0
  let resizeOriginH = 0

  resizeEl?.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !prefs.expanded) return
    resizing = true
    document.body.classList.add('public-relation-map-resizing')
    resizeStartX = e.clientX
    resizeStartY = e.clientY
    const { width, height } = normalizedPanelSize()
    resizeOriginW = width
    resizeOriginH = height
    e.preventDefault()
    e.stopPropagation()
  })

  const onResizeMove = (clientX, clientY) => {
    if (!resizing || !panelEl) return
    const nextW = clamp(
      resizeOriginW + (clientX - resizeStartX),
      MIN_PANEL_WIDTH,
      maxPanelWidth(),
    )
    const nextH = clamp(
      resizeOriginH + (clientY - resizeStartY),
      MIN_PANEL_HEIGHT,
      maxPanelHeight(),
    )
    panelEl.style.width = `${nextW}px`
    panelEl.style.height = `${nextH}px`
    prefs.width = nextW
    prefs.height = nextH
    clampPanelToViewport()
  }

  const stopResize = () => {
    if (!resizing) return
    resizing = false
    document.body.classList.remove('public-relation-map-resizing')
    savePrefs({ width: prefs.width, height: prefs.height, left: prefs.left, top: prefs.top })
  }

  window.addEventListener('mousemove', (e) => {
    onDragMove(e.clientX, e.clientY)
    onResizeMove(e.clientX, e.clientY)
  })
  window.addEventListener('mouseup', () => {
    stopDrag()
    stopResize()
  })

  window.addEventListener('resize', () => {
    if (!prefs.expanded) {
      if (prefs.left != null && prefs.top != null) {
        const next = clampPosition(prefs.left, prefs.top, FAB_SIZE, FAB_SIZE)
        applyRootPosition(next.left, next.top)
        savePrefs({ left: prefs.left, top: prefs.top })
      }
      return
    }
    applyPanelSize()
    clampPanelToViewport()
    savePrefs({ width: prefs.width, height: prefs.height, left: prefs.left, top: prefs.top })
  })

  applyPanelSize()
  if (prefs.expanded) {
    applyPosition()
    clampPanelToViewport()
    if (prefs.query.trim()) void runSearchNow()
    else renderResults()
  } else {
    applyPosition()
    renderResults()
  }

  return {
    refresh() {
      if (!prefs.expanded) return
      if ((inputEl?.value ?? '').trim()) void runSearchNow()
      else renderResults()
    },
    updateSelection() {
      syncActiveHitHighlight()
    },
    expandAndFocus() {
      setExpanded(true, { animate: true })
      requestAnimationFrame(() => {
        inputEl?.focus()
        inputEl?.select()
      })
    },
  }
}
