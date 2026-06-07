/**
 * 调色板：渐变选色板 + 色相条 + RGB 数值输入
 */

/** @typedef {{ r: number, g: number, b: number, a: number }} RgbaColor */

/** @param {string} input @returns {RgbaColor | null} */
export function parseColor(input) {
  const s = String(input || '').trim()
  if (!s) return null

  const hex = s.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    }
  }

  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgb) {
    return {
      r: clamp255(rgb[1]),
      g: clamp255(rgb[2]),
      b: clamp255(rgb[3]),
      a: rgb[4] != null ? clamp01(rgb[4]) : 1,
    }
  }
  return null
}

/** @param {RgbaColor} c @param {{ alpha?: boolean }} [opts] */
export function formatColor(c, opts = {}) {
  const r = clamp255(c.r)
  const g = clamp255(c.g)
  const b = clamp255(c.b)
  const a = clamp01(c.a ?? 1)
  if (opts.alpha && a < 1) return `rgba(${r}, ${g}, ${b}, ${roundAlpha(a)})`
  return `rgb(${r}, ${g}, ${b})`
}

/** @param {RgbaColor} c */
export function toHex(c) {
  const r = clamp255(c.r).toString(16).padStart(2, '0')
  const g = clamp255(c.g).toString(16).padStart(2, '0')
  const b = clamp255(c.b).toString(16).padStart(2, '0')
  const a = clamp01(c.a ?? 1)
  if (a < 1) {
    return `#${r}${g}${b}${Math.round(a * 255).toString(16).padStart(2, '0')}`
  }
  return `#${r}${g}${b}`
}

/** @param {string | null | undefined} value */
export function swatchBackground(value) {
  const c = parseColor(value || '')
  if (!c) return 'repeating-conic-gradient(#e2e8f0 0% 25%, #fff 0% 50%) 50% / 10px 10px'
  return formatColor(c, { alpha: true })
}

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(Number(n) || 0)))
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0))
}

function roundAlpha(a) {
  return Math.round(a * 100) / 100
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      default: h = ((r - g) / d + 4) / 6; break
    }
  }
  return { h: h * 360, s, v }
}

function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rp = 0; let gp = 0; let bp = 0
  if (h < 60) { rp = c; gp = x }
  else if (h < 120) { rp = x; gp = c }
  else if (h < 180) { gp = c; bp = x }
  else if (h < 240) { gp = x; bp = c }
  else if (h < 300) { rp = x; bp = c }
  else { rp = c; bp = x }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  }
}

const PICKER_BODY_HTML = `
  <div class="color-picker-body">
    <div class="color-picker-sv" tabindex="0"><div class="color-picker-sv-cursor"></div></div>
    <div class="color-picker-sliders">
      <div class="color-picker-hue" tabindex="0"><div class="color-picker-hue-cursor"></div></div>
      <div class="color-picker-alpha-row" hidden>
        <div class="color-picker-alpha" tabindex="0"><div class="color-picker-alpha-cursor"></div></div>
      </div>
    </div>
    <div class="color-picker-rgb">
      <label><span>R</span><input type="number" class="color-picker-r" min="0" max="255" /></label>
      <label><span>G</span><input type="number" class="color-picker-g" min="0" max="255" /></label>
      <label><span>B</span><input type="number" class="color-picker-b" min="0" max="255" /></label>
      <label class="color-picker-a-field" hidden><span>A</span><input type="number" class="color-picker-a" min="0" max="1" step="0.01" /></label>
    </div>
    <div class="color-picker-preview-row">
      <span class="color-picker-preview"></span>
      <input type="text" class="color-picker-hex" spellcheck="false" />
    </div>
  </div>
  <div class="color-picker-actions">
    <button type="button" class="button button-sm color-picker-clear">清除</button>
    <button type="button" class="button button-sm button-primary color-picker-apply">确定</button>
  </div>
`

/**
 * @param {HTMLElement} root
 * @param {{ value?: string, allowAlpha?: boolean, onChange?: (v: string) => void }} opts
 */
