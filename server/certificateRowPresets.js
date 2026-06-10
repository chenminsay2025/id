import {
  customSampleDisplayFromPreset,
  sampleAdornmentsFromPreset,
  resolveCertificateLayoutOverrides,
} from '../src/presetSampleRow.js'
import { normalizePageNavColumnStorage } from '../src/pageNavColumn.js'

function parseJsonObject(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

/** @param {unknown} row */
export function normalizeCertificateRowInput(row) {
  if (row && typeof row === 'object' && row.row_data != null) {
    const presetRaw = row.preset_id
    const presetId = presetRaw != null && presetRaw !== '' ? Number(presetRaw) || null : null
    return {
      row_data: row.row_data,
      preset_id: presetId,
    }
  }
  return {
    row_data: row && typeof row === 'object' ? row : {},
    preset_id: null,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, rows?: { preset_id?: number | null }[] }} input
 */
export function validateCertificateRowPresets(db, input) {
  const certPresetId = input.preset_id != null ? Number(input.preset_id) || null : null
  const certTableTemplateId = input.table_template_id != null ? Number(input.table_template_id) || null : null
  const presetIds = new Set()
  if (certPresetId) presetIds.add(certPresetId)
  for (const row of input.rows || []) {
    const pid = row?.preset_id != null ? Number(row.preset_id) || null : null
    if (pid) presetIds.add(pid)
  }
  if (presetIds.size === 0) return { ok: true, table_template_id: certTableTemplateId }

  const tableTemplateIds = new Set()
  for (const pid of presetIds) {
    const preset = db.prepare('SELECT id, table_template_id FROM layout_presets WHERE id = ?').get(pid)
    if (!preset) {
      return { ok: false, error: `布局模板 #${pid} 不存在` }
    }
    if (preset.table_template_id != null) {
      tableTemplateIds.add(Number(preset.table_template_id))
    }
  }

  if (tableTemplateIds.size > 1) {
    return { ok: false, error: '同一证书内所有布局模板必须使用相同的表格模板' }
  }

  const resolvedTableTemplateId = tableTemplateIds.size === 1
    ? [...tableTemplateIds][0]
    : certTableTemplateId

  if (certTableTemplateId && resolvedTableTemplateId && certTableTemplateId !== resolvedTableTemplateId) {
    return { ok: false, error: '布局模板与证书表格模板不一致' }
  }

  return { ok: true, table_template_id: resolvedTableTemplateId ?? certTableTemplateId ?? null }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ template_id?: number | null, table_template_id?: number | null }} input
 */
export function validateCertificateForeignResources(db, input) {
  const templateId = input.template_id != null ? Number(input.template_id) || null : null
  const tableTemplateId = input.table_template_id != null ? Number(input.table_template_id) || null : null
  if (templateId) {
    const row = db.prepare('SELECT id FROM svg_templates WHERE id = ?').get(templateId)
    if (!row) return { ok: false, error: `SVG 模板 #${templateId} 不存在` }
  }
  if (tableTemplateId) {
    const row = db.prepare('SELECT id FROM table_templates WHERE id = ?').get(tableTemplateId)
    if (!row) return { ok: false, error: `表格模板 #${tableTemplateId} 不存在` }
  }
  return { ok: true }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, column_order?: string | null, layout_overrides?: string | null }} cert
 * @param {number} presetId
 */
export function buildPresetRenderBundle(db, cert, presetId) {
  const preset = db.prepare(`
    SELECT id, name, layout_overrides, preview_sample_row, svg_template_id, page_width_mm, page_height_mm, table_template_id, page_nav_column
    FROM layout_presets WHERE id = ?
  `).get(presetId)
  if (!preset) return null

  const certLayout = parseJsonObject(cert?.layout_overrides)
  const mergedLayout = resolveCertificateLayoutOverrides(certLayout, parseJsonObject(preset.layout_overrides))

  let tableCols = []
  const tableTemplateId = cert?.table_template_id ?? preset.table_template_id ?? null
  if (tableTemplateId) {
    const tpl = db.prepare('SELECT columns FROM table_templates WHERE id = ?').get(tableTemplateId)
    if (tpl) {
      tableCols = (parseJsonObject(tpl.columns, []) || [])
        .map((c) => String(c).trim())
        .filter(Boolean)
    }
  }
  if (!tableCols.length && cert?.column_order) {
    try {
      const order = JSON.parse(String(cert.column_order))
      if (Array.isArray(order)) {
        tableCols = order.map((c) => String(c).trim()).filter(Boolean)
      }
    } catch {
      /* ignore */
    }
  }

  const previewSampleRow = parseJsonObject(preset.preview_sample_row)
  const sampleAdornments = sampleAdornmentsFromPreset(previewSampleRow, tableCols, mergedLayout)
  const presetCustomSamples = customSampleDisplayFromPreset(previewSampleRow, tableCols, mergedLayout)

  return {
    preset_id: presetId,
    preset_name: preset.name || '',
    merged_layout_overrides: mergedLayout,
    sample_adornments: sampleAdornments,
    preset_custom_samples: presetCustomSamples,
    table_template_columns: tableCols,
    page_width_mm: preset.page_width_mm,
    page_height_mm: preset.page_height_mm,
    svg_template_id: preset.svg_template_id ?? cert?.template_id ?? null,
    table_template_id: tableTemplateId,
    page_nav_column: normalizePageNavColumnStorage(preset.page_nav_column),
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, column_order?: string | null, layout_overrides?: string | null }} cert
 * @param {{ preset_id?: number | null }[]} rows
 */
export function buildCertificatePresetBundles(db, cert, rows = []) {
  const presetIds = new Set()
  if (cert?.preset_id) presetIds.add(Number(cert.preset_id))
  for (const row of rows) {
    if (row?.preset_id) presetIds.add(Number(row.preset_id))
  }
  /** @type {Record<string, object>} */
  const bundles = {}
  for (const pid of presetIds) {
    const bundle = buildPresetRenderBundle(db, cert, pid)
    if (bundle) bundles[String(pid)] = bundle
  }
  return bundles
}

/** @param {number | null | undefined} rowPresetId @param {number | null | undefined} certPresetId */
export function resolveEffectiveRowPresetId(rowPresetId, certPresetId) {
  const rowId = rowPresetId != null ? Number(rowPresetId) || null : null
  if (rowId) return rowId
  const certId = certPresetId != null ? Number(certPresetId) || null : null
  return certId
}
