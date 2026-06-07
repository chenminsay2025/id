import { normalizeColumnKey } from './zhColumnNormalize.js'

const MAX_HEADER_SCAN_ROWS = 30

export function normalizeExcelHeaderCell(value) {
  return String(value ?? '').trim()
}

function isLikelyDataCell(value) {
  const s = normalizeExcelHeaderCell(value)
  if (!s) return false
  if (/^\d+(\.\d+)?$/.test(s)) return true
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) return true
  return false
}

function scoreHeaderRowWithoutTemplate(row) {
  const cells = (row || []).map(normalizeExcelHeaderCell)
  const nonEmpty = cells.filter(Boolean)
  if (nonEmpty.length === 0) return -1

  let textLike = 0
  let dataLike = 0
  for (const c of nonEmpty) {
    if (isLikelyDataCell(c)) dataLike += 1
    else textLike += 1
  }
  if (dataLike > textLike) return -1

  const uniqueRatio = new Set(nonEmpty).size / nonEmpty.length
  return nonEmpty.length * 3 + textLike * 2 + uniqueRatio * 5
}

function scoreHeaderRowWithTemplate(row, templateColumns) {
  const templateSet = new Set(
    (templateColumns || []).map((c) => normalizeColumnKey(c)).filter(Boolean),
  )
  if (templateSet.size === 0) return scoreHeaderRowWithoutTemplate(row)

  const cells = (row || []).map(normalizeExcelHeaderCell).filter(Boolean)
  if (cells.length === 0) return -1

  let matches = 0
  for (const c of cells) {
    if (templateSet.has(normalizeColumnKey(c))) matches += 1
  }
  if (matches === 0) return -1

  return matches * 100 + cells.length
}

/**
 * 在前若干行中定位 Excel 表头行（0-based）。
 * 有模板列时优先匹配列名；否则用「多列文本、少数字」启发式，避免把标题行当表头。
 * @param {unknown[][]} rows
 * @param {string[]} [templateColumns]
 */
export function findExcelHeaderRowIndex(rows, templateColumns) {
  const scanLimit = Math.min((rows || []).length, MAX_HEADER_SCAN_ROWS)
  if (scanLimit === 0) return 0

  const hasTemplate = (templateColumns || []).some((c) => normalizeExcelHeaderCell(c))
  const scoreRow = hasTemplate
    ? (row) => scoreHeaderRowWithTemplate(row, templateColumns)
    : scoreHeaderRowWithoutTemplate

  let bestIdx = 0
  let bestScore = -Infinity

  for (let i = 0; i < scanLimit; i++) {
    const score = scoreRow(rows[i])
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  if (hasTemplate && bestScore < 0) {
    bestIdx = 0
    bestScore = -Infinity
    for (let i = 0; i < scanLimit; i++) {
      const score = scoreHeaderRowWithoutTemplate(rows[i])
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
  }

  return bestIdx
}
