import { api } from '../api/client.js'
import { redirectToPublicLoginForPath } from '../publicLoginRedirect.js'

/** 前端：访客登录或已登录的后台管理员均可进入 */
export async function requireVisitorSession() {
  try {
    const { visitor } = await api.publicMe()
    if (visitor) return visitor
  } catch {
    /* fall through */
  }
  try {
    const { user } = await api.me()
    if (user) {
      return {
        id: user.id,
        username: user.username,
        group_ids: user.group_ids || [],
        is_admin: true,
        is_super_admin: !!user.is_super_admin,
        avatar_url: user.avatar_url || null,
      }
    }
  } catch {
    /* fall through */
  }
  await redirectToPublicLoginForPath(`${window.location.pathname}${window.location.search}`)
  return null
}
