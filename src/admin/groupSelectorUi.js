import { allowedGroupsForUser, groupNameById } from './groupUtils.js'

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 访问组下拉（单组只读，多组/超管可选）
 * @param {{ selectId: string, groups: { id: number, name: string }[], user?: object, selectedId?: number | null, compact?: boolean }} opts
 */
export function groupSelectFieldHtml(opts) {
  const { selectId, groups, user, selectedId = null, compact = false } = opts
  const allowed = allowedGroupsForUser(user, groups)
  if (!allowed.length) return ''

  const label = compact ? '所属组' : '访问组'
  if (allowed.length === 1 && !user?.is_super_admin) {
    return `
      <div class="resource-group-field resource-group-field--readonly" data-group-field="${escapeHtml(selectId)}">
        <span class="resource-group-label">${label}</span>
        <span class="resource-group-value">${escapeHtml(allowed[0].name)}</span>
        <input type="hidden" id="${escapeHtml(selectId)}" value="${allowed[0].id}" />
      </div>
    `
  }

  const options = allowed.map((g) => {
    const sel = Number(selectedId) === g.id ? ' selected' : ''
    return `<option value="${g.id}"${sel}>${escapeHtml(g.name)}</option>`
  }).join('')

  return `
    <label class="resource-group-field" for="${escapeHtml(selectId)}">
      <span class="resource-group-label">${label}</span>
      <select id="${escapeHtml(selectId)}" class="wp-select resource-group-select">${options}</select>
    </label>
  `
}

/** @param {ParentNode} root @param {string} selectId @param {{ id: number }[]} groups @param {object} [user] */
export function readGroupSelectValue(root, selectId, groups, user) {
  const el = root.querySelector(`#${selectId}`)
  if (!el) {
    const allowed = allowedGroupsForUser(user, groups)
    return allowed.length === 1 ? allowed[0].id : null
  }
  if (el.tagName === 'INPUT') return Number(el.value) || null
  return Number(el.value) || null
}

/** @param {number | null | undefined} groupId @param {{ id: number, name: string }[]} groups */
export function groupBadgeHtml(groupId, groups) {
  const name = groupNameById(groups, groupId)
  if (name === '—') return ''
  return `<span class="resource-group-badge" title="所属组">${escapeHtml(name)}</span>`
}
