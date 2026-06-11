import fs from 'node:fs'
import path from 'node:path'
import {
  cleanupUnusedUploads,
  createDatabaseBackup,
  createUploadsBackup,
  formatBytes,
  getDataPaths,
  getStorageStats,
  getBackupProgressState,
  getRestoreProgressState,
  restoreDatabaseFromFile,
  restoreUploadsFromZip,
} from './dataMaintenance.js'
import {
  formatAutoBackupConfigForClient,
  loadAutoBackupConfig,
  restartAutoBackupScheduler,
  resolveBackupDirectory,
  runAutoBackup,
  saveAutoBackupConfig,
} from './autoBackup.js'
import {
  exportFontSettings,
  importFontSettings,
  exportSiteSettings,
  importSiteSettings,
  exportAccessPermissions,
  importAccessPermissions,
} from './settingsBackup.js'
import {
  BUNDLE_BACKUP_NAME_RE,
  createBundleBackup,
  inspectBundleZip,
  restoreBundleFromZip,
} from './bundleBackup.js'

const BACKUP_NAME_RE = /^cat-backup(-uploads|-full)?-\d{4}-\d{2}-\d{2}_\d{6}\.(db|zip)$/

function isAllowedBackupDownload(filename) {
  return BACKUP_NAME_RE.test(filename) || BUNDLE_BACKUP_NAME_RE.test(filename)
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, projectRoot: string, requireAuth: Function, requireMaintenance: Function, reconnectDatabase?: () => import('better-sqlite3').Database }} opts
 */