function mountColorPickerBody(root, opts) {
  root.innerHTML = PICKER_BODY_HTML
  const svEl = /** @type {HTMLElement} */ (root.querySelector('.color-picker-sv'))
  const svCursor = /** @type {HTMLElement} */ (root.querySelector('.color-picker-sv-cursor'))
  const hueEl = /** @type {HTMLElement} */ (root.querySelector('.color-picker-hue'))
  const hueCursor = /** @type {HTMLElement} */ (root.querySelector('.color-picker-hue-cursor'))
  const alphaRow = /** @type {HTMLElement} */ (root.querySelector('.color-picker-alpha-row'))
  const alphaEl = /** @type {HTMLElement} */ (root.querySelector('.color-picker-alpha'))
  const alphaCursor = /** @type {HTMLElement} */ (root.querySelector('.color-picker-alpha-cursor'))
  const aField = /** @type {HTMLElement} */ (root.querySelector('.color-picker-a-field'))
  const rInput = /** @type {HTMLInputElement} */ (root.querySelector('.color-picker-r'))
  const gInput = /** @type {HTMLInputElement} */ (root.querySelector('.color-picker-g'))
  const bInput = /** @type {HTMLInputElement} */ (root.querySelector('.color-picker-b'))
  const aInput = /** @type {HTMLInputElement} */ (root.querySelector('.color-picker-a'))
  const previewEl = /** @type {HTMLElement} */ (root.querySelector('.color-picker-preview'))
  const hexInput = /** @type {HTMLInputElement} */ (root.querySelector('.color-picker-hex'))

  let allowAlpha = !!opts.allowAlpha
  alphaRow.hidden = !allowAlpha
  aField.hidden = !allowAlpha

  const initial = parseColor(opts.value || '') || { r: 37, g: 99, b: 235, a: 0.35 }
  let { h, s, v } = rgbToHsv(initial.r, initial.g, initial.b)
  let alpha = allowAlpha ? clamp01(initial.a ?? 1) : 1

  function valueString() {
    const rgb = hsvToRgb(h, s, v)
    return formatColor({ ...rgb, a: alpha }, { alpha: allowAlpha })
  }

  function refreshUi() {
    const rgb = hsvToRgb(h, s, v)
    svEl.style.backgroundColor = `hsl(${h} 100% 50%)`
    svCursor.style.left = `${s * 100}%`
    svCursor.style.top = `${(1 - v) * 100}%`
    hueCursor.style.left = `${(h / 360) * 100}%`
    if (allowAlpha) {
      alphaEl.style.setProperty('--cp-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`)
      alphaCursor.style.left = `${alpha * 100}%`
    }
    rInput.value = String(rgb.r)
    gInput.value = String(rgb.g)
    bInput.value = String(rgb.b)
    if (allowAlpha) aInput.value = String(roundAlpha(alpha))
    previewEl.style.background = swatchBackground(valueString())
    hexInput.value = toHex({ ...rgb, a: alpha })
  }

  function emit() {
    const str = valueString()
    opts.onChange?.(str)
    return str
  }

  function setFromRgb() {
    const rgb = {
      r: clamp255(rInput.value),
      g: clamp255(gInput.value),
      b: clamp255(bInput.value),
      a: allowAlpha ? clamp01(aInput.value) : 1,
    }
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    h = hsv.h; s = hsv.s; v = hsv.v
    alpha = rgb.a
    refreshUi()
    emit()
  }

  function dragOn(el, onPos) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const move = (ev) => onPos(ev)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      onPos(e)
    })
  }

  dragOn(svEl, (e) => {
    const rect = svEl.getBoundingClientRect()
    s = clamp01((e.clientX - rect.left) / rect.width)
    v = clamp01(1 - (e.clientY - rect.top) / rect.height)
    refreshUi(); emit()
  })
  dragOn(hueEl, (e) => {
    const rect = hueEl.getBoundingClientRect()
    h = clamp01((e.clientX - rect.left) / rect.width) * 360
    refreshUi(); emit()
  })
  if (allowAlpha) {
    dragOn(alphaEl, (e) => {
      const rect = alphaEl.getBoundingClientRect()
      alpha = clamp01((e.clientX - rect.left) / rect.width)
      refreshUi(); emit()
    })
  }

  rInput.addEventListener('change', setFromRgb)
  gInput.addEventListener('change', setFromRgb)
  bInput.addEventListener('change', setFromRgb)
  aInput.addEventListener('change', setFromRgb)
  hexInput.addEventListener('change', () => {
    const parsed = parseColor(hexInput.value)
    if (!parsed) return
    const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b)
    h = hsv.h; s = hsv.s; v = hsv.v
    alpha = allowAlpha ? parsed.a : 1
    refreshUi(); emit()
  })

  refreshUi()

  return {
    getValue: valueString,
    setValue(val) {
      const c = parseColor(val || '') || { r: 37, g: 99, b: 235, a: allowAlpha ? 0.35 : 1 }
      const hsv = rgbToHsv(c.r, c.g, c.b)
      h = hsv.h; s = hsv.s; v = hsv.v
      alpha = allowAlpha ? clamp01(c.a ?? 1) : 1
      refreshUi()
    },
    setAllowAlpha(on) {
      allowAlpha = on
      alphaRow.hidden = !on
      aField.hidden = !on
      if (!on) alpha = 1
      refreshUi()
    },
  }
}

function positionDialog(dlg, anchorEl) {
  const rect = anchorEl.getBoundingClientRect()
  dlg.showModal()
  const dlgRect = dlg.getBoundingClientRect()
  let top = rect.bottom + 8
  if (top + dlgRect.height > window.innerHeight - 8) top = rect.top - dlgRect.height - 8
  let left = rect.left
  if (left + dlgRect.width > window.innerWidth - 8) left = window.innerWidth - dlgRect.width - 8
  dlg.style.top = `${Math.max(8, top)}px`
  dlg.style.left = `${Math.max(8, left)}px`
}

