import { normalizePublicCertSlug, validateCustomPublicCertSlug } from '../src/publicCertUrl.js'

export { normalizePublicCertSlug, validateCustomPublicCertSlug }

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string | null | undefined} raw
 * @param {number | null | undefined} groupId
 * @param {number | null | undefined} [excludeCertId]
 */
export function isPublicCertSlugAvailable(db, raw, groupId, excludeCertId = null) {
  const slug = normalizePublicCertSlug(raw)
  if (!slug) return true
  const gid = groupId != null ? Number(groupId) : null
  if (!gid || !Number.isFinite(gid)) return false
  const row = db.prepare(`
    SELECT id FROM certificates
    WHERE public_slug = ? AND group_id = ? AND deleted_at IS NULL
    ${excludeCertId != null ? 'AND id != ?' : ''}
    LIMIT 1
  `).get(
    ...(excludeCertId != null ? [slug, gid, Number(excludeCertId)] : [slug, gid]),
  )
  return !row
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} raw
 * @param {number | null | undefined} groupId
 * @param {number | null | undefined} [certId]
 */
export function resolvePublicSlugForWrite(db, raw, groupId, certId = null) {
  if (raw === undefined) return { value: undefined }
  if (raw === null || raw === '') return { value: null }
  const validated = validateCustomPublicCertSlug(raw, certId)
  if (!validated.ok) return { error: validated.error }
  const slug = validated.slug
  if (!slug) return { value: null }
  if (!isPublicCertSlugAvailable(db, slug, groupId, certId)) {
    return { error: '该链接后缀已被使用，请换一个' }
  }
  return { value: slug }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} ref
 * @param {{ clause: string, params: unknown[] }} gf
 */
export function resolvePublishedCertificateByRef(db, ref, gf) {
  const id = Number(ref)
  if (Number.isFinite(id) && id > 0) {
    return db.prepare(`
      SELECT * FROM certificates
      WHERE id = ? AND status = 'published' AND deleted_at IS NULL${gf.clause}
    `).get(id, ...gf.params)
  }
  const slug = normalizePublicCertSlug(ref)
  if (!slug) return null
  return db.prepare(`
    SELECT * FROM certificates
    WHERE public_slug = ? AND status = 'published' AND deleted_at IS NULL${gf.clause}
  `).get(slug, ...gf.params)
}

/**
 * 目标访问组内可用的 public_slug（与 uniqueSlug 类似，专用于证书外链后缀）
 * @param {import('better-sqlite3').Database} db
 * @param {string} base
 * @param {number} groupId
 * @param {number} excludeCertId
 */
export function uniquePublicCertSlugInGroup(db, base, groupId, excludeCertId) {
  const normalized = normalizePublicCertSlug(base) || 'cert'
  const candidates = [
    normalized,
    `${normalized}-${excludeCertId}`,
    ...Array.from({ length: 48 }, (_, i) => `${normalized}-${i + 2}`),
  ]
  for (const candidate of candidates) {
    if (isPublicCertSlugAvailable(db, candidate, groupId, excludeCertId)) return candidate
  }
  return `${normalized}-${excludeCertId}-${Date.now()}`
}

/**
 * 写入证书的 group_id；若目标组内 public_slug 冲突则自动改后缀，避免 UNIQUE 导致迁移/启动失败
 * @param {import('better-sqlite3').Database} db
 * @param {number} certId
 * @param {number} targetGroupId
 * @returns {{ groupId: number, publicSlug: string | null, slugAdjusted: boolean } | undefined}
 */
export function applyCertificateGroupIdChange(db, certId, targetGroupId) {
  const cert = db.prepare(`
    SELECT id, group_id, public_slug FROM certificates WHERE id = ? AND deleted_at IS NULL
  `).get(certId)
  if (!cert) return undefined

  const targetGid = Number(targetGroupId)
  if (!Number.isFinite(targetGid) || targetGid <= 0) return undefined

  const currentGid = cert.group_id != null ? Number(cert.group_id) : null
  const previousSlug = cert.public_slug ? normalizePublicCertSlug(cert.public_slug) : null
  let nextSlug = previousSlug

  if (currentGid === targetGid) {
    return { groupId: targetGid, publicSlug: nextSlug, slugAdjusted: false }
  }

  let slugAdjusted = false
  if (nextSlug && !isPublicCertSlugAvailable(db, nextSlug, targetGid, certId)) {
    nextSlug = uniquePublicCertSlugInGroup(db, nextSlug, targetGid, certId)
    slugAdjusted = true
  }

  const ts = new Date().toISOString()
  db.prepare(`
    UPDATE certificates SET group_id = ?, public_slug = ?, updated_at = ? WHERE id = ?
  `).run(targetGid, nextSlug, ts, certId)

  return { groupId: targetGid, publicSlug: nextSlug, slugAdjusted }
}

/** @param {string} [title] */
export function suggestPublicCertSlug(title) {
  return normalizePublicCertSlug(title) || 'cert'
}
