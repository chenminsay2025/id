/**
 * SVG 模板数据访问层
 * server/repositories/svgTemplateRepo.js
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} principal
 * @param {object} groupFilter — sqlGroupInClause 返回的 { clause, params }
 */
export function listSvgTemplates(db, groupFilter) {
  return db.prepare(`
    SELECT id, name, slug, file_path, is_default, group_id, created_at, updated_at, svg_content
    FROM svg_templates WHERE 1=1${groupFilter.clause}
    ORDER BY is_default DESC, updated_at DESC
  `).all(...groupFilter.params)
}

export function getSvgTemplateById(db, id, groupFilter) {
  return db.prepare(`
    SELECT * FROM svg_templates WHERE id = ?${groupFilter.clause}
  `).get(id, ...groupFilter.params)
}

export function getDefaultSvgTemplate(db, groupFilter) {
  return db.prepare(`
    SELECT id FROM svg_templates WHERE is_default = 1${groupFilter.clause} LIMIT 1
  `).get(...groupFilter.params)
}

export function getAnySvgTemplate(db, groupFilter) {
  return db.prepare(`
    SELECT id FROM svg_templates WHERE 1=1${groupFilter.clause} ORDER BY updated_at DESC LIMIT 1
  `).get(...groupFilter.params)
}

export function clearDefaultSvgTemplate(db, groupId, exceptId = null) {
  if (groupId == null) return
  if (exceptId != null) {
    db.prepare('UPDATE svg_templates SET is_default = 0 WHERE group_id = ? AND id != ?').run(groupId, exceptId)
  } else {
    db.prepare('UPDATE svg_templates SET is_default = 0 WHERE group_id = ?').run(groupId)
  }
}

export function createSvgTemplate(db, { name, slug, filePath, isDefault, groupId, ts }) {
  return db.prepare(`
    INSERT INTO svg_templates (name, slug, svg_content, file_path, is_default, group_id, created_at, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?)
  `).run(name, slug, filePath, isDefault ? 1 : 0, groupId, ts, ts)
}

export function updateSvgTemplate(db, id, { name, slug, filePath, isDefault, groupId, ts }) {
  return db.prepare(`
    UPDATE svg_templates SET name = ?, slug = ?, svg_content = '', file_path = ?, is_default = ?, group_id = ?, updated_at = ?
    WHERE id = ?
  `).run(name, slug, filePath, isDefault, groupId, ts, id)
}

export function deleteSvgTemplateById(db, id) {
  return db.prepare('DELETE FROM svg_templates WHERE id = ?').run(id)
}

export function findNextDefaultSvgTemplate(db, groupId) {
  return db.prepare(`
    SELECT id FROM svg_templates WHERE group_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(groupId)
}

export function getSvgContentForTemplate(db, templateId) {
  return db.prepare('SELECT file_path, svg_content FROM svg_templates WHERE id = ?').get(templateId)
}

export function getDefaultSvgTemplateId(db, groupFilter) {
  const def = getDefaultSvgTemplate(db, groupFilter)
  if (def) return def.id
  const any = getAnySvgTemplate(db, groupFilter)
  return any?.id ?? null
}
