import { slugify, uniqueSlug } from './db.js'
import { defaultUntitledTitle, getSiteConfig } from './siteSettings.js'
import { slugByGroupId, idByGroupSlug, resolveGroupIdForCreate, sqlGroupInClause } from './accessControl.js'
import { exportSvgTemplatesZip, importSvgTemplatesZip } from './svgTemplateBackup.js'

export const DATA_TRANSFER_VERSION = 1

function parseJson(text, fallback = null) {
  if (text == null || text === '') return fallback
  try {
    const parsed = JSON.parse(text)
    return parsed == null ? fallback : parsed
  } catch {
    return fallback
  }
}

function nowIso() {
  return new Date().toISOString()
}

function parseIdList(raw) {
  if (!raw) return null
  const ids = String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((id) => id > 0)
  return ids.length ? [...new Set(ids)] : null
}

function slugById(db, table, id) {
  if (!id) return null
  const row = db.prepare(`SELECT slug FROM ${table} WHERE id = ?`).get(id)
  return row?.slug ?? null
}

function idBySlug(db, table, slug) {
  if (!slug) return null
  const row = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(String(slug).trim())
  return row?.id ?? null
}

function normalizeTableTemplateColumns(columns) {
  if (!Array.isArray(columns)) return []
  return columns.map((c) => String(c).trim()).filter(Boolean)
}

function normalizeTableTemplateSampleRows(rows, columns) {
  const cols = normalizeTableTemplateColumns(columns)
  const value = Array.isArray(rows) ? rows : []
  return value.map((row) => {
    if (!row || typeof row !== 'object') return Object.fromEntries(cols.map((c) => [c, '']))
    const out = {}
    for (const col of cols) out[col] = row[col] != null ? String(row[col]) : ''
    return out
  })
}

function normalizeColumnOrder(value) {
  if (!Array.isArray(value)) return null
  const cols = value.map((c) => String(c).trim()).filter(Boolean)
  return cols.length > 0 ? cols : null
}

function exportTableTemplateRow(row, db) {
  const columns = parseJson(row.columns, [])
  const sampleRows = parseJson(row.sample_rows, [])
  return {
    name: row.name,
    slug: row.slug,
    group_slug: slugByGroupId(db, row.group_id),
    columns,
    sample_rows: Array.isArray(sampleRows) ? sampleRows : [],
    is_default: !!row.is_default,
  }
}

function exportLayoutPresetRow(db, row) {
  const pageWidth = row.page_width_mm != null ? Number(row.page_width_mm) : 297
  const pageHeight = row.page_height_mm != null ? Number(row.page_height_mm) : 210
  return {
    name: row.name,
    slug: row.slug,
    group_slug: slugByGroupId(db, row.group_id),
    layout_overrides: parseJson(row.layout_overrides, {}),
    preview_sample_row: parseJson(row.preview_sample_row, {}),
    font_scale: Number(row.font_scale) || 1,
    show_layout_boxes: !!row.show_layout_boxes,
    show_reference_layer: row.show_reference_layer != null ? !!row.show_reference_layer : false,
    show_template_layer: row.show_template_layer != null ? !!row.show_template_layer : true,
    page_width_mm: pageWidth,
    page_height_mm: pageHeight,
    is_default: !!row.is_default,
    svg_template_slug: slugById(db, 'svg_templates', row.svg_template_id),
    table_template_slug: slugById(db, 'table_templates', row.table_template_id),
  }
}

function exportCertificateItem(db, certId) {
  const cert = db.prepare('SELECT * FROM certificates WHERE id = ?').get(certId)
  if (!cert) return null
  const rows = db.prepare(`
    SELECT sort_order, row_data FROM certificate_rows WHERE certificate_id = ? ORDER BY sort_order
  `).all(certId)
  return {
    title: cert.title,
    status: cert.status === 'published' ? 'published' : 'draft',
    group_name: cert.group_name ?? null,
    group_slug: slugByGroupId(db, cert.group_id),
    preset_slug: slugById(db, 'layout_presets', cert.preset_id),
    svg_template_slug: slugById(db, 'svg_templates', cert.template_id),
    table_template_slug: slugById(db, 'table_templates', cert.table_template_id),
    column_order: parseJson(cert.column_order, null),
    layout_overrides: parseJson(cert.layout_overrides, {}),
    font_scale: Number(cert.font_scale) || 1,
    show_layout_boxes: !!cert.show_layout_boxes,
    preview_ui: parseJson(cert.preview_ui, {}),
    rows: rows.map((r) => parseJson(r.row_data, {})),
  }
}

