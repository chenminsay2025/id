import { api } from './api/client.js'
import {
  buildAdminLoginHref,
  DEFAULT_ADMIN_LOGIN_SLUG,
  normalizeAdminLoginSlug,
} from './adminLoginPath.js'

/** @type {string | null} */
let cachedSlug = null

/**
 * @param {string} [search] 如 ?next=...
 * @returns {Promise<string>}
 */
export async function resolveAdminLoginHref(search = '') {
  try {
    if (cachedSlug == null) {
      const meta = await api.meta()
      cachedSlug = normalizeAdminLoginSlug(meta.adminLoginPath ?? meta.adminLoginUrl ?? DEFAULT_ADMIN_LOGIN_SLUG)
    }
  } catch {
    cachedSlug = DEFAULT_ADMIN_LOGIN_SLUG
  }
  return buildAdminLoginHref(cachedSlug, search)
}

/** @param {string} [search] */
export async function redirectToAdminLogin(search = '') {
  window.location.href = await resolveAdminLoginHref(search)
}

export function invalidateAdminLoginHrefCache() {
  cachedSlug = null
}
