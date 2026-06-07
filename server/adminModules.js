/** 后台侧栏模块权限（与 cms data-view 对应） */
export const ADMIN_MODULES = [
  { key: 'templates', label: 'SVG 模板库', section: 'template' },
  { key: 'table-templates', label: '表格模板库', section: 'template' },
  { key: 'layout-presets', label: '布局模板库', section: 'template' },
  { key: 'site', label: '站点设置', section: 'settings' },
  { key: 'fonts', label: '字体源', section: 'settings' },
  { key: 'maintenance', label: '数据维护', section: 'settings' },
  { key: 'access', label: '权限管理', section: 'settings' },
]

export const ALL_MODULE_KEYS = ADMIN_MODULES.map((m) => m.key)

/** 新建普通管理员的默认模块（不含权限管理与数据维护） */
export function defaultModuleKeysForNewAdmin() {
  return ['templates', 'table-templates', 'layout-presets', 'site', 'fonts']
}

/** 已有管理员迁移时的默认模块 */
export function defaultModuleKeysForExistingAdmin() {
  return defaultModuleKeysForNewAdmin()
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 */
export function getUserModuleKeys(db, userId) {
  try {
    return db.prepare(`
      SELECT module_key FROM admin_user_modules WHERE user_id = ? ORDER BY module_key
    `).all(userId).map((r) => r.module_key)
  } catch {
    return []
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {string[]} keys
 */
export function setUserModuleKeys(db, userId, keys) {
  const valid = [...new Set((keys || []).filter((k) => ALL_MODULE_KEYS.includes(k)))]
  db.transaction(() => {
    db.prepare('DELETE FROM admin_user_modules WHERE user_id = ?').run(userId)
    const ins = db.prepare('INSERT INTO admin_user_modules (user_id, module_key) VALUES (?, ?)')
    for (const k of valid) ins.run(userId, k)
  })()
  return valid
}

/**
 * @param {{ isSuperAdmin?: boolean, moduleKeys?: string[] }} principal
 * @param {string} moduleKey
 */
export function adminHasModule(principal, moduleKey) {
  if (principal?.isSuperAdmin) return true
  return (principal?.moduleKeys || []).includes(moduleKey)
}

export function moduleLabel(key) {
  return ADMIN_MODULES.find((m) => m.key === key)?.label || key
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function migrateAdminUserModules(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_user_modules (
      user_id INTEGER NOT NULL,
      module_key TEXT NOT NULL,
      PRIMARY KEY (user_id, module_key),
      FOREIGN KEY (user_id) REFERENCES admin_user(id) ON DELETE CASCADE
    );
  `)

  const users = db.prepare('SELECT id, role FROM admin_user').all()
  for (const u of users) {
    const existing = getUserModuleKeys(db, u.id)
    if (existing.length) continue
    if (u.role === 'super_admin') {
      setUserModuleKeys(db, u.id, ALL_MODULE_KEYS)
    } else {
      setUserModuleKeys(db, u.id, defaultModuleKeysForExistingAdmin())
    }
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: number, role?: string }} user
 */
export function loadUserModuleKeys(db, user) {
  if (user.role === 'super_admin') return ALL_MODULE_KEYS
  const keys = getUserModuleKeys(db, user.id)
  return keys.length ? keys : defaultModuleKeysForExistingAdmin()
}
