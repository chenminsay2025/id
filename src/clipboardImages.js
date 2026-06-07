import { imageExtFromMime } from './cellMedia.js'

/** @param {string} dataUrl @param {string} [basename] */
export async function dataUrlToFile(dataUrl, basename = 'paste') {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const ext = imageExtFromMime(blob.type)
  return new File([blob], `${basename}.${ext}`, { type: blob.type || 'image/png' })
}

/**
 * @param {Array<{ row: number, col: number, dataUrl: string }>} images
 * @param {(file: File) => Promise<{ url: string }>} uploadMedia
 * @param {{ startRow?: number, startCol?: number, getColumnAt?: (colIndex: number) => string | null, setCellValue?: (rowIndex: number, colName: string, value: string) => void }} options
 */
export async function uploadPasteCellImages(images, uploadMedia, {
  startRow = 0,
  startCol = 0,
  getColumnAt,
  setCellValue,
} = {}) {
  if (!images.length || !uploadMedia || !getColumnAt || !setCellValue) {
    return { uploaded: 0, failed: 0 }
  }

  let uploaded = 0
  let failed = 0
  for (const { row, col, dataUrl } of images) {
    if (!dataUrl?.startsWith('data:image')) continue
    const ri = startRow + row
    const ci = startCol + col
    const colName = getColumnAt(ci)
    if (!colName) continue
    try {
      const file = await dataUrlToFile(dataUrl, `paste-r${ri}-c${ci}`)
      const { url } = await uploadMedia(file)
      setCellValue(ri, colName, url)
      uploaded += 1
    } catch {
      failed += 1
    }
  }
  return { uploaded, failed }
}