function makeBundle(kind, items) {
  return {
    version: DATA_TRANSFER_VERSION,
    kind,
    exported_at: nowIso(),
    item_count: items.length,
    items,
  }
}

export function exportTableTemplates(db, ids = null, principal = null) {
  const gf = principal ? sqlGroupInClause(principal) : { clause: '', params: [] }
  let rows
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',')
    rows = db.prepare(`SELECT * FROM table_templates WHERE id IN (${placeholders})${gf.clause} ORDER BY updated_at DESC`).all(...ids, ...gf.params)
  } else {
    rows = db.prepare(`SELECT * FROM table_templates WHERE 1=1${gf.clause} ORDER BY updated_at DESC`).all(...gf.params)
  }
  return makeBundle('table_templates', rows.map((r) => exportTableTemplateRow(r, db)))
}

export function exportLayoutPresets(db, ids = null, principal = null) {
  const gf = principal ? sqlGroupInClause(principal) : { clause: '', params: [] }
  let rows
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',')
    rows = db.prepare(`SELECT * FROM layout_presets WHERE id IN (${placeholders})${gf.clause} ORDER BY updated_at DESC`).all(...ids, ...gf.params)
  } else {
    rows = db.prepare(`SELECT * FROM layout_presets WHERE 1=1${gf.clause} ORDER BY updated_at DESC`).all(...gf.params)
  }
  return makeBundle('layout_presets', rows.map((row) => exportLayoutPresetRow(db, row)))
}

export function exportCertificates(db, ids = null, principal = null) {
  const gf = principal ? sqlGroupInClause(principal) : { clause: '', params: [] }
  let rows
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',')
    rows = db.prepare(`SELECT id FROM certificates WHERE id IN (${placeholders})${gf.clause} ORDER BY updated_at DESC`).all(...ids, ...gf.params)
  } else {
    rows = db.prepare(`SELECT id FROM certificates WHERE 1=1${gf.clause} ORDER BY updated_at DESC`).all(...gf.params)
  }
  const items = rows.map((r) => exportCertificateItem(db, r.id)).filter(Boolean)
  return makeBundle('certificates', items)
}

function validateBundle(bundle, expectedKind) {
  if (!bundle || typeof bundle !== 'object') throw new Error('无效的导入文件')
  if (Number(bundle.version) !== DATA_TRANSFER_VERSION) {
    throw new Error(`不支持的导出版本 v${bundle.version ?? '?'}，当前为 v${DATA_TRANSFER_VERSION}`)
  }
  if (bundle.kind !== expectedKind) {
    throw new Error(`文件类型不匹配：期望 ${expectedKind}，实际为 ${bundle.kind ?? '未知'}`)
  }
  if (!Array.isArray(bundle.items)) throw new Error('导入文件缺少 items 数组')
  return bundle.items
}

function normalizeOnConflict(value) {
  const mode = String(value || 'rename').trim().toLowerCase()
  if (mode === 'skip' || mode === 'update' || mode === 'rename') return mode
  return 'rename'
}

function uniqueCertificateTitle(db, title) {
  const base = String(title || defaultUntitledTitle(getSiteConfig(db))).trim() || defaultUntitledTitle(getSiteConfig(db))
  let candidate = base
  let n = 0
  while (db.prepare('SELECT 1 FROM certificates WHERE title = ? LIMIT 1').get(candidate)) {
    n += 1
    candidate = `${base} (导入${n > 1 ? ` ${n}` : ''})`
  }
  return candidate
}

