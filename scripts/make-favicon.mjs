import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = path.join(root, 'ico.png')
const output = path.join(root, 'public', 'favicon.ico')
const appleTouch = path.join(root, 'public', 'apple-touch-icon.png')
const sizes = [16, 32, 48]

if (!fs.existsSync(input)) {
  console.error('缺少源图：', input)
  process.exit(1)
}

const pngBuffers = await Promise.all(
  sizes.map((size) => sharp(input).resize(size, size, { fit: 'cover' }).png().toBuffer()),
)

fs.mkdirSync(path.dirname(output), { recursive: true })
const buf = await pngToIco(pngBuffers)
fs.writeFileSync(output, buf)
await sharp(input).resize(180, 180, { fit: 'cover' }).png().toFile(appleTouch)
console.log(`已生成 ${output}（${buf.length} 字节，含 ${sizes.join('/')}px）`)
console.log(`已生成 ${appleTouch}`)
