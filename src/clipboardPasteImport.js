import {
  clipboardPastePayload,
  parseTSVExcel,
  readClipboardHtml,
  readClipboardPlainText,
} from './svgEngine.js'
import {
  isDispImgFormula,
  parseDispImgId,
  replaceDispImgCellsInRows,
} from './excelEmbeddedImages.js'
import { findExcelHeaderRowIndex, normalizeExcelHeaderCell } from './excelHeaderDetect.js'
import { mapExcelImportToTemplateRows } from './presetSampleRow.js'
import { formatImageCellValue } from './cellMedia.js'
import { dataUrlToFile } from './clipboardImages.js'

const DISPIMG_ID_IN_HTML_RE = /ID_[0-9A-F]{32}/gi
const WPS_CLIP_IMAGE_RE = /clip_cell_image(\d+)\.png/gi

/** 解析前去掉 file:// 引用，避免浏览器尝试加载本地临时文件 */
export function sanitizeClipboardHtmlForParse(html) {
  if (!html) return ''
  return html
    .replace(/(<img\b[^>]*\s)src\s*=\s*["']file:[^"']*["']/gi, '$1src=""')
    .replace(/src\s*=\s*["']file:[^"']*["']/gi, 'src=""')
    .replace(/url\s*\(\s*['"]?file:[^)'"]+['"]?\s*\)/gi, 'url("")')
}

function matchAllGlobal(text, re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const globalRe = new RegExp(re.source, flags)
  return [...String(text).matchAll(globalRe)]
}

function rowMatrixIsEmpty(cells) {
  if (!cells?.length) return true
  return cells.every((c) => !String(c ?? '').trim())
}

function dispImgIdVariants(id) {
  const s = String(id || '').trim()
  if (!s) return []
  const variants = new Set([s, s.toUpperCase(), s.toLowerCase()])
  if (/^ID_/i.test(s)) variants.add(s.replace(/^ID_/i, ''))
  else variants.add(`ID_${s}`)
  return [...variants]
}

function lookupDispImgHtmlMap(map, id) {
  for (const key of dispImgIdVariants(id)) {
    if (map.has(key)) return map.get(key)
  }
  return null
}

/** 从 WPS HTML 剪贴板建立 DISPIMG ID → data URL 映射（不加载 file://） */
export function extractWpsClipboardImageMap(html) {
  /** @type {Map<string, string>} */
  const map = new Map()
  if (!html) return map

  const safeHtml = sanitizeClipboardHtmlForParse(html)
  const div = document.createElement('div')
  div.innerHTML = safeHtml

  for (const img of div.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('data:image')) continue
    const attrs = [img.id, img.name, img.alt, img.title, img.getAttribute('data-id')]
    for (const attr of attrs) {
      const m = String(attr || '').match(/ID_[0-9A-F]{32}/i)
      if (m) {
        for (const v of dispImgIdVariants(m[0])) map.set(v, src)
      }
    }
  }

  const dataUrls = matchAllGlobal(html, /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi).map((m) => m[0])
  const ids = matchAllGlobal(html, /ID_[0-9A-F]{32}/gi).map((m) => m[0])
  if (dataUrls.length === ids.length && dataUrls.length > 0) {
    for (let i = 0; i < ids.length; i++) {
      for (const v of dispImgIdVariants(ids[i])) map.set(v, dataUrls[i])
    }
  }

  return map
}

/** WPS clip_cell_imageN.png 出现顺序 → 剪贴板 PNG 文件 */
export function buildWpsClipImageFileMap(html, pngFiles) {
  /** @type {Map<number, File>} */
  const map = new Map()
  if (!html || !pngFiles.length) return map

  const orderedNums = matchAllGlobal(html, WPS_CLIP_IMAGE_RE).map((m) => Number(m[1]))
  if (!orderedNums.length) return map

  if (orderedNums.length === pngFiles.length) {
    for (let i = 0; i < orderedNums.length; i++) {
      map.set(orderedNums[i], pngFiles[i])
    }
    return map
  }

  const minLen = Math.min(orderedNums.length, pngFiles.length)
  for (let i = 0; i < minLen; i++) {
    map.set(orderedNums[i], pngFiles[i])
  }
  return map
}

function extractClipNumFromCellHtml(cellHtml) {
  const m = String(cellHtml || '').match(/clip_cell_image(\d+)\.png/i)
  return m ? Number(m[1]) : null
}

