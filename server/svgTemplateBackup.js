import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { slugify, uniqueSlug } from './db.js'
import {
  sqlGroupInClause,
  idByGroupSlug,
  resolveGroupIdForCreate,
  slugByGroupId,
} from './accessControl.js'
import { maintenanceTimestamp } from './dataMaintenance.js'
import {
  readSvgTemplateFile,
  writeSvgTemplateFile,
  deleteSvgTemplateFile,
  resolveSvgTemplateDiskPath,
} from './svgTemplateFiles.js'
const SVG_ZIP_KIND = 'svg_templates'
const SVG_TEMPLATE_BACKUP_VERSION = 1
const FILES_PREFIX = 'files/'

/** @param {import('better-sqlite3').Database} db @param {number[] | null} ids @param {object | null} principal */
function listSvgTemplateRows(db, ids, principal) {
  const gf = principal ? sqlGroupInClause(principal) : { clause: '', params: [] }
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',')
    return db.prepare(`SELECT * FROM svg_templates WHERE id IN (${placeholders})${gf.clause} ORDER BY updated_at DESC`).all(...ids, ...gf.params)
  }
  return db.prepare(`SELECT * FROM svg_templates WHERE 1=1${gf.clause} ORDER BY updated_at DESC`).all(...gf.params)
}

function safeZipEntryPath(rel) {
  const normalized = path.posix.normalize(String(rel || '').replace(/\\/g, '/'))
  if (!normalized.startsWith(FILES_PREFIX) || normalized.includes('..')) {
    throw new Error(`非法文件路径：${rel}`)
  }
  return normalized
}

function svgFileBasename(row, projectRoot) {
  if (row.file_path) {
    try {
      const disk = resolveSvgTemplateDiskPath(projectRoot, row.file_path)
      if (fs.existsSync(disk)) return path.basename(disk)
    } catch {
      // fall through
    }
  }
  const slug = String(row.slug || 'template').trim() || 'template'
  return `${slug.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'template'}.svg`
}

/**
 * 将 SVG 模板写入 ZIP（按磁盘路径前缀，供全量备份等使用）。
 * @param {*} zip
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {{ zipPrefix?: string, ids?: number[] | null, principal?: object | null, onFile?: (info: { current: number, total: number, file: string }) => void }} [opts]
 */
export function appendSvgTemplateFilesToZip(zip, db, projectRoot, opts = {}) {
  const zipPrefix = opts.zipPrefix ?? 'svg-templates/'
  const rows = listSvgTemplateRows(db, opts.ids ?? null, opts.principal ?? null)
  const usedNames = new Set()
  let count = 0
  const skipped = []
  const total = rows.length

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    let content = readSvgTemplateFile(projectRoot, row.file_path)
    if (!content && row.svg_content) content = String(row.svg_content)
    if (!content || !content.includes('<svg')) {
      skipped.push(row.name || row.slug || String(row.id))
      continue
    }
    let basename = svgFileBasename(row, projectRoot)
    if (usedNames.has(basename)) {
      const stem = basename.replace(/\.svg$/i, '')
      let n = 2
      while (usedNames.has(`${stem}-${n}.svg`)) n += 1
      basename = `${stem}-${n}.svg`
    }
    usedNames.add(basename)
    const zipPath = `${zipPrefix}${basename}`
    zip.file(zipPath, content)
    count += 1
    opts.onFile?.({ current: count, total, file: zipPath })
  }

  return { count, skipped, total }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {number[] | null} [ids]
 * @param {object | null} [principal]
 */
export async function exportSvgTemplatesZip(db, projectRoot, ids = null, principal = null) {
  const rows = listSvgTemplateRows(db, ids, principal)
  const zip = new JSZip()
  /** @type {object[]} */
  const items = []
  const skipped = []

  for (const row of rows) {
    let content = readSvgTemplateFile(projectRoot, row.file_path)
    if (!content && row.svg_content) content = String(row.svg_content)
    if (!content || !content.includes('<svg')) {
      skipped.push(row.name || row.slug || String(row.id))
      continue
    }
    const basename = svgFileBasename(row, projectRoot)
    const zipPath = `${FILES_PREFIX}${basename}`
    zip.file(zipPath, content)
    items.push({
      name: row.name,
      slug: row.slug,
      group_slug: slugByGroupId(db, row.group_id),
      is_default: !!row.is_default,
      file: zipPath,
    })
  }

  if (!items.length) {
    throw new Error(skipped.length ? '所选 SVG 模板均无可用文件' : '没有可导出的 SVG 模板')
  }

  zip.file('manifest.json', JSON.stringify({
    version: SVG_TEMPLATE_BACKUP_VERSION,
    kind: SVG_ZIP_KIND,
    exported_at: new Date().toISOString(),
    item_count: items.length,
    skipped,
    items,
  }, null, 2))

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return {
    buffer,
    filename: `svg-templates-${maintenanceTimestamp()}.zip`,
    item_count: items.length,
    skipped,
  }
}

