/**
 * PDF 导出：PDFKit + svg-to-pdfkit（矢量文字，按字体目录注册多字体）
 */
import { serializeSvg, prepareSvgElementForExport } from './svgEngine.js'
import {
  setupPdfFonts,
  createPdfFontCallback,
  normalizePdfExportOptions,
} from './pdfFontSetup.js'
import { resolvePageSizePt } from './pageSize.js'

let libsReady = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const key = String(src)
    const existing = document.querySelector(`script[src="${key}"]`)
    if (existing) {
      setTimeout(resolve, 30)
      return
    }
    const s = document.createElement('script')
    s.src = key
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`脚本加载失败: ${key}`))
    document.head.appendChild(s)
  })
}

async function ensurePdfLibs() {
  if (libsReady) return libsReady
  libsReady = (async () => {
    if (typeof globalThis.PDFDocument !== 'function') {
      await loadScript('/libs/pdfkit.standalone.js')
    }
    if (typeof globalThis.SVGtoPDF !== 'function') {
      await loadScript('/libs/source.js')
    }
    if (
      typeof globalThis.PDFDocument !== 'function' ||
      typeof globalThis.SVGtoPDF !== 'function'
    ) {
      throw new Error('PDF 组件加载失败，请刷新页面重试')
    }
  })()
  return libsReady
}

function createBlobStreamFallback() {
  const chunks = []
  const listeners = new Map()
  const api = {
    writable: true,
    write(chunk) {
      if (chunk == null) return true
      if (chunk instanceof Uint8Array) chunks.push(chunk)
      else if (chunk instanceof ArrayBuffer) chunks.push(new Uint8Array(chunk))
      else if (ArrayBuffer.isView(chunk)) {
        chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      } else {
        chunks.push(new TextEncoder().encode(String(chunk)))
      }
      return true
    },
    end(chunk) {
      if (chunk != null) api.write(chunk)
      api.emit('finish')
      return api
    },
    on(event, handler) {
      const key = String(event || '')
      if (!listeners.has(key)) listeners.set(key, [])
      listeners.get(key).push(handler)
      return api
    },
    once(event, handler) {
      const wrap = () => {
        api.removeListener(event, wrap)
        handler.apply(null, arguments)
      }
      return api.on(event, wrap)
    },
    removeListener(event, handler) {
      const key = String(event || '')
      const arr = listeners.get(key) || []
      listeners.set(
        key,
        arr.filter((fn) => fn !== handler),
      )
      return api
    },
    emit(event) {
      const key = String(event || '')
      const args = Array.prototype.slice.call(arguments, 1)
      ;(listeners.get(key) || []).slice().forEach((fn) => {
        try {
          fn.apply(null, args)
        } catch {
          /* ignore */
        }
      })
      return api
    },
    toBlob(type) {
      return new Blob(chunks, { type: type || 'application/pdf' })
    },
  }
  return api
}

/** 导出前准备 SVG（PDF 保留布局字体，不强制改为思源黑体） */
export async function prepareSvgString(svgEl, exportOptions = {}) {
  const opts = normalizePdfExportOptions(exportOptions)
  const page = resolvePageSizePt(opts)
  const clone = await prepareSvgElementForExport(svgEl, {
    forPdf: true,
    fontCatalog: opts.fontCatalog,
    pageWidthMm: page.pageWidthMm,
    pageHeightMm: page.pageHeightMm,
  })
  clone.setAttribute('width', `${page.pageWidthMm}mm`)
  clone.setAttribute('height', `${page.pageHeightMm}mm`)
  return serializeSvg(clone)
}

async function createPdfDocStream(exportOptions = {}, svgRoot = null) {
  await ensurePdfLibs()
  const opts = normalizePdfExportOptions(exportOptions)
  const page = resolvePageSizePt(opts)
  const PDFDocument = globalThis.PDFDocument
  const doc = new PDFDocument({
    size: [page.pageWidthPt, page.pageHeightPt],
    margin: 0,
    compress: true,
  })

  let stream
  if (typeof globalThis.blobStream === 'function') {
    const tryStream = globalThis.blobStream()
    stream =
      tryStream && typeof tryStream.once === 'function'
        ? tryStream
        : createBlobStreamFallback()
  } else {
    stream = createBlobStreamFallback()
  }
  doc.pipe(stream)

  const fontSetup = await setupPdfFonts(doc, {
    fontCatalog: opts.fontCatalog,
    ttfUrl: opts.ttfUrl,
    svgRoot,
  })
  doc.font(fontSetup.defaultFontName)

  return { doc, stream, fontSetup }
}

