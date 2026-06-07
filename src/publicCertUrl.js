/** @typedef {'query' | 'path'} PublicCertUrlStyle */

export const PUBLIC_CERT_URL_STYLES = /** @type {const} */ (['query', 'path'])

/** @param {unknown} raw @returns {PublicCertUrlStyle} */
export function normalizePublicCertUrlStyle(raw) {
  const s = String(raw ?? 'query').trim().toLowerCase()
  return s === 'path' ? 'path' : 'query'
}

/** @param {unknown} raw */
export function normalizePublicCertParam(raw) {
  const s = String(raw ?? 'cert').trim() || 'cert'
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(s) ? s : 'cert'
}

/** @param {unknown} raw */
export function normalizePublicBaseUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    const url = new URL(s.includes('://') ? s : `https://${s}`)
    url.search = ''
    url.hash = ''
    let out = url.toString()
    if (out.endsWith('/') && url.pathname === '/') out = out.slice(0, -1)
    return out
  } catch {
    return ''
  }
}

/** @param {unknown} raw @returns {string | null} */
export function normalizePublicCertSlug(raw) {
  const base = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || null
}

/**
 * @param {unknown} raw
 * @param {number | null | undefined} [certId]
 * @returns {{ ok: true, slug: string | null } | { ok: false, error: string }}
 */
export function validateCustomPublicCertSlug(raw, certId = null) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: true, slug: null }
  }
  const slug = normalizePublicCertSlug(raw)
  if (!slug) return { ok: false, error: '链接后缀无效，请使用字母、数字、连字符' }
  if (/^\d+$/.test(slug)) {
    return { ok: false, error: '自定义后缀不能为纯数字（会与证书编号冲突）' }
  }
  return { ok: true, slug }
}

/**
 * @param {number | string | { id?: number | null, publicSlug?: string | null } | null | undefined} certRef
 * @returns {string}
 */
export function resolvePublicCertUrlSegment(certRef) {
  if (certRef != null && typeof certRef === 'object') {
    const slug = certRef.publicSlug ? normalizePublicCertSlug(certRef.publicSlug) : null
    if (slug && !/^\d+$/.test(slug)) return slug
    const id = Number(certRef.id)
    if (Number.isFinite(id) && id > 0) return String(id)
    if (slug) return slug
    return ''
  }
  if (typeof certRef === 'string' && certRef.trim()) {
    const slug = normalizePublicCertSlug(certRef)
    if (slug) return slug
  }
  const id = Number(certRef)
  return Number.isFinite(id) && id > 0 ? String(id) : ''
}

/**
 * @param {Partial<{ publicBaseUrl?: string, publicCertParam?: string, publicCertUrlStyle?: string }>} cfg
 * @param {number | string | { id?: number | null, publicSlug?: string | null } | null | undefined} certRef
 * @param {string} [fallbackOrigin]
 */
export function buildPublicCertUrl(certRef, cfg = {}, fallbackOrigin = '') {
  const segment = resolvePublicCertUrlSegment(certRef)
  if (!segment) return ''
  const param = normalizePublicCertParam(cfg.publicCertParam)
  const style = normalizePublicCertUrlStyle(cfg.publicCertUrlStyle)
  let base = normalizePublicBaseUrl(cfg.publicBaseUrl)
  if (!base && fallbackOrigin) {
    base = String(fallbackOrigin).replace(/\/$/, '')
  }
  if (!base) {
    return style === 'path' ? `/${param}/${segment}` : `?${param}=${segment}`
  }
  try {
    const url = new URL(base.includes('://') ? base : `https://${base}`)
    if (style === 'path') {
      const prefix = url.pathname.replace(/\/$/, '')
      url.pathname = `${prefix}/${param}/${segment}`
      url.search = ''
      url.hash = ''
    } else {
      url.searchParams.set(param, segment)
    }
    return url.toString()
  } catch {
    return style === 'path' ? `/${param}/${segment}` : `?${param}=${segment}`
  }
}

/**
 * @param {Partial<{ publicCertParam?: string, publicCertUrlStyle?: string }>} cfg
 * @param {string} [href]
 * @returns {string | null}
 */
export function parsePublicCertSegmentFromLocation(cfg = {}, href = undefined) {
  const param = normalizePublicCertParam(cfg.publicCertParam)
  const style = normalizePublicCertUrlStyle(cfg.publicCertUrlStyle)
  const base = typeof href === 'string'
    ? href
    : (typeof window !== 'undefined' ? window.location.href : '')
  if (!base) return null

  let loc
  try {
    loc = new URL(base)
  } catch {
    return null
  }

  const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  if (style === 'path') {
    const m = loc.pathname.match(new RegExp(`/${escaped}/([^/]+)/?$`))
    if (m?.[1]) {
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }
  } else {
    const fromParam = loc.searchParams.get(param)
    if (fromParam != null && fromParam !== '') return fromParam
  }

  if (style !== 'path') {
    const m = loc.pathname.match(new RegExp(`/${escaped}/([^/]+)/?$`))
    if (m?.[1]) {
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }
  }
  if (style === 'path') {
    const fromParam = loc.searchParams.get(param)
    if (fromParam != null && fromParam !== '') return fromParam
  }

  if (param !== 'cert') {
    const legacy = loc.searchParams.get('cert')
    if (legacy != null && legacy !== '') return legacy
  }

  return null
}

