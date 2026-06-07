import * as XLSX from 'xlsx'

/** Excel 读取选项：保留公式、日期与数字格式 */
export const EXCEL_READ_OPTIONS = {
  type: 'array',
  cellFormula: true,
  cellDates: true,
  cellNF: true,
  cellText: true,
}

/**
 * 将工作表单元格格式化为与 Excel 显示一致的字符串
 * @param {import('xlsx').CellObject | undefined} cell
 * @param {string} [fallback='']
 */
export function formatExcelWorksheetCell(cell, fallback = '') {
  if (!cell || cell.t === 'z') {
    return fallback ?? ''
  }

  if (cell.w != null && String(cell.w).trim() !== '') {
    return String(cell.w)
  }

  if (cell.t != null) {
    try {
      const formatted = XLSX.utils.format_cell(cell)
      if (formatted != null && formatted !== '') {
        return String(formatted)
      }
    } catch {
      /* ignore */
    }
  }

  if (cell.v instanceof Date) {
    return formatDateLocal(cell.v)
  }

  if (cell.v != null) {
    return String(cell.v)
  }

  return fallback ?? ''
}

function formatDateLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
