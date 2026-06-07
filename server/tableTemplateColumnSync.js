import {
  computeColumnRenames,
  applyColumnRenamesToLayoutOverrides,
  applyColumnRenamesToPreviewSampleRow,
  applyColumnRenamesToPageNavColumn,
  normalizeTemplateColumnList,
} from '../src/tableTemplateColumnDiff.js'
import { normalizePageNavColumnStorage } from '../src/pageNavColumn.js'

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(String(raw))
  } catch {
    return fallback
  }
}

/**
 * 表格模板列重命名后，同步关联布局模板的 layout_overrides / preview_sample_row / page_nav_column。
 * @param {import('better-sqlite3').Database} db
 * @param {number} tableTemplateId
 * @param {string[]} oldColumns
 * @param {string[]} newColumns
 * @param {string} updatedAt
 */
export function syncLayoutPresetsForTableColumnChanges(db, tableTemplateId, oldColumns, newColumns, updatedAt) {
  const renames = computeColumnRenames(oldColumns, newColumns)
  if (!renames.length) return { presetsUpdated: 0, renames: [] }

  const cols = normalizeTemplateColumnList(newColumns)
  const presets = db.prepare(`
    SELECT id, layout_overrides, preview_sample_row, page_nav_column
    FROM layout_presets
    WHERE table_template_id = ?
  `).all(tableTemplateId)

  const update = db.prepare(`
    UPDATE layout_presets
    SET layout_overrides = ?, preview_sample_row = ?, page_nav_column = ?, updated_at = ?
    WHERE id = ?
  `)

  let presetsUpdated = 0
  for (const preset of presets) {
    let layout = parseJson(preset.layout_overrides, {})
    let sample = parseJson(preset.preview_sample_row, {})
    layout = applyColumnRenamesToLayoutOverrides(layout, renames, cols)
    sample = applyColumnRenamesToPreviewSampleRow(sample, renames)
    const pageNav = normalizePageNavColumnStorage(
      applyColumnRenamesToPageNavColumn(preset.page_nav_column, renames),
    )
    update.run(JSON.stringify(layout), JSON.stringify(sample), pageNav, updatedAt, preset.id)
    presetsUpdated += 1
  }

  return { presetsUpdated, renames }
}
