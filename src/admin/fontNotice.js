/** @typedef {{ sourceId?: string, label: string, url: string, message: string }} FontLoadError */

const AUTO_HIDE_MS = 10_000

let barEl = null
let autoHideTimer = 0

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shortUrl(url) {
  const u = String(url || '').trim()
  if (!u) return '（未填写地址）'
  if (u.length <= 72) return u
  return `${u.slice(0, 36)}…${u.slice(-32)}`
}

function clearAutoHideTimer() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = 0
  }
}

function scheduleAutoHide() {
  clearAutoHideTimer()
  autoHideTimer = window.setTimeout(() => hideFontNotice(), AUTO_HIDE_MS)
}

function ensureBarParent() {
  if (!barEl) return
  const cms = document.getElementById('cms-root')
  const parent = cms || document.body
  if (barEl.parentElement !== parent) parent.prepend(barEl)
}

export function hideFontNotice() {
  clearAutoHideTimer()
  if (!barEl) return
  barEl.hidden = true
  document.body.classList.remove('has-font-notice')
}

export function mountFontNoticeBar() {
  if (barEl) return barEl
  barEl = document.createElement('div')
  barEl.id = 'font-notice-bar'
  barEl.className = 'font-notice-bar'
  barEl.hidden = true
  barEl.setAttribute('role', 'alert')
  barEl.innerHTML = `
    <div class="font-notice-bar__content">
      <p class="font-notice-bar__title">字体源加载失败</p>
      <ul class="font-notice-bar__list"></ul>
      <p class="font-notice-bar__hint">
        证书编辑与导出仍可使用；失败项将回退为系统字体。请检查
        <a class="font-notice-bar__link" href="/admin.html?view=fonts">字体源设置</a>
        中的地址、网络与 CORS。本提示约 10 秒后自动关闭。
      </p>
    </div>
    <button type="button" class="font-notice-bar__close" aria-label="关闭通知">×</button>
  `
  barEl.querySelector('.font-notice-bar__close')?.addEventListener('click', () => hideFontNotice())
  ensureBarParent()
  return barEl
}

/** @param {FontLoadError[]} errors */
export function showFontNoticeErrors(errors) {
  if (!errors?.length) {
    hideFontNotice()
    return
  }
  mountFontNoticeBar()
  ensureBarParent()
  const list = barEl.querySelector('.font-notice-bar__list')
  if (list) {
    list.innerHTML = errors
      .map(
        (e) => `<li><strong>${escapeHtml(e.label || '未命名')}</strong>：${escapeHtml(e.message)}<br /><code>${escapeHtml(shortUrl(e.url))}</code></li>`,
      )
      .join('')
  }
  barEl.hidden = false
  document.body.classList.add('has-font-notice')
  scheduleAutoHide()
}

export function clearFontNoticeErrors() {
  hideFontNotice()
}
