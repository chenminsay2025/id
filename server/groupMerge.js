import {
  getGroupById,
  getUngroupedGroupId,
  isProtectedGroupSlug,
  RESOURCE_GROUP_TABLES,
} from './accessControl.js'
import { uniqueSlug } from './db.js'
import { applyCertificateGroupIdChange } from './certificatePublicSlug.js'

export function migrateGroupMergeLog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_group_merge_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_group_id INTEGER NOT NULL,
      from_group_name TEXT NOT NULL,
      from_group_slug TEXT,
      to_group_id INTEGER NOT NULL,
      to_group_name TEXT NOT NULL,
      moved_snapshot TEXT NOT NULL,
      reverted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `)
}

function collectResourceIds(db, groupId) {
  /** @type {Record<string, number[]>} */
  const resources = {}
  for (const table of RESOURCE_GROUP_TABLES) {
    resources[table] = db.prepare(`SELECT id FROM ${table} WHERE group_id = ?`).all(groupId).map((r) => r.id)
  }
  return resources
}

function linkUsersAndVisitors(db, fromGroupId, toGroupId) {
  db.prepare(`
    INSERT OR IGNORE INTO admin_user_groups (user_id, group_id)
    SELECT user_id, ? FROM admin_user_groups WHERE group_id = ?
  `).run(toGroupId, fromGroupId)
  db.prepare(`
    INSERT OR IGNORE INTO visitor_user_groups (visitor_id, group_id)
    SELECT visitor_id, ? FROM visitor_user_groups WHERE group_id = ?
  `).run(toGroupId, fromGroupId)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} fromGroupId
 * @param {number} toGroupId
 */
export function moveResourcesToGroup(db, fromGroupId, toGroupId) {
  const fromId = Number(fromGroupId)
  const toId = Number(toGroupId)
  if (!fromId || !toId || fromId === toId) throw new Error('无效的合并目标')

  const snapshot = {
    from_group_id: fromId,
    to_group_id: toId,
    resources: collectResourceIds(db, fromId),
  }
  /** @type {Record<string, number>} */
  const counts = {}

  db.transaction(() => {
    for (const table of RESOURCE_GROUP_TABLES) {
      if (table === 'certificates') {
        const rows = db.prepare('SELECT id FROM certificates WHERE group_id = ?').all(fromId)
        for (const { id } of rows) {
          applyCertificateGroupIdChange(db, id, toId)
        }
        counts[table] = rows.length
        continue
      }
      const res = db.prepare(`UPDATE ${table} SET group_id = ? WHERE group_id = ?`).run(toId, fromId)
      counts[table] = res.changes
    }
    linkUsersAndVisitors(db, fromId, toId)
  })()

  return { counts, snapshot }
}

function recordMergeLog(db, fromGroup, toGroup, snapshot) {
  const ts = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO access_group_merge_log (
      from_group_id, from_group_name, from_group_slug, to_group_id, to_group_name, moved_snapshot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    fromGroup.id,
    fromGroup.name,
    fromGroup.slug,
    toGroup.id,
    toGroup.name,
    JSON.stringify(snapshot),
    ts,
  )
  return Number(result.lastInsertRowid)
}

export function listGroupMergeLogs(db, limit = 30) {
  const rows = db.prepare(`
    SELECT id, from_group_id, from_group_name, to_group_id, to_group_name, reverted, created_at
    FROM access_group_merge_log
    ORDER BY id DESC
    LIMIT ?
  `).all(limit)
  return rows.map((row) => ({
    ...row,
    reverted: !!row.reverted,
  }))
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} groupId
 * @param {{ mergeIntoId?: number | null, recordLog?: boolean }} [opts]
 */
export function dissolveAccessGroup(db, groupId, { mergeIntoId = null, recordLog = true } = {}) {
  const id = Number(groupId)
  if (!id) throw new Error('无效的访问组')
  const fromGroup = getGroupById(db, id)
  if (!fromGroup) throw new Error('未找到')
  if (isProtectedGroupSlug(fromGroup.slug)) {
    throw new Error('「未分组」为系统组，不可删除或合并')
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM access_groups').get().n
  if (count <= 1) throw new Error('至少保留一个访问组')

  let toId = mergeIntoId != null ? Number(mergeIntoId) : getUngroupedGroupId(db)
  if (!toId || !Number.isFinite(toId)) throw new Error('无法确定迁移目标组')
  if (toId === id) throw new Error('不能合并到自身')

  const toGroup = getGroupById(db, toId)
  if (!toGroup) throw new Error('目标访问组不存在')

  const { counts, snapshot } = moveResourcesToGroup(db, id, toId)
  let mergeLogId = null
  db.transaction(() => {
    if (recordLog) {
      mergeLogId = recordMergeLog(db, fromGroup, toGroup, snapshot)
    }
    db.prepare('DELETE FROM access_groups WHERE id = ?').run(id)
  })()

  return {
    merge_log_id: mergeLogId,
    moved_to_group_id: toId,
    moved_to_group_name: toGroup.name,
    moved: counts,
  }
}

/** 将 from 组合并到 to 组（删除 from 组） */
export function mergeAccessGroups(db, fromGroupId, toGroupId) {
  return dissolveAccessGroup(db, fromGroupId, { mergeIntoId: toGroupId, recordLog: true })
}

export function revertGroupMergeLog(db, logId) {
  const log = db.prepare('SELECT * FROM access_group_merge_log WHERE id = ?').get(Number(logId))
  if (!log) throw new Error('未找到合并记录')
  if (log.reverted) throw new Error('该合并已撤销')

  let snapshot = {}
  try {
    snapshot = JSON.parse(log.moved_snapshot || '{}')
  } catch {
    throw new Error('合并记录损坏')
  }

  const ts = new Date().toISOString()
  let restoredGroupId = null

  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM access_groups WHERE slug = ?').get(log.from_group_slug)
    if (existing) {
      restoredGroupId = Number(existing.id)
    } else {
      const slug = uniqueSlug(db, 'access_groups', log.from_group_slug || log.from_group_name)
      const ins = db.prepare(`
        INSERT INTO access_groups (name, slug, created_at, updated_at) VALUES (?, ?, ?, ?)
      `).run(log.from_group_name, slug, ts, ts)
      restoredGroupId = Number(ins.lastInsertRowid)
    }

    const resources = snapshot.resources || {}
    for (const table of RESOURCE_GROUP_TABLES) {
      const ids = resources[table] || []
      if (!ids.length) continue
      if (table === 'certificates') {
        for (const id of ids) {
          applyCertificateGroupIdChange(db, Number(id), restoredGroupId)
        }
        continue
      }
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(`UPDATE ${table} SET group_id = ? WHERE id IN (${placeholders})`).run(restoredGroupId, ...ids)
    }

    db.prepare('UPDATE access_group_merge_log SET reverted = 1 WHERE id = ?').run(log.id)
  })()

  return {
    ok: true,
    restored_group_id: restoredGroupId,
    restored_group_name: log.from_group_name,
  }
}
