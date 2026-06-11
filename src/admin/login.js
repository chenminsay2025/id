import { api } from '../api/client.js'

const form = document.getElementById('login-form')
const errEl = document.getElementById('login-error')

form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  errEl.textContent = ''
  const username = document.getElementById('login-username').value.trim()
  const password = document.getElementById('login-password').value
  try {
    await api.login(username, password)
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next') || '/admin.html'
    window.location.href = next
  } catch (err) {
    errEl.textContent = err.message || '登录失败'
  }
})

api.me()
  .then(({ user }) => {
    if (user) {
      const params = new URLSearchParams(window.location.search)
      window.location.href = params.get('next') || '/admin.html'
    }
  })
  .catch((err) => {
    errEl.textContent =
      err.message ||
      '无法连接服务，请稍后重试或联系管理员'
  })
