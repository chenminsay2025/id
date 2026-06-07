/**
 * 字体文件 SourceHanSansCN-Medium.ttf 的内外名称对照
 * - 文件名 / PostScript：SourceHanSansCN-Medium
 * - Windows / Illustrator 显示：思源黑体 CN Medium
 * - 英文全名：Source Han Sans CN Medium
 */
export const FONT_NAMES = {
  file: 'SourceHanSansCN-Medium.ttf',
  postScript: 'SourceHanSansCN-Medium',
  english: 'Source Han Sans CN Medium',
  chinese: '思源黑体 CN Medium',
  family: 'Source Han Sans CN',
  subfamily: 'Medium',
}

/** 网页预览用（含 sans-serif 回退） */
export function getPreviewFontFamily() {
  const { chinese, english, postScript } = FONT_NAMES
  return `'${chinese}', '${english}', ${postScript}, sans-serif`
}

/** 导出 SVG / PDF 用（不含 sans-serif，避免 Illustrator 报缺字） */
export function getExportFontFamily() {
  const { chinese, english, postScript } = FONT_NAMES
  return `'${chinese}', '${english}', ${postScript}`
}

/** 取 font-family 属性中的首个字体名 */
export function parsePrimaryFontFamily(family) {
  const s = String(family || '').trim()
  if (!s) return ''
  const first = s.split(',')[0].trim()
  return first.replace(/^['"]|['"]$/g, '')
}

/** PDFKit 主注册名（与 PostScript 一致） */
export const FONT_FAMILY = FONT_NAMES.postScript

/** PDF / svg-to-pdfkit 需注册的别名 */
export const FONT_REGISTER_NAMES = [
  FONT_NAMES.postScript,
  FONT_NAMES.english,
  FONT_NAMES.chinese,
  FONT_NAMES.family,
]

let fontBase64Promise = null
let fontFacePromise = null

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function buildFontFaceCss(base64) {
  const src = `url('data:font/truetype;base64,${base64}') format('truetype')`
  const { chinese, english, postScript } = FONT_NAMES
  return `
    @font-face {
      font-family: '${chinese}';
      src: ${src};
      font-weight: 500;
      font-style: normal;
    }
    @font-face {
      font-family: '${english}';
      src: ${src};
      font-weight: 500;
      font-style: normal;
    }
    @font-face {
      font-family: '${postScript}';
      src: ${src};
      font-weight: 500;
      font-style: normal;
    }
  `
}

export async function getFontBase64(fontUrl) {
  if (!fontBase64Promise) {
    fontBase64Promise = fetch(fontUrl, { mode: 'cors', credentials: 'omit' })
      .then((r) => {
        if (!r.ok) throw new Error(`字体加载失败: ${fontUrl} (${r.status})`)
        return r.arrayBuffer()
      })
      .then(arrayBufferToBase64)
  }
  return fontBase64Promise
}

/** 注册 FontFace，确保网页预览正确显示中文 */
export async function ensureFontFace(fontUrl) {
  if (!fontFacePromise) {
    fontFacePromise = (async () => {
      const base64 = await getFontBase64(fontUrl)
      const dataUrl = `url(data:font/truetype;base64,${base64})`
      for (const name of [FONT_NAMES.chinese, FONT_NAMES.english, FONT_NAMES.postScript]) {
        const face = new FontFace(name, dataUrl, { weight: '500', style: 'normal' })
        await face.load()
        document.fonts.add(face)
      }
      await document.fonts.ready
      return base64
    })()
  }
  return fontFacePromise
}

/** 统一 SVG 文本 font-family（Illustrator / 系统可识别） */
export function applyFontFamilyToSvg(svgRoot, forExport = false) {
  const family = forExport ? getExportFontFamily() : getPreviewFontFamily()
  svgRoot.querySelectorAll('text, tspan').forEach((el) => {
    el.setAttribute('font-family', family)
    el.removeAttribute('font')
  })
}

/** 在 SVG 内嵌 base64 字体（多名称 @font-face） */
export function embedFontInSvg(svgEl, fontBase64) {
  const NS = 'http://www.w3.org/2000/svg'
  let defs = svgEl.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(NS, 'defs')
    svgEl.prepend(defs)
  }

  let style = defs.querySelector('#cat-font-datauri')
  if (!style) {
    style = document.createElementNS(NS, 'style')
    style.id = 'cat-font-datauri'
    defs.appendChild(style)
  }

  style.textContent = buildFontFaceCss(fontBase64)
  applyFontFamilyToSvg(svgEl, false)
}

/** 导出 SVG 前：CSS 内 font-family 改为系统名，去掉 sans-serif */
export function normalizeSvgStylesForExport(svgRoot) {
  const exportFamily = getExportFontFamily()
  svgRoot.querySelectorAll('style').forEach((style) => {
    if (style.id === 'cat-font-face') return
    style.textContent = (style.textContent || '')
      .replace(/font-family:[^;]+;/gi, `font-family: ${exportFamily};`)
      .replace(/font-weight:\s*[^;]+;/gi, 'font-weight: 500;')
      .replace(/font-style:\s*[^;]+;/gi, 'font-style: normal;')
  })
  svgRoot.querySelectorAll('text, tspan').forEach((el) => {
    const fam = el.getAttribute('font-family') || ''
    if (/CatFont_/i.test(fam)) return
    if (el.closest?.('.cat-data-field') || el.closest?.('[data-cat-data-column]')) return
    el.setAttribute('font-family', exportFamily)
    el.removeAttribute('font')
  })
}
