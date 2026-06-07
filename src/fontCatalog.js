import { getPreviewFontFamily } from './fontLoader.js'
import { FONT_CDN_URL } from './fontConfig.js'

/** @typedef {{ url: string, enabled?: boolean }} FontUrlEntry */

/** @typedef {{ id: string, label: string, url: string, urls?: FontUrlEntry[], cssFamily: string, enabled?: boolean, legacyIds?: string[] }} FontSource */

/** @typedef {{ defaultSourceId: string, defaultUrl: string, sources: FontSource[] }} FontCatalog */

const base64ByUrl = new Map()
/** @type {FontFace[][]} */
const facesBySourceId = new Map()
/** @type {Map<string, string>} 失败时的 sourceId → url（地址变更后可重试） */
const failedSources = new Map()

/** @typedef {{ sourceId: string, label: string, url: string, message: string }} FontLoadError */

/** @type {((errors: FontLoadError[]) => void) | null} */
let fontLoadErrorHandler = null

let catalogCache = /** @type {FontCatalog | null} */ (null)
let catalogPromise = /** @type {Promise<FontCatalog> | null} */ (null)

/** @param {FontSource | { url?: string, urls?: FontUrlEntry[] }} source */
export function getEnabledFontUrls(source) {
  if (!source) return []
  if (Array.isArray(source.urls) && source.urls.length) {
    return source.urls
      .filter((entry) => entry?.url && entry.enabled !== false)
      .map((entry) => String(entry.url).trim())
  }
  const single = String(source.url || '').trim()
  return single ? [single] : []
}

/** @param {Partial<FontSource> & { id?: string, label?: string, url?: string, urls?: FontUrlEntry[], legacyIds?: string[] }} raw */
function normalizeCatalogSource(raw) {
  const urls = Array.isArray(raw.urls) && raw.urls.length
    ? raw.urls
      .filter((entry) => entry?.url)
      .map((entry) => ({
        url: String(entry.url).trim(),
        enabled: entry.enabled !== false,
      }))
    : raw.url
      ? [{ url: String(raw.url).trim(), enabled: true }]
      : []
  const enabledUrls = getEnabledFontUrls({ urls, url: raw.url })
  const id = String(raw.id)
  return {
    id,
    label: String(raw.label || '未命名').trim() || '未命名',
    urls,
    url: enabledUrls[0] || urls[0]?.url || '',
    cssFamily: raw.cssFamily || cssFamilyForSourceId(id),
    enabled: raw.enabled !== false,
    legacyIds: Array.isArray(raw.legacyIds)
      ? [...new Set(raw.legacyIds.map((v) => String(v || '').trim()).filter(Boolean))]
      : [],
  }
}

