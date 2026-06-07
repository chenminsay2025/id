import { parseExcelFromBufferAsync } from './excelRowParse.js'

self.onmessage = async (e) => {
  const { buffer, templateColumns } = e.data || {}
  try {
    const result = await parseExcelFromBufferAsync(
      buffer,
      { templateColumns },
      ({ percent, label, detail }) => {
        self.postMessage({ type: 'progress', percent, label, detail })
      },
    )
    self.postMessage({ type: 'done', result })
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err?.message || String(err),
    })
  }
}