function renderSvgOnDoc(doc, svgString, fontSetup, exportOptions = {}) {
  const page = resolvePageSizePt(exportOptions)
  const SVGtoPDF = globalThis.SVGtoPDF
  doc.font(fontSetup.defaultFontName)
  SVGtoPDF(doc, svgString, 0, 0, {
    width: page.pageWidthPt,
    height: page.pageHeightPt,
    preserveAspectRatio: 'xMidYMid meet',
    precision: 2,
    fontCallback: createPdfFontCallback(fontSetup.registry, fontSetup.defaultFontName),
  })
}

function finishPdfDoc(doc, stream) {
  doc.end()
  return new Promise((resolve, reject) => {
    const done = () => resolve(stream.toBlob('application/pdf'))
    if (typeof stream.once === 'function') {
      stream.once('finish', done)
      stream.once('error', reject)
    } else {
      stream.on('finish', done)
      stream.on('error', reject)
    }
    if (typeof doc.on === 'function') doc.on('error', reject)
  })
}

async function svgStringToPdfBlob(svgString, exportOptions, svgRoot = null) {
  const { doc, stream, fontSetup } = await createPdfDocStream(exportOptions, svgRoot)
  renderSvgOnDoc(doc, svgString, fontSetup, exportOptions)
  return finishPdfDoc(doc, stream)
}

function downloadPdfBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

async function svgStringToPdfBuffer(svgString, exportOptions, svgRoot = null) {
  const blob = await svgStringToPdfBlob(svgString, exportOptions, svgRoot)
  return blob.arrayBuffer()
}

function pdfExportOptions(exportOptions) {
  return normalizePdfExportOptions(exportOptions)
}

/** 让出主线程，便于更新进度 UI */
export function yieldToMain() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}

/** 单张 SVG → 矢量 PDF */
export async function exportSvgToPdf(svgEl, filename, exportOptions = {}) {
  const opts = pdfExportOptions(exportOptions)
  const svgString = await prepareSvgString(svgEl, opts)
  const blob = await svgStringToPdfBlob(svgString, opts, svgEl)
  downloadPdfBlob(blob, filename)
}

/** 多行合并为一个多页 PDF
 * @param {(...args: any[]) => void} onProgress
 *   新式：onProgress({ phase, page?, total?, step?, detail?, percent?, stepId?, doneSteps? })
 *   旧式：onProgress(current, total, phase) 仍兼容
 */
