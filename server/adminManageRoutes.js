import {
  listGroups,
  getGroupById,
  createAccessGroup,
  setUserGroups,
  setVisitorGroups,
  getUserGroupIds,
  getVisitorGroupIds,
  loadVisitorPrincipal,
  isProtectedGroupSlug,
  getUngroupedGroupId,
  ROLES,
  isSuperAdmin,
} from './accessControl.js'
import {
  getUserModuleKeys,
  setUserModuleKeys,
  defaultModuleKeysForNewAdmin,
  ALL_MODULE_KEYS,
} from './adminModules.js'
import {
  dissolveAccessGroup,
  mergeAccessGroups,
  listGroupMergeLogs,
  revertGroupMergeLog,
} from './groupMerge.js'
import { slugify, uniqueSlug } from './db.js'
import {
  hashPassword,
  formatUserForClient,
  formatVisitorForClient,
  getVisitorCookieName,
  sessionCookie,
  clearSessionCookie,
  signSession,
  verifyPassword,
  getTokenFromRequest,
  verifySession,
  resolvePublicSession,
  formatPublicSessionForClient,
} from './auth.js'
import { checkLoginRateLimit, clearLoginRateLimit, getClientIp } from './rateLimit.js'

function nowIso() {
  return new Date().toISOString()
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, secret: string, requireAuth: Function, requireAccessModule: Function }} opts
 */
