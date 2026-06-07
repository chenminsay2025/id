import {
  clearFontCatalogCache,
  loadFontCatalog,
  ensureCatalogFontFaces,
} from './fontCatalog.js'
import { setActiveFontCatalog } from './svgEngine.js'

/** @type {((catalog: import('./fontCatalog.js').FontCatalog, result: { errors: import('./fontCatalog.js').FontLoadError[] }) => void | Promise<void>) | null} */
let afterReloadHook = null

export function setFontReloadHook(hook) {
  afterReloadHook = typeof hook === 'function' ? hook : null
}

/** 保存字体源或手动刷新：清缓存、重新拉配置并加载 FontFace */
export async function reloadApplicationFonts() {
  clearFontCatalogCache()
  const catalog = await loadFontCatalog({ force: true })
  const result = await ensureCatalogFontFaces(catalog)
  setActiveFontCatalog(catalog)
  if (afterReloadHook) await afterReloadHook(catalog, result)
  return { catalog, ...result }
}
