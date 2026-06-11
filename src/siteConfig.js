import { api } from './api/client.js'
import {
  defaultExcelImportImageConfig,
  normalizeExcelImportImageConfig,
} from './excelImportImageConfig.js'
import {
  buildPublicCertUrl as buildPublicCertUrlCore,
  normalizePublicBaseUrl,
  normalizePublicCertParam,
  normalizePublicCertUrlStyle,
  parseCertIdFromPublicLocation,
  buildPublicCertLocationUrl,
} from './publicCertUrl.js'

/** @type {import('./siteConfig.js').SiteConfig | null} */
let cached = null

/** @typedef {{ appName: string, appNameFull: string, entityLabel: string, brandMark: string, publicBaseUrl?: string, publicCertParam?: string, publicCertUrlStyle?: string }} SiteConfig */

export {
  normalizePublicBaseUrl,
  normalizePublicCertParam,
  normalizePublicCertUrlStyle,
  normalizePublicCertSlug,
  parseCertIdFromPublicLocation,
  parsePublicCertSegmentFromLocation,
  splitPublicCertUrlSuffix,
  buildPublicCertLocationUrl,
} from './publicCertUrl.js'

export function defaultSiteConfig() {
  return {
    appName: '猫咪血统证书',
    appNameFull: '猫咪血统证书生成器',
    entityLabel: '证书',
    brandMark: '猫',
    publicBaseUrl: '',
    publicCertParam: 'cert',
    publicCertUrlStyle: 'query',
    excelImportImage: defaultExcelImportImageConfig(),
  }
}

/** 未登录且无访问组：勿用安装默认「猫咪血统证书」等品牌文案 */
export function anonymousPublicSiteConfig() {
  return {
    appName: '',
    appNameFull: '',
    entityLabel: '内容',
    brandMark: '',
    publicBaseUrl: '',
    publicCertParam: 'cert',
    publicCertUrlStyle: 'query',
  }
}

function isAnonymousSiteConfigPayload(data) {
  return !!data?.anonymous
}

export function normalizeSiteConfig(input) {
  const base = defaultSiteConfig()
  return {
    appName: String(input?.appName ?? base.appName).trim() || base.appName,
    appNameFull: String(input?.appNameFull ?? base.appNameFull).trim() || base.appNameFull,
    entityLabel: String(input?.entityLabel ?? base.entityLabel).trim() || base.entityLabel,
    brandMark: String(input?.brandMark ?? base.brandMark).trim() || base.brandMark,
    publicBaseUrl: normalizePublicBaseUrl(input?.publicBaseUrl ?? input?.public_base_url),
    publicCertParam: normalizePublicCertParam(input?.publicCertParam ?? input?.public_cert_param),
    publicCertUrlStyle: normalizePublicCertUrlStyle(input?.publicCertUrlStyle ?? input?.public_cert_url_style),
    excelImportImage: normalizeExcelImportImageConfig(
      input?.excelImportImage ?? input?.excel_import_image ?? base.excelImportImage,
    ),
  }
}

/** @param {Partial<SiteConfig>} [cfg] @param {Parameters<typeof buildPublicCertUrlCore>[0]} certRef */
export function buildPublicCertUrl(certRef, cfg) {
  const c = cfg
    ? normalizeSiteConfig(cfg)
    : normalizeSiteConfig(getSiteConfig())
  return buildPublicCertUrlCore(certRef, c, typeof window !== 'undefined' ? window.location.origin : '')
}

/** @param {Partial<SiteConfig>} [cfg] */
export function resolvePublicPageUrl(cfg) {
  const c = { ...defaultSiteConfig(), ...getSiteConfig(), ...cfg }
  const base = normalizePublicBaseUrl(c.publicBaseUrl)
  if (base) return base.includes('://') ? base : `https://${base}`
  if (typeof window !== 'undefined') return `${window.location.origin}/`
  return '/'
}

/** @returns {SiteConfig} */
export function getSiteConfig() {
  return cached || defaultSiteConfig()
}

/** @param {Partial<SiteConfig>} config */
export function setSiteConfig(config) {
  cached = { ...defaultSiteConfig(), ...cached, ...config }
}

/** @returns {Promise<SiteConfig>} */
export async function loadSiteConfig(groupId) {
  try {
    const data = await api.getPublicSiteConfig(groupId)
    cached = isAnonymousSiteConfigPayload(data)
      ? anonymousPublicSiteConfig()
      : normalizeSiteConfig(data)
  } catch {
    cached = anonymousPublicSiteConfig()
  }
  return getSiteConfig()
}

