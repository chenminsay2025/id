/**
 * 紧凑「JSON ▾」下拉菜单 HTML（导入/导出合并，不占单独一行）
 * @param {{ prefix: string, exportLabel?: string, importLabel?: string, exportDisabled?: boolean }} opts
 */
export function dataTransferMenuHtml({
  prefix,
  exportLabel = '导出 JSON',
  importLabel = '导入 JSON',
  exportDisabled = false,
}) {
  return `
    <div class="data-transfer-menu" data-transfer-prefix="${prefix}">
      <button type="button" class="data-transfer-menu-btn" id="${prefix}-transfer-toggle" aria-haspopup="menu" aria-expanded="false" title="导入/导出 JSON">JSON ▾</button>
      <div class="data-transfer-menu-popover" id="${prefix}-transfer-popover" role="menu" hidden>
        <button type="button" class="data-transfer-menu-item" id="${prefix}-export" role="menuitem"${exportDisabled ? ' disabled' : ''}>${exportLabel}</button>
        <button type="button" class="data-transfer-menu-item" id="${prefix}-import" role="menuitem">${importLabel}</button>
      </div>
    </div>
  `
}

/**
 * @param {ParentNode} root
 * @param {{ prefix: string, onExport?: () => void | Promise<void>, onImport?: () => void | Promise<void> }} opts
 */
export function setupDataTransferMenu(root, { prefix, onExport, onImport }) {
  const toggle = root.querySelector(`#${prefix}-transfer-toggle`)
  const popover = root.querySelector(`#${prefix}-transfer-popover`)
  const exportBtn = root.querySelector(`#${prefix}-export`)
  const importBtn = root.querySelector(`#${prefix}-import`)
  if (!toggle || !popover) return

  const menuEl = toggle.closest('.data-transfer-menu')
  let scrollCloseBound = false

  const positionPopover = () => {
    const rect = toggle.getBoundingClientRect()
    const popoverWidth = popover.offsetWidth || 120
    let left = rect.right - popoverWidth
    left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8))
    popover.style.position = 'fixed'
    popover.style.top = `${rect.bottom + 4}px`
    popover.style.left = `${left}px`
    popover.style.right = 'auto'
    popover.style.zIndex = '10050'
  }

  const clearPopoverPosition = () => {
    popover.style.position = ''
    popover.style.top = ''
    popover.style.left = ''
    popover.style.right = ''
    popover.style.zIndex = ''
    if (menuEl && popover.parentElement !== menuEl) {
      menuEl.appendChild(popover)
    }
  }

  const close = () => {
    popover.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    clearPopoverPosition()
    if (scrollCloseBound) {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      scrollCloseBound = false
    }
  }

  const open = () => {
    document.querySelectorAll('.data-transfer-menu-popover').forEach((el) => {
      if (el !== popover) {
        el.hidden = true
        el.style.position = ''
        el.style.top = ''
        el.style.left = ''
        el.style.right = ''
        el.style.zIndex = ''
      }
    })
    document.querySelectorAll('.data-transfer-menu-btn[aria-expanded="true"]').forEach((el) => {
      if (el !== toggle) el.setAttribute('aria-expanded', 'false')
    })
    document.body.appendChild(popover)
    popover.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    positionPopover()
    if (!scrollCloseBound) {
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
      scrollCloseBound = true
    }
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    if (popover.hidden) open()
    else close()
  })

  exportBtn?.addEventListener('click', async (e) => {
    e.stopPropagation()
    close()
    if (exportBtn.disabled) return
    await onExport?.()
  })

  importBtn?.addEventListener('click', async (e) => {
    e.stopPropagation()
    close()
    await onImport?.()
  })

  if (!root.dataset.transferMenuBound) {
    root.dataset.transferMenuBound = '1'
    document.addEventListener('click', close)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close()
    })
  }
}

