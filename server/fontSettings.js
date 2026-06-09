import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const FONT_SETTINGS_KEY = 'font_sources_config'

export const DEFAULT_FONT_CDN = 'https://qiniu.uzzon.cn/fonts/SourceHanSansCN-Medium.ttf'

export function defaultFontConfig() {
  return {
    activeId: 'default-source',
    sources: [
      {
        id: 'default-source',
        label: '思源黑体 CN Medium',
        url: DEFAULT_FONT_CDN,
        urls: [
          { url: DEFAULT_FONT_CDN, enabled: true },
          { url: '/font/SourceHanSansCN-Medium.ttf', enabled: false },
        ],
        enabled: true,
        legacyIds: ['qiniu-default', 'site-font'],
      },
    ],
  }
}

/** @param {unknown} raw */
function normalizeFontUrlEntries(raw) {
  /** @type {{ url: string, enabled: boolean }[]} */
  const entries = []
  if (Array.isArray(raw?.urls)) {
    for (const item of raw.urls) {
      const url = String(item?.url || '').trim()
      if (!url) continue
      entries.push({ url, enabled: item?.enabled !== false })
    }
  }
  if (!entries.length) {
    const single = String(raw?.url || '').trim()
    if (single) entries.push({ url: single, enabled: true })
  }
  return entries
}

/** 判断当前是否为生产/服务器环境 */
function isProductionEnv() {
  return process.env.NODE_ENV === 'production'
}

/** 检测字体 URL 类型：cdn（CDN 外链）/ local（本地路径）/ path（其他） */
function detectFontUrlType(url) {
  const trimmed = String(url || '').trim()
  if (/^https?:\/\//i.test(trimmed)) return 'cdn'
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return 'local'
  return 'path'
}

/**
 * 根据当前环境重排 URL 顺序：本地环境优先本地路径，生产环境优先 CDN 路径。
 * 每个字体源同时保存了本地和 CDN 地址时，系统自动选择与环境匹配的地址。
 */
function reorderUrlsForEnv(entries) {
  if (!entries.length) return entries
  const preferredType = isProductionEnv() ? 'cdn' : 'local'
  const preferred = []
  const others = []
  for (const entry of entries) {
    if (detectFontUrlType(entry.url) === preferredType) {
      preferred.push(entry)
    } else {
      others.push(entry)
    }
  }
  return [...preferred, ...others]
}

/** @param {{ url: string, enabled?: boolean }[]} entries */
export function enforceSingleEnabledUrlPerSource(entries) {
  if (!entries.length) return entries
  let picked = false
  return entries.map((entry) => {
    if (entry.enabled !== false && !picked) {
      picked = true
      return { ...entry, enabled: true }
    }
    return { ...entry, enabled: false }
  })
}

/** @param {{ url: string, enabled?: boolean }[]} entries */
export function resolvePrimaryFontUrl(entries) {
  return enforceSingleEnabledUrlPerSource(entries).find((u) => u.enabled)?.url
    || entries[0]?.url
    || ''
}

/** @param {unknown} raw */
function normalizeLegacyIds(raw) {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))]
}

function parseConfig(raw) {
  if (!raw) return defaultFontConfig()
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.sources)) return defaultFontConfig()
    return {
      activeId: data.activeId || data.sources[0]?.id || null,
      sources: data.sources.map((s) => {
        const urls = enforceSingleEnabledUrlPerSource(normalizeFontUrlEntries(s).map((entry) => ({
          url: String(entry.url || '').trim(),
          enabled: entry.enabled !== false,
        })))
        return {
          id: String(s.id || crypto.randomUUID()),
          label: String(s.label || '未命名').trim() || '未命名',
          urls,
          url: resolvePrimaryFontUrl(urls),
          enabled: s.enabled !== false,
          legacyIds: normalizeLegacyIds(s.legacyIds),
        }
      }),
    }
  } catch {
    return defaultFontConfig()
  }
}

/** 用于判断「同名」：忽略首尾空格，不区分大小写 */
export function fontLabelKey(label) {
  return String(label || '').trim().toLowerCase() || '未命名'
}

/** 读取配置时：同名仅保留先启用的一项，其余自动取消启用 */
export function dedupeEnabledFontLabels(sources) {
  const seen = new Set()
  return sources.map((s) => {
    if (!s.enabled) return s
    const key = fontLabelKey(s.label)
    if (seen.has(key)) return { ...s, enabled: false }
    seen.add(key)
    return s
  })
}

