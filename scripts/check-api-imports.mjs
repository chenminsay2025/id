import fs from 'node:fs'
import path from 'node:path'

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.js')) out.push(p)
  }
  return out
}

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'src')
const issues = []
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8')
  const usesClientApi = /\bapi\.(meta|me|publicMe|listPublicCertificates|get|post|put|patch|delete|login|logout|upload|update|create|fetch|publicLogin|publicLogout)/.test(src)
  const importsApi = /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*['"][^'"]*api\/client/.test(src)
  if (usesClientApi && !importsApi) issues.push(path.relative(root, file))
}

if (issues.length) {
  console.error('[check-api-imports] 缺少 api/client 导入:')
  for (const f of issues) console.error(' -', f)
  process.exit(1)
}
console.log('[check-api-imports] OK')
