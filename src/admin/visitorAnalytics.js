/**
 * src/admin/visitorAnalytics.js
 * 访客行为分析面板（90 天保留，分页，51.la 风格 IP 轨迹）
 */

const ACTIVITY_LABELS = {
  login: '登录',
  visitor_login: '访客登录',
  admin_login: '管理端登录',
  page_visit: '访问页面',
  page_view: '浏览证书',
  pdf_download: '下载 PDF',
  svg_download: '下载 SVG',
}

const EXPORT_MODE_LABELS = {
  single: '单页导出',
  batch_merge: '合并多页 PDF',
  batch_split: '每页独立 PDF（ZIP）',
}

function formatSeconds(sec) {
  if (sec == null || sec === 0) return '—'
  if (sec < 60) return `${Math.round(sec)} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分`
  return `${(sec / 3600).toFixed(1)} 时`
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatTimeShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function activityBadge(type) {
  const label = ACTIVITY_LABELS[type] || type
  const cls = type.includes('download')
    ? 'va-badge--download'
    : (type === 'login' || type === 'admin_login' || type === 'visitor_login')
      ? 'va-badge--login'
      : 'va-badge--view'
  return `<span class="va-badge ${cls}">${label}</span>`
}

function formatIp(ip) {
  if (!ip || ip === '未知') return '未知'
  if (ip === '127.0.0.1' || ip === '::1') return '127.0.0.1（本地）'
  return ip
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(str || '').replace(/[&<>"']/g, (c) => map[c])
}

function eventPathLabel(event) {
  const d = event.details || {}
  if (event.activity_type === 'page_visit') {
    return String(d.url || d.path || '访问页面')
  }
  if (event.activity_type === 'admin_login') {
    return String(d.page_url || d.url || d.path || '管理端登录')
  }
  if (event.activity_type === 'visitor_login') {
    return String(d.page_url || d.url || d.path || '访客登录')
  }
  if (event.activity_type === 'page_view' && event.cert_title) return String(event.cert_title).trim()
  if (event.activity_type === 'pdf_download') {
    return d.filename ? `下载 PDF · ${d.filename}` : '下载 PDF'
  }
  if (event.activity_type === 'svg_download') {
    return d.filename ? `下载 SVG · ${d.filename}` : '下载 SVG'
  }
  return ACTIVITY_LABELS[event.activity_type] || event.activity_type || '活动'
}

function detailModeLabel(mode) {
  return EXPORT_MODE_LABELS[mode] || mode || '—'
}

function pageUrlFromEvent(event) {
  const d = event.details || {}
  return String(d.url || d.page_url || d.path || '').trim()
}

function renderPageUrlCell(event) {
  const url = pageUrlFromEvent(event)
  if (event.activity_type === 'page_visit' || event.activity_type === 'admin_login' || event.activity_type === 'visitor_login') {
    if (url) {
      const href = url.startsWith('http') ? url : url
      return `<a class="va-page-url" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">${escapeHtml(detailPathDisplay(event))}</a>`
    }
  }
  if (event.activity_type === 'page_view' && event.cert_title) {
    return escapeHtml(event.cert_title)
  }
  if (event.cert_title) return escapeHtml(event.cert_title)
  return '—'
}

function detailPathDisplay(event) {
  const d = event.details || {}
  return String(d.path || d.url || d.page_url || '—')
}

function formatDetailRows(event) {
  const d = event.details || {}
  /** @type {[string, string][]} */
  const rows = [
    ['活动', ACTIVITY_LABELS[event.activity_type] || event.activity_type],
    ['时间', formatTime(event.created_at)],
    ['访客', event.visitor_name || '匿名'],
    ['IP', formatIp(event.ip_address)],
    ['归属地', event.ip_location || '—'],
  ]
  const url = pageUrlFromEvent(event)
  if (url) rows.push(['访问地址', url])
  if (d.title) rows.push(['页面标题', String(d.title)])
  if (d.filename) rows.push(['文件名', String(d.filename)])
  if (d.mode) rows.push(['导出模式', detailModeLabel(String(d.mode))])
  if (d.pages != null) rows.push(['页数', String(d.pages)])
  if (d.row_index != null) rows.push(['表格行', String(Number(d.row_index) + 1)])
  if (d.page_label) rows.push(['页标签', String(d.page_label)])
  if (event.cert_title) rows.push(['证书', event.cert_title])
  if (d.cert_title && !event.cert_title) rows.push(['证书', String(d.cert_title)])
  if (d.username) rows.push(['用户名', String(d.username)])
  if (d.role) rows.push(['角色', String(d.role)])
  if (d.scope) rows.push(['范围', d.scope === 'admin' ? '管理端' : '公众页'])
  if (d.next) rows.push(['登录后跳转', String(d.next)])
  if (event.referrer) rows.push(['来源页', event.referrer])
  if (event.duration_seconds > 0) rows.push(['停留', formatSeconds(event.duration_seconds)])
  return rows
}

function renderActivityCell(event, index) {
  const downloadable = event.activity_type === 'pdf_download' || event.activity_type === 'svg_download'
  if (downloadable) {
    return `<button type="button" class="va-detail-btn" data-event-index="${index}" title="查看下载详情">${activityBadge(event.activity_type)}<span class="va-detail-btn-hint">详情</span></button>`
  }
  return activityBadge(event.activity_type)
}

/**
 * @param {HTMLElement} container
 */
export async function mountVisitorAnalyticsPanel(container) {
  container.innerHTML = `
    <div class="wp-settings-panel-inner visitor-analytics-panel">
      <div class="va-header">
        <h3>访客分析</h3>
        <div class="va-controls">
          <label class="va-range-label">
            <select id="va-range" class="va-select">
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
              <option value="90d" selected>最近 90 天</option>
            </select>
          </label>
          <button type="button" class="button button-sm" id="va-refresh">刷新</button>
        </div>
      </div>
      <p class="va-retention-hint">访客记录保留 <strong>90</strong> 天，超期自动清理。</p>

      <div class="va-summary-cards" id="va-summary">
        <div class="va-card va-card--loading"><span class="va-card-value">—</span><span class="va-card-label">加载中…</span></div>
      </div>

      <div class="va-section">
        <h4 class="va-section-title">每日趋势</h4>
        <div class="va-chart" id="va-chart"><p class="va-empty">加载中…</p></div>
      </div>

      <div class="va-section va-section--full">
        <h4 class="va-section-title">热门证书 TOP 20</h4>
        <div class="va-table-wrap" id="va-top-certs"><p class="va-empty">加载中…</p></div>
      </div>

      <div class="va-section va-section--full">
        <h4 class="va-section-title">
          访客轨迹（按 IP）
          <span class="va-section-hint" id="va-trails-count"></span>
        </h4>
        <div class="va-table-wrap va-table-wrap--wide" id="va-trails"><p class="va-empty">加载中…</p></div>
        <div class="va-pager" id="va-trails-pager" hidden></div>
      </div>

      <div class="va-section va-section--full">
        <h4 class="va-section-title">
          最近活动
          <span class="va-section-hint" id="va-recent-count"></span>
        </h4>
        <div class="va-table-wrap va-table-wrap--wide" id="va-recent"><p class="va-empty">加载中…</p></div>
        <div class="va-pager" id="va-recent-pager" hidden></div>
      </div>

      <dialog class="va-event-dialog" id="va-event-dialog">
        <div class="va-event-dialog-head">
          <h4 id="va-event-dialog-title">活动详情</h4>
          <button type="button" class="va-event-dialog-close" id="va-event-dialog-close" aria-label="关闭">×</button>
        </div>
        <dl class="va-event-detail-list" id="va-event-dialog-body"></dl>
      </dialog>
    </div>
  `

  const rangeEl = container.querySelector('#va-range')
  const refreshBtn = container.querySelector('#va-refresh')

  let recentPage = 1
  let trailsPage = 1
  /** @type {string | null} */
  let expandedTrailIp = null
  /** @type {Map<string, object[]>} */
  const trailEventsCache = new Map()
  /** @type {object[]} */
  let recentEventsCache = []
  /** @type {object[]} */
  let detailEventsCache = []

  const eventDialog = container.querySelector('#va-event-dialog')
  const eventDialogBody = container.querySelector('#va-event-dialog-body')
  const eventDialogTitle = container.querySelector('#va-event-dialog-title')
  container.querySelector('#va-event-dialog-close')?.addEventListener('click', () => eventDialog?.close())
  eventDialog?.addEventListener('click', (e) => {
    if (e.target === eventDialog) eventDialog.close()
  })

  function showEventDetailModal(event) {
    if (!eventDialog || !eventDialogBody) return
    eventDialogTitle.textContent = ACTIVITY_LABELS[event.activity_type] || '活动详情'
    eventDialogBody.innerHTML = formatDetailRows(event).map(([k, v]) => {
      const val = (k === '访问地址' || k === '来源页') && v && v !== '—'
        ? `<a href="${escapeHtml(v.startsWith('http') ? v : v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`
        : escapeHtml(v)
      return `<div class="va-event-detail-row"><dt>${escapeHtml(k)}</dt><dd>${val}</dd></div>`
    }).join('')
    eventDialog.showModal()
  }

  function bindDetailButtons(scope, events) {
    detailEventsCache = events
    scope.querySelectorAll('.va-detail-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const idx = Number(btn.dataset.eventIndex)
        const event = detailEventsCache[idx]
        if (event) showEventDetailModal(event)
      })
    })
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'include' })
    const data = await res.json()
    if (!res.ok || !data?.ok) throw new Error(data?.error || '加载失败')
    return data
  }

  function getRange() {
    return rangeEl?.value || '90d'
  }

  function renderPager(el, pagination, onPage) {
    if (!el || !pagination) {
      if (el) el.hidden = true
      return
    }
    const { page, total_pages, total, page_size, has_prev, has_next } = pagination
    el.hidden = total_pages <= 1 && total <= page_size
    el.innerHTML = `
      <button type="button" class="button button-sm va-pager-btn" data-dir="prev"${has_prev ? '' : ' disabled'}>上一页</button>
      <span class="va-pager-info">第 ${page} / ${total_pages} 页 · 共 ${total} 条 · 每页 ${page_size} 条</span>
      <button type="button" class="button button-sm va-pager-btn" data-dir="next"${has_next ? '' : ' disabled'}>下一页</button>
    `
    el.querySelector('[data-dir="prev"]')?.addEventListener('click', () => {
      if (has_prev) onPage(page - 1)
    })
    el.querySelector('[data-dir="next"]')?.addEventListener('click', () => {
      if (has_next) onPage(page + 1)
    })
  }

  async function loadOverview() {
    const data = await fetchJson(`/api/analytics/visitors?range=${encodeURIComponent(getRange())}`)
    renderSummary(data.summary)
    renderChart(data.daily_stats || [])
    renderTopCerts(data.top_certs || [])
  }

  async function loadRecent(page = recentPage) {
    recentPage = page
    const data = await fetchJson(
      `/api/analytics/visitors/recent?range=${encodeURIComponent(getRange())}&page=${page}&page_size=50`,
    )
    renderRecentActivity(data.items || [], data.pagination)
    renderPager(container.querySelector('#va-recent-pager'), data.pagination, loadRecent)
  }

  async function loadTrails(page = trailsPage) {
    trailsPage = page
    expandedTrailIp = null
    trailEventsCache.clear()
    const data = await fetchJson(
      `/api/analytics/visitors/trails?range=${encodeURIComponent(getRange())}&page=${page}&page_size=15`,
    )
    renderVisitorTrails(data.items || [], data.pagination)
    renderPager(container.querySelector('#va-trails-pager'), data.pagination, loadTrails)
  }

  async function loadAll() {
    try {
      await Promise.all([loadOverview(), loadRecent(1), loadTrails(1)])
    } catch (err) {
      container.querySelector('#va-summary').innerHTML =
        `<p class="va-error">加载失败: ${escapeHtml(err.message)}</p>`
    }
  }

  function renderSummary(s) {
    const cards = [
      { value: s?.total_events ?? 0, label: '总访问' },
      { value: s?.unique_visitors ?? 0, label: '独立访客' },
      { value: s?.total_downloads ?? 0, label: '下载次数' },
      { value: formatSeconds(s?.avg_duration_seconds), label: '平均时长' },
    ]
    container.querySelector('#va-summary').innerHTML = cards.map((c) => `
      <div class="va-card">
        <span class="va-card-value">${c.value}</span>
        <span class="va-card-label">${c.label}</span>
      </div>
    `).join('')
  }

  function renderChart(stats) {
    const el = container.querySelector('#va-chart')
    if (!stats.length) {
      el.innerHTML = '<p class="va-empty">暂无数据</p>'
      return
    }
    const maxPv = Math.max(...stats.map((s) => s.pv), 1)
    const maxDownloads = Math.max(...stats.map((s) => s.downloads), 1)
    const maxAll = Math.max(maxPv, maxDownloads)
    const bars = stats.map((s) => {
      const dateLabel = s.date_key.includes('T')
        ? s.date_key.slice(11, 16)
        : s.date_key.slice(5)
      const pvPct = maxAll > 0 ? (s.pv / maxAll) * 100 : 0
      const dlPct = maxAll > 0 ? (s.downloads / maxAll) * 100 : 0
      return `
        <div class="va-chart-col" title="${dateLabel} 访问 ${s.pv} · 下载 ${s.downloads}">
          <div class="va-chart-bar-stack">
            <div class="va-chart-bar va-chart-bar--pv" style="height:${pvPct}%"></div>
            <div class="va-chart-bar va-chart-bar--dl" style="height:${dlPct}%"></div>
          </div>
          <span class="va-chart-label">${dateLabel}</span>
        </div>`
    }).join('')
    el.innerHTML = `
      <div class="va-chart-legend">
        <span class="va-legend-dot va-legend-dot--pv"></span> 访问
        <span class="va-legend-dot va-legend-dot--dl"></span> 下载
      </div>
      <div class="va-chart-bars">${bars}</div>
    `
  }

  function renderTopCerts(certs) {
    const el = container.querySelector('#va-top-certs')
    if (!certs.length) {
      el.innerHTML = '<p class="va-empty">暂无数据</p>'
      return
    }
    el.innerHTML = `
      <table class="va-table">
        <thead><tr><th>#</th><th>证书</th><th>浏览</th><th>下载</th></tr></thead>
        <tbody>${certs.map((c, i) => `
          <tr>
            <td class="va-cell-rank">${i + 1}</td>
            <td class="va-cell-title" title="${escapeHtml(c.cert_title)}">${escapeHtml(c.cert_title || '—')}</td>
            <td class="va-cell-num">${c.views}</td>
            <td class="va-cell-num">${c.downloads}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `
  }

  function renderRecentActivity(items, pagination) {
    const el = container.querySelector('#va-recent')
    const countEl = container.querySelector('#va-recent-count')
    if (countEl && pagination) {
      countEl.textContent = `（共 ${pagination.total} 条，按时间倒序）`
    }
    if (!items.length) {
      el.innerHTML = '<p class="va-empty">暂无数据</p>'
      return
    }
    el.innerHTML = `
      <table class="va-table va-table--recent">
        <thead><tr>
          <th>时间</th><th>访客</th><th>活动</th><th>访问地址 / 证书</th><th>归属地</th><th>IP</th>
        </tr></thead>
        <tbody>${items.map((r, index) => `
          <tr>
            <td class="va-cell-time">${formatTime(r.created_at)}</td>
            <td>${escapeHtml(r.visitor_name || '匿名')}</td>
            <td>${renderActivityCell(r, index)}</td>
            <td class="va-cell-url">${renderPageUrlCell(r)}</td>
            <td class="va-cell-location">${escapeHtml(r.ip_location || '—')}</td>
            <td class="va-cell-ip">${escapeHtml(formatIp(r.ip_address))}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `
    recentEventsCache = items
    bindDetailButtons(el, items)
  }

  function render51Timeline(events) {
    if (!events.length) return '<p class="va-empty">暂无轨迹</p>'
    return `
      <div class="va-51-path">
        ${events.map((ev, idx) => {
          const isLast = idx === events.length - 1
          const url = pageUrlFromEvent(ev)
          const title = escapeHtml(eventPathLabel(ev))
          const urlHtml = url
            ? `<a class="va-page-url va-page-url--sm" href="${escapeHtml(url.startsWith('http') ? url : url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detailPathDisplay(ev))}</a>`
            : ''
          const downloadable = ev.activity_type === 'pdf_download' || ev.activity_type === 'svg_download'
          const actionHtml = downloadable
            ? `<button type="button" class="va-detail-btn va-detail-btn--inline" data-event-index="${idx}">${activityBadge(ev.activity_type)}<span class="va-detail-btn-hint">详情</span></button>`
            : activityBadge(ev.activity_type)
          return `
            <div class="va-51-node${isLast ? ' va-51-node--last' : ''}">
              <div class="va-51-node-time">${formatTime(ev.created_at)}</div>
              <div class="va-51-node-rail">
                <span class="va-51-node-dot"></span>
                ${isLast ? '' : '<span class="va-51-node-line"></span>'}
              </div>
              <div class="va-51-node-body">
                <div class="va-51-node-title">${title}</div>
                <div class="va-51-node-meta">${actionHtml}${ev.duration_seconds > 0 ? ` · 停留 ${formatSeconds(ev.duration_seconds)}` : ''}</div>
                ${urlHtml ? `<div class="va-51-node-url">${urlHtml}</div>` : ''}
              </div>
            </div>`
        }).join('')}
      </div>
    `
  }

  function renderVisitorTrails(items, pagination) {
    const el = container.querySelector('#va-trails')
    const countEl = container.querySelector('#va-trails-count')
    if (countEl && pagination) {
      countEl.textContent = `（共 ${pagination.total} 个 IP，点击行查看轨迹）`
    }
    if (!items.length) {
      el.innerHTML = '<p class="va-empty">暂无数据</p>'
      return
    }

    el.innerHTML = `
      <table class="va-table va-table--trails">
        <thead><tr>
          <th>#</th>
          <th>最近访问</th>
          <th>IP 地址</th>
          <th>归属地</th>
          <th>访客</th>
          <th>访问次数</th>
          <th>访问路径预览</th>
          <th></th>
        </tr></thead>
        <tbody>${items.map((t) => `
          <tr class="va-trail-row" data-ip="${escapeHtml(t.ip_address)}" tabindex="0">
            <td class="va-cell-rank">${t.rank}</td>
            <td class="va-cell-time">${formatTime(t.last_seen)}</td>
            <td class="va-cell-ip">${escapeHtml(formatIp(t.ip_address))}</td>
            <td class="va-cell-location">${escapeHtml(t.ip_location || '—')}</td>
            <td>${escapeHtml(t.visitor_name || '匿名')}</td>
            <td class="va-cell-num">${t.event_count}</td>
            <td class="va-cell-path" title="${escapeHtml(t.path_preview || '')}">${escapeHtml(t.path_preview || '—')}</td>
            <td class="va-cell-action"><span class="va-trail-toggle">查看轨迹</span></td>
          </tr>
          <tr class="va-trail-detail-row" data-ip="${escapeHtml(t.ip_address)}" hidden>
            <td colspan="8">
              <div class="va-trail-detail-inner" data-ip="${escapeHtml(t.ip_address)}">
                <p class="va-empty">加载轨迹…</p>
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    `

    el.querySelectorAll('.va-trail-row').forEach((row) => {
      row.addEventListener('click', () => toggleTrailRow(row.dataset.ip))
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggleTrailRow(row.dataset.ip)
        }
      })
    })
  }

  async function toggleTrailIp(ip) {
    const detailRow = container.querySelector(`.va-trail-detail-row[data-ip="${CSS.escape(ip)}"]`)
    const inner = detailRow?.querySelector('.va-trail-detail-inner')
    if (!detailRow || !inner) return

    if (expandedTrailIp === ip) {
      expandedTrailIp = null
      detailRow.hidden = true
      container.querySelectorAll('.va-trail-row').forEach((r) => {
        r.classList.toggle('is-expanded', false)
      })
      return
    }

    expandedTrailIp = ip
    container.querySelectorAll('.va-trail-detail-row').forEach((r) => { r.hidden = true })
    container.querySelectorAll('.va-trail-row').forEach((r) => {
      r.classList.toggle('is-expanded', r.dataset.ip === ip)
    })
    detailRow.hidden = false
    inner.innerHTML = '<p class="va-empty">加载轨迹…</p>'

    try {
      let events = trailEventsCache.get(ip)
      if (!events) {
        const data = await fetchJson(
          `/api/analytics/visitors/trail-events?range=${encodeURIComponent(getRange())}&ip=${encodeURIComponent(ip)}`,
        )
        events = data.events || []
        trailEventsCache.set(ip, events)
      }
      inner.innerHTML = `
        <div class="va-trail-detail-head">
          <strong>${escapeHtml(formatIp(ip))}</strong>
          <span class="va-ip-location">${escapeHtml(events[0]?.ip_location || '未知')}</span>
          <span class="va-trail-detail-path">${escapeHtml(buildPathPreview(events))}</span>
        </div>
        ${render51Timeline(events)}
      `
      bindDetailButtons(inner, events)
    } catch (err) {
      inner.innerHTML = `<p class="va-error">加载失败: ${escapeHtml(err.message)}</p>`
    }
  }

  function toggleTrailRow(ip) {
    void toggleTrailIp(ip)
  }

  function buildPathPreview(events, maxSteps = 6) {
    if (!events?.length) return '—'
    const labels = events.map(eventPathLabel)
    if (labels.length <= maxSteps) return labels.join(' → ')
    return `${labels.slice(0, maxSteps - 1).join(' → ')} → …（共 ${labels.length} 步）`
  }

  rangeEl?.addEventListener('change', () => {
    recentPage = 1
    trailsPage = 1
    void loadAll()
  })
  refreshBtn?.addEventListener('click', () => void loadAll())

  await loadAll()
}
