import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import JSZip from 'jszip'
import {
  AUTO_BACKUP_TARGET_KEYS,
  AUTO_BACKUP_TARGET_LABELS,
  hasAnyBackupTarget,
  normalizeBackupTargets,
  runSelectedAutoBackups,
} from './autoBackupTargets.js'
import {
  formatBytes,
  maintenanceTimestamp,
  publishBackupProgress,
  publishRestoreProgress,
  restoreDatabaseFromFile,
  restoreUploadsFromZip,
} from './dataMaintenance.js'
import { importTableTemplates, importLayoutPresets } from './dataTransfer.js'
import { importSvgTemplatesZip } from './svgTemplateBackup.js'
import {
  importFontSettings,
  importSiteSettings,
  importAccessPermissions,
} from './settingsBackup.js'

export const BUNDLE_KIND = 'cat_backup_bundle'
export const BUNDLE_VERSION = 1

export const BUNDLE_BACKUP_NAME_RE = /^backupdata-bundle-\d{4}-\d{2}-\d{2}_\d{6}\.zip$/

/** @type {Record<string, RegExp[]>} */
const FALLBACK_FILE_PATTERNS = {
  database: [/^backupdata-auto-db-.*\.db$/i, /^cat-backup.*\.db$/i, /^database\.db$/i],
  uploads: [/^backupdata-auto-uploads-.*\.zip$/i, /^cat-backup-uploads.*\.zip$/i, /^uploads\.zip$/i],
  svg: [/^backupdata-auto-svg-.*\.zip$/i, /^svg-templates.*\.zip$/i],
  table_templates: [/^backupdata-auto-table-templates-.*\.json$/i, /^table-templates.*\.json$/i],
  layout_presets: [/^backupdata-auto-layout-presets-.*\.json$/i, /^layout-presets.*\.json$/i],
  font_settings: [/^backupdata-auto-font-settings-.*\.json$/i, /^font-settings.*\.json$/i],
  site_settings: [/^backupdata-auto-site-settings-.*\.json$/i, /^site-settings.*\.json$/i],
  access_permissions: [/^backupdata-auto-access-permissions-.*\.json$/i, /^access-permissions.*\.json$/i],
}

const RESTORE_ORDER = [
  'font_settings',
  'site_settings',
  'access_permissions',
  'table_templates',
  'layout_presets',
  'svg',
  'uploads',
  'database',
]

function nowIso() {
  return new Date().toISOString()
}

/** @param {(info: object) => void} [onProgress] @param {object} info */
function reportBackup(onProgress, info) {
  publishBackupProgress({ mode: 'bundle', ...info }, onProgress)
}

/** @param {(info: object) => void} [onProgress] @param {object} info */
function reportRestore(onProgress, info) {
  publishRestoreProgress(info, onProgress)
}

function rmDirSafe(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

/**
 * @param {JSZip} zip
 * @returns {Promise<{ manifest: object | null, entries: { path: string, name: string }[] }>}
 */
async function loadBundleZipEntries(zip) {
  const entries = []
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) {
      entries.push({
        path: relativePath.replace(/^\//, ''),
        name: path.basename(relativePath),
      })
    }
  })
  let manifest = null
  const manifestEntry = zip.file('manifest.json') || zip.file('/manifest.json')
  if (manifestEntry) {
    try {
      manifest = JSON.parse(await manifestEntry.async('string'))
    } catch {
      manifest = null
    }
  }
  return { manifest, entries }
}

/**
 * @param {object | null} manifest
 * @param {{ path: string, name: string }[]} entries
 */
