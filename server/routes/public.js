/**
 * server/routes/public.js
 * 公众页 API（已发布证书浏览）
 */

import { resolvePublishedCertificateByRef } from '../certificatePublicSlug.js'
import { buildCertificatePublicSnapshot, resolveCertificatePublicSnapshot, resolveCertificateTemplateId } from '../certificateAdornments.js'
import { buildCertificatePresetBundles } from '../certificateRowPresets.js'
import { sqlPublicGroupInClause } from '../accessControl.js'
import { resolvePublicSession } from '../auth.js'
import { attachTableSearchTextToCertificates } from '../certificateSearch.js'
import { readSvgTemplateFile } from '../svgTemplateFiles.js'
import { normalizePageSizeMm } from '../../src/pageSize.js'

/**
 * @param {import('hono').Hono} app
 * @param {object} ctx
 */
export function registerPublicRoutes(app, ctx) {
  const { db, JWT_SECRET, requireVisitorAuth, resolveTemplateSvg, projectRoot } = ctx

  app.get('/api/public/certificates', requireVisitorAuth, (c) => {
    const gf = sqlPublicGroupInClause(c.get('visitorPrincipal'), c.get('publicAdminPrincipal'))
    const rows = db.prepare(`
      SELECT id, title, group_id, public_slug, published_at, updated_at FROM certificates
      WHERE status = 'published' AND deleted_at IS NULL${gf.clause}
      ORDER BY published_at DESC
    `).all(...gf.params)
    attachTableSearchTextToCertificates(db, rows)
    return c.json({
      certificates: rows.map((row) => ({
        ...row,
        group_id: row.group_id != null ? Number(row.group_id) : null,
      })),
    })
  })

  app.get('/api/public/certificates/by-slug/:slug', requireVisitorAuth, (c) => {
    const gf = sqlPublicGroupInClause(c.get('visitorPrincipal'), c.get('publicAdminPrincipal'))
    const cert = resolvePublishedCertificateByRef(db, c.req.param('slug'), gf)
    if (!cert) return c.json({ error: '未找到或未发布' }, 404)
    return c.json({
      id: cert.id,
      public_slug: cert.public_slug ?? null,
      title: cert.title,
      group_id: cert.group_id != null ? Number(cert.group_id) : null,
    })
  })

  app.get('/api/public/certificates/:id/render-snapshot', requireVisitorAuth, (c) => {
    const gf = sqlPublicGroupInClause(c.get('visitorPrincipal'), c.get('publicAdminPrincipal'))
    const cert = resolvePublishedCertificateByRef(db, c.req.param('id'), gf)
    if (!cert) return c.json({ error: '未找到或未发布' }, 404)
    return c.json({ snapshot: buildCertificatePublicSnapshot(db, cert) })
  })

  app.get('/api/public/templates/:id/file', requireVisitorAuth, (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: '无效模板 ID' }, 400)
    const gf = sqlPublicGroupInClause(c.get('visitorPrincipal'), c.get('publicAdminPrincipal'))
    const row = db.prepare(`
      SELECT file_path, svg_content FROM svg_templates WHERE id = ?${gf.clause}
    `).get(id, ...gf.params)
    if (!row) return c.json({ error: '未找到' }, 404)
    const content = row.file_path
      ? readSvgTemplateFile(projectRoot, row.file_path)
      : (row.svg_content || null)
    if (!content || !content.includes('<svg')) {
      return c.json({ error: '模板文件不存在' }, 404)
    }
    return c.body(content, 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    })
  })

  app.get('/api/public/certificates/:id', requireVisitorAuth, (c) => {
    const gf = sqlPublicGroupInClause(c.get('visitorPrincipal'), c.get('publicAdminPrincipal'))
    const cert = resolvePublishedCertificateByRef(db, c.req.param('id'), gf)
    if (!cert) return c.json({ error: '未找到或未发布' }, 404)
    const includeSvg = c.req.query('include_svg') !== '0'
    const id = cert.id
    const snap = ctx.certificateSnapshot(id)
    const defaultTemplateId = resolveCertificateTemplateId(db, cert)
    const templateSvg = includeSvg ? resolveTemplateSvg(defaultTemplateId) : null
    const publicSnap = resolveCertificatePublicSnapshot(db, cert)
    const presetBundles = buildCertificatePresetBundles(db, cert, snap?.rows || [])
    if (includeSvg) {
      for (const bundle of Object.values(presetBundles)) {
        if (bundle?.svg_template_id) {
          bundle.template_svg = resolveTemplateSvg(bundle.svg_template_id)
        }
      }
    }
    const defaultPresetId = cert.preset_id != null ? Number(cert.preset_id) : null
    const defaultBundle = defaultPresetId ? presetBundles[String(defaultPresetId)] : null
    const pageSize = normalizePageSizeMm(
      defaultBundle?.page_width_mm ?? null,
      defaultBundle?.page_height_mm ?? null,
    )
    return c.json({
      certificate: {
        id: cert.id,
        title: cert.title,
        public_slug: cert.public_slug ?? null,
        group_id: cert.group_id != null ? Number(cert.group_id) : null,
        published_at: cert.published_at,
        template_id: defaultTemplateId,
        template_svg: includeSvg ? (defaultBundle?.template_svg || templateSvg) : null,
        page_width_mm: pageSize.pageWidthMm,
        page_height_mm: pageSize.pageHeightMm,
        merged_layout_overrides: publicSnap.merged_layout_overrides,
        sample_adornments: publicSnap.sample_adornments,
        preset_custom_samples: publicSnap.preset_custom_samples,
        table_template_columns: publicSnap.table_template_columns,
        preset_bundles: presetBundles,
        ...snap,
        merged_layout_overrides: publicSnap.merged_layout_overrides,
        sample_adornments: publicSnap.sample_adornments,
        preset_custom_samples: publicSnap.preset_custom_samples,
        table_template_columns: publicSnap.table_template_columns,
      },
    })
  })
}
