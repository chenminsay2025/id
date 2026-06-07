#!/usr/bin/env node
/**
 * 安全备份 SQLite 数据库（合并 WAL，生成独立 .db 文件）
 * 用法：npm run backup:data
 */
import fs from 'node:fs'
import { openDatabase } from '../server/db.js'
import {
  createDatabaseBackup,
  formatBytes,
  getDataPaths,
} from '../server/dataMaintenance.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const db = openDatabase()
  try {
    const result = await createDatabaseBackup(db, root)
    const rel = path.relative(root, result.path)
    console.log(`[backup] 已备份 → ${rel} (${formatBytes(result.size_bytes)})`)
    console.log('[backup] 此文件为完整快照，迁移/恢复时只需这一个 .db 文件')

    const uploads = path.join(getDataPaths(root).uploadsDir)
    if (fs.existsSync(uploads)) {
      const n = fs.readdirSync(uploads).filter((f) => f !== '.gitkeep').length
      if (n > 0) console.log(`[backup] 另有 data/uploads/ 中 ${n} 个图片文件，请一并复制整个 uploads 目录`)
    }
  } finally {
    db.close()
  }
}

main().catch((err) => {
  console.error('[backup] 失败:', err.message)
  process.exit(1)
})
