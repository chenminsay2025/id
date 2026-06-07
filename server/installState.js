import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.join(__dirname, '..')
export const installLockPath = path.join(projectRoot, 'data', '.installed')
export const envPath = path.join(projectRoot, '.env')

export function isInstalled() {
  return fs.existsSync(installLockPath)
}

export function markInstalled(meta = {}) {
  fs.mkdirSync(path.dirname(installLockPath), { recursive: true })
  fs.writeFileSync(installLockPath, JSON.stringify({
    installedAt: new Date().toISOString(),
    ...meta,
  }, null, 2), 'utf8')
}
