/**
 * server/visitorTracking.js
 * 访客行为追踪与分析（保留 90 天，分页查询）
 */

import { getClientIp } from './rateLimit.js'
import { getTokenFromRequest, getVisitorCookieName, verifySession } from './auth.js'
import { sqlGroupInClause } from './accessControl.js'
import { resolveIpLocations } from './ipGeo.js'

const MAX_FIELD_LENGTH = 500
/** 访客活动日志保留天数 */
export const VISITOR_LOG_RETENTION_DAYS = 90
const PURGE_INTERVAL_MS = 3600_000
let lastPurgeMs = 0

const ACTIVITY_PATH_LABELS = {
  login: '登录',
  visitor_login: '访客登录',
  admin_login: '管理端登录',
  page_visit: '访问页面',
  page_view: '浏览证书',
  pdf_download: '下载 PDF',
  svg_download: '下载 SVG',
}

function truncate(val, max = MAX_FIELD_LENGTH) {
  if (val == null) return ''
  return String(val).slice(0, max)
}

function nowIso() {
  return new Date().toISOString()
}

/** @param {string} range */
export function parseAnalyticsRangeDays(range) {
  let days = 7
  if (range === '30d') days = 30
  else if (range === '90d') days = 90
  return Math.min(days, VISITOR_LOG_RETENTION_DAYS)
}

export function analyticsSinceIso(days) {
  const d = Math.min(Math.max(1, days), VISITOR_LOG_RETENTION_DAYS)
  return new Date(Date.now() - d * 86400_000).toISOString()
}

/** @param {import('better-sqlite3').Database} db @returns {number} */
export function purgeVisitorActivityRetention(db) {
  const now = Date.now()
  if (now - lastPurgeMs < PURGE_INTERVAL_MS) return 0
  lastPurgeMs = now
  const cutoff = analyticsSinceIso(VISITOR_LOG_RETENTION_DAYS)
  const result = db.prepare('DELETE FROM visitor_activity_log WHERE created_at < ?').run(cutoff)
  if (result.changes > 0) {
    console.log(`[TRACK] 已清理 ${result.changes} 条超过 ${VISITOR_LOG_RETENTION_DAYS} 天的访客记录`)
  }
  return result.changes
}

function parsePageQuery(c, defaultSize = 50) {
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(c.req.query('page_size')) || defaultSize))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function paginationMeta(page, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    has_prev: page > 1,
    has_next: page < totalPages,
  }
}

/** @param {unknown} raw */
export function parseActivityDetails(raw) {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw)
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' ? parsed : { _raw: String(raw) }
  } catch {
    return { _raw: String(raw) }
  }
}

/** @param {{ activity_type?: string, cert_title?: string, details?: unknown }} event */
export function eventPathLabel(event) {
  const d = parseActivityDetails(event.details)
  if (event.activity_type === 'page_visit') {
    return String(d.url || d.path || '访问页面')
  }
  if (event.activity_type === 'admin_login') {
    return String(d.page_url || d.url || d.path || '管理端登录')
  }
  if (event.activity_type === 'visitor_login') {
    return String(d.page_url || d.url || d.path || '访客登录')
  }
  if (event.activity_type === 'page_view' && event.cert_title) return String(event.cert_title).trim()
  if (event.activity_type === 'pdf_download') {
    const fn = d.filename ? ` · ${d.filename}` : ''
    return `下载 PDF${fn}`
  }
  if (event.activity_type === 'svg_download') {
    const fn = d.filename ? ` · ${d.filename}` : ''
    return `下载 SVG${fn}`
  }
  return ACTIVITY_PATH_LABELS[event.activity_type] || event.activity_type || '活动'
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   activityType: string,
 *   visitorId?: number | null,
 *   visitorName?: string,
 *   certId?: number | null,
 *   certTitle?: string,
 *   ipAddress?: string,
 *   userAgent?: string,
 *   referrer?: string,
 *   durationSeconds?: number,
 *   details?: Record<string, unknown>,
 * }} entry
 */