export function cssFamilyForSourceId(id) {
  const safe = String(id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `CatFont_${safe}`
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function setFontLoadErrorHandler(handler) {
  fontLoadErrorHandler = typeof handler === 'function' ? handler : null
}

/** @param {unknown} err @param {string} [url] */
export function describeFontLoadError(err, url = '') {
  const raw = err instanceof Error ? err.message : String(err || '未知错误')
  if (!raw || raw === 'Failed to fetch') {
    return '网络请求失败（无法连接、代理错误或 CORS 限制）'
  }
  if (/^HTTP \d+/.test(raw)) return raw
  if (/字体加载失败/i.test(raw)) return raw.replace(/^字体加载失败:\s*/i, '')
  if (/字体地址为空/.test(raw)) return '字体地址为空'
  return raw
}

/** @param {FontSource} source @param {unknown} err */
export function formatFontSourceError(source, err) {
  return {
    sourceId: String(source?.id || ''),
    label: String(source?.label || source?.id || '未命名').trim() || '未命名',
    url: String(source?.url || '').trim(),
    message: describeFontLoadError(err, source?.url),
  }
}

function notifyFontLoadErrors(errors) {
  if (fontLoadErrorHandler) fontLoadErrorHandler(errors)
}

export async function fetchFontBase64(url) {
  if (!url) throw new Error('字体地址为空')
  if (!base64ByUrl.has(url)) {
    const promise = (async () => {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        return arrayBufferToBase64(buf)
      } catch (err) {
        base64ByUrl.delete(url)
        throw err
      }
    })()
    base64ByUrl.set(url, promise)
  }
  return base64ByUrl.get(url)
}

function fallbackCatalog() {
  const id = 'qiniu-default'
  return {
    defaultSourceId: id,
    defaultUrl: FONT_CDN_URL,
    sources: [{
      id,
      label: '默认 CDN',
      url: FONT_CDN_URL,
      cssFamily: cssFamilyForSourceId(id),
      enabled: true,
    }],
  }
}

/** 从公开 API 加载已启用的字体源列表 */
export async function loadFontCatalog({ force = false } = {}) {
  if (catalogCache && !force) return catalogCache
  if (force) {
    catalogPromise = null
    catalogCache = null
  }
  if (!catalogPromise) {
    catalogPromise = (async () => {
      try {
        const res = await fetch('/api/public/font-config', { credentials: 'omit' })
        if (res.ok) {
          const data = await res.json()
          const rawSources = Array.isArray(data.sources) ? data.sources : []
          const sources = rawSources
            .filter((s) => s && (s.url || (Array.isArray(s.urls) && s.urls.length)) && s.enabled !== false)
            .map((s) => normalizeCatalogSource(s))
            .filter((s) => s.url || s.urls.length)
          if (sources.length) {
            const defaultSourceId = sources.find((s) => s.id === data.defaultSourceId)?.id
              || sources[0].id
            const def = sources.find((s) => s.id === defaultSourceId) || sources[0]
            catalogCache = {
              defaultSourceId,
              defaultUrl: def.url,
              sources,
            }
            return catalogCache
          }
          if (data?.url) {
            const id = data.id || 'legacy-active'
            catalogCache = {
              defaultSourceId: id,
              defaultUrl: data.url,
              sources: [{
                id,
                label: data.label || '当前字体',
                url: data.url,
                cssFamily: cssFamilyForSourceId(id),
                enabled: true,
              }],
            }
            return catalogCache
          }
        }
      } catch {
        /* 回退 */
      }
      catalogCache = fallbackCatalog()
      return catalogCache
    })()
  }
  return catalogPromise
}

export function clearFontCatalogCache() {
  catalogCache = null
  catalogPromise = null
  base64ByUrl.clear()
  facesBySourceId.clear()
  failedSources.clear()
}

/** 保存字体配置后调用：强制重新拉取并加载字体 */
export async function reloadCatalogFontFaces() {
  clearFontCatalogCache()
  const catalog = await loadFontCatalog({ force: true })
  return { catalog, ...(await ensureCatalogFontFaces(catalog)) }
}

export function getSourceById(catalog, sourceId) {
  if (!catalog || !sourceId) return null
  let src = catalog.sources.find((s) => s.id === sourceId)
  if (src) return src
  src = catalog.sources.find((s) => Array.isArray(s.legacyIds) && s.legacyIds.includes(sourceId))
  return src || null
}

/** 编辑框未指定 fontSourceId 时使用的默认字体源 */
export function getDefaultFontSource(catalog) {
  if (!catalog?.sources?.length) return null
  return getSourceById(catalog, catalog.defaultSourceId) || catalog.sources[0]
}

export function getLayoutFontFamily(layout, catalog) {
  const src = layout?.fontSourceId
    ? getSourceById(catalog, layout.fontSourceId)
    : getDefaultFontSource(catalog)
  if (src?.cssFamily) return `'${src.cssFamily}', sans-serif`
  return getPreviewFontFamily()
}

export function getMeasureFontFamily(layout, catalog) {
  const src = layout?.fontSourceId
    ? getSourceById(catalog, layout.fontSourceId)
    : getDefaultFontSource(catalog)
  if (src?.cssFamily) return `'${src.cssFamily}', ${getPreviewFontFamily()}`
  return getPreviewFontFamily()
}

/** @returns {Promise<{ errors: FontLoadError[] }>} */
export async function ensureCatalogFontFaces(catalog) {
  if (!catalog?.sources?.length) return { errors: [] }
  const errors = /** @type {FontLoadError[]} */ ([])
  await Promise.all(catalog.sources.map(async (src) => {
    try {
      await ensureSourceFontFace(src)
    } catch (err) {
      errors.push(formatFontSourceError(src, err))
    }
  }))
  notifyFontLoadErrors(errors)
  return { errors }
}

async function ensureSourceFontFace(source) {
  const urls = getEnabledFontUrls(source)
  if (!urls.length) throw new Error('字体地址为空')
  if (facesBySourceId.has(source.id)) return
  const failedUrl = failedSources.get(source.id)
  let lastErr = /** @type {Error | null} */ (null)
  for (const url of urls) {
    if (failedUrl != null && failedUrl === url && urls.length === 1) {
      throw new Error('此前加载失败')
    }
    try {
      const base64 = await fetchFontBase64(url)
      const dataUrl = `url(data:font/truetype;base64,${base64})`
      const face = new FontFace(source.cssFamily, dataUrl, { weight: '500', style: 'normal' })
      await face.load()
      document.fonts.add(face)
      facesBySourceId.set(source.id, [face])
      failedSources.delete(source.id)
      source.url = url
      return
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err || '字体加载失败'))
      failedSources.set(source.id, url)
    }
  }
  throw lastErr || new Error('字体加载失败')
}

