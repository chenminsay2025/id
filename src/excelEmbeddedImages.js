import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { formatImageCellValue } from './cellMedia.js'
import { runAsyncPool, yieldToMain } from './asyncYield.js'

/** 嵌入图上传并发数（过大可能压垮本地 API） */
const DISPIMG_UPLOAD_CONCURRENCY = 6

const DISPIMG_ID_RE = /DISPIMG\s*\(\s*"([^"]+)"/i

export function parseDispImgId(value) {
  const m = String(value ?? '').match(DISPIMG_ID_RE)
  return m ? m[1] : null
}

function dispImgIdVariants(id) {
  const s = String(id || '').trim()
  if (!s) return []
  const variants = new Set([s, s.toUpperCase(), s.toLowerCase()])
  if (/^ID_/i.test(s)) variants.add(s.replace(/^ID_/i, ''))
  else variants.add(`ID_${s}`)
  return [...variants]
}

function lookupDispImgBlob(blobMap, id) {
  for (const key of dispImgIdVariants(id)) {
    if (blobMap.has(key)) return blobMap.get(key)
  }
  return null
}

function dispImgCacheKey(id) {
  return String(id || '').trim().toUpperCase()
}

function cellDispImgRaw(cell) {
  if (!cell) return ''
  if (cell.f && /DISPIMG/i.test(cell.f)) return cell.f
  if (typeof cell.v === 'string' && /DISPIMG/i.test(cell.v)) return cell.v
  if (cell.w && /DISPIMG/i.test(cell.w)) return cell.w
  return ''
}

export function isDispImgFormula(value) {
  return DISPIMG_ID_RE.test(String(value ?? ''))
}

function walkElements(root, localName, out = []) {
  if (!root) return out
  if (root.nodeType === 1 && root.localName === localName) out.push(root)
  for (const ch of root.children || []) walkElements(ch, localName, out)
  return out
}

function getXmlAttr(el, ...names) {
  if (!el) return null
  for (const name of names) {
    const direct = el.getAttribute(name)
    if (direct) return direct
  }
  for (const attr of el.attributes || []) {
    const local = attr.localName || attr.name.split(':').pop()
    if (names.some((n) => n === attr.name || n === local || n.endsWith(`:${local}`))) {
      return attr.value
    }
  }
  return null
}

function mimeFromExt(ext) {
  switch (String(ext || '').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'image/png'
  }
}

