import { hashPassword, verifyPassword, formatUserForClient } from './auth.js'
import { loadAdminPrincipal, loadVisitorPrincipal } from './accessControl.js'
import fs from 'node:fs'
import path from 'node:path'

function normalizeAvatarPath(input) {
  if (input == null || input === '') return null
  const s = String(input).trim()
  if (!s) return null
  const m = s.match(/^\/uploads\/([a-zA-Z0-9._-]+)$/)
  if (!m) return undefined
  return `/uploads/${m[1]}`
}

function avatarFileExists(projectRoot, avatarPath) {
  if (!avatarPath) return true
  const name = avatarPath.replace(/^\/uploads\//, '')
  return fs.existsSync(path.join(projectRoot, 'data', 'uploads', name))
}

function formatProfileRow(db, row) {
  const principal = loadAdminPrincipal(db, row)
  return {
    ...formatUserForClient(principal),
    avatar_url: row.avatar_path || null,
    created_at: row.created_at || null,
  }
}

function formatVisitorProfileRow(db, row) {
  const principal = loadVisitorPrincipal(db, row)
  return {
    id: row.id,
    username: row.username,
    group_ids: principal.groupIds,
    avatar_url: row.avatar_path || null,
    created_at: row.created_at || null,
  }
}

async function patchProfileRow({
  db,
  projectRoot,
  table,
  id,
  row,
  body,
  usernameColumn = 'username',
}) {
  if (body.username != null) {
    const username = String(body.username).trim()
    if (!username) return { error: '账号名不能为空', status: 400 }
    if (username.length > 40) return { error: '账号名不能超过 40 个字符', status: 400 }
    const dup = db.prepare(`SELECT id FROM ${table} WHERE ${usernameColumn} = ? AND id != ?`).get(username, id)
    if (dup) return { error: '账号名已被使用', status: 400 }
    db.prepare(`UPDATE ${table} SET ${usernameColumn} = ? WHERE id = ?`).run(username, id)
  }

  if (body.avatar_path !== undefined) {
    const avatarPath = normalizeAvatarPath(body.avatar_path)
    if (avatarPath === undefined) {
      return { error: '头像路径无效', status: 400 }
    }
    if (avatarPath && !avatarFileExists(projectRoot, avatarPath)) {
      return { error: '头像文件不存在', status: 400 }
    }
    db.prepare(`UPDATE ${table} SET avatar_path = ? WHERE id = ?`).run(avatarPath, id)
  }

  const newPassword = body.new_password != null ? String(body.new_password) : ''
  if (newPassword) {
    const currentPassword = String(body.current_password || '')
    if (!currentPassword) {
      return { error: '修改密码须填写当前密码', status: 400 }
    }
    if (newPassword.length < 4) {
      return { error: '新密码至少 4 位', status: 400 }
    }
    if (currentPassword === newPassword) {
      return { error: '新密码不能与当前密码相同', status: 400 }
    }
    if (!row.password_hash || !(await verifyPassword(currentPassword, row.password_hash))) {
      return { error: '当前密码错误', status: 401 }
    }
    const hash = await hashPassword(newPassword)
    db.prepare(`UPDATE ${table} SET password_hash = ? WHERE id = ?`).run(hash, id)
  }

  return { ok: true }
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, projectRoot: string, requireAuth: Function }} opts
 */
export function registerAccountRoutes(app, { db, projectRoot, requireAuth }) {
  app.get('/api/auth/profile', requireAuth, (c) => {
    const principal = c.get('principal')
    const row = db.prepare(
      'SELECT id, username, role, avatar_path, created_at FROM admin_user WHERE id = ?',
    ).get(principal.id)
    if (!row) return c.json({ error: '用户无效' }, 404)
    return c.json({ profile: formatProfileRow(db, row) })
  })

  app.patch('/api/auth/profile', requireAuth, async (c) => {
    try {
      const principal = c.get('principal')
      const body = await c.req.json().catch(() => ({}))
      const row = db.prepare(
        'SELECT id, username, role, avatar_path, password_hash, created_at FROM admin_user WHERE id = ?',
      ).get(principal.id)
      if (!row) return c.json({ error: '用户无效' }, 404)

      const result = await patchProfileRow({
        db,
        projectRoot,
        table: 'admin_user',
        id: principal.id,
        row,
        body,
      })
      if (result.error) return c.json({ error: result.error }, result.status || 400)

      const updated = db.prepare(
        'SELECT id, username, role, avatar_path, created_at FROM admin_user WHERE id = ?',
      ).get(principal.id)
      return c.json({ ok: true, profile: formatProfileRow(db, updated) })
    } catch (err) {
      console.error('[CAT API] 更新账户失败:', err)
      return c.json({ error: err.message || '更新账户失败' }, 500)
    }
  })
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, projectRoot: string, requireVisitorAuth: Function }} opts
 */
export function registerPublicAccountRoutes(app, { db, projectRoot, requireVisitorAuth }) {
  const requireVisitorOnly = async (c, next) => {
    await requireVisitorAuth(c, async () => {
      if (c.get('publicAdminPrincipal')) {
        return c.json({ error: '后台账号请使用 /api/auth/profile' }, 403)
      }
      await next()
    })
  }

  app.get('/api/public/auth/profile', requireVisitorOnly, (c) => {
    const visitor = c.get('visitor')
    const row = db.prepare(
      'SELECT id, username, avatar_path, password_hash, created_at FROM visitor_users WHERE id = ?',
    ).get(visitor.id)
    if (!row) return c.json({ error: '用户无效' }, 404)
    return c.json({ profile: formatVisitorProfileRow(db, row) })
  })

  app.patch('/api/public/auth/profile', requireVisitorOnly, async (c) => {
    try {
      const visitor = c.get('visitor')
      const body = await c.req.json().catch(() => ({}))
      const row = db.prepare(
        'SELECT id, username, avatar_path, password_hash, created_at FROM visitor_users WHERE id = ?',
      ).get(visitor.id)
      if (!row) return c.json({ error: '用户无效' }, 404)

      const result = await patchProfileRow({
        db,
        projectRoot,
        table: 'visitor_users',
        id: visitor.id,
        row,
        body,
      })
      if (result.error) return c.json({ error: result.error }, result.status || 400)

      const ts = new Date().toISOString()
      db.prepare('UPDATE visitor_users SET updated_at = ? WHERE id = ?').run(ts, visitor.id)

      const updated = db.prepare(
        'SELECT id, username, avatar_path, created_at FROM visitor_users WHERE id = ?',
      ).get(visitor.id)
      return c.json({ ok: true, profile: formatVisitorProfileRow(db, updated) })
    } catch (err) {
      console.error('[CAT API] 更新访客账户失败:', err)
      return c.json({ error: err.message || '更新账户失败' }, 500)
    }
  })
}
