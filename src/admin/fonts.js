import { api } from '../api/client.js'
import { reloadApplicationFonts } from '../fontReload.js'

/**
 * @param {HTMLElement} container
 */
export function mountFontsPanel(container) {
  container.innerHTML = `
    <div class="wp-settings-panel-inner fonts-panel">
      <header class="wp-settings-header fonts-panel-header">
        <div>
          <h2 class="wp-settings-title">字体源</h2>
          <p class="wp-settings-desc" id="font-env-hint">配置 CDN 或本站 <code>/font</code> 字体地址，按列表顺序加载。</p>
        </div>
        <button type="button" class="button button-primary button-sm" id="font-save">保存</button>
      </header>
      <div class="fonts-main">
        <div id="font-toast" class="fonts-toast" role="status" hidden></div>
        <datalist id="font-url-suggestions"></datalist>
        <ul id="font-list" class="fonts-list"></ul>
        <div class="fonts-foot">
          <button type="button" class="btn btn-sm fonts-add-btn" id="font-add">+ 添加字体</button>
        </div>
      </div>
    </div>
    <dialog id="font-file-picker-dialog" class="font-file-picker-dialog">
      <div class="font-file-picker-shell">
        <header class="font-file-picker-head">
          <div>
            <h3 class="font-file-picker-title">选择字体文件</h3>
            <p class="font-file-picker-subtitle"><code>public/font/</code> · ttf / otf / woff</p>
          </div>
          <button type="button" class="font-file-picker-close" id="font-file-picker-close" title="关闭" aria-label="关闭">×</button>
        </header>
        <div class="font-file-picker-toolbar">
          <button type="button" class="btn btn-sm" id="font-picker-up" title="上级" disabled>↑</button>
          <button type="button" class="btn btn-sm" id="font-picker-refresh" title="刷新">↻</button>
          <button type="button" class="btn btn-sm" id="font-picker-go-font" title="font 目录">font</button>
          <input type="search" class="font-file-picker-filter" id="font-picker-filter" placeholder="筛选…" autocomplete="off" />
        </div>
        <nav class="font-file-picker-breadcrumb" id="font-picker-breadcrumb" aria-label="路径"></nav>
        <p class="font-file-picker-stats" id="font-picker-stats" aria-live="polite"></p>
        <p class="font-file-picker-status" id="font-picker-status" hidden role="alert"></p>
        <div class="font-file-picker-pathbar">
          <code class="font-file-picker-path" id="font-picker-path-display">public/font</code>
        </div>
        <div class="font-file-picker-table-wrap">
          <table class="font-file-picker-table">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col" class="font-file-picker-col-type">类型</th>
                <th scope="col" class="font-file-picker-col-size">大小</th>
                <th scope="col" class="font-file-picker-col-time">时间</th>
              </tr>
            </thead>
            <tbody id="font-file-picker-list"></tbody>
          </table>
          <p id="font-file-picker-empty" class="font-file-picker-empty" hidden>文件夹为空</p>
        </div>
        <div class="font-file-picker-preview" id="font-picker-preview">
          <span class="font-file-picker-preview-value" id="font-picker-preview-value">未选择</span>
        </div>
        <footer class="font-file-picker-foot">
          <button type="button" class="button button-primary" id="font-picker-confirm" disabled>确定</button>
          <button type="button" class="btn btn-sm" id="font-picker-cancel">取消</button>
        </footer>
      </div>
    </dialog>
  `

  const listEl = container.querySelector('#font-list')
  const toastEl = container.querySelector('#font-toast')
  const saveBtn = container.querySelector('#font-save')
  const addBtn = container.querySelector('#font-add')
  const pickerDialog = container.querySelector('#font-file-picker-dialog')
  const pickerListEl = container.querySelector('#font-file-picker-list')
  const pickerEmptyEl = container.querySelector('#font-file-picker-empty')
  const pickerBreadcrumbEl = container.querySelector('#font-picker-breadcrumb')
  const pickerStatsEl = container.querySelector('#font-picker-stats')
  const pickerStatusEl = container.querySelector('#font-picker-status')
  const pickerPathDisplayEl = container.querySelector('#font-picker-path-display')
  const pickerUpBtn = container.querySelector('#font-picker-up')
  const pickerRefreshBtn = container.querySelector('#font-picker-refresh')
  const pickerGoFontBtn = container.querySelector('#font-picker-go-font')
  const pickerFilterEl = container.querySelector('#font-picker-filter')
  const pickerPreviewValueEl = container.querySelector('#font-picker-preview-value')
  const pickerConfirmBtn = container.querySelector('#font-picker-confirm')
  const pickerCancelBtn = container.querySelector('#font-picker-cancel')
  const pickerCloseBtn = container.querySelector('#font-file-picker-close')

  /** @type {{ activeId: string, sources: { id: string, label: string, url: string, urls?: { url: string, enabled: boolean }[], enabled: boolean, legacyIds?: string[] }[] }} */
  let config = { activeId: '', sources: [] }
  /** @type {HTMLElement | null} */
  let pickerTargetRow = null
  /** @type {HTMLElement | null} */
  let pickerTargetUrlRow = null
  let pickerCurrentPath = 'public/font'
  /** @type {{ path: string, parent: string | null, dirs: object[], files: object[] } | null} */
  let pickerBrowseCache = null
  /** @type {{ url: string, name: string } | null} */
  let pickerSelection = null
  let pickerFilterText = ''
  /** @type {Map<string, { status: 'idle' | 'loading' | 'ok' | 'fail', message?: string }>} */
  const urlTestState = new Map()
  let toastTimer = 0

  function setStatus(msg, type = 'info') {
    if (!toastEl) return
    if (!msg) {
      toastEl.hidden = true
      toastEl.textContent = ''
      return
    }
    toastEl.hidden = false
    toastEl.className = `fonts-toast fonts-toast--${type}`
    const icon = type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warning' ? '⚠' : 'i'
    toastEl.innerHTML = `<span class="fonts-toast-icon" aria-hidden="true">${icon}</span><span class="fonts-toast-text">${escapeHtml(msg)}</span>`
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true
    }, type === 'error' ? 9000 : 4500)
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function formatBytes(n) {
    const size = Number(n) || 0
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(2)} MB`
  }

  function formatMtime(ms) {
    if (!ms) return '—'
    return new Date(ms).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  function closeFontPicker() {
    pickerDialog?.close()
    pickerTargetRow = null
    pickerTargetUrlRow = null
    pickerSelection = null
    pickerFilterText = ''
    if (pickerFilterEl) pickerFilterEl.value = ''
  }

  function updatePickerSelectionUI() {
    if (pickerConfirmBtn) pickerConfirmBtn.disabled = !pickerSelection
    if (pickerPreviewValueEl) {
      pickerPreviewValueEl.textContent = pickerSelection
        ? pickerSelection.url
        : '未选择'
    }
    pickerListEl?.querySelectorAll('.font-file-picker-row--font').forEach((row) => {
      const url = row.dataset.url || ''
      row.classList.toggle('is-selected', !!(pickerSelection && pickerSelection.url === url))
    })
  }

  function setPickerStatus(msg, isError = false) {
    if (!pickerStatusEl) return
    if (!msg) {
      pickerStatusEl.hidden = true
      pickerStatusEl.textContent = ''
      pickerStatusEl.classList.remove('font-file-picker-status--error')
      return
    }
    pickerStatusEl.hidden = false
    pickerStatusEl.textContent = msg
    pickerStatusEl.classList.toggle('font-file-picker-status--error', isError)
  }

  function renderPickerStats(data) {
    if (!pickerStatsEl) return
    const st = data.stats || {}
    const dirs = st.dirs ?? (data.dirs || []).length
    const fonts = st.fonts ?? (data.files || []).filter((f) => f.kind === 'font').length
    const others = (st.files ?? (data.files || []).length) - fonts
    pickerStatsEl.textContent = `${dirs} 文件夹 · ${fonts} 字体`
  }

  function renderPickerBreadcrumb(data) {
    if (!pickerBreadcrumbEl) return
    const crumbs = data.breadcrumbs || []
    if (!crumbs.length) {
      pickerBreadcrumbEl.innerHTML = ''
      return
    }
    pickerBreadcrumbEl.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0 ? '<span class="font-file-picker-crumb-sep">/</span>' : ''
      const isLast = i === crumbs.length - 1
      if (isLast) {
        return `${sep}<span class="font-file-picker-crumb is-current">${escapeHtml(c.name)}</span>`
      }
      return `${sep}<button type="button" class="font-file-picker-crumb" data-path="${escapeHtml(c.path)}">${escapeHtml(c.name)}</button>`
    }).join('')
  }

  function renderPickerTable(data) {
    if (!pickerListEl) return
    const filter = pickerFilterText.trim().toLowerCase()
    const dirs = (data.dirs || []).filter((d) => !filter || d.name.toLowerCase().includes(filter))
    const files = (data.files || []).filter((f) => !filter || f.name.toLowerCase().includes(filter))
    const rows = []

    for (const d of dirs) {
      const countHint = d.itemCount != null ? `（${d.itemCount} 项）` : ''
      rows.push(`
        <tr class="font-file-picker-row font-file-picker-row--dir" data-path="${escapeHtml(d.path)}" tabindex="0">
          <td class="font-file-picker-name">
            <span class="font-file-picker-icon" aria-hidden="true">📁</span>
            <span>${escapeHtml(d.name)}${escapeHtml(countHint)}</span>
          </td>
          <td class="font-file-picker-col-type">文件夹</td>
          <td class="font-file-picker-col-size">—</td>
          <td class="font-file-picker-col-time">—</td>
        </tr>
      `)
    }
    for (const f of files) {
      const isFont = f.kind === 'font' && f.url
      const selected = isFont && pickerSelection?.url === f.url
      const rowClass = isFont
        ? 'font-file-picker-row--font'
        : 'font-file-picker-row--other'
      const typeLabel = isFont ? '字体' : (f.ext ? f.ext.slice(1).toUpperCase() : '文件')
      rows.push(`
        <tr class="font-file-picker-row ${rowClass}${selected ? ' is-selected' : ''}"
          ${isFont ? `data-url="${escapeHtml(f.url)}" data-name="${escapeHtml(f.name)}"` : ''} tabindex="0">
          <td class="font-file-picker-name">
            <span class="font-file-picker-icon" aria-hidden="true">${isFont ? '𝐓' : '📄'}</span>
            <span>${escapeHtml(f.name)}</span>
          </td>
          <td class="font-file-picker-col-type">${escapeHtml(typeLabel)}</td>
          <td class="font-file-picker-col-size">${escapeHtml(formatBytes(f.size))}</td>
          <td class="font-file-picker-col-time">${escapeHtml(formatMtime(f.mtime))}</td>
        </tr>
      `)
    }

    pickerListEl.innerHTML = rows.join('')
    const totalDirs = (data.dirs || []).length
    const totalFiles = (data.files || []).length
    const hasAny = totalDirs + totalFiles > 0
    const filteredEmpty = !dirs.length && !files.length
    if (pickerEmptyEl) {
      if (!hasAny) {
        pickerEmptyEl.hidden = false
        pickerEmptyEl.textContent = '文件夹为空'
      } else if (filter && filteredEmpty) {
        pickerEmptyEl.hidden = false
        pickerEmptyEl.textContent = '无匹配项'
      } else {
        pickerEmptyEl.hidden = true
      }
    }
    renderPickerStats(data)
    setPickerStatus('')
    if (pickerUpBtn) pickerUpBtn.disabled = !data.parent
    if (pickerPathDisplayEl) pickerPathDisplayEl.textContent = data.path || pickerCurrentPath
    renderPickerBreadcrumb(data)
    updatePickerSelectionUI()
  }

  async function loadPickerAt(path) {
    pickerCurrentPath = path || 'public/font'
    if (pickerListEl) {
      pickerListEl.innerHTML = '<tr><td colspan="4" class="font-file-picker-loading">加载中…</td></tr>'
    }
    if (pickerEmptyEl) pickerEmptyEl.hidden = true
    setPickerStatus('')
    const data = await api.browseFontFiles(pickerCurrentPath)
    pickerBrowseCache = data
    pickerCurrentPath = data.path || pickerCurrentPath
    renderPickerTable(data)
    return data
  }

  function newId() {
    return `src-${Date.now().toString(36)}`
  }

  function labelKey(label) {
    return String(label || '').trim().toLowerCase() || '未命名'
  }

  function getDuplicateEnabledLabelKeys(sources) {
    const counts = new Map()
    for (const s of sources) {
      if (!s.enabled) continue
      const key = labelKey(s.label)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }

  function validateEnabledLabelsUnique(sources) {
    const seen = new Map()
    for (const s of sources) {
      if (!s.enabled) continue
      const key = labelKey(s.label)
      const display = String(s.label || '').trim() || '未命名'
      if (seen.has(key)) {
        return `同名冲突：「${display}」`
      }
      seen.set(key, display)
    }
    return null
  }

  function uncheckOtherEnabledWithSameLabel(currentLi, label) {
    const key = labelKey(label)
    listEl.querySelectorAll('.fonts-row').forEach((other) => {
      if (other === currentLi) return
      const otherLabel = other.querySelector('.font-label')?.value?.trim() || '未命名'
      if (labelKey(otherLabel) !== key) return
      const otherEnabled = other.querySelector('.font-enabled')
      if (otherEnabled?.checked) otherEnabled.checked = false
    })
  }

  function normalizeSourceUrls(source) {
    /** @type {{ url: string, enabled: boolean }[]} */
    let entries = []
    if (Array.isArray(source.urls) && source.urls.length) {
      entries = source.urls.map((entry) => ({
        url: String(entry?.url || '').trim(),
        enabled: entry?.enabled !== false,
      }))
    } else {
      const single = String(source.url || '').trim()
      entries = single ? [{ url: single, enabled: true }] : [{ url: '', enabled: true }]
    }
    let picked = false
    return entries.map((entry) => {
      if (entry.enabled && !picked) {
        picked = true
        return { ...entry, enabled: true }
      }
      return { ...entry, enabled: false }
    })
  }

  function collectUrlSuggestions(sources) {
    const seen = new Set()
    /** @type {string[]} */
    const urls = []
    for (const source of sources) {
      for (const entry of normalizeSourceUrls(source)) {
        const url = String(entry.url || '').trim()
        if (!url || seen.has(url)) continue
        seen.add(url)
        urls.push(url)
      }
    }
    return urls
  }

  function renderUrlSuggestions(sources) {
    const datalist = container.querySelector('#font-url-suggestions')
    if (!datalist) return
    datalist.innerHTML = collectUrlSuggestions(sources)
      .map((url) => `<option value="${escapeHtml(url)}"></option>`)
      .join('')
  }

  function urlKindMeta(url) {
    const raw = String(url || '').trim()
    if (/^https?:\/\//i.test(raw)) return { label: 'CDN', className: 'fonts-tag--cdn' }
    if (raw.startsWith('/font') || raw.startsWith('/')) return { label: '本地', className: 'fonts-tag--local' }
    return { label: '路径', className: 'fonts-tag--path' }
  }

  /** 检测当前是否为本地开发环境 */
  function isLocalDev() {
    const host = window.location.hostname || ''
    return host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')
      || host.startsWith('10.') || host.startsWith('172.')
  }

  /** 返回当前环境下会被优先使用的 URL 类型 */
  function envPreferredUrlType() {
    return isLocalDev() ? 'local' : 'cdn'
  }

  function detectFontUrlType(url) {
    const raw = String(url || '').trim()
    if (/^https?:\/\//i.test(raw)) return 'cdn'
    if (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) return 'local'
    return 'path'
  }

  function testStateKey(sourceId, url) {
    return `${sourceId}::${String(url || '').trim()}`
  }

  function renderTestBadge(sourceId, url) {
    const key = testStateKey(sourceId, url)
    const state = urlTestState.get(key)
    if (!state || state.status === 'idle') {
      return '<button type="button" class="fonts-dot fonts-dot--idle" title="点击测试" aria-label="测试"></button>'
    }
    if (state.status === 'loading') {
      return '<span class="fonts-dot fonts-dot--loading" title="测试中"></span>'
    }
    if (state.status === 'ok') {
      return `<button type="button" class="fonts-dot fonts-dot--ok" title="${escapeHtml(state.message || '可用')}" aria-label="可用"></button>`
    }
    return `<button type="button" class="fonts-dot fonts-dot--fail" title="${escapeHtml(state.message || '失败')}" aria-label="失败"></button>`
  }

  async function runFontTest(sourceId, url, { refresh = true } = {}) {
    const trimmed = String(url || '').trim()
    if (!trimmed) {
      setStatus('请先填写地址', 'warning')
      return null
    }
    const key = testStateKey(sourceId, trimmed)
    urlTestState.set(key, { status: 'loading' })
    if (refresh) renderList(readListFromDom().sources)
    try {
      const result = await api.testFontUrl(trimmed)
      if (!result?.ok) {
        const errMsg = result?.error || '测试失败'
        urlTestState.set(key, { status: 'fail', message: errMsg })
        if (refresh) renderList(readListFromDom().sources)
        setStatus(errMsg, 'error')
        return null
      }
      urlTestState.set(key, { status: 'ok', message: result.message || '可用' })
      if (refresh) renderList(readListFromDom().sources)
      setStatus(result.message || '字体可用', 'success')
      return result
    } catch (err) {
      const errMsg = err.message || '测试失败'
      urlTestState.set(key, { status: 'fail', message: errMsg })
      if (refresh) renderList(readListFromDom().sources)
      setStatus(errMsg, 'error')
      return null
    }
  }

  function renderUrlEntries(sourceId, urls) {
    const entries = urls.length ? urls : [{ url: '', enabled: true }]
    const groupName = `font-url-${sourceId}`
    const envType = envPreferredUrlType()
    return entries.map((entry) => {
      const kind = urlKindMeta(entry.url)
      const matchesEnv = detectFontUrlType(entry.url) === envType
      return `
      <div class="fonts-url-entry${entry.enabled ? ' is-active' : ''}${matchesEnv ? ' is-env-match' : ''}">
        <input type="radio" class="font-url-enabled" name="${escapeHtml(groupName)}" ${entry.enabled ? 'checked' : ''} title="当前地址" />
        <span class="fonts-tag-cell">
          <span class="fonts-tag ${kind.className}">${kind.label}</span>
        </span>
        <input type="text" class="font-url" value="${escapeHtml(entry.url)}" list="font-url-suggestions" placeholder="https://… 或 /font/…" spellcheck="false" />
        ${renderTestBadge(sourceId, entry.url)}
        <div class="fonts-entry-act">
          <button type="button" class="fonts-act-btn font-url-add" title="增加地址">增加</button>
          <button type="button" class="fonts-act-btn font-pick-project" title="浏览">浏览</button>
          <button type="button" class="fonts-act-btn font-test" title="测试">测试</button>
          <button type="button" class="fonts-act-btn font-delete" title="删除">删除</button>
        </div>
      </div>`
    }).join('')
  }

  function renderList(sourceList = null) {
    const sources = sourceList
      ?? (listEl.querySelector('.fonts-row') ? readListFromDom().sources : config.sources)
    if (!sources.length) {
      listEl.innerHTML = '<li class="fonts-empty">暂无字体，点击下方添加</li>'
      return
    }
    const dupKeys = getDuplicateEnabledLabelKeys(sources)
    renderUrlSuggestions(sources)
    listEl.innerHTML = sources
      .map((s) => {
        const dup = s.enabled && dupKeys.has(labelKey(s.label))
        const urls = normalizeSourceUrls(s)
        return `
    <li class="fonts-row${dup ? ' fonts-row--dup' : ''}${s.enabled ? '' : ' fonts-row--off'}" data-id="${escapeHtml(s.id)}">
      <input type="checkbox" class="font-enabled" ${s.enabled ? 'checked' : ''} title="启用" />
      <div class="fonts-row-body">
        <input type="text" class="font-label" value="${escapeHtml(s.label)}" placeholder="名称" />
        <div class="fonts-url-list">${renderUrlEntries(s.id, urls)}</div>
      </div>
    </li>`
      })
      .join('')
    if (dupKeys.size) setStatus('同名冲突：请改名或取消重复启用', 'warning')
  }

  function readUrlsFromItem(li) {
    /** @type {{ url: string, enabled: boolean }[]} */
    const urls = []
    li.querySelectorAll('.fonts-url-entry').forEach((row) => {
      const url = row.querySelector('.font-url')?.value?.trim() || ''
      const enabled = row.querySelector('.font-url-enabled')?.checked ?? false
      urls.push({ url, enabled })
    })
    if (!urls.some((entry) => entry.enabled) && urls.length) {
      urls[0].enabled = true
    }
    return urls.length ? urls : [{ url: '', enabled: true }]
  }

  function guessLocalFontUrl(activeUrl) {
    const raw = String(activeUrl || '').trim()
    if (!raw) return ''
    try {
      const name = decodeURIComponent(raw.split('/').pop()?.split('?')[0] || '')
      if (!name || !/\.(ttf|otf|woff2?)$/i.test(name)) return ''
      return `/font/${name}`
    } catch {
      return ''
    }
  }

  function mergeSourcesWithPreviousUrls(nextSources, prevSources) {
    return nextSources.map((next) => {
      const prev = prevSources.find((s) => s.id === next.id)
      if (!prev) return next
      /** @type {{ url: string, enabled: boolean }[]} */
      const merged = [...(next.urls || [])]
      const prevNormalized = normalizeSourceUrls(prev)
      const prevActive = prevNormalized.find((entry) => entry.enabled)?.url || prev.url
      const nextActive = merged.find((entry) => entry.enabled)?.url || next.url
      if (prevActive && nextActive && prevActive !== nextActive && !merged.some((entry) => entry.url === prevActive)) {
        merged.push({ url: prevActive, enabled: false })
      }
      let picked = false
      const urls = merged.map((entry) => {
        if (entry.enabled && !picked) {
          picked = true
          return { ...entry, enabled: true }
        }
        return { ...entry, enabled: false }
      })
      if (!urls.some((entry) => entry.enabled) && urls.length) urls[0].enabled = true
      return {
        ...next,
        urls,
        url: urls.find((entry) => entry.enabled)?.url || urls[0]?.url || '',
      }
    })
  }

  function readListFromDom() {
    const sources = []
    listEl.querySelectorAll('.fonts-row').forEach((li) => {
      const id = li.dataset.id
      const enabled = li.querySelector('.font-enabled')?.checked ?? true
      const label = li.querySelector('.font-label')?.value?.trim() || '未命名'
      const urls = readUrlsFromItem(li)
      const primary = urls.find((entry) => entry.enabled && entry.url)?.url
        || urls.find((entry) => entry.url)?.url
        || ''
      sources.push({ id, label, url: primary, urls, enabled })
    })
    const enabledSources = sources.filter((s) => s.enabled)
    let activeId = config.activeId
    if (!enabledSources.some((s) => s.id === activeId)) {
      activeId = enabledSources[0]?.id || sources[0]?.id || ''
    }
    return { activeId, sources }
  }

  function confirmPickerSelection() {
    if (!pickerSelection) return
    applyPickedFont(pickerSelection.url, pickerSelection.name)
    closeFontPicker()
  }

  async function openProjectFontPicker(li, urlRow = null) {
    pickerTargetRow = li
    pickerTargetUrlRow = urlRow
    pickerSelection = null
    pickerFilterText = ''
    if (pickerFilterEl) pickerFilterEl.value = ''
    pickerCurrentPath = 'public/font'
    const urlInput = urlRow?.querySelector('.font-url') || li?.querySelector('.font-url')
    const urlValue = urlInput?.value?.trim()
    if (urlValue?.startsWith('/')) {
      const segments = urlValue.replace(/^\/+/, '').split('/').filter(Boolean)
      if (segments.length > 1) {
        segments.pop()
        const derived = `public/${segments.join('/')}`
        if (derived.startsWith('public/') && derived.length > 'public'.length) {
          pickerCurrentPath = derived
        }
      }
    }
    try {
      await loadPickerAt(pickerCurrentPath)
      pickerDialog?.showModal()
    } catch (err) {
      setPickerStatus(err.message || '无法读取目录', true)
      setStatus(err.message || '无法浏览项目目录', 'error')
    }
  }

  function applyPickedFont(url, name) {
    if (!pickerTargetRow) return
    const urlRow = pickerTargetUrlRow || pickerTargetRow.querySelector('.fonts-url-entry:first-child')
    const urlInput = urlRow?.querySelector('.font-url') || pickerTargetRow.querySelector('.font-url')
    if (urlInput) urlInput.value = url
    pickerTargetRow.querySelectorAll('.fonts-url-entry .font-url-enabled').forEach((input) => {
      input.checked = false
    })
    const enabledInput = urlRow?.querySelector('.font-url-enabled')
    if (enabledInput) enabledInput.checked = true
    const labelInput = pickerTargetRow.querySelector('.font-label')
    if (labelInput) {
      const cur = labelInput.value.trim()
      if (!cur || cur === '新字体源' || cur === '未命名') {
        const stem = String(name || '').replace(/\.[^.]+$/, '')
        if (stem) labelInput.value = stem
      }
    }
    setStatus(`已选择 ${url}`, 'success')
    pickerTargetRow = null
    pickerTargetUrlRow = null
  }

  async function loadConfig() {
    const data = await api.getFontSettings()
    if (!data || !Array.isArray(data.sources)) {
      throw new Error('接口返回异常，请确认后端已更新并重启 PM2')
    }
    config = {
      activeId: data.activeId || data.sources?.[0]?.id || '',
      sources: data.sources,
    }
    renderList(config.sources)
    setStatus('')
  }

  async function saveConfig() {
    let body = readListFromDom()
    body = {
      ...body,
      sources: mergeSourcesWithPreviousUrls(body.sources, config.sources),
    }
    const labelErr = validateEnabledLabelsUnique(body.sources)
    if (labelErr) {
      setStatus(labelErr, 'error')
      renderList(body.sources)
      return
    }
    const data = await api.updateFontSettings(body)
    config = { activeId: data.activeId, sources: data.sources }
    renderList(config.sources)
    setStatus('正在保存…')
    try {
      const { errors } = await reloadApplicationFonts()
      if (errors.length) {
        setStatus(`已保存，${errors.length} 项加载失败`, 'warning')
      } else {
        setStatus('配置已保存并生效', 'success')
      }
    } catch (err) {
      setStatus(`已保存，重载失败：${err.message || err}`, 'warning')
    }
  }

  listEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('font-url-enabled')) {
      const li = e.target.closest('.fonts-row')
      li?.querySelectorAll('.fonts-url-entry').forEach((row) => {
        row.classList.toggle('is-active', !!row.querySelector('.font-url-enabled')?.checked)
      })
      return
    }

    const enabledInput = e.target.closest('.font-enabled')
    if (enabledInput) {
      const li = enabledInput.closest('.fonts-row')
      if (!li) return
      li.classList.toggle('fonts-row--off', !enabledInput.checked)
      if (enabledInput.checked) {
        const label = li.querySelector('.font-label')?.value?.trim() || '未命名'
        uncheckOtherEnabledWithSameLabel(li, label)
        config = readListFromDom()
        renderList(config.sources)
      }
      return
    }

    const labelInput = e.target.closest('.font-label')
    if (labelInput) {
      const li = labelInput.closest('.fonts-row')
      const enabled = li?.querySelector('.font-enabled')?.checked
      if (enabled && li) {
        const label = labelInput.value.trim() || '未命名'
        uncheckOtherEnabledWithSameLabel(li, label)
        config = readListFromDom()
        const err = validateEnabledLabelsUnique(config.sources)
        renderList(config.sources)
        if (err) setStatus(err, 'error')
      }
    }
  })

  listEl.addEventListener('click', async (e) => {
    const badge = e.target.closest('.fonts-dot')
    const actBtn = e.target.closest('.fonts-act-btn')
    const urlRow = e.target.closest('.fonts-url-entry')
    const li = e.target.closest('.fonts-row')

    if (badge && !badge.classList.contains('fonts-dot--loading')) {
      if (!li) return
      const url = urlRow?.querySelector('.font-url')?.value?.trim()
      if (url) void runFontTest(li.dataset.id, url)
      return
    }

    if (!actBtn || !li) return
    const id = li.dataset.id

    if (actBtn.classList.contains('font-url-add')) {
      config = readListFromDom()
      const item = config.sources.find((s) => s.id === id)
      if (item) {
        const urls = readUrlsFromItem(li)
        const active = urls.find((entry) => entry.enabled) || urls[0]
        const localUrl = guessLocalFontUrl(active?.url)
        if (urls.length === 1 && localUrl && !urls.some((entry) => entry.url === localUrl)) {
          item.urls = [{ ...urls[0], enabled: true }, { url: localUrl, enabled: false }]
          renderList(config.sources)
          setStatus(`已添加本地备用 ${localUrl}`, 'success')
          return
        }
        item.urls = urls.map((entry) => ({ ...entry, enabled: false }))
        item.urls.unshift({ url: '', enabled: true })
      }
      renderList(config.sources)
      listEl.querySelector(`.fonts-row[data-id="${CSS.escape(id)}"]`)
        ?.querySelector('.fonts-url-entry:first-child .font-url')?.focus()
      return
    }

    if (actBtn.classList.contains('font-pick-project')) {
      void openProjectFontPicker(li, urlRow)
      return
    }

    if (actBtn.classList.contains('font-test')) {
      const url = urlRow?.querySelector('.font-url')?.value?.trim()
      if (!url) {
        setStatus('请先填写地址', 'warning')
        return
      }
      void runFontTest(id, url)
      return
    }

    if (actBtn.classList.contains('font-delete')) {
      const rows = li.querySelectorAll('.fonts-url-entry')
      if (rows.length <= 1) {
        config = readListFromDom()
        config.sources = config.sources.filter((s) => s.id !== id)
        if (config.activeId === id) {
          config.activeId = config.sources.find((s) => s.enabled)?.id || config.sources[0]?.id || ''
        }
        renderList(config.sources)
        return
      }
      if (!urlRow) return
      const removingActive = urlRow.querySelector('.font-url-enabled')?.checked
      urlRow.remove()
      if (removingActive) {
        const firstRadio = li.querySelector('.fonts-url-entry:first-child .font-url-enabled')
        if (firstRadio) firstRadio.checked = true
      }
      config = readListFromDom()
      renderList(config.sources)
    }
  })

  function navigatePickerTo(path) {
    loadPickerAt(path).catch((err) => {
      setPickerStatus(err.message || '无法进入目录', true)
      setStatus(err.message || '无法进入目录', 'error')
    })
  }

  pickerBreadcrumbEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-path]')
    if (!btn?.dataset.path) return
    navigatePickerTo(btn.dataset.path)
  })

  pickerUpBtn?.addEventListener('click', () => {
    if (!pickerBrowseCache?.parent) return
    navigatePickerTo(pickerBrowseCache.parent)
  })

  pickerGoFontBtn?.addEventListener('click', () => {
    navigatePickerTo('public/font')
  })

  pickerRefreshBtn?.addEventListener('click', () => {
    navigatePickerTo(pickerCurrentPath)
  })

  pickerFilterEl?.addEventListener('input', () => {
    pickerFilterText = pickerFilterEl.value
    if (pickerBrowseCache) renderPickerTable(pickerBrowseCache)
  })

  pickerListEl?.addEventListener('click', (e) => {
    const enterBtn = e.target.closest('.font-picker-enter')
    if (enterBtn?.dataset.path) {
      e.preventDefault()
      navigatePickerTo(enterBtn.dataset.path)
      return
    }
    const row = e.target.closest('.font-file-picker-row')
    if (!row) return
    if (row.classList.contains('font-file-picker-row--dir')) {
      const p = row.dataset.path
      if (p) navigatePickerTo(p)
      return
    }
    if (row.classList.contains('font-file-picker-row--font')) {
      pickerSelection = { url: row.dataset.url || '', name: row.dataset.name || '' }
      updatePickerSelectionUI()
    }
  })

  pickerListEl?.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.font-file-picker-row')
    if (!row) return
    if (row.classList.contains('font-file-picker-row--dir')) {
      const p = row.dataset.path
      if (p) navigatePickerTo(p)
      return
    }
    if (row.classList.contains('font-file-picker-row--font')) {
      pickerSelection = { url: row.dataset.url || '', name: row.dataset.name || '' }
      confirmPickerSelection()
    }
  })

  pickerConfirmBtn?.addEventListener('click', () => confirmPickerSelection())
  pickerCancelBtn?.addEventListener('click', () => closeFontPicker())
  pickerCloseBtn?.addEventListener('click', () => closeFontPicker())

  addBtn.addEventListener('click', () => {
    config = readListFromDom()
    const id = newId()
    config.sources.push({
      id,
      label: '新字体',
      url: '',
      urls: [{ url: '', enabled: true }],
      enabled: true,
    })
    if (!config.activeId) config.activeId = id
    renderList(config.sources)
  })

  saveBtn.addEventListener('click', () => {
    saveConfig().catch((err) => setStatus(err.message || '保存失败', 'error'))
  })

  return {
    async init() {
      try {
        await loadConfig()
      } catch (err) {
        setStatus(err.message || '加载失败', 'error')
      }
    },
  }
}

// 独立页面入口：重定向到主后台
if (document.body?.classList.contains('fonts-page-standalone')) {
  const next = new URL('/admin.html', window.location.origin)
  next.searchParams.set('view', 'fonts')
  window.location.replace(next.pathname + next.search)
}
