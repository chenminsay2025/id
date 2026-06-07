import { getFontFetchCandidates } from './fontConfig.js'
import { getRuntimeFontFetchCandidates } from './fontRuntime.js'
import { FONT_REGISTER_NAMES, parsePrimaryFontFamily } from './fontLoader.js'
import { getDefaultFontSource, getEnabledFontUrls } from './fontCatalog.js'

/** @type {Map<string, Promise<ArrayBuffer>>} */
const fontBufferByUrl = new Map()

export { parsePrimaryFontFamily }

function sanitizePdfFontName(name) {
  const safe = String(name || 'CatFontDefault').replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 80)
  return safe || 'CatFontDefault'
}

async function loadFontBuffer(url) {
  if (!url) throw new Error('字体地址为空')
  if (!fontBufferByUrl.has(url)) {
    fontBufferByUrl.set(url, (async () => {
      for (const candidate of getFontFetchCandidates(url)) {
        if (!candidate) continue
        try {
          const res = await fetch(candidate)
          if (!res.ok) continue
          const buf = await res.arrayBuffer()
          if (buf?.byteLength > 0) return buf
        } catch {
          /* try next */
        }
      }
      throw new Error(`字体加载失败: ${url}`)
    })())
  }
  return fontBufferByUrl.get(url)
}

async function loadFallbackFontBuffer(ttfUrl) {
  if (ttfUrl) return loadFontBuffer(ttfUrl)
  for (const url of await getRuntimeFontFetchCandidates()) {
    try {
      return await loadFontBuffer(url)
    } catch {
      /* try next */
    }
  }
  throw new Error('字体加载失败，请检查字体配置或 /font/ 目录')
}

/** @param {SVGElement} svgRoot */
export function collectFontFamiliesFromSvg(svgRoot) {
  const families = new Set()
  if (!svgRoot) return families
  svgRoot.querySelectorAll('text, tspan').forEach((el) => {
    const fam = el.getAttribute('font-family')
    if (!fam) return
    families.add(parsePrimaryFontFamily(fam))
    for (const part of String(fam).split(',')) {
      const p = parsePrimaryFontFamily(part)
      if (p) families.add(p)
    }
  })
  return families
}

/**
 * 为 PDFKit 注册 SVG 会用到的字体。
 * @returns {Promise<{ registry: Map<string, string>, defaultFontName: string }>}
 */
export async function setupPdfFonts(doc, { fontCatalog, ttfUrl, svgRoot } = {}) {
  /** family alias → PDFKit register name */
  const registry = new Map()
  /** register name → already registered */
  const registered = new Set()
  let defaultFontName = ''

  const registerBuffer = (registerName, buffer, aliasKeys = []) => {
    const safeName = sanitizePdfFontName(registerName)
    if (!registered.has(safeName)) {
      doc.registerFont(safeName, buffer)
      registered.add(safeName)
    }
    registry.set(safeName, safeName)
    for (const alias of aliasKeys) {
      const normalized = parsePrimaryFontFamily(alias) || String(alias || '').trim()
      if (normalized) registry.set(normalized, safeName)
    }
    if (!defaultFontName) defaultFontName = safeName
    return safeName
  }

  const sources = []
  if (fontCatalog?.sources?.length) {
    sources.push(...fontCatalog.sources.filter((s) => s?.url))
    const def = getDefaultFontSource(fontCatalog)
    if (def && !sources.some((s) => s.id === def.id)) sources.unshift(def)
  }

  for (const src of sources) {
    const urls = getEnabledFontUrls(src)
    let loaded = false
    for (const url of urls) {
      try {
        const buf = await loadFontBuffer(url)
        registerBuffer(src.cssFamily, buf, [
          src.cssFamily,
          `'${src.cssFamily}'`,
          `"${src.cssFamily}"`,
        ])
        loaded = true
        break
      } catch (err) {
        console.warn('[PDF] 字体源加载失败:', src.label || src.id, url, err)
      }
    }
    if (!loaded && urls.length) {
      console.warn('[PDF] 字体源全部地址不可用:', src.label || src.id)
    }
  }

  if (!registered.size) {
    const buf = await loadFallbackFontBuffer(ttfUrl)
    defaultFontName = registerBuffer(FONT_REGISTER_NAMES[0], buf, FONT_REGISTER_NAMES)
  } else {
    const def = getDefaultFontSource(fontCatalog)
    if (def?.cssFamily && registry.has(def.cssFamily)) {
      defaultFontName = registry.get(def.cssFamily)
    } else {
      defaultFontName = registry.values().next().value || defaultFontName
    }

    const usedFamilies = svgRoot ? collectFontFamiliesFromSvg(svgRoot) : new Set()
    for (const fam of usedFamilies) {
      if (registry.has(fam)) continue
      for (const [alias, regName] of registry.entries()) {
        if (fam.includes(alias) || alias.includes(fam)) {
          registry.set(fam, regName)
          break
        }
      }
    }
  }

  return { registry, defaultFontName: defaultFontName || FONT_REGISTER_NAMES[0] }
}

export function createPdfFontCallback(registry, defaultFontName) {
  return function fontCallback(family, bold, italic, fontOptions) {
    const primary = parsePrimaryFontFamily(family)
    let regName = primary ? registry.get(primary) : null

    if (!regName && family) {
      for (const [alias, name] of registry.entries()) {
        if (alias && String(family).includes(alias)) {
          regName = name
          break
        }
      }
    }

    if (!regName) regName = registry.get(defaultFontName) || defaultFontName

    if (bold) fontOptions.fauxBold = true
    if (italic) fontOptions.fauxItalic = true
    return regName || 'Helvetica'
  }
}

export function normalizePdfExportOptions(exportOptions) {
  if (typeof exportOptions === 'string') {
    return { ttfUrl: exportOptions, fontCatalog: null }
  }
  if (exportOptions && typeof exportOptions === 'object') {
    return {
      ttfUrl: exportOptions.ttfUrl ?? exportOptions.fontUrl ?? null,
      fontCatalog: exportOptions.fontCatalog ?? null,
      pageWidthMm: exportOptions.pageWidthMm ?? exportOptions.page_width_mm,
      pageHeightMm: exportOptions.pageHeightMm ?? exportOptions.page_height_mm,
    }
  }
  return { ttfUrl: null, fontCatalog: null }
}
