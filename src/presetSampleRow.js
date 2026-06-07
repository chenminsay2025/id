import {
  listCustomLayoutBoxIds,
  listLayoutBoxIds,
  getPrimaryColumnForBox,
  resolveBoxId,
  mergeCertificatePresetLayout,
} from './layoutBinding.js'
import { normalizeColumnKey, resolveTemplateColumnOrder } from './zhColumnNormalize.js'
import {
  SAMPLE_ADORN_KEY_PREFIX,
  parseSampleAdornment,
  parseSampleStorage,
  sampleSegmentsToDisplayText,
} from './sampleDialogSegments.js'

export function isCustomLayoutBoxId(boxId, tableColumns = []) {
  return !tableColumns.includes(boxId)
}

export { listCustomLayoutBoxIds }

function hasMeaningfulSampleCell(value) {
  if (value == null) return false
  return String(value).trim() !== ''
}

/**
 * 从布局模板的 preview_sample_row 提取自定义编辑框的展示文本（不含表格列）。
 * @param {Record<string, string>} previewSampleRow
 * @param {string[]} tableColumns
 * @param {Record<string, object>} layoutOverrides
 * @returns {Record<string, string>}
 */
export function customSampleDisplayFromPreset(previewSampleRow, tableColumns = [], layoutOverrides = {}) {
  const result = {}
  if (!previewSampleRow || typeof previewSampleRow !== 'object') return result

  const tableColSet = new Set(tableColumns)
  const layoutBoxIds = new Set(listLayoutBoxIds(layoutOverrides || {}))
  const adornments = {}

  for (const [key, val] of Object.entries(previewSampleRow)) {
    if (!key.startsWith(SAMPLE_ADORN_KEY_PREFIX)) continue
    const boxId = key.slice(SAMPLE_ADORN_KEY_PREFIX.length)
    try {
      adornments[boxId] = parseSampleAdornment(JSON.parse(String(val)))
    } catch {
      /* ignore invalid adornment */
    }
  }

  for (const [key, saved] of Object.entries(previewSampleRow)) {
    if (key.startsWith(SAMPLE_ADORN_KEY_PREFIX)) continue
    if (tableColSet.has(key)) continue
    if (!layoutBoxIds.has(key) && !isCustomLayoutBoxId(key, tableColumns)) continue
    if (!hasMeaningfulSampleCell(saved)) continue

    const segments = parseSampleStorage(saved)
    const adorn = adornments[key]
    if (adorn) {
      segments.prefix = [...(adorn.prefix || []), ...(segments.prefix || [])]
      segments.suffix = [...(segments.suffix || []), ...(adorn.suffix || [])]
    }
    result[key] = sampleSegmentsToDisplayText(segments)
  }

  return result
}

/**
 * 从布局预设 preview_sample_row 提取编辑框前后缀（__adorn__:*）。
 * @param {Record<string, string>} previewSampleRow
 * @param {string[]} tableColumns
 * @param {Record<string, object>} layoutOverrides
 * @returns {Record<string, { prefix: string[], suffix: string[] }>}
 */
export function sampleAdornmentsFromPreset(previewSampleRow, tableColumns = [], layoutOverrides = {}) {
  const result = {}
  if (!previewSampleRow || typeof previewSampleRow !== 'object') return result

  const tableColSet = new Set(tableColumns)
  const layoutBoxIds = new Set(listLayoutBoxIds(layoutOverrides || {}))

  for (const [key, val] of Object.entries(previewSampleRow)) {
    if (!key.startsWith(SAMPLE_ADORN_KEY_PREFIX)) continue
    const boxId = key.slice(SAMPLE_ADORN_KEY_PREFIX.length)
    const primary = getPrimaryColumnForBox(boxId, layoutOverrides)
    const isTableCol = tableColSet.has(boxId) || tableColSet.has(primary)
    const isKnownBox = layoutBoxIds.has(boxId) || isTableCol || isCustomLayoutBoxId(boxId, tableColumns)

    try {
      const adorn = parseSampleAdornment(JSON.parse(String(val)))
      if (!adorn.prefix.length && !adorn.suffix.length) continue
      // 已知编辑框直接保留；否则也保留（前台发布证书可能缺少完整 layout 快照）
      if (isKnownBox || tableColSet.size === 0) {
        result[boxId] = adorn
      }
    } catch {
      /* ignore invalid adornment */
    }
  }

  // 兜底：若过滤后为空，保留全部 __adorn__（与后台编辑页加载预设时一致）
  if (Object.keys(result).length === 0) {
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
  }

  return result
}