export function registerAdminManageRoutes(app, { db, secret, requireAuth, requireAccessModule }) {
  // —— 访问组 ——
  app.get('/api/groups', requireAuth, (c) => {
    const principal = c.get('principal')
    let groups = listGroups(db)
    if (!principal.isSuperAdmin) {
      const allowed = new Set(principal.groupIds)
      groups = groups.filter((g) => allowed.has(g.id))
    }
    return c.json({ groups })
  })

  app.post('/api/groups', requireAuth, requireAccessModule, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const name = String(body.name || '').trim()
    if (!name) return c.json({ error: '请填写组名称' }, 400)
    const id = createAccessGroup(db, { name, slug: body.slug })
    const group = getGroupById(db, id)
    const adminId = c.get('user').id
    db.prepare('INSERT OR IGNORE INTO admin_user_groups (user_id, group_id) VALUES (?, ?)').run(adminId, id)
    return c.json({ group })
  })

  app.put('/api/groups/:id', requireAuth, requireAccessModule, async (c) => {
    const id = Number(c.req.param('id'))
    const prev = getGroupById(db, id)
    if (!prev) return c.json({ error: '未找到' }, 404)
    const body = await c.req.json().catch(() => ({}))
    const name = body.name != null ? String(body.name).trim() : prev.name
    let slug = prev.slug
    if (body.slug != null && !isProtectedGroupSlug(prev.slug)) {
      slug = uniqueSlug(db, 'access_groups', body.slug, id)
    }
    const ts = nowIso()
    db.prepare('UPDATE access_groups SET name = ?, slug = ?, updated_at = ? WHERE id = ?').run(name, slug, ts, id)
    return c.json({ group: getGroupById(db, id) })
  })

  app.delete('/api/groups/:id', requireAuth, requireAccessModule, async (c) => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    const mergeIntoId = body.merge_into_id !== undefined ? body.merge_into_id : null
    try {
      const result = dissolveAccessGroup(db, id, { mergeIntoId, recordLog: true })
      return c.json({ ok: true, ...result })
    } catch (err) {
      const msg = err.message || '删除失败'
      const status = msg.includes('未找到') ? 404 : 400
      return c.json({ error: msg }, status)
    }
  })

  app.post('/api/groups/:id/merge', requireAuth, requireAccessModule, async (c) => {
    const fromId = Number(c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    const intoId = Number(body.into_id)
    if (!intoId) return c.json({ error: '请指定合并目标组' }, 400)
    try {
      const result = mergeAccessGroups(db, fromId, intoId)
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err.message || '合并失败' }, 400)
    }
  })

  app.get('/api/groups/merge-history', requireAuth, requireAccessModule, (c) => {
    return c.json({ logs: listGroupMergeLogs(db) })
  })

  app.post('/api/groups/merge-history/:logId/revert', requireAuth, requireAccessModule, (c) => {
    const logId = Number(c.req.param('logId'))
    try {
      const result = revertGroupMergeLog(db, logId)
      return c.json(result)
    } catch (err) {
      return c.json({ error: err.message || '撤销失败' }, 400)
    }
  })

  // —— 管理端用户 ——
  app.get('/api/users', requireAuth, requireAccessModule, (c) => {
    const rows = db.prepare('SELECT id, username, role, created_at FROM admin_user ORDER BY id').all()
    const users = rows.map((u) => ({
      ...u,
      is_super_admin: isSuperAdmin(u.role),
      group_ids: getUserGroupIds(db, u.id),
      module_keys: getUserModuleKeys(db, u.id),
    }))
    return c.json({ users })
  })

  app.post('/api/users', requireAuth, requireAccessModule, async (c) => {
    const editor = c.get('principal')
    const body = await c.req.json().catch(() => ({}))
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!username || !password) return c.json({ error: '请填写用户名和密码' }, 400)
    const exists = db.prepare('SELECT 1 FROM admin_user WHERE username = ?').get(username)
    if (exists) return c.json({ error: '用户名已存在' }, 400)
    const role = body.role === ROLES.SUPER_ADMIN && editor.isSuperAdmin
      ? ROLES.SUPER_ADMIN
      : ROLES.ADMIN
    const hash = await hashPassword(password)
    const ts = nowIso()
    const result = db.prepare(`
      INSERT INTO admin_user (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)
    `).run(username, hash, role, ts)
    const userId = Number(result.lastInsertRowid)
    if (role !== ROLES.SUPER_ADMIN) {
      setUserGroups(db, userId, body.group_ids || [])
      const modules = editor.isSuperAdmin && Array.isArray(body.module_keys)
        ? body.module_keys
        : defaultModuleKeysForNewAdmin()
      setUserModuleKeys(db, userId, modules)
    } else {
      const all = listGroups(db).map((g) => g.id)
      setUserGroups(db, userId, all)
      setUserModuleKeys(db, userId, ALL_MODULE_KEYS)
    }
    return c.json({
      user: {
        id: userId,
        username,
        role,
        is_super_admin: role === ROLES.SUPER_ADMIN,
        group_ids: getUserGroupIds(db, userId),
        module_keys: getUserModuleKeys(db, userId),
      },
    })
  })

  app.put('/api/users/:id', requireAuth, requireAccessModule, async (c) => {
    const editor = c.get('principal')
    const id = Number(c.req.param('id'))
    const prev = db.prepare('SELECT id, username, role FROM admin_user WHERE id = ?').get(id)
    if (!prev) return c.json({ error: '未找到' }, 404)
    const body = await c.req.json().catch(() => ({}))
    if (body.username != null) {
      const username = String(body.username).trim()
      const dup = db.prepare('SELECT id FROM admin_user WHERE username = ? AND id != ?').get(username, id)
      if (dup) return c.json({ error: '用户名已存在' }, 400)
      db.prepare('UPDATE admin_user SET username = ? WHERE id = ?').run(username, id)
    }
    if (body.password) {
      const hash = await hashPassword(String(body.password))
      db.prepare('UPDATE admin_user SET password_hash = ? WHERE id = ?').run(hash, id)
    }
    let role = prev.role
    if (body.role != null) {
      if (body.role === ROLES.SUPER_ADMIN && !editor.isSuperAdmin) {
        return c.json({ error: '仅超级管理员可设置超级管理员角色' }, 403)
      }
      role = body.role === ROLES.SUPER_ADMIN ? ROLES.SUPER_ADMIN : ROLES.ADMIN
      db.prepare('UPDATE admin_user SET role = ? WHERE id = ?').run(role, id)
    }
    if (body.group_ids != null && !isSuperAdmin(role)) {
      setUserGroups(db, id, body.group_ids)
    }
    if (isSuperAdmin(role)) {
      setUserGroups(db, id, listGroups(db).map((g) => g.id))
      setUserModuleKeys(db, id, ALL_MODULE_KEYS)
    } else if (editor.isSuperAdmin && body.module_keys != null) {
      setUserModuleKeys(db, id, body.module_keys)
    }
    const user = db.prepare('SELECT id, username, role, created_at FROM admin_user WHERE id = ?').get(id)
    return c.json({
      user: {
        ...user,
        is_super_admin: isSuperAdmin(user.role),
        group_ids: getUserGroupIds(db, id),
        module_keys: getUserModuleKeys(db, id),
      },
    })
  })

  app.delete('/api/users/:id', requireAuth, requireAccessModule, (c) => {
    const id = Number(c.req.param('id'))
    const me = c.get('user').id
    if (id === me) return c.json({ error: '不能删除当前登录账号' }, 400)
    const count = db.prepare('SELECT COUNT(*) AS n FROM admin_user').get().n
    if (count <= 1) return c.json({ error: '至少保留一个管理员' }, 400)
    db.prepare('DELETE FROM admin_user WHERE id = ?').run(id)
    return c.json({ ok: true })
  })

  // —— 公众页访客账号 ——
  app.get('/api/visitor-users', requireAuth, requireAccessModule, (c) => {
    const rows = db.prepare('SELECT id, username, created_at, updated_at FROM visitor_users ORDER BY id').all()
    const visitors = rows.map((v) => ({
      ...v,
      group_ids: getVisitorGroupIds(db, v.id),
    }))
    return c.json({ visitors })
  })

  app.post('/api/visitor-users', requireAuth, requireAccessModule, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!username || !password) return c.json({ error: '请填写用户名和密码' }, 400)
    const exists = db.prepare('SELECT 1 FROM visitor_users WHERE username = ?').get(username)
    if (exists) return c.json({ error: '用户名已存在' }, 400)
    const hash = await hashPassword(password)
    const ts = nowIso()
    const result = db.prepare(`
      INSERT INTO visitor_users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)
    `).run(username, hash, ts, ts)
    const visitorId = Number(result.lastInsertRowid)
    setVisitorGroups(db, visitorId, body.group_ids || [])
    return c.json({
      visitor: {
        id: visitorId,
        username,
        group_ids: getVisitorGroupIds(db, visitorId),
      },
    })
  })

  app.put('/api/visitor-users/:id', requireAuth, requireAccessModule, async (c) => {
    const id = Number(c.req.param('id'))
    const prev = db.prepare('SELECT id, username FROM visitor_users WHERE id = ?').get(id)
    if (!prev) return c.json({ error: '未找到' }, 404)
    const body = await c.req.json().catch(() => ({}))
    const ts = nowIso()
    if (body.username != null) {
      const username = String(body.username).trim()
      const dup = db.prepare('SELECT id FROM visitor_users WHERE username = ? AND id != ?').get(username, id)
      if (dup) return c.json({ error: '用户名已存在' }, 400)
      db.prepare('UPDATE visitor_users SET username = ?, updated_at = ? WHERE id = ?').run(username, ts, id)
    }
    if (body.password) {
      const hash = await hashPassword(String(body.password))
      db.prepare('UPDATE visitor_users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, ts, id)
    }
    if (body.group_ids != null) {
      setVisitorGroups(db, id, body.group_ids)
    }
    const visitor = db.prepare('SELECT id, username, created_at, updated_at FROM visitor_users WHERE id = ?').get(id)
    return c.json({
      visitor: {
        ...visitor,
        group_ids: getVisitorGroupIds(db, id),
      },
    })
  })

  app.delete('/api/visitor-users/:id', requireAuth, requireAccessModule, (c) => {
    const id = Number(c.req.param('id'))
    db.prepare('DELETE FROM visitor_users WHERE id = ?').run(id)
    return c.json({ ok: true })
  })

  // —— 公众页访客登录 ——
  app.post('/api/public/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!username || !password) {
      return c.json({ error: '请输入用户名和密码' }, 400)
    }

    const ip = getClientIp(c)
    const limit = checkLoginRateLimit(username, ip)
    if (!limit.allowed) {
      return c.json({ error: `登录尝试次数过多，请 ${limit.retryAfterSec} 秒后重试` }, 429)
    }

    const visitor = db.prepare('SELECT * FROM visitor_users WHERE username = ?').get(username)
    if (!visitor?.password_hash || !(await verifyPassword(password, visitor.password_hash))) {
      return c.json({ error: '用户名或密码错误' }, 401)
    }

    clearLoginRateLimit(username, ip)

    const principal = loadVisitorPrincipal(db, visitor)
    if (!principal.groupIds.length) {
      return c.json({ error: '该账号未分配可查看的组' }, 403)
    }
    const token = await signSession({ sub: String(visitor.id), typ: 'visitor' }, secret)
    c.header('Set-Cookie', sessionCookie(token, 60 * 60 * 24 * 7, getVisitorCookieName()))
    return c.json({ ok: true, visitor: formatVisitorForClient(principal) })
  })

  app.post('/api/public/auth/logout', (c) => {
    c.header('Set-Cookie', clearSessionCookie(getVisitorCookieName()))
    return c.json({ ok: true })
  })

  app.get('/api/public/auth/me', async (c) => {
    const session = await resolvePublicSession(db, c.req.raw, secret)
    if (!session) return c.json({ visitor: null })
    return c.json({ visitor: formatPublicSessionForClient(session) })
  })
}
