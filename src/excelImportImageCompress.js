import { normalizeExcelImportImageConfig } from './excelImportImageConfig.js'

const SKIP_MIME = new Set(['image/svg+xml', 'image/gif'])

function needsResize(width, height, config) {
  const maxW = config.maxWidth || 0
  const maxH = config.maxHeight || 0
  if (maxW > 0 && width > maxW) return true
  if (maxH > 0 && height > maxH) return true
  return false
}

function targetDimensions(width, height, config) {
  let w = width
  let h = height
  const maxW = config.maxWidth || 0
  const maxH = config.maxHeight || 0
  let resized = false
  if (maxW > 0 && w > maxW) {
    h = Math.round((h * maxW) / w)
    w = maxW
    resized = true
  }
  if (maxH > 0 && h > maxH) {
    w = Math.round((w * maxH) / h)
    h = maxH
    resized = true
  }
  return { width: Math.max(1, w), height: Math.max(1, h), resized }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

/**
 * @param {{ data: Uint8Array, ext: string, mime: string }} blobInfo
 * @param {import('./excelImportImageConfig.js').ReturnType<typeof import('./excelImportImageConfig.js').normalizeExcelImportImageConfig>} [rawConfig]
 */
export async function compressExcelImportImage(blobInfo, rawConfig) {
  const config = normalizeExcelImportImageConfig(rawConfig)
  const beforeBytes = blobInfo?.data?.byteLength || 0
  const baseStats = {
    beforeBytes,
    afterBytes: beforeBytes,
    compressed: false,
    resized: false,
    skipped: false,
    failed: false,
    reason: '',
  }

  if (!config.enabled || !beforeBytes) {
    return { blobInfo, stats: { ...baseStats, skipped: true, reason: 'disabled' } }
  }

  const mime = String(blobInfo.mime || '').toLowerCase()
  const ext = String(blobInfo.ext || '').toLowerCase()
  if (SKIP_MIME.has(mime) || ext === 'svg' || ext === 'gif') {
    return { blobInfo, stats: { ...baseStats, skipped: true, reason: 'format' } }
  }

  let bitmap
  try {
    const blob = new Blob([blobInfo.data], { type: blobInfo.mime || 'image/png' })
    bitmap = await createImageBitmap(blob)
  } catch {
    return { blobInfo, stats: { ...baseStats, failed: true, reason: 'decode' } }
  }

  const { width, height, resized } = targetDimensions(bitmap.width, bitmap.height, config)
  const sizeLimit = (config.maxFileSizeKb || 0) * 1024
  const shouldTryCompress = resized
    || needsResize(bitmap.width, bitmap.height, config)
    || (sizeLimit > 0 && beforeBytes > sizeLimit)

  if (!shouldTryCompress) {
    bitmap.close?.()
    return { blobInfo, stats: { ...baseStats, skipped: true, reason: 'within_limits' } }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) {
    bitmap.close?.()
    return { blobInfo, stats: { ...baseStats, failed: true, reason: 'canvas' } }
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const preferJpeg = mime.includes('jpeg') || mime.includes('jpg') || ext === 'jpg' || ext === 'jpeg'
  const outputType = preferJpeg ? 'image/jpeg' : 'image/jpeg'
  const outputExt = 'jpg'

  let quality = config.quality
  let outBlob = await canvasToBlob(canvas, outputType, quality)
  if (!outBlob) {
    return { blobInfo, stats: { ...baseStats, failed: true, reason: 'encode' } }
  }

  if (sizeLimit > 0) {
    while (outBlob.size > sizeLimit && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.08)
      outBlob = await canvasToBlob(canvas, outputType, quality)
      if (!outBlob) break
    }
  }

  const afterBytes = outBlob.size
  if (afterBytes >= beforeBytes && !resized) {
    return { blobInfo, stats: { ...baseStats, skipped: true, reason: 'no_gain' } }
  }

  const data = new Uint8Array(await outBlob.arrayBuffer())
  return {
    blobInfo: { data, ext: outputExt, mime: outputType },
    stats: {
      beforeBytes,
      afterBytes,
      compressed: true,
      resized,
      skipped: false,
      failed: false,
      reason: '',
      quality: Math.round(quality * 100),
    },
  }
}

export function createEmptyCompressStats() {
  return {
    processed: 0,
    compressed: 0,
    skipped: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
  }
}

/** @param {ReturnType<typeof createEmptyCompressStats>} agg @param {object} item */
export function mergeCompressStats(agg, item) {
  agg.processed++
  if (item.failed) agg.failed++
  else if (item.skipped) agg.skipped++
  else if (item.compressed) agg.compressed++
  agg.beforeBytes += item.beforeBytes || 0
  agg.afterBytes += item.afterBytes || 0
  return agg
}
