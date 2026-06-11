import { api } from '../api/client.js'
import { userCanAccessModule } from './adminModules.js'
import {
  downloadJsonFile,
  downloadBlobFile,
  readJsonFile,
  askImportConflictMode,
  alertImportDetails,
} from './dataTransferUi.js'

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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

function isPreviewableImage(name) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(String(name || ''))
}

function uploadBasenameFromUrl(url) {
  if (!url) return null
  const m = String(url).match(/\/uploads\/([a-zA-Z0-9._-]+)/i)
  return m?.[1] || null
}

/**
 * @param {{ user?: { avatar_url?: string | null } }} options
 * @param {{ deleted_count?: number, freed_bytes?: number, deleted_files?: string[], scan_includes_avatars?: boolean }} result
 */
function filterProtectedUploadScan(options, result) {
  const protectedNames = new Set()
  const selfAvatar = uploadBasenameFromUrl(options.user?.avatar_url)
  if (selfAvatar) protectedNames.add(selfAvatar)

  const names = result.deleted_files || []
  const filtered = names.filter((n) => !protectedNames.has(n))
  const removedProtected = names.length - filtered.length
  if (!removedProtected) {
    return { result, staleHint: result.scan_includes_avatars === false }
  }

  let freedBytes = result.freed_bytes ?? 0
  if (names.length > 0 && filtered.length < names.length) {
    freedBytes = filtered.length === 0
      ? 0
      : Math.round(freedBytes * (filtered.length / names.length))
  }

  return {
    result: {
      ...result,
      deleted_count: filtered.length,
      freed_bytes: freedBytes,
      deleted_files: filtered,
    },
    staleHint: true,
  }
}

/**
 * @param {HTMLElement} container
 * @param {{ user?: { is_super_admin?: boolean, avatar_url?: string | null } }} [options]
 */
