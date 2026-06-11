import * as XLSX from 'xlsx'

/** Excel 读取选项：保留公式、日期与数字格式 */
export const EXCEL_READ_OPTIONS = {
  type: 'array',
  cellFormula: true,
  cellDates: true,
  cellNF: true,
  cellText: true,
  cellStyles: true,
}

const CHINESE_DATE_TEXT_RE = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/
const WESTERN_ISO_DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|T|$)/
const US_SHORT_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/

/**
 * @param {import('xlsx').WorkBook} [wb]
 * @param {import('xlsx').CellObject | undefined} cell
 */
export function resolveWorkbookCellFormat(wb, cell) {
  if (!cell) return ''
  if (cell.z != null && String(cell.z).trim() !== '') {
    return String(cell.z)
  }
  const styleIdx = cell.s
  if (styleIdx == null || !wb) return ''
  try {
    const xf = wb.Styles?.CellXf?.[styleIdx]
    if (!xf) return ''
    const fmtId = xf.numFmtId
    if (fmtId == null) return ''
    if (fmtId >= 164 && wb.SSF?.[fmtId]) {
      return String(wb.SSF[fmtId])
    }
    const table = XLSX.SSF?.get_table?.()
    if (table && table[fmtId]) {
      return String(table[fmtId])
    }
  } catch {
    // ignore
  }
  return ''
}

/** @param {number} n */
function isExcelDateSerial(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 20000 && n <= 120000
}

/** @param {string} text */
function isUsShortDateText(text) {
  return US_SHORT_DATE_RE.test(String(text || '').trim())
}

/** @param {string} text */
function isWesternDateText(text) {
  const s = String(text || '').trim()
  return isUsShortDateText(s) || WESTERN_ISO_DATE_RE.test(s)
}

/** @param {string} text */
function parseUsShortDateText(text) {
  const m = String(text).trim().match(US_SHORT_DATE_RE)
  if (!m) return null
  let y = Number(m[3])
  if (y < 100) y += y >= 30 ? 1900 : 2000
  return { y, m: Number(m[1]), d: Number(m[2]) }
}

/** @param {string} text */
function parseWesternDateText(text) {
  const s = String(text || '').trim()
  if (CHINESE_DATE_TEXT_RE.test(s)) return null
  const us = parseUsShortDateText(s)
  if (us) return us
  const iso = s.match(WESTERN_ISO_DATE_RE)
  if (!iso) return null
  return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) }
}

/**
 * @param {import('xlsx').CellObject | undefined} cell
 * @param {string} nf
 * @param {string} fallbackText
 */
function shouldFormatAsChineseDate(cell, nf, fallbackText) {
  if (isChineseDateNumberFormat(nf)) return true
  const w = cell?.w != null ? String(cell.w).trim() : ''
  if (CHINESE_DATE_TEXT_RE.test(w) || CHINESE_DATE_TEXT_RE.test(fallbackText)) return true
  if (!cell) return isUsShortDateText(fallbackText)
  if (isDateLikeCell(cell) && (isWesternDateText(w) || isWesternDateText(fallbackText))) {
    return true
  }
  return false
}

/**
 * @param {import('xlsx').CellObject | undefined} cell
 */
function isDateLikeCell(cell) {
  if (!cell) return false
  if (cell.v instanceof Date || cell.t === 'd') return true
  if (typeof cell.v === 'number' && isExcelDateSerial(cell.v)) {
    if (cell.z && /[yYmMdD年月日]/.test(String(cell.z))) return true
    if (cell.w && isWesternDateText(String(cell.w))) return true
    if (cell.t === 'n') return true
  }
  return false
}

