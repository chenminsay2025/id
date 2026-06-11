import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  buildDbSnapshotForBackupSignature,
  createDatabaseBackup,
  createUploadsBackup,
  getDataPaths,
  maintenanceTimestamp,
  summarizeDirectoryForBackup,
} from './dataMaintenance.js'
import { exportTableTemplates, exportLayoutPresets } from './dataTransfer.js'
import { exportSvgTemplatesZip } from './svgTemplateBackup.js'
import {
  exportFontSettings,
  exportSiteSettings,
  exportAccessPermissions,
} from './settingsBackup.js'
import { getSvgTemplatesDir } from './svgTemplateFiles.js'

export const AUTO_BACKUP_TARGET_KEYS = [
  'database',
  'uploads',
  'svg',
  'table_templates',
  'layout_presets',
  'font_settings',
  'site_settings',
  'access_permissions',
]

/** @type {Record<string, string>} */
export const AUTO_BACKUP_TARGET_LABELS = {
  database: '数据库',
  uploads: 'uploads 图片',
  svg: 'SVG 模板库',
  table_templates: '表格模板库',
  layout_presets: '布局模板库',
  font_settings: '字体源',
  site_settings: '站点设置',
  access_permissions: '权限管理',
}

export const AUTO_BACKUP_FILE_RE = /^backupdata-auto-(db|uploads|svg|table-templates|layout-presets|font-settings|site-settings|access-permissions)-(\d{4}-\d{2}-\d{2}_\d{6})\.(db|zip|json)$/

export function defaultBackupTargets() {
  return {
    database: true,
    uploads: false,
    svg: false,
    table_templates: false,
    layout_presets: false,
    font_settings: false,
    site_settings: false,
    access_permissions: false,
  }
}

/** @param {unknown} raw */
export function normalizeBackupTargets(raw) {
  const base = defaultBackupTargets()
  if (!raw || typeof raw !== 'object') return base
  const out = { ...base }
  for (const key of AUTO_BACKUP_TARGET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = !!raw[key]
    }
  }
  return out
}

