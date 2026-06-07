/**
 * server/routes/certificates.js
 * 证书 CRUD + 修订 + 回收站路由
 */

import {
  normalizeCertificateRowInput,
  validateCertificateRowPresets,
  validateCertificateForeignResources,
  buildCertificatePresetBundles,
} from '../certificateRowPresets.js'
import {
  syncPublishedCertificateAccessGroup,
  syncCertificateAccessGroup,
  validateCertificatePresetGroups,
  resolveCertificateAccessGroupId,
  resolveGroupIdForCertificateCreate,
} from '../certificateAccessGroup.js'
import {
  trashCertificate,
  restoreCertificate,
  purgeCertificate,
  assertCertificateNotTrashed,
} from '../certificateTrash.js'
import { attachSearchTextToCertificates } from '../certificateSearch.js'
import {
  isPublicCertSlugAvailable,
  resolvePublicSlugForWrite,
  resolvePublishedCertificateByRef,
  suggestPublicCertSlug,
  normalizePublicCertSlug,
} from '../certificatePublicSlug.js'
import {
  buildCertificatePublicSnapshot,
  resolveCertificatePublicSnapshot,
  resolveCertificateTemplateId,
} from '../certificateAdornments.js'
import {
  sqlGroupInClause,
  resolveGroupIdForCreate,
  resolveGroupIdForUpdate,
  assertRelatedResourcesInGroups,
  assertGroupAccess,
  getUngroupedGroupId,
} from '../accessControl.js'
import { getRowInGroups, getDefaultSvgTemplateIdForPrincipal } from '../resourceGuards.js'
import { getSiteConfig, defaultUntitledTitle, defaultCopyTitle } from '../siteSettings.js'
import { normalizePageSizeMm } from '../../src/pageSize.js'
import { normalizePageNavColumnStorage } from '../../src/pageNavColumn.js'

/**
 * @param {import('hono').Hono} app
 * @param {object} ctx
 */
