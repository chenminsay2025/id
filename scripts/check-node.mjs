#!/usr/bin/env node
const minMajor = 20
const minMinor = 19
const v = process.versions.node.split('.').map(Number)
const [major, minor] = v

const ok =
  major > minMajor ||
  (major === minMajor && minor >= minMinor) ||
  (major === 22 && minor >= 12) ||
  major >= 23

if (!ok) {
  console.error('')
  console.error('[Cat] 需要 Node.js 20.19+ 或 22.12+（当前:', process.version, ')')
  console.error('[Cat] Vite 6 与 @hono/node-server 在旧版 Node 上会报错：')
  console.error('      · crypto.getRandomValues is not a function')
  console.error('      · Class extends value undefined (Request)')
  console.error('')
  console.error('请安装 LTS: https://nodejs.org/  安装后在新终端执行:')
  console.error('  node -v')
  console.error('  npm run dev:local')
  console.error('')
  console.error('若已安装仍版本不对，请把 PATH 中 Node 路径改为:')
  console.error('  C:\\Program Files\\nodejs\\')
  console.error('')
  process.exit(1)
}
