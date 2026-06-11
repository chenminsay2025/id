import { DATA_TRANSFER_VERSION } from './dataTransfer.js'
import { uniqueSlug } from './db.js'
import { getFontConfig, saveFontConfig, FONT_SETTINGS_KEY } from './fontSettings.js'
import { saveSiteConfigForGroup, normalizeSiteConfig } from './siteSettings.js'
import { getAdminLoginSlug, saveAdminLoginSlug } from './adminLoginPath.js'
import { getPublicLoginSlug, savePublicLoginSlug } from './publicLoginPath.js'
import {
  slugByGroupId,
  idByGroupSlug,
  listGroups,
  createAccessGroup,
  setUserGroups,
  setVisitorGroups,
  getUserGroupIds,
  getVisitorGroupIds,
  isProtectedGroupSlug,
  isSuperAdmin,
} from './accessControl.js'
import { getUserModuleKeys, setUserModuleKeys } from './adminModules.js'

function nowIso() {
  return new Date().toISOString()
}

function normalizeOnConflict(value) {
  const mode = String(value || 'update').trim().toLowerCase()
  if (mode === 'skip' || mode === 'update' || mode === 'rename') return mode
  return 'update'
}

/**
 * @param {unknown} bundle
 * @param {string} expectedKind
 */
function validateBundleKind(bundle, expectedKind) {
  if (!bundle || typeof bundle !== 'object') throw new Error('无效的导入文件')
  if (Number(bundle.version) !== DATA_TRANSFER_VERSION) {
    throw new Error(`不支持的导出版本 v${bundle.version ?? '?'}，当前为 v${DATA_TRANSFER_VERSION}`)
  }
  if (bundle.kind !== expectedKind) {
    throw new Error(`文件类型不匹配：期望 ${expectedKind}，实际为 ${bundle.kind ?? '未知'}`)
  }
  return bundle
}

