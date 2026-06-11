/** @type {HTMLElement | null} */
let root = null
/** @type {HTMLElement | null} */
let barEl = null
/** @type {HTMLElement | null} */
let labelEl = null
/** @type {HTMLElement | null} */
let detailEl = null
/** @type {HTMLElement | null} */
let logEl = null
/** @type {HTMLElement | null} */
let percentEl = null

/** @type {{ fileName?: string, fileSize?: number } | null} */
let sessionMeta = null
let sessionStart = 0
let lastLabel = '准备中…'
let lastPercent = 0
/** @type {ReturnType<typeof setInterval> | null} */
let waitTicker = null

export function formatImportFileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function formatImportElapsed() {
  const s = Math.floor((Date.now() - sessionStart) / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/**
 * @param {string | string[]} lines
 */
export function formatImportDetailLines(lines) {
  const arr = Array.isArray(lines) ? lines : (lines ? [String(lines)] : [])
  return arr.map((s) => String(s).trim()).filter(Boolean).join('\n')
}

function ensureRoot() {
  if (root) return root
  root = document.createElement('div')
  root.className = 'excel-import-progress'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-labelledby', 'excel-import-progress-title')
  root.hidden = true
  root.innerHTML = `
    <div class="excel-import-progress__card">
      <h3 class="excel-import-progress__title" id="excel-import-progress-title">正在导入 Excel</h3>
      <p class="excel-import-progress__label" id="excel-import-progress-label">准备中…</p>
      <div class="excel-import-progress__track" aria-hidden="true">
        <div class="excel-import-progress__bar" id="excel-import-progress-bar"></div>
      </div>
      <p class="excel-import-progress__percent" id="excel-import-progress-percent">0%</p>
      <p class="excel-import-progress__detail" id="excel-import-progress-detail"></p>
      <div class="excel-import-progress__log-wrap">
        <div class="excel-import-progress__log-title">处理明细</div>
        <ul class="excel-import-progress__log" id="excel-import-progress-log"></ul>
      </div>
    </div>
  `
  document.body.appendChild(root)
  barEl = root.querySelector('#excel-import-progress-bar')
  labelEl = root.querySelector('#excel-import-progress-label')
  detailEl = root.querySelector('#excel-import-progress-detail')
  logEl = root.querySelector('#excel-import-progress-log')
  percentEl = root.querySelector('#excel-import-progress-percent')
  return root
}

/**
 * @param {{ fileName?: string, fileSize?: number }} [meta]
 */
export function beginExcelImportProgressSession(meta = {}) {
  sessionMeta = { ...meta }
  sessionStart = Date.now()
  lastLabel = '准备中…'
  lastPercent = 0
}

/**
 * @param {string} [title]
 * @param {{ fileName?: string, fileSize?: number }} [meta]
 */
export function showExcelImportProgress(title = '正在导入 Excel', meta) {
  ensureRoot()
  beginExcelImportProgressSession(meta)
  const titleEl = root.querySelector('.excel-import-progress__title')
  if (titleEl) titleEl.textContent = title
  if (logEl) logEl.replaceChildren()
  appendExcelImportLog('开始导入')
  if (meta?.fileName) {
    appendExcelImportLog(
      `文件：${meta.fileName}${meta.fileSize ? `（${formatImportFileSize(meta.fileSize)}）` : ''}`,
    )
  }
  setExcelImportProgress(0, '准备中', ['等待读取文件…'])
  root.hidden = false
  document.body.classList.add('excel-import-progress-active')
}

/** @param {string} line */
export function appendExcelImportLog(line) {
  ensureRoot()
  if (!logEl || !line) return
  const li = document.createElement('li')
  const ts = formatImportElapsed()
  li.textContent = `[${ts}] ${line}`
  logEl.appendChild(li)
  logEl.scrollTop = logEl.scrollHeight
  const wrap = logEl.parentElement
  if (wrap) wrap.scrollTop = wrap.scrollHeight
}

/**
 * @param {number} percent
 * @param {string} phaseLabel 当前阶段（单行，不含重复数据）
 * @param {string | string[]} [detailLines] 详情（勿与 phaseLabel 重复）
 * @param {{ logLine?: string, fromTicker?: boolean }} [opts]
 */
export function setExcelImportProgress(percent, phaseLabel, detailLines = [], opts = {}) {
  ensureRoot()
  if (phaseLabel) lastLabel = phaseLabel
  if (opts.logLine) appendExcelImportLog(opts.logLine)

  const detail = formatImportDetailLines(detailLines)
  const extra = []
  if (sessionMeta?.fileName && detail && !detail.includes(sessionMeta.fileName)) {
    extra.push(`源文件：${sessionMeta.fileName}`)
  }
  if (sessionStart) extra.push(`总用时 ${formatImportElapsed()}`)
  const fullDetail = [detail, ...extra].filter(Boolean).join('\n')

  updateExcelImportProgress(percent, lastLabel, fullDetail, opts)
}

/**
 * Worker 等待时刷新
 * @param {string} [phaseHint]
 */
export function startExcelImportWaitTicker(phaseHint = '') {
  stopExcelImportWaitTicker()
  root?.classList.add('is-waiting')
  waitTicker = setInterval(() => {
    const creep = Math.min(48, lastPercent + 1, 5 + Math.floor((Date.now() - sessionStart) / 1500))
    const pct = Math.max(lastPercent, creep)
    setExcelImportProgress(
      pct,
      lastLabel,
      [
        phaseHint || '后台处理中',
        '页面仍可响应，请勿关闭',
        '大文件解压与 XML 解析可能各需数分钟',
      ],
      { fromTicker: true },
    )
  }, 450)
}

export function stopExcelImportWaitTicker() {
  if (waitTicker) {
    clearInterval(waitTicker)
    waitTicker = null
  }
  root?.classList.remove('is-waiting')
}

/**
 * @param {number} percent
 * @param {string} [label]
 * @param {string} [detail]
 * @param {{ fromTicker?: boolean }} [opts]
 */
export function updateExcelImportProgress(percent, label, detail, opts = {}) {
  ensureRoot()
  if (label) lastLabel = label
  if (!opts.fromTicker) {
    lastPercent = Math.max(0, Math.min(100, Math.round(percent)))
    stopExcelImportWaitTicker()
  }

  const pct = opts.fromTicker
    ? Math.max(lastPercent, Math.min(100, Math.round(percent)))
    : lastPercent

  if (barEl) barEl.style.width = `${pct}%`
  if (percentEl) percentEl.textContent = `${pct}%`
  if (labelEl) labelEl.textContent = lastLabel
  if (detailEl) {
    detailEl.textContent = detail || ''
    detailEl.hidden = !detail
  }
}

/** 兼容旧调用：第三参可为 string 或 string[] */
export function updateExcelImportProgressLegacy(percent, label, detail, opts) {
  const lines = Array.isArray(detail) ? detail : (detail ? [detail] : [])
  setExcelImportProgress(percent, label, lines, opts)
}

export function hideExcelImportProgress() {
  stopExcelImportWaitTicker()
  if (!root) return
  root.hidden = true
  document.body.classList.remove('excel-import-progress-active')
  sessionMeta = null
  if (detailEl) detailEl.hidden = true
}

/**
 * @param {object} info
 * @param {(percent: number, label: string, lines: string | string[], opts?: { logLine?: string }) => void} report
 */
export function reportImageImportProgress(info, report) {
  const phase = info?.phase || 'upload'
  const done = Number(info?.done) || 0
  const total = Number(info?.total) || 0
  const uploaded = Number(info?.uploaded) || 0
  const missing = Number(info?.missing) || 0
  const rowIdx = info?.rowIdx
  const colName = info?.colName || ''
  const blobBytes = info?.blobBytes
  const cached = !!info?.cached

  if (phase === 'scan') {
    report(58, '扫描嵌入图', [
      `表格中发现 ${total} 个 DISPIMG 图片单元格`,
      info?.message || '',
    ], { logLine: `待上传嵌入图 ${total} 处` })
    return
  }

  if (phase === 'zip') {
    report(58, '解压图片资源', [
      info?.message || '正在从 xlsx 压缩包读取媒体文件…',
    ])
    return
  }

  if (phase === 'index') {
    report(59, '匹配图片资源', [
      info?.message || '正在关联 DISPIMG 编号与 xl/media 文件…',
      info?.blobCount != null ? `已索引 ${info.blobCount} 个媒体文件` : '',
    ], { logLine: info?.logLine })
    return
  }

  if (phase === 'compress') {
    report(59, '准备图片压缩', [
      info?.message || '将按站点设置压缩嵌入图后上传',
      info?.total ? `待处理 ${info.total} 张唯一图片` : '',
    ], { logLine: info?.logLine })
    return
  }

  const uniqueTotal = Number(info?.uniqueTotal) || 0
  const uniqueDone = Number(info?.uniqueDone) || 0
  const pct = uniqueTotal > 0
    ? 58 + Math.round((uniqueDone / uniqueTotal) * 27)
    : (total > 0 ? 58 + Math.round((done / total) * 27) : 72)
  const slotPct = total > 0 ? Math.round((done / total) * 100) : 0
  const remain = Math.max(0, total - done)
  const lines = []
  if (uniqueTotal > 0) {
    lines.push(`唯一图片上传：${uniqueDone} / ${uniqueTotal}（多路并行，相同文件只传一次）`)
    lines.push(`单元格引用：${total} 处 DISPIMG`)
  } else {
    lines.push(`进度：${done} / ${total}（${slotPct}%）`)
  }
  if (rowIdx != null && colName) {
    lines.push(`最近处理：第 ${rowIdx + 1} 行 · 列「${colName}」`)
  }
  lines.push(`统计：已成功 ${uploaded} · 失败/未匹配 ${missing}${remain && !uniqueTotal ? ` · 剩余 ${remain}` : ''}`)
  const cs = info?.compressStats
  if (cs && cs.processed > 0) {
    const saved = Math.max(0, (cs.beforeBytes || 0) - (cs.afterBytes || 0))
    const savedPct = cs.beforeBytes > 0 ? Math.round((saved / cs.beforeBytes) * 100) : 0
    lines.push(
      `压缩：已处理 ${cs.processed} · 已压缩 ${cs.compressed || 0} · 跳过 ${cs.skipped || 0} · 失败 ${cs.failed || 0}`,
    )
    if (cs.beforeBytes > 0) {
      lines.push(
        `体积：${formatImportFileSize(cs.beforeBytes)} → ${formatImportFileSize(cs.afterBytes)}（节省 ${savedPct}%）`,
      )
    }
  }
  if (blobBytes) {
    lines.push(`本张：${formatImportFileSize(blobBytes)}${cached ? '（已上传过，跳过）' : ''}`)
  }
  if (info?.message) lines.push(info.message)

  const logLine = (done > 0 && (done % 50 === 0 || done === total))
    ? `嵌入图上传 ${done}/${total}（成功 ${uploaded}）`
    : undefined

  report(pct, '上传嵌入图片', lines, { logLine })
}
