import fs from 'node:fs'
import path from 'node:path'

/** @param {string} projectRoot */
export function getSvgTemplatesDir(projectRoot) {
  return path.join(projectRoot, 'data', 'svg-templates')
}

/** @param {string | null | undefined} filePath */
export function svgTemplatePublicUrl(filePath) {
  if (!filePath) return null
  const rel = String(filePath).replace(/^\/svg-templates\//, '').replace(/^svg-templates\//, '')
  return `/svg-templates/${rel}`
}

/** @param {string} projectRoot @param {string | null | undefined} filePath */
export function resolveSvgTemplateDiskPath(projectRoot, filePath) {
  const rel = String(filePath || '')
    .replace(/^\/svg-templates\//, '')
    .replace(/^svg-templates\//, '')
  const base = path.resolve(getSvgTemplatesDir(projectRoot))
  const disk = path.resolve(base, rel)
  if (!disk.startsWith(`${base}${path.sep}`) && disk !== base) {
    throw new Error('非法模板路径')
  }
  return disk
}

function safeSlugFilename(slug) {
  const base = String(slug || 'template')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'template'
  return `${base}.svg`
}

/** @param {string} projectRoot @param {string} slug @param {string} svgContent */
export function writeSvgTemplateFile(projectRoot, slug, svgContent) {
  const dir = getSvgTemplatesDir(projectRoot)
  fs.mkdirSync(dir, { recursive: true })
  const name = safeSlugFilename(slug)
  const diskPath = path.join(dir, name)
  fs.writeFileSync(diskPath, svgContent, 'utf8')
  return `svg-templates/${name}`
}

/** @param {string} projectRoot @param {string | null | undefined} filePath */
export function readSvgTemplateFile(projectRoot, filePath) {
  if (!filePath) return null
  try {
    const disk = resolveSvgTemplateDiskPath(projectRoot, filePath)
    if (!fs.existsSync(disk)) return null
    return fs.readFileSync(disk, 'utf8')
  } catch {
    return null
  }
}

/** @param {string} projectRoot @param {string | null | undefined} filePath */
export function deleteSvgTemplateFile(projectRoot, filePath) {
  if (!filePath) return
  try {
    const disk = resolveSvgTemplateDiskPath(projectRoot, filePath)
    if (fs.existsSync(disk)) fs.unlinkSync(disk)
  } catch {
    /* ignore */
  }
}

/** @param {string} projectRoot @param {string | null | undefined} filePath */
export function getSvgTemplateFileSize(projectRoot, filePath) {
  if (!filePath) return 0
  try {
    const disk = resolveSvgTemplateDiskPath(projectRoot, filePath)
    if (!fs.existsSync(disk)) return 0
    return fs.statSync(disk).size
  } catch {
    return 0
  }
}

/**
 * @param {import('better-sqlite3').Database} database
 * @param {string} projectRoot
 */
export function migrateSvgTemplatesToFiles(database, projectRoot) {
  const cols = database.prepare('PRAGMA table_info(svg_templates)').all()
  if (!cols.some((c) => c.name === 'file_path')) {
    database.exec('ALTER TABLE svg_templates ADD COLUMN file_path TEXT')
  }

  const rows = database.prepare('SELECT id, slug, svg_content, file_path FROM svg_templates').all()
  let migrated = 0
  for (const row of rows) {
    if (row.file_path && readSvgTemplateFile(projectRoot, row.file_path)) continue
    const content = String(row.svg_content || '').trim()
    if (!content.includes('<svg')) continue
    const slug = row.slug || `template-${row.id}`
    const filePath = writeSvgTemplateFile(projectRoot, slug, content)
    database.prepare(`
      UPDATE svg_templates SET file_path = ?, svg_content = '' WHERE id = ?
    `).run(filePath, row.id)
    migrated += 1
  }
  if (migrated > 0) {
    console.log(`[CAT API] 已将 ${migrated} 个 SVG 模板从数据库迁移到 data/svg-templates/`)
  }
}

/**
 * @param {string} projectRoot
 * @param {{ file_path?: string | null, slug: string, svg_content?: string | null }} prev
 * @param {{ slug: string, svgContent?: string | null }} next
 */
export function syncSvgTemplateFile(projectRoot, prev, next) {
  let filePath = prev.file_path || null
  const slugChanged = next.slug !== prev.slug

  if (next.svgContent != null) {
    const content = String(next.svgContent).trim()
    if (!content.includes('<svg')) throw new Error('无效的 SVG 内容')
    if (!filePath) {
      filePath = writeSvgTemplateFile(projectRoot, next.slug, content)
    } else {
      const disk = resolveSvgTemplateDiskPath(projectRoot, filePath)
      fs.mkdirSync(path.dirname(disk), { recursive: true })
      fs.writeFileSync(disk, content, 'utf8')
    }
  }

  if (slugChanged && filePath) {
    const content = readSvgTemplateFile(projectRoot, filePath)
    if (content) {
      deleteSvgTemplateFile(projectRoot, filePath)
      filePath = writeSvgTemplateFile(projectRoot, next.slug, content)
    }
  }

  return filePath
}

/** @param {object} row */
export function formatSvgTemplateRow(row, projectRoot) {
  if (!row) return null
  const filePath = row.file_path || null
  const svgBytes = filePath
    ? getSvgTemplateFileSize(projectRoot, filePath)
    : (row.svg_content ? Buffer.byteLength(String(row.svg_content), 'utf8') : 0)
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    file_path: filePath,
    file_url: svgTemplatePublicUrl(filePath),
    is_default: !!row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
    svg_bytes: svgBytes,
  }
}