/** @param {ParentNode} root @param {string} prefix @param {boolean} disabled */
export function setDataTransferExportDisabled(root, prefix, disabled) {
  const exportBtn = root.querySelector(`#${prefix}-export`)
  if (exportBtn) exportBtn.disabled = !!disabled
}

export function downloadBlobFile(filename, blob) {
  const safeName = String(filename || 'download.bin').replace(/[\\/:*?"<>|]/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {string} filename
 * @param {object} data
 */
export function downloadJsonFile(filename, data) {
  const safeName = String(filename || 'export.json').replace(/[\\/:*?"<>|]/g, '_')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName.endsWith('.json') ? safeName : `${safeName}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {string} [accept]
 * @returns {Promise<object>}
 */
export function readJsonFile(accept = '.json,application/json') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.hidden = true
    document.body.appendChild(input)
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) {
        reject(new Error('已取消'))
        return
      }
      try {
        const text = await file.text()
        resolve(JSON.parse(text))
      } catch (err) {
        reject(new Error(err.message || '无法解析 JSON 文件'))
      }
    })
    input.click()
  })
}

/**
 * @param {{ created?: number, updated?: number, skipped?: number, warnings?: string[], errors?: string[] }} result
 */
export function formatImportResultMessage(result) {
  const parts = []
  if (result.created) parts.push(`新建 ${result.created}`)
  if (result.updated) parts.push(`更新 ${result.updated}`)
  if (result.skipped) parts.push(`跳过 ${result.skipped}`)
  let msg = parts.length ? `导入完成：${parts.join('，')}` : '导入完成（无变更）'
  if (result.warnings?.length) {
    msg += `；${result.warnings.length} 条引用未匹配（已留空或略过）`
  }
  if (result.errors?.length) {
    msg += `；${result.errors.length} 条失败`
  }
  return msg
}

/** @type {HTMLDialogElement | null} */
let importConflictDialog = null
/** @type {HTMLDialogElement | null} */
let importResultDialog = null
/** @type {null | ((mode: 'skip' | 'update' | 'rename' | null) => void)} */
let importConflictResolver = null

const IMPORT_CONFLICT_OPTIONS = [
  {
    value: 'rename',
    title: '新建副本',
    desc: '为冲突项生成新 slug/标题（推荐）',
    recommended: true,
  },
  {
    value: 'skip',
    title: '跳过已有项',
    desc: '保留现有数据，不导入冲突项',
  },
  {
    value: 'update',
    title: '覆盖更新',
    desc: '用备份内容覆盖已有项',
  },
]

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ensureImportConflictDialog() {
  if (importConflictDialog) return importConflictDialog

  const dialog = document.createElement('dialog')
  dialog.id = 'dt-import-conflict-dialog'
  dialog.className = 'dt-dialog'
  dialog.innerHTML = `
    <div class="dt-dialog__inner">
      <header class="dt-dialog__head">
        <div class="dt-dialog__icon dt-dialog__icon--info" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        </div>
        <div>
          <h3 class="dt-dialog__title">导入冲突处理</h3>
          <p class="dt-dialog__subtitle">若 slug / 标题与现有数据冲突，请选择处理方式</p>
        </div>
      </header>
      <div class="dt-conflict-options" id="dt-conflict-options"></div>
      <footer class="dt-dialog__actions">
        <button type="button" class="button button-secondary button-sm" id="dt-conflict-cancel">取消</button>
        <button type="button" class="button button-primary button-sm" id="dt-conflict-confirm">继续导入</button>
      </footer>
    </div>
  `
  document.body.appendChild(dialog)

  const optionsEl = dialog.querySelector('#dt-conflict-options')
  if (optionsEl) {
    optionsEl.innerHTML = IMPORT_CONFLICT_OPTIONS.map((opt) => `
      <label class="dt-conflict-option">
        <input type="radio" name="dt-conflict-mode" value="${opt.value}" />
        <span class="dt-conflict-option__body">
          <span class="dt-conflict-option__title">
            ${escapeHtml(opt.title)}
            ${opt.recommended ? '<span class="dt-conflict-option__tag">推荐</span>' : ''}
          </span>
          <span class="dt-conflict-option__desc">${escapeHtml(opt.desc)}</span>
        </span>
      </label>
    `).join('')
  }

  const closeConflict = (mode) => {
    dialog.close()
    const resolver = importConflictResolver
    importConflictResolver = null
    resolver?.(mode)
  }

  dialog.querySelector('#dt-conflict-cancel')?.addEventListener('click', () => closeConflict(null))
  dialog.querySelector('#dt-conflict-confirm')?.addEventListener('click', () => {
    const checked = dialog.querySelector('input[name="dt-conflict-mode"]:checked')
    const value = checked?.value
    if (value === 'skip' || value === 'update' || value === 'rename') {
      closeConflict(value)
    } else {
      closeConflict('rename')
    }
  })
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    closeConflict(null)
  })
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeConflict(null)
  })

  importConflictDialog = dialog
  return dialog
}