export async function exportRowsToSinglePdf(rows, generateFn, exportOptions, filename, onProgress) {
  if (!rows.length) throw new Error('没有数据')
  const opts = pdfExportOptions(exportOptions)
  const total = rows.length

  const report = (payload) => {
    if (!onProgress) return
    if (onProgress.length >= 2) {
      const cur = payload.page ?? (payload.phase === 'finalize' ? total : 0)
      onProgress(cur, total, payload.phase)
      return
    }
    onProgress(payload)
  }

  const pagePercent = (pageIndex, subStep) => {
    const subIdx = subStep === 'svg' ? 0 : subStep === 'prepare' ? 1 : subStep === 'render' ? 2 : 3
    const units = total * 3
    const doneUnits = pageIndex * 3 + subIdx
    return 8 + Math.round((doneUnits / units) * 84)
  }

  report({
    phase: 'init',
    stepId: 'init',
    doneSteps: [],
    detail: '正在加载 PDFKit 与 SVG 转换组件…',
    percent: 2,
  })
  await ensurePdfLibs()
  await yieldToMain()

  report({
    phase: 'doc',
    stepId: 'doc',
    doneSteps: ['init'],
    detail: '正在初始化 PDF 文档与字体…',
    percent: 6,
  })
  const page = resolvePageSizePt(opts)
  report({
    phase: 'page',
    page: 1,
    total,
    step: 'svg',
    stepId: 'pages',
    doneSteps: ['init', 'doc'],
    detail: `第 1/${total} 页：正在生成证书 SVG…`,
    percent: pagePercent(0, 'svg'),
  })
  const firstSvg = await generateFn(rows[0], 0)
  await yieldToMain()
  const { doc, stream, fontSetup } = await createPdfDocStream(opts, firstSvg)

  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      doc.addPage({ size: [page.pageWidthPt, page.pageHeightPt], margin: 0 })
      await yieldToMain()
      report({
        phase: 'page',
        page: i + 1,
        total,
        step: 'svg',
        stepId: 'pages',
        doneSteps: ['init', 'doc'],
        detail: `第 ${i + 1}/${total} 页：正在生成证书 SVG…`,
        percent: pagePercent(i, 'svg'),
      })
    }
    const svgEl = i === 0 ? firstSvg : await generateFn(rows[i], i)
    await yieldToMain()
    report({
      phase: 'page',
      page: i + 1,
      total,
      step: 'prepare',
      stepId: 'pages',
      doneSteps: ['init', 'doc'],
      detail: `第 ${i + 1}/${total} 页：正在嵌入图片与字体…`,
      percent: pagePercent(i, 'prepare'),
    })
    const svgString = await prepareSvgString(svgEl, opts)
    await yieldToMain()
    report({
      phase: 'page',
      page: i + 1,
      total,
      step: 'render',
      stepId: 'pages',
      doneSteps: ['init', 'doc'],
      detail: `第 ${i + 1}/${total} 页：正在写入 PDF 矢量内容…`,
      percent: pagePercent(i, 'render'),
    })
    renderSvgOnDoc(doc, svgString, fontSetup, opts)
    report({
      phase: 'page',
      page: i + 1,
      total,
      step: 'done',
      stepId: 'pages',
      doneSteps: ['init', 'doc'],
      detail: `第 ${i + 1}/${total} 页已完成`,
      percent: pagePercent(i, 'render') + 1,
    })
    await yieldToMain()
  }

  report({
    phase: 'finalize',
    stepId: 'finalize',
    doneSteps: ['init', 'doc', 'pages'],
    detail: '正在压缩并写入 PDF 文件…',
    percent: 94,
  })
  await yieldToMain()
  const blob = await finishPdfDoc(doc, stream)
  report({
    phase: 'download',
    stepId: 'download',
    doneSteps: ['init', 'doc', 'pages', 'finalize'],
    detail: '正在保存到本地…',
    percent: 98,
  })
  downloadPdfBlob(blob, filename)
  report({
    phase: 'done',
    stepId: 'download',
    doneSteps: ['init', 'doc', 'pages', 'finalize', 'download'],
    total,
    detail: `导出完成，共 ${total} 页`,
    percent: 100,
  })
}

/** 批量导出 ZIP（每行单独 PDF） */
export async function exportBatchPdf(rows, generateFn, exportOptions, onProgress) {
  const opts = pdfExportOptions(exportOptions)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  for (let i = 0; i < rows.length; i++) {
    await yieldToMain()
    const svgEl = await generateFn(rows[i], i)
    await yieldToMain()
    const svgString = await prepareSvgString(svgEl, opts)
    await yieldToMain()
    const pdfBuffer = await svgStringToPdfBuffer(svgString, opts, svgEl)

    const name =
      rows[i]['编号']?.replace(/[<>:"/\\|?*]/g, '_') ||
      rows[i]['猫舍']?.replace(/[<>:"/\\|?*\u4e00-\u9fff]/g, '_') ||
      `cert-${i + 1}`
    zip.file(`${name}.pdf`, pdfBuffer)
    onProgress?.(i + 1, rows.length)
    await yieldToMain()
  }

  onProgress?.(rows.length, rows.length)
  await yieldToMain()
  const blob = await zip.generateAsync({ type: 'blob' })
  const { saveAs } = await import('file-saver')
  saveAs(blob, 'certificates.zip')
}
