/** @typedef {{ ok: true, slug: string } | { ok: false, error: string }} PublicLoginPathValidation */

export const DEFAULT_PUBLIC_LOGIN_SLUG = 'public-login'

/** 不可作为前端登录路径的首段（与公开路由、静态资源冲突） */
export const PUBLIC_LOGIN_PATH_RESERVED = new Set([
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
export function normalizePublicLoginSlug(raw) {
  const trimmed = String(raw ?? '').trim().toLowerCase()
  if (!trimmed || trimmed === 'public-login' || trimmed === 'public-login.html') {
    return DEFAULT_PUBLIC_LOGIN_SLUG
  }
  const slug = trimmed
    .replace(/^\/+|\/+$|\.html$/gi, '')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48)
  return slug || DEFAULT_PUBLIC_LOGIN_SLUG
}

/** @param {unknown} raw @returns {PublicLoginPathValidation} */
export function validatePublicLoginSlug(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed || trimmed.toLowerCase() === 'public-login' || trimmed.toLowerCase() === 'public-login.html') {
    return { ok: true, slug: DEFAULT_PUBLIC_LOGIN_SLUG }
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
  if (PUBLIC_LOGIN_PATH_RESERVED.has(slug)) {
    return { ok: false, error: `「${slug}」为系统保留路径，请换一个` }
  }
  if (/^\d+$/.test(slug)) {
    return { ok: false, error: '路径不能为纯数字' }
  }
  return { ok: true, slug }
}

/** @param {string} slug */
export function isDefaultPublicLoginSlug(slug) {
  return normalizePublicLoginSlug(slug) === DEFAULT_PUBLIC_LOGIN_SLUG
}

/**
 * @param {string} slug
 * @param {string} [pathname]
 */
export function isPublicLoginPathname(slug, pathname) {
  const p = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'
  const normalized = normalizePublicLoginSlug(slug)
  if (isDefaultPublicLoginSlug(normalized)) {
    return p === '/public-login.html' || p === '/public-login'
  }
  return p === `/${normalized}` || p === `/${normalized}.html`
}

/**
 * @param {string} slug
 * @param {string} [pathname]
 */
export function isBlockedDefaultPublicLoginPathname(slug, pathname) {
  if (isDefaultPublicLoginSlug(slug)) return false
  const p = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'
  return p === '/public-login.html' || p === '/public-login'
}

/**
 * @param {string} slug
 * @param {string} [search]
 */
export function buildPublicLoginHref(slug, search = '') {
  const q = search && search.startsWith('?') ? search : (search ? `?${search}` : '')
  if (isDefaultPublicLoginSlug(slug)) return `/public-login.html${q}`
  return `/${normalizePublicLoginSlug(slug)}.html${q}`
}

/**
 * 登录成功后跳转：若 next 指向登录页本身则回首页
 * @param {unknown} nextRaw
 * @param {string} slug
 */
export function sanitizePublicLoginNext(nextRaw, slug) {
  const normalized = normalizePublicLoginSlug(slug)
  const raw = String(nextRaw ?? '').trim()
  if (!raw || raw === '/') return '/'
  let pathname = raw
  try {
    pathname = raw.startsWith('/')
      ? raw.split('?')[0]
      : new URL(raw, window.location.origin).pathname
  } catch {
    pathname = raw.split('?')[0]
    if (!pathname.startsWith('/')) pathname = `/${pathname}`
  }
  if (isPublicLoginPathname(normalized, pathname)) return '/'
  return raw.startsWith('/') ? raw : pathname
}

/**
 * @param {string} slug
 * @param {string} returnPath 如 / 或 /cert/1
 */
export function buildPublicLoginSearch(slug, returnPath) {
  const safe = sanitizePublicLoginNext(returnPath, slug)
  if (!safe || safe === '/') return ''
  return `?next=${encodeURIComponent(safe)}`
}