/** @param {number | null | undefined} groupId @returns {Promise<SiteConfig>} */
export async function loadSiteConfigForGroup(groupId) {
  const gid = groupId != null ? Number(groupId) : null
  if (!gid || !Number.isFinite(gid) || gid <= 0) return getSiteConfig()
  try {
    const data = await api.getPublicSiteConfig(gid)
    if (isAnonymousSiteConfigPayload(data)) return anonymousPublicSiteConfig()
    return normalizeSiteConfig(data)
  } catch {
    return getSiteConfig()
  }
}

/** @param {SiteConfig} [cfg] */
export function entityLabel(cfg) {
  return (cfg || getSiteConfig()).entityLabel
}

/** @param {SiteConfig} [cfg] */
export function untitledName(cfg) {
  return `未命名${entityLabel(cfg)}`
}

/** @param {SiteConfig} [cfg] */
export function newBatchName(cfg) {
  return `新${entityLabel(cfg)}批次`
}

/** @param {string} [suffix] 如「列表」「编辑」 */
export function withEntity(suffix, cfg) {
  return `${entityLabel(cfg)}${suffix}`
}

/** @param {string} [pageSuffix] 如「登录」「已发布证书」 */
export function pageTitle(pageSuffix, cfg) {
  const c = cfg || getSiteConfig()
  const name = String(c.appName || '').trim()
  const full = String(c.appNameFull || '').trim()
  if (pageSuffix) {
    return name ? `${pageSuffix} · ${name}` : String(pageSuffix)
  }
  return full || name || '前端登录'
}

export function applyDocumentTitle(pageSuffix) {
  document.title = pageTitle(pageSuffix)
}

/** 公众浏览页：标题、侧栏与搜索占位等 */
export function applyPublicPageBranding(cfg) {
  const c = cfg || getSiteConfig()
  applyDocumentTitle(siteText('publishedEntity', c))
  const listTitle = document.getElementById('public-list-title')
  if (listTitle) listTitle.textContent = siteText('publishedEntity', c)
  const certSearchInput = document.getElementById('public-cert-search')
  if (certSearchInput) certSearchInput.placeholder = siteText('searchEntityTable', c)
}

/** CMS / 前端文案键 → 文本 */
export function siteText(key, cfg) {
  const c = cfg || getSiteConfig()
  const e = c.entityLabel
  const map = {
    entityList: `${e}列表`,
    entityListDesc: `选择一张${e}进入编辑，或新建${e}批次。`,
    newEntity: `+ 新建${e}`,
    searchEntityTitle: `搜索${e}标题或表格内容…`,
    searchEntityTable: '搜索表格内容…',
    filterEntity: `${e}筛选`,
    emptyList: `暂无${e}，点击右上角新建。`,
    entityEdit: `${e}编辑`,
    entityOps: `${e}操作`,
    entityTitle: `${e}标题`,
    entityContent: `${e}内容编辑区`,
    entityPreview: `${e}预览`,
    publishedEntity: `已发布${e}`,
    selectEntity: `请选择${e}`,
    noPublishedEntity: `暂无已发布${e}`,
    noMatchEntity: `无匹配${e}`,
    matchEntitiesSummary: `个匹配${e}（按表格内容搜索）`,
    noEntityRows: `该${e}没有数据行`,
    selectEntityFirst: `请先选择${e}`,
    saveEntityFirst: `请先保存${e}`,
    newEntityPrompt: `新${e}标题`,
    untitled: untitledName(c),
    newBatch: newBatchName(c),
    loginHint: '',
  }
  return map[key] || key
}

/**
 * 更新带 data-site-text 的元素文本与 data-site-placeholder 的 placeholder
 * @param {ParentNode} root
 * @param {SiteConfig} [cfg]
 */
export function applySiteTextToDom(root, cfg) {
  const c = cfg || getSiteConfig()
  root.querySelectorAll('[data-site-text]').forEach((el) => {
    const key = el.getAttribute('data-site-text')
    if (key) el.textContent = siteText(key, c)
  })
  root.querySelectorAll('[data-site-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-site-placeholder')
    if (key && 'placeholder' in el) el.placeholder = siteText(key, c)
  })
  root.querySelectorAll('[data-site-aria]').forEach((el) => {
    const key = el.getAttribute('data-site-aria')
    if (key) el.setAttribute('aria-label', siteText(key, c))
  })
}