function resolveBundleFileMap(manifest, entries) {
  /** @type {Record<string, string>} */
  const files = {}
  if (manifest?.files && typeof manifest.files === 'object') {
    for (const [key, relPath] of Object.entries(manifest.files)) {
      const normalized = String(relPath || '').replace(/^\//, '')
      if (normalized && entries.some((e) => e.path === normalized)) {
        files[key] = normalized
      }
    }
  }
  for (const key of AUTO_BACKUP_TARGET_KEYS) {
    if (files[key]) continue
    const patterns = FALLBACK_FILE_PATTERNS[key] || []
    const hit = entries.find((e) => patterns.some((re) => re.test(e.name) || re.test(e.path)))
    if (hit) files[key] = hit.path
  }
  return files
}

/**
 * @param {Buffer} zipBuffer
 */
export async function inspectBundleZip(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer)
  const { manifest, entries } = await loadBundleZipEntries(zip)
  const fileMap = resolveBundleFileMap(manifest, entries)
  const targets = {}
  for (const key of AUTO_BACKUP_TARGET_KEYS) {
    const rel = fileMap[key]
    if (!rel) {
      targets[key] = { present: false, label: AUTO_BACKUP_TARGET_LABELS[key] || key }
      continue
    }
    const entry = zip.file(rel) || zip.file(`/${rel}`)
    let size_bytes = 0
    if (entry) {
      const buf = await entry.async('nodebuffer')
      size_bytes = buf.length
    }
    targets[key] = {
      present: true,
      label: AUTO_BACKUP_TARGET_LABELS[key] || key,
      path: rel,
      size_bytes,
      size_label: formatBytes(size_bytes),
    }
  }
  return {
    ok: true,
    kind: manifest?.kind || null,
    version: manifest?.version ?? null,
    exported_at: manifest?.exported_at || null,
    targets,
    item_count: Object.values(targets).filter((t) => t.present).length,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {string} backupDir
 * @param {Record<string, boolean>} targets
 * @param {{ onProgress?: (info: object) => void }} [opts]
 */
export async function createBundleBackup(db, projectRoot, backupDir, targets, opts = {}) {
  const normalized = normalizeBackupTargets(targets)
  if (!hasAnyBackupTarget(normalized)) {
    throw new Error('请至少勾选一项备份内容')
  }

  const ts = maintenanceTimestamp()
  const tempDir = path.join(backupDir, `_bundle-build-${ts}`)
  fs.mkdirSync(tempDir, { recursive: true })

  const onProgress = opts.onProgress
  reportBackup(onProgress, { stage: 'prepare', pct: 0, detail: '正在准备一键备份…' })

  try {
    const selectedKeys = AUTO_BACKUP_TARGET_KEYS.filter((k) => normalized[k])
    const { files } = await runSelectedAutoBackups(db, projectRoot, tempDir, normalized, ts, {
      onProgress: (info) => {
        const idx = selectedKeys.indexOf(info?.mode || info?.target)
        const base = 8
        const span = 72
        const pct = idx >= 0
          ? base + Math.round(((idx + 0.5) / selectedKeys.length) * span)
          : base
        reportBackup(onProgress, {
          stage: 'items',
          pct,
          detail: info?.message || info?.detail || '正在导出备份项…',
          file: info?.file,
        })
      },
    })

    reportBackup(onProgress, { stage: 'compress', pct: 82, detail: '正在打包 ZIP…' })

    const zip = new JSZip()
    /** @type {Record<string, string>} */
    const manifestFiles = {}
    for (const item of files) {
      const innerName = path.basename(item.path)
      const zipPath = `items/${innerName}`
      zip.file(zipPath, fs.readFileSync(item.path))
      manifestFiles[item.mode] = zipPath
    }

    const manifest = {
      version: BUNDLE_VERSION,
      kind: BUNDLE_KIND,
      exported_at: nowIso(),
      targets: normalized,
      files: manifestFiles,
      labels: AUTO_BACKUP_TARGET_LABELS,
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const filename = `backupdata-bundle-${ts}.zip`
    const dest = path.join(backupDir, filename)
    fs.writeFileSync(dest, buffer)

    reportBackup(onProgress, {
      stage: 'done',
      pct: 100,
      detail: '一键备份完成',
      file: filename,
    })

    return {
      ok: true,
      filename,
      path: dest,
      size_bytes: buffer.length,
      size_label: formatBytes(buffer.length),
      items: files.map((f) => f.mode),
      targets: normalized,
      download_url: `/api/maintenance/backup-database/${encodeURIComponent(filename)}`,
    }
  } finally {
    rmDirSafe(tempDir)
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {Buffer} zipBuffer
 * @param {Record<string, boolean>} restoreTargets
 * @param {{ onProgress?: (info: object) => void, onConflict?: string, reopenDatabase?: () => import('better-sqlite3').Database, principal?: object }} [opts]
 */
export async function restoreBundleFromZip(db, projectRoot, zipBuffer, restoreTargets, opts = {}) {
  const normalized = normalizeBackupTargets(restoreTargets)
  if (!hasAnyBackupTarget(normalized)) {
    throw new Error('请至少勾选一项恢复内容')
  }

  const onProgress = opts.onProgress
  const onConflict = opts.onConflict || 'update'
  reportRestore(onProgress, { stage: 'validate', pct: 2, detail: '正在解析备份包…' })

  const zip = await JSZip.loadAsync(zipBuffer)
  const { manifest, entries } = await loadBundleZipEntries(zip)
  const fileMap = resolveBundleFileMap(manifest, entries)

  const selected = RESTORE_ORDER.filter((key) => normalized[key] && fileMap[key])
  const missing = AUTO_BACKUP_TARGET_KEYS.filter((key) => normalized[key] && !fileMap[key])
  if (!selected.length) {
    throw new Error(missing.length
      ? `备份包中未找到已勾选项：${missing.map((k) => AUTO_BACKUP_TARGET_LABELS[k]).join('、')}`
      : '备份包中无可恢复内容')
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-bundle-restore-'))
  /** @type {Record<string, object>} */
  const results = {}
  const warnings = [...missing.map((k) => `未找到：${AUTO_BACKUP_TARGET_LABELS[k]}`)]

  try {
    let step = 0
    const total = selected.length

    for (const key of selected) {
      step += 1
      const rel = fileMap[key]
      const entry = zip.file(rel) || zip.file(`/${rel}`)
      if (!entry) continue

      const pctBase = 10 + Math.round(((step - 1) / total) * 80)
      reportRestore(onProgress, {
        stage: 'restore',
        pct: pctBase,
        detail: `正在恢复：${AUTO_BACKUP_TARGET_LABELS[key] || key}`,
        current: step,
        total,
      })

      const buf = await entry.async('nodebuffer')
      const diskPath = path.join(tempRoot, path.basename(rel))
      fs.writeFileSync(diskPath, buf)

      if (key === 'database') {
        const result = await restoreDatabaseFromFile(db, projectRoot, diskPath, {
          reopenDatabase: opts.reopenDatabase,
          onProgress,
        })
        results.database = result
        if (typeof opts.reopenDatabase === 'function') {
          db = opts.reopenDatabase()
        }
        continue
      }

      if (key === 'uploads') {
        const result = await restoreUploadsFromZip(projectRoot, diskPath, { onProgress })
        results.uploads = result
        continue
      }

      if (key === 'svg') {
        const result = await importSvgTemplatesZip(db, projectRoot, buf, {
          onConflict: onConflict === 'update' ? 'rename' : onConflict,
          principal: opts.principal,
        })
        results.svg = result
        continue
      }

      if (key === 'table_templates') {
        const bundle = JSON.parse(buf.toString('utf8'))
        results.table_templates = importTableTemplates(db, bundle, {
          onConflict,
          principal: opts.principal,
        })
        continue
      }

      if (key === 'layout_presets') {
        const bundle = JSON.parse(buf.toString('utf8'))
        results.layout_presets = importLayoutPresets(db, bundle, {
          onConflict,
          principal: opts.principal,
        })
        continue
      }

      if (key === 'font_settings') {
        const bundle = JSON.parse(buf.toString('utf8'))
        results.font_settings = importFontSettings(db, bundle, { onConflict })
        continue
      }

      if (key === 'site_settings') {
        const bundle = JSON.parse(buf.toString('utf8'))
        results.site_settings = importSiteSettings(db, bundle, { onConflict })
        continue
      }

      if (key === 'access_permissions') {
        const bundle = JSON.parse(buf.toString('utf8'))
        results.access_permissions = importAccessPermissions(db, bundle, { onConflict })
      }
    }

    reportRestore(onProgress, { stage: 'done', pct: 100, detail: '一键恢复完成' })

    return {
      ok: true,
      restored: selected,
      missing,
      warnings: warnings.filter(Boolean),
      results,
      reloaded: !!results.database,
    }
  } finally {
    rmDirSafe(tempRoot)
  }
}