function normalizeOnConflict(value) {
  const mode = String(value || 'rename').trim().toLowerCase()
  if (mode === 'skip' || mode === 'update' || mode === 'rename') return mode
  return 'rename'
}

function upsertSvgTemplateRow(db, projectRoot, item, svgContent, mode, principal, ts, result) {
  const name = String(item.name || '未命名 SVG').trim() || '未命名 SVG'
  const sourceSlug = String(item.slug || slugify(name)).trim() || slugify(name)
  const existing = db.prepare('SELECT id, file_path FROM svg_templates WHERE slug = ?').get(sourceSlug)
  let groupId = idByGroupSlug(db, item.group_slug)
  if (!groupId && principal) {
    groupId = resolveGroupIdForCreate(db, principal, null)
  }

  if (existing && mode === 'skip') {
    result.skipped += 1
    result.ids.push(existing.id)
    return
  }

  const slug = existing && mode === 'rename'
    ? uniqueSlug(db, 'svg_templates', `${sourceSlug}-import`)
    : uniqueSlug(db, 'svg_templates', sourceSlug)

  const filePath = writeSvgTemplateFile(projectRoot, slug, svgContent)

  if (existing && mode === 'update') {
    if (existing.file_path && existing.file_path !== filePath) {
      deleteSvgTemplateFile(projectRoot, existing.file_path)
    }
    db.prepare(`
      UPDATE svg_templates SET name = ?, file_path = ?, svg_content = '', group_id = COALESCE(?, group_id), updated_at = ? WHERE id = ?
    `).run(name, filePath, groupId, ts, existing.id)
    result.updated += 1
    result.ids.push(existing.id)
    return
  }

  const r = db.prepare(`
    INSERT INTO svg_templates (name, slug, svg_content, file_path, is_default, group_id, created_at, updated_at)
    VALUES (?, ?, '', ?, 0, ?, ?, ?)
  `).run(name, slug, filePath, groupId, ts, ts)
  result.created += 1
  result.ids.push(Number(r.lastInsertRowid))
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectRoot
 * @param {Buffer} zipBuffer
 * @param {{ onConflict?: string, principal?: object | null }} [opts]
 */
export async function importSvgTemplatesZip(db, projectRoot, zipBuffer, { onConflict = 'rename', principal = null } = {}) {
  const zip = await JSZip.loadAsync(zipBuffer)
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) throw new Error('ZIP 中缺少 manifest.json，不是有效的 SVG 模板库备份')

  const manifest = JSON.parse(await manifestEntry.async('string'))
  if (manifest.kind !== SVG_ZIP_KIND) {
    throw new Error(`备份类型不匹配：期望 ${SVG_ZIP_KIND}，实际为 ${manifest.kind ?? '未知'}`)
  }
  if (!Array.isArray(manifest.items) || !manifest.items.length) {
    throw new Error('manifest.json 中没有可导入的 SVG 模板')
  }

  const mode = normalizeOnConflict(onConflict)
  const ts = new Date().toISOString()
  const result = { created: 0, updated: 0, skipped: 0, ids: [], errors: [] }

  /** @type {{ item: object, svgContent: string }[]} */
  const prepared = []
  for (const item of manifest.items) {
    try {
      const zipPath = safeZipEntryPath(item.file)
      const entry = zip.file(zipPath)
      if (!entry) {
        result.errors.push(`「${item.name || item.slug}」：ZIP 中缺少文件 ${zipPath}`)
        continue
      }
      const svgContent = await entry.async('string')
      if (!svgContent.includes('<svg')) {
        result.errors.push(`「${item.name || item.slug}」：不是有效的 SVG 文件`)
        continue
      }
      prepared.push({ item, svgContent })
    } catch (err) {
      result.errors.push(err.message || String(err))
    }
  }

  const syncTx = db.transaction((list) => {
    for (const { item, svgContent } of list) {
      try {
        upsertSvgTemplateRow(db, projectRoot, item, svgContent, mode, principal, ts, result)
      } catch (err) {
        result.errors.push(err.message || String(err))
      }
    }
  })
  syncTx(prepared)

  if (!result.created && !result.updated && !result.skipped && result.errors.length) {
    throw new Error(result.errors[0] || '导入失败')
  }

  return result
}
