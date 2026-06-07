function nowIso() {
  return new Date().toISOString()
}

/**
 * @param {{ deleted_at?: string | null }} cert
 */
export function isCertificateTrashed(cert) {
  const v = cert?.deleted_at
  return v != null && String(v).trim() !== ''
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 */
export function trashCertificate(db, id) {
  const cert = db.prepare('SELECT id, status, deleted_at FROM certificates WHERE id = ?').get(id)
  if (!cert) return false
  if (isCertificateTrashed(cert)) return true
  const ts = nowIso()
  db.prepare(`
    UPDATE certificates
    SET deleted_at = ?, trashed_from_status = ?, updated_at = ?
    WHERE id = ?
  `).run(ts, cert.status, ts, id)
  return true
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 */
export function restoreCertificate(db, id) {
  const cert = db.prepare('SELECT id, deleted_at FROM certificates WHERE id = ?').get(id)
  if (!cert) throw new Error('未找到')
  if (!isCertificateTrashed(cert)) throw new Error('该证书不在回收站中')
  const ts = nowIso()
  db.prepare(`
    UPDATE certificates
    SET deleted_at = NULL, trashed_from_status = NULL, updated_at = ?
    WHERE id = ?
  `).run(ts, id)
  return true
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 */
export function purgeCertificate(db, id) {
  const cert = db.prepare('SELECT id, deleted_at FROM certificates WHERE id = ?').get(id)
  if (!cert) return false
  if (!isCertificateTrashed(cert)) {
    throw new Error('请先将内容移入回收站后再永久删除')
  }
  db.prepare('DELETE FROM certificate_rows WHERE certificate_id = ?').run(id)
  db.prepare('DELETE FROM certificate_revisions WHERE certificate_id = ?').run(id)
  const result = db.prepare(`
    DELETE FROM certificates WHERE id = ? AND deleted_at IS NOT NULL AND TRIM(deleted_at) <> ''
  `).run(id)
  if (result.changes === 0) {
    throw new Error('永久删除失败，该项目可能已不在回收站')
  }
  return true
}

/**
 * @param {{ deleted_at?: string | null }} cert
 * @param {string} [action='编辑']
 */
export function assertCertificateNotTrashed(cert, action = '编辑') {
  if (isCertificateTrashed(cert)) {
    throw new Error(`该证书在回收站中，请先恢复后再${action}`)
  }
}
