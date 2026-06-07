import { listLayoutBoxes, resolveBoxId } from './layoutBinding.js'
import { getColumnLayout, layoutHasBox } from './svgEngine.js'

let dialogEl = null

function ensureDialog() {
  if (dialogEl) return dialogEl
  dialogEl = document.createElement('dialog')
  dialogEl.className = 'column-bind-dialog'
  dialogEl.innerHTML = `
    <form method="dialog" class="column-bind-dialog__inner">
      <header class="column-bind-dialog__header">
        <h2 class="column-bind-dialog__title">数据绑定</h2>
        <p class="column-bind-dialog__subtitle" id="column-bind-subtitle"></p>
      </header>
      <div class="column-bind-dialog__list" id="column-bind-list" role="listbox"></div>
      <footer class="column-bind-dialog__footer">
        <button type="button" class="btn btn-sm" id="column-bind-clear">解除绑定</button>
        <button type="button" class="btn btn-sm" value="cancel">取消</button>
      </footer>
    </form>
  `
  document.body.appendChild(dialogEl)

  dialogEl.querySelector('#column-bind-clear')?.addEventListener('click', () => {
    dialogEl.returnValue = '__clear__'
    dialogEl.close()
  })
  dialogEl.querySelector('[value="cancel"]')?.addEventListener('click', () => {
    dialogEl.returnValue = ''
    dialogEl.close()
  })

  return dialogEl
}

/**
 * @param {{
 *   columnName: string,
 *   layoutOverrides: object,
 *   tableColumns?: string[],
 * }} options
 * @returns {Promise<string | null | '__clear__'>} 选中的编辑框 id；解除绑定为 '__clear__'；取消为 null
 */
export function openColumnBindDialog(options) {
  const { columnName, layoutOverrides, tableColumns = [] } = options
  const dlg = ensureDialog()
  const currentBoxId = resolveBoxId(columnName, layoutOverrides)
  const boxes = collectBindableBoxes(layoutOverrides, tableColumns)

  dlg.querySelector('#column-bind-subtitle').textContent =
    `列「${columnName}」当前绑定：${currentBoxId === columnName ? currentBoxId : `${currentBoxId}（编辑框）`}`

  const list = dlg.querySelector('#column-bind-list')
  if (!boxes.length) {
    list.innerHTML = '<p class="column-bind-dialog__empty">预览中暂无编辑框。请先在 SVG 预览区点击「添加编辑框」。</p>'
  } else {
    list.innerHTML = boxes.map((box) => {
      const selected = box.id === currentBoxId
      const meta = box.boundLabel
        ? `已绑定列：${box.boundLabel}`
        : (box.boundColumns[0] === box.id ? '默认（列名同编辑框）' : '')
      return `<button type="button" class="column-bind-item${selected ? ' is-selected' : ''}" data-box-id="${escapeAttr(box.id)}" role="option" aria-selected="${selected}">
        <span class="column-bind-item__id">${escapeHtml(box.id)}</span>
        <span class="column-bind-item__meta">${escapeHtml(meta)}</span>
      </button>`
    }).join('')

    list.querySelectorAll('.column-bind-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        dlg.returnValue = btn.dataset.boxId || ''
        dlg.close()
      })
    })
  }

  dlg.returnValue = ''
  dlg.showModal()
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue
      if (v === '__clear__') resolve('__clear__')
      else if (v) resolve(v)
      else resolve(null)
    }, { once: true })
  })
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;')
}

function collectBindableBoxes(layoutOverrides, tableColumns) {
  const items = listLayoutBoxes(layoutOverrides, tableColumns)
  const seen = new Set(items.map((b) => b.id))
  for (const col of tableColumns) {
    const boxId = resolveBoxId(col, layoutOverrides)
    if (seen.has(boxId)) continue
    const layout = getColumnLayout(col, layoutOverrides)
    if (!layoutHasBox(layout)) continue
    seen.add(boxId)
    const boundCols = [col]
    items.push({
      id: boxId,
      boundColumns: boundCols,
      boundLabel: null,
      isBound: true,
    })
  }
  items.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))
  return items
}
