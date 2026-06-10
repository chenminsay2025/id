import {
  SAMPLE_ADORN_KEY_PREFIX,
  parseSampleAdornment,
} from '../src/sampleDialogSegments.js'
import {
  customSampleDisplayFromPreset,
  sampleAdornmentsFromPreset,
  resolveCertificateLayoutOverrides,
} from '../src/presetSampleRow.js'

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, column_order?: string | null, layout_overrides?: string | null }} cert
 */
export function resolveMergedLayoutOverrides(db, cert) {
  const certLayout = parseJsonObject(cert?.layout_overrides)
  if (!cert?.preset_id) return certLayout

  const preset = db.prepare('SELECT layout_overrides FROM layout_presets WHERE id = ?').get(cert.preset_id)
  if (!preset) return certLayout

  return resolveCertificateLayoutOverrides(certLayout, parseJsonObject(preset.layout_overrides))
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, column_order?: string | null, layout_overrides?: string | null }} cert
 */
export function resolveCertificateTableColumns(db, cert) {
  let tableCols = []
  let tableTemplateId = cert?.table_template_id ?? null

  if (cert?.preset_id && !tableTemplateId) {
    const preset = db.prepare('SELECT table_template_id FROM layout_presets WHERE id = ?').get(cert.preset_id)
    tableTemplateId = preset?.table_template_id ?? null
  }

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
      const order = JSON.parse(cert.column_order)
      if (Array.isArray(order)) {
        tableCols = order.map((c) => String(c).trim()).filter(Boolean)
      }
    } catch {
      /* ignore */
    }
  }

  return tableCols
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, column_order?: string | null, layout_overrides?: string | null }} cert
 */
export function computeCertificateSampleAdornments(db, cert) {
  if (!cert?.preset_id) return {}

  const preset = db.prepare('SELECT preview_sample_row FROM layout_presets WHERE id = ?').get(cert.preset_id)
  if (!preset) return {}

  const previewSampleRow = parseJsonObject(preset.preview_sample_row)
  const tableCols = resolveCertificateTableColumns(db, cert)
  const layoutOverrides = resolveMergedLayoutOverrides(db, cert)

  return sampleAdornmentsFromPreset(previewSampleRow, tableCols, layoutOverrides)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ preset_id?: number | null, table_template_id?: number | null, column_order?: string | null, layout_overrides?: string | null }} cert
 */
export function computeCertificatePresetCustomSamples(db, cert) {
  if (!cert?.preset_id) return {}

  const preset = db.prepare('SELECT preview_sample_row FROM layout_presets WHERE id = ?').get(cert.preset_id)
  if (!preset) return {}

  const previewSampleRow = parseJsonObject(preset.preview_sample_row)
  const tableCols = resolveCertificateTableColumns(db, cert)
  const layoutOverrides = resolveMergedLayoutOverrides(db, cert)

  return customSampleDisplayFromPreset(previewSampleRow, tableCols, layoutOverrides)
}

/** 发布/公开 API 用的渲染快照（前后缀、合并布局、表格列、自定义框示例） */
export function buildCertificatePublicSnapshot(db, cert) {
  return {
    sample_adornments: computeCertificateSampleAdornments(db, cert),
    preset_custom_samples: computeCertificatePresetCustomSamples(db, cert),
    merged_layout_overrides: resolveMergedLayoutOverrides(db, cert),
    table_template_columns: resolveCertificateTableColumns(db, cert),
  }
}

function hasNonEmptyAdornments(adornments) {
  return adornments
    && typeof adornments === 'object'
    && Object.keys(adornments).length > 0
}

export function resolveCertificatePublicSnapshot(db, cert) {
  const fresh = buildCertificatePublicSnapshot(db, cert)
  if (cert?.preset_id) return fresh

  const previewUi = parseJsonObject(cert?.preview_ui)
  const snap = previewUi?.public_snapshot
  if (!snap || typeof snap !== 'object') return fresh

  return {
    sample_adornments: hasNonEmptyAdornments(snap.sample_adornments)
      ? snap.sample_adornments
      : fresh.sample_adornments,
    preset_custom_samples: snap.preset_custom_samples
      && typeof snap.preset_custom_samples === 'object'
      && Object.keys(snap.preset_custom_samples).length
      ? snap.preset_custom_samples
      : fresh.preset_custom_samples,
    merged_layout_overrides: snap.merged_layout_overrides
      && typeof snap.merged_layout_overrides === 'object'
      && Object.keys(snap.merged_layout_overrides).length
      ? snap.merged_layout_overrides
      : fresh.merged_layout_overrides,
    table_template_columns: Array.isArray(snap.table_template_columns) && snap.table_template_columns.length
      ? snap.table_template_columns
      : fresh.table_template_columns,
  }
}

/** 关联布局预设时优先用预设绑定的 SVG 模板 */
export function resolveCertificateTemplateId(db, cert) {
  if (cert?.preset_id) {
    const preset = db.prepare('SELECT svg_template_id FROM layout_presets WHERE id = ?').get(cert.preset_id)
    if (preset?.svg_template_id != null) {
      const id = Number(preset.svg_template_id)
      if (id) return id
    }
  }
  if (cert?.template_id != null) {
    const id = Number(cert.template_id)
    if (id) return id
  }
  return null
}

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

/** @deprecated 仅保留 __adorn__ 解析供测试 */
export function sampleAdornmentsFromPreviewRow(previewSampleRow) {
  const result = {}
  if (!previewSampleRow || typeof previewSampleRow !== 'object') return result

  for (const [key, val] of Object.entries(previewSampleRow)) {
    if (!key.startsWith(SAMPLE_ADORN_KEY_PREFIX)) continue
    const boxId = key.slice(SAMPLE_ADORN_KEY_PREFIX.length)
    try {
      const adorn = parseSampleAdornment(JSON.parse(String(val)))
      if (adorn.prefix.length || adorn.suffix.length) {
        result[boxId] = adorn
      }
    } catch {
      /* ignore invalid adornment */
    }
  }

  return result
}
