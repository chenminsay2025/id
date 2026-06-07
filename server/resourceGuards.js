import { sqlGroupInClause, assertGroupAccess } from './accessControl.js'

/** @param {import('better-sqlite3').Database} db @param {string} table @param {number} id @param {object} principal */
export function getRowInGroups(db, table, id, principal) {
  const gf = sqlGroupInClause(principal)
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?${gf.clause}`).get(id, ...gf.params)
}

/** @param {import('better-sqlite3').Database} db @param {object} principal */
export function getDefaultSvgTemplateIdForPrincipal(db, principal) {
  const gf = sqlGroupInClause(principal, 'group_id')
  const def = db.prepare(`
    SELECT id FROM svg_templates WHERE is_default = 1${gf.clause} LIMIT 1
  `).get(...gf.params)
  if (def) return def.id
  const any = db.prepare(`
    SELECT id FROM svg_templates WHERE 1=1${gf.clause} ORDER BY updated_at DESC LIMIT 1
  `).get(...gf.params)
  return any?.id ?? null
}

/** @param {import('better-sqlite3').Database} db @param {object} principal */
export function assertRowInGroups(db, table, id, principal) {
  const row = getRowInGroups(db, table, id, principal)
  if (!row) throw new Error('未找到或无权访问')
  return row
}

export function assertCanAccessGroup(principal, groupId) {
  if (!assertGroupAccess(principal, groupId)) {
    throw new Error('无权访问该组')
  }
}
