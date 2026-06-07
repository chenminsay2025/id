#!/usr/bin/env node
/** 本地开发：跳过安装向导，标记为已安装 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = path.join(root, 'data', '.installed')
const env = path.join(root, '.env')

fs.mkdirSync(path.dirname(lock), { recursive: true })
if (!fs.existsSync(lock)) {
  fs.writeFileSync(
    lock,
    JSON.stringify({ installedAt: new Date().toISOString(), note: 'local-dev' }, null, 2),
    'utf8',
  )
  console.log('已创建 data/.installed')
} else {
  console.log('data/.installed 已存在')
}

if (!fs.existsSync(env)) {
  const example = path.join(root, '.env.example')
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, env)
    console.log('已从 .env.example 复制 .env')
  }
} else {
  console.log('.env 已存在')
}

console.log('可执行 npm run dev，访问 http://localhost:5173/fonts.html')