export function importTableTemplates(db, bundle, { onConflict = 'rename', principal = null } = {}) {
  const items = validateBundle(bundle, 'table_templates')
  const mode = normalizeOnConflict(onConflict)
  const ts = nowIso()
  const result = { created: 0, updated: 0, skipped: 0, ids: [], errors: [] }

  const tx = db.transaction((list) => {
    for (const item of list) {
      try {
        const name = String(item.name || '未命名表格').trim() || '未命名表格'
        const columns = normalizeTableTemplateColumns(item.columns)
        const sampleRows = normalizeTableTemplateSampleRows(item.sample_rows, columns)
        const sourceSlug = String(item.slug || slugify(name)).trim() || slugify(name)
        const existing = db.prepare('SELECT id FROM table_templates WHERE slug = ?').get(sourceSlug)
        let groupId = idByGroupSlug(db, item.group_slug)
        if (!groupId && principal) {
          groupId = resolveGroupIdForCreate(db, principal, null)
        }

        if (existing && mode === 'skip') {
          result.skipped += 1
          result.ids.push(existing.id)
          continue
        }

        if (existing && mode === 'update') {
          db.prepare(`
            UPDATE table_templates SET name = ?, columns = ?, sample_rows = ?, group_id = COALESCE(?, group_id), updated_at = ? WHERE id = ?
          `).run(name, JSON.stringify(columns), JSON.stringify(sampleRows), groupId, ts, existing.id)
          result.updated += 1
          result.ids.push(existing.id)
          continue
        }

        const slug = existing && mode === 'rename'
          ? uniqueSlug(db, 'table_templates', `${sourceSlug}-import`)
          : uniqueSlug(db, 'table_templates', sourceSlug)

        const insert = db.prepare(`
          INSERT INTO table_templates (name, slug, columns, sample_rows, is_default, group_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        `)
        const r = insert.run(name, slug, JSON.stringify(columns), JSON.stringify(sampleRows), groupId, ts, ts)
        result.created += 1
        result.ids.push(Number(r.lastInsertRowid))
      } catch (err) {
        result.errors.push(err.message || String(err))
      }
    }
  })
  tx(items)
  return result
}

