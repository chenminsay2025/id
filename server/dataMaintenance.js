import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import JSZip from 'jszip'
import { readSvgTemplateFile } from './svgTemplateFiles.js'

const UPLOAD_REF_RE = /\/uploads\/([a-zA-Z0-9._-]+)/gi
const CAT_IMG_RE = /cat-img:([^\s"'<>]+)/gi

/** @type {{ active: boolean, mode?: string, stage?: string, pct?: number, detail?: string, file?: string, current?: number, total?: number, updated_at?: string }} */
let backupProgressState = { active: false }

/** @type {{ active: boolean, stage?: string, pct?: number, detail?: string, current?: number, total?: number, updated_at?: string }} */
let restoreProgressState = { active: false }

export function getBackupProgressState() {
  return { ...backupProgressState }
}

export function getRestoreProgressState() {
  return { ...restoreProgressState }
}

/** @param {object} info @param {(info: object) => void} [userOnProgress] */
function publishBackupProgress(info, userOnProgress) {
  backupProgressState = {
    active: info.stage !== 'done' && info.stage !== 'error',
    updated_at: new Date().toISOString(),
    ...info,
  }
  userOnProgress?.(info)
}

/** @param {object} info @param {(info: object) => void} [userOnProgress] */
function publishRestoreProgress(info, userOnProgress) {
  restoreProgressState = {
    active: info.stage !== 'done' && info.stage !== 'error',
    updated_at: new Date().toISOString(),
    ...info,
  }
  userOnProgress?.(info)
}

/** @param {{ totalPages?: number, remainingPages?: number }} progress @param {number} pctBase @param {number} pctSpan */
function pctFromBackupPages(progress, pctBase, pctSpan) {
  const total = Number(progress.totalPages) || 0
  const remaining = Number(progress.remainingPages) || 0
  if (total <= 0) return pctBase + Math.round(pctSpan * 0.5)
  const done = Math.max(0, total - remaining)
  return pctBase + Math.round((done / total) * pctSpan)
}

/** @param {string} dbPath */
function removeLiveDatabaseSidecars(dbPath) {
  for (const name of ['cat.db-wal', 'cat.db-shm']) {
    const p = path.join(path.dirname(dbPath), name)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}

/** @param {Set<string>} refs @param {unknown} text */
function addUploadRefsFromText(refs, text) {
  if (text == null || text === '') return
  const s = String(text)
  for (const m of s.matchAll(UPLOAD_REF_RE)) {
    if (m[1]) refs.add(m[1])
  }
  for (const m of s.matchAll(CAT_IMG_RE)) {
    addUploadRefsFromText(refs, m[1])
  }
}

/** @param {Set<string>} refs @param {import('better-sqlite3').Database} db @param {string} sql */
function scanTextColumn(refs, db, sql) {
  try {
    for (const row of db.prepare(sql).all()) {
      addUploadRefsFromText(refs, row.t)
    }
  } catch {
    // table/column may not exist on very old dumps
  }
}

export function maintenanceTimestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function getDataPaths(projectRoot) {
  const dataDir = path.join(projectRoot, 'data')
  return {
    dataDir,
    dbPath: path.join(dataDir, 'cat.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    backupDir: path.join(dataDir, 'backups'),
  }
}

export function countDbRecords(db) {
  const tables = ['certificates', 'svg_templates', 'table_templates', 'layout_presets', 'admin_user']
  const counts = {}
  for (const t of tables) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
    } catch {
      counts[t] = 0
    }
  }
  return counts
}

const AUTO_BACKUP_SETTINGS_KEY = 'auto_backup_config'

const BACKUP_SIGNATURE_DB_TABLES = [
  'certificates',
  'certificate_rows',
  'certificate_revisions',
  'svg_templates',
  'table_templates',
  'layout_presets',
  'layout_preset_revisions',
  'admin_user',
  'visitor_users',
  'access_groups',
]

const BACKUP_SIGNATURE_UPDATED_TABLES = [
  'certificates',
  'svg_templates',
  'table_templates',
  'layout_presets',
  'admin_user',
  'visitor_users',
  'access_groups',
]

/** @param {import('better-sqlite3').Database} db */
function buildSiteSettingsSnapshotForSignature(db) {
  try {
    return db.prepare(`
      SELECT key, value, updated_at FROM site_settings
      WHERE key != ?
      ORDER BY key ASC
    `).all(AUTO_BACKUP_SETTINGS_KEY).map((row) => [row.key, row.value, row.updated_at])
  } catch {
    return []
  }
}

/** @param {import('better-sqlite3').Database} db */
export function buildDbSnapshotForBackupSignature(db) {
  const counts = {}
  for (const table of BACKUP_SIGNATURE_DB_TABLES) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
    } catch {
      counts[table] = 0
    }
  }
  try {
    counts.site_settings = db.prepare(`
      SELECT COUNT(*) AS n FROM site_settings WHERE key != ?
    `).get(AUTO_BACKUP_SETTINGS_KEY).n
  } catch {
    counts.site_settings = 0
  }
  const updated = {}
  for (const table of BACKUP_SIGNATURE_UPDATED_TABLES) {
    try {
      updated[table] = db.prepare(`SELECT MAX(updated_at) AS m FROM ${table}`).get()?.m ?? null
    } catch {
      updated[table] = null
    }
  }
  try {
    updated.certificate_rows_max_id = db.prepare('SELECT MAX(id) AS m FROM certificate_rows').get()?.m ?? null
  } catch {
    updated.certificate_rows_max_id = null
  }
  return {
    counts,
    updated,
    site_settings: buildSiteSettingsSnapshotForSignature(db),
  }
}

