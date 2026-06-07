/** @typedef {{ ok: true, slug: string } | { ok: false, error: string }} AdminLoginPathValidation */

export const DEFAULT_ADMIN_LOGIN_SLUG = 'login'

/** 不可作为后台登录路径的首段（与公开路由、静态资源冲突） */
export const ADMIN_LOGIN_PATH_RESERVED = new Set([
  'api',
  'uploads',
  'font',
  'svg-templates',
  'assets',
  'src',
  'node_modules',
  'admin',
  'install',
  'viewer',
  'login',
  'public-login',
  'templates',
  'table-templates',
  'layout-presets',
  'fonts',
  'index',
  'favicon.ico',
])

/** @param {unknown} raw @returns {string} */
export function normalizeAdminLoginSlug(raw) {
  const trimmed = String(raw ?? '').trim().toLowerCase()
  if (!trimmed || trimmed === 'login' || trimmed === 'login.html') {
    return DEFAULT_ADMIN_LOGIN_SLUG
  }
  const slug = trimmed
    .replace(/^\/+|\/+$|\.html$/gi, '')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48)
  return slug || DEFAULT_ADMIN_LOGIN_SLUG
}

/** @param {unknown} raw @returns {AdminLoginPathValidation} */
export function validateAdminLoginSlug(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed || trimmed.toLowerCase() === 'login' || trimmed.toLowerCase() === 'login.html') {
    return { ok: true, slug: DEFAULT_ADMIN_LOGIN_SLUG }
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/^\/+|\/+$|\.html$/gi, '')
    .replace(/[^a-z0-9_-]/g, '')
  if (!slug) {
    return { ok: false, error: '路径无效，请使用字母、数字、连字符或下划线' }
  }
  if (slug.length < 2) {
    return { ok: false, error: '自定义路径至少 2 个字符' }
  }
  if (slug.length > 48) {
    return { ok: false, error: '自定义路径过长（最多 48 个字符）' }
  }
  if (ADMIN_LOGIN_PATH_RESERVED.has(slug)) {
    return { ok: false, error: `「${slug}」为系统保留路径，请换一个` }
  }
  if (/^\d+$/.test(slug)) {
    return { ok: false, error: '路径不能为纯数字' }
  }
  return { ok: true, slug }
}

/** @param {string} slug */
export function isDefaultAdminLoginSlug(slug) {
  return normalizeAdminLoginSlug(slug) === DEFAULT_ADMIN_LOGIN_SLUG
}

/**
 * @param {string} slug
 * @param {string} [pathname]
 */
export function isAdminLoginPathname(slug, pathname) {
  const p = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'
  const normalized = normalizeAdminLoginSlug(slug)
  if (isDefaultAdminLoginSlug(normalized)) {
    return p === '/login.html' || p === '/login'
  }
  return p === `/${normalized}` || p === `/${normalized}.html`
}

/**
 * @param {string} slug
 * @param {string} [pathname]
 */
export function isBlockedDefaultAdminLoginPathname(slug, pathname) {
  if (isDefaultAdminLoginSlug(slug)) return false
  const p = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'
  return p === '/login.html' || p === '/login'
}

/**
 * @param {string} slug
 * @param {string} [search]
 */
export function buildAdminLoginHref(slug, search = '') {
  const q = search && search.startsWith('?') ? search : (search ? `?${search}` : '')
  if (isDefaultAdminLoginSlug(slug)) return `/login.html${q}`
  return `/${normalizeAdminLoginSlug(slug)}${q}`
}