export function importLayoutPresets(db, bundle, { onConflict = 'rename', principal = null } = {}) {
  const items = validateBundle(bundle, 'layout_presets')
  const mode = normalizeOnConflict(onConflict)
  const ts = nowIso()
  const result = { created: 0, updated: 0, skipped: 0, ids: [], warnings: [], errors: [] }

  const tx = db.transaction((list) => {
    for (const item of list) {
      try {
        const name = String(item.name || '未命名预设').trim() || '未命名预设'
        const sourceSlug = String(item.slug || slugify(name)).trim() || slugify(name)
        const existing = db.prepare('SELECT id FROM layout_presets WHERE slug = ?').get(sourceSlug)
        let groupId = idByGroupSlug(db, item.group_slug)
        if (!groupId && principal) {
          groupId = resolveGroupIdForCreate(db, principal, null)
        }

        let svgTemplateId = idBySlug(db, 'svg_templates', item.svg_template_slug)
        let tableTemplateId = idBySlug(db, 'table_templates', item.table_template_slug)
        if (item.svg_template_slug && svgTemplateId == null) {
          result.warnings.push(`布局「${name}」：未找到 SVG 模板 slug「${item.svg_template_slug}」，已留空`)
        }
        if (item.table_template_slug && tableTemplateId == null) {
          result.warnings.push(`布局「${name}」：未找到表格模板 slug「${item.table_template_slug}」，已留空`)
        }

        const payload = {
          layout_overrides: item.layout_overrides || {},
          preview_sample_row: item.preview_sample_row || {},
          font_scale: Number(item.font_scale) || 1,
          show_layout_boxes: !!item.show_layout_boxes,
          show_reference_layer: !!item.show_reference_layer,
          show_template_layer: item.show_template_layer !== false,
          page_width_mm: item.page_width_mm != null ? Number(item.page_width_mm) : 297,
          page_height_mm: item.page_height_mm != null ? Number(item.page_height_mm) : 210,
          svg_template_id: svgTemplateId,
          table_template_id: tableTemplateId,
        }

        if (existing && mode === 'skip') {
          result.skipped += 1
          result.ids.push(existing.id)
          continue
        }

        if (existing && mode === 'update') {
          db.prepare(`
            UPDATE layout_presets SET name = ?, layout_overrides = ?, preview_sample_row = ?, font_scale = ?,
              show_layout_boxes = ?, show_reference_layer = ?, show_template_layer = ?,
              svg_template_id = ?, table_template_id = ?, page_width_mm = ?, page_height_mm = ?,
              group_id = COALESCE(?, group_id), updated_at = ?
            WHERE id = ?
          `).run(
            name,
            JSON.stringify(payload.layout_overrides),
            JSON.stringify(payload.preview_sample_row),
            payload.font_scale,
            payload.show_layout_boxes ? 1 : 0,
            payload.show_reference_layer ? 1 : 0,
            payload.show_template_layer ? 1 : 0,
            payload.svg_template_id,
            payload.table_template_id,
            payload.page_width_mm,
            payload.page_height_mm,
            groupId,
            ts,
            existing.id,
          )
          result.updated += 1
          result.ids.push(existing.id)
          continue
        }

        const slug = existing && mode === 'rename'
          ? uniqueSlug(db, 'layout_presets', `${sourceSlug}-import`)
          : uniqueSlug(db, 'layout_presets', sourceSlug)

        const r = db.prepare(`
          INSERT INTO layout_presets (
            name, slug, layout_overrides, preview_sample_row, font_scale, show_layout_boxes,
            show_reference_layer, show_template_layer, is_default, svg_template_id, table_template_id,
            page_width_mm, page_height_mm, group_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          name,
          slug,
          JSON.stringify(payload.layout_overrides),
          JSON.stringify(payload.preview_sample_row),
          payload.font_scale,
          payload.show_layout_boxes ? 1 : 0,
          payload.show_reference_layer ? 1 : 0,
          payload.show_template_layer ? 1 : 0,
          payload.svg_template_id,
          payload.table_template_id,
          payload.page_width_mm,
          payload.page_height_mm,
          groupId,
          ts,
          ts,
        )
        result.created += 1
        result.ids.push(Number(r.lastInsertRowid))
      } catch (err) {
        result.errors.push(err.message || String(err))
      }
    }
  })
  tx(items)
  return result
}

function importCertificates(db, bundle, { onConflict = 'rename', principal = null } = {}) {
  const items = validateBundle(bundle, 'certificates')
  const mode = normalizeOnConflict(onConflict)
  const ts = nowIso()
  const result = { created: 0, updated: 0, skipped: 0, ids: [], warnings: [], errors: [] }

  const tx = db.transaction((list) => {
    for (const item of list) {
      try {
        let title = String(item.title || defaultUntitledTitle(getSiteConfig(db))).trim()
        const existing = db.prepare('SELECT id FROM certificates WHERE title = ? LIMIT 1').get(title)

        if (existing && mode === 'skip') {
          result.skipped += 1
          result.ids.push(existing.id)
          continue
        }

        const presetId = idBySlug(db, 'layout_presets', item.preset_slug)
        const templateId = idBySlug(db, 'svg_templates', item.svg_template_slug)
        const tableTemplateId = idBySlug(db, 'table_templates', item.table_template_slug)
        let groupId = idByGroupSlug(db, item.group_slug)
        if (!groupId && principal) {
          groupId = resolveGroupIdForCreate(db, principal, null)
        }
        if (item.preset_slug && presetId == null) {
          result.warnings.push(`证书「${title}」：未找到布局模板 slug「${item.preset_slug}」`)
        }
        if (item.svg_template_slug && templateId == null) {
          result.warnings.push(`证书「${title}」：未找到 SVG 模板 slug「${item.svg_template_slug}」`)
        }
        if (item.table_template_slug && tableTemplateId == null) {
          result.warnings.push(`证书「${title}」：未找到表格模板 slug「${item.table_template_slug}」`)
        }

        const columnOrder = normalizeColumnOrder(item.column_order)
        const rows = Array.isArray(item.rows) ? item.rows : []
        const status = item.status === 'published' ? 'published' : 'draft'
        const previewUi = item.preview_ui && typeof item.preview_ui === 'object' ? item.preview_ui : {}
        const importDraftUi = status === 'published' ? { ...previewUi, public_snapshot: null } : previewUi

        if (existing && mode === 'update') {
          db.prepare(`
            UPDATE certificates SET title = ?, status = ?, preset_id = ?, template_id = ?, table_template_id = ?,
              column_order = ?, layout_overrides = ?, font_scale = ?, show_layout_boxes = ?, group_name = ?,
              group_id = COALESCE(?, group_id), preview_ui = ?, published_at = ?, updated_at = ?
            WHERE id = ?
          `).run(
            title,
            status,
            presetId,
            templateId,
            tableTemplateId,
            columnOrder ? JSON.stringify(columnOrder) : null,
            JSON.stringify(item.layout_overrides || {}),
            Number(item.font_scale) || 1,
            item.show_layout_boxes ? 1 : 0,
            item.group_name != null ? (String(item.group_name).trim() || null) : null,
            groupId,
            JSON.stringify(importDraftUi),
            status === 'published' ? ts : null,
            ts,
            existing.id,
          )
          db.prepare('DELETE FROM certificate_rows WHERE certificate_id = ?').run(existing.id)
          const ins = db.prepare('INSERT INTO certificate_rows (certificate_id, sort_order, row_data) VALUES (?, ?, ?)')
          rows.forEach((row, i) => ins.run(existing.id, i, JSON.stringify(row || {})))
          result.updated += 1
          result.ids.push(existing.id)
          continue
        }

        if (existing && mode === 'rename') {
          title = uniqueCertificateTitle(db, title)
        }

        const r = db.prepare(`
          INSERT INTO certificates (
            title, status, preset_id, template_id, table_template_id, column_order, layout_overrides,
            font_scale, show_layout_boxes, group_name, group_id, preview_ui, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          title,
          status,
          presetId,
          templateId,
          tableTemplateId,
          columnOrder ? JSON.stringify(columnOrder) : null,
          JSON.stringify(item.layout_overrides || {}),
          Number(item.font_scale) || 1,
          item.show_layout_boxes ? 1 : 0,
          item.group_name != null ? (String(item.group_name).trim() || null) : null,
          groupId,
          JSON.stringify(importDraftUi),
          status === 'published' ? ts : null,
          ts,
          ts,
        )
        const certId = r.lastInsertRowid
        const ins = db.prepare('INSERT INTO certificate_rows (certificate_id, sort_order, row_data) VALUES (?, ?, ?)')
        rows.forEach((row, i) => ins.run(certId, i, JSON.stringify(row || {})))
        result.created += 1
        result.ids.push(Number(certId))
      } catch (err) {
        result.errors.push(err.message || String(err))
      }
    }
  })
  tx(items)
  return result
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, requireAuth: import('hono').MiddlewareHandler, projectRoot: string }} opts
 */
