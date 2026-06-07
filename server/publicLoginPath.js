import {
  DEFAULT_PUBLIC_LOGIN_SLUG,
  normalizePublicLoginSlug,
  validatePublicLoginSlug,
  buildPublicLoginHref,
  isPublicLoginPathname,
  isBlockedDefaultPublicLoginPathname,
} from '../src/publicLoginPath.js'

export {
  DEFAULT_PUBLIC_LOGIN_SLUG,
  normalizePublicLoginSlug,
  validatePublicLoginSlug,
  buildPublicLoginHref,
  isPublicLoginPathname,
  isBlockedDefaultPublicLoginPathname,
} from '../src/publicLoginPath.js'

const PUBLIC_LOGIN_PATH_KEY = 'public_login_path'

/** @param {import('better-sqlite3').Database} db */
export function getPublicLoginSlug(db) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(PUBLIC_LOGIN_PATH_KEY)
  if (!row?.value) return DEFAULT_PUBLIC_LOGIN_SLUG
  return normalizePublicLoginSlug(row.value)
}

/** @param {import('better-sqlite3').Database} db */
export function getPublicLoginHref(db, search = '') {
  return buildPublicLoginHref(getPublicLoginSlug(db), search)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} raw
 */
export function savePublicLoginSlug(db, raw) {
  const validated = validatePublicLoginSlug(raw)
  if (!validated.ok) throw new Error(validated.error)
  const slug = validated.slug
  const ts = new Date().toISOString()
  db.prepare(`
    INSERT INTO site_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(PUBLIC_LOGIN_PATH_KEY, slug, ts)
  return slug
}
