import { slugify, uniqueSlug } from './db.js'
import { applyCertificateGroupIdChange } from './certificatePublicSlug.js'

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
}

/** @typedef {{ id: number, username: string, role: string, groupIds: number[], moduleKeys: string[], isSuperAdmin: boolean }} AdminPrincipal */

/** @typedef {{ id: number, username: string, groupIds: number[] }} VisitorPrincipal */

export function isSuperAdmin(role) {
  return role === ROLES.SUPER_ADMIN
}

export function listAllGroupIds(db) {
  return db.prepare('SELECT id FROM access_groups ORDER BY id').all().map((r) => r.id)
}

export function getUserGroupIds(db, userId) {
  return db.prepare(`
    SELECT group_id FROM admin_user_groups WHERE user_id = ? ORDER BY group_id
  `).all(userId).map((r) => r.group_id)
}

export function getVisitorGroupIds(db, visitorId) {
  return db.prepare(`
    SELECT group_id FROM visitor_user_groups WHERE visitor_id = ? ORDER BY group_id
  `).all(visitorId).map((r) => r.group_id)
}

import { loadUserModuleKeys } from './adminModules.js'

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: number, role?: string, username?: string }} user
 * @returns {AdminPrincipal}
 */
export function loadAdminPrincipal(db, user) {
  const role = user.role || ROLES.ADMIN
  const superAdmin = isSuperAdmin(role)
  const groupIds = superAdmin ? listAllGroupIds(db) : getUserGroupIds(db, user.id)
  const moduleKeys = loadUserModuleKeys(db, user)
  return {
    id: user.id,
    username: user.username,
    role,
    avatarPath: user.avatar_path || null,
    groupIds,
    moduleKeys,
    isSuperAdmin: superAdmin,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: number, username: string }} visitor
 * @returns {VisitorPrincipal}
 */
export function loadVisitorPrincipal(db, visitor) {
  return {
    id: visitor.id,
    username: visitor.username,
    avatarPath: visitor.avatar_path || null,
    groupIds: getVisitorGroupIds(db, visitor.id),
  }
}

/**
 * 公众页组过滤；超级管理员可见全部已发布资源
 * @param {{ groupIds?: number[] } | null | undefined} principal
 * @param {{ isSuperAdmin?: boolean } | null | undefined} [adminPrincipal]
 * @param {string} [column]
 */
export function sqlPublicGroupInClause(principal, adminPrincipal, column = 'group_id') {
  if (adminPrincipal?.isSuperAdmin) {
    return { clause: '', params: [] }
  }
  return sqlGroupInClause(principal, column)
}

/**
 * @param {AdminPrincipal | VisitorPrincipal} principal
 * @param {string} [column]
 */
export function sqlGroupInClause(principal, column = 'group_id') {
  if (principal?.isSuperAdmin) {
    return { clause: '', params: [] }
  }
  const ids = principal.groupIds || []
  if (!ids.length) {
    return { clause: ' AND 1=0', params: [] }
  }
  const placeholders = ids.map(() => '?').join(',')
  return { clause: ` AND ${column} IN (${placeholders})`, params: ids }
}

/** @param {AdminPrincipal} principal @param {number | null | undefined} groupId */
export function assertGroupAccess(principal, groupId) {
  if (principal.isSuperAdmin) return true
  if (groupId == null) return false
  return principal.groupIds.includes(Number(groupId))
}

/**
 * 创建资源时解析 group_id
 * @param {import('better-sqlite3').Database} db
 * @param {AdminPrincipal} principal
 * @param {number | null | undefined} requestedGroupId
 */
export function resolveGroupIdForCreate(db, principal, requestedGroupId) {
  if (principal.isSuperAdmin) {
    const gid = Number(requestedGroupId)
    if (gid > 0) {
      const row = db.prepare('SELECT id FROM access_groups WHERE id = ?').get(gid)
      if (row) return gid
    }
    return getDefaultGroupId(db)
  }
  const allowed = principal.groupIds || []
  if (!allowed.length) throw new Error('当前账号未分配任何组，无法创建内容')
  const gid = Number(requestedGroupId)
  if (gid > 0 && allowed.includes(gid)) return gid
  if (allowed.length === 1) return allowed[0]
  throw new Error('请选择所属组')
}

/** 更新资源时变更 group_id */
export function resolveGroupIdForUpdate(db, principal, requestedGroupId, currentGroupId) {
  if (requestedGroupId === undefined || requestedGroupId === null) {
    return currentGroupId
  }
  const gid = Number(requestedGroupId)
  if (!gid || gid === Number(currentGroupId)) return currentGroupId
  if (!assertGroupAccess(principal, gid)) {
    throw new Error('无权设置该访问组')
  }
  const row = db.prepare('SELECT id FROM access_groups WHERE id = ?').get(gid)
  if (!row) throw new Error('访问组不存在')
  return Number(gid)
}

export function getDefaultGroupId(db) {
  const row = db.prepare('SELECT id FROM access_groups ORDER BY id LIMIT 1').get()
  return row?.id ?? null
}

