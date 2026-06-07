import { api } from '../api/client.js'
import { resolveAdminLoginHref } from '../adminLoginRedirect.js'
import { invalidatePublicLoginHrefCache, resolvePublicLoginSlug } from '../publicLoginRedirect.js'
import { sanitizePublicLoginNext } from '../publicLoginPath.js'

const form = document.getElementById('public-login-form')
const errEl = document.getElementById('public-login-error')
const adminLoginLink = document.getElementById('public-admin-login-link')

invalidatePublicLoginHrefCache()

async function redirectAfterPublicLogin() {
  const params = new URLSearchParams(window.location.search)
  const slug = await resolvePublicLoginSlug()
  const target = sanitizePublicLoginNext(params.get('next') || '/', slug)
  window.location.replace(target.startsWith('/') ? target : `/${target}`)
}

document.title = '前端登录'

void resolveAdminLoginHref().then((href) => {
  if (adminLoginLink) adminLoginLink.href = href
}).catch(() => {})

form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  errEl.textContent = ''
  const username = document.getElementById('public-login-username').value.trim()
  const password = document.getElementById('public-login-password').value
  try {
    await api.publicLogin(username, password)
    await redirectAfterPublicLogin()
  } catch (err) {
    errEl.textContent = err.message || '登录失败'
  }
})

api.publicMe()
  .then(({ visitor }) => {
    if (visitor) void redirectAfterPublicLogin()
  })
  .catch((err) => {
    errEl.textContent = err.message || '无法连接后端'
  })
