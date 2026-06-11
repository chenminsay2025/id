import { getDefaultGroupId } from './accessControl.js'
import {
  defaultExcelImportImageConfig,
  normalizeExcelImportImageConfig,
} from '../src/excelImportImageConfig.js'
import {
  buildPublicCertUrl,
  normalizePublicBaseUrl,
  normalizePublicCertParam,
  normalizePublicCertUrlStyle,
} from '../src/publicCertUrl.js'

export {
  buildPublicCertUrl,
  normalizePublicBaseUrl,
  normalizePublicCertParam,
  normalizePublicCertUrlStyle,
} from '../src/publicCertUrl.js'

export const SITE_SETTINGS_KEY = 'site_branding_config'

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

/** 未登录且无访问组时的公开页品牌（勿展示安装默认「猫咪血统证书」） */
export function anonymousPublicSiteConfig() {
  return {
    anonymous: true,
    appName: '',
    appNameFull: '',
    entityLabel: '内容',
    brandMark: '',
    publicBaseUrl: '',
    publicCertParam: 'cert',
    publicCertUrlStyle: 'query',
  }
}

function parseLegacyConfig(raw) {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    return normalizeSiteConfig(data)
  } catch {
    return null
  }
}

export function normalizeSiteConfig(input) {
  const base = defaultSiteConfig()
  const appName = String(input?.appName ?? base.appName).trim() || base.appName
  const entityLabel = String(input?.entityLabel ?? base.entityLabel).trim() || base.entityLabel
  const appNameFull = String(input?.appNameFull ?? base.appNameFull).trim() || base.appNameFull
  const brandMark = String(input?.brandMark ?? base.brandMark).trim() || base.brandMark
  const publicBaseUrl = normalizePublicBaseUrl(input?.publicBaseUrl ?? input?.public_base_url)
  const publicCertParam = normalizePublicCertParam(input?.publicCertParam ?? input?.public_cert_param)
  const publicCertUrlStyle = normalizePublicCertUrlStyle(input?.publicCertUrlStyle ?? input?.public_cert_url_style)
  const excelImportImage = normalizeExcelImportImageConfig(
    input?.excelImportImage ?? input?.excel_import_image,
  )
  return {
    appName,
    appNameFull,
    entityLabel,
    brandMark,
    publicBaseUrl,
    publicCertParam,
    publicCertUrlStyle,
    excelImportImage,
  }
}

function parseExcelImportImageConfigColumn(raw) {
  if (!raw) return defaultExcelImportImageConfig()
  try {
    return normalizeExcelImportImageConfig(JSON.parse(raw))
  } catch {
    return defaultExcelImportImageConfig()
  }
}

// buildPublicCertUrl imported from ../src/publicCertUrl.js

function readLegacySiteConfig(db) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(SITE_SETTINGS_KEY)
  return parseLegacyConfig(row?.value)
}

function readGroupSiteConfigRow(db, groupId) {
  if (groupId == null) return null
  const row = db.prepare(`
    SELECT app_name, app_name_full, entity_label, brand_mark, public_base_url, public_cert_param, public_cert_url_style, excel_import_image_config
    FROM site_branding_by_group WHERE group_id = ?
  `).get(Number(groupId))
  if (!row) return null
  return normalizeSiteConfig({
    appName: row.app_name,
    appNameFull: row.app_name_full,
    entityLabel: row.entity_label,
    brandMark: row.brand_mark,
    publicBaseUrl: row.public_base_url,
    publicCertParam: row.public_cert_param,
    publicCertUrlStyle: row.public_cert_url_style,
    excelImportImage: parseExcelImportImageConfigColumn(row.excel_import_image_config),
  })
}

/** @deprecated 兼容旧调用；优先读默认组配置 */
export function getSiteConfig(db) {
  const defaultGroupId = getDefaultGroupId(db)
  return getSiteConfigForGroup(db, defaultGroupId)
}

export function getSiteConfigForGroup(db, groupId) {
  const fromGroup = readGroupSiteConfigRow(db, groupId)
  if (fromGroup) return fromGroup
  const legacy = readLegacySiteConfig(db)
  if (legacy) return legacy
  return defaultSiteConfig()
}

/**
 * 按访问组顺序解析站点名称（公众页 / 管理员首组）
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} groupIds
 */
export function getSiteConfigForGroups(db, groupIds = []) {
  if (!groupIds.length) return anonymousPublicSiteConfig()
  for (const gid of groupIds) {
    const cfg = readGroupSiteConfigRow(db, gid)
    if (cfg) return cfg
  }
  return getSiteConfigForGroup(db, getDefaultGroupId(db))
}

export function saveSiteConfigForGroup(db, groupId, config) {
  const gid = Number(groupId)
  if (!Number.isFinite(gid) || gid <= 0) {
    throw new Error('无效的访问组')
  }
  const exists = db.prepare('SELECT id FROM access_groups WHERE id = ?').get(gid)
  if (!exists) throw new Error('访问组不存在')

  const normalized = normalizeSiteConfig(config)
  const excelImportImageJson = JSON.stringify(normalized.excelImportImage)
  const ts = new Date().toISOString()
  db.prepare(`
    INSERT INTO site_branding_by_group (
      group_id, app_name, app_name_full, entity_label, brand_mark,
      public_base_url, public_cert_param, public_cert_url_style, excel_import_image_config, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      app_name = excluded.app_name,
      app_name_full = excluded.app_name_full,
      entity_label = excluded.entity_label,
      brand_mark = excluded.brand_mark,
      public_base_url = excluded.public_base_url,
      public_cert_param = excluded.public_cert_param,
      public_cert_url_style = excluded.public_cert_url_style,
      excel_import_image_config = excluded.excel_import_image_config,
      updated_at = excluded.updated_at
  `).run(
    gid,
    normalized.appName,
    normalized.appNameFull,
    normalized.entityLabel,
    normalized.brandMark,
    normalized.publicBaseUrl || null,
    normalized.publicCertParam,
    normalized.publicCertUrlStyle,
    excelImportImageJson,
    ts,
  )
  return { ...normalized, group_id: gid }
}

/** @deprecated 兼容旧调用，写入默认组 */
export function saveSiteConfig(db, config) {
  return saveSiteConfigForGroup(db, getDefaultGroupId(db), config)
}

/** 未命名文档默认标题，如「未命名证书」「未命名奖状」 */
export function defaultUntitledTitle(config) {
  const label = config?.entityLabel || defaultSiteConfig().entityLabel
  return `未命名${label}`
}

/** 新建批次默认标题 */
export function defaultNewBatchTitle(config) {
  const label = config?.entityLabel || defaultSiteConfig().entityLabel
  return `新${label}批次`
}

/** 复制文档默认标题后缀 */
export function defaultCopyTitle(config, baseTitle) {
  const untitled = defaultUntitledTitle(config)
  const title = String(baseTitle || untitled).trim() || untitled
  return `${title} (副本)`
}
