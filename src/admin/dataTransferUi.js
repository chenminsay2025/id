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

/**
 * @param {{ created?: number, updated?: number, skipped?: number, warnings?: string[], errors?: string[] }} result
 */
export function alertImportDetails(result) {
  const lines = [formatImportResultMessage(result)]
  if (result.warnings?.length) {
    lines.push('', '引用提示：', ...result.warnings.slice(0, 8))
    if (result.warnings.length > 8) lines.push(`… 另有 ${result.warnings.length - 8} 条`)
  }
  if (result.errors?.length) {
    lines.push('', '错误：', ...result.errors.slice(0, 8))
  }
  window.alert(lines.join('\n'))
}

/**
 * @returns {'skip' | 'update' | 'rename' | null}
 */
export function askImportConflictMode() {
  const choice = window.prompt(
    '若 slug/标题 与现有数据冲突，如何处理？\n'
    + '1 = 跳过已有项\n'
    + '2 = 覆盖更新已有项\n'
    + '3 = 新建副本（默认，推荐）\n\n'
    + '请输入 1、2 或 3：',
    '3',
  )
  if (choice == null) return null
  const v = String(choice).trim()
  if (v === '1') return 'skip'
  if (v === '2') return 'update'
  return 'rename'
}
