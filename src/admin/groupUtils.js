import { api } from '../api/client.js'

/** @type {{ id: number, name: string, slug: string }[] | null} */
let cachedGroups = null

/** @param {{ group_ids?: number[], is_super_admin?: boolean } | null} user */
export function userNeedsGroupPick(user) {
  if (!user) return false
  if (user.is_super_admin) return (cachedGroups?.length || 0) > 1
  return (user.group_ids?.length || 0) > 1
}

export async function loadAccessibleGroups(force = false) {
  if (!force && cachedGroups) return cachedGroups
  const { groups } = await api.listGroups()
  cachedGroups = groups || []
  return cachedGroups
}

export function invalidateGroupCache() {
  cachedGroups = null
}

/**
 * 创建资源前选择访问组
 * @param {{ group_ids?: number[], is_super_admin?: boolean } | null} user
 * @param {string} [label]
 * @returns {Promise<number | null>}
 */
export async function pickGroupIdForCreate(user, label = '所属访问组') {
  const groups = await loadAccessibleGroups()
  if (!groups.length) throw new Error('当前账号未分配任何访问组')
  let allowed = groups
  if (!user?.is_super_admin && user?.group_ids?.length) {
    const set = new Set(user.group_ids)
    allowed = groups.filter((g) => set.has(g.id))
  }
  if (!allowed.length) throw new Error('当前账号未分配任何访问组')
  if (allowed.length === 1) return allowed[0].id

  const lines = allowed.map((g, i) => `${i + 1}. ${g.name}`).join('\n')
  const input = window.prompt(`${label}（输入序号）:\n${lines}`, '1')
  if (input == null) return null
  const idx = Number(String(input).trim()) - 1
  if (!Number.isFinite(idx) || idx < 0 || idx >= allowed.length) {
    throw new Error('无效的组序号')
  }
  return allowed[idx].id
}

export function groupNameById(groups, id) {
  if (id == null) return '—'
  const row = (groups || []).find((g) => g.id === id)
  return row?.name || `#${id}`
}

/** @param {{ group_ids?: number[], is_super_admin?: boolean } | null} user @param {{ id: number }[]} groups */
export function allowedGroupsForUser(user, groups) {
  if (!groups?.length) return []
  if (user?.is_super_admin) return groups
  const set = new Set(user.group_ids || [])
  return groups.filter((g) => set.has(g.id))
}

/** 单组用户创建时的默认 group_id */
export function defaultGroupIdForUser(user, groups) {
  const allowed = allowedGroupsForUser(user, groups)
  if (allowed.length === 1) return allowed[0].id
  if (user?.group_ids?.length === 1) return user.group_ids[0]
  return null
}

export function shouldShowGroupUi(user, groups) {
  return allowedGroupsForUser(user, groups).length > 0
}
