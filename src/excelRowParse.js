import * as XLSX from 'xlsx'
import { isDispImgFormula } from './excelEmbeddedImages.js'
import { EXCEL_READ_OPTIONS, formatExcelWorksheetCell } from './excelCellFormat.js'
import { findExcelHeaderRowIndex } from './excelHeaderDetect.js'
import { loadExcelZipArchive, summarizeExcelZip } from './excelZipPreload.js'
import { yieldToMain } from './asyncYield.js'

const ROW_PROGRESS_CHUNK = 50
const LARGE_FILE_BYTES = 8 * 1024 * 1024

/** @param {number} bytes */
function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** @param {import('xlsx').WorkSheet | undefined} ws */
function describeSheetRange(ws) {
  const ref = ws?.['!ref']
  if (!ref) return ''
  try {
    const range = XLSX.utils.decode_range(ref)
    const rows = range.e.r - range.s.r + 1
    const cols = range.e.c - range.s.c + 1
    return `约 ${rows} 行 × ${cols} 列`
  } catch {
    return ''
  }
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @param {{ templateColumns?: string[] }} [options]
 * @param {(info: { percent: number, label: string, detail?: string }) => void} [onProgress]
 */
export function parseExcelWorkbook(wb, options = {}, onProgress) {
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { columns: [], data: [], worksheet: undefined, headerRow: [], headerRowIndex: 0, excelRowNumbers: [] }
  }
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    return { columns: [], data: [], worksheet: undefined, headerRow: [], headerRowIndex: 0, excelRowNumbers: [] }
  }

  const rangeHint = describeSheetRange(ws)
  onProgress?.({
    percent: 48,
    label: '正在展开工作表…',
    detail: rangeHint
      ? `工作表「${sheetName}」${rangeHint}，正在转换为二维数组…`
      : `工作表「${sheetName}」，正在转换为二维数组…`,
  })
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })

  if (rows.length === 0) {
    return { columns: [], data: [], worksheet: ws, headerRow: [], headerRowIndex: 0, excelRowNumbers: [] }
  }

  onProgress?.({
    percent: 52,
    label: '正在识别表头…',
    detail: `工作表共 ${rows.length} 行（含表头），正在匹配模板列名…`,
  })
  const headerRowIndex = findExcelHeaderRowIndex(rows, options.templateColumns)
  const headers = (rows[headerRowIndex] || []).map((h) => String(h ?? '').trim())
  const dataRowEstimate = Math.max(0, rows.length - headerRowIndex - 1)
  onProgress?.({
    percent: 54,
    label: '正在解析数据行…',
    detail: [
      `表头在第 ${headerRowIndex + 1} 行`,
      `列：${headers.filter(Boolean).join('、') || '（无）'}`,
      `待扫描约 ${dataRowEstimate} 行`,
    ].join('\n'),
  })
  const data = []
  /** @type {number[]} */
  const excelRowNumbers = []

  const dataStart = headerRowIndex + 1
  const dataEnd = rows.length
  const totalDataRows = Math.max(1, dataEnd - dataStart)
  const chunk = totalDataRows > 400 ? 25 : ROW_PROGRESS_CHUNK

  for (let i = dataStart; i < dataEnd; i++) {
    const row = rows[i]
    if (!row || row.every((c) => c === '' || c == null)) continue

    const record = {}
    headers.forEach((h, j) => {
      if (!h) return
      const cellRef = XLSX.utils.encode_cell({ r: i, c: j })
      const cell = ws[cellRef]
      const rowVal = formatExcelWorksheetCell(cell, row[j] != null ? String(row[j]) : '')
      const raw = cell?.f ?? cell?.v ?? cell?.w ?? rowVal
      if (isDispImgFormula(raw)) {
        record[h] = raw.startsWith('=') ? raw : `=${raw}`
      } else {
        record[h] = rowVal
      }
    })
    if (Object.keys(record).length) {
      data.push(record)
      excelRowNumbers.push(i)
    }

    const processed = i - dataStart + 1
    if (onProgress && (processed % chunk === 0 || processed === totalDataRows)) {
      const pct = 56 + Math.round((processed / totalDataRows) * 6)
      onProgress({
        percent: pct,
        label: `正在解析数据行 ${processed}/${totalDataRows}`,
        detail: `已读取 ${data.length} 条有效记录（跳过空行）`,
      })
    }
  }

  onProgress?.({
    percent: 62,
    label: 'Excel 解析完成',
    detail: `共 ${data.length} 行、${headers.filter(Boolean).length} 列`,
  })

  return {
    columns: headers.filter(Boolean),
    data,
    worksheet: ws,
    headerRow: headers,
    headerRowIndex,
    excelRowNumbers,
  }
}