/** @param {string} diskDir */
export function summarizeDirectoryForBackup(diskDir) {
  const files = listDirectoryFiles(diskDir)
  const entries = files.map(({ rel, abs }) => {
    const st = fs.statSync(abs)
    return [rel.replace(/\\/g, '/'), st.size, Math.floor(st.mtimeMs)]
  }).sort((a, b) => a[0].localeCompare(b[0]))
  return {
    file_count: entries.length,
    total_bytes: entries.reduce((sum, entry) => sum + entry[1], 0),
    entries,
  }
}

/**
 * 计算自动备份数据指纹，用于判断自上次备份以来是否有变化（仅数据库）。
 * @param {import('better-sqlite3').Database} db
 */
export function computeAutoBackupSignature(db) {
  const payload = {
    v: 3,
    mode: 'data',
    db: buildDbSnapshotForBackupSignature(db),
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/** @param {Set<string>} refs @param {import('better-sqlite3').Database} db */
function addUserAvatarUploadRefs(refs, db) {
  for (const table of ['admin_user', 'visitor_users']) {
    try {
      for (const row of db.prepare(
        `SELECT avatar_path FROM ${table} WHERE avatar_path IS NOT NULL AND TRIM(avatar_path) != ''`,
      ).all()) {
        const raw = String(row.avatar_path || '').trim()
        if (!raw) continue
        addUploadRefsFromText(refs, raw)
        const base = path.basename(raw.replace(/^\/uploads\//, ''))
        if (base && base !== '.gitkeep') refs.add(base)
      }
    } catch {
      // avatar_path 列可能尚未迁移
    }
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 */
export function collectReferencedUploadNames(db, projectRoot) {
  const refs = new Set()

  const textQueries = [
    // 证书与修订
    'SELECT row_data AS t FROM certificate_rows',
    'SELECT layout_overrides AS t FROM certificates WHERE layout_overrides IS NOT NULL',
    'SELECT preview_ui AS t FROM certificates',
    'SELECT column_order AS t FROM certificates WHERE column_order IS NOT NULL',
    'SELECT snapshot AS t FROM certificate_revisions',
    // 布局模板
    'SELECT layout_overrides AS t FROM layout_presets',
    'SELECT preview_sample_row AS t FROM layout_presets',
    'SELECT snapshot AS t FROM layout_preset_revisions',
    // 表格模板（示例行与列定义 JSON 中均可能有图片 URL）
    'SELECT sample_rows AS t FROM table_templates',
    'SELECT columns AS t FROM table_templates',
    // SVG 模板（库内联内容与站点设置）
    'SELECT svg_content AS t FROM svg_templates WHERE svg_content IS NOT NULL AND svg_content != \'\'',
    'SELECT value AS t FROM site_settings',
  ]

  for (const sql of textQueries) {
    scanTextColumn(refs, db, sql)
  }

  addUserAvatarUploadRefs(refs, db)

  try {
    for (const row of db.prepare('SELECT file_path FROM svg_templates WHERE file_path IS NOT NULL').all()) {
      const content = readSvgTemplateFile(projectRoot, row.file_path)
      addUploadRefsFromText(refs, content)
    }
  } catch {
    // ignore
  }

  return refs
}

function listUploadFiles(uploadsDir) {
  if (!fs.existsSync(uploadsDir)) return []
  return fs.readdirSync(uploadsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== '.gitkeep')
    .map((e) => {
      const disk = path.join(uploadsDir, e.name)
      const stat = fs.statSync(disk)
      return { name: e.name, size: stat.size, mtime: stat.mtime.toISOString() }
    })
}

/** @param {string} dir */
function getDirectorySizeSync(dir) {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name)
      if (ent.isDirectory()) stack.push(full)
      else if (ent.isFile()) {
        try {
          total += fs.statSync(full).size
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  return total
}

/**
 * 读取目标路径所在磁盘/卷的空间信息（Node fs.statfsSync）
 * @param {string} targetPath
 */
export function getDiskSpaceForPath(targetPath) {
  try {
    const resolved = fs.realpathSync(targetPath)
    const stats = fs.statfsSync(resolved)
    const total = Number(stats.bsize) * Number(stats.blocks)
    const free = Number(stats.bsize) * Number(stats.bavail)
    const used = Math.max(0, total - free)
    const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
    const volume = path.parse(resolved).root || resolved
    return {
      available: true,
      volume,
      resolved_path: resolved,
      total_bytes: total,
      used_bytes: used,
      free_bytes: free,
      used_pct: usedPct,
    }
  } catch {
    return { available: false }
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 */
export function getStorageStats(db, projectRoot) {
  const { dataDir, dbPath, uploadsDir, backupDir } = getDataPaths(projectRoot)
  const referenced = collectReferencedUploadNames(db, projectRoot)
  const files = listUploadFiles(uploadsDir)

  let uploadsTotalBytes = 0
  let uploadsUsedBytes = 0
  let uploadsUnusedBytes = 0
  const unusedFiles = []
  const usedFiles = []

  for (const f of files) {
    uploadsTotalBytes += f.size
    if (referenced.has(f.name)) {
      uploadsUsedBytes += f.size
      usedFiles.push(f)
    } else {
      uploadsUnusedBytes += f.size
      unusedFiles.push(f)
    }
  }

  unusedFiles.sort((a, b) => b.size - a.size)
  usedFiles.sort((a, b) => b.size - a.size)

  let dbSize = 0
  try {
    dbSize = fs.statSync(dbPath).size
  } catch {
    // ignore
  }

  const uploadsDirSize = getDirectorySizeSync(uploadsDir)
  const backupsDirSize = getDirectorySizeSync(backupDir)
  const dataDirSize = getDirectorySizeSync(dataDir)
  const disk = getDiskSpaceForPath(dataDir)

  return {
    db_size_bytes: dbSize,
    db_counts: countDbRecords(db),
    data_dir: {
      relative_path: 'data',
      total_bytes: dataDirSize,
      db_bytes: dbSize,
      uploads_bytes: uploadsDirSize,
      backups_bytes: backupsDirSize,
      other_bytes: Math.max(0, dataDirSize - dbSize - uploadsDirSize - backupsDirSize),
    },
    disk,
    uploads: {
      total_files: files.length,
      used_files: usedFiles.length,
      unused_files: unusedFiles.length,
      total_bytes: uploadsTotalBytes,
      used_bytes: uploadsUsedBytes,
      unused_bytes: uploadsUnusedBytes,
      unused_list: unusedFiles.slice(0, 50),
    },
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {string} [destDir] absolute or relative backup directory
 * @param {{ filename?: string, onProgress?: (info: object) => void }} [opts]
 */
export async function createDatabaseBackup(db, projectRoot, destDir, opts = {}) {
  const report = (info) => publishBackupProgress({ mode: 'data', ...info }, opts.onProgress)
  try {
    const dir = destDir
      ? (path.isAbsolute(destDir) ? destDir : path.join(projectRoot, destDir))
      : getDataPaths(projectRoot).backupDir
    fs.mkdirSync(dir, { recursive: true })
    const filename = opts.filename || `cat-backup-${maintenanceTimestamp()}.db`
    const dest = path.join(dir, filename)
    report({ stage: 'prepare', pct: 2, detail: '准备数据备份…' })
    report({ stage: 'db', pct: 8, detail: '正在导出 SQLite 数据库（合并 WAL）…' })
    await db.backup(dest)
    report({ stage: 'db', pct: 88, detail: '数据库导出完成' })
    report({ stage: 'write', pct: 92, detail: '正在校验备份文件…' })
    const stat = fs.statSync(dest)
    report({ stage: 'done', pct: 100, detail: `已生成 ${filename}（${formatBytes(stat.size)}）` })
    return {
      mode: 'data',
      filename,
      path: dest,
      size_bytes: stat.size,
      counts: countDbRecords(db),
    }
  } catch (err) {
    report({ stage: 'error', pct: 0, detail: err.message || '备份失败' })
    throw err
  }
}

/** @param {string} diskDir */
function listDirectoryFiles(diskDir) {
  if (!fs.existsSync(diskDir)) return []
  /** @type {{ rel: string, abs: string }[]} */
  const files = []
  const stack = [{ rel: '', abs: diskDir }]
  while (stack.length) {
    const { rel, abs } = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (ent.name === '.gitkeep') continue
      const entryRel = rel ? `${rel}/${ent.name}` : ent.name
      const entryAbs = path.join(abs, ent.name)
      if (ent.isDirectory()) {
        stack.push({ rel: entryRel, abs: entryAbs })
      } else if (ent.isFile()) {
        files.push({ rel: entryRel, abs: entryAbs })
      }
    }
  }
  return files
}

/**
 * @param {*} zip
 * @param {string} folderName
 * @param {string} diskDir
 * @param {(info: { current: number, total: number, file: string }) => void} [onFile]
 */
function addDirectoryToZip(zip, folderName, diskDir, onFile) {
  if (!fs.existsSync(diskDir)) return 0
  const folder = zip.folder(folderName)
  if (!folder) return 0
  const files = listDirectoryFiles(diskDir)
  let count = 0
  for (let i = 0; i < files.length; i += 1) {
    const { rel, abs } = files[i]
    try {
      folder.file(rel, fs.readFileSync(abs))
      count += 1
      onFile?.({ current: i + 1, total: files.length, file: rel })
    } catch {
      // ignore unreadable files
    }
  }
  return count
}

/**
 * @param {string} projectRoot
 * @param {string} [destDir]
 * @param {{ filename?: string, onProgress?: (info: object) => void }} [opts]
 */
export async function createUploadsBackup(projectRoot, destDir, opts = {}) {
  const report = (info) => publishBackupProgress({ mode: 'uploads', ...info }, opts.onProgress)
  const dir = destDir
    ? (path.isAbsolute(destDir) ? destDir : path.join(projectRoot, destDir))
    : getDataPaths(projectRoot).backupDir
  fs.mkdirSync(dir, { recursive: true })
  const filename = opts.filename || `cat-backup-uploads-${maintenanceTimestamp()}.zip`
  const dest = path.join(dir, filename)
  const { uploadsDir } = getDataPaths(projectRoot)
  const uploadFileTotal = listDirectoryFiles(uploadsDir).length

  report({
    stage: 'prepare',
    pct: 0,
    detail: '准备 uploads 备份…',
    upload_total: uploadFileTotal,
  })

  const zip = new JSZip()
  if (uploadFileTotal > 0) {
    report({ stage: 'uploads', pct: 8, detail: `正在打包 uploads/（共 ${uploadFileTotal} 个文件）…` })
  } else {
    report({ stage: 'uploads', pct: 50, detail: 'uploads/ 为空' })
  }
  const uploadCount = addDirectoryToZip(zip, 'uploads', uploadsDir, (p) => {
    if (uploadFileTotal <= 0) return
    if (p.current !== p.total && p.current % 4 !== 0) return
    const pct = 8 + Math.round((p.current / p.total) * 52)
    report({
      stage: 'uploads',
      pct,
      detail: `打包 uploads/（${p.current}/${p.total}）`,
      file: p.file,
      current: p.current,
      total: p.total,
    })
  })

  report({ stage: 'manifest', pct: 64, detail: '写入 manifest.json…' })
  zip.file('manifest.json', JSON.stringify({
    v: 1,
    mode: 'uploads',
    created_at: new Date().toISOString(),
    includes: {
      uploads: uploadCount,
    },
    restore_hint: '解压后将 uploads/ 目录合并到 data/uploads/',
  }, null, 2))

  report({ stage: 'compress', pct: 68, detail: '正在压缩 ZIP（DEFLATE）…' })
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }, (metadata) => {
    const pct = 68 + Math.round((metadata.percent || 0) * 0.26)
    const rounded = Math.round(metadata.percent || 0)
    if (rounded > 0 && rounded < 100 && rounded % 4 !== 0) return
    report({
      stage: 'compress',
      pct,
      detail: `压缩 ZIP… ${rounded}%`,
      compress_pct: metadata.percent,
    })
  })

  report({ stage: 'write', pct: 96, detail: `正在写入 ${filename}…` })
  fs.writeFileSync(dest, buf)
  const stat = fs.statSync(dest)
  report({
    stage: 'done',
    pct: 100,
    detail: `uploads 备份完成（${formatBytes(stat.size)} · ${uploadCount} 个文件）`,
    upload_count: uploadCount,
  })
  return {
    mode: 'uploads',
    filename,
    path: dest,
    size_bytes: stat.size,
    includes: {
      uploads: uploadCount,
    },
  }
}

function assertValidBackupFile(filePath) {
  const size = fs.statSync(filePath).size
  if (size < 64 * 1024) {
    throw new Error('备份文件过小，可能不是有效的数据库')
  }
  const test = new Database(filePath, { readonly: true })
  try {
    test.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get()
  } finally {
    test.close()
  }
}

/**
 * @param {import('better-sqlite3').Database} liveDb
 * @param {string} projectRoot
 * @param {string} sourcePath uploaded backup path
 * @param {{ onProgress?: (info: object) => void, reopenDatabase?: () => import('better-sqlite3').Database }} [opts]
 */
export async function restoreDatabaseFromFile(liveDb, projectRoot, sourcePath, opts = {}) {
  const report = (info) => publishRestoreProgress(info, opts.onProgress)
  const { dbPath, backupDir } = getDataPaths(projectRoot)
  fs.mkdirSync(backupDir, { recursive: true })

  /** @type {string | null} */
  let tempRestorePath = null

  try {
    report({ stage: 'validate', pct: 2, detail: '正在验证备份文件…' })
    assertValidBackupFile(sourcePath)

    const sourceDb = new Database(sourcePath, { readonly: true })
    const sourceCounts = countDbRecords(sourceDb)

    const safetyName = `cat.db.before-restore-${maintenanceTimestamp()}.db`
    const safetyPath = path.join(backupDir, safetyName)
    report({ stage: 'safety', pct: 8, detail: '正在创建恢复前安全备份…' })
    await liveDb.backup(safetyPath, {
      progress: (progress) => {
        report({
          stage: 'safety',
          pct: pctFromBackupPages(progress, 8, 22),
          detail: '正在创建恢复前安全备份…',
          current: Math.max(0, (progress.totalPages || 0) - (progress.remainingPages || 0)),
          total: progress.totalPages || 0,
        })
      },
    })

    tempRestorePath = path.join(backupDir, `_restore-target-${Date.now()}.db`)
    report({ stage: 'restore', pct: 32, detail: '正在导入备份数据…' })
    try {
      await sourceDb.backup(tempRestorePath, {
        progress: (progress) => {
          report({
            stage: 'restore',
            pct: pctFromBackupPages(progress, 32, 52),
            detail: '正在导入备份数据…',
            current: Math.max(0, (progress.totalPages || 0) - (progress.remainingPages || 0)),
            total: progress.totalPages || 0,
          })
        },
      })
    } finally {
      sourceDb.close()
    }

    report({ stage: 'swap', pct: 88, detail: '正在替换数据库文件…' })
    try {
      liveDb.close()
      removeLiveDatabaseSidecars(dbPath)
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
      fs.renameSync(tempRestorePath, dbPath)
      tempRestorePath = null
    } catch (err) {
      if (fs.existsSync(safetyPath) && !fs.existsSync(dbPath)) {
        fs.copyFileSync(safetyPath, dbPath)
      }
      if (typeof opts.reopenDatabase === 'function') {
        try {
          opts.reopenDatabase()
        } catch {
          // ignore
        }
      }
      throw err
    }

    report({ stage: 'finalize', pct: 94, detail: '正在重新连接数据库…' })
    /** @type {import('better-sqlite3').Database} */
    let activeDb = liveDb
    let closeActiveDbAfter = false
    if (typeof opts.reopenDatabase === 'function') {
      activeDb = opts.reopenDatabase()
    } else {
      activeDb = new Database(dbPath)
      activeDb.pragma('journal_mode = WAL')
      activeDb.pragma('foreign_keys = ON')
      closeActiveDbAfter = true
    }

    try {
      activeDb.pragma('wal_checkpoint(RESTART)')
    } catch {
      // ignore
    }

    const result = {
      safety_backup: safetyName,
      counts: countDbRecords(activeDb),
      source_counts: sourceCounts,
    }
    if (closeActiveDbAfter) activeDb.close()
    report({ stage: 'done', pct: 100, detail: '恢复完成' })
    return result
  } catch (err) {
    if (tempRestorePath && fs.existsSync(tempRestorePath)) {
      try {
        fs.unlinkSync(tempRestorePath)
      } catch {
        // ignore
      }
    }
    report({ stage: 'error', pct: 0, detail: err.message || '恢复失败' })
    throw err
  }
}

/**
 * @param {string} projectRoot
 * @param {string} zipPath
 * @param {{ onProgress?: (info: object) => void }} [opts]
 */
export async function restoreUploadsFromZip(projectRoot, zipPath, opts = {}) {
  const report = (info) => publishRestoreProgress(info, opts.onProgress)
  const { uploadsDir, backupDir } = getDataPaths(projectRoot)
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })

  report({ stage: 'validate', pct: 4, detail: '正在读取 ZIP…' })
  const buf = fs.readFileSync(zipPath)
  if (buf.length < 32) {
    throw new Error('ZIP 文件过小')
  }
  const zip = await JSZip.loadAsync(buf)
  const toExtract = Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([rel, entry]) => {
      const norm = rel.replace(/\\/g, '/')
      if (!norm.startsWith('uploads/') || norm === 'uploads/') return null
      const inner = norm.slice('uploads/'.length)
      if (!inner || inner.endsWith('/')) return null
      return { inner, entry }
    })
    .filter(Boolean)

  if (toExtract.length === 0) {
    throw new Error('ZIP 中未找到 uploads/ 目录下的文件')
  }

  const safetyName = `cat-uploads.before-restore-${maintenanceTimestamp()}.zip`
  report({ stage: 'safety', pct: 12, detail: '正在创建恢复前安全备份…' })
  await createUploadsBackup(projectRoot, backupDir, { filename: safetyName })

  let restoredCount = 0
  for (const item of toExtract) {
    const dest = path.join(uploadsDir, item.inner)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const data = await item.entry.async('nodebuffer')
    fs.writeFileSync(dest, data)
    restoredCount += 1
    if (restoredCount % 8 === 0 || restoredCount === toExtract.length) {
      report({
        stage: 'restore',
        pct: 18 + Math.round((restoredCount / toExtract.length) * 72),
        detail: `正在恢复 uploads/（${restoredCount}/${toExtract.length}）…`,
        current: restoredCount,
        total: toExtract.length,
      })
    }
  }

  report({ stage: 'done', pct: 100, detail: 'uploads 恢复完成' })
  return {
    safety_backup: safetyName,
    restored_count: restoredCount,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {{ dryRun?: boolean }} [opts]
 */
export function cleanupUnusedUploads(db, projectRoot, opts = {}) {
  const { uploadsDir } = getDataPaths(projectRoot)
  const referenced = collectReferencedUploadNames(db, projectRoot)
  const files = listUploadFiles(uploadsDir)
  const toDelete = files.filter((f) => !referenced.has(f.name))

  if (opts.dryRun) {
    return {
      dry_run: true,
      scan_includes_avatars: true,
      deleted_count: toDelete.length,
      freed_bytes: toDelete.reduce((s, f) => s + f.size, 0),
      deleted_files: toDelete.map((f) => f.name),
    }
  }

  let deletedCount = 0
  let freedBytes = 0
  const deletedFiles = []

  for (const f of toDelete) {
    const disk = path.join(uploadsDir, f.name)
    try {
      fs.unlinkSync(disk)
      deletedCount += 1
      freedBytes += f.size
      deletedFiles.push(f.name)
    } catch {
      // ignore per-file errors
    }
  }

  return {
    dry_run: false,
    deleted_count: deletedCount,
    freed_bytes: freedBytes,
    deleted_files: deletedFiles,
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