async function readZipText(zip, pathPattern) {
  const paths = Array.isArray(pathPattern) ? pathPattern : [pathPattern]
  for (const p of paths) {
    if (p instanceof RegExp) {
      const name = Object.keys(zip.files).find((n) => p.test(n.replace(/^\//, '')))
      if (name) return zip.file(name).async('text')
      continue
    }
    const entry = zip.file(p) || zip.file(`/${p}`)
    if (entry) return entry.async('text')
  }
  return null
}

async function parseWpsCellImageIndex(zip) {
  const cellImagesXml = await readZipText(zip, [
    'xl/cellimages.xml',
    'xl/cellImages.xml',
    /^xl\/cellimages\.xml$/i,
  ])
  const relsXml = await readZipText(zip, [
    'xl/_rels/cellimages.xml.rels',
    'xl/_rels/cellImages.xml.rels',
    /^xl\/_rels\/cellimages\.xml\.rels$/i,
  ])
  if (!cellImagesXml || !relsXml) return new Map()

  const parser = new DOMParser()
  const relsDoc = parser.parseFromString(relsXml, 'application/xml')
  const imagesDoc = parser.parseFromString(cellImagesXml, 'application/xml')

  const ridToMedia = new Map()
  for (const rel of walkElements(relsDoc.documentElement, 'Relationship')) {
    const id = getXmlAttr(rel, 'Id')
    const target = getXmlAttr(rel, 'Target')
    if (!id || !target) continue
    const mediaPath = target.replace(/^\.\.\//, '')
    ridToMedia.set(id, mediaPath.startsWith('xl/') ? mediaPath : `xl/${mediaPath}`)
  }

  const idToMediaPath = new Map()
  for (const cellImage of walkElements(imagesDoc.documentElement, 'cellImage')) {
    const cNvPr = walkElements(cellImage, 'cNvPr')[0]
    const imageId = getXmlAttr(cNvPr, 'name') || getXmlAttr(cNvPr, 'descr')
    const blip = walkElements(cellImage, 'blip')[0]
    const rid = getXmlAttr(blip, 'r:embed', 'embed')
    if (!imageId || !rid) continue
    const mediaPath = ridToMedia.get(rid)
    if (!mediaPath) continue
    for (const alias of dispImgIdVariants(imageId)) {
      idToMediaPath.set(alias, mediaPath)
    }
  }

  return idToMediaPath
}

async function readZipBinary(zip, mediaPath) {
  const candidates = [
    mediaPath,
    mediaPath.replace(/^\//, ''),
    `xl/${mediaPath.replace(/^xl\//, '')}`,
    `xl/media/${mediaPath.split('/').pop()}`,
  ]
  for (const p of candidates) {
    const entry = zip.file(p) || zip.file(`/${p}`)
    if (entry) return entry.async('uint8array')
  }
  const base = mediaPath.split('/').pop()
  const found = Object.keys(zip.files).find((n) => n.replace(/^\//, '').endsWith(`/${base}`))
  if (found) return zip.file(found).async('uint8array')
  return null
}

/** @returns {Promise<Map<string, { data: Uint8Array, ext: string, mime: string }>>} */
export async function extractWpsDispImgBlobMap(buffer, existingZip = null) {
  const zip = existingZip || await JSZip.loadAsync(buffer)
  const idToMediaPath = await parseWpsCellImageIndex(zip)
  const blobMap = new Map()

  /** @type {Map<string, { data: Uint8Array, ext: string, mime: string }>} */
  const mediaByPath = new Map()
  for (const [id, mediaPath] of idToMediaPath) {
    let info = mediaByPath.get(mediaPath)
    if (!info) {
      const data = await readZipBinary(zip, mediaPath)
      if (!data) continue
      const ext = (mediaPath.match(/\.(\w+)(?:\?.*)?$/i) || ['', 'png'])[1].toLowerCase()
      info = {
        data,
        ext: ext === 'jpeg' ? 'jpg' : ext,
        mime: mimeFromExt(ext),
      }
      mediaByPath.set(mediaPath, info)
    }
    for (const alias of dispImgIdVariants(id)) {
      if (!blobMap.has(alias)) blobMap.set(alias, info)
    }
  }

  return blobMap
}

/** @returns {{ rowIdx: number, colName: string, id: string }[]} */
export function collectDispImgSlotsFromData(data) {
  const slots = []
  for (let rowIdx = 0; rowIdx < (data || []).length; rowIdx++) {
    for (const [colName, val] of Object.entries(data[rowIdx] || {})) {
      if (!isDispImgFormula(val)) continue
      const id = parseDispImgId(val)
      if (id) slots.push({ rowIdx, colName, id })
    }
  }
  return slots
}

/** @returns {{ ref: string, id: string }[]} */
export function collectDispImgCellsFromWorksheet(ws) {
  const out = []
  if (!ws) return out
  for (const ref of Object.keys(ws)) {
    if (ref.startsWith('!')) continue
    const cell = ws[ref]
    const raw = cellDispImgRaw(cell)
    const id = parseDispImgId(raw)
    if (id) out.push({ ref, id })
  }
  return out
}

async function uploadDispImgBlob(blobInfo, id, uploadMedia, urlCache) {
  const cacheKey = dispImgCacheKey(id)
  let url = urlCache.get(cacheKey)
  if (url) return url

  const file = new File(
    [blobInfo.data],
    `excel-${String(id).slice(-12)}.${blobInfo.ext}`,
    { type: blobInfo.mime },
  )
  const res = await uploadMedia(file)
  url = res.url
  urlCache.set(cacheKey, url)
  return url
}

/**
 * 将 WPS DISPIMG 单元格替换为上传后的 cat-img: URL。
 * 优先扫描已导入的行数据（避免 worksheet 列索引与表头错位导致首行漏处理）。
 */
export async function replaceDispImgCellsInRows(
  buffer,
  ws,
  data,
  headers,
  excelRowNumbers,
  uploadMedia,
  { onProgress, zip: existingZip = null, loadZipWithProgress = null } = {},
) {
  const nextData = data.map((row) => ({ ...row }))
  const slots = collectDispImgSlotsFromData(nextData)
  if (!slots.length) return { data: nextData, stats: { uploaded: 0, missing: 0 } }

  onProgress?.({ phase: 'scan', total: slots.length })
  await yieldToMain()
  let zip = existingZip
  if (!zip && typeof loadZipWithProgress === 'function') {
    onProgress?.({ phase: 'zip', message: '正在解压 xlsx 以读取 xl/media 图片…' })
    const loaded = await loadZipWithProgress(buffer)
    zip = loaded?.zip
  }
  onProgress?.({ phase: 'index', message: '正在解析 cellimages 与媒体路径…' })
  const blobMap = await extractWpsDispImgBlobMap(buffer, zip)
  onProgress?.({
    phase: 'index',
    blobCount: blobMap.size,
    total: slots.length,
    message: `已关联 ${blobMap.size} 个媒体文件，开始上传`,
    logLine: `图片索引完成：${blobMap.size} 个媒体`,
  })
  const urlCache = new Map()
  /** @type {Map<object, string>} */
  const blobUrlCache = new Map()
  let missing = 0

  const unmatched = []
  const totalSlots = slots.length
  /** @type {Map<object, { sampleId: string }>} */
  const uniqueBlobJobs = new Map()

  for (const { rowIdx, colName, id } of slots) {
    const blobInfo = lookupDispImgBlob(blobMap, id)
    if (!blobInfo) {
      unmatched.push({ rowIdx, colName, id })
      missing++
      continue
    }
    if (!uniqueBlobJobs.has(blobInfo)) {
      uniqueBlobJobs.set(blobInfo, { sampleId: id })
    }
  }

  const uniqueList = [...uniqueBlobJobs.entries()]
  const uniqueTotal = uniqueList.length
  let uploadDone = 0
  let lastProgressAt = 0

  onProgress?.({
    phase: 'upload',
    done: 0,
    total: totalSlots,
    uniqueDone: 0,
    uniqueTotal,
    message: `共 ${totalSlots} 个单元格含图，去重后需上传 ${uniqueTotal} 张（${DISPIMG_UPLOAD_CONCURRENCY} 路并行）`,
    logLine: `并行上传 ${uniqueTotal} 张唯一嵌入图`,
  })
  await yieldToMain()

  await runAsyncPool(uniqueList, DISPIMG_UPLOAD_CONCURRENCY, async ([blobInfo, { sampleId }]) => {
    try {
      const url = await uploadDispImgBlob(blobInfo, sampleId, uploadMedia, urlCache)
      blobUrlCache.set(blobInfo, url)
    } catch {
      /* 单张失败不阻断其余 */
    }
    uploadDone++
    const now = Date.now()
    if (uploadDone === uniqueTotal || uploadDone - lastProgressAt >= 8 || now - lastProgressAt > 400) {
      lastProgressAt = uploadDone
      onProgress?.({
        phase: 'upload',
        done: uploadDone,
        total: totalSlots,
        uniqueDone: uploadDone,
        uniqueTotal,
        message: `并行上传 ${uploadDone}/${uniqueTotal} 张唯一图片`,
      })
      await yieldToMain()
    }
  })

  let applied = 0
  for (const { rowIdx, colName, id } of slots) {
    const blobInfo = lookupDispImgBlob(blobMap, id)
    const url = blobInfo ? blobUrlCache.get(blobInfo) : null
    if (url) {
      nextData[rowIdx][colName] = formatImageCellValue(url)
      applied++
    }
  }

  if (unmatched.length) {
    const usedBlobs = new Set(blobUrlCache.keys())
    const uniqueRemainingBlobs = [...new Set([...blobMap.values()].filter((info) => !usedBlobs.has(info)))]
    if (uniqueRemainingBlobs.length === unmatched.length) {
      for (let i = 0; i < unmatched.length; i++) {
        const { rowIdx, colName, id } = unmatched[i]
        try {
          const url = await uploadDispImgBlob(uniqueRemainingBlobs[i], id, uploadMedia, urlCache)
          blobUrlCache.set(uniqueRemainingBlobs[i], url)
          nextData[rowIdx][colName] = formatImageCellValue(url)
          applied++
          missing--
        } catch {
          /* keep missing */
        }
      }
    }
  }

  const uploaded = blobUrlCache.size
  onProgress?.({
    phase: 'upload',
    done: totalSlots,
    total: totalSlots,
    uniqueDone: uniqueTotal,
    uniqueTotal,
    uploaded,
    missing,
    message: `已写入 ${applied} 格，上传 ${uploaded} 张唯一图`,
  })

  return { data: nextData, stats: { uploaded: applied, missing } }
}