export function buildCatalogFontFaceCss(catalog, base64ByUrlMap) {
  let css = ''
  for (const src of catalog?.sources || []) {
    const urls = getEnabledFontUrls(src)
    let b64 = null
    for (const url of urls) {
      b64 = base64ByUrlMap.get(url)
      if (b64) break
    }
    if (!b64) continue
    const data = `url(data:font/truetype;base64,${b64}) format('truetype')`
    css += `@font-face{font-family:'${src.cssFamily}';src:${data};font-weight:500;font-style:normal;}\n`
  }
  return css
}

/** 向 SVG 注入所有已启用字体的 @font-face（不覆盖各元素 font-family） */
export async function injectCatalogFonts(svgRoot, catalog) {
  if (!catalog?.sources?.length) return
  const b64Map = new Map()
  for (const src of catalog.sources) {
    for (const url of getEnabledFontUrls(src)) {
      if (!url || b64Map.has(url)) continue
      try {
        b64Map.set(url, await fetchFontBase64(url))
      } catch {
        /* 单源失败时跳过，预览/导出使用已加载字体或回退 */
      }
    }
  }
  const NS = 'http://www.w3.org/2000/svg'
  let defs = svgRoot.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(NS, 'defs')
    svgRoot.prepend(defs)
  }
  let style = defs.querySelector('#cat-font-face')
  if (!style) {
    style = document.createElementNS(NS, 'style')
    style.id = 'cat-font-face'
    defs.appendChild(style)
  }
  style.textContent = buildCatalogFontFaceCss(catalog, b64Map)
}

/** 收集 layoutOverrides 中实际用到的字体源 id（含默认） */
export function collectFontSourceIdsFromLayouts(layoutOverrides, catalog) {
  const ids = new Set()
  const def = catalog?.defaultSourceId
  if (def) ids.add(def)
  if (!layoutOverrides || typeof layoutOverrides !== 'object') return ids
  for (const key of Object.keys(layoutOverrides)) {
    if (key.startsWith('__')) continue
    const layout = layoutOverrides[key]
    if (!layout?.fontSourceId) continue
    ids.add(layout.fontSourceId)
    const src = getSourceById(catalog, layout.fontSourceId)
    if (src?.id) ids.add(src.id)
  }
  return ids
}

export async function injectFontsForLayouts(svgRoot, catalog, layoutOverrides) {
  if (!catalog) return
  const usedIds = collectFontSourceIdsFromLayouts(layoutOverrides, catalog)
  const subset = {
    ...catalog,
    sources: catalog.sources.filter((s) => usedIds.has(s.id)
      || (Array.isArray(s.legacyIds) && s.legacyIds.some((legacyId) => usedIds.has(legacyId)))),
  }
  if (!subset.sources.length) subset.sources = catalog.sources.slice(0, 1)
  await injectCatalogFonts(svgRoot, subset)
}
