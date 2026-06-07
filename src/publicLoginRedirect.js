import { api } from './api/client.js'
import {
  buildPublicLoginHref,
  buildPublicLoginSearch,
  DEFAULT_PUBLIC_LOGIN_SLUG,
  isPublicLoginPathname,
  normalizePublicLoginSlug,
} from './publicLoginPath.js'

/** @type {string | null} */
let cachedSlug = null

/** @returns {Promise<string>} */
export async function resolvePublicLoginSlug() {
  if (cachedSlug == null) {
    await resolvePublicLoginHref('')
  }
  return cachedSlug ?? DEFAULT_PUBLIC_LOGIN_SLUG
}

/**
 * @param {string} [search] 如 ?next=...
 * @returns {Promise<string>}
 */
export async function resolvePublicLoginHref(search = '') {
  try {
    if (cachedSlug == null) {
      const meta = await api.meta()
      cachedSlug = normalizePublicLoginSlug(
        meta.publicLoginPath ?? meta.publicLoginUrl ?? DEFAULT_PUBLIC_LOGIN_SLUG,
      )
    }
  } catch {
    cachedSlug = DEFAULT_PUBLIC_LOGIN_SLUG
  }
  return buildPublicLoginHref(cachedSlug, search)
}

/**
 * @param {string} [returnPath] 登录成功后返回的路径（pathname+search）
 * @returns {Promise<string | null>} 已在登录页则返回 null
 */
export async function redirectToPublicLoginForPath(returnPath = '') {
  const slug = await resolvePublicLoginSlug()
  const current = window.location.pathname
  if (isPublicLoginPathname(slug, current)) return null
  const path = returnPath || `${window.location.pathname}${window.location.search}`
  const search = buildPublicLoginSearch(slug, path)
  window.location.replace(await resolvePublicLoginHref(search))
  return null
}

/** @param {string} [search] */
export async function redirectToPublicLogin(search = '') {
  window.location.replace(await resolvePublicLoginHref(search))
}

export function invalidatePublicLoginHrefCache() {
  cachedSlug = null
}