export const UNGROUPED_GROUP_SLUG = 'ungrouped'

export function isProtectedGroupSlug(slug) {
  return String(slug || '').trim() === UNGROUPED_GROUP_SLUG
}

/** 确保系统「未分组」存在 */
export function ensureUngroupedGroup(db) {
  const existing = db.prepare('SELECT id FROM access_groups WHERE slug = ?').get(UNGROUPED_GROUP_SLUG)
  if (existing) return Number(existing.id)
  const ts = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO access_groups (name, slug, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run('未分组', UNGROUPED_GROUP_SLUG, ts, ts)
  return Number(result.lastInsertRowid)
}

export function getUngroupedGroupId(db) {
  const row = db.prepare('SELECT id FROM access_groups WHERE slug = ?').get(UNGROUPED_GROUP_SLUG)
  return row?.id != null ? Number(row.id) : ensureUngroupedGroup(db)
}

export const RESOURCE_GROUP_TABLES = ['svg_templates', 'table_templates', 'layout_presets', 'certificates']

export function getGroupById(db, id) {
  return db.prepare('SELECT id, name, slug, created_at, updated_at FROM access_groups WHERE id = ?').get(id)
}

export function listGroups(db) {
  return db.prepare('SELECT id, name, slug, created_at, updated_at FROM access_groups ORDER BY name').all()
}

export function setUserGroups(db, userId, groupIds) {
  const ids = [...new Set((groupIds || []).map(Number).filter((id) => id > 0))]
  db.prepare('DELETE FROM admin_user_groups WHERE user_id = ?').run(userId)
  const ins = db.prepare('INSERT INTO admin_user_groups (user_id, group_id) VALUES (?, ?)')
  for (const gid of ids) {
    if (db.prepare('SELECT 1 FROM access_groups WHERE id = ?').get(gid)) {
      ins.run(userId, gid)
    }
  }
}

export function setVisitorGroups(db, visitorId, groupIds) {
  const ids = [...new Set((groupIds || []).map(Number).filter((id) => id > 0))]
  db.prepare('DELETE FROM visitor_user_groups WHERE visitor_id = ?').run(visitorId)
  const ins = db.prepare('INSERT INTO visitor_user_groups (visitor_id, group_id) VALUES (?, ?)')
  for (const gid of ids) {
    if (db.prepare('SELECT 1 FROM access_groups WHERE id = ?').get(gid)) {
      ins.run(visitorId, gid)
    }
  }
}

export function createAccessGroup(db, { name, slug }) {
  const ts = new Date().toISOString()
  const groupName = String(name || '新组').trim() || '新组'
  const groupSlug = uniqueSlug(db, 'access_groups', slug || groupName)
  const result = db.prepare(`
    INSERT INTO access_groups (name, slug, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(groupName, groupSlug, ts, ts)
  return Number(result.lastInsertRowid)
}

export function backfillNullResourceGroupIds(db) {
  const ungroupedId = getUngroupedGroupId(db)
  if (!ungroupedId) return 0
  let total = 0
  for (const table of RESOURCE_GROUP_TABLES) {
    if (table === 'certificates') {
      const rows = db.prepare('SELECT id FROM certificates WHERE group_id IS NULL').all()
      for (const { id } of rows) {
        applyCertificateGroupIdChange(db, id, ungroupedId)
        total += 1
      }
      continue
    }
    const res = db.prepare(`UPDATE ${table} SET group_id = ? WHERE group_id IS NULL`).run(ungroupedId)
    total += res.changes
  }
  return total
}

export function slugByGroupId(db, groupId) {
  if (!groupId) return null
  return db.prepare('SELECT slug FROM access_groups WHERE id = ?').get(groupId)?.slug ?? null
}

export function idByGroupSlug(db, slug) {
  if (!slug) return null
  return db.prepare('SELECT id FROM access_groups WHERE slug = ?').get(String(slug).trim())?.id ?? null
}

/** 校验关联资源均属同一可访问组 */
export function assertRelatedResourcesInGroups(db, principal, { svgTemplateId, tableTemplateId, presetId }) {
  if (svgTemplateId) {
    const row = db.prepare('SELECT group_id FROM svg_templates WHERE id = ?').get(svgTemplateId)
    if (!row) throw new Error(`SVG 模板 #${svgTemplateId} 不存在`)
    if (!assertGroupAccess(principal, row.group_id)) {
      throw new Error('无权使用该 SVG 模板')
    }
  }
  if (tableTemplateId) {
    const row = db.prepare('SELECT group_id FROM table_templates WHERE id = ?').get(tableTemplateId)
    if (!row) throw new Error(`表格模板 #${tableTemplateId} 不存在`)
    if (!assertGroupAccess(principal, row.group_id)) {
      throw new Error('无权使用该表格模板')
    }
  }
  if (presetId) {
    const row = db.prepare('SELECT group_id FROM layout_presets WHERE id = ?').get(presetId)
    if (!row) throw new Error(`布局模板 #${presetId} 不存在`)
    if (!assertGroupAccess(principal, row.group_id)) {
      throw new Error('无权使用该布局模板')
    }
  }
}
