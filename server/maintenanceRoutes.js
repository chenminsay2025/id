import fs from 'node:fs'
import path from 'node:path'
import {
  cleanupUnusedUploads,
  createDatabaseBackup,
  formatBytes,
  getDataPaths,
  getStorageStats,
  getBackupProgressState,
  getRestoreProgressState,
  restoreDatabaseFromFile,
} from './dataMaintenance.js'
import {
  formatAutoBackupConfigForClient,
  loadAutoBackupConfig,
  restartAutoBackupScheduler,
  resolveBackupDirectory,
  runAutoBackup,
  saveAutoBackupConfig,
} from './autoBackup.js'

const BACKUP_NAME_RE = /^cat-backup(-full)?-\d{4}-\d{2}-\d{2}_\d{6}\.(db|zip)$/

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
      const body = await c.req.json().catch(() => ({}))
      const mode = body.mode === 'full' ? 'full' : 'data'
      const result = await createDatabaseBackup(db, projectRoot, undefined, { mode })
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

  app.get('/api/maintenance/backup-database/:filename', requireAuth, requireMaintenance, (c) => {
    const filename = path.basename(c.req.param('filename') || '')
    if (!BACKUP_NAME_RE.test(filename)) {
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
        backup_mode: body.backup_mode,
        backup_dir: body.backup_dir,
        keep_count: body.keep_count,
      })
      restartAutoBackupScheduler(db, projectRoot)
      return c.json({ ok: true, config: formatAutoBackupConfigForClient(db, projectRoot) })
    } catch (err) {
      return c.json({ error: err.message || '保存失败' }, 400)
    }
  })

  app.post('/api/maintenance/auto-backup/run-now', requireAuth, requireMaintenance, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const base = loadAutoBackupConfig(db)
      const cfg = {
        ...base,
        backup_mode: body.backup_mode === 'full' || body.backup_mode === 'data'
          ? body.backup_mode
          : base.backup_mode,
        backup_dir: body.backup_dir != null && String(body.backup_dir).trim()
          ? String(body.backup_dir).trim()
          : base.backup_dir,
      }
      const result = await runAutoBackup(db, projectRoot, cfg)
      restartAutoBackupScheduler(db, projectRoot)
      return c.json({
        ok: true,
        skipped: !!result.skipped,
        reason: result.reason,
        mode: result.mode,
        filename: result.filename,
        size_bytes: result.size_bytes,
        size_label: formatBytes(result.size_bytes),
        counts: result.counts,
        includes: result.includes,
        removed_old: result.removed_old,
        config: formatAutoBackupConfigForClient(db, projectRoot),
      })
    } catch (err) {
      return c.json({ error: err.message || '备份失败' }, 500)
    }
  })
}