function ensureImportResultDialog() {
  if (importResultDialog) return importResultDialog

  const dialog = document.createElement('dialog')
  dialog.id = 'dt-import-result-dialog'
  dialog.className = 'dt-dialog'
  dialog.innerHTML = `
    <div class="dt-dialog__inner">
      <header class="dt-dialog__head">
        <div class="dt-dialog__icon dt-dialog__icon--success" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        </div>
        <div>
          <h3 class="dt-dialog__title">导入完成</h3>
          <p class="dt-dialog__subtitle" id="dt-import-result-summary"></p>
        </div>
      </header>
      <div class="dt-import-result-extra" id="dt-import-result-extra" hidden></div>
      <footer class="dt-dialog__actions">
        <button type="button" class="button button-primary button-sm" id="dt-import-result-ok">知道了</button>
      </footer>
    </div>
  `
  document.body.appendChild(dialog)
  dialog.querySelector('#dt-import-result-ok')?.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    dialog.close()
  })
  importResultDialog = dialog
  return dialog
}

/**
 * @returns {Promise<'skip' | 'update' | 'rename' | null>}
 */
export function askImportConflictMode() {
  const dialog = ensureImportConflictDialog()
  const defaultRadio = dialog.querySelector('input[name="dt-conflict-mode"][value="rename"]')
  if (defaultRadio instanceof HTMLInputElement) defaultRadio.checked = true

  return new Promise((resolve) => {
    importConflictResolver = resolve
    dialog.showModal()
  })
}

/**
 * @param {{ created?: number, updated?: number, skipped?: number, warnings?: string[], errors?: string[] }} result
 */
export function alertImportDetails(result) {
  const dialog = ensureImportResultDialog()
  const summaryEl = dialog.querySelector('#dt-import-result-summary')
  const extraEl = dialog.querySelector('#dt-import-result-extra')
  if (summaryEl) summaryEl.textContent = formatImportResultMessage(result)

  const blocks = []
  if (result.warnings?.length) {
    blocks.push(`
      <section class="dt-import-result-block dt-import-result-block--warn">
        <h4>引用提示</h4>
        <ul>${result.warnings.slice(0, 8).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
        ${result.warnings.length > 8 ? `<p class="dt-import-result-more">… 另有 ${result.warnings.length - 8} 条</p>` : ''}
      </section>
    `)
  }
  if (result.errors?.length) {
    blocks.push(`
      <section class="dt-import-result-block dt-import-result-block--error">
        <h4>错误</h4>
        <ul>${result.errors.slice(0, 8).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </section>
    `)
  }

  if (extraEl) {
    if (blocks.length) {
      extraEl.hidden = false
      extraEl.innerHTML = blocks.join('')
    } else {
      extraEl.hidden = true
      extraEl.innerHTML = ''
    }
  }

  dialog.showModal()
}
