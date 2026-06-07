import { parseExcelFromBuffer, parseExcelFromBufferAsync } from './excelRowParse.js'
import { yieldToMain } from './asyncYield.js'
import {
  startExcelImportWaitTicker,
  stopExcelImportWaitTicker,
} from './excelImportProgress.js'

/** @type {Worker | null} */
let parseWorker = null

function getParseWorker() {
  if (!parseWorker) {
    parseWorker = new Worker(new URL('./excelParse.worker.js', import.meta.url), { type: 'module' })
  }
  return parseWorker
}

/**
 * 在 Web Worker 中解析 Excel，避免大文件阻塞主线程
 * @param {ArrayBuffer} buffer
 * @param {{ templateColumns?: string[] }} [options]
 * @param {{ onProgress?: (percent: number, label: string, detail?: string) => void }} [callbacks]
 */
export function loadExcelDataAsync(buffer, options = {}, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = getParseWorker()
    } catch {
      resolveFallback()
      return
    }

    startExcelImportWaitTicker('已启动后台解析，正在解压工作簿…')

    const onMessage = (e) => {
      const msg = e.data
      if (msg?.type === 'progress') {
        onProgress?.(msg.percent, msg.label, msg.detail)
        return
      }
      if (msg?.type === 'done') {
        stopExcelImportWaitTicker()
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        resolve(msg.result)
        return
      }
      if (msg?.type === 'error') {
        stopExcelImportWaitTicker()
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        reject(new Error(msg.message || 'Excel 解析失败'))
      }
    }

    const onError = () => {
      stopExcelImportWaitTicker()
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      resolveFallback()
    }

    async function resolveFallback() {
      try {
        await yieldToMain()
        startExcelImportWaitTicker('主线程解析中（未启用 Worker）…')
        const result = await parseExcelFromBufferAsync(buffer, options, ({ percent, label, detail }) => {
          onProgress?.(percent, label, detail)
        })
        stopExcelImportWaitTicker()
        resolve(result)
      } catch (err) {
        stopExcelImportWaitTicker()
        reject(err)
      }
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({
      buffer,
      templateColumns: options.templateColumns,
    })
  })
}
