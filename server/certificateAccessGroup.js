import { getUngroupedGroupId } from './accessControl.js'
import { applyCertificateGroupIdChange } from './certificatePublicSlug.js'

/**
 * 证书访问组与布局模板所属组绑定。
 * @param {import('better-sqlite3').Database} db
 * @param {number | null | undefined} presetId
 */
export function layoutPresetAccessGroupId(db, presetId) {
  const pid = presetId != null ? Number(presetId) || null : null
  if (!pid) return null
  const row = db.prepare('SELECT group_id FROM layout_presets WHERE id = ?').get(pid)
  return row?.group_id != null ? Number(row.group_id) : null
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null }} cert
 * @param {{ preset_id?: number | null }[]} [rows]
 */
export function resolveCertificateAccessGroupId(db, cert, rows = []) {
  const groupIds = new Set()
  const certPresetId = cert?.preset_id != null ? Number(cert.preset_id) || null : null
  if (certPresetId) {
    const gid = layoutPresetAccessGroupId(db, certPresetId)
    if (gid != null) groupIds.add(gid)
  }
  for (const row of rows) {
    const pid = row?.preset_id != null ? Number(row.preset_id) || null : null
    if (!pid) continue
    const gid = layoutPresetAccessGroupId(db, pid)
    if (gid != null) groupIds.add(gid)
  }
  if (groupIds.size === 1) return [...groupIds][0]
  if (groupIds.size === 0) return null
  return null
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, rows?: { preset_id?: number | null }[] }} input
 * @returns {string | null}
 */
export function validateCertificatePresetGroups(db, input) {
  const groupIds = new Set()
  const collect = (presetId) => {
    const gid = layoutPresetAccessGroupId(db, presetId)
    if (gid != null) groupIds.add(gid)
  }
  if (input.preset_id) collect(Number(input.preset_id))
  for (const row of input.rows || []) {
    if (row?.preset_id) collect(Number(row.preset_id))
  }
  if (groupIds.size > 1) {
    return '不同访问组的布局模板不能在同一张证书表格中使用，请分开创建证书。'
  }
  return null
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} certId
 */
export function syncCertificateAccessGroup(db, certId) {
  const cert = db.prepare('SELECT id, status, preset_id, group_id FROM certificates WHERE id = ?').get(certId)
  if (!cert) return undefined
  const rows = db.prepare(`
    SELECT preset_id FROM certificate_rows WHERE certificate_id = ? ORDER BY sort_order
  `).all(certId)
  const nextGroupId = resolveCertificateAccessGroupId(db, cert, rows)
  const fallback = getUngroupedGroupId(db)
  const targetGroupId = nextGroupId ?? fallback
  if (targetGroupId == null) return undefined
  if (Number(cert.group_id) === targetGroupId) return targetGroupId
  const applied = applyCertificateGroupIdChange(db, certId, targetGroupId)
  if (applied?.slugAdjusted) {
    console.warn(
      `[cat] 证书 #${certId} 同步访问组时已调整 public_slug 为「${applied.publicSlug}」（避免与同组链接后缀冲突）`,
    )
  }
  return targetGroupId
}

export function resolvePublishedCertificateAccessGroupId(db, cert, rows = []) {
  return resolveCertificateAccessGroupId(db, cert, rows)
}

/**
 * 新建证书写入前解析访问组（与 syncCertificateAccessGroup 逻辑一致）
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, rows?: { preset_id?: number | null }[] }} input
 */
export function resolveGroupIdForCertificateCreate(db, input) {
  const fromPresets = resolveCertificateAccessGroupId(db, input)
  if (fromPresets != null) return fromPresets
  return getUngroupedGroupId(db)
}

export function syncPublishedCertificateAccessGroup(db, certId) {
  const cert = db.prepare('SELECT id, status FROM certificates WHERE id = ?').get(certId)
  if (!cert || cert.status !== 'published') return undefined
  return syncCertificateAccessGroup(db, certId)
}

export function backfillPublishedCertificateAccessGroups(db) {
  const published = db.prepare(`SELECT id FROM certificates WHERE status = 'published'`).all()
  for (const { id } of published) {
    syncCertificateAccessGroup(db, id)
  }
}
