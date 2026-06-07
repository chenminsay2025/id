import fs from 'node:fs'
import path from 'node:path'

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const srcRoot = path.join(root, 'src')

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.js')) out.push(p)
  }
  return out
}

const allow = new Set([
  path.join(srcRoot, 'adminLoginPath.js'),
  path.join(srcRoot, 'publicLoginPath.js'),
  path.join(srcRoot, 'adminLoginRedirect.js'),
  path.join(srcRoot, 'publicLoginRedirect.js'),
])

const issues = []
for (const file of walk(srcRoot)) {
  if (allow.has(file)) continue
  const src = fs.readFileSync(file, 'utf8')
  if (/\/public-login\.html/.test(src)) {
    issues.push(`${path.relative(root, file)}: 硬编码 /public-login.html，应改用 publicLoginRedirect`)
  }
  if (/\/login\.html/.test(src) && !file.endsWith('adminLoginRedirect.js')) {
    issues.push(`${path.relative(root, file)}: 硬编码 /login.html，应改用 adminLoginRedirect`)
  }
}

if (issues.length) {
  console.error('[check-login-path-refs] 发现硬编码登录路径:')
  for (const msg of issues) console.error(' -', msg)
  process.exit(1)
}
console.log('[check-login-path-refs] OK')