export function registerMaintenanceRoutes(app, { db, projectRoot, requireAuth, requireMaintenance, reconnectDatabase }) {
  app.get('/api/maintenance/storage', requireAuth, requireMaintenance, (c) => {
    return c.json({ ok: true, ...getStorageStats(db, projectRoot) })
  })

  app.post('/api/maintenance/cleanup-uploads', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const execute = body.confirm === true
    const result = cleanupUnusedUploads(db, projectRoot, { dryRun: !execute })
    return c.json({
      ok: true,
      ...result,
      stats: execute ? getStorageStats(db, projectRoot).uploads : undefined,
    })
  })

  app.get('/api/maintenance/backup-progress', requireAuth, requireMaintenance, (c) => {
    return c.json({ ok: true, progress: getBackupProgressState() })
  })

  app.get('/api/maintenance/restore-progress', requireAuth, requireMaintenance, (c) => {
    return c.json({ ok: true, progress: getRestoreProgressState() })
  })

  app.post('/api/maintenance/backup-database', requireAuth, requireMaintenance, async (c) => {
    try {
      const result = await createDatabaseBackup(db, projectRoot)
      return c.json({
        ok: true,
        mode: result.mode,
        filename: result.filename,
        size_bytes: result.size_bytes,
        size_label: formatBytes(result.size_bytes),
        counts: result.counts,
        includes: result.includes,
        download_url: `/api/maintenance/backup-database/${encodeURIComponent(result.filename)}`,
      })
    } catch (err) {
      return c.json({ error: err.message || '备份失败' }, 500)
    }
  })

  app.post('/api/maintenance/backup-uploads', requireAuth, requireMaintenance, async (c) => {
    try {
      const result = await createUploadsBackup(projectRoot)
      return c.json({
        ok: true,
        mode: result.mode,
        filename: result.filename,
        size_bytes: result.size_bytes,
        size_label: formatBytes(result.size_bytes),
        includes: result.includes,
        download_url: `/api/maintenance/backup-database/${encodeURIComponent(result.filename)}`,
      })
    } catch (err) {
      return c.json({ error: err.message || 'uploads 备份失败' }, 500)
    }
  })

  app.get('/api/maintenance/backup-database/:filename', requireAuth, requireMaintenance, (c) => {
    const filename = path.basename(c.req.param('filename') || '')
    if (!isAllowedBackupDownload(filename)) {
      return c.json({ error: '无效的文件名' }, 400)
    }
    const { backupDir } = getDataPaths(projectRoot)
    const disk = path.join(backupDir, filename)
    if (!fs.existsSync(disk)) {
      return c.json({ error: '备份文件不存在' }, 404)
    }
    const buf = fs.readFileSync(disk)
    const contentType = filename.endsWith('.zip') ? 'application/zip' : 'application/octet-stream'
    return new Response(buf, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buf.length),
      },
    })
  })

  app.post('/api/maintenance/restore-uploads', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.parseBody()
    const file = body.file ?? body.uploads
    if (!file || typeof file === 'string') {
      return c.json({ error: '请使用 multipart 字段 file 上传 uploads ZIP 备份' }, 400)
    }

    const name = file.name || 'uploads.zip'
    if (!/\.zip$/i.test(name)) {
      return c.json({ error: '仅支持 .zip 文件' }, 400)
    }

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length < 32) {
      return c.json({ error: 'ZIP 文件过小' }, 400)
    }

    const { backupDir } = getDataPaths(projectRoot)
    fs.mkdirSync(backupDir, { recursive: true })
    const tempPath = path.join(backupDir, `_restore-uploads-${Date.now()}.zip`)

    try {
      fs.writeFileSync(tempPath, buf)
      const result = await restoreUploadsFromZip(projectRoot, tempPath)
      return c.json({
        ok: true,
        message: 'uploads 已恢复。若界面图片未更新，请刷新页面。',
        safety_backup: result.safety_backup,
        restored_count: result.restored_count,
      })
    } catch (err) {
      return c.json({ error: err.message || 'uploads 恢复失败' }, 500)
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
      } catch {
        // ignore
      }
    }
  })

  app.post('/api/maintenance/backup-bundle', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const { backupDir } = getDataPaths(projectRoot)
      fs.mkdirSync(backupDir, { recursive: true })
      const result = await createBundleBackup(db, projectRoot, backupDir, body.backup_targets ?? body.targets, {})
      return c.json({
        ok: true,
        filename: result.filename,
        size_bytes: result.size_bytes,
        size_label: result.size_label,
        items: result.items,
        targets: result.targets,
        download_url: result.download_url,
      })
    } catch (err) {
      return c.json({ error: err.message || '一键备份失败' }, 500)
    }
  })

  app.post('/api/maintenance/inspect-bundle', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.parseBody()
    const file = body.file ?? body.bundle
    if (!file || typeof file === 'string') {
      return c.json({ error: '请使用 multipart 字段 file 上传备份 ZIP' }, 400)
    }
    const name = file.name || 'backup.zip'
    if (!/\.zip$/i.test(name)) {
      return c.json({ error: '仅支持 .zip 文件' }, 400)
    }
    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length < 32) {
      return c.json({ error: 'ZIP 文件过小' }, 400)
    }
    try {
      const info = await inspectBundleZip(buf)
      return c.json(info)
    } catch (err) {
      return c.json({ error: err.message || '无法解析备份包' }, 400)
    }
  })

  app.post('/api/maintenance/restore-bundle', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.parseBody()
    const file = body.file ?? body.bundle
    if (!file || typeof file === 'string') {
      return c.json({ error: '请使用 multipart 字段 file 上传备份 ZIP' }, 400)
    }
    const name = file.name || 'backup.zip'
    if (!/\.zip$/i.test(name)) {
      return c.json({ error: '仅支持 .zip 文件' }, 400)
    }

    let restoreTargets = body.restore_targets ?? body.targets
    if (typeof restoreTargets === 'string') {
      try {
        restoreTargets = JSON.parse(restoreTargets)
      } catch {
        return c.json({ error: 'restore_targets 不是有效 JSON' }, 400)
      }
    }

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length < 32) {
      return c.json({ error: 'ZIP 文件过小' }, 400)
    }

    try {
      const principal = c.get('principal')
      const result = await restoreBundleFromZip(db, projectRoot, buf, restoreTargets, {
        onConflict: body.on_conflict ?? body.onConflict ?? 'update',
        reopenDatabase: typeof reconnectDatabase === 'function' ? reconnectDatabase : undefined,
        principal,
      })
      return c.json({
        ok: true,
        message: '一键恢复完成。若含数据库项，建议刷新页面；仍异常时请重启后端服务。',
        restored: result.restored,
        missing: result.missing,
        warnings: result.warnings,
        results: result.results,
        reloaded: result.reloaded,
      })
    } catch (err) {
      return c.json({ error: err.message || '一键恢复失败' }, 500)
    }
  })

  app.post('/api/maintenance/restore-database', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.parseBody()
    const file = body.file ?? body.database
    if (!file || typeof file === 'string') {
      return c.json({ error: '请使用 multipart 字段 file 上传 .db 备份文件' }, 400)
    }

    const name = file.name || 'backup.db'
    if (!/\.db$/i.test(name)) {
      return c.json({ error: '仅支持 .db 文件' }, 400)
    }

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length < 64 * 1024) {
      return c.json({ error: '文件过小，可能不是有效的数据库备份' }, 400)
    }

    const { backupDir } = getDataPaths(projectRoot)
    fs.mkdirSync(backupDir, { recursive: true })
    const tempPath = path.join(backupDir, `_restore-upload-${Date.now()}.db`)

    try {
      fs.writeFileSync(tempPath, buf)
      const result = await restoreDatabaseFromFile(db, projectRoot, tempPath, {
        reopenDatabase: typeof reconnectDatabase === 'function' ? reconnectDatabase : undefined,
      })
      return c.json({
        ok: true,
        message: '数据库已恢复。若界面数据未更新，请刷新页面；仍异常时请重启后端服务。',
        safety_backup: result.safety_backup,
        counts: result.counts,
        source_counts: result.source_counts,
      })
    } catch (err) {
      return c.json({ error: err.message || '恢复失败' }, 500)
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
      } catch {
        // ignore
      }
    }
  })

  app.get('/api/maintenance/auto-backup', requireAuth, requireMaintenance, (c) => {
    return c.json({ ok: true, config: formatAutoBackupConfigForClient(db, projectRoot) })
  })

  app.post('/api/maintenance/auto-backup', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      resolveBackupDirectory(projectRoot, body.backup_dir ?? loadAutoBackupConfig(db).backup_dir)
      const config = saveAutoBackupConfig(db, {
        enabled: body.enabled,
        interval_hours: body.interval_hours,
        backup_dir: body.backup_dir,
        keep_count: body.keep_count,
        backup_targets: body.backup_targets,
      })
      restartAutoBackupScheduler(db, projectRoot)
      return c.json({ ok: true, config: formatAutoBackupConfigForClient(db, projectRoot) })
    } catch (err) {
      return c.json({ error: err.message || '保存失败' }, 400)
    }
  })

  app.get('/api/maintenance/export/font-settings', requireAuth, requireMaintenance, (c) => {
    return c.json(exportFontSettings(db))
  })

  app.post('/api/maintenance/import/font-settings', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const bundle = body.bundle ?? body
      const result = importFontSettings(db, bundle, { onConflict: body.on_conflict })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })

  app.get('/api/maintenance/export/site-settings', requireAuth, requireMaintenance, (c) => {
    return c.json(exportSiteSettings(db))
  })

  app.post('/api/maintenance/import/site-settings', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const bundle = body.bundle ?? body
      const result = importSiteSettings(db, bundle, { onConflict: body.on_conflict })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })

  app.get('/api/maintenance/export/access-permissions', requireAuth, requireMaintenance, (c) => {
    return c.json(exportAccessPermissions(db))
  })

  app.post('/api/maintenance/import/access-permissions', requireAuth, requireMaintenance, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const bundle = body.bundle ?? body
      const result = importAccessPermissions(db, bundle, { onConflict: body.on_conflict })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })

  app.post('/api/maintenance/auto-backup/run-now', requireAuth, requireMaintenance, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const base = loadAutoBackupConfig(db)
      const cfg = {
        ...base,
        backup_dir: body.backup_dir != null && String(body.backup_dir).trim()
          ? String(body.backup_dir).trim()
          : base.backup_dir,
        backup_targets: body.backup_targets != null ? body.backup_targets : base.backup_targets,
      }
      const result = await runAutoBackup(db, projectRoot, cfg, { force: !!body.force })
      restartAutoBackupScheduler(db, projectRoot)
      const fileList = (result.files || []).map((f) => ({
        filename: f.filename,
        size_bytes: f.size_bytes,
        size_label: formatBytes(f.size_bytes || 0),
        mode: f.mode,
      }))
      return c.json({
        ok: true,
        skipped: !!result.skipped,
        reason: result.reason,
        filename: result.filename,
        files: fileList,
        size_bytes: result.size_bytes,
        size_label: formatBytes(result.size_bytes || 0),
        counts: result.counts,
        removed_old: result.removed_old,
        targets: result.targets,
        config: formatAutoBackupConfigForClient(db, projectRoot),
      })
    } catch (err) {
      return c.json({ error: err.message || '备份失败' }, 500)
    }
  })
}