/** 保存时校验：禁止两个已启用项使用相同显示名称 */
export function assertUniqueEnabledFontLabels(sources) {
  const seen = new Map()
  for (const s of sources) {
    if (!s.enabled) continue
    const key = fontLabelKey(s.label)
    const display = String(s.label || '').trim() || '未命名'
    if (seen.has(key)) {
      throw new Error(`不能同时启用两个同名的字体源「${display}」。请修改其中一个的名称，或取消启用。`)
    }
    seen.set(key, display)
  }
}

function finalizeFontConfig({ activeId, sources }, { strict = false } = {}) {
  let list = sources
  if (strict) assertUniqueEnabledFontLabels(list)
  else list = dedupeEnabledFontLabels(list)
  let nextActive = activeId
  if (!list.some((s) => s.id === nextActive && s.enabled)) {
    nextActive = list.find((s) => s.enabled)?.id || list[0]?.id || ''
  }
  return { activeId: nextActive, sources: list }
}

export function getFontConfig(db) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(FONT_SETTINGS_KEY)
  return finalizeFontConfig(parseConfig(row?.value))
}

export function saveFontConfig(db, config) {
  const prev = getFontConfig(db)
  const normalized = normalizeFontConfig(config)
  attachLegacyIdsFromRemovedSources(prev.sources, normalized.sources)
  const value = JSON.stringify(normalized)
  db.prepare(`
    INSERT INTO site_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(FONT_SETTINGS_KEY, value, new Date().toISOString())
  return normalized
}

/** 删除旧字体源后，把旧 id 挂到同名新源上，避免布局模板 fontSourceId 失效 */
function attachLegacyIdsFromRemovedSources(prevSources, nextSources) {
  const nextIds = new Set(nextSources.map((s) => s.id))
  for (const old of prevSources) {
    if (nextIds.has(old.id)) continue
    const replacement = nextSources.find((s) => fontLabelKey(s.label) === fontLabelKey(old.label))
    if (!replacement) continue
    replacement.legacyIds = [...new Set([...(replacement.legacyIds || []), old.id, ...(old.legacyIds || [])])]
  }
  for (const next of nextSources) {
    const prev = prevSources.find((s) => s.id === next.id)
    if (!prev) continue
    mergePreviousFontUrlsIntoSource(prev, next)
  }
}

/** 保存时合并历史地址，避免直接改地址框导致旧本地/CDN 路径丢失 */
export function mergePreviousFontUrlsIntoSource(prev, next) {
  const urls = enforceSingleEnabledUrlPerSource([...(next.urls || normalizeFontUrlEntries(next))])
  const prevEntries = normalizeFontUrlEntries(prev)
  const prevActive = prevEntries.find((entry) => entry.enabled !== false)?.url || prev.url
  const nextActive = resolvePrimaryFontUrl(urls)
  if (prevActive && nextActive && prevActive !== nextActive && !urls.some((u) => u.url === prevActive)) {
    urls.push({ url: prevActive, enabled: false })
  }
  next.urls = enforceSingleEnabledUrlPerSource(urls)
  next.url = resolvePrimaryFontUrl(next.urls)
  return next
}

export function normalizeFontConfig(input) {
  const base = defaultFontConfig()
  const sources = Array.isArray(input?.sources) ? input.sources : base.sources
  const normalizedSources = sources.map((s, i) => {
    const urlEntries = enforceSingleEnabledUrlPerSource(
      normalizeFontUrlEntries(s)
        .map((entry) => ({
          url: String(entry.url || '').trim(),
          enabled: entry.enabled !== false,
        }))
        .filter((entry) => entry.url)
        .map((entry) => ({
          url: validateFontUrl(entry.url),
          enabled: entry.enabled,
        })),
    )
    if (!urlEntries.length) {
      throw new Error(`字体「${String(s.label || '未命名').trim() || '未命名'}」至少需要一个有效地址`)
    }
    return {
      id: String(s.id || `src-${i + 1}`),
      label: String(s.label || '未命名').trim() || '未命名',
      urls: urlEntries,
      url: resolvePrimaryFontUrl(urlEntries),
      enabled: s.enabled !== false,
      legacyIds: normalizeLegacyIds(s.legacyIds),
    }
  })
  if (normalizedSources.length === 0) {
    normalizedSources.push(...base.sources)
  }
  let activeId = String(input?.activeId || '').trim()
  const enabled = normalizedSources.filter((s) => s.enabled)
  return finalizeFontConfig(
    {
      activeId,
      sources: normalizedSources,
    },
    { strict: true },
  )
}

/** @param {string} url */
export function validateFontUrl(url) {
  if (!url) throw new Error('字体地址不能为空')
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return url
  if (url.startsWith('./') || url.startsWith('../')) return url
  throw new Error('字体地址须为 https:// 外链，或以 / ./ ../ 开头的站内路径')
}

export function getActiveFontSource(db) {
  const config = getFontConfig(db)
  const enabled = config.sources.filter((s) => s.enabled)
  const active =
    enabled.find((s) => s.id === config.activeId) ||
    enabled[0] ||
    config.sources[0]
  if (!active?.url) {
    return { id: null, label: '默认 CDN', url: DEFAULT_FONT_CDN }
  }
  // 环境感知：从 urls 中选择最适合当前环境的地址
  const urls = active.urls?.length
    ? active.urls
    : [{ url: active.url, enabled: true }]
  const reordered = enforceSingleEnabledUrlPerSource(reorderUrlsForEnv(urls))
  const envUrl = reordered.find((u) => u.enabled)?.url || reordered[0]?.url || active.url
  return { ...active, url: envUrl }
}

export function getActiveFontUrl(db) {
  return getActiveFontSource(db).url
}

/** 供编辑页下拉与 SVG 注入：仅返回已启用项 */
export function cssFamilyForSourceId(id) {
  const safe = String(id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `CatFont_${safe}`
}

export function getPublicFontCatalog(db) {
  const config = getFontConfig(db)
  const sources = config.sources
    .filter((s) => s.enabled && s.url)
    .map((s) => {
      // 环境感知：重排 URL 顺序，使当前环境匹配的地址排在前面并启用
      const rawUrls = s.urls?.length ? s.urls : [{ url: s.url, enabled: true }]
      const envUrls = enforceSingleEnabledUrlPerSource(reorderUrlsForEnv(rawUrls))
      return {
        id: s.id,
        label: s.label,
        url: envUrls.find((u) => u.enabled)?.url || envUrls[0]?.url || s.url,
        urls: envUrls.map((entry) => ({
          url: entry.url,
          enabled: entry.enabled !== false,
        })),
        legacyIds: s.legacyIds || [],
        cssFamily: cssFamilyForSourceId(s.id),
        enabled: true,
      }
    })
  const active = getActiveFontSource(db)
  const defaultSourceId = sources.some((s) => s.id === config.activeId)
    ? config.activeId
    : (sources[0]?.id || active.id || '')
  return {
    url: active.url,
    label: active.label,
    id: active.id,
    defaultSourceId,
    sources,
  }
}

export function seedFontSettings(db) {
  const row = db.prepare('SELECT 1 FROM site_settings WHERE key = ?').get(FONT_SETTINGS_KEY)
  if (row) return
  saveFontConfig(db, defaultFontConfig())
}

const FONT_UPLOAD_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const FONT_UPLOAD_MIME = new Set([
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/font-sfnt',
  'application/x-font-ttf',
  'application/x-font-opentype',
  'application/vnd.ms-fontobject',
  'application/octet-stream',
])
const MAX_FONT_UPLOAD_BYTES = 30 * 1024 * 1024

export function getPublicFontDir(projectRoot) {
  const fontDir = path.join(projectRoot, 'public', 'font')
  fs.mkdirSync(fontDir, { recursive: true })
  return fontDir
}

function sanitizeFontFilename(name) {
  const base = path.basename(String(name || 'font.ttf'))
  const ext = path.extname(base).toLowerCase()
  const stem = path.basename(base, ext).replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 80) || 'font'
  const safeExt = FONT_UPLOAD_EXT.has(ext) ? ext : '.ttf'
  return `${stem}${safeExt}`
}

const PUBLIC_BROWSE_ROOT = 'public'

export function resolvePublicBrowsePath(projectRoot, relPath) {
  const cleaned = String(relPath || `${PUBLIC_BROWSE_ROOT}/font`).trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!cleaned || cleaned.includes('..')) {
    throw new Error('无效路径')
  }
  const parts = cleaned.split('/').filter(Boolean)
  if (parts[0] !== PUBLIC_BROWSE_ROOT) {
    throw new Error('只能浏览 public/ 目录及其子文件夹')
  }
  const rel = parts.join('/')
  const full = path.resolve(projectRoot, rel)
  const publicRoot = path.resolve(projectRoot, PUBLIC_BROWSE_ROOT)
  if (full !== publicRoot && !full.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error('只能浏览 public/ 目录')
  }
  return { full, rel }
}

export function publicFontUrlFromRel(relPath) {
  const sub = String(relPath || '').replace(/^public\/?/i, '').replace(/\\/g, '/')
  const segments = sub.split('/').filter(Boolean)
  return `/${segments.join('/')}`
}

export function browsePublicFonts(projectRoot, relPath) {
  const { full, rel } = resolvePublicBrowsePath(projectRoot, relPath)
  let parent = null
  if (rel !== PUBLIC_BROWSE_ROOT) {
    const parts = rel.split('/').filter(Boolean)
    parts.pop()
    parent = parts.length ? parts.join('/') : PUBLIC_BROWSE_ROOT
  }

  const breadcrumbs = []
  const parts = rel.split('/').filter(Boolean)
  for (let i = 0; i < parts.length; i += 1) {
    breadcrumbs.push({
      name: parts[i],
      path: parts.slice(0, i + 1).join('/'),
    })
  }

  const dirs = []
  const files = []
  let entries = []
  try {
    entries = fs.readdirSync(full, { withFileTypes: true })
  } catch {
    entries = []
  }

  const sorted = entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1
    const bDir = b.isDirectory() ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  for (const ent of sorted) {
    if (ent.name.startsWith('.')) continue
    const childRel = `${rel}/${ent.name}`.replace(/\/+/g, '/')
    if (ent.isDirectory()) {
      let itemCount = 0
      try {
        itemCount = fs
          .readdirSync(path.join(full, ent.name))
          .filter((n) => !n.startsWith('.')).length
      } catch {
        // ignore
      }
      dirs.push({ name: ent.name, path: childRel, itemCount })
      continue
    }
    if (!ent.isFile()) continue
    const ext = path.extname(ent.name).toLowerCase()
    const isFont = FONT_UPLOAD_EXT.has(ext)
    const fileFull = path.join(full, ent.name)
    let size = 0
    let mtime = 0
    try {
      const st = fs.statSync(fileFull)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      // ignore
    }
    files.push({
      name: ent.name,
      path: childRel,
      url: isFont ? publicFontUrlFromRel(childRel) : null,
      size,
      mtime,
      kind: isFont ? 'font' : 'other',
      ext,
    })
  }

  const fontCount = files.filter((f) => f.kind === 'font').length

  return {
    path: rel,
    parent,
    breadcrumbs,
    dirs,
    files,
    publicUrl: publicFontUrlFromRel(rel),
    stats: {
      dirs: dirs.length,
      files: files.length,
      fonts: fontCount,
    },
  }
}

/** @deprecated 使用 browsePublicFonts */
export function listLocalFontFiles(projectRoot) {
  const data = browsePublicFonts(projectRoot, `${PUBLIC_BROWSE_ROOT}/font`)
  return { dir: data.path, files: data.files }
}

function formatFontBytes(n) {
  const size = Number(n) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

/** @param {Buffer} buf */
function isFontMagic(buf) {
  if (!buf || buf.length < 4) return false
  const sig = buf.toString('ascii', 0, 4)
  if (sig === 'wOFF' || sig === 'wOF2' || sig === 'OTTO' || sig === 'true') return true
  return buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0
}

/** @param {string} projectRoot @param {string} url */
function resolveLocalFontFile(projectRoot, url) {
  const trimmed = String(url || '').trim()
  if (trimmed.startsWith('/')) {
    const sub = trimmed.replace(/^\/+/, '')
    return path.resolve(projectRoot, 'public', sub)
  }
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    const resolved = path.resolve(projectRoot, trimmed)
    const publicRoot = path.resolve(projectRoot, 'public')
    if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) {
      throw new Error('只能测试 public/ 目录内的相对路径')
    }
    return resolved
  }
  return null
}

/** @param {string} projectRoot @param {string} url */
export async function testFontUrl(projectRoot, url) {
  const trimmed = String(url || '').trim()
  validateFontUrl(trimmed)

  if (/^https?:\/\//i.test(trimmed)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(trimmed, {
        method: 'GET',
        headers: { Range: 'bytes=0-4095' },
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
      const sample = Buffer.from(await res.arrayBuffer())
      if (!sample.length) throw new Error('响应为空')
      if (!isFontMagic(sample)) throw new Error('响应内容不是有效的字体文件')
      const contentLength = Number(res.headers.get('content-length') || res.headers.get('content-range')?.split('/')?.[1] || 0)
      const size = contentLength > sample.length ? contentLength : null
      return {
        ok: true,
        url: trimmed,
        kind: 'remote',
        size,
        contentType: res.headers.get('content-type') || null,
        message: size ? `远程可用 · ${formatFontBytes(size)}` : `远程可用 · 已验证字体头`,
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('请求超时（20s）')
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  const filePath = resolveLocalFontFile(projectRoot, trimmed)
  if (!filePath) throw new Error('无法解析本地路径')
  if (!fs.existsSync(filePath)) throw new Error('文件不存在')
  const st = fs.statSync(filePath)
  if (!st.isFile()) throw new Error('路径不是文件')
  if (st.size < 1024) throw new Error('文件过小，可能已损坏')
  const fd = fs.openSync(filePath, 'r')
  try {
    const sample = Buffer.alloc(Math.min(4096, st.size))
    const n = fs.readSync(fd, sample, 0, sample.length, 0)
    if (!isFontMagic(sample.subarray(0, n))) throw new Error('文件不是有效的字体格式')
  } finally {
    fs.closeSync(fd)
  }
  return {
    ok: true,
    url: trimmed,
    kind: 'local',
    size: st.size,
    message: `本地可用 · ${formatFontBytes(st.size)}`,
  }
}

/**
 * @param {import('hono').Hono} app
 * @param {{ projectRoot: string, requireAuth: import('hono').MiddlewareHandler, requireModuleFonts: import('hono').MiddlewareHandler }} opts
 */
export function registerFontAssetRoutes(app, { projectRoot, requireAuth, requireModuleFonts }) {
  const fontDir = getPublicFontDir(projectRoot)
  const guard = requireModuleFonts || requireAuth

  app.get('/api/settings/fonts/local-files', requireAuth, guard, (c) => {
    return c.json(listLocalFontFiles(projectRoot))
  })

  app.get('/api/settings/fonts/browse', requireAuth, guard, (c) => {
    const relPath = c.req.query('path') || `${PUBLIC_BROWSE_ROOT}/font`
    try {
      return c.json(browsePublicFonts(projectRoot, relPath))
    } catch (err) {
      return c.json({ error: err.message || '无法浏览该路径' }, 400)
    }
  })

  app.post('/api/settings/fonts/test', requireAuth, guard, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const url = String(body?.url || '').trim()
    if (!url) return c.json({ error: '请提供 url' }, 400)
    try {
      const result = await testFontUrl(projectRoot, url)
      return c.json(result)
    } catch (err) {
      return c.json({ ok: false, error: err.message || '测试失败' }, 200)
    }
  })

  app.post('/api/settings/fonts/upload', requireAuth, guard, async (c) => {
    const body = await c.req.parseBody()
    const file = body.file ?? body.font
    if (!file || typeof file === 'string') {
      return c.json({ error: '请使用 multipart 字段 file 上传字体文件' }, 400)
    }

    const type = (file.type || 'application/octet-stream').toLowerCase()
    let safeName = sanitizeFontFilename(file.name)
    const ext = path.extname(safeName).toLowerCase()
    if (!FONT_UPLOAD_EXT.has(ext)) {
      return c.json({ error: '仅支持 .ttf / .otf / .woff / .woff2 字体文件' }, 400)
    }
    if (type !== 'application/octet-stream' && !FONT_UPLOAD_MIME.has(type)) {
      return c.json({ error: '文件类型不是支持的字体格式' }, 400)
    }

    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length > MAX_FONT_UPLOAD_BYTES) {
      return c.json({ error: '字体文件不能超过 30MB' }, 400)
    }
    if (buf.length < 1024) {
      return c.json({ error: '字体文件过小或已损坏' }, 400)
    }

    let destPath = path.join(fontDir, safeName)
    if (fs.existsSync(destPath)) {
      safeName = `${Date.now()}-${safeName}`
      destPath = path.join(fontDir, safeName)
    }
    fs.writeFileSync(destPath, buf)

    const url = `/font/${safeName}`
    return c.json({
      url,
      name: safeName,
      size: buf.length,
    })
  })
}