export function registerDataTransferRoutes(app, { db, requireAuth, projectRoot }) {
  app.get('/api/export/svg-templates', requireAuth, async (c) => {
    try {
      const ids = parseIdList(c.req.query('ids'))
      const { buffer, filename } = await exportSvgTemplatesZip(db, projectRoot, ids, c.get('principal'))
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length),
        },
      })
    } catch (err) {
      return c.json({ error: err.message || '导出失败' }, 400)
    }
  })

  app.post('/api/import/svg-templates', requireAuth, async (c) => {
    const body = await c.req.parseBody()
    const file = body.file ?? body.zip
    if (!file || typeof file === 'string') {
      return c.json({ error: '请使用 multipart 字段 file 上传 .zip 备份包' }, 400)
    }
    const name = file.name || 'svg-templates.zip'
    if (!/\.zip$/i.test(name)) {
      return c.json({ error: 'SVG 模板库备份仅支持 .zip 文件' }, 400)
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const onConflict = body.on_conflict ?? body.onConflict ?? 'rename'
      const result = await importSvgTemplatesZip(db, projectRoot, buf, {
        onConflict: String(onConflict),
        principal: c.get('principal'),
      })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })

  app.get('/api/export/table-templates', requireAuth, (c) => {
    const ids = parseIdList(c.req.query('ids'))
    return c.json(exportTableTemplates(db, ids, c.get('principal')))
  })

  app.post('/api/import/table-templates', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const bundle = body.bundle ?? body
      const result = importTableTemplates(db, bundle, { onConflict: body.on_conflict, principal: c.get('principal') })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })

  app.get('/api/export/layout-presets', requireAuth, (c) => {
    const ids = parseIdList(c.req.query('ids'))
    return c.json(exportLayoutPresets(db, ids, c.get('principal')))
  })

  app.post('/api/import/layout-presets', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const bundle = body.bundle ?? body
      const result = importLayoutPresets(db, bundle, { onConflict: body.on_conflict, principal: c.get('principal') })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })

  app.get('/api/export/certificates', requireAuth, (c) => {
    const ids = parseIdList(c.req.query('ids'))
    return c.json(exportCertificates(db, ids, c.get('principal')))
  })

  app.post('/api/import/certificates', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const bundle = body.bundle ?? body
      const result = importCertificates(db, bundle, { onConflict: body.on_conflict, principal: c.get('principal') })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '导入失败' }, 400)
    }
  })
}