/** @param {string} text */
function parseChineseDateText(text) {
  const m = String(text || '').trim().match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/** @param {import('xlsx').CellObject | undefined} cell */
function excelCellToDateParts(cell) {
  if (!cell) return null
  if (cell.w) {
    const w = String(cell.w).trim()
    const chinese = parseChineseDateText(w)
    if (chinese) return chinese
    if (isWesternDateText(w)) return parseWesternDateText(w)
  }
  if (cell.v instanceof Date) {
    return {
      y: cell.v.getFullYear(),
      m: cell.v.getMonth() + 1,
      d: cell.v.getDate(),
    }
  }
  if (typeof cell.v === 'number' && isExcelDateSerial(cell.v)) {
    const parsed = XLSX.SSF?.parse_date_code?.(cell.v)
    if (parsed) {
      return { y: parsed.y, m: parsed.m, d: parsed.d }
    }
    const d = excelSerialToLocalDate(cell.v)
    if (!d) return null
    return {
      y: d.getFullYear(),
      m: d.getMonth() + 1,
      d: d.getDate(),
    }
  }
  return null
}

/** @param {string} nf */
function isChineseDateNumberFormat(nf) {
  return /年/.test(nf) && /月/.test(nf) && /日/.test(nf)
}

/** @param {{ y: number, m: number, d: number }} parts */
function formatChineseDateParts(parts) {
  return `${parts.y}年${parts.m}月${parts.d}日`
}

/**
 * @param {import('xlsx').CellObject | undefined} cell
 * @param {string} nf
 * @param {string} fallbackText
 */
function formatChineseDateCell(cell, nf, fallbackText) {
  const parts = excelCellToDateParts(cell) || parseWesternDateText(fallbackText)
  if (!parts) return null
  return formatChineseDateParts(parts)
}

/**
 * @param {import('xlsx').CellObject | undefined} cell
 * @param {string} nf
 */
function formatDateCellWithNumberFormat(cell, nf) {
  const parts = excelCellToDateParts(cell)
  if (!parts) return null
  if (isChineseDateNumberFormat(nf)) {
    return formatChineseDateParts(parts)
  }
  try {
    const value = cell?.v instanceof Date ? cell.v : cell?.v
    const formatted = XLSX.SSF.format(nf, value)
    if (formatted != null && formatted !== '') {
      return String(formatted)
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * 将工作表单元格格式化为与 Excel 显示一致的字符串
 * @param {import('xlsx').CellObject | undefined} cell
 * @param {string} [fallback='']
 * @param {import('xlsx').WorkBook} [wb]
 */
export function formatExcelWorksheetCell(cell, fallback = '', wb) {
  if (!cell || cell.t === 'z') {
    if (fallback && CHINESE_DATE_TEXT_RE.test(fallback)) return String(fallback)
    if (fallback && shouldFormatAsChineseDate(undefined, '', fallback)) {
      const chinese = formatChineseDateCell(undefined, '', fallback)
      if (chinese) return chinese
    }
    return fallback ?? ''
  }

  const nf = resolveWorkbookCellFormat(wb, cell)
  const fallbackText = fallback != null ? String(fallback) : ''

  if ((cell.t === 's' || cell.t === 'str') && cell.v != null && String(cell.v).trim() !== '') {
    return String(cell.v)
  }

  if (fallbackText && CHINESE_DATE_TEXT_RE.test(fallbackText)) {
    return fallbackText
  }

  if (shouldFormatAsChineseDate(cell, nf, fallbackText)) {
    const chinese = formatChineseDateCell(cell, nf, fallbackText)
    if (chinese) return chinese
  }

  if (cell.w != null && String(cell.w).trim() !== '') {
    const w = String(cell.w).trim()
    if (CHINESE_DATE_TEXT_RE.test(w)) return w
    if (!isDateLikeCell(cell)) return w
  }

  if (isDateLikeCell(cell)) {
    const fromNf = nf ? formatDateCellWithNumberFormat(cell, nf) : null
    if (fromNf) return fromNf
    const parts = excelCellToDateParts(cell)
    if (parts) return formatChineseDateParts(parts)
  }

  if (cell.t != null) {
    try {
      const formatted = XLSX.utils.format_cell(cell)
      if (formatted != null && formatted !== '') {
        const text = String(formatted)
        if (CHINESE_DATE_TEXT_RE.test(text)) return text
        if (shouldFormatAsChineseDate(cell, nf, text)) {
          const chinese = formatChineseDateCell(cell, nf, text)
          if (chinese) return chinese
        }
        if (!isDateLikeCell(cell)) return text
      }
    } catch {
      /* ignore */
    }
  }

  if (cell.v instanceof Date) {
    return formatChineseDateParts({
      y: cell.v.getFullYear(),
      m: cell.v.getMonth() + 1,
      d: cell.v.getDate(),
    })
  }

  if (typeof cell.v === 'number' && isExcelDateSerial(cell.v)) {
    const parts = excelCellToDateParts(cell)
    if (parts) return formatChineseDateParts(parts)
  }

  if (cell.v != null) {
    return String(cell.v)
  }

  return fallbackText
}

/** Excel 序列号 → 本地日期（1900 日期系统） */
function excelSerialToLocalDate(serial) {
  if (!Number.isFinite(serial)) return null
  const whole = Math.floor(serial)
  if (whole <= 0) return null
  const ms = (whole - 25569) * 86400 * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}
