import fs from 'node:fs'
import path from 'node:path'
import {
  countDbRecords,
  formatBytes,
  maintenanceTimestamp,
} from './dataMaintenance.js'
import {
  AUTO_BACKUP_TARGET_KEYS,
  AUTO_BACKUP_TARGET_LABELS,
  computeAutoBackupSignature,
  defaultBackupTargets,
  hasAnyBackupTarget,
  normalizeBackupTargets,
  pruneOldAutoBackupRuns,
  runSelectedAutoBackups,
} from './autoBackupTargets.js'

export const AUTO_BACKUP_SETTINGS_KEY = 'auto_backup_config'

export const AUTO_BACKUP_INTERVAL_OPTIONS = [
  { hours: 1, label: '每 1 小时' },
  { hours: 6, label: '每 6 小时' },
  { hours: 12, label: '每 12 小时' },
  { hours: 24, label: '每 24 小时（每天）' },
  { hours: 168, label: '每 7 天' },
  { hours: 336, label: '每 14 天' },
  { hours: 720, label: '每 30 天' },
  { hours: 1440, label: '每 60 天' },
  { hours: 2160, label: '每 90 天' },
]

/** @type {ReturnType<typeof setInterval> | null} */
let schedulerTimer = null

export function defaultAutoBackupConfig() {
  return {
    enabled: false,
    interval_hours: 24,
    backup_dir: 'data/backups',
    keep_count: 30,
    backup_targets: defaultBackupTargets(),
    last_backup_at: null,
    last_backup_file: null,
    last_backup_files: null,
    last_backup_signature: null,
    last_backup_check_at: null,
    last_backup_error: null,
  }
}

function parseConfigJson(text) {
  if (!text) return defaultAutoBackupConfig()
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') return defaultAutoBackupConfig()
    const base = defaultAutoBackupConfig()
    const hours = Number(raw.interval_hours)
    return {
      enabled: !!raw.enabled,
      interval_hours: Number.isFinite(hours) && hours > 0 ? hours : base.interval_hours,
      backup_dir: String(raw.backup_dir || base.backup_dir).trim() || base.backup_dir,
      keep_count: Math.max(0, Math.min(500, Number(raw.keep_count) || 0)),
      backup_targets: normalizeBackupTargets(raw.backup_targets),
      last_backup_at: raw.last_backup_at || null,
      last_backup_file: raw.last_backup_file || null,
      last_backup_files: Array.isArray(raw.last_backup_files) ? raw.last_backup_files : null,
      last_backup_signature: raw.last_backup_signature || null,
      last_backup_check_at: raw.last_backup_check_at || null,
      last_backup_error: raw.last_backup_error || null,
    }
  } catch {
    return defaultAutoBackupConfig()
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function loadAutoBackupConfig(db) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(AUTO_BACKUP_SETTINGS_KEY)
  return parseConfigJson(row?.value)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} patch
 */
