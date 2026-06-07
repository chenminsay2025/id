import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { loadAdminPrincipal, loadVisitorPrincipal } from './accessControl.js'
import { adminHasModule } from './adminModules.js'

const COOKIE_NAME = 'cat_session'
const VISITOR_COOKIE_NAME = 'cat_visitor_session'

export function getCookieName() {
  return COOKIE_NAME
}

export function getVisitorCookieName() {
  return VISITOR_COOKIE_NAME
}

function secretKey(secret) {
  return new TextEncoder().encode(secret)
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export async function signSession(payload, secret, maxAgeSec = 60 * 60 * 24 * 7) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(secretKey(secret))
}

export async function verifySession(token, secret) {
  const { payload } = await jwtVerify(token, secretKey(secret))
  return payload
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(v.join('='))
  }
  return out
}

export function getTokenFromRequest(req, cookieName = COOKIE_NAME) {
  const cookies = parseCookies(req.headers.get('cookie') || '')
  return cookies[cookieName] || null
}

export function sessionCookie(token, maxAgeSec = 60 * 60 * 24 * 7, cookieName = COOKIE_NAME) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
}

export function clearSessionCookie(cookieName = COOKIE_NAME) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function createAuthMiddleware(db, secret) {
  return async function requireAuth(c, next) {
    const token = getTokenFromRequest(c.req.raw)
    if (!token) {
      return c.json({ error: '未登录' }, 401)
    }
    try {
      const payload = await verifySession(token, secret)
      if (payload.typ === 'visitor') {
        return c.json({ error: '请使用管理端账号登录' }, 401)
      }
      const user = db.prepare('SELECT id, username, role, avatar_path FROM admin_user WHERE id = ?').get(payload.sub)
      if (!user) return c.json({ error: '用户无效' }, 401)
      const principal = loadAdminPrincipal(db, user)
      c.set('user', user)
      c.set('principal', principal)
      await next()
    } catch {
      return c.json({ error: '会话已过期' }, 401)
    }
  }
}

export function createRequireSuperAdmin() {
  return async function requireSuperAdmin(c, next) {
    const principal = c.get('principal')
    if (!principal?.isSuperAdmin) {
      return c.json({ error: '需要超级管理员权限' }, 403)
    }
    await next()
  }
}

export function createRequireModule(moduleKey) {
  return async function requireModule(c, next) {
    const principal = c.get('principal')
    if (!adminHasModule(principal, moduleKey)) {
      return c.json({ error: '无权访问该功能模块' }, 403)
    }
    await next()
  }
}

export function createVisitorAuthMiddleware(db, secret) {
  return async function requireVisitorAuth(c, next) {
    const session = await resolvePublicSession(db, c.req.raw, secret)
    if (!session) {
      return c.json({ error: '未登录' }, 401)
    }
    c.set('visitor', session.visitor)
    c.set('visitorPrincipal', session.principal)
    if (session.adminPrincipal) {
      c.set('publicAdminPrincipal', session.adminPrincipal)
    }
    await next()
  }
}

/**
 * 公众页会话：访客 cookie 或后台 admin cookie（按组过滤证书，超管可见全部）
 * @param {import('better-sqlite3').Database} db
 * @param {Request} req
 * @param {string} secret
 */
export async function resolvePublicSession(db, req, secret) {
  const visitorToken = getTokenFromRequest(req, VISITOR_COOKIE_NAME)
  if (visitorToken) {
    try {
      const payload = await verifySession(visitorToken, secret)
      if (payload.typ === 'visitor') {
        const visitor = db.prepare('SELECT id, username, avatar_path FROM visitor_users WHERE id = ?').get(payload.sub)
        if (visitor) {
          const principal = loadVisitorPrincipal(db, visitor)
          if (principal.groupIds.length) {
            return { type: 'visitor', visitor, principal, adminPrincipal: null }
          }
        }
      }
    } catch {
      /* try admin */
    }
  }

  const adminToken = getTokenFromRequest(req, COOKIE_NAME)
  if (!adminToken) return null
  try {
    const payload = await verifySession(adminToken, secret)
    if (payload.typ === 'visitor') return null
    const user = db.prepare('SELECT id, username, role, avatar_path FROM admin_user WHERE id = ?').get(payload.sub)
    if (!user) return null
    const adminPrincipal = loadAdminPrincipal(db, user)
    const principal = {
      id: adminPrincipal.id,
      username: adminPrincipal.username,
      groupIds: adminPrincipal.groupIds,
    }
    if (!principal.groupIds.length && !adminPrincipal.isSuperAdmin) return null
    return {
      type: 'admin',
      visitor: { id: user.id, username: user.username },
      principal,
      adminPrincipal,
    }
  } catch {
    return null
  }
}

export function formatPublicSessionForClient(session) {
  if (!session) return null
  const base = {
    id: session.principal.id,
    username: session.principal.username,
    group_ids: session.principal.groupIds,
  }
  if (session.type === 'admin') {
    return {
      ...base,
      is_admin: true,
      is_super_admin: !!session.adminPrincipal?.isSuperAdmin,
      avatar_url: session.adminPrincipal?.avatarPath || null,
    }
  }
  return {
    ...base,
    avatar_url: session.principal.avatarPath || null,
  }
}

export function formatUserForClient(principal) {
  return {
    id: principal.id,
    username: principal.username,
    role: principal.role,
    is_super_admin: principal.isSuperAdmin,
    group_ids: principal.groupIds,
    module_keys: principal.moduleKeys || [],
    avatar_url: principal.avatarPath || null,
  }
}

export function formatVisitorForClient(principal) {
  return {
    id: principal.id,
    username: principal.username,
    group_ids: principal.groupIds,
    avatar_url: principal.avatarPath || null,
  }
}

export function seedAdminUser(db, username, password) {
  const existing = db.prepare('SELECT id FROM admin_user LIMIT 1').get()
  if (existing) return false
  const hash = bcrypt.hashSync(password, 10)
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO admin_user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
  ).run(username, hash, 'super_admin', now)
  return true
}
