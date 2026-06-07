/**
 * 将 font/siyuan.otf (CFF) 转为 font/siyuan.ttf，供 jsPDF/svg2pdf 矢量 PDF 使用
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createFont } from 'fonteditor-core'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const otfPath = join(root, 'font', 'siyuan.otf')
const ttfPath = join(root, 'font', 'siyuan.ttf')

if (existsSync(ttfPath)) {
  console.log('siyuan.ttf 已存在，跳过转换')
  process.exit(0)
}

console.log('正在转换 OTF → TTF（约 1–3 分钟）…')
const buffer = readFileSync(otfPath)
const font = createFont(buffer, {
  type: 'otf',
  hinting: false,
  kerning: false,
  compound2simple: true,
})
const ttfBuffer = font.write({ type: 'ttf', hinting: false, kerning: false })
writeFileSync(ttfPath, Buffer.from(ttfBuffer))
console.log(`已生成 ${ttfPath} (${(ttfBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`)
