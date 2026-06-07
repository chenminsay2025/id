import JSZip from 'jszip'

/** @param {number} bytes */
export function formatZipByteSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * @param {import('jszip')} zip
 */
export function summarizeExcelZip(zip) {
  const names = Object.keys(zip.files || {})
  const media = names.filter((n) => /xl\/media\//i.test(n.replace(/^\//, '')))
  const sheets = names.filter((n) => /xl\/worksheets\/sheet\d+\.xml$/i.test(n.replace(/^\//, '')))
  const shared = names.find((n) => /xl\/sharedstrings\.xml$/i.test(n.replace(/^\//, '')))
  const workbook = names.find((n) => /xl\/workbook\.xml$/i.test(n.replace(/^\//, '')))
  return {
    totalEntries: names.length,
    sheetCount: sheets.length,
    mediaCount: media.length,
    hasSharedStrings: !!shared,
    hasWorkbook: !!workbook,
    sheetNames: sheets.map((n) => n.split('/').pop()),
  }
}

/**
 * 先解压 xlsx（zip），onUpdate 可汇报当前文件与百分比（大文件主要耗时在此）
 * @param {ArrayBuffer} buffer
 * @param {(info: { percent: number, label: string, detail?: string }) => void} [onProgress]
 */
export async function loadExcelZipArchive(buffer, onProgress) {
  const byteLen = buffer?.byteLength || 0
  onProgress?.({
    percent: 4,
    label: '正在解压 Excel 压缩包…',
    detail: byteLen
      ? `文件 ${formatZipByteSize(byteLen)}，xlsx 本质是 zip，需先逐项解压内部文件`
      : '正在解压 xlsx 内部文件…',
  })

  let lastFile = ''
  const zip = await JSZip.loadAsync(buffer, {
    onUpdate: (metadata) => {
      const pct = Math.max(0, Math.min(100, metadata.percent || 0))
      const file = metadata.currentFile || lastFile
      if (metadata.currentFile) lastFile = metadata.currentFile
      const filePct = metadata.currentFilePercent != null
        ? `（当前文件 ${metadata.currentFilePercent.toFixed(0)}%）`
        : ''
      onProgress?.({
        percent: 4 + Math.round(pct * 0.34),
        label: '正在解压…',
        detail: [
          `总解压进度 ${pct.toFixed(1)}%${filePct}`,
          file ? `当前：${file}` : '',
          byteLen ? `压缩包 ${formatZipByteSize(byteLen)}` : '',
        ].filter(Boolean).join('\n'),
      })
    },
  })

  const summary = summarizeExcelZip(zip)
  onProgress?.({
    percent: 39,
    label: '解压完成',
    detail: [
      `共 ${summary.totalEntries} 个内部文件`,
      summary.sheetCount ? `工作表 ${summary.sheetCount} 个` : '',
      summary.mediaCount ? `嵌入媒体 ${summary.mediaCount} 个（图片等，体积通常较大）` : '',
      summary.hasSharedStrings ? '含共享字符串表' : '',
    ].filter(Boolean).join('\n'),
  })

  return { zip, summary }
}