/** @param {Record<string, boolean>} targets */
export function hasAnyBackupTarget(targets) {
  return AUTO_BACKUP_TARGET_KEYS.some((key) => targets[key])
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {Record<string, boolean>} targets
 */
export function computeAutoBackupSignature(db, projectRoot, targets) {
  const normalized = normalizeBackupTargets(targets)
  /** @type {Record<string, unknown>} */
  const payload = { v: 4, targets: normalized }
  if (normalized.database) {
    payload.db = buildDbSnapshotForBackupSignature(db)
  }
  if (normalized.uploads) {
    payload.uploads = summarizeDirectoryForBackup(getDataPaths(projectRoot).uploadsDir)
  }
  if (normalized.svg) {
    payload.svg = summarizeDirectoryForBackup(getSvgTemplatesDir(projectRoot))
    try {
      payload.svg_templates_count = db.prepare('SELECT COUNT(*) AS n FROM svg_templates').get().n
    } catch {
      payload.svg_templates_count = 0
    }
  }
  const tableSigKeys = [
    ['table_templates', 'table_templates'],
    ['layout_presets', 'layout_presets'],
    ['font_settings', 'site_settings'],
    ['site_settings', 'site_branding_by_group'],
    ['access_permissions', 'access_groups'],
  ]
  for (const [targetKey, table] of tableSigKeys) {
    if (!normalized[targetKey]) continue
    try {
      payload[`${targetKey}_count`] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
      payload[`${targetKey}_updated`] = db.prepare(`SELECT MAX(updated_at) AS m FROM ${table}`).get()?.m ?? null
    } catch {
      payload[`${targetKey}_count`] = 0
      payload[`${targetKey}_updated`] = null
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/**
 * @param {string} backupDir
 * @param {number} keepCount
 */
export function pruneOldAutoBackupRuns(backupDir, keepCount) {
  if (!keepCount || keepCount <= 0) return 0
  if (!fs.existsSync(backupDir)) return 0
  /** @type {Map<string, string[]>} */
  const groups = new Map()
  for (const name of fs.readdirSync(backupDir)) {
    const m = name.match(AUTO_BACKUP_FILE_RE)
    if (!m) continue
    const ts = m[2]
    if (!groups.has(ts)) groups.set(ts, [])
    groups.get(ts).push(name)
  }
  const sorted = [...groups.keys()].sort((a, b) => b.localeCompare(a))
  let removed = 0
  for (const ts of sorted.slice(keepCount)) {
    for (const name of groups.get(ts) || []) {
      try {
        fs.unlinkSync(path.join(backupDir, name))
        removed += 1
      } catch {
        // ignore
      }
    }
  }
  return removed
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {string} backupDir
 * @param {Record<string, boolean>} targets
 * @param {string} [ts]
 * @param {{ onProgress?: (info: object) => void }} [opts]
 */
export async function runSelectedAutoBackups(db, projectRoot, backupDir, targets, ts = maintenanceTimestamp(), opts = {}) {
  const normalized = normalizeBackupTargets(targets)
  if (!hasAnyBackupTarget(normalized)) {
    throw new Error('请至少勾选一项自动备份内容')
  }

  /** @type {{ mode: string, filename: string, path: string, size_bytes: number }[]} */
  const files = []

  if (normalized.database) {
    const result = await createDatabaseBackup(db, projectRoot, backupDir, {
      filename: `backupdata-auto-db-${ts}.db`,
      onProgress: opts.onProgress,
    })
    files.push({ ...result, path: result.path })
  }

  if (normalized.uploads) {
    const result = await createUploadsBackup(projectRoot, backupDir, {
      filename: `backupdata-auto-uploads-${ts}.zip`,
      onProgress: opts.onProgress,
    })
    files.push({ ...result, path: result.path })
  }

  if (normalized.svg) {
    const { buffer } = await exportSvgTemplatesZip(db, projectRoot)
    const filename = `backupdata-auto-svg-${ts}.zip`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, buffer)
    files.push({
      mode: 'svg',
      filename,
      path: dest,
      size_bytes: buffer.length,
    })
  }

  if (normalized.table_templates) {
    const bundle = exportTableTemplates(db)
    const filename = `backupdata-auto-table-templates-${ts}.json`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, JSON.stringify(bundle, null, 2), 'utf8')
    files.push({
      mode: 'table_templates',
      filename,
      path: dest,
      size_bytes: fs.statSync(dest).size,
    })
  }

  if (normalized.layout_presets) {
    const bundle = exportLayoutPresets(db)
    const filename = `backupdata-auto-layout-presets-${ts}.json`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, JSON.stringify(bundle, null, 2), 'utf8')
    files.push({
      mode: 'layout_presets',
      filename,
      path: dest,
      size_bytes: fs.statSync(dest).size,
    })
  }

  if (normalized.font_settings) {
    const bundle = exportFontSettings(db)
    const filename = `backupdata-auto-font-settings-${ts}.json`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, JSON.stringify(bundle, null, 2), 'utf8')
    files.push({
      mode: 'font_settings',
      filename,
      path: dest,
      size_bytes: fs.statSync(dest).size,
    })
  }

  if (normalized.site_settings) {
    const bundle = exportSiteSettings(db)
    const filename = `backupdata-auto-site-settings-${ts}.json`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, JSON.stringify(bundle, null, 2), 'utf8')
    files.push({
      mode: 'site_settings',
      filename,
      path: dest,
      size_bytes: fs.statSync(dest).size,
    })
  }

  if (normalized.access_permissions) {
    const bundle = exportAccessPermissions(db)
    const filename = `backupdata-auto-access-permissions-${ts}.json`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, JSON.stringify(bundle, null, 2), 'utf8')
    files.push({
      mode: 'access_permissions',
      filename,
      path: dest,
      size_bytes: fs.statSync(dest).size,
    })
  }

  return { ts, files }
}
