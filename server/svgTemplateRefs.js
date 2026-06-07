/**
 * 收集 / 清理 SVG 模板删除前的引用，并生成可读错误信息。
 */

/** @typedef {{ id: number, name?: string | null, preset_id?: number | null, layout_preset_id?: number | null }} RefItem */
/** @typedef {{ kind: string, label: string, blocksDelete: boolean, autoClean: boolean, count: number, items: RefItem[] }} SvgTemplateRefGroup */

/** @param {import('better-sqlite3').Database} db */
export function collectSvgTemplateReferences(db, templateId) {
  /** @type {SvgTemplateRefGroup[]} */
  const groups = []

  const presetRows = db.prepare(`
    SELECT id, name FROM layout_presets WHERE svg_template_id = ?
  `).all(templateId)
  if (presetRows.length) {
    groups.push({
      kind: 'layout_presets',
      label: '布局模板',
      blocksDelete: false,
      autoClean: true,
      count: presetRows.length,
      items: presetRows.map((r) => ({ id: r.id, name: r.name })),
    })
  }

  const blockRows = db.prepare(`
    SELECT id, name, layout_preset_id FROM block_templates WHERE svg_template_id = ?
  `).all(templateId)
  if (blockRows.length) {
    groups.push({
      kind: 'block_templates',
      label: '旧版组合模板（已废弃）',
      blocksDelete: false,
      autoClean: true,
      count: blockRows.length,
      items: blockRows.map((r) => ({
        id: r.id,
        name: r.name,
        layout_preset_id: r.layout_preset_id,
      })),
    })
  }

  const certViaPreset = db.prepare(`
    SELECT c.id, c.title AS name, c.preset_id, p.name AS preset_name
    FROM certificates c
    INNER JOIN layout_presets p ON p.id = c.preset_id
    WHERE p.svg_template_id = ?
  `).all(templateId)
  if (certViaPreset.length) {
    groups.push({
      kind: 'certificates_via_preset',
      label: '证书（通过布局模板间接使用）',
      blocksDelete: true,
      autoClean: false,
      count: certViaPreset.length,
      items: certViaPreset.map((r) => ({
        id: r.id,
        name: r.name,
        preset_id: r.preset_id,
        preset_name: r.preset_name,
      })),
    })
  }

  const certDirect = db.prepare(`
    SELECT id, title AS name, preset_id FROM certificates WHERE template_id = ?
  `).all(templateId)
  if (certDirect.length) {
    const legacyOnly = certDirect.filter((r) => r.preset_id != null)
    const hardBlock = certDirect.filter((r) => r.preset_id == null)
    if (legacyOnly.length) {
      groups.push({
        kind: 'certificates_template_id_legacy',
        label: '证书（历史字段 template_id 残留，将自动解除）',
        blocksDelete: false,
        autoClean: true,
        count: legacyOnly.length,
        items: legacyOnly.map((r) => ({ id: r.id, name: r.name, preset_id: r.preset_id })),
      })
    }
    if (hardBlock.length) {
      groups.push({
        kind: 'certificates_template_id',
        label: '证书（直接绑定，无布局模板）',
        blocksDelete: true,
        autoClean: false,
        count: hardBlock.length,
        items: hardBlock.map((r) => ({ id: r.id, name: r.name })),
      })
    }
  }

  return groups
}

/** @param {SvgTemplateRefGroup[]} groups */
export function formatSvgTemplateDeleteError(groups) {
  const blocking = groups.filter((g) => g.blocksDelete)
  if (!blocking.length) return null

  const lines = blocking.map((g) => {
    const sample = g.items.slice(0, 8).map((i) => {
      if (g.kind === 'certificates_via_preset') {
        return `#${i.id}「${i.name || '未命名'}」（布局：${i.preset_name || i.preset_id}）`
      }
      return `#${i.id}「${i.name || '未命名'}」`
    }).join('、')
    const suffix = g.count > 8 ? ` 等共 ${g.count} 条` : ''
    return `· ${g.label}：${sample}${suffix}`
  })

  return `无法删除此 SVG 模板，请先处理以下引用：\n${lines.join('\n')}`
}

/** @param {import('better-sqlite3').Database} db */
export function clearAutoCleanableSvgTemplateReferences(db, templateId) {
  /** @type {{ kind: string, label: string, count: number }[]} */
  const cleaned = []

  const presetCount = db.prepare(`
    SELECT COUNT(*) AS n FROM layout_presets WHERE svg_template_id = ?
  `).get(templateId).n
  if (presetCount > 0) {
    db.prepare('UPDATE layout_presets SET svg_template_id = NULL WHERE svg_template_id = ?').run(templateId)
    cleaned.push({ kind: 'layout_presets', label: '布局模板', count: presetCount })
  }

  const blockRows = db.prepare('SELECT id FROM block_templates WHERE svg_template_id = ?').all(templateId)
  if (blockRows.length) {
    for (const br of blockRows) {
      db.prepare('UPDATE certificates SET block_template_id = NULL WHERE block_template_id = ?').run(br.id)
    }
    db.prepare('DELETE FROM block_templates WHERE svg_template_id = ?').run(templateId)
    cleaned.push({ kind: 'block_templates', label: '旧版组合模板', count: blockRows.length })
  }

  const legacyCertCount = db.prepare(`
    SELECT COUNT(*) AS n FROM certificates WHERE template_id = ? AND preset_id IS NOT NULL
  `).get(templateId).n
  if (legacyCertCount > 0) {
    db.prepare(`
      UPDATE certificates SET template_id = NULL WHERE template_id = ? AND preset_id IS NOT NULL
    `).run(templateId)
    cleaned.push({ kind: 'certificates_template_id_legacy', label: '证书历史字段', count: legacyCertCount })
  }

  return cleaned
}

/** @param {import('better-sqlite3').Database} db */
export function foreignKeyViolationsForSvgTemplate(db, templateId) {
  try {
    const rows = db.pragma('foreign_key_check')
    const childTables = new Set(['block_templates', 'certificates', 'layout_presets'])
    return rows.filter((r) => r.parent === 'svg_templates' && childTables.has(r.table))
  } catch {
    return []
  }
}

/** @param {import('better-sqlite3').Database} db */
export function deleteSvgTemplateWithCleanup(db, templateId) {
  const references = collectSvgTemplateReferences(db, templateId)
  const error = formatSvgTemplateDeleteError(references)
  if (error) {
    return { ok: false, error, references }
  }

  const cleaned = db.transaction(() => {
    const items = clearAutoCleanableSvgTemplateReferences(db, templateId)
    db.prepare('DELETE FROM svg_templates WHERE id = ?').run(templateId)
    return items
  })()

  return { ok: true, cleaned, references: references.filter((g) => g.autoClean) }
}
