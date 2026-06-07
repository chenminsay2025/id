import {
  DEFAULT_ADMIN_LOGIN_SLUG,
  normalizeAdminLoginSlug,
  validateAdminLoginSlug,
  buildAdminLoginHref,
  isAdminLoginPathname,
  isBlockedDefaultAdminLoginPathname,
} from '../src/adminLoginPath.js'

export {
  DEFAULT_ADMIN_LOGIN_SLUG,
  normalizeAdminLoginSlug,
  validateAdminLoginSlug,
  buildAdminLoginHref,
  isAdminLoginPathname,
  isBlockedDefaultAdminLoginPathname,
} from '../src/adminLoginPath.js'

const ADMIN_LOGIN_PATH_KEY = 'admin_login_path'

/** @param {import('better-sqlite3').Database} db */
export function getAdminLoginSlug(db) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(ADMIN_LOGIN_PATH_KEY)
  if (!row?.value) return DEFAULT_ADMIN_LOGIN_SLUG
  return normalizeAdminLoginSlug(row.value)
}

/** @param {import('better-sqlite3').Database} db */
export function getAdminLoginHref(db, search = '') {
  return buildAdminLoginHref(getAdminLoginSlug(db), search)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} raw
 */
export function saveAdminLoginSlug(db, raw) {
  const validated = validateAdminLoginSlug(raw)
  if (!validated.ok) throw new Error(validated.error)
  const slug = validated.slug
  const ts = new Date().toISOString()
  db.prepare(`
    INSERT INTO site_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(ADMIN_LOGIN_PATH_KEY, slug, ts)
  return slug
}