/**
 * @param {Partial<{ publicCertParam?: string, publicCertUrlStyle?: string }>} cfg
 * @param {string} [href]
 * @returns {number | null}
 */
export function parseCertIdFromPublicLocation(cfg = {}, href = undefined) {
  const segment = parsePublicCertSegmentFromLocation(cfg, href)
  if (segment == null || segment === '') return null
  const id = Number(segment)
  if (Number.isFinite(id) && id > 0 && String(id) === segment.trim()) return id
  return null
}

/**
 * @param {number | string | { id?: number | null, publicSlug?: string | null }} certRef
 * @param {Partial<{ publicBaseUrl?: string, publicCertParam?: string, publicCertUrlStyle?: string }>} cfg
 * @param {string} [href] 当前页 URL，默认 window.location.href
 * @returns {string}
 */
export function buildPublicCertLocationUrl(certRef, cfg = {}, href = undefined) {
  const built = buildPublicCertUrl(
    certRef,
    cfg,
    typeof window !== 'undefined' ? window.location.origin : '',
  )
  if (!built) return ''
  if (built.startsWith('?')) {
    const base = typeof href === 'string'
      ? href
      : (typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
    const url = new URL(base)
    url.pathname = '/'
    url.search = built
    url.hash = ''
    return url.pathname + url.search
  }
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = new URL(built.includes('://') ? built : `${origin}${built.startsWith('/') ? '' : '/'}${built}`)
    return url.pathname + url.search + url.hash
  } catch {
    return built
  }
}

/**
 * @param {Partial<{ publicCertParam?: string, publicCertUrlStyle?: string }>} cfg
 * @param {string} segment
 * @param {string} [fallbackOrigin]
 * @returns {{ prefix: string, suffix: string }}
 */
export function splitPublicCertUrlSuffix(cfg = {}, segment, fallbackOrigin = '') {
  const url = buildPublicCertUrl(segment || 'preview-segment', cfg, fallbackOrigin)
  const style = normalizePublicCertUrlStyle(cfg.publicCertUrlStyle)
  const param = normalizePublicCertParam(cfg.publicCertParam)
  let label = url
  try {
    const u = new URL(url.includes('://') ? url : `https://${url.replace(/^\?/, 'example.com/?')}`)
    label = `${u.host}${u.pathname}${u.search}${u.hash}`
  } catch {
    label = url.replace(/^https?:\/\//i, '')
  }
  if (style === 'path') {
    const tail = `/${param}/`
    const idx = label.lastIndexOf(tail)
    if (idx >= 0) {
      return {
        prefix: label.slice(0, idx + tail.length),
        suffix: label.slice(idx + tail.length).replace(/\/$/, ''),
      }
    }
    const slash = label.lastIndexOf('/')
    if (slash >= 0) {
      return { prefix: `${label.slice(0, slash + 1)}`, suffix: label.slice(slash + 1) }
    }
  }
  const eq = `${param}=`
  const qIdx = label.indexOf(eq)
  if (qIdx >= 0) {
    return { prefix: label.slice(0, qIdx + eq.length), suffix: label.slice(qIdx + eq.length) }
  }
  return { prefix: '', suffix: segment || '' }
}

/** 仿静态路径中不会作为 publicCertParam 使用的首段（避免误匹配 /api/...） */
const PSEUDO_STATIC_RESERVED_PREFIXES = new Set([
  'api',
  'uploads',
  'font',
  'svg-templates',
  'assets',
  'src',
  'node_modules',
])

/** 是否为仿静态证书路径（供静态服务器 / 开发中间件回退 index） */
export function isPseudoStaticCertPathname(pathname) {
  const p = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'
  const m = p.match(/^\/([^/]+)\/([^/]+)$/)
  if (!m) return false
  const prefix = m[1].toLowerCase()
  if (PSEUDO_STATIC_RESERVED_PREFIXES.has(prefix)) return false
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(m[1]) && /^[a-zA-Z0-9_-]+$/.test(m[2])
}

export function publicCertUrlStyleLabel(style) {
  return normalizePublicCertUrlStyle(style) === 'path'
    ? '路径仿静态 (/cert/9)'
    : '查询参数 (?cert=9)'
}