export function logVisitorActivity(db, entry) {
  const details = truncate(
    JSON.stringify(entry.details && typeof entry.details === 'object' ? entry.details : {}),
    2000,
  )
  db.prepare(`
    INSERT INTO visitor_activity_log
      (visitor_id, visitor_name, activity_type, cert_id, cert_title,
       ip_address, user_agent, referrer, duration_seconds, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.visitorId ?? null,
    truncate(entry.visitorName || '', 100),
    truncate(entry.activityType || '', 50),
    entry.certId ?? null,
    truncate(entry.certTitle || '', 200),
    truncate(entry.ipAddress || '', 45),
    truncate(entry.userAgent || '', MAX_FIELD_LENGTH),
    truncate(entry.referrer || '', MAX_FIELD_LENGTH),
    Math.max(0, Number(entry.durationSeconds || 0)),
    details,
    nowIso(),
  )
  purgeVisitorActivityRetention(db)
}

/** @param {{ activity_type?: string, cert_title?: string, details?: unknown }} event @param {number} [maxSteps] */
function buildPathPreview(events, maxSteps = 5) {
  if (!events?.length) return '—'
  const labels = events.map(eventPathLabel)
  if (labels.length <= maxSteps) return labels.join(' → ')
  const head = labels.slice(0, maxSteps - 1)
  return `${head.join(' → ')} → …（共 ${labels.length} 步）`
}

/** 从 cookie 中尝试解析访客信息（不抛异常，解析失败返回 null） */
async function tryResolveVisitor(db, req, secret) {
  try {
    const token = getTokenFromRequest(req, getVisitorCookieName())
    if (!token) return null
    const payload = await verifySession(token, secret)
    if (payload.typ !== 'visitor') return null
    const row = db.prepare('SELECT id, username FROM visitor_users WHERE id = ?').get(payload.sub)
    return row || null
  } catch {
    return null
  }
}

function resolveCertTitle(db, certId) {
  if (certId == null || Number.isNaN(Number(certId))) return ''
  const row = db.prepare('SELECT title FROM certificates WHERE id = ?').get(Number(certId))
  return row?.title || ''
}

/** @param {import('better-sqlite3').Database} db @param {string} since @param {string} ip */
function fetchTrailEventsForIp(db, since, ip) {
  return db.prepare(`
    SELECT id, visitor_name, activity_type, cert_title, ip_address,
           duration_seconds, created_at, details, referrer
    FROM visitor_activity_log
    WHERE created_at >= ? AND COALESCE(NULLIF(TRIM(ip_address), ''), '未知') = ?
    ORDER BY created_at ASC
  `).all(since, ip)
}

function mapActivityRow(r, locationMap) {
  const ipKey = String(r.ip_address || '').trim() || '未知'
  return {
    id: Number(r.id),
    visitor_name: r.visitor_name,
    activity_type: r.activity_type,
    cert_title: r.cert_title,
    ip_address: r.ip_address,
    ip_location: locationMap.get(ipKey) || '未知',
    duration_seconds: Number(r.duration_seconds || 0),
    created_at: r.created_at,
    referrer: r.referrer || '',
    details: parseActivityDetails(r.details),
  }
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, JWT_SECRET: string, requireAuth: Function }} opts
 */
export function registerTrackingRoutes(app, { db, JWT_SECRET, requireAuth }) {
  purgeVisitorActivityRetention(db)

  app.post('/api/track', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const activityType = truncate(body.activity_type || '', 50)
      if (!activityType) return c.json({ ok: true })

      const visitor = await tryResolveVisitor(db, c.req.raw, JWT_SECRET)
      const visitorId = visitor?.id ?? (body.visitor_id != null ? Number(body.visitor_id) : null)
      const visitorName = truncate(visitor?.username || body.visitor_name || '', 100)
      const certId = body.cert_id != null ? Number(body.cert_id) : null
      const certTitle = truncate(body.cert_title || resolveCertTitle(db, certId), 200)
      const durationSeconds = Math.max(0, Number(body.duration_seconds || 0))
      const ipAddress = truncate(getClientIp(c), 45)
      const userAgent = truncate(c.req.header('user-agent') || '', MAX_FIELD_LENGTH)
      const referrer = truncate(body.referrer || c.req.header('referer') || '', MAX_FIELD_LENGTH)
      const detailsRaw = typeof body.details === 'object'
        ? body.details
        : parseActivityDetails(body.details)

      logVisitorActivity(db, {
        activityType,
        visitorId,
        visitorName,
        certId,
        certTitle,
        ipAddress,
        userAgent,
        referrer,
        durationSeconds,
        details: detailsRaw,
      })

      return c.json({ ok: true })
    } catch (err) {
      console.error('[TRACK] 记录活动失败:', err)
      return c.json({ ok: false, error: err.message }, 500)
    }
  })

  /** 概览：摘要、趋势、热门证书 */
  app.get('/api/analytics/visitors', requireAuth, (c) => {
    purgeVisitorActivityRetention(db)
    const principal = c.get('principal')
    const range = c.req.query('range') || '90d'
    const group = c.req.query('group') || 'day'
    const days = parseAnalyticsRangeDays(range)
    const since = analyticsSinceIso(days)
    const gf = sqlGroupInClause(principal)

    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT COALESCE(NULLIF(ip_address, ''), NULLIF(visitor_name, ''), 'anon')) AS unique_visitors,
        SUM(CASE WHEN activity_type LIKE '%download' THEN 1 ELSE 0 END) AS total_downloads,
        AVG(CASE WHEN duration_seconds > 0 AND duration_seconds < 86400 THEN duration_seconds ELSE NULL END) AS avg_duration
      FROM visitor_activity_log
      WHERE created_at >= ?
    `).get(since)

    const dateFormat = group === 'hour'
      ? "strftime('%Y-%m-%dT%H:00:00', created_at)"
      : 'date(created_at)'
    const dailyStats = db.prepare(`
      SELECT
        ${dateFormat} AS date_key,
        COUNT(*) AS pv,
        COUNT(DISTINCT COALESCE(NULLIF(ip_address, ''), NULLIF(visitor_name, ''), 'anon')) AS uv,
        SUM(CASE WHEN activity_type LIKE '%download' THEN 1 ELSE 0 END) AS downloads,
        ROUND(AVG(CASE WHEN duration_seconds > 0 AND duration_seconds < 86400 THEN duration_seconds ELSE NULL END), 1) AS avg_seconds
      FROM visitor_activity_log
      WHERE created_at >= ?
      GROUP BY date_key
      ORDER BY date_key ASC
    `).all(since)

    let topCerts = []
    if (gf.clause) {
      topCerts = db.prepare(`
        SELECT
          al.cert_id,
          al.cert_title,
          SUM(CASE WHEN al.activity_type = 'page_view' THEN 1 ELSE 0 END) AS views,
          SUM(CASE WHEN al.activity_type LIKE '%download' THEN 1 ELSE 0 END) AS downloads
        FROM visitor_activity_log al
        JOIN certificates c ON c.id = al.cert_id
        WHERE al.created_at >= ? AND al.cert_id IS NOT NULL${gf.clause.replace(/AND\s+group_id/, 'AND c.group_id')}
        GROUP BY al.cert_id
        ORDER BY views DESC
        LIMIT 20
      `).all(since, ...gf.params)
    } else {
      topCerts = db.prepare(`
        SELECT
          cert_id, cert_title,
          SUM(CASE WHEN activity_type = 'page_view' THEN 1 ELSE 0 END) AS views,
          SUM(CASE WHEN activity_type LIKE '%download' THEN 1 ELSE 0 END) AS downloads
        FROM visitor_activity_log
        WHERE created_at >= ? AND cert_id IS NOT NULL
        GROUP BY cert_id
        ORDER BY views DESC
        LIMIT 20
      `).all(since)
    }

    return c.json({
      ok: true,
      retention_days: VISITOR_LOG_RETENTION_DAYS,
      range_days: days,
      summary: {
        total_events: Number(summary?.total_events || 0),
        unique_visitors: Number(summary?.unique_visitors || 0),
        total_downloads: Number(summary?.total_downloads || 0),
        avg_duration_seconds: Number(summary?.avg_duration || 0),
      },
      daily_stats: dailyStats.map((r) => ({
        ...r,
        pv: Number(r.pv),
        uv: Number(r.uv),
        downloads: Number(r.downloads),
        avg_seconds: r.avg_seconds != null ? Number(r.avg_seconds) : null,
      })),
      top_certs: topCerts.map((r) => ({
        cert_id: Number(r.cert_id),
        cert_title: r.cert_title,
        views: Number(r.views),
        downloads: Number(r.downloads),
      })),
    })
  })

  /** 最近活动 — 分页 */
  app.get('/api/analytics/visitors/recent', requireAuth, async (c) => {
    purgeVisitorActivityRetention(db)
    const range = c.req.query('range') || '90d'
    const days = parseAnalyticsRangeDays(range)
    const since = analyticsSinceIso(days)
    const { page, pageSize, offset } = parsePageQuery(c, 50)

    const total = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM visitor_activity_log WHERE created_at >= ?
    `).get(since)?.n || 0)

    const rows = db.prepare(`
      SELECT id, visitor_name, activity_type, cert_title, ip_address,
             duration_seconds, created_at, details, referrer
      FROM visitor_activity_log
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(since, pageSize, offset)

    const uniqueIps = [...new Set(rows.map((r) => String(r.ip_address || '').trim()).filter(Boolean))]
    const locationMap = await resolveIpLocations(uniqueIps)

    return c.json({
      ok: true,
      items: rows.map((r) => mapActivityRow(r, locationMap)),
      pagination: paginationMeta(page, pageSize, total),
    })
  })

  /** 按 IP 访客列表 — 分页（51.la 风格主表） */
  app.get('/api/analytics/visitors/trails', requireAuth, async (c) => {
    purgeVisitorActivityRetention(db)
    const range = c.req.query('range') || '90d'
    const days = parseAnalyticsRangeDays(range)
    const since = analyticsSinceIso(days)
    const { page, pageSize, offset } = parsePageQuery(c, 15)

    const total = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM visitor_activity_log
        WHERE created_at >= ?
        GROUP BY COALESCE(NULLIF(TRIM(ip_address), ''), '未知')
      )
    `).get(since)?.n || 0)

    const groups = db.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(ip_address), ''), '未知') AS ip_address,
        COUNT(*) AS event_count,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM visitor_activity_log
      WHERE created_at >= ?
      GROUP BY COALESCE(NULLIF(TRIM(ip_address), ''), '未知')
      ORDER BY last_seen DESC
      LIMIT ? OFFSET ?
    `).all(since, pageSize, offset)

    const ips = groups.map((g) => g.ip_address)
    const locationMap = await resolveIpLocations(ips)

    /** @type {Map<string, string>} */
    const visitorNameMap = new Map()
    /** @type {Map<string, string>} */
    const pathPreviewMap = new Map()

    if (ips.length) {
      const placeholders = ips.map(() => '?').join(',')
      const nameRows = db.prepare(`
        SELECT ip_address, visitor_name, created_at
        FROM visitor_activity_log
        WHERE created_at >= ?
          AND COALESCE(NULLIF(TRIM(ip_address), ''), '未知') IN (${placeholders})
          AND visitor_name IS NOT NULL AND TRIM(visitor_name) != ''
        ORDER BY created_at DESC
      `).all(since, ...ips)
      for (const row of nameRows) {
        const ip = String(row.ip_address || '').trim() || '未知'
        if (!visitorNameMap.has(ip) && row.visitor_name) {
          visitorNameMap.set(ip, row.visitor_name)
        }
      }

      for (const ip of ips) {
        const events = fetchTrailEventsForIp(db, since, ip)
        pathPreviewMap.set(ip, buildPathPreview(events))
      }
    }

    return c.json({
      ok: true,
      items: groups.map((g, index) => ({
        rank: offset + index + 1,
        ip_address: g.ip_address,
        ip_location: locationMap.get(g.ip_address) || '未知',
        visitor_name: visitorNameMap.get(g.ip_address) || '匿名',
        event_count: Number(g.event_count),
        first_seen: g.first_seen,
        last_seen: g.last_seen,
        path_preview: pathPreviewMap.get(g.ip_address) || '—',
      })),
      pagination: paginationMeta(page, pageSize, total),
    })
  })

  /** 单个 IP 的完整访问轨迹（展开时加载） */
  app.get('/api/analytics/visitors/trail-events', requireAuth, async (c) => {
    purgeVisitorActivityRetention(db)
    const range = c.req.query('range') || '90d'
    const days = parseAnalyticsRangeDays(range)
    const since = analyticsSinceIso(days)
    const ip = String(c.req.query('ip') || '').trim() || '未知'

    const rows = fetchTrailEventsForIp(db, since, ip)
    const locationMap = await resolveIpLocations([ip])

    return c.json({
      ok: true,
      ip_address: ip,
      ip_location: locationMap.get(ip) || '未知',
      path_preview: buildPathPreview(rows, 20),
      events: rows.map((r) => mapActivityRow(r, locationMap)),
    })
  })
}
