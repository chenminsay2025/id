const LOG_PREFIX = '[CAT前后缀]'

export function isPublicAdornDebugEnabled() {
  try {
    if (new URLSearchParams(window.location.search).has('debug_adorn')) return true
    if (localStorage.getItem('cat.debugAdorn') === '1') return true
  } catch {
    /* ignore */
  }
  return false
}

export function logPublicAdorn(step, payload = {}) {
  if (!isPublicAdornDebugEnabled()) return
  console.log(LOG_PREFIX, step, payload)
}

export function warnPublicAdorn(step, payload = {}) {
  if (!isPublicAdornDebugEnabled()) return
  console.warn(LOG_PREFIX, step, payload)
}

/** 严重问题：无前后缀数据（不受 debug 开关限制） */
export function warnPublicAdornCritical(step, payload = {}) {
  console.warn(LOG_PREFIX, step, payload)
}

export function groupPublicAdorn(title, fn) {
  if (!isPublicAdornDebugEnabled()) {
    fn()
    return
  }
  console.groupCollapsed(`${LOG_PREFIX} ${title}`)
  try {
    fn()
  } finally {
    console.groupEnd()
  }
}

/** 对比 raw / display 行，列出前后缀是否生效 */
export function diffAdornRow(rawRow, displayRow, adornmentKeys = []) {
  const keys = new Set([
    ...Object.keys(rawRow || {}),
    ...Object.keys(displayRow || {}),
    ...adornmentKeys,
  ])
  const diffs = []
  for (const key of keys) {
    const raw = String(rawRow?.[key] ?? '')
    const display = String(displayRow?.[key] ?? '')
    if (raw === display) {
      diffs.push({ column: key, changed: false, raw, display })
    } else {
      diffs.push({ column: key, changed: true, raw, display })
    }
  }
  return diffs
}

/** 该列配置了前后缀但 SVG 仍显示原值时返回 true */
export function shouldWarnSvgMissingAdorn(column, rawRow, displayRow, svgText, adornments = {}) {
  const raw = String(rawRow?.[column] ?? '')
  const expected = String(displayRow?.[column] ?? raw)
  const text = String(svgText ?? '').trim()
  if (!text || expected === raw) return false

  const adorn = adornments[column]
  const hasAdorn = !!(adorn?.prefix?.length || adorn?.suffix?.length)
  if (!hasAdorn && expected === raw) return false

  return text === raw
}

/** 读取 SVG 数据层文字（#cat-data-layer） */
export function readSvgDataLayerTexts(svgEl) {
  if (!svgEl) return []
  return [...svgEl.querySelectorAll('[data-cat-data-column]')].map((el) => ({
    column: el.getAttribute('data-cat-data-column'),
    text: (el.textContent || '').trim(),
    fontFamily: el.getAttribute('font-family') || '',
  }))
}

export function exposePublicAdornDebug(getState) {
  if (typeof window === 'undefined') return
  window.__CAT_PUBLIC_ADORN_DEBUG__ = {
    enabled: isPublicAdornDebugEnabled(),
    help: 'URL 加 ?debug_adorn=1 或 localStorage.setItem("cat.debugAdorn","1") 后刷新',
    getState,
    readSvg: () => readSvgDataLayerTexts(document.querySelector('.preview-stage svg')),
  }
  if (isPublicAdornDebugEnabled()) {
    console.info(`${LOG_PREFIX} 调试已开启`, window.__CAT_PUBLIC_ADORN_DEBUG__.help)
  }
}
