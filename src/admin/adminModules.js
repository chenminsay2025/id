/** @typedef {{ key: string, label: string, section: 'template' | 'settings' }} AdminModuleDef */

/** @type {AdminModuleDef[]} */
export const ADMIN_MODULES = [
  { key: 'templates', label: 'SVG 模板库', section: 'template' },
  { key: 'table-templates', label: '表格模板库', section: 'template' },
  { key: 'layout-presets', label: '布局模板库', section: 'template' },
  { key: 'site', label: '站点设置', section: 'settings' },
  { key: 'fonts', label: '字体源', section: 'settings' },
  { key: 'maintenance', label: '数据维护', section: 'settings' },
  { key: 'access', label: '权限管理', section: 'settings' },
]

/** cms data-view → module key */
export const VIEW_MODULE_MAP = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, m.key]))

/**
 * @param {{ is_super_admin?: boolean, module_keys?: string[] }} user
 * @param {string} moduleKey
 */
export function userCanAccessModule(user, moduleKey) {
  if (user?.is_super_admin) return true
  return (user?.module_keys || []).includes(moduleKey)
}

export function moduleLabel(key) {
  return ADMIN_MODULES.find((m) => m.key === key)?.label || key
}

export function moduleBadgesHtml(moduleKeys) {
  const keys = moduleKeys || []
  if (!keys.length) return '<span class="access-muted">无</span>'
  return keys.map((k) => `<span class="access-module-badge">${moduleLabel(k)}</span>`).join('')
}