/**
 * 解压进度完成后，用 SheetJS 解析工作簿（read 仅支持 array/buffer，不支持 type:zip）
 * @param {ArrayBuffer} buffer
 * @param {{ templateColumns?: string[] }} [options]
 * @param {(info: { percent: number, label: string, detail?: string }) => void} [onProgress]
 * @param {ReturnType<summarizeExcelZip>} [zipSummary]
 */
export function parseExcelAfterZipPreload(buffer, options = {}, onProgress, zipSummary) {
  const summary = zipSummary || {}
  onProgress?.({
    percent: 40,
    label: '正在解析工作簿 XML…',
    detail: [
      '解压已完成，SheetJS 正在读取 workbook / worksheet / sharedStrings',
      '（此步骤会再次扫描压缩包，大文件可能仍需 1–2 分钟）',
      summary.mediaCount ? `含 ${summary.mediaCount} 个嵌入媒体，解析可能较慢` : '',
    ].filter(Boolean).join('\n'),
  })
  const wb = XLSX.read(new Uint8Array(buffer), EXCEL_READ_OPTIONS)
  const sheetName = wb.SheetNames[0] || ''
  onProgress?.({
    percent: 46,
    label: '工作簿已解析',
    detail: sheetName
      ? `首个工作表：「${sheetName}」${describeSheetRange(wb.Sheets[sheetName]) ? `，${describeSheetRange(wb.Sheets[sheetName])}` : ''}`
      : '未找到工作表',
  })
  return parseExcelWorkbook(wb, options, onProgress)
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ templateColumns?: string[] }} [options]
 * @param {(info: { percent: number, label: string, detail?: string }) => void} [onProgress]
 */
export async function parseExcelFromBufferAsync(buffer, options = {}, onProgress) {
  const byteLen = buffer?.byteLength || 0
  const useZipPipeline = byteLen >= LARGE_FILE_BYTES

  if (useZipPipeline) {
    const { zip, summary } = await loadExcelZipArchive(buffer, onProgress)
    const parsed = parseExcelAfterZipPreload(buffer, options, onProgress, summary)
    return { ...parsed, zipSummary: summary }
  }

  onProgress?.({
    percent: 4,
    label: '正在读取工作簿…',
    detail: byteLen
      ? `文件 ${formatBytes(byteLen)}，正在解析 xlsx 结构`
      : '正在解析 xlsx 结构',
  })
  await yieldToMain()
  const wb = XLSX.read(buffer, EXCEL_READ_OPTIONS)
  const sheetName = wb.SheetNames[0] || ''
  onProgress?.({
    percent: 10,
    label: '工作簿已打开',
    detail: sheetName
      ? `工作表「${sheetName}」${describeSheetRange(wb.Sheets[sheetName]) ? `，${describeSheetRange(wb.Sheets[sheetName])}` : ''}`
      : '未找到工作表',
  })
  return parseExcelWorkbook(wb, options, onProgress)
}

/** 同步入口（小文件或降级） */
export function parseExcelFromBuffer(buffer, options = {}, onProgress) {
  const byteLen = buffer?.byteLength || 0
  onProgress?.({
    percent: 4,
    label: '正在读取工作簿…',
    detail: byteLen ? `文件 ${formatBytes(byteLen)}` : '',
  })
  const wb = XLSX.read(buffer, EXCEL_READ_OPTIONS)
  return parseExcelWorkbook(wb, options, onProgress)
}