export function saveAutoBackupConfig(db, patch) {
  const prev = loadAutoBackupConfig(db)
  const hours = Number(patch.interval_hours ?? prev.interval_hours)
  const next = {
    enabled: patch.enabled != null ? !!patch.enabled : prev.enabled,
    interval_hours: Number.isFinite(hours) && hours > 0 ? hours : prev.interval_hours,
    backup_dir: String(patch.backup_dir ?? prev.backup_dir).trim() || prev.backup_dir,
    keep_count: patch.keep_count != null
      ? Math.max(0, Math.min(500, Number(patch.keep_count) || 0))
      : prev.keep_count,
    backup_targets: patch.backup_targets != null
      ? normalizeBackupTargets(patch.backup_targets)
      : prev.backup_targets,
    last_backup_at: patch.last_backup_at !== undefined ? patch.last_backup_at : prev.last_backup_at,
    last_backup_file: patch.last_backup_file !== undefined ? patch.last_backup_file : prev.last_backup_file,
    last_backup_files: patch.last_backup_files !== undefined ? patch.last_backup_files : prev.last_backup_files,
    last_backup_signature: patch.last_backup_signature !== undefined ? patch.last_backup_signature : prev.last_backup_signature,
    last_backup_check_at: patch.last_backup_check_at !== undefined ? patch.last_backup_check_at : prev.last_backup_check_at,
    last_backup_error: patch.last_backup_error !== undefined ? patch.last_backup_error : prev.last_backup_error,
  }
  if (!AUTO_BACKUP_INTERVAL_OPTIONS.some((o) => o.hours === next.interval_hours)) {
    throw new Error('不支持的备份间隔')
  }
  if (!hasAnyBackupTarget(next.backup_targets)) {
    throw new Error('请至少勾选一项自动备份内容')
  }
  const ts = new Date().toISOString()
  db.prepare(`
    INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(AUTO_BACKUP_SETTINGS_KEY, JSON.stringify(next), ts)
  return next
}

/**
 * @param {string} projectRoot
 * @param {string} userPath
 */
export function resolveBackupDirectory(projectRoot, userPath) {
  const raw = String(userPath || 'data/backups').trim()
  if (!raw) throw new Error('请填写备份目录')
  if (raw.includes('\0')) throw new Error('非法目录路径')

  let resolved
  if (path.isAbsolute(raw)) {
    resolved = path.resolve(raw)
  } else {
    const rel = raw.replace(/^[/\\]+/, '')
    if (rel.includes('..')) throw new Error('备份目录不能包含 ..')
    resolved = path.resolve(projectRoot, rel)
    const root = path.resolve(projectRoot)
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      throw new Error('相对路径必须在项目目录内')
    }
  }

  const blocked = ['node_modules', '.git', 'dist'].some((seg) => {
    const relToRoot = path.relative(path.resolve(projectRoot), resolved)
    return relToRoot.split(path.sep).includes(seg)
  })
  if (blocked) throw new Error('不能备份到 node_modules、.git 或 dist 目录')

  fs.mkdirSync(resolved, { recursive: true })
  return resolved
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {object} cfg
 * @param {string} backupDir
 */
function shouldSkipUnchangedAutoBackup(db, projectRoot, cfg, backupDir) {
  if (!cfg.last_backup_signature) return false
  const targets = normalizeBackupTargets(cfg.backup_targets)
  const files = Array.isArray(cfg.last_backup_files) && cfg.last_backup_files.length
    ? cfg.last_backup_files
    : (cfg.last_backup_file ? [cfg.last_backup_file] : [])
  if (!files.some((name) => fs.existsSync(path.join(backupDir, path.basename(String(name)))))) {
    return false
  }
  const currentSig = computeAutoBackupSignature(db, projectRoot, targets)
  return currentSig === cfg.last_backup_signature
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {object} [cfg]
 * @param {{ force?: boolean, onProgress?: (info: object) => void }} [opts]
 */
export async function runAutoBackup(db, projectRoot, cfg = loadAutoBackupConfig(db), opts = {}) {
  const backupDir = resolveBackupDirectory(projectRoot, cfg.backup_dir)
  const targets = normalizeBackupTargets(cfg.backup_targets)
  if (!hasAnyBackupTarget(targets)) {
    throw new Error('请至少勾选一项自动备份内容')
  }

  if (!opts.force && shouldSkipUnchangedAutoBackup(db, projectRoot, cfg, backupDir)) {
    const files = Array.isArray(cfg.last_backup_files) && cfg.last_backup_files.length
      ? cfg.last_backup_files
      : [cfg.last_backup_file].filter(Boolean)
    const existing = files
      .map((name) => path.join(backupDir, path.basename(String(name))))
      .filter((disk) => fs.existsSync(disk))
    const totalSize = existing.reduce((sum, disk) => sum + fs.statSync(disk).size, 0)
    const checkedAt = new Date().toISOString()
    saveAutoBackupConfig(db, {
      ...cfg,
      last_backup_check_at: checkedAt,
      last_backup_error: null,
    })
    console.log(`[auto-backup] 数据无变化，跳过（沿用 ${files.join('、')}）`)
    return {
      skipped: true,
      reason: '数据无变化',
      filename: cfg.last_backup_file,
      files: files.map((name) => ({ filename: path.basename(String(name)) })),
      path: existing[0],
      size_bytes: totalSize,
      removed_old: 0,
      counts: countDbRecords(db),
      targets,
    }
  }

  const ts = maintenanceTimestamp()
  const { files } = await runSelectedAutoBackups(db, projectRoot, backupDir, targets, ts, {
    onProgress: opts.onProgress,
  })
  const removed = pruneOldAutoBackupRuns(backupDir, cfg.keep_count)
  const filenames = files.map((f) => f.filename)
  const totalSize = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0)
  const savedAt = new Date().toISOString()
  const signature = computeAutoBackupSignature(db, projectRoot, targets)
  saveAutoBackupConfig(db, {
    ...cfg,
    last_backup_at: savedAt,
    last_backup_check_at: savedAt,
    last_backup_file: filenames.join(' · '),
    last_backup_files: filenames,
    last_backup_signature: signature,
    last_backup_error: null,
  })
  console.log(
    `[auto-backup] 已备份 ${filenames.length} 个文件 → ${backupDir}（${formatBytes(totalSize)}）${removed ? `，清理旧批次 ${removed} 个文件` : ''}`,
  )
  return {
    skipped: false,
    filename: filenames[0],
    files,
    path: files[0]?.path,
    size_bytes: totalSize,
    removed_old: removed,
    counts: countDbRecords(db),
    targets,
  }
}

function msUntilNextRun(cfg) {
  const ms = cfg.interval_hours * 3600 * 1000
  const anchor = cfg.last_backup_check_at || cfg.last_backup_at
  const last = anchor ? new Date(anchor).getTime() : 0
  if (!last) return 0
  const elapsed = Date.now() - last
  return Math.max(0, ms - elapsed)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 */
export function startAutoBackupScheduler(db, projectRoot) {
  stopAutoBackupScheduler()

  const scheduleNext = () => {
    const cfg = loadAutoBackupConfig(db)
    if (!cfg.enabled) return

    const delay = msUntilNextRun(cfg)
    schedulerTimer = setTimeout(async () => {
      try {
        await runAutoBackup(db, projectRoot)
      } catch (err) {
        console.error('[auto-backup] 失败:', err.message)
        saveAutoBackupConfig(db, {
          ...loadAutoBackupConfig(db),
          last_backup_error: err.message || String(err),
        })
      }
      scheduleNext()
    }, delay || 1000)
  }

  const cfg = loadAutoBackupConfig(db)
  if (!cfg.enabled) return

  const delay = msUntilNextRun(cfg)
  if (delay === 0) {
    runAutoBackup(db, projectRoot).catch((err) => {
      console.error('[auto-backup] 启动时备份失败:', err.message)
      saveAutoBackupConfig(db, {
        ...loadAutoBackupConfig(db),
        last_backup_error: err.message || String(err),
      })
    }).finally(() => scheduleNext())
  } else {
    console.log(`[auto-backup] 已启用，间隔 ${cfg.interval_hours} 小时，下次约 ${Math.ceil(delay / 60000)} 分钟后`)
    scheduleNext()
  }
}

export function stopAutoBackupScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
}

export function restartAutoBackupScheduler(db, projectRoot) {
  stopAutoBackupScheduler()
  startAutoBackupScheduler(db, projectRoot)
}

export function formatAutoBackupConfigForClient(db, projectRoot) {
  const cfg = loadAutoBackupConfig(db)
  let resolved_dir = ''
  try {
    resolved_dir = resolveBackupDirectory(projectRoot, cfg.backup_dir)
  } catch {
    resolved_dir = ''
  }
  return {
    ...cfg,
    interval_options: AUTO_BACKUP_INTERVAL_OPTIONS,
    target_options: AUTO_BACKUP_TARGET_KEYS.map((key) => ({
      key,
      label: AUTO_BACKUP_TARGET_LABELS[key],
      checked: !!normalizeBackupTargets(cfg.backup_targets)[key],
    })),
    resolved_dir,
  }
}
