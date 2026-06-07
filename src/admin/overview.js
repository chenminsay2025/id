import { api } from '../api/client.js'
import { userCanAccessModule } from './adminModules.js'

function formatBytesPerSec(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B/s`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`
  return `${(n / 1024 / 1024).toFixed(2)} MB/s`
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatCounts(counts) {
  if (!counts) return ''
  return `证书 ${counts.certificates ?? 0} · SVG ${counts.svg_templates ?? 0} · 表格 ${counts.table_templates ?? 0} · 布局 ${counts.layout_presets ?? 0}`
}

const DB_BAR_ITEMS = [
  { key: 'certificates', label: '证书', color: '#6366f1' },
  { key: 'svg_templates', label: 'SVG 模板', color: '#8b5cf6' },
  { key: 'table_templates', label: '表格模板', color: '#a855f7' },
  { key: 'layout_presets', label: '布局模板', color: '#d946ef' },
  { key: 'admin_user', label: '管理员', color: '#64748b' },
]

/**
 * @param {HTMLElement} container
 * @param {{ user?: object, onOpenMaintenance?: () => void }} [options]
 */
export function mountOverviewPanel(container, options = {}) {
  const canStorage = userCanAccessModule(options.user, 'maintenance')

  container.innerHTML = `
    <div class="wp-settings-panel-inner overview-panel overview-panel--wide">
      <header class="wp-settings-header overview-header">
        <div>
          <h2 class="wp-settings-title">概览</h2>
          <p class="wp-settings-desc">服务器运行状态、存储占用与业务数据一览</p>
        </div>
        <button type="button" class="button button-secondary button-sm" id="ov-refresh" title="刷新数据">
          <svg class="maint-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08a5.99 5.99 0 0 1-5.65 4c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          刷新
        </button>
      </header>

      <div class="overview-main">
        <div class="maint-analyze-progress" id="ov-analyze-progress" hidden>
          <div class="maint-analyze-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="ov-analyze-progressbar">
            <div class="maint-analyze-progress-fill" id="ov-analyze-progress-fill"></div>
          </div>
          <span class="maint-analyze-progress-label" id="ov-analyze-progress-label">加载中…</span>
        </div>

        <section class="ov-section">
          <h3 class="maint-card-title">服务器状态</h3>
          <div class="ov-sys-grid" id="ov-sys-grid">
            <article class="ov-sys-card ov-sys-card--cpu">
              <span class="ov-sys-label">CPU</span>
              <strong class="ov-sys-value" id="ov-cpu">—</strong>
              <span class="ov-sys-sub" id="ov-cpu-sub"></span>
              <div class="ov-sys-bar"><div class="ov-sys-bar-fill" id="ov-cpu-bar"></div></div>
            </article>
            <article class="ov-sys-card ov-sys-card--mem">
              <span class="ov-sys-label">内存</span>
              <strong class="ov-sys-value" id="ov-mem">—</strong>
              <span class="ov-sys-sub" id="ov-mem-sub"></span>
              <div class="ov-sys-bar"><div class="ov-sys-bar-fill" id="ov-mem-bar"></div></div>
            </article>
            <article class="ov-sys-card ov-sys-card--net">
              <span class="ov-sys-label">网络</span>
              <strong class="ov-sys-value" id="ov-net">—</strong>
              <span class="ov-sys-sub" id="ov-net-sub"></span>
            </article>
            <article class="ov-sys-card ov-sys-card--host">
              <span class="ov-sys-label">服务器</span>
              <strong class="ov-sys-value ov-sys-value--sm" id="ov-host">—</strong>
              <span class="ov-sys-sub" id="ov-host-sub"></span>
            </article>
            <article class="ov-sys-card ov-sys-card--region">
              <span class="ov-sys-label">区域 / 时区</span>
              <strong class="ov-sys-value ov-sys-value--sm" id="ov-region">—</strong>
              <span class="ov-sys-sub" id="ov-region-sub"></span>
            </article>
          </div>
        </section>

        <section class="ov-section">
          <h3 class="maint-card-title">业务概览</h3>
          <div class="maint-stat-grid ov-quick-grid" id="ov-quick-grid">
            <article class="maint-stat-card maint-stat-card--db">
              <div class="maint-stat-icon" aria-hidden="true">📄</div>
              <div class="maint-stat-body">
                <span class="maint-stat-label">证书总数</span>
                <strong class="maint-stat-value" id="ov-cert-total">—</strong>
                <span class="maint-stat-sub" id="ov-cert-sub">加载中…</span>
              </div>
            </article>
            <article class="maint-stat-card maint-stat-card--upload">
              <div class="maint-stat-icon" aria-hidden="true">✓</div>
              <div class="maint-stat-body">
                <span class="maint-stat-label">已发布</span>
                <strong class="maint-stat-value" id="ov-cert-pub">—</strong>
              </div>
            </article>
            <article class="maint-stat-card maint-stat-card--unused">
              <div class="maint-stat-icon" aria-hidden="true">✎</div>
              <div class="maint-stat-body">
                <span class="maint-stat-label">草稿</span>
                <strong class="maint-stat-value" id="ov-cert-draft">—</strong>
              </div>
            </article>
            <article class="maint-stat-card maint-stat-card--disk">
              <div class="maint-stat-icon" aria-hidden="true">🗑</div>
              <div class="maint-stat-body">
                <span class="maint-stat-label">回收站</span>
                <strong class="maint-stat-value" id="ov-cert-trash">—</strong>
              </div>
            </article>
          </div>
        </section>

        <section class="ov-section" id="ov-storage-section" ${canStorage ? '' : 'hidden'}>
          <div class="maint-overview-head">
            <div>
              <h3 class="maint-card-title">存储概览</h3>
              <p class="maint-overview-desc">磁盘空间、数据库与上传图片占用</p>
            </div>
            ${canStorage ? '<button type="button" class="button button-secondary button-sm" id="ov-open-maintenance">数据维护 →</button>' : ''}
          </div>

          <div class="maint-disk-panel" id="ov-disk-panel">
            <div class="maint-disk-head">
              <div>
                <span class="maint-disk-title">服务器磁盘</span>
                <span class="maint-disk-volume" id="ov-disk-volume">—</span>
              </div>
              <strong class="maint-disk-pct" id="ov-disk-pct">—</strong>
            </div>
            <div class="maint-disk-bar" id="ov-disk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="maint-disk-bar-used" id="ov-disk-bar-used"></div>
              <div class="maint-disk-bar-project" id="ov-disk-bar-project"></div>
            </div>
            <div class="maint-disk-legend">
              <span><i class="maint-legend-dot maint-legend-dot--disk-used"></i>已用 <strong id="ov-disk-used">—</strong></span>
              <span><i class="maint-legend-dot maint-legend-dot--disk-free"></i>可用 <strong id="ov-disk-free">—</strong></span>
              <span><i class="maint-legend-dot maint-legend-dot--disk-total"></i>总容量 <strong id="ov-disk-total">—</strong></span>
              <span><i class="maint-legend-dot maint-legend-dot--disk-project"></i>本项目 data <strong id="ov-disk-project">—</strong></span>
            </div>
            <p class="maint-disk-unavailable" id="ov-disk-unavailable" hidden>无法读取磁盘空间</p>
          </div>

          <div class="maint-stat-grid" id="ov-stat-grid">
            <article class="maint-stat-card maint-stat-card--disk">
              <div class="maint-stat-body">
                <span class="maint-stat-label">磁盘已用</span>
                <strong class="maint-stat-value" id="ov-stat-disk-used">—</strong>
                <span class="maint-stat-sub" id="ov-stat-disk-meta"></span>
              </div>
            </article>
            <article class="maint-stat-card maint-stat-card--db">
              <div class="maint-stat-body">
                <span class="maint-stat-label">数据库</span>
                <strong class="maint-stat-value" id="ov-stat-db">—</strong>
                <span class="maint-stat-sub" id="ov-stat-db-meta"></span>
              </div>
            </article>
            <article class="maint-stat-card maint-stat-card--upload">
              <div class="maint-stat-body">
                <span class="maint-stat-label">上传图片</span>
                <strong class="maint-stat-value" id="ov-stat-uploads">—</strong>
                <span class="maint-stat-sub" id="ov-stat-uploads-meta"></span>
              </div>
            </article>
            <article class="maint-stat-card maint-stat-card--unused">
              <div class="maint-stat-body">
                <span class="maint-stat-label">可释放空间</span>
                <strong class="maint-stat-value" id="ov-stat-unused">—</strong>
                <span class="maint-stat-sub" id="ov-stat-unused-meta"></span>
              </div>
            </article>
          </div>

          <div class="maint-grid-2">
            <section class="maint-viz-card">
              <h3 class="maint-card-title">上传存储分布</h3>
              <div class="maint-storage-viz">
                <div class="maint-donut-wrap">
                  <div class="maint-donut" id="ov-donut" style="--used-deg: 0deg">
                    <div class="maint-donut-hole">
                      <span class="maint-donut-pct" id="ov-donut-pct">—</span>
                      <span class="maint-donut-caption">已引用</span>
                    </div>
                  </div>
                </div>
                <ul class="maint-legend">
                  <li><span class="maint-legend-dot maint-legend-dot--used"></span>已引用 <strong id="ov-legend-used">—</strong></li>
                  <li><span class="maint-legend-dot maint-legend-dot--unused"></span>未引用 <strong id="ov-legend-unused">—</strong></li>
                </ul>
              </div>
              <div class="maint-bar-chart">
                <div class="maint-ratio-bar">
                  <div class="maint-ratio-used" id="ov-ratio-used" style="width:0%"></div>
                  <div class="maint-ratio-unused" id="ov-ratio-unused" style="width:0%"></div>
                </div>
                <div class="maint-ratio-labels">
                  <span id="ov-ratio-used-label">已引用 0%</span>
                  <span id="ov-ratio-unused-label">未引用 0%</span>
                </div>
              </div>
            </section>
            <section class="maint-viz-card">
              <h3 class="maint-card-title">数据库记录</h3>
              <div class="maint-bar-chart" id="ov-db-bars"></div>
            </section>
          </div>
        </section>

        <p class="ov-no-storage" id="ov-no-storage" ${canStorage ? 'hidden' : ''}>
          存储详情需「数据维护」模块权限。请联系管理员开通，或前往侧栏证书管理继续工作。
        </p>
        <p id="ov-status" class="maint-toast" role="status" hidden></p>
      </div>
    </div>
  `

  const els = {
    progress: container.querySelector('#ov-analyze-progress'),
    progressFill: container.querySelector('#ov-analyze-progress-fill'),
    progressBar: container.querySelector('#ov-analyze-progressbar'),
    progressLabel: container.querySelector('#ov-analyze-progress-label'),
    cpu: container.querySelector('#ov-cpu'),
    cpuSub: container.querySelector('#ov-cpu-sub'),
    cpuBar: container.querySelector('#ov-cpu-bar'),
    mem: container.querySelector('#ov-mem'),
    memSub: container.querySelector('#ov-mem-sub'),
    memBar: container.querySelector('#ov-mem-bar'),
    net: container.querySelector('#ov-net'),
    netSub: container.querySelector('#ov-net-sub'),
    host: container.querySelector('#ov-host'),
    hostSub: container.querySelector('#ov-host-sub'),
    region: container.querySelector('#ov-region'),
    regionSub: container.querySelector('#ov-region-sub'),
    certTotal: container.querySelector('#ov-cert-total'),
    certPub: container.querySelector('#ov-cert-pub'),
    certDraft: container.querySelector('#ov-cert-draft'),
    certTrash: container.querySelector('#ov-cert-trash'),
    certSub: container.querySelector('#ov-cert-sub'),
    status: container.querySelector('#ov-status'),
    statGrid: container.querySelector('#ov-stat-grid'),
    dbBars: container.querySelector('#ov-db-bars'),
    donut: container.querySelector('#ov-donut'),
    donutPct: container.querySelector('#ov-donut-pct'),
    legendUsed: container.querySelector('#ov-legend-used'),
    legendUnused: container.querySelector('#ov-legend-unused'),
    ratioUsed: container.querySelector('#ov-ratio-used'),
    ratioUnused: container.querySelector('#ov-ratio-unused'),
    ratioUsedLabel: container.querySelector('#ov-ratio-used-label'),
    ratioUnusedLabel: container.querySelector('#ov-ratio-unused-label'),
    diskPanel: container.querySelector('#ov-disk-panel'),
    diskVolume: container.querySelector('#ov-disk-volume'),
    diskPct: container.querySelector('#ov-disk-pct'),
    diskBar: container.querySelector('#ov-disk-bar'),
    diskBarUsed: container.querySelector('#ov-disk-bar-used'),
    diskBarProject: container.querySelector('#ov-disk-bar-project'),
    diskUsed: container.querySelector('#ov-disk-used'),
    diskFree: container.querySelector('#ov-disk-free'),
    diskTotal: container.querySelector('#ov-disk-total'),
    diskProject: container.querySelector('#ov-disk-project'),
    diskUnavailable: container.querySelector('#ov-disk-unavailable'),
    statDiskUsed: container.querySelector('#ov-stat-disk-used'),
    statDiskMeta: container.querySelector('#ov-stat-disk-meta'),
    statDb: container.querySelector('#ov-stat-db'),
    statDbMeta: container.querySelector('#ov-stat-db-meta'),
    statUploads: container.querySelector('#ov-stat-uploads'),
    statUploadsMeta: container.querySelector('#ov-stat-uploads-meta'),
    statUnused: container.querySelector('#ov-stat-unused'),
    statUnusedMeta: container.querySelector('#ov-stat-unused-meta'),
  }

  let loading = false

  function setProgress(pct, label) {
    const clamped = Math.max(0, Math.min(100, pct))
    if (els.progressFill) els.progressFill.style.width = `${clamped}%`
    if (els.progressBar) els.progressBar.setAttribute('aria-valuenow', String(Math.round(clamped)))
    if (els.progressLabel && label) els.progressLabel.textContent = label
  }

  function setStatus(msg, isError = false) {
    if (!els.status) return
    if (!msg) {
      els.status.hidden = true
      els.status.textContent = ''
      return
    }
    els.status.hidden = false
    els.status.textContent = msg
    els.status.classList.toggle('maint-toast--error', isError)
    els.status.classList.toggle('maint-toast--success', !isError)
  }

  function renderBar(el, pct, color) {
    if (!el) return
    el.style.width = `${Math.max(0, Math.min(100, pct))}%`
    if (color) el.style.background = color
  }

  function renderSystem(sys) {
    if (!sys) return
    const cpuPct = sys.cpu?.usage_pct
    if (els.cpu) els.cpu.textContent = cpuPct != null ? `${cpuPct}%` : '—'
    if (els.cpuSub) {
      els.cpuSub.textContent = `${sys.cpu?.cores || 0} 核 · ${(sys.cpu?.model || '').slice(0, 36)}`
    }
    renderBar(els.cpuBar, cpuPct ?? 0, 'linear-gradient(90deg,#6366f1,#818cf8)')

    const mem = sys.memory
    if (els.mem) els.mem.textContent = mem ? `${mem.used_pct}%` : '—'
    if (els.memSub && mem) {
      els.memSub.textContent = `${formatBytes(mem.used_bytes)} / ${formatBytes(mem.total_bytes)}`
    }
    renderBar(els.memBar, mem?.used_pct ?? 0, 'linear-gradient(90deg,#0891b2,#22d3ee)')

    const net = sys.network
    if (els.net) {
      if (net?.available) {
        els.net.textContent = `↓ ${formatBytesPerSec(net.rx_bytes_per_sec)}`
      } else {
        els.net.textContent = '—'
      }
    }
    if (els.netSub) {
      if (net?.available) {
        els.netSub.textContent = `↑ ${formatBytesPerSec(net.tx_bytes_per_sec)} · 下载 / 上传`
      } else {
        els.netSub.textContent = net?.note || '无法读取实时网速'
      }
    }

    if (els.host) els.host.textContent = sys.hostname || '—'
    if (els.hostSub) {
      els.hostSub.textContent = `${sys.platform_label || sys.platform} · 运行 ${sys.uptime_label || ''} · Node ${sys.node_version || ''}`
    }

    if (els.region) els.region.textContent = sys.region_label || sys.timezone || '—'
    if (els.regionSub) {
      els.regionSub.textContent = sys.region_label
        ? `时区 ${sys.timezone}`
        : '可在环境变量 CAT_SERVER_REGION 配置机房区域'
    }
  }

  function renderQuickStats(q) {
    if (!q) return
    if (els.certTotal) els.certTotal.textContent = String(q.certificates ?? 0)
    if (els.certPub) els.certPub.textContent = String(q.published ?? 0)
    if (els.certDraft) els.certDraft.textContent = String(q.draft ?? 0)
    if (els.certTrash) els.certTrash.textContent = String(q.trashed ?? 0)
    if (els.certSub) els.certSub.textContent = '当前账号可见访问组内统计'
  }

  function renderDbBars(counts) {
    if (!els.dbBars || !counts) return
    const max = Math.max(...DB_BAR_ITEMS.map((i) => counts[i.key] || 0), 1)
    els.dbBars.innerHTML = DB_BAR_ITEMS.map((item) => {
      const n = counts[item.key] || 0
      const pct = Math.round((n / max) * 100)
      return `
        <div class="maint-bar-row">
          <span class="maint-bar-label">${item.label}</span>
          <div class="maint-bar-track" title="${n} 条">
            <div class="maint-bar-fill" style="width:${pct}%;background:${item.color}"></div>
          </div>
          <span class="maint-bar-num">${n}</span>
        </div>
      `
    }).join('')
  }

  function renderStorageViz(uploads) {
    const total = uploads.total_bytes || 0
    const used = uploads.used_bytes || 0
    const unused = uploads.unused_bytes || 0
    const usedPct = total > 0 ? Math.round((used / total) * 100) : 0
    const unusedPct = total > 0 ? 100 - usedPct : 0
    if (els.donut) {
      els.donut.style.setProperty('--used-deg', `${(usedPct / 100) * 360}deg`)
      els.donut.classList.toggle('maint-donut--empty', total === 0)
    }
    if (els.donutPct) els.donutPct.textContent = total === 0 ? '—' : `${usedPct}%`
    if (els.legendUsed) els.legendUsed.textContent = `${uploads.used_files} 个 · ${formatBytes(used)}`
    if (els.legendUnused) els.legendUnused.textContent = `${uploads.unused_files} 个 · ${formatBytes(unused)}`
    if (els.ratioUsed) els.ratioUsed.style.width = `${usedPct}%`
    if (els.ratioUnused) els.ratioUnused.style.width = `${unusedPct}%`
    if (els.ratioUsedLabel) els.ratioUsedLabel.textContent = `已引用 ${usedPct}%`
    if (els.ratioUnusedLabel) els.ratioUnusedLabel.textContent = `未引用 ${unusedPct}%`
  }

  function renderDiskPanel(disk, dataDir) {
    if (!disk?.available) {
      els.diskPanel?.classList.add('maint-disk-panel--unavailable')
      if (els.diskUnavailable) els.diskUnavailable.hidden = false
      return
    }
    els.diskPanel?.classList.remove('maint-disk-panel--unavailable')
    if (els.diskUnavailable) els.diskUnavailable.hidden = true
    const usedPct = disk.used_pct ?? 0
    const projectBytes = dataDir?.total_bytes || 0
    const projectPct = disk.total_bytes > 0
      ? Math.min(100, Math.round((projectBytes / disk.total_bytes) * 1000) / 10)
      : 0
    if (els.diskVolume) els.diskVolume.textContent = disk.volume || ''
    if (els.diskPct) els.diskPct.textContent = `${usedPct}% 已用`
    if (els.diskBar) els.diskBar.setAttribute('aria-valuenow', String(Math.round(usedPct)))
    if (els.diskBarUsed) els.diskBarUsed.style.width = `${usedPct}%`
    if (els.diskBarProject) {
      els.diskBarProject.style.width = `${projectPct}%`
      els.diskBarProject.title = `本项目 data：${formatBytes(projectBytes)}`
    }
    if (els.diskUsed) els.diskUsed.textContent = formatBytes(disk.used_bytes)
    if (els.diskFree) els.diskFree.textContent = formatBytes(disk.free_bytes)
    if (els.diskTotal) els.diskTotal.textContent = formatBytes(disk.total_bytes)
    if (els.diskProject) els.diskProject.textContent = formatBytes(projectBytes)
    if (els.statDiskUsed) els.statDiskUsed.textContent = `${usedPct}%`
    if (els.statDiskMeta) {
      els.statDiskMeta.textContent = `${formatBytes(disk.used_bytes)} / ${formatBytes(disk.total_bytes)}`
    }
  }

  function renderStorage(data) {
    if (!data) return
    renderDiskPanel(data.disk, data.data_dir)
    if (els.statDb) els.statDb.textContent = formatBytes(data.db_size_bytes)
    if (els.statDbMeta) {
      let meta = formatCounts(data.db_counts)
      if (data.data_dir?.total_bytes) meta += ` · data ${formatBytes(data.data_dir.total_bytes)}`
      els.statDbMeta.textContent = meta
    }
    const u = data.uploads
    if (els.statUploads) els.statUploads.textContent = formatBytes(u.total_bytes)
    if (els.statUploadsMeta) {
      els.statUploadsMeta.textContent = `${u.total_files} 个 · 已引用 ${u.used_files} 个`
    }
    if (els.statUnused) els.statUnused.textContent = u.unused_bytes ? formatBytes(u.unused_bytes) : '0 B'
    if (els.statUnusedMeta) {
      els.statUnusedMeta.textContent = u.unused_files ? `${u.unused_files} 个未引用` : '存储已整洁'
    }
    renderDbBars(data.db_counts)
    renderStorageViz(u)
  }

  async function load({ withProgress = false } = {}) {
    if (loading) return
    loading = true
    setStatus('')
    if (withProgress) {
      els.progress.hidden = false
      setProgress(15, '读取服务器状态…')
    }
    els.statGrid?.classList.add('maint-stat-grid--loading')
    try {
      if (withProgress) setProgress(45, '分析存储占用…')
      const data = await api.getDashboardOverview()
      if (withProgress) setProgress(85, '渲染概览…')
      renderSystem(data.system)
      renderQuickStats(data.quick_stats)
      if (data.storage) renderStorage(data.storage)
      if (withProgress) setProgress(100, '完成')
    } catch (err) {
      setStatus(err.message || '加载失败', true)
    } finally {
      loading = false
      els.statGrid?.classList.remove('maint-stat-grid--loading')
      if (withProgress) {
        setTimeout(() => {
          if (els.progress) els.progress.hidden = true
          setProgress(0, '')
        }, 400)
      }
    }
  }

  container.querySelector('#ov-refresh')?.addEventListener('click', () => load({ withProgress: true }))
  container.querySelector('#ov-open-maintenance')?.addEventListener('click', () => {
    options.onOpenMaintenance?.()
  })

  return {
    async init() {
      await load({ withProgress: true })
    },
    async refresh() {
      await load({ withProgress: false })
    },
  }
}