export function mountMaintenancePanel(container, options = {}) {
  const canMaintain = userCanAccessModule(options.user, 'maintenance')
  const canWrite = canMaintain

  container.innerHTML = `
    <div class="wp-settings-panel-inner maintenance-panel">
      <header class="wp-settings-header maintenance-header">
        <div>
          <h2 class="wp-settings-title">数据维护</h2>
          <p class="wp-settings-desc">
            数据库备份/恢复与上传目录清理。存储概览请见侧栏 <strong>概览</strong>。
          </p>
        </div>
      </header>

      <div class="maintenance-main">
        ${canMaintain ? '' : '<div class="maint-alert maint-alert--warn">您没有「数据维护」模块权限。</div>'}

        <nav class="maint-nav" role="tablist" aria-label="数据维护分类">
          <button type="button" class="maint-nav-item is-active" role="tab" aria-selected="true" data-tab="backup">备份</button>
          <button type="button" class="maint-nav-item" role="tab" aria-selected="false" data-tab="cleanup">清理</button>
        </nav>

        <div class="maint-panels">
          <div class="maint-panel is-active" data-panel="backup" role="tabpanel">
            <div class="maint-grid-2">
              <section class="maint-action-card maint-backup-hub">
                <div class="maint-action-card-head">
                  <div class="maint-action-card-icon maint-action-card-icon--backup" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
                  </div>
                  <div>
                    <h3 class="maint-card-title">备份与恢复</h3>
                    <p class="maint-card-desc">数据库、uploads 与模板/设置模块可单独备份恢复；SVG 为 ZIP，其余多为 JSON。</p>
                  </div>
                </div>
                <div class="maint-bundle-tiles">
                  <div class="maint-bundle-tile maint-bundle-tile--primary">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">数据库</span>
                      <span class="maint-bundle-tile__desc">SQLite 快照（.db），可直接恢复</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-backup-db" ${canWrite ? '' : 'disabled'}>备份</button>
                      <label class="maint-bundle-btn maint-bundle-btn--restore maint-bundle-restore-label" ${canWrite ? '' : 'aria-disabled="true"'}>
                        恢复
                        <input type="file" id="maint-restore-db-file" accept=".db,application/octet-stream" hidden ${canWrite ? '' : 'disabled'} />
                      </label>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">uploads 图片</span>
                      <span class="maint-bundle-tile__desc">上传目录 ZIP（解压合并到 data/uploads/）</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-backup-uploads" ${canWrite ? '' : 'disabled'}>备份</button>
                      <label class="maint-bundle-btn maint-bundle-btn--restore maint-bundle-restore-label" ${canWrite ? '' : 'aria-disabled="true"'}>
                        恢复
                        <input type="file" id="maint-restore-uploads-file" accept=".zip,application/zip" hidden ${canWrite ? '' : 'disabled'} />
                      </label>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">SVG 模板库</span>
                      <span class="maint-bundle-tile__desc">.svg 文件 ZIP 包</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-export-svg" ${canWrite ? '' : 'disabled'}>备份</button>
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--restore" id="maint-import-svg" ${canWrite ? '' : 'disabled'}>恢复</button>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">表格模板库</span>
                      <span class="maint-bundle-tile__desc">JSON 配置导出</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-export-table" ${canWrite ? '' : 'disabled'}>备份</button>
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--restore" id="maint-import-table" ${canWrite ? '' : 'disabled'}>恢复</button>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">布局模板库</span>
                      <span class="maint-bundle-tile__desc">JSON 配置导出</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-export-layout" ${canWrite ? '' : 'disabled'}>备份</button>
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--restore" id="maint-import-layout" ${canWrite ? '' : 'disabled'}>恢复</button>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">字体源</span>
                      <span class="maint-bundle-tile__desc">字体列表与地址</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-export-fonts" ${canWrite ? '' : 'disabled'}>备份</button>
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--restore" id="maint-import-fonts" ${canWrite ? '' : 'disabled'}>恢复</button>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">站点设置</span>
                      <span class="maint-bundle-tile__desc">各组品牌与登录路径</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-export-site" ${canWrite ? '' : 'disabled'}>备份</button>
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--restore" id="maint-import-site" ${canWrite ? '' : 'disabled'}>恢复</button>
                    </div>
                  </div>
                  <div class="maint-bundle-tile">
                    <div class="maint-bundle-tile__head">
                      <span class="maint-bundle-tile__title">权限管理</span>
                      <span class="maint-bundle-tile__desc">访问组与账号分配（不含密码）</span>
                    </div>
                    <div class="maint-bundle-tile__actions">
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--backup" id="maint-export-access" ${canWrite ? '' : 'disabled'}>备份</button>
                      <button type="button" class="maint-bundle-btn maint-bundle-btn--restore" id="maint-import-access" ${canWrite ? '' : 'disabled'}>恢复</button>
                    </div>
                  </div>
                </div>
                <div id="maint-backup-progress" class="maint-backup-progress" hidden aria-live="polite">
                  <div class="maint-backup-progress-head">
                    <strong id="maint-backup-progress-title">正在创建备份</strong>
                    <span id="maint-backup-progress-pct" class="maint-backup-progress-pct">0%</span>
                  </div>
                  <div class="maint-cleanup-gauge-bar maint-backup-progress-bar">
                    <div class="maint-cleanup-gauge-fill maint-backup-progress-fill" id="maint-backup-progress-fill" style="width:0%"></div>
                  </div>
                  <p class="maint-backup-progress-detail" id="maint-backup-progress-detail">准备中…</p>
                  <p class="maint-backup-progress-file" id="maint-backup-progress-file" hidden></p>
                  <ol class="maint-backup-steps" id="maint-backup-progress-steps"></ol>
                </div>
                <div id="maint-db-status" class="maint-toast" role="status" hidden></div>
              </section>

              <section class="maint-action-card">
                <div class="maint-action-card-head">
                  <div class="maint-action-card-icon maint-action-card-icon--auto" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                  </div>
                  <div>
                    <h3 class="maint-card-title">自动备份</h3>
                    <p class="maint-card-desc">服务运行期间按间隔备份下方勾选内容，文件名前缀 <code>backupdata-auto-</code></p>
                  </div>
                  <span class="maint-badge" id="maint-auto-badge" data-state="off">未启用</span>
                </div>
                <form id="maint-auto-form" class="maint-auto-form">
                  <label class="maint-switch-row">
                    <span class="maint-switch-label">启用自动备份</span>
                    <label class="maint-switch">
                      <input type="checkbox" id="maint-auto-enabled" ${canWrite ? '' : 'disabled'} />
                      <span class="maint-switch-slider"></span>
                    </label>
                  </label>
                  <div class="maint-auto-targets">
                    <span class="maint-form-label">备份内容</span>
                    <div class="maint-auto-targets-grid" id="maint-auto-targets-grid"></div>
                    <span class="maint-form-hint">可勾选左侧全部备份项</span>
                  </div>
                  <div class="maint-form-grid">
                    <label class="maint-form-field">
                      <span class="maint-form-label">备份间隔</span>
                      <select id="maint-auto-interval" class="wp-select" ${canWrite ? '' : 'disabled'}></select>
                    </label>
                    <label class="maint-form-field">
                      <span class="maint-form-label">保留份数</span>
                      <input type="number" id="maint-auto-keep" class="maint-form-input maint-form-input--num" min="0" max="500" step="1" ${canWrite ? '' : 'disabled'} />
                      <span class="maint-form-hint">0 = 不自动删除</span>
                    </label>
                    <label class="maint-form-field maint-form-field--wide">
                      <span class="maint-form-label">保存目录</span>
                      <input type="text" id="maint-auto-dir" class="maint-form-input" placeholder="data/backups" ${canWrite ? '' : 'disabled'} />
                    </label>
                  </div>
                  <p class="maint-path-resolved" id="maint-auto-resolved" hidden></p>
                  <div class="maint-timeline">
                    <div class="maint-timeline-dot"></div>
                    <div class="maint-timeline-body">
                      <span class="maint-timeline-label">上次自动备份</span>
                      <span class="maint-timeline-value" id="maint-auto-last">—</span>
                    </div>
                  </div>
                  <div class="maint-action-row">
                    <button type="submit" class="button button-primary button-sm" id="maint-auto-save" ${canWrite ? '' : 'disabled'}>保存设置</button>
                    <button type="button" class="button button-secondary button-sm" id="maint-auto-run" ${canWrite ? '' : 'disabled'}>立即备份</button>
                  </div>
                </form>
                <div id="maint-auto-msg" class="maint-toast" role="status" hidden></div>
              </section>
            </div>

          </div>

          <div class="maint-panel" data-panel="cleanup" role="tabpanel" hidden>
            <section class="maint-cleanup-card">
              <div class="maint-action-card-head">
                <div class="maint-action-card-icon maint-action-card-icon--cleanup" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                </div>
                <div>
                  <h3 class="maint-card-title">清理未使用图片</h3>
                  <p class="maint-card-desc">扫描证书、布局/表格/SVG 模板、修订历史、站点设置与<strong>管理员头像</strong>等引用，删除 <code>data/uploads/</code> 中孤立文件（含 <code>cat-img:</code> 单元格图片）。</p>
                </div>
              </div>
              <div class="maint-cleanup-body">
                <div class="maint-cleanup-gauge">
                  <div class="maint-cleanup-gauge-bar">
                    <div class="maint-cleanup-gauge-fill" id="maint-cleanup-gauge-fill" style="width:0%"></div>
                  </div>
                  <p class="maint-cleanup-gauge-text" id="maint-cleanup-gauge-text">点击扫描查看可清理文件</p>
                </div>
                <div class="maint-action-row">
                  <button type="button" class="button button-secondary" id="maint-scan-unused" ${canWrite ? '' : 'disabled'}>扫描未使用文件</button>
                  <button type="button" class="button button-primary" id="maint-cleanup" disabled ${canWrite ? '' : 'disabled'}>清理未使用图片</button>
                </div>
              </div>
              <div id="maint-unused-list" class="maint-file-grid-wrap" hidden></div>
              <div id="maint-cleanup-status" class="maint-toast" role="status" hidden></div>
            </section>
          </div>
        </div>
      </div>

      <dialog id="maint-upload-preview" class="maint-preview-dialog">
        <div class="maint-preview-inner">
          <header class="maint-preview-head">
            <h4 id="maint-preview-title" class="maint-preview-title"></h4>
            <button type="button" class="maint-preview-close" id="maint-preview-close" aria-label="关闭">×</button>
          </header>
          <div class="maint-preview-body">
            <img id="maint-preview-img" class="maint-preview-img" alt="" />
            <p id="maint-preview-fallback" class="maint-preview-fallback" hidden>此文件类型不支持图片预览</p>
          </div>
          <footer class="maint-preview-foot">
            <a id="maint-preview-open" class="button button-secondary button-sm" href="#" target="_blank" rel="noopener">新窗口打开</a>
            <button type="button" class="button button-sm" id="maint-preview-close-btn">关闭</button>
          </footer>
        </div>
      </dialog>
    </div>
  `

  const dbStatus = container.querySelector('#maint-db-status')
  const cleanupStatus = container.querySelector('#maint-cleanup-status')
  const unusedList = container.querySelector('#maint-unused-list')
  const cleanupBtn = container.querySelector('#maint-cleanup')
  const backupDbBtn = container.querySelector('#maint-backup-db')
  const backupUploadsBtn = container.querySelector('#maint-backup-uploads')
  const backupProgress = container.querySelector('#maint-backup-progress')
  const backupProgressTitle = container.querySelector('#maint-backup-progress-title')
  const backupProgressPct = container.querySelector('#maint-backup-progress-pct')
  const backupProgressFill = container.querySelector('#maint-backup-progress-fill')
  const backupProgressDetail = container.querySelector('#maint-backup-progress-detail')
  const backupProgressFile = container.querySelector('#maint-backup-progress-file')
  const backupProgressSteps = container.querySelector('#maint-backup-progress-steps')
  const restoreDbInput = container.querySelector('#maint-restore-db-file')
  const restoreUploadsInput = container.querySelector('#maint-restore-uploads-file')
  const autoTargetsGrid = container.querySelector('#maint-auto-targets-grid')
  const scanBtn = container.querySelector('#maint-scan-unused')
  const autoForm = container.querySelector('#maint-auto-form')
  const autoEnabled = container.querySelector('#maint-auto-enabled')
  const autoInterval = container.querySelector('#maint-auto-interval')
  const autoDir = container.querySelector('#maint-auto-dir')
  const autoKeep = container.querySelector('#maint-auto-keep')
  const autoLast = container.querySelector('#maint-auto-last')
  const autoResolved = container.querySelector('#maint-auto-resolved')
  const autoMsg = container.querySelector('#maint-auto-msg')
  const autoRunBtn = container.querySelector('#maint-auto-run')
  const autoBadge = container.querySelector('#maint-auto-badge')
  const cleanupGaugeFill = container.querySelector('#maint-cleanup-gauge-fill')
  const cleanupGaugeText = container.querySelector('#maint-cleanup-gauge-text')
  const previewDialog = container.querySelector('#maint-upload-preview')
  const previewTitle = container.querySelector('#maint-preview-title')
  const previewImg = container.querySelector('#maint-preview-img')
  const previewFallback = container.querySelector('#maint-preview-fallback')
  const previewOpen = container.querySelector('#maint-preview-open')
  const previewClose = container.querySelector('#maint-preview-close')
  const previewCloseBtn = container.querySelector('#maint-preview-close-btn')
  const maintViewPage = container.closest('.wp-view-page')

  /** @type {{ deleted_count?: number, freed_bytes?: number, deleted_files?: string[] } | null} */
  let lastScan = null

  function switchMaintTab(tab) {
    const next = tab === 'cleanup' ? 'cleanup' : 'backup'
    container.querySelectorAll('.maint-nav-item').forEach((btn) => {
      const active = btn.dataset.tab === next
      btn.classList.toggle('is-active', active)
      btn.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    container.querySelectorAll('.maint-panel').forEach((panel) => {
      const active = panel.dataset.panel === next
      panel.classList.toggle('is-active', active)
      panel.hidden = !active
    })
    maintViewPage?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  container.querySelectorAll('.maint-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchMaintTab(btn.dataset.tab || 'backup'))
  })

  function showToast(el, msg, isError = false) {
    if (!el) return
    if (!msg) {
      el.hidden = true
      el.textContent = ''
      return
    }
    el.hidden = false
    el.textContent = msg
    el.classList.toggle('maint-toast--error', isError)
    el.classList.toggle('maint-toast--success', !isError)
  }

  const BACKUP_STAGE_LABELS = {
    prepare: '准备',
    db: '数据库快照',
    uploads: 'uploads 图片',
    manifest: 'manifest.json',
    compress: 'ZIP 压缩',
    write: '写入磁盘',
    done: '完成',
  }

  const BACKUP_STAGES_UPLOADS = ['prepare', 'uploads', 'manifest', 'compress', 'write', 'done']
  const BACKUP_STAGES_DATA = ['prepare', 'db', 'write', 'done']

  const RESTORE_STAGE_LABELS = {
    validate: '验证备份',
    safety: '安全备份',
    restore: '导入数据',
    swap: '替换文件',
    finalize: '重新连接',
    done: '完成',
  }
  const RESTORE_STAGES = ['validate', 'safety', 'restore', 'swap', 'finalize', 'done']

  /** @type {string[]} */
  let backupActiveStages = BACKUP_STAGES_DATA
  /** @type {Set<string>} */
  let backupCompletedStages = new Set()

  function resetBackupProgress(mode, customTitle) {
    backupActiveStages = mode === 'uploads' ? BACKUP_STAGES_UPLOADS : BACKUP_STAGES_DATA
    backupCompletedStages = new Set()
    if (backupProgressTitle) {
      backupProgressTitle.textContent = customTitle
        || (mode === 'uploads' ? '正在创建 uploads 备份' : '正在创建数据库备份')
    }
    if (backupProgressPct) backupProgressPct.textContent = '0%'
    if (backupProgressFill) backupProgressFill.style.width = '0%'
    if (backupProgressDetail) backupProgressDetail.textContent = '准备中…'
    if (backupProgressFile) {
      backupProgressFile.hidden = true
      backupProgressFile.textContent = ''
    }
    if (backupProgressSteps) {
      backupProgressSteps.innerHTML = backupActiveStages
        .filter((s) => s !== 'done')
        .map((stage) => `<li class="maint-backup-step" data-stage="${stage}">${BACKUP_STAGE_LABELS[stage] || stage}</li>`)
        .join('')
    }
  }

  function showBackupProgress(mode, visible, customTitle) {
    if (!backupProgress) return
    if (visible) {
      resetBackupProgress(mode, customTitle)
      backupProgress.hidden = false
      showToast(dbStatus, '')
      backupProgress.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } else {
      backupProgress.hidden = true
    }
  }

  function showRestoreProgress(visible, title = '正在恢复数据库') {
    if (!backupProgress) return
    if (visible) {
      backupActiveStages = RESTORE_STAGES
      backupCompletedStages = new Set()
      if (backupProgressTitle) backupProgressTitle.textContent = title
      if (backupProgressPct) backupProgressPct.textContent = '0%'
      if (backupProgressFill) backupProgressFill.style.width = '0%'
      if (backupProgressDetail) backupProgressDetail.textContent = '准备中…'
      if (backupProgressFile) {
        backupProgressFile.hidden = true
        backupProgressFile.textContent = ''
      }
      if (backupProgressSteps) {
        backupProgressSteps.innerHTML = RESTORE_STAGES
          .filter((s) => s !== 'done')
          .map((stage) => `<li class="maint-backup-step" data-stage="${stage}">${RESTORE_STAGE_LABELS[stage] || stage}</li>`)
          .join('')
      }
      backupProgress.hidden = false
      showToast(dbStatus, '')
      backupProgress.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } else {
      backupProgress.hidden = true
    }
  }

  /** @param {{ stage?: string, pct?: number, detail?: string, file?: string, current?: number, total?: number }} evt */
  function updateBackupProgress(evt) {
    const pct = Math.min(100, Math.max(0, Math.round(evt.pct ?? 0)))
    if (backupProgressPct) backupProgressPct.textContent = `${pct}%`
    if (backupProgressFill) backupProgressFill.style.width = `${pct}%`
    if (backupProgressDetail && evt.detail) {
      const pageNote = evt.total
        ? `（${evt.current ?? 0}/${evt.total} 页）`
        : ''
      backupProgressDetail.textContent = `${evt.detail}${pageNote}`
    }
    if (backupProgressFile) {
      if (evt.file) {
        backupProgressFile.hidden = false
        backupProgressFile.textContent = evt.file
      } else if (evt.stage !== 'uploads') {
        backupProgressFile.hidden = true
        backupProgressFile.textContent = ''
      }
    }
    if (!evt.stage || !backupProgressSteps) return
    const stageIdx = backupActiveStages.indexOf(evt.stage)
    if (stageIdx < 0) return
    for (let i = 0; i < stageIdx; i += 1) {
      backupCompletedStages.add(backupActiveStages[i])
    }
    if (evt.stage === 'done') {
      backupActiveStages.forEach((s) => backupCompletedStages.add(s))
    }
    backupProgressSteps.querySelectorAll('.maint-backup-step').forEach((li) => {
      const stage = li.dataset.stage
      if (!stage) return
      const idx = backupActiveStages.indexOf(stage)
      li.classList.toggle('is-done', backupCompletedStages.has(stage))
      li.classList.toggle('is-active', stage === evt.stage && evt.stage !== 'done')
      li.classList.toggle('is-pending', idx > stageIdx && !backupCompletedStages.has(stage))
    })
  }

  function renderCleanupGauge(result) {
    if (!result?.deleted_count) {
      if (cleanupGaugeFill) cleanupGaugeFill.style.width = '0%'
      if (cleanupGaugeText) cleanupGaugeText.textContent = '未发现可清理的孤立文件'
      return
    }
    if (cleanupGaugeFill) cleanupGaugeFill.style.width = '100%'
    if (cleanupGaugeText) {
      cleanupGaugeText.textContent = `${result.deleted_count} 个可清理，约 ${formatBytes(result.freed_bytes)}`
    }
  }

  function formatBackupTime(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('zh-CN')
    } catch {
      return iso
    }
  }

  function updateAutoBadge(config) {
    if (!autoBadge || !config) return
    if (config.enabled) {
      autoBadge.textContent = '运行中'
      autoBadge.dataset.state = 'on'
    } else {
      autoBadge.textContent = '未启用'
      autoBadge.dataset.state = 'off'
    }
    if (config.last_backup_error) {
      autoBadge.textContent = '异常'
      autoBadge.dataset.state = 'error'
    }
  }

  function renderAutoBackupTargets(config) {
    if (!autoTargetsGrid) return
    const options = config?.target_options || []
    autoTargetsGrid.innerHTML = options.map((opt) => `
      <label class="maint-auto-target">
        <input type="checkbox" data-auto-target="${escapeAttr(opt.key)}" ${opt.checked ? 'checked' : ''} ${canWrite ? '' : 'disabled'} />
        <span>${escapeHtml(opt.label)}</span>
      </label>
    `).join('')
  }

  function fillAutoBackupForm(config) {
    if (!config) return
    autoEnabled.checked = !!config.enabled
    autoInterval.innerHTML = (config.interval_options || []).map((o) =>
      `<option value="${o.hours}"${o.hours === config.interval_hours ? ' selected' : ''}>${o.label}</option>`,
    ).join('')
    autoDir.value = config.backup_dir || 'data/backups'
    autoKeep.value = String(config.keep_count ?? 30)
    renderAutoBackupTargets(config)
    if (config.resolved_dir) {
      autoResolved.hidden = false
      autoResolved.textContent = `实际路径：${config.resolved_dir}`
    } else {
      autoResolved.hidden = true
    }
    let lastText = formatBackupTime(config.last_backup_at)
    if (config.last_backup_file) lastText += ` · ${config.last_backup_file}`
    if (config.last_backup_error) lastText += ` · 错误：${config.last_backup_error}`
    autoLast.textContent = lastText
    updateAutoBadge(config)
  }

  async function loadAutoBackup() {
    if (!canMaintain) return
    try {
      const res = await api.getAutoBackupConfig()
      fillAutoBackupForm(res.config)
    } catch (err) {
      showToast(autoMsg, err.message, true)
    }
  }

  function readAutoBackupForm() {
    /** @type {Record<string, boolean>} */
    const backup_targets = {}
    container.querySelectorAll('[data-auto-target]').forEach((input) => {
      if (input instanceof HTMLInputElement && input.dataset.autoTarget) {
        backup_targets[input.dataset.autoTarget] = input.checked
      }
    })
    return {
      enabled: autoEnabled.checked,
      interval_hours: Number(autoInterval.value),
      backup_dir: autoDir.value.trim(),
      keep_count: Number(autoKeep.value),
      backup_targets,
    }
  }

  function openUploadPreview(filename) {
    if (!previewDialog || !filename) return
    const url = `/uploads/${encodeURIComponent(filename)}`
    if (previewTitle) previewTitle.textContent = filename
    if (previewOpen) previewOpen.href = url
    if (isPreviewableImage(filename)) {
      if (previewImg) {
        previewImg.src = url
        previewImg.alt = filename
        previewImg.hidden = false
      }
      if (previewFallback) previewFallback.hidden = true
    } else {
      previewImg?.removeAttribute('src')
      if (previewImg) previewImg.hidden = true
      if (previewFallback) previewFallback.hidden = false
    }
    previewDialog.showModal()
  }

  function renderUnusedPreview(result) {
    if (!result?.deleted_count) {
      unusedList.hidden = true
      unusedList.innerHTML = ''
      cleanupBtn.disabled = true
      renderCleanupGauge(null)
      return
    }
    cleanupBtn.disabled = !canWrite
    const names = result.deleted_files || []
    const chips = names.slice(0, 48).map((n) =>
      `<button type="button" class="maint-file-chip" data-file="${escapeAttr(n)}" title="点击预览">${escapeHtml(n)}</button>`,
    ).join('')
    unusedList.hidden = false
    unusedList.innerHTML = `
      <div class="maint-file-grid-head">
        <strong>${result.deleted_count} 个未引用文件</strong>
        <span>约 ${formatBytes(result.freed_bytes)} 可释放</span>
      </div>
      <div class="maint-file-grid">${chips}</div>
    `
    renderCleanupGauge(result)
  }

  async function scanUnused() {
    showToast(cleanupStatus, '正在扫描…')
    scanBtn.disabled = true
    try {
      const raw = await api.previewCleanupUploads()
      const { result, staleHint } = filterProtectedUploadScan(options, raw)
      lastScan = result
      renderUnusedPreview(result)
      if (staleHint) {
        showToast(
          cleanupStatus,
          result.deleted_count
            ? `扫描完成：${result.deleted_count} 个文件可清理（已排除账号头像；若列表仍异常请重启 npm run dev:local）`
            : '扫描完成：未发现未使用的上传图片（后端 API 可能未更新，请重启 npm run dev:local）',
          !result.deleted_count,
        )
      } else {
        showToast(cleanupStatus, result.deleted_count
          ? `扫描完成：${result.deleted_count} 个文件可清理`
          : '扫描完成：未发现未使用的上传图片')
      }
    } catch (err) {
      showToast(cleanupStatus, err.message, true)
    } finally {
      scanBtn.disabled = !canWrite
    }
  }

  /**
   * @param {{
   *   mode: 'data' | 'uploads',
   *   title?: string,
   *   runBackup: (onProgress: (evt: object) => void) => Promise<object>,
   *   toastEl: HTMLElement | null,
   *   download?: boolean,
   * }} opts
   */
  async function performBackupFlow(opts) {
    const { mode, title, runBackup, toastEl, download = false } = opts
    showBackupProgress(mode, true, title)
    updateBackupProgress({
      stage: 'prepare',
      pct: 0,
      detail: mode === 'uploads' ? '正在准备 uploads 备份…' : '正在准备数据库备份…',
    })
    try {
      const result = await runBackup((evt) => updateBackupProgress(evt))
      if (result.skipped) {
        showBackupProgress(mode, false)
        const skipNames = (result.files || []).map((f) => f.filename).filter(Boolean)
        const skipLabel = skipNames.length > 1
          ? `${skipNames.length} 个文件（${skipNames.join('、')}）`
          : (result.filename || skipNames[0] || '上次备份')
        showToast(
          toastEl,
          `数据无变化，跳过备份（沿用 ${skipLabel}）`,
        )
        return result
      }
      const gotZip = /\.zip$/i.test(result.filename || '')
      const gotDb = /\.db$/i.test(result.filename || '')
      if (mode === 'uploads' && !gotZip) {
        showBackupProgress(mode, false)
        showToast(toastEl, `uploads 备份格式异常：${result.filename || '未知'}`, true)
        return null
      }
      if (mode === 'data' && !gotDb) {
        showBackupProgress(mode, false)
        showToast(toastEl, `备份格式异常：${result.filename || '未知'}`, true)
        return null
      }
      updateBackupProgress({ stage: 'done', pct: 100, detail: '备份完成' })
      const fileItems = (result.files || []).length
        ? result.files
        : (result.filename ? [{ filename: result.filename, size_label: result.size_label }] : [])
      const names = fileItems.map((f) => f.filename).filter(Boolean)
      const nameLabel = names.length > 1
        ? `${names.length} 个文件：${names.join('、')}`
        : (names[0] || result.filename || '备份')
      const extra = mode === 'uploads' && result.includes
        ? ` · ${result.includes.uploads ?? 0} 个文件`
        : ''
      const pruneNote = result.removed_old ? ` · 已清理旧批次 ${result.removed_old} 个文件` : ''
      const sizeLabel = result.size_label || formatBytes(result.size_bytes)
      showToast(
        toastEl,
        `已创建 ${nameLabel}（${sizeLabel}${result.counts ? `，${formatCounts(result.counts)}` : ''}${extra}${pruneNote}）`,
      )
      if (download && result.download_url) {
        const a = document.createElement('a')
        a.href = result.download_url
        a.download = result.filename
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      return result
    } catch (err) {
      showBackupProgress(mode, false)
      showToast(toastEl, err.message, true)
      return null
    }
  }

  async function runManualBackup(mode) {
    const buttons = [backupDbBtn, backupUploadsBtn, autoRunBtn].filter(Boolean)
    buttons.forEach((btn) => { btn.disabled = true })
    await performBackupFlow({
      mode,
      runBackup: (onProgress) => (mode === 'uploads'
        ? api.createUploadsBackupWithProgress(onProgress)
        : api.createDatabaseBackupWithProgress(onProgress)),
      toastEl: dbStatus,
      download: true,
    })
    buttons.forEach((btn) => { btn.disabled = !canWrite })
  }

  backupDbBtn?.addEventListener('click', () => {
    void runManualBackup('data')
  })

  backupUploadsBtn?.addEventListener('click', () => {
    void runManualBackup('uploads')
  })

  restoreDbInput?.addEventListener('change', async () => {
    const file = restoreDbInput.files?.[0]
    restoreDbInput.value = ''
    if (!file || !/\.db$/i.test(file.name)) {
      showToast(dbStatus, '请选择 .db 备份文件', true)
      return
    }
    if (!window.confirm(`确定用「${file.name}」恢复数据库吗？\n\n当前数据将被覆盖。`)) return
    showRestoreProgress(true, '正在恢复数据库')
    updateBackupProgress({
      stage: 'validate',
      pct: 0,
      detail: `正在上传 ${file.name}…`,
    })
    try {
      const result = await api.restoreDatabaseWithProgress(file, (evt) => updateBackupProgress(evt))
      updateBackupProgress({ stage: 'done', pct: 100, detail: '恢复完成' })
      showToast(
        dbStatus,
        `${result.message || '恢复完成'}。恢复前备份：${result.safety_backup}（证书 ${result.counts?.certificates ?? '—'} 条）`,
      )
      lastScan = null
      renderUnusedPreview(null)
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      showRestoreProgress(false)
      showToast(dbStatus, err.message, true)
    }
  })

  restoreUploadsInput?.addEventListener('change', async () => {
    const file = restoreUploadsInput.files?.[0]
    restoreUploadsInput.value = ''
    if (!file || !/\.zip$/i.test(file.name)) {
      showToast(dbStatus, '请选择 uploads ZIP 备份文件', true)
      return
    }
    if (!window.confirm(`确定用「${file.name}」恢复 uploads 吗？\n\n同名文件将被覆盖。`)) return
    showRestoreProgress(true, '正在恢复 uploads')
    updateBackupProgress({
      stage: 'validate',
      pct: 0,
      detail: `正在上传 ${file.name}…`,
    })
    try {
      const result = await api.restoreUploadsWithProgress(file, (evt) => updateBackupProgress(evt))
      updateBackupProgress({ stage: 'done', pct: 100, detail: '恢复完成' })
      showToast(
        dbStatus,
        `${result.message || 'uploads 恢复完成'}。恢复前备份：${result.safety_backup}（${result.restored_count ?? 0} 个文件）`,
      )
      lastScan = null
      renderUnusedPreview(null)
    } catch (err) {
      showRestoreProgress(false)
      showToast(dbStatus, err.message, true)
    }
  })

  scanBtn?.addEventListener('click', scanUnused)
  unusedList?.addEventListener('click', (e) => {
    const chip = e.target.closest('.maint-file-chip[data-file]')
    if (chip) openUploadPreview(chip.dataset.file)
  })
  previewClose?.addEventListener('click', () => previewDialog?.close())
  previewCloseBtn?.addEventListener('click', () => previewDialog?.close())
  previewDialog?.addEventListener('click', (e) => {
    if (e.target === previewDialog) previewDialog.close()
  })
  previewDialog?.addEventListener('close', () => previewImg?.removeAttribute('src'))

  cleanupBtn?.addEventListener('click', async () => {
    if (!lastScan?.deleted_count) {
      await scanUnused()
      if (!lastScan?.deleted_count) return
    }
    if (!window.confirm(`确定删除 ${lastScan.deleted_count} 个未使用的图片吗？此操作不可撤销。`)) return
    cleanupBtn.disabled = true
    showToast(cleanupStatus, '正在清理…')
    try {
      const result = await api.cleanupUploads(true)
      showToast(cleanupStatus, `已删除 ${result.deleted_count} 个文件，释放 ${formatBytes(result.freed_bytes)}`)
      lastScan = null
      renderUnusedPreview(null)
    } catch (err) {
      showToast(cleanupStatus, err.message, true)
      cleanupBtn.disabled = false
    }
  })

  autoForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const res = await api.saveAutoBackupConfig(readAutoBackupForm())
      fillAutoBackupForm(res.config)
      showToast(autoMsg, '自动备份设置已保存')
    } catch (err) {
      showToast(autoMsg, err.message, true)
    }
  })

  autoRunBtn?.addEventListener('click', async () => {
    const form = readAutoBackupForm()
    autoRunBtn.disabled = true
    backupDbBtn && (backupDbBtn.disabled = true)
    backupUploadsBtn && (backupUploadsBtn.disabled = true)
    const checkedCount = Object.values(form.backup_targets || {}).filter(Boolean).length
    const result = await performBackupFlow({
      mode: 'data',
      title: checkedCount > 1 ? `正在执行自动备份（${checkedCount} 项）` : '正在执行自动备份',
      runBackup: (onProgress) => api.runAutoBackupWithProgress(form, onProgress),
      toastEl: autoMsg,
      download: false,
    })
    if (result?.config) fillAutoBackupForm(result.config)
    else if (result) {
      try {
        const res = await api.getAutoBackupConfig()
        fillAutoBackupForm(res.config)
      } catch {
        // ignore
      }
    }
    autoRunBtn.disabled = !canWrite
    if (backupDbBtn) backupDbBtn.disabled = !canWrite
    if (backupUploadsBtn) backupUploadsBtn.disabled = !canWrite
  })

  const moduleLibStatus = dbStatus
  const moduleStamp = () => new Date().toISOString().slice(0, 10)

  async function exportModuleLibrary(kind) {
    const stamp = moduleStamp()
    if (kind === 'svg') {
      const { blob, filename } = await api.exportSvgTemplatesZip()
      downloadBlobFile(filename, blob)
      showToast(moduleLibStatus, `已备份 ${filename}`)
      return
    }
    let bundle
    let filename
    if (kind === 'table') {
      bundle = await api.exportTableTemplates()
      filename = `table-templates-${stamp}.json`
    } else if (kind === 'layout') {
      bundle = await api.exportLayoutPresets()
      filename = `layout-presets-${stamp}.json`
    } else if (kind === 'fonts') {
      bundle = await api.exportFontSettingsBackup()
      filename = `font-settings-${stamp}.json`
    } else if (kind === 'site') {
      bundle = await api.exportSiteSettingsBackup()
      filename = `site-settings-${stamp}.json`
    } else {
      bundle = await api.exportAccessPermissionsBackup()
      filename = `access-permissions-${stamp}.json`
    }
    const count = bundle.item_count
      ?? bundle.branding?.length
      ?? bundle.config?.sources?.length
      ?? bundle.groups?.length
      ?? 0
    downloadJsonFile(filename, bundle)
    showToast(moduleLibStatus, `已备份 ${filename}（${count} 项）`)
  }

  function readZipFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.zip,application/zip'
      input.hidden = true
      document.body.appendChild(input)
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        input.remove()
        if (!file) {
          reject(new Error('已取消'))
          return
        }
        resolve(file)
      })
      input.click()
    })
  }

  async function importModuleLibrary(kind) {
    const mode = askImportConflictMode()
    if (!mode) return
    try {
      if (kind === 'svg') {
        const file = await readZipFile()
        const result = await api.importSvgTemplatesZip(file, mode)
        alertImportDetails(result)
        showToast(moduleLibStatus, 'SVG 模板库恢复完成')
        return
      }
      const bundle = await readJsonFile()
      let result
      if (kind === 'table') {
        result = await api.importTableTemplates(bundle, mode)
      } else if (kind === 'layout') {
        result = await api.importLayoutPresets(bundle, mode)
      } else if (kind === 'fonts') {
        result = await api.importFontSettingsBackup(bundle, mode)
      } else if (kind === 'site') {
        result = await api.importSiteSettingsBackup(bundle, mode)
      } else {
        result = await api.importAccessPermissionsBackup(bundle, mode)
      }
      alertImportDetails(result)
      showToast(moduleLibStatus, '模块备份恢复完成')
    } catch (err) {
      if (err.message !== '已取消') showToast(moduleLibStatus, err.message, true)
    }
  }

  container.querySelector('#maint-export-svg')?.addEventListener('click', () => {
    exportModuleLibrary('svg').catch((err) => showToast(moduleLibStatus, err.message, true))
  })
  container.querySelector('#maint-import-svg')?.addEventListener('click', () => {
    void importModuleLibrary('svg')
  })
  container.querySelector('#maint-export-table')?.addEventListener('click', () => {
    exportModuleLibrary('table').catch((err) => showToast(moduleLibStatus, err.message, true))
  })
  container.querySelector('#maint-import-table')?.addEventListener('click', () => {
    void importModuleLibrary('table')
  })
  container.querySelector('#maint-export-layout')?.addEventListener('click', () => {
    exportModuleLibrary('layout').catch((err) => showToast(moduleLibStatus, err.message, true))
  })
  container.querySelector('#maint-import-layout')?.addEventListener('click', () => {
    void importModuleLibrary('layout')
  })
  container.querySelector('#maint-export-fonts')?.addEventListener('click', () => {
    exportModuleLibrary('fonts').catch((err) => showToast(moduleLibStatus, err.message, true))
  })
  container.querySelector('#maint-import-fonts')?.addEventListener('click', () => {
    void importModuleLibrary('fonts')
  })
  container.querySelector('#maint-export-site')?.addEventListener('click', () => {
    exportModuleLibrary('site').catch((err) => showToast(moduleLibStatus, err.message, true))
  })
  container.querySelector('#maint-import-site')?.addEventListener('click', () => {
    void importModuleLibrary('site')
  })
  container.querySelector('#maint-export-access')?.addEventListener('click', () => {
    exportModuleLibrary('access').catch((err) => showToast(moduleLibStatus, err.message, true))
  })
  container.querySelector('#maint-import-access')?.addEventListener('click', () => {
    void importModuleLibrary('access')
  })

  return {
    async init() {
      switchMaintTab('backup')
      await loadAutoBackup()
    },
    switchTab: switchMaintTab,
  }
}