export function registerCertificateRoutes(app, ctx) {
  const {
    db,
    nowIso,
    parseJson,
    normalizeColumnOrder,
    resolveTemplateSvg,
    requireAuth,
  } = ctx

  // —— 内部帮助函数 ——
  function insertCertificateRows(certId, rows) {
    const ins = db.prepare(
      'INSERT INTO certificate_rows (certificate_id, sort_order, row_data, preset_id) VALUES (?, ?, ?, ?)',
    )
    ;(rows || []).forEach((row, i) => {
      const normalized = normalizeCertificateRowInput(row)
      ins.run(certId, i, JSON.stringify(normalized.row_data), normalized.preset_id)
    })
  }

  function certificateSnapshot(certId) {
    const cert = db.prepare('SELECT * FROM certificates WHERE id = ?').get(certId)
    if (!cert) return null
    const rows = db.prepare(`
      SELECT sort_order, row_data, preset_id FROM certificate_rows WHERE certificate_id = ? ORDER BY sort_order
    `).all(certId)
    return {
      title: cert.title,
      status: cert.status,
      preset_id: cert.preset_id,
      template_id: cert.template_id ?? null,
      table_template_id: cert.table_template_id ?? null,
      group_name: cert.group_name ?? null,
      column_order: parseJson(cert.column_order, null),
      layout_overrides: parseJson(cert.layout_overrides, {}),
      font_scale: cert.font_scale,
      show_layout_boxes: !!cert.show_layout_boxes,
      preview_ui: parseJson(cert.preview_ui, {}),
      rows: rows.map((r) => ({
        sort_order: r.sort_order,
        row_data: parseJson(r.row_data, {}),
        preset_id: r.preset_id != null ? Number(r.preset_id) : null,
      })),
    }
  }

  function saveCertificateRevision(certId, note = null) {
    const snap = certificateSnapshot(certId)
    if (!snap) return
    const maxRev = db.prepare(
      'SELECT COALESCE(MAX(revision_number), 0) AS n FROM certificate_revisions WHERE certificate_id = ?',
    ).get(certId)
    const n = (maxRev?.n || 0) + 1
    db.prepare(`
      INSERT INTO certificate_revisions (certificate_id, revision_number, snapshot, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(certId, n, JSON.stringify(snap), note, nowIso())
  }

  function duplicateCertificate(sourceId, titleOverride = null) {
    const source = db.prepare('SELECT group_name, group_id FROM certificates WHERE id = ?').get(sourceId)
    const snap = certificateSnapshot(sourceId)
    if (!snap) return null
    const title = defaultCopyTitle(getSiteConfig(db), titleOverride || snap.title)
    const ts = nowIso()
    const columnOrder = normalizeColumnOrder(snap.column_order)
    const result = db.prepare(`
      INSERT INTO certificates (title, status, preset_id, template_id, table_template_id, column_order, layout_overrides, font_scale, show_layout_boxes, group_name, group_id, preview_ui, created_at, updated_at)
      VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      snap.preset_id ?? null,
      snap.template_id ?? null,
      snap.table_template_id ?? null,
      columnOrder ? JSON.stringify(columnOrder) : null,
      JSON.stringify(snap.layout_overrides || {}),
      Number(snap.font_scale) || 1,
      snap.show_layout_boxes ? 1 : 0,
      source?.group_name ?? null,
      source?.group_id ?? null,
      JSON.stringify(snap.preview_ui || {}),
      ts,
      ts,
    )
    const id = result.lastInsertRowid
    if (Array.isArray(snap.rows) && snap.rows.length) {
      insertCertificateRows(id, snap.rows)
    }
    saveCertificateRevision(id, '复制')
    return id
  }

  // —— 路由 ——

  app.get('/api/certificates', requireAuth, (c) => {
    const gf = sqlGroupInClause(c.get('principal'))
    const status = c.req.query('status')
    let sql = `SELECT id, title, status, group_name, group_id, preset_id, template_id, table_template_id, public_slug, published_at, updated_at, deleted_at, trashed_from_status FROM certificates WHERE 1=1${gf.clause}`
    const params = [...gf.params]
    if (status === 'trash') {
      sql += " AND deleted_at IS NOT NULL AND TRIM(deleted_at) <> ''"
    } else {
      sql += " AND (deleted_at IS NULL OR TRIM(deleted_at) = '')"
      if (status && status !== 'all') {
        sql += ' AND status = ?'
        params.push(status)
      }
    }
    sql += ' ORDER BY updated_at DESC'
    const rows = db.prepare(sql).all(...params)
    attachSearchTextToCertificates(db, rows)
    return c.json({ certificates: rows })
  })

  app.post('/api/certificates', requireAuth, async (c) => {
    const principal = c.get('principal')
    const body = await c.req.json().catch(() => ({}))
    const title = String(body.title || defaultUntitledTitle(getSiteConfig(db))).trim()
    const normalizedRows = Array.isArray(body.rows)
      ? body.rows.map((row) => normalizeCertificateRowInput(row))
      : []
    let groupId = resolveGroupIdForCertificateCreate(db, {
      preset_id: body.preset_id ?? null,
      rows: normalizedRows,
    })
    if (body.group_id != null && body.group_id !== '' && groupId == null) {
      try {
        groupId = resolveGroupIdForCreate(db, principal, body.group_id)
      } catch (err) {
        return c.json({ error: err.message }, 400)
      }
    }
    if (groupId == null) groupId = getUngroupedGroupId(db)
    if (!assertGroupAccess(principal, groupId)) {
      return c.json({ error: '无权在该访问组创建证书' }, 403)
    }
    const presetCheck = validateCertificateRowPresets(db, {
      preset_id: body.preset_id ?? null,
      table_template_id: body.table_template_id ?? null,
      rows: normalizedRows,
    })
    if (!presetCheck.ok) return c.json({ error: presetCheck.error }, 400)
    const groupErr = validateCertificatePresetGroups(db, {
      preset_id: body.preset_id ?? null,
      rows: normalizedRows,
    })
    if (groupErr) return c.json({ error: groupErr }, 400)
    try {
      assertRelatedResourcesInGroups(db, principal, {
        svgTemplateId: body.template_id,
        tableTemplateId: presetCheck.table_template_id ?? body.table_template_id,
        presetId: body.preset_id,
      })
    } catch (err) {
      return c.json({ error: err.message }, 403)
    }
    const ts = nowIso()
    const templateId = body.template_id ?? getDefaultSvgTemplateIdForPrincipal(db, principal) ?? null
    const columnOrder = normalizeColumnOrder(body.column_order)
    const groupName = body.group_name != null ? (String(body.group_name).trim() || null) : null
    const tableTemplateId = presetCheck.table_template_id ?? body.table_template_id ?? null
    let publicSlug = null
    if (body.public_slug !== undefined && body.public_slug !== null && String(body.public_slug).trim() !== '') {
      const slugRes = resolvePublicSlugForWrite(db, body.public_slug, groupId)
      if (slugRes.error) {
        const suggested = suggestPublicCertSlug(title)
        const tried = normalizePublicCertSlug(body.public_slug)
        if (tried === suggested) {
          publicSlug = null
        } else {
          return c.json({ error: slugRes.error }, 400)
        }
      } else {
        publicSlug = slugRes.value ?? null
      }
    } else {
      const suggested = suggestPublicCertSlug(title)
      if (isPublicCertSlugAvailable(db, suggested, groupId)) {
        publicSlug = suggested
      }
    }
    const result = db.prepare(`
      INSERT INTO certificates (title, status, preset_id, template_id, table_template_id, column_order, layout_overrides, font_scale, show_layout_boxes, group_name, group_id, public_slug, preview_ui, created_at, updated_at)
      VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      body.preset_id ?? null,
      templateId,
      tableTemplateId,
      columnOrder ? JSON.stringify(columnOrder) : null,
      JSON.stringify(body.layout_overrides || {}),
      Number(body.font_scale) || 1,
      body.show_layout_boxes ? 1 : 0,
      groupName,
      groupId,
      publicSlug,
      JSON.stringify(body.preview_ui || {}),
      ts,
      ts,
    )
    const id = result.lastInsertRowid
    if (normalizedRows.length) {
      insertCertificateRows(id, normalizedRows)
    }
    syncCertificateAccessGroup(db, id)
    saveCertificateRevision(id, '创建')
    return c.json({ id })
  })

  // 批量操作
  app.post('/api/certificates/batch-delete', requireAuth, async (c) => {
    const principal = c.get('principal')
    const body = await c.req.json().catch(() => ({}))
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((id) => id > 0))]
      : []
    if (!ids.length) {
      const label = getSiteConfig(db).entityLabel
      return c.json({ error: `未指定${label}` }, 400)
    }
    const allowed = ids.filter((id) => getRowInGroups(db, 'certificates', id, principal))
    const tx = db.transaction((list) => {
      for (const id of list) trashCertificate(db, id)
    })
    tx(allowed)
    return c.json({ ok: true, deleted: allowed.length, trashed: allowed.length })
  })

  app.post('/api/certificates/batch-duplicate', requireAuth, async (c) => {
    const principal = c.get('principal')
    const body = await c.req.json().catch(() => ({}))
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((id) => id > 0))]
      : []
    if (!ids.length) {
      const label = getSiteConfig(db).entityLabel
      return c.json({ error: `未指定${label}` }, 400)
    }
    const allowedIds = ids.filter((id) => getRowInGroups(db, 'certificates', id, principal))
    const newIds = []
    const tx = db.transaction((list) => {
      for (const id of list) {
        const newId = duplicateCertificate(id)
        if (newId) newIds.push(newId)
      }
    })
    tx(allowedIds)
    return c.json({ ok: true, ids: newIds, duplicated: newIds.length })
  })

  app.post('/api/certificates/batch-restore', requireAuth, async (c) => {
    const principal = c.get('principal')
    const body = await c.req.json().catch(() => ({}))
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((id) => id > 0))]
      : []
    if (!ids.length) {
      const label = getSiteConfig(db).entityLabel
      return c.json({ error: `未指定${label}` }, 400)
    }
    const allowed = ids.filter((id) => getRowInGroups(db, 'certificates', id, principal))
    try {
      const tx = db.transaction((list) => {
        for (const id of list) restoreCertificate(db, id)
      })
      tx(allowed)
      return c.json({ ok: true, restored: allowed.length })
    } catch (err) {
      return c.json({ error: err.message || '恢复失败' }, 400)
    }
  })

  app.post('/api/certificates/batch-purge', requireAuth, async (c) => {
    const principal = c.get('principal')
    const body = await c.req.json().catch(() => ({}))
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((id) => id > 0))]
      : []
    if (!ids.length) {
      const label = getSiteConfig(db).entityLabel
      return c.json({ error: `未指定${label}` }, 400)
    }
    const gf = sqlGroupInClause(principal)
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT id FROM certificates
      WHERE id IN (${placeholders})
        AND deleted_at IS NOT NULL
        AND TRIM(deleted_at) <> ''${gf.clause}
    `).all(...ids, ...gf.params)
    const trashedIds = rows.map((r) => Number(r.id)).filter((id) => id > 0)
    if (!trashedIds.length) {
      const label = getSiteConfig(db).entityLabel
      const anyAccessible = ids.some((id) => getRowInGroups(db, 'certificates', id, principal))
      const hint = ids.length && !anyAccessible
        ? '部分项目无权操作'
        : anyAccessible
          ? `所选${label}不在回收站中，请刷新列表后重试`
          : `未指定可删除的${label}`
      return c.json({ error: hint }, 400)
    }
    try {
      const tx = db.transaction((list) => {
        for (const id of list) purgeCertificate(db, id)
      })
      tx(trashedIds)
      return c.json({
        ok: true,
        purged: trashedIds.length,
        skipped: ids.length - trashedIds.length,
      })
    } catch (err) {
      return c.json({ error: err.message || '永久删除失败' }, 400)
    }
  })

  app.get('/api/certificates/public-slug/check', requireAuth, (c) => {
    const principal = c.get('principal')
    const rawSlug = c.req.query('slug') ?? ''
    let groupId = c.req.query('group_id') != null && c.req.query('group_id') !== ''
      ? Number(c.req.query('group_id'))
      : null
    const excludeId = c.req.query('exclude_id') != null && c.req.query('exclude_id') !== ''
      ? Number(c.req.query('exclude_id'))
      : null
    if (excludeId && Number.isFinite(excludeId)) {
      const cert = getRowInGroups(db, 'certificates', excludeId, principal)
      if (cert?.group_id != null) groupId = Number(cert.group_id)
    }
    if (!groupId || !Number.isFinite(groupId)) {
      groupId = getUngroupedGroupId(db)
    }
    const slugRes = resolvePublicSlugForWrite(db, rawSlug, groupId, excludeId || null)
    if (slugRes.error) {
      return c.json({ available: false, slug: null, error: slugRes.error })
    }
    if (slugRes.value == null) {
      return c.json({ available: true, slug: null, error: null })
    }
    return c.json({ available: true, slug: slugRes.value, error: null })
  })

  app.get('/api/certificates/:id', requireAuth, (c) => {
    const id = Number(c.req.param('id'))
    const cert = getRowInGroups(db, 'certificates', id, c.get('principal'))
    if (!cert) return c.json({ error: '未找到' }, 404)
    const snap = certificateSnapshot(id)
    return c.json({
      certificate: {
        id: cert.id,
        title: cert.title,
        status: cert.status,
        deleted_at: cert.deleted_at ?? null,
        trashed_from_status: cert.trashed_from_status ?? null,
        group_id: cert.group_id != null ? Number(cert.group_id) : null,
        public_slug: cert.public_slug ?? null,
        preset_id: cert.preset_id,
        template_id: cert.template_id,
        table_template_id: cert.table_template_id,
        published_at: cert.published_at,
        created_at: cert.created_at,
        updated_at: cert.updated_at,
        ...snap,
      },
    })
  })

  app.put('/api/certificates/:id', requireAuth, async (c) => {
    const principal = c.get('principal')
    const id = Number(c.req.param('id'))
    const prev = getRowInGroups(db, 'certificates', id, principal)
    if (!prev) return c.json({ error: '未找到' }, 404)
    try {
      assertCertificateNotTrashed(prev)
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }

    const body = await c.req.json()
    const normalizedRows = Array.isArray(body.rows)
      ? body.rows.map((row) => normalizeCertificateRowInput(row))
      : null
    const existingRowPresets = db.prepare(`
      SELECT preset_id FROM certificate_rows WHERE certificate_id = ? ORDER BY sort_order
    `).all(id)
    const rowsForValidation = normalizedRows ?? existingRowPresets
    const nextPresetId = body.preset_id !== undefined ? body.preset_id : prev.preset_id
    const nextTemplateId = body.template_id !== undefined ? body.template_id : prev.template_id
    const nextTableTemplateId = body.table_template_id !== undefined ? body.table_template_id : prev.table_template_id

    const presetCheck = validateCertificateRowPresets(db, {
      preset_id: nextPresetId ?? null,
      table_template_id: nextTableTemplateId ?? null,
      rows: rowsForValidation,
    })
    if (!presetCheck.ok) return c.json({ error: presetCheck.error }, 400)

    const groupErr = validateCertificatePresetGroups(db, {
      preset_id: nextPresetId ?? null,
      rows: rowsForValidation,
    })
    if (groupErr) return c.json({ error: groupErr }, 400)

    const resourceCheck = validateCertificateForeignResources(db, {
      template_id: nextTemplateId ?? null,
      table_template_id: nextTableTemplateId ?? null,
    })
    if (!resourceCheck.ok) return c.json({ error: resourceCheck.error }, 400)

    try {
      assertRelatedResourcesInGroups(db, principal, {
        svgTemplateId: nextTemplateId,
        tableTemplateId: presetCheck.table_template_id ?? nextTableTemplateId,
        presetId: nextPresetId,
      })
    } catch (err) {
      const status = String(err.message || '').includes('不存在') ? 400 : 403
      return c.json({ error: err.message }, status)
    }

    const ts = nowIso()
    const title = body.title != null ? String(body.title).trim() : undefined

    try {
      if (title != null) {
        db.prepare('UPDATE certificates SET title = ?, updated_at = ? WHERE id = ?').run(title, ts, id)
      }
      if (body.preset_id !== undefined) {
        db.prepare('UPDATE certificates SET preset_id = ?, updated_at = ? WHERE id = ?').run(body.preset_id, ts, id)
      }
      if (body.template_id !== undefined) {
        db.prepare('UPDATE certificates SET template_id = ?, updated_at = ? WHERE id = ?')
          .run(body.template_id, ts, id)
      }
      if (body.table_template_id !== undefined) {
        db.prepare('UPDATE certificates SET table_template_id = ?, updated_at = ? WHERE id = ?')
          .run(body.table_template_id, ts, id)
      } else if (presetCheck.table_template_id && Array.isArray(body.rows)) {
        db.prepare('UPDATE certificates SET table_template_id = ?, updated_at = ? WHERE id = ?')
          .run(presetCheck.table_template_id, ts, id)
      }
      if (body.column_order !== undefined) {
        const columnOrder = normalizeColumnOrder(body.column_order)
        db.prepare('UPDATE certificates SET column_order = ?, updated_at = ? WHERE id = ?')
          .run(columnOrder ? JSON.stringify(columnOrder) : null, ts, id)
      }
      if (body.layout_overrides != null) {
        db.prepare('UPDATE certificates SET layout_overrides = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(body.layout_overrides), ts, id)
      }
      if (body.font_scale != null) {
        db.prepare('UPDATE certificates SET font_scale = ?, updated_at = ? WHERE id = ?')
          .run(Number(body.font_scale), ts, id)
      }
      if (body.show_layout_boxes != null) {
        db.prepare('UPDATE certificates SET show_layout_boxes = ?, updated_at = ? WHERE id = ?')
          .run(body.show_layout_boxes ? 1 : 0, ts, id)
      }
      if (body.group_name !== undefined) {
        const groupName = String(body.group_name || '').trim() || null
        db.prepare('UPDATE certificates SET group_name = ?, updated_at = ? WHERE id = ?')
          .run(groupName, ts, id)
      }
      if (body.preview_ui != null) {
        db.prepare('UPDATE certificates SET preview_ui = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(body.preview_ui || {}), ts, id)
      }
      if (body.public_slug !== undefined) {
        const slugRows = normalizedRows ?? existingRowPresets
        const groupId = resolveCertificateAccessGroupId(db, {
          preset_id: nextPresetId,
          rows: slugRows,
        }) ?? prev.group_id ?? getUngroupedGroupId(db)
        const slugRes = resolvePublicSlugForWrite(db, body.public_slug, groupId, id)
        if (slugRes.error) return c.json({ error: slugRes.error }, 400)
        db.prepare('UPDATE certificates SET public_slug = ?, updated_at = ? WHERE id = ?')
          .run(slugRes.value ?? null, ts, id)
      }

      if (normalizedRows) {
        db.prepare('DELETE FROM certificate_rows WHERE certificate_id = ?').run(id)
        insertCertificateRows(id, normalizedRows)
      }

      saveCertificateRevision(id, body.revision_note || '保存')
      syncCertificateAccessGroup(db, id)
    } catch (err) {
      if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || err?.code === 'SQLITE_CONSTRAINT_TRIGGER') {
        return c.json({ error: '关联资源不存在，无法保存（请检查布局模板、SVG 或表格模板）' }, 400)
      }
      throw err
    }
    return c.json({ ok: true })
  })

  app.post('/api/certificates/:id/publish', requireAuth, (c) => {
    const id = Number(c.req.param('id'))
    const cert = getRowInGroups(db, 'certificates', id, c.get('principal'))
    if (!cert) return c.json({ error: '未找到' }, 404)
    try {
      assertCertificateNotTrashed(cert, '发布')
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }
    const ts = nowIso()
    const previewUi = parseJson(cert.preview_ui, {})
    const snapRows = certificateSnapshot(id)?.rows || []
    const groupErr = validateCertificatePresetGroups(db, {
      preset_id: cert.preset_id ?? null,
      rows: snapRows,
    })
    if (groupErr) return c.json({ error: groupErr }, 400)
    const presetBundlesRaw = buildCertificatePresetBundles(db, cert, snapRows)
    for (const bundle of Object.values(presetBundlesRaw)) {
      if (bundle?.svg_template_id) {
        bundle.template_svg = resolveTemplateSvg(bundle.svg_template_id)
      }
    }
    previewUi.public_snapshot = {
      ...buildCertificatePublicSnapshot(db, cert),
      preset_bundles: presetBundlesRaw,
    }
    db.prepare(`
      UPDATE certificates SET status = 'published', published_at = ?, updated_at = ?, preview_ui = ? WHERE id = ?
    `).run(ts, ts, JSON.stringify(previewUi), id)
    const accessGroupId = syncPublishedCertificateAccessGroup(db, id)
    saveCertificateRevision(id, '发布')
    return c.json({
      ok: true,
      published_at: ts,
      group_id: accessGroupId != null ? Number(accessGroupId) : null,
    })
  })

  app.post('/api/certificates/:id/unpublish', requireAuth, (c) => {
    const id = Number(c.req.param('id'))
    const cert = getRowInGroups(db, 'certificates', id, c.get('principal'))
    if (!cert) return c.json({ error: '未找到' }, 404)
    try {
      assertCertificateNotTrashed(cert, '撤回发布')
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }
    const ts = nowIso()
    db.prepare(`
      UPDATE certificates SET status = 'draft', published_at = NULL, updated_at = ? WHERE id = ?
    `).run(ts, id)
    saveCertificateRevision(id, '撤回发布')
    return c.json({ ok: true })
  })

  app.post('/api/certificates/:id/duplicate', requireAuth, async (c) => {
    const id = Number(c.req.param('id'))
    const cert = getRowInGroups(db, 'certificates', id, c.get('principal'))
    if (!cert) return c.json({ error: '未找到' }, 404)
    try {
      assertCertificateNotTrashed(cert, '复制')
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }
    const body = await c.req.json().catch(() => ({}))
    const newId = duplicateCertificate(id, body.title)
    if (!newId) return c.json({ error: '未找到' }, 404)
    return c.json({ id: newId })
  })

  app.delete('/api/certificates/:id', requireAuth, (c) => {
    const id = Number(c.req.param('id'))
    const cert = getRowInGroups(db, 'certificates', id, c.get('principal'))
    if (!cert) return c.json({ error: '未找到' }, 404)
    const permanent = c.req.query('permanent') === '1'
    try {
      if (permanent) {
        purgeCertificate(db, id)
      } else {
        trashCertificate(db, id)
      }
    } catch (err) {
      return c.json({ error: err.message || '删除失败' }, 400)
    }
    return c.json({ ok: true, permanent })
  })

  app.post('/api/certificates/:id/restore', requireAuth, (c) => {
    const id = Number(c.req.param('id'))
    if (!getRowInGroups(db, 'certificates', id, c.get('principal'))) {
      return c.json({ error: '未找到' }, 404)
    }
    try {
      restoreCertificate(db, id)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err.message || '恢复失败' }, 400)
    }
  })

  app.get('/api/certificates/:id/revisions', requireAuth, (c) => {
    const id = Number(c.req.param('id'))
    if (!getRowInGroups(db, 'certificates', id, c.get('principal'))) {
      return c.json({ error: '未找到' }, 404)
    }
    const rows = db.prepare(`
      SELECT id, revision_number, note, created_at FROM certificate_revisions
      WHERE certificate_id = ? ORDER BY revision_number DESC LIMIT 50
    `).all(id)
    return c.json({ revisions: rows })
  })

  app.get('/api/certificates/:id/revisions/:revId', requireAuth, (c) => {
    const certId = Number(c.req.param('id'))
    if (!getRowInGroups(db, 'certificates', certId, c.get('principal'))) {
      return c.json({ error: '未找到' }, 404)
    }
    const revId = Number(c.req.param('revId'))
    const row = db.prepare('SELECT snapshot, revision_number, note, created_at FROM certificate_revisions WHERE id = ?').get(revId)
    if (!row) return c.json({ error: '未找到' }, 404)
    return c.json({
      revision: {
        revision_number: row.revision_number,
        note: row.note,
        created_at: row.created_at,
        snapshot: parseJson(row.snapshot, {}),
      },
    })
  })

  app.post('/api/certificates/:id/revisions/:revId/restore', requireAuth, async (c) => {
    const certId = Number(c.req.param('id'))
    if (!getRowInGroups(db, 'certificates', certId, c.get('principal'))) {
      return c.json({ error: '未找到' }, 404)
    }
    const revId = Number(c.req.param('revId'))
    const row = db.prepare('SELECT snapshot FROM certificate_revisions WHERE id = ? AND certificate_id = ?').get(revId, certId)
    if (!row) return c.json({ error: '未找到' }, 404)
    const snap = parseJson(row.snapshot, {})
    const ts = nowIso()

    const columnOrder = normalizeColumnOrder(snap.column_order)
    db.prepare(`
      UPDATE certificates SET title = ?, preset_id = ?, template_id = ?, table_template_id = ?, column_order = ?, layout_overrides = ?, font_scale = ?, show_layout_boxes = ?, preview_ui = ?, updated_at = ?
      WHERE id = ?
    `).run(
      snap.title || '未命名',
      snap.preset_id ?? null,
      snap.template_id ?? null,
      snap.table_template_id ?? null,
      columnOrder ? JSON.stringify(columnOrder) : null,
      JSON.stringify(snap.layout_overrides || {}),
      Number(snap.font_scale) || 1,
      snap.show_layout_boxes ? 1 : 0,
      JSON.stringify(snap.preview_ui || {}),
      ts,
      certId,
    )

    db.prepare('DELETE FROM certificate_rows WHERE certificate_id = ?').run(certId)
    insertCertificateRows(certId, snap.rows || [])

    saveCertificateRevision(certId, `恢复修订 #${revId}`)
    return c.json({ ok: true, certificate: certificateSnapshot(certId) })
  })
}
