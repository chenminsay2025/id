import { adminHasModule } from './adminModules.js'
import { getStorageStats } from './dataMaintenance.js'
import { getSystemMetrics, sampleCpuUsagePct, sampleNetworkSpeed } from './systemMetrics.js'
import { sqlGroupInClause } from './accessControl.js'

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('./accessControl.js').AdminPrincipal} principal
 */
function getDashboardQuickStats(db, principal) {
  const gf = sqlGroupInClause(principal)
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'draft' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS draft,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trashed
    FROM certificates WHERE 1=1${gf.clause}
  `).get(...gf.params)
  return {
    certificates: Number(row?.total || 0),
    published: Number(row?.published || 0),
    draft: Number(row?.draft || 0),
    trashed: Number(row?.trashed || 0),
  }
}

/**
 * @param {import('hono').Hono} app
 * @param {{ db: import('better-sqlite3').Database, projectRoot: string, requireAuth: Function }} opts
 */
export function registerDashboardRoutes(app, { db, projectRoot, requireAuth }) {
  app.get('/api/dashboard/overview', requireAuth, async (c) => {
    const principal = c.get('principal')
    const [cpuUsagePct, networkSpeed] = await Promise.all([
      sampleCpuUsagePct(),
      sampleNetworkSpeed(),
    ])
    const payload = {
      ok: true,
      system: getSystemMetrics({ cpuUsagePct, networkSpeed }),
      quick_stats: getDashboardQuickStats(db, principal),
      storage: null,
    }
    if (adminHasModule(principal, 'maintenance')) {
      payload.storage = getStorageStats(db, projectRoot)
    }
    return c.json(payload)
  })
}
