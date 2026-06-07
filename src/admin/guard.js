import { api } from '../api/client.js'
import { redirectToAdminLogin } from '../adminLoginRedirect.js'

/** 管理端入口：未登录跳转登录页 */
export async function requireAdminSession() {
  try {
    const { user } = await api.me()
    if (!user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      await redirectToAdminLogin(`?next=${next}`)
      return null
    }
    return user
  } catch {
    await redirectToAdminLogin()
    return null
  }
}
