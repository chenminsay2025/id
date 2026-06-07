import { slugify } from './db.js'
import { ROLES, backfillNullResourceGroupIds, ensureUngroupedGroup } from './accessControl.js'
import { migrateGroupMergeLog } from './groupMerge.js'
import { backfillPublishedCertificateAccessGroups } from './certificateAccessGroup.js'
import { applyCertificateGroupIdChange } from './certificatePublicSlug.js'
import { migrateAdminUserModules } from './adminModules.js'

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/**
 * 多组权限：建表、资源 group_id、默认组与首个管理员
 * @param {import('better-sqlite3').Database} db
 */
export function migrateAccessGroups(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_user_groups (
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_id),
      FOREIGN KEY (user_id) REFERENCES admin_user(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES access_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS visitor_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitor_user_groups (
      visitor_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (visitor_id, group_id),
      FOREIGN KEY (visitor_id) REFERENCES visitor_users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES access_groups(id) ON DELETE CASCADE
    );
  `)

  ensureColumn(db, 'admin_user', 'role', "TEXT NOT NULL DEFAULT 'admin'")
  ensureColumn(db, 'admin_user', 'avatar_path', 'TEXT')
  ensureColumn(db, 'visitor_users', 'avatar_path', 'TEXT')
  ensureColumn(db, 'svg_templates', 'group_id', 'INTEGER REFERENCES access_groups(id) ON DELETE SET NULL')
  ensureColumn(db, 'table_templates', 'group_id', 'INTEGER REFERENCES access_groups(id) ON DELETE SET NULL')
  ensureColumn(db, 'layout_presets', 'group_id', 'INTEGER REFERENCES access_groups(id) ON DELETE SET NULL')
  ensureColumn(db, 'certificates', 'group_id', 'INTEGER REFERENCES access_groups(id) ON DELETE SET NULL')

  const ts = new Date().toISOString()
  let defaultGroupId = db.prepare('SELECT id FROM access_groups WHERE slug = ?').get('default')?.id
  if (!defaultGroupId) {
    const ins = db.prepare(`
      INSERT INTO access_groups (name, slug, created_at, updated_at) VALUES (?, ?, ?, ?)
    `).run('默认组', 'default', ts, ts)
    defaultGroupId = Number(ins.lastInsertRowid)
  }

  for (const table of ['svg_templates', 'table_templates', 'layout_presets']) {
    db.prepare(`UPDATE ${table} SET group_id = ? WHERE group_id IS NULL`).run(defaultGroupId)
  }
  const nullGroupCerts = db.prepare('SELECT id FROM certificates WHERE group_id IS NULL').all()
  for (const { id } of nullGroupCerts) {
    applyCertificateGroupIdChange(db, id, defaultGroupId)
  }

  const firstAdmin = db.prepare('SELECT id, role FROM admin_user ORDER BY id LIMIT 1').get()
  if (firstAdmin) {
    if (!firstAdmin.role || firstAdmin.role === 'admin') {
      db.prepare(`UPDATE admin_user SET role = ? WHERE id = ?`).run(ROLES.SUPER_ADMIN, firstAdmin.id)
    }
    const hasLink = db.prepare('SELECT 1 FROM admin_user_groups WHERE user_id = ? LIMIT 1').get(firstAdmin.id)
    if (!hasLink) {
      const allGroups = db.prepare('SELECT id FROM access_groups').all()
      const ins = db.prepare('INSERT OR IGNORE INTO admin_user_groups (user_id, group_id) VALUES (?, ?)')
      for (const g of allGroups) ins.run(firstAdmin.id, g.id)
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_svg_tpl_group ON svg_templates(group_id);
    CREATE INDEX IF NOT EXISTS idx_tbl_tpl_group ON table_templates(group_id);
    CREATE INDEX IF NOT EXISTS idx_preset_group ON layout_presets(group_id);
    CREATE INDEX IF NOT EXISTS idx_cert_group ON certificates(group_id);
  `)

  backfillPublishedCertificateAccessGroups(db)
  migrateSiteBrandingByGroup(db)
  ensureUngroupedGroup(db)
  migrateGroupMergeLog(db)
  backfillNullResourceGroupIds(db)
  migrateAdminUserModules(db)
}

/**
 * 站点名称按访问组存储
 * @param {import('better-sqlite3').Database} db
 */
export function migrateSiteBrandingByGroup(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_branding_by_group (
      group_id INTEGER PRIMARY KEY REFERENCES access_groups(id) ON DELETE CASCADE,
      app_name TEXT NOT NULL,
      app_name_full TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      brand_mark TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const legacyRow = db.prepare("SELECT value FROM site_settings WHERE key = 'site_branding_config'").get()
  if (!legacyRow?.value) return

  const defaultGroupId = db.prepare("SELECT id FROM access_groups WHERE slug = 'default'").get()?.id
    || db.prepare('SELECT id FROM access_groups ORDER BY id LIMIT 1').get()?.id
  if (!defaultGroupId) return

  const hasAny = db.prepare('SELECT 1 FROM site_branding_by_group LIMIT 1').get()
  if (hasAny) return

  try {
    const data = JSON.parse(legacyRow.value)
    if (!data || typeof data !== 'object') return
    const ts = new Date().toISOString()
    db.prepare(`
      INSERT INTO site_branding_by_group (group_id, app_name, app_name_full, entity_label, brand_mark, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      defaultGroupId,
      String(data.appName || '猫咪血统证书').trim() || '猫咪血统证书',
      String(data.appNameFull || '猫咪血统证书生成器').trim() || '猫咪血统证书生成器',
      String(data.entityLabel || '证书').trim() || '证书',
      String(data.brandMark || '猫').trim() || '猫',
      ts,
    )
  } catch {
    /* ignore malformed legacy config */
  }
}
