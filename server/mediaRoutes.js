import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
}

const MAX_BYTES = 8 * 1024 * 1024

/**
 * @param {import('hono').Context} c
 * @param {string} uploadsDir
 */
async function handleMediaUpload(c, uploadsDir) {
  const body = await c.req.parseBody()
  const file = body.file ?? body.image
  if (!file || typeof file === 'string') {
    return c.json({ error: '请使用 multipart 字段 file 上传图片' }, 400)
  }

  const type = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(type)) {
    return c.json({ error: '仅支持 PNG / JPEG / GIF / WebP / SVG' }, 400)
  }

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    return c.json({ error: '图片不能超过 8MB' }, 400)
  }

  const ext = EXT_BY_TYPE[type] || path.extname(file.name || '') || '.png'
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`
  fs.writeFileSync(path.join(uploadsDir, name), buf)

  const url = `/uploads/${name}`
  return c.json({
    url,
    name,
    content_type: type,
    size: buf.length,
  })
}

/**
 * @param {import('hono').Hono} app
 * @param {{ projectRoot: string, requireAuth: import('hono').MiddlewareHandler, requireVisitorAuth?: import('hono').MiddlewareHandler }} opts
 */
export function registerMediaRoutes(app, { projectRoot, requireAuth, requireVisitorAuth }) {
  const uploadsDir = path.join(projectRoot, 'data', 'uploads')
  fs.mkdirSync(uploadsDir, { recursive: true })

  app.post('/api/media/upload', requireAuth, (c) => handleMediaUpload(c, uploadsDir))
  if (requireVisitorAuth) {
    app.post('/api/public/media/upload', requireVisitorAuth, (c) => handleMediaUpload(c, uploadsDir))
  }
}

export function getUploadsRoot(projectRoot) {
  return path.join(projectRoot, 'data')
}