/**
 * 为 SVG 渲染合并表格列/编辑框的前后缀（不改变表格 UI 中的原内容）。
 */
export function applySampleAdornmentsToDisplayRow(
  row,
  tableColumns = [],
  layoutOverrides = {},
  adornments = {},
  debugFn = null,
) {
  const display = { ...(row || {}) }
  if (!row || !adornments || !Object.keys(adornments).length) {
    debugFn?.({
      step: 'skip-empty',
      reason: !row ? 'no-row' : !Object.keys(adornments || {}).length ? 'no-adornments' : 'unknown',
      adornmentKeys: Object.keys(adornments || {}),
      tableColumns,
      layoutKeys: Object.keys(layoutOverrides || {}),
    })
    return display
  }

  const tableColSet = new Set(tableColumns)
  const customIds = new Set(listCustomLayoutBoxIds(layoutOverrides, tableColumns))

  for (const [rawBoxId, adorn] of Object.entries(adornments)) {
    if (!adorn?.prefix?.length && !adorn.suffix?.length) {
      debugFn?.({ step: 'skip-adorn-empty', rawBoxId, adorn })
      continue
    }

    const boxId = resolveBoxId(rawBoxId, layoutOverrides)
    const primary = getPrimaryColumnForBox(boxId, layoutOverrides)
    const isTableCol = tableColSet.has(boxId) || tableColSet.has(primary)
    const isCustom = customIds.has(boxId)

    if (isCustom) {
      const segments = parseSampleStorage(String(row[boxId] ?? ''))
      segments.prefix = [...(adorn.prefix || []), ...(segments.prefix || [])]
      segments.suffix = [...(segments.suffix || []), ...(adorn.suffix || [])]
      display[boxId] = sampleSegmentsToDisplayText(segments)
      debugFn?.({
        step: 'apply-custom',
        rawBoxId,
        boxId,
        primary,
        result: display[boxId],
      })
      continue
    }

    let coreKey = tableColSet.has(primary) ? primary : (tableColSet.has(boxId) ? boxId : primary)
    if (!isTableCol && !isCustom) {
      const candidates = [coreKey, primary, boxId, rawBoxId].filter(Boolean)
      coreKey = candidates.find((k) => tableColSet.has(k) && k in row)
        ?? candidates.find((k) => k in row)
        ?? coreKey
      if (!layoutOverrides[boxId] && !layoutOverrides[rawBoxId] && !(coreKey in row)) {
        debugFn?.({
          step: 'skip-no-match',
          rawBoxId,
          boxId,
          primary,
          coreKey,
          isTableCol,
          isCustom,
          rowKeys: Object.keys(row),
          tableColumns,
          layoutKeys: Object.keys(layoutOverrides),
        })
        continue
      }
    }

    const core = row[coreKey] ?? row[boxId] ?? row[primary] ?? row[rawBoxId] ?? ''
    display[coreKey] = sampleSegmentsToDisplayText({
      prefix: [...(adorn.prefix || [])],
      core: String(core ?? ''),
      suffix: [...(adorn.suffix || [])],
    })
    debugFn?.({
      step: 'apply-table',
      rawBoxId,
      boxId,
      primary,
      coreKey,
      core,
      prefix: adorn.prefix,
      suffix: adorn.suffix,
      result: display[coreKey],
      isTableCol,
    })
  }

  return display
}

/**
 * 整理证书行：只保留表格列 + 自定义编辑框字段（后者不进表格 UI）。
 */
export function sanitizeCertificateRows(rows, tableColumns = [], layoutOverrides = {}, customFields = {}) {
  const customIds = new Set([
    ...listCustomLayoutBoxIds(layoutOverrides, tableColumns),
    ...Object.keys(customFields || {}),
  ])

  const normalized = (rows || []).map((r) => (
    r && typeof r === 'object' && r.row_data != null ? r.row_data : r
  ))
  const source = normalized.length ? normalized : [{}]

  return source.map((row) => {
    const next = {}
    for (const col of tableColumns) {
      next[col] = row[col] ?? ''
    }
    for (const boxId of customIds) {
      const existing = row[boxId]
      if (existing != null && String(existing).trim() !== '') {
        next[boxId] = existing
      } else if (customFields[boxId] != null && String(customFields[boxId]).trim() !== '') {
        next[boxId] = customFields[boxId]
      }
    }
    return next
  })
}

/**
 * @deprecated 请改用 sanitizeCertificateRows
 */
export function mergeCustomSamplesIntoRows(rows, customFields) {
  return sanitizeCertificateRows(rows, [], {}, customFields)
}