/**
 * @param {{ title?: string, value?: string, allowAlpha?: boolean, anchorEl?: HTMLElement, onLiveChange?: (v: string) => void, onApply?: (v: string) => void, onClear?: () => void }} opts
 */
export function openColorPicker(opts = {}) {
  const dlg = document.createElement('dialog')
  dlg.className = 'color-picker-dialog'
  dlg.innerHTML = `
    <div class="color-picker-dialog-inner">
      <div class="color-picker-header">
        <h3 class="color-picker-title">${opts.title || '选择颜色'}</h3>
        <button type="button" class="color-picker-close" aria-label="关闭">×</button>
      </div>
      <div class="color-picker-mount"></div>
    </div>
  `
  document.body.appendChild(dlg)
  const mount = /** @type {HTMLElement} */ (dlg.querySelector('.color-picker-mount'))

  const picker = mountColorPickerBody(mount, {
    value: opts.value || '',
    allowAlpha: opts.allowAlpha,
    onChange: (v) => opts.onLiveChange?.(v),
  })

  dlg.querySelector('.color-picker-clear')?.addEventListener('click', () => {
    opts.onClear?.()
    dlg.close()
  })
  dlg.querySelector('.color-picker-apply')?.addEventListener('click', () => {
    opts.onApply?.(picker.getValue())
    dlg.close()
  })
  dlg.querySelector('.color-picker-close')?.addEventListener('click', () => dlg.close())
  dlg.addEventListener('close', () => dlg.remove())

  if (opts.anchorEl) positionDialog(dlg, opts.anchorEl)
  else dlg.showModal()
}

/**
 * @param {{ anchorEl: HTMLElement, overlayFill: string, textFill: string, onLiveChange: (p: { overlayFill: string, textFill: string }) => void, onApply: (p: { overlayFill: string, textFill: string }) => void }} opts
 */
export function openFillColorPicker(opts) {
  const dlg = document.createElement('dialog')
  dlg.className = 'color-picker-dialog color-picker-dialog--fill'
  dlg.innerHTML = `
    <div class="color-picker-dialog-inner">
      <div class="color-picker-header">
        <h3 class="color-picker-title">填色</h3>
        <button type="button" class="color-picker-close" aria-label="关闭">×</button>
      </div>
      <div class="color-picker-targets">
        <button type="button" class="color-picker-target color-picker-target--active" data-target="box">
          <span class="color-picker-target-swatch" data-swatch="box"></span>框填色
        </button>
        <button type="button" class="color-picker-target" data-target="text">
          <span class="color-picker-target-swatch" data-swatch="text"></span>文字颜色
        </button>
      </div>
      <div class="color-picker-mount"></div>
    </div>
  `
  document.body.appendChild(dlg)

  let overlayFill = opts.overlayFill || ''
  let textFill = opts.textFill || ''
  /** @type {'box' | 'text'} */
  let active = 'box'
  const mount = /** @type {HTMLElement} */ (dlg.querySelector('.color-picker-mount'))
  const swatchBox = /** @type {HTMLElement} */ (dlg.querySelector('[data-swatch="box"]'))
  const swatchText = /** @type {HTMLElement} */ (dlg.querySelector('[data-swatch="text"]'))

  function refreshSwatches() {
    swatchBox.style.background = swatchBackground(overlayFill)
    swatchText.style.background = swatchBackground(textFill || '#000000')
  }

  function emit() {
    opts.onLiveChange({ overlayFill, textFill })
  }

  const picker = mountColorPickerBody(mount, {
    value: overlayFill,
    allowAlpha: true,
    onChange: (v) => {
      if (active === 'box') overlayFill = v
      else textFill = v
      refreshSwatches()
      emit()
    },
  })

  dlg.querySelectorAll('.color-picker-target').forEach((btn) => {
    btn.addEventListener('click', () => {
      active = btn.dataset.target === 'text' ? 'text' : 'box'
      dlg.querySelectorAll('.color-picker-target').forEach((b) => {
        b.classList.toggle('color-picker-target--active', b === btn)
      })
      picker.setAllowAlpha(active === 'box')
      picker.setValue(active === 'box' ? overlayFill : textFill)
    })
  })

  dlg.querySelector('.color-picker-clear')?.addEventListener('click', () => {
    if (active === 'box') overlayFill = ''
    else textFill = ''
    picker.setValue('')
    refreshSwatches()
    opts.onApply({ overlayFill, textFill })
    dlg.close()
  })
  dlg.querySelector('.color-picker-apply')?.addEventListener('click', () => {
    if (active === 'box') overlayFill = picker.getValue()
    else textFill = picker.getValue()
    opts.onApply({ overlayFill, textFill })
    dlg.close()
  })
  dlg.querySelector('.color-picker-close')?.addEventListener('click', () => dlg.close())
  dlg.addEventListener('close', () => dlg.remove())

  refreshSwatches()
  positionDialog(dlg, opts.anchorEl)
}
