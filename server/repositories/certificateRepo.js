/**
 * 证书数据访问层
 * server/repositories/certificateRepo.js
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} groupFilter — { clause, params }
 * @param {'all' | 'draft' | 'published' | 'trash'} [status]
 */
export function listCertificates(db, groupFilter, status = 'all') {
  let sql = `SELECT id, title, status, group_name, group_id, preset_id, template_id, table_template_id, public_slug, published_at, updated_at, deleted_at, trashed_from_status FROM certificates WHERE 1=1${groupFilter.clause}`
  const params = [...groupFilter.params]

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
  return db.prepare(sql).all(...params)
}

export function getCertificateById(db, id, groupFilter) {
  return db.prepare(`
    SELECT * FROM certificates WHERE id = ?${groupFilter.clause}
  `).get(id, ...groupFilter.params)
}

export function createCertificate(db, {
  title, presetId, templateId, tableTemplateId, columnOrder,
  layoutOverrides, fontScale, showLayoutBoxes,
  groupName, groupId, publicSlug, previewUi, ts,
}) {
  return db.prepare(`
    INSERT INTO certificates (title, status, preset_id, template_id, table_template_id, column_order, layout_overrides, font_scale, show_layout_boxes, group_name, group_id, public_slug, preview_ui, created_at, updated_at)
    VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title, presetId ?? null, templateId ?? null, tableTemplateId ?? null,
    columnOrder, layoutOverrides, fontScale, showLayoutBoxes ? 1 : 0,
    groupName, groupId, publicSlug, previewUi, ts, ts,
  )
}

export function updateCertificateFields(db, id, updates, ts) {
  for (const [field, value] of Object.entries(updates)) {
    db.prepare(`UPDATE certificates SET ${field} = ?, updated_at = ? WHERE id = ?`).run(value, ts, id)
  }
}

export function deleteCertificateRows(db, certId) {
  return db.prepare('DELETE FROM certificate_rows WHERE certificate_id = ?').run(certId)
}

export function insertCertificateRow(db, certId, sortOrder, rowData, presetId) {
  return db.prepare(
    'INSERT INTO certificate_rows (certificate_id, sort_order, row_data, preset_id) VALUES (?, ?, ?, ?)',
  ).run(certId, sortOrder, rowData, presetId)
}

export function getCertificateRows(db, certId) {
  return db.prepare(`
    SELECT sort_order, row_data, preset_id FROM certificate_rows
    WHERE certificate_id = ? ORDER BY sort_order
  `).all(certId)
}

export function getCertificateRevisionCount(db, certId) {
  const row = db.prepare(
    'SELECT COALESCE(MAX(revision_number), 0) AS n FROM certificate_revisions WHERE certificate_id = ?',
  ).get(certId)
  return row?.n || 0
}

export function insertCertificateRevision(db, certId, revisionNumber, snapshot, note, ts) {
  return db.prepare(`
    INSERT INTO certificate_revisions (certificate_id, revision_number, snapshot, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(certId, revisionNumber, JSON.stringify(snapshot), note, ts)
}

export function listCertificateRevisions(db, certId) {
  return db.prepare(`
    SELECT id, revision_number, note, created_at FROM certificate_revisions
    WHERE certificate_id = ? ORDER BY revision_number DESC LIMIT 50
  `).all(certId)
}

export function getCertificateRevisionById(db, revId) {
  return db.prepare(
    'SELECT snapshot, revision_number, note, created_at FROM certificate_revisions WHERE id = ?',
  ).get(revId)
}

export function getRevisionByCertAndRev(db, certId, revId) {
  return db.prepare(
    'SELECT snapshot FROM certificate_revisions WHERE id = ? AND certificate_id = ?',
  ).get(revId, certId)
}

export function getCertificateGroupInfo(db, certId) {
  return db.prepare('SELECT group_name, group_id FROM certificates WHERE id = ?').get(certId)
}

export function publishCertificate(db, id, ts, previewUi) {
  return db.prepare(`
    UPDATE certificates SET status = 'published', published_at = ?, updated_at = ?, preview_ui = ? WHERE id = ?
  `).run(ts, ts, previewUi, id)
}

export function unpublishCertificate(db, id, ts) {
  return db.prepare(`
    UPDATE certificates SET status = 'draft', published_at = NULL, updated_at = ? WHERE id = ?
  `).run(ts, id)
}