export function collectClipboardImageFiles(clipboardData) {
  /** @type {File[]} */
  const files = []
  if (!clipboardData) return files

  const seen = new Set()
  const add = (file) => {
    if (!file) return
    const type = String(file.type || '').toLowerCase()
    if (!type.startsWith('image/')) return
    const key = `${file.size}:${type}:${file.name || ''}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  if (clipboardData.files?.length) {
    for (const file of clipboardData.files) add(file)
  }

  if (clipboardData.items) {
    for (const item of clipboardData.items) {
      if (item.kind !== 'file') continue
      if (!String(item.type || '').toLowerCase().startsWith('image/')) continue
      add(item.getAsFile())
    }
  }

  return files
}

/** 从 navigator.clipboard.read 补读 PNG（部分浏览器 paste 事件里 items 为空） */
export async function readClipboardImageFilesAsync() {
  if (!navigator.clipboard?.read) return []
  try {
    const items = await navigator.clipboard.read()
    /** @type {File[]} */
    const files = []
    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith('image/')) continue
        const blob = await item.getType(type)
        files.push(new File([blob], `clipboard-${files.length + 1}.png`, { type: blob.type || 'image/png' }))
      }
    }
    return files
  } catch {
    return []
  }
}

/** WPS 剪贴板 PNG：最大的一张常为「整格/选区」渲染图，不是嵌入图 */
export function stripWpsCellRenderSnapshots(files) {
  if (!files || files.length < 2) return [...(files || [])]
  const sorted = [...files].sort((a, b) => a.size - b.size)
  const largest = sorted[sorted.length - 1]
  const second = sorted[sorted.length - 2]
  if (largest.size > second.size * 1.35) {
    return files.filter((f) => f !== largest)
  }
  return [...files]
}

/**
 * 从 WPS 剪贴板 PNG 中选出嵌入图（非整格截图）。
 * @param {File[]} files
 * @param {string} html
 * @param {{ singleCell?: boolean }} [options]
 * @returns {File | null}
 */
export function pickWpsEmbeddedImageFile(files, html, { singleCell = false } = {}) {
  if (!files?.length) return null

  const clipCount = matchAllGlobal(html || '', WPS_CLIP_IMAGE_RE).length
  let candidates = stripWpsCellRenderSnapshots(files)

  if (clipCount > 0 && candidates.length > clipCount) {
    while (candidates.length > clipCount) {
      let maxIdx = 0
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].size > candidates[maxIdx].size) maxIdx = i
      }
      candidates.splice(maxIdx, 1)
    }
  }

  if (singleCell) {
    // 单格复制时若只有 1 张 PNG，WPS 通常给的是整格截图而非嵌入图
    if (files.length === 1 && clipCount <= 1) return null
    if (!candidates.length) return null

    const clipMap = buildWpsClipImageFileMap(html || '', candidates)
    if (clipMap.size === 1) return clipMap.values().next().value

    const sorted = [...candidates].sort((a, b) => a.size - b.size)
    return sorted.find((f) => f.size > 800) || sorted[0]
  }

  if (!candidates.length) return files[0]
  return candidates[0]
}

/** WPS 剪贴板可能附带整张表格截图 + 各单元格 PNG，按 clip 数量对齐并尽量保持原始顺序 */
export function alignWpsPngFilesToSlots(pngFiles, html, slotCount) {
  if (!pngFiles.length || !slotCount) return []
  const clipCount = matchAllGlobal(html || '', WPS_CLIP_IMAGE_RE).length
  const target = clipCount || slotCount

  let files = stripWpsCellRenderSnapshots(pngFiles)

  if (files.length === target) return files

  if (files.length === target + 1) {
    let maxIdx = 0
    for (let i = 1; i < files.length; i++) {
      if (files[i].size > files[maxIdx].size) maxIdx = i
    }
    return files.filter((_, i) => i !== maxIdx)
  }

  if (files.length > target) {
    while (files.length > target) {
      let maxIdx = 0
      for (let i = 1; i < files.length; i++) {
        if (files[i].size > files[maxIdx].size) maxIdx = i
      }
      files = files.filter((_, i) => i !== maxIdx)
    }
    return files
  }

  return files
}

/** 按表头列顺序 row-major 收集 DISPIMG 单元格 */
function collectDispImgSlotsRowMajor(rows, excelColumns) {
  /** @type {{ ri: number, col: string }[]} */
  const slots = []
  for (let ri = 0; ri < rows.length; ri++) {
    for (const col of excelColumns) {
      if (isDispImgFormula(rows[ri][col])) slots.push({ ri, col })
    }
  }
  return slots
}

export async function extractClipboardXlsxBuffer(clipboardData) {
  if (!clipboardData) return null

  const tryFile = async (file) => {
    if (!file) return null
    const name = (file.name || '').toLowerCase()
    const type = (file.type || '').toLowerCase()
    if (
      name.endsWith('.xlsx')
      || name.endsWith('.xls')
      || name.endsWith('.et')
      || type.includes('spreadsheetml')
      || type.includes('ms-excel')
    ) {
      const buf = await file.arrayBuffer()
      if (buf.byteLength > 4) {
        const u8 = new Uint8Array(buf)
        if (u8[0] === 0x50 && u8[1] === 0x4b) return buf
      }
    }
    const buf = await file.arrayBuffer()
    if (buf.byteLength > 4) {
      const u8 = new Uint8Array(buf)
      if (u8[0] === 0x50 && u8[1] === 0x4b) return buf
    }
    return null
  }

  if (clipboardData.files?.length) {
    for (const f of clipboardData.files) {
      const buf = await tryFile(f)
      if (buf) return buf
    }
  }

  if (clipboardData.items) {
    for (const item of clipboardData.items) {
      if (item.kind !== 'file') continue
      const buf = await tryFile(item.getAsFile())
      if (buf) return buf
    }
  }

  return null
}

/**
 * @param {string[][]} grid
 * @param {string} html
 * @param {string[]} templateColumns
 */
export function buildPasteImportFromGrid(grid, html, templateColumns) {
  if (!grid?.length) {
    return {
      excelRows: [],
      excelColumns: [],
      images: [],
      dispImgHtmlMap: extractWpsClipboardImageMap(html),
      headerRowIndex: 0,
      html: html || '',
    }
  }

  const headerRowIndex = findExcelHeaderRowIndex(grid, templateColumns)
  const headers = (grid[headerRowIndex] || []).map(normalizeExcelHeaderCell)
  const excelColumns = headers.filter(Boolean)
  const dispImgHtmlMap = extractWpsClipboardImageMap(html)
  const { images: gridImages } = html
    ? parseGridImagesFromHtml(html, headers, headerRowIndex)
    : { images: [] }

  /** @type {Record<string, string>[]} */
  const excelRows = []
  /** @type {{ row: number, excelColName: string, dataUrl?: string, dispImgId?: string, clipNum?: number }[]} */
  const images = []

  for (let ri = headerRowIndex + 1; ri < grid.length; ri++) {
    const cells = grid[ri]
    if (rowMatrixIsEmpty(cells)) continue

    const record = {}
    headers.forEach((h, j) => {
      if (!h) return
      record[h] = String(cells[j] ?? '').trim()
    })
    const dataRowIdx = excelRows.length
    excelRows.push(record)

    for (const im of gridImages) {
      if (im.sourceRow === ri) {
        images.push({
          row: dataRowIdx,
          excelColName: im.excelColName,
          dataUrl: im.dataUrl,
          dispImgId: im.dispImgId,
          clipNum: im.clipNum,
        })
      }
    }

    for (const h of excelColumns) {
      const id = parseDispImgId(record[h])
      if (!id) continue
      const existing = images.find((im) => im.row === dataRowIdx && im.excelColName === h)
      if (existing) {
        if (!existing.dispImgId) existing.dispImgId = id
        continue
      }
      images.push({ row: dataRowIdx, excelColName: h, dispImgId: id })
    }
  }

  return { excelRows, excelColumns, images, dispImgHtmlMap, headerRowIndex, html }
}

function parseGridImagesFromHtml(html, headers, headerRowIndex) {
  /** @type {{ sourceRow: number, excelColName: string, dataUrl?: string, dispImgId?: string, clipNum?: number }[]} */
  const images = []
  if (!html || !headers.length) return { images }

  const safeHtml = sanitizeClipboardHtmlForParse(html)
  const div = document.createElement('div')
  div.innerHTML = safeHtml
  const trs = [...div.querySelectorAll('table tr, tr')]

  for (let ri = 0; ri < trs.length; ri++) {
    if (ri <= headerRowIndex) continue
    const cells = [...trs[ri].querySelectorAll('th, td')]
    if (!cells.length) continue
    const hasContent = cells.some((c) => {
      const text = String(c.innerText || c.textContent || '').trim()
      return text || /clip_cell_image\d+\.png/i.test(c.innerHTML) || c.querySelector('img')
    })
    if (!hasContent) continue

    cells.forEach((cell, j) => {
      const colName = headers[j]
      if (!colName) return
      const cellHtml = cell.innerHTML || ''
      const clipNum = extractClipNumFromCellHtml(cellHtml)
      const img = cell.querySelector('img')
      const src = img?.getAttribute('src') || ''
      const dataUrl = src.startsWith('data:image') ? src : null
      const text = String(cell.innerText || cell.textContent || '').trim()
      const dispImgId = parseDispImgId(text)
      if (dataUrl || dispImgId || clipNum != null) {
        images.push({
          sourceRow: ri,
          excelColName: colName,
          dataUrl: dataUrl || undefined,
          dispImgId: dispImgId || undefined,
          clipNum: clipNum ?? undefined,
        })
      }
    })
  }
  return { images }
}

export function parseClipboardImportPayloadSync(clipboardData, templateColumns) {
  const html = readClipboardHtml(clipboardData)
  const payload = clipboardPastePayload(clipboardData)
  let grid = payload.grid
  if (!grid.length) {
    const plain = readClipboardPlainText(clipboardData)
    if (plain.trim()) grid = parseTSVExcel(plain)
  }
  return buildPasteImportFromGrid(grid, html, templateColumns)
}

export function parseTextImportPayloadSync(text, templateColumns) {
  const grid = parseTSVExcel(text)
  return buildPasteImportFromGrid(grid, '', templateColumns)
}

async function uploadDataUrl(dataUrl, id, uploadMedia, urlCache) {
  const cacheKey = String(id || dataUrl).toUpperCase()
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey)
  const file = await dataUrlToFile(dataUrl, `paste-${String(id || 'img').slice(-12)}`)
  const { url } = await uploadMedia(file)
  urlCache.set(cacheKey, url)
  return url
}

async function resolveDispImgFromHtmlMap(rows, htmlMap, uploadMedia, stats) {
  const next = rows.map((r) => ({ ...r }))
  const urlCache = new Map()
  for (let ri = 0; ri < next.length; ri++) {
    for (const col of Object.keys(next[ri])) {
      if (!isDispImgFormula(next[ri][col])) continue
      const id = parseDispImgId(next[ri][col])
      if (!id) continue
      const dataUrl = lookupDispImgHtmlMap(htmlMap, id)
      if (!dataUrl) continue
      try {
        const url = await uploadDataUrl(dataUrl, id, uploadMedia, urlCache)
        next[ri][col] = formatImageCellValue(url)
        stats.uploaded += 1
        stats.fromHtml += 1
      } catch {
        stats.missing += 1
      }
    }
  }
  return next
}

async function resolveWpsClipImageSlots(rows, images, clipFileMap, uploadMedia, stats) {
  const next = rows.map((r) => ({ ...r }))
  const urlCache = new Map()

  for (const im of images) {
    const row = next[im.row]
    if (!row || !im.excelColName) continue
    const current = row[im.excelColName]
    const needsImage = isDispImgFormula(current) || im.clipNum != null || im.dataUrl
    if (!needsImage) continue
    if (!isDispImgFormula(current) && current && !im.dataUrl && im.clipNum == null) continue

    try {
      if (im.clipNum != null && clipFileMap.has(im.clipNum)) {
        const { url } = await uploadMedia(clipFileMap.get(im.clipNum))
        row[im.excelColName] = formatImageCellValue(url)
        stats.uploaded += 1
        stats.fromFiles += 1
        continue
      }
      if (im.dataUrl?.startsWith('data:image')) {
        const url = await uploadDataUrl(im.dataUrl, im.excelColName, uploadMedia, urlCache)
        row[im.excelColName] = formatImageCellValue(url)
        stats.uploaded += 1
        stats.fromHtml += 1
      }
    } catch {
      stats.missing += 1
    }
  }
  return next
}

async function resolveDispImgFromWpsClipboard(rows, parsed, pngFiles, uploadMedia, stats) {
  const slots = collectDispImgSlotsRowMajor(rows, parsed.excelColumns)
  if (!slots.length) return rows

  let files = alignWpsPngFilesToSlots(pngFiles, parsed.html || '', slots.length)
  const next = rows.map((r) => ({ ...r }))

  if (files.length === slots.length) {
    for (let i = 0; i < slots.length; i++) {
      const { ri, col } = slots[i]
      try {
        const { url } = await uploadMedia(files[i])
        next[ri][col] = formatImageCellValue(url)
        stats.uploaded += 1
        stats.fromFiles += 1
      } catch {
        stats.missing += 1
      }
    }
    return next
  }

  const clipFileMap = buildWpsClipImageFileMap(parsed.html || '', files)
  if (clipFileMap.size) {
    return resolveWpsClipImageSlots(next, parsed.images, clipFileMap, uploadMedia, stats)
  }

  return next
}

async function resolveDispImgFromOrderedFiles(rows, pngFiles, html, parsedImages, uploadMedia, stats, parsed) {
  if (!pngFiles.length) return rows
  return resolveDispImgFromWpsClipboard(rows, parsed, pngFiles, uploadMedia, stats)
}

async function applyNamedPasteImages(rows, images, uploadMedia, stats) {
  const next = rows.map((r) => ({ ...r }))
  const urlCache = new Map()
  for (const im of images) {
    if (!im.dataUrl) continue
    const row = next[im.row]
    if (!row || !im.excelColName) continue
    if (!isDispImgFormula(row[im.excelColName]) && row[im.excelColName]) continue
    try {
      const url = await uploadDataUrl(im.dataUrl, im.excelColName, uploadMedia, urlCache)
      row[im.excelColName] = formatImageCellValue(url)
      stats.uploaded += 1
      stats.fromHtml += 1
    } catch {
      stats.missing += 1
    }
  }
  return next
}

/**
 * @param {ReturnType<typeof buildPasteImportFromGrid>} parsed
 * @param {(file: File) => Promise<{ url: string }>} uploadMedia
 * @param {DataTransfer | null} [clipboardData]
 */
export async function resolvePasteExcelRowsMedia(parsed, uploadMedia, clipboardData = null) {
  const stats = { uploaded: 0, missing: 0, fromBuffer: 0, fromHtml: 0, fromFiles: 0 }
  let rows = parsed.excelRows.map((r) => ({ ...r }))

  let pngFiles = clipboardData ? collectClipboardImageFiles(clipboardData) : []
  const html = parsed.html || ''
  const clipRefCount = matchAllGlobal(html, WPS_CLIP_IMAGE_RE).length
  const dispImgSlotCount = collectDispImgSlotsRowMajor(rows, parsed.excelColumns).length

  const xlsxBuffer = clipboardData ? await extractClipboardXlsxBuffer(clipboardData) : null
  if (xlsxBuffer) {
    const res = await replaceDispImgCellsInRows(
      xlsxBuffer,
      undefined,
      rows,
      parsed.excelColumns,
      [],
      uploadMedia,
    )
    rows = res.data
    stats.uploaded += res.stats.uploaded
    stats.missing += res.stats.missing
    stats.fromBuffer = res.stats.uploaded
  }

  rows = await resolveDispImgFromHtmlMap(rows, parsed.dispImgHtmlMap, uploadMedia, stats)

  const stillNeedImages = collectDispImgSlotsRowMajor(rows, parsed.excelColumns).length
  if (stillNeedImages && !pngFiles.length && (clipRefCount || dispImgSlotCount)) {
    pngFiles = await readClipboardImageFilesAsync()
  }

  rows = await resolveDispImgFromOrderedFiles(
    rows,
    pngFiles,
    html,
    parsed.images,
    uploadMedia,
    stats,
    parsed,
  )
  rows = await applyNamedPasteImages(rows, parsed.images, uploadMedia, stats)

  if (stillNeedImages && stats.fromFiles === 0 && stats.fromBuffer === 0) {
    const remaining = collectDispImgSlotsRowMajor(rows, parsed.excelColumns).length
    if (remaining > 0) stats.missing += remaining
  }

  return { rows, stats }
}

/**
 * @param {DataTransfer | null} clipboardData
 * @param {string[]} templateColumns
 * @param {(file: File) => Promise<{ url: string }>} uploadMedia
 * @param {{ text?: string }} [options]
 */
export async function importTableFromClipboard(clipboardData, templateColumns, uploadMedia, options = {}) {
  const parsed = options.text != null
    ? parseTextImportPayloadSync(options.text, templateColumns)
    : parseClipboardImportPayloadSync(clipboardData, templateColumns)

  if (!parsed.excelRows.length) return null

  const { rows: excelRows, stats: imageStats } = await resolvePasteExcelRowsMedia(
    parsed,
    uploadMedia,
    clipboardData,
  )

  const mapped = mapExcelImportToTemplateRows(excelRows, parsed.excelColumns, templateColumns)

  for (const row of mapped.rows) {
    for (const col of templateColumns) {
      if (isDispImgFormula(row[col])) row[col] = ''
    }
  }

  return {
    excelRows,
    mapped,
    imageStats,
    parsed,
  }
}
