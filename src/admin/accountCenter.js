import { api } from '../api/client.js'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function avatarInitial(username) {
  return String(username || '?').slice(0, 1).toUpperCase()
}

function formatRoleLabel(user) {
  if (user?.is_super_admin) return '超级管理员'
  const n = user?.group_ids?.length || 0
  if (n === 0) return '管理员（未分配组）'
  if (n === 1) return '管理员'
  return `管理员 · ${n} 个组`
}

function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

/**
 * @param {HTMLElement} mountRoot 挂载 dialog 与查找侧栏 chip 的根节点
 * @param {{
 *   getUser: () => object,
 *   setUser: (user: object) => void,
 *   onStatus?: (msg: string) => void,
 *   formatRoleLabel?: (user: object) => string,
 *   fetchProfile?: () => Promise<{ profile: object }>,
 *   updateProfile?: (body: Record<string, unknown>) => Promise<{ profile: object }>,
 *   uploadMedia?: (file: File | Blob, filename?: string) => Promise<{ url: string }>,
 *   chipSelectors?: { avatar?: string | null, name?: string | null, role?: string | null },
 *   avatarImgClass?: string,
 *   dialogId?: string,
 *   showMetaSection?: boolean,
 * }} options
 */
export function mountAccountCenter(mountRoot, options = {}) {
  const roleLabel = options.formatRoleLabel || formatRoleLabel
  const fetchProfile = options.fetchProfile || (() => api.getProfile())
  const updateProfile = options.updateProfile || ((body) => api.updateProfile(body))
  const uploadMedia = options.uploadMedia || ((file, name) => api.uploadMedia(file, name))
  const chipSelectors = {
    avatar: '#cms-user-avatar',
    name: '#cms-user-name',
    role: '#cms-user-role',
    ...options.chipSelectors,
  }
  const avatarImgClass = options.avatarImgClass || 'wp-user-avatar-img'
  const dialogId = options.dialogId || 'cms-account-dialog'
  const showMetaSection = options.showMetaSection !== false

  const dialog = document.createElement('dialog')
  dialog.id = dialogId
  dialog.className = 'cms-dialog cms-account-dialog'
  dialog.innerHTML = `
    <h3 class="cms-account-title">账户中心</h3>
    <p class="cms-account-desc">管理头像、账号名与登录密码</p>
    <form class="cms-account-form" data-account-form>
      <section class="cms-account-section">
        <h4 class="cms-account-section-title">头像</h4>
        <div class="cms-account-avatar-row">
          <div class="cms-account-avatar-preview" data-account-avatar-preview aria-hidden="true"></div>
          <div class="cms-account-avatar-actions">
            <input type="file" data-account-avatar-file accept="image/png,image/jpeg,image/gif,image/webp" hidden />
            <button type="button" class="button button-sm button-secondary" data-account-avatar-pick>更换头像</button>
            <button type="button" class="button button-sm button-link" data-account-avatar-clear hidden>移除头像</button>
          </div>
        </div>
      </section>

      <section class="cms-account-section">
        <h4 class="cms-account-section-title">账号名</h4>
        <label class="cms-account-field">
          <span class="cms-account-label">登录用户名</span>
          <input type="text" name="username" maxlength="40" autocomplete="username" required />
        </label>
      </section>

      <section class="cms-account-section">
        <h4 class="cms-account-section-title">修改密码</h4>
        <p class="cms-account-hint">不修改密码请留空；填写新密码时须验证当前密码</p>
        <label class="cms-account-field">
          <span class="cms-account-label">当前密码</span>
          <input type="password" name="current_password" autocomplete="current-password" />
        </label>
        <label class="cms-account-field">
          <span class="cms-account-label">新密码</span>
          <input type="password" name="new_password" autocomplete="new-password" minlength="4" />
        </label>
      </section>

      ${showMetaSection ? `
      <section class="cms-account-section cms-account-meta">
        <h4 class="cms-account-section-title">账号信息</h4>
        <dl class="cms-account-meta-list">
          <div><dt>角色</dt><dd data-account-role>—</dd></div>
          <div><dt>创建时间</dt><dd data-account-created>—</dd></div>
        </dl>
      </section>
      ` : ''}

      <p class="cms-account-error" data-account-error role="alert" hidden></p>
      <div class="cms-dialog-actions">
        <button type="button" class="btn" data-account-cancel>取消</button>
        <button type="submit" class="btn btn-primary" data-account-submit>保存</button>
      </div>
    </form>
  `
  mountRoot.appendChild(dialog)

  const form = dialog.querySelector('[data-account-form]')
  const avatarPreview = dialog.querySelector('[data-account-avatar-preview]')
  const avatarFile = dialog.querySelector('[data-account-avatar-file]')
  const avatarPick = dialog.querySelector('[data-account-avatar-pick]')
  const avatarClear = dialog.querySelector('[data-account-avatar-clear]')
  const roleEl = dialog.querySelector('[data-account-role]')
  const createdEl = dialog.querySelector('[data-account-created]')
  const errorEl = dialog.querySelector('[data-account-error]')
  const submitBtn = dialog.querySelector('[data-account-submit]')

  /** @type {string | null | undefined} */
  let pendingAvatarPath = undefined
  /** @type {object | null} */
  let profile = null

  function setError(msg) {
    if (!errorEl) return
    if (!msg) {
      errorEl.hidden = true
      errorEl.textContent = ''
      return
    }
    errorEl.hidden = false
    errorEl.textContent = msg
  }

  function renderAvatarPreview(url, username) {
    if (!avatarPreview) return
    if (url) {
      avatarPreview.innerHTML = `<img src="${escapeHtml(url)}" alt="" class="cms-account-avatar-img" />`
      avatarPreview.classList.add('has-image')
    } else {
      avatarPreview.innerHTML = `<span class="cms-account-avatar-fallback">${escapeHtml(avatarInitial(username))}</span>`
      avatarPreview.classList.remove('has-image')
    }
  }

  function syncSidebarChip(user) {
    const avatarEl = chipSelectors.avatar ? mountRoot.querySelector(chipSelectors.avatar) : null
    const nameEl = chipSelectors.name ? mountRoot.querySelector(chipSelectors.name) : null
    const roleElChip = chipSelectors.role ? mountRoot.querySelector(chipSelectors.role) : null
    if (nameEl) nameEl.textContent = user.username
    if (roleElChip) roleElChip.textContent = roleLabel(user)
    if (avatarEl) {
      if (user.avatar_url) {
        avatarEl.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" alt="" class="${escapeHtml(avatarImgClass)}" />`
        avatarEl.classList.add('has-image')
      } else {
        avatarEl.textContent = avatarInitial(user.username)
        avatarEl.classList.remove('has-image')
      }
    }
  }

  function fillForm(data) {
    profile = data
    pendingAvatarPath = undefined
    form.querySelector('[name="username"]').value = data.username || ''
    form.querySelector('[name="current_password"]').value = ''
    form.querySelector('[name="new_password"]').value = ''
    if (roleEl) roleEl.textContent = roleLabel(data)
    if (createdEl) createdEl.textContent = formatDateTime(data.created_at)
    renderAvatarPreview(data.avatar_url, data.username)
    if (avatarClear) avatarClear.hidden = !data.avatar_url
    setError('')
  }

  async function open() {
    setError('')
    try {
      const res = await fetchProfile()
      fillForm(res.profile)
      dialog.showModal()
    } catch (err) {
      options.onStatus?.(err.message || '无法加载账户信息')
    }
  }

  avatarPick?.addEventListener('click', () => avatarFile?.click())

  avatarFile?.addEventListener('change', async () => {
    const file = avatarFile.files?.[0]
    avatarFile.value = ''
    if (!file) return
    setError('')
    try {
      avatarPick.disabled = true
      const uploaded = await uploadMedia(file, file.name)
      pendingAvatarPath = uploaded.url
      renderAvatarPreview(uploaded.url, form.querySelector('[name="username"]')?.value || profile?.username)
      if (avatarClear) avatarClear.hidden = false
    } catch (err) {
      setError(err.message || '头像上传失败')
    } finally {
      avatarPick.disabled = false
    }
  })

  avatarClear?.addEventListener('click', () => {
    pendingAvatarPath = null
    renderAvatarPreview(null, form.querySelector('[name="username"]')?.value || profile?.username)
    if (avatarClear) avatarClear.hidden = true
  })

  dialog.querySelector('[data-account-cancel]')?.addEventListener('click', () => dialog.close())

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    setError('')
    const fd = new FormData(form)
    const username = String(fd.get('username') || '').trim()
    const current_password = String(fd.get('current_password') || '')
    const new_password = String(fd.get('new_password') || '')

    if (!username) {
      setError('账号名不能为空')
      return
    }
    if (new_password && new_password.length < 4) {
      setError('新密码至少 4 位')
      return
    }
    if (new_password && !current_password) {
      setError('修改密码须填写当前密码')
      return
    }

    /** @type {Record<string, unknown>} */
    const body = { username }
    if (pendingAvatarPath !== undefined) body.avatar_path = pendingAvatarPath
    if (new_password) {
      body.current_password = current_password
      body.new_password = new_password
    }

    if (submitBtn) submitBtn.disabled = true
    try {
      const res = await updateProfile(body)
      const nextUser = { ...options.getUser(), ...res.profile }
      options.setUser(nextUser)
      syncSidebarChip(nextUser)
      fillForm(res.profile)
      dialog.close()
      options.onStatus?.('账户信息已保存')
    } catch (err) {
      setError(err.message || '保存失败')
    } finally {
      if (submitBtn) submitBtn.disabled = false
    }
  })

  syncSidebarChip(options.getUser())

  return { open, syncSidebarChip }
}