/** @param {import('better-sqlite3').Database} db */
export function exportFontSettings(db) {
  return {
    version: DATA_TRANSFER_VERSION,
    kind: 'font_settings',
    exported_at: nowIso(),
    config: getFontConfig(db),
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} bundle
 * @param {{ onConflict?: string }} [opts]
 */
export function importFontSettings(db, bundle, opts = {}) {
  const data = validateBundleKind(bundle, 'font_settings')
  const mode = normalizeOnConflict(opts.onConflict)
  if (!data.config || typeof data.config !== 'object') {
    throw new Error('导入文件缺少 config')
  }
  const hasSaved = !!db.prepare('SELECT 1 FROM site_settings WHERE key = ?').get(FONT_SETTINGS_KEY)
  if (mode === 'skip' && hasSaved) {
    return { created: 0, updated: 0, skipped: 1, warnings: ['已有字体配置，已跳过'] }
  }
  saveFontConfig(db, data.config)
  return { created: 0, updated: 1, skipped: 0 }
}

/** @param {import('better-sqlite3').Database} db */
export function exportSiteSettings(db) {
  const brandingRows = db.prepare(`
    SELECT group_id, app_name, app_name_full, entity_label, brand_mark,
           public_base_url, public_cert_param, public_cert_url_style, excel_import_image_config
    FROM site_branding_by_group
    ORDER BY group_id
  `).all()
  const branding = brandingRows.map((row) => {
    let excelImportImage
    if (row.excel_import_image_config) {
      try {
        excelImportImage = JSON.parse(row.excel_import_image_config)
      } catch {
        excelImportImage = undefined
      }
    }
    return {
      group_slug: slugByGroupId(db, row.group_id),
      ...normalizeSiteConfig({
        appName: row.app_name,
        appNameFull: row.app_name_full,
        entityLabel: row.entity_label,
        brandMark: row.brand_mark,
        publicBaseUrl: row.public_base_url,
        publicCertParam: row.public_cert_param,
        publicCertUrlStyle: row.public_cert_url_style,
        excelImportImage,
      }),
    }
  }).filter((item) => item.group_slug)

  return {
    version: DATA_TRANSFER_VERSION,
    kind: 'site_settings',
    exported_at: nowIso(),
    branding,
    paths: {
      admin_login_path: getAdminLoginSlug(db),
      public_login_path: getPublicLoginSlug(db),
    },
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} bundle
 * @param {{ onConflict?: string }} [opts]
 */
export function importSiteSettings(db, bundle, opts = {}) {
  const data = validateBundleKind(bundle, 'site_settings')
  const mode = normalizeOnConflict(opts.onConflict)
  const result = { created: 0, updated: 0, skipped: 0, warnings: [], errors: [] }
  const branding = Array.isArray(data.branding) ? data.branding : []

  for (const item of branding) {
    try {
      const groupSlug = String(item.group_slug || '').trim()
      if (!groupSlug) {
        result.warnings.push('缺少 group_slug 的站点配置项已跳过')
        result.skipped += 1
        continue
      }
      const groupId = idByGroupSlug(db, groupSlug)
      if (!groupId) {
        result.warnings.push(`未找到访问组 slug「${groupSlug}」，已跳过该组站点配置`)
        result.skipped += 1
        continue
      }
      const exists = db.prepare('SELECT 1 FROM site_branding_by_group WHERE group_id = ?').get(groupId)
      if (exists && mode === 'skip') {
        result.skipped += 1
        continue
      }
      saveSiteConfigForGroup(db, groupId, item)
      if (exists) result.updated += 1
      else result.created += 1
    } catch (err) {
      result.errors.push(err.message || String(err))
    }
  }

  if (data.paths && typeof data.paths === 'object' && mode !== 'skip') {
    try {
      if (data.paths.admin_login_path != null) {
        saveAdminLoginSlug(db, data.paths.admin_login_path)
      }
      if (data.paths.public_login_path != null) {
        savePublicLoginSlug(db, data.paths.public_login_path)
      }
    } catch (err) {
      result.errors.push(err.message || String(err))
    }
  }

  return result
}

/** @param {import('better-sqlite3').Database} db */
export function exportAccessPermissions(db) {
  const groups = listGroups(db).map((g) => ({ name: g.name, slug: g.slug }))
  const adminRows = db.prepare('SELECT id, username, role FROM admin_user ORDER BY id').all()
  const admin_users = adminRows.map((u) => ({
    username: u.username,
    role: u.role,
    group_slugs: getUserGroupIds(db, u.id)
      .map((id) => slugByGroupId(db, id))
      .filter(Boolean),
    module_keys: getUserModuleKeys(db, u.id),
  }))
  const visitorRows = db.prepare('SELECT id, username FROM visitor_users ORDER BY id').all()
  const visitors = visitorRows.map((v) => ({
    username: v.username,
    group_slugs: getVisitorGroupIds(db, v.id)
      .map((id) => slugByGroupId(db, id))
      .filter(Boolean),
  }))

  return {
    version: DATA_TRANSFER_VERSION,
    kind: 'access_permissions',
    exported_at: nowIso(),
    item_count: groups.length,
    groups,
    admin_users,
    visitors,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} bundle
 * @param {{ onConflict?: string }} [opts]
 */
export function importAccessPermissions(db, bundle, opts = {}) {
  const data = validateBundleKind(bundle, 'access_permissions')
  const mode = normalizeOnConflict(opts.onConflict)
  const result = { created: 0, updated: 0, skipped: 0, warnings: [], errors: [] }
  const groups = Array.isArray(data.groups) ? data.groups : []
  const adminUsers = Array.isArray(data.admin_users) ? data.admin_users : []
  const visitors = Array.isArray(data.visitors) ? data.visitors : []

  for (const g of groups) {
    try {
      const slug = String(g.slug || '').trim()
      const name = String(g.name || slug || '新组').trim() || '新组'
      if (!slug) {
        result.warnings.push('缺少 slug 的访问组已跳过')
        result.skipped += 1
        continue
      }
      const existing = db.prepare('SELECT id, slug, name FROM access_groups WHERE slug = ?').get(slug)
      if (existing) {
        if (mode === 'skip') {
          result.skipped += 1
          continue
        }
        if (mode === 'update' && !isProtectedGroupSlug(existing.slug)) {
          db.prepare('UPDATE access_groups SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), existing.id)
          result.updated += 1
        } else if (mode === 'rename') {
          createAccessGroup(db, { name, slug: uniqueSlug(db, 'access_groups', `${slug}-import`) })
          result.created += 1
        } else {
          result.skipped += 1
        }
        continue
      }
      createAccessGroup(db, { name, slug })
      result.created += 1
    } catch (err) {
      result.errors.push(err.message || String(err))
    }
  }

  for (const u of adminUsers) {
    try {
      const username = String(u.username || '').trim()
      if (!username) continue
      const row = db.prepare('SELECT id, role FROM admin_user WHERE username = ?').get(username)
      if (!row) {
        result.warnings.push(`管理员「${username}」不存在，已跳过（备份不含密码，无法新建账号）`)
        result.skipped += 1
        continue
      }
      if (mode === 'skip') {
        result.skipped += 1
        continue
      }
      const groupIds = (u.group_slugs || [])
        .map((slug) => idByGroupSlug(db, slug))
        .filter((id) => id > 0)
      setUserGroups(db, row.id, groupIds)
      if (u.role && u.role !== row.role && !(isSuperAdmin(row.role) && u.role !== 'super_admin')) {
        db.prepare('UPDATE admin_user SET role = ? WHERE id = ?').run(u.role, row.id)
      }
      if (Array.isArray(u.module_keys)) {
        setUserModuleKeys(db, row.id, u.module_keys)
      }
      result.updated += 1
    } catch (err) {
      result.errors.push(err.message || String(err))
    }
  }

  for (const v of visitors) {
    try {
      const username = String(v.username || '').trim()
      if (!username) continue
      const row = db.prepare('SELECT id FROM visitor_users WHERE username = ?').get(username)
      if (!row) {
        result.warnings.push(`访客「${username}」不存在，已跳过（备份不含密码，无法新建账号）`)
        result.skipped += 1
        continue
      }
      if (mode === 'skip') {
        result.skipped += 1
        continue
      }
      const groupIds = (v.group_slugs || [])
        .map((slug) => idByGroupSlug(db, slug))
        .filter((id) => id > 0)
      setVisitorGroups(db, row.id, groupIds)
      result.updated += 1
    } catch (err) {
      result.errors.push(err.message || String(err))
    }
  }

  return result
}