export function resolveCertificateLayoutOverrides(certOverrides, presetOverrides) {
  return mergeCertificatePresetLayout(certOverrides, presetOverrides)
}

function normalizeImportHeader(h) {
  return normalizeColumnKey(h)
}

export { resolveTemplateColumnOrder }

/**
 * 按表格模板列头映射 Excel 行（表头 trim 后精确匹配；可选手动列映射）。
 * @param {Record<string, unknown>[]} excelRows
 * @param {string[]} excelColumns
 * @param {string[]} templateColumns
 * @param {Record<string, string>} [columnMappings] 模板列 -> Excel 列名
 */
export function mapExcelImportToTemplateRows(excelRows, excelColumns, templateColumns, columnMappings = {}) {
  const templateCols = (templateColumns || []).map(normalizeImportHeader).filter(Boolean)
  const excelCols = (excelColumns || []).map(normalizeImportHeader).filter(Boolean)

  const excelKeyByNorm = new Map()
  for (const raw of excelColumns || []) {
    const norm = normalizeImportHeader(raw)
    if (norm && !excelKeyByNorm.has(norm)) excelKeyByNorm.set(norm, raw)
  }

  const templateSet = new Set(templateCols)
  const excelNormSet = new Set(excelCols)

  const normalizedMappings = {}
  for (const [templateCol, excelCol] of Object.entries(columnMappings || {})) {
    const t = normalizeImportHeader(templateCol)
    const e = normalizeImportHeader(excelCol)
    if (t && e) normalizedMappings[t] = e
  }

  const mappedExcelNorms = new Set(Object.values(normalizedMappings))

  const missingInExcel = templateCols.filter((c) => {
    if (excelNormSet.has(c)) return false
    if (normalizedMappings[c]) return false
    return true
  })
  const extraInExcel = excelCols.filter((c) => !templateSet.has(c) && !mappedExcelNorms.has(c))
  const matchedCount = templateCols.length - missingInExcel.length

  const rows = (excelRows || []).map((row) => {
    const next = {}
    for (const col of templateCols) {
      let excelKey = excelKeyByNorm.get(col)
      if (excelKey == null && normalizedMappings[col]) {
        excelKey = excelKeyByNorm.get(normalizedMappings[col])
      }
      if (excelKey != null && row && row[excelKey] != null) {
        next[col] = String(row[excelKey])
      } else {
        next[col] = ''
      }
    }
    return next
  })

  return {
    rows,
    missingInExcel,
    extraInExcel,
    matchedCount,
    templateColumnCount: templateCols.length,
  }
}

/** Excel 中未与模板列名直接匹配的列（可用于手动映射） */
export function listUnmatchedExcelColumns(excelColumns, templateColumns) {
  const templateSet = new Set((templateColumns || []).map(normalizeImportHeader))
  const seen = new Set()
  const result = []
  for (const raw of excelColumns || []) {
    const norm = normalizeImportHeader(raw)
    if (!norm || templateSet.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    result.push(norm)
  }
  return result
}

export function formatExcelImportColumnReport({
  rowCount,
  matchedCount,
  templateColumnCount,
  missingInExcel,
  extraInExcel,
}) {
  const missing = missingInExcel || []
  const extra = extraInExcel || []
  const lines = [`已导入 ${rowCount} 行，列匹配 ${matchedCount}/${templateColumnCount}`]

  if (missing.length) {
    lines.push('')
    lines.push('缺少的列（表格模板有，Excel 没有，对应单元格将留空）：')
    for (const col of missing) lines.push(`  ${col}`)
  }
  if (extra.length) {
    lines.push('')
    lines.push('多余的列（Excel 有，表格模板没有，未导入）：')
    for (const col of extra) lines.push(`  ${col}`)
  }

  return lines.join('\n')
}

/** 状态栏用单行摘要；有列差异时弹窗展示完整列式明细 */
export function formatExcelImportColumnReportSummary({
  rowCount,
  matchedCount,
  templateColumnCount,
  missingInExcel,
  extraInExcel,
}) {
  const missing = missingInExcel || []
  const extra = extraInExcel || []
  let msg = `已导入 ${rowCount} 行，列匹配 ${matchedCount}/${templateColumnCount}`
  if (missing.length || extra.length) {
    const parts = []
    if (missing.length) parts.push(`${missing.length} 列留空`)
    if (extra.length) parts.push(`${extra.length} 列未导入`)
    msg += `（${parts.join('，')}）`
  }
  return msg
}
