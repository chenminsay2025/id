import { api } from '../api/client.js'
import { getSiteConfig, setSiteConfig, defaultSiteConfig, buildPublicCertUrl, normalizePublicBaseUrl, normalizePublicCertParam, normalizePublicCertUrlStyle } from '../siteConfig.js'
import {
  validateAdminLoginSlug,
  isDefaultAdminLoginSlug,
  DEFAULT_ADMIN_LOGIN_SLUG,
} from '../adminLoginPath.js'
import {
  validatePublicLoginSlug,
  isDefaultPublicLoginSlug,
  DEFAULT_PUBLIC_LOGIN_SLUG,
} from '../publicLoginPath.js'
import { loadAccessibleGroups, shouldShowGroupUi, defaultGroupIdForUser } from './groupUtils.js'
import { groupSelectFieldHtml, readGroupSelectValue } from './groupSelectorUi.js'

/**
 * @param {HTMLElement} container
 * @param {{ user?: { is_super_admin?: boolean, group_ids?: number[] }, onSaved?: (config: object) => void }} [options]
 */
export function mountSiteSettingsPanel(container, options = {}) {
  container.innerHTML = `
    <div class="wp-settings-panel-inner site-settings-panel">
      <header class="wp-settings-header">
        <div>
          <h2 class="wp-settings-title">站点设置</h2>
          <p class="wp-settings-desc">
            按访问组分别配置站点名称与证书分享链接；全站安全项（如后台登录地址）对整站生效。
          </p>
        </div>
        <button type="button" class="button button-primary" id="site-save">保存</button>
      </header>
      <div class="site-settings-main">
        <section class="site-settings-global">
          <h3 class="site-settings-section-title">全站安全</h3>
          <label class="site-settings-field site-settings-field--full">
            <span class="site-settings-label">后台登录地址</span>
            <div class="site-settings-admin-login-row">
              <span class="site-settings-admin-login-origin" id="site-admin-login-origin"></span>
              <span class="site-settings-admin-login-sep">/</span>
              <input type="text" id="site-admin-login-path" maxlength="48" placeholder="login" autocomplete="off" spellcheck="false" />
              <span class="site-settings-admin-login-suffix">.html</span>
            </div>
          </label>
          <label class="site-settings-field site-settings-field--full">
            <span class="site-settings-label">前端登录地址</span>
            <div class="site-settings-admin-login-row">
              <span class="site-settings-admin-login-origin" id="site-public-login-origin"></span>
              <span class="site-settings-admin-login-sep">/</span>
              <input type="text" id="site-public-login-path" maxlength="48" placeholder="public-login" autocomplete="off" spellcheck="false" />
              <span class="site-settings-admin-login-suffix">.html</span>
            </div>
          </label>
        </section>
        <div class="site-settings-toolbar" id="site-settings-group-slot"></div>
        <div class="site-settings-grid">
          <label class="site-settings-field">
            <span class="site-settings-label">产品名称</span>
            <input type="text" id="site-app-name" maxlength="40" placeholder="猫咪血统证书" />
            <span class="site-settings-hint">侧栏品牌标题</span>
          </label>
          <label class="site-settings-field">
            <span class="site-settings-label">完整名称</span>
            <input type="text" id="site-app-name-full" maxlength="60" placeholder="猫咪血统证书生成器" />
            <span class="site-settings-hint">浏览器标签页默认标题</span>
          </label>
          <label class="site-settings-field">
            <span class="site-settings-label">实体名称</span>
            <input type="text" id="site-entity-label" maxlength="12" placeholder="证书" />
            <span class="site-settings-hint">如：证书、奖状、证明；界面将显示「实体名称 + 列表」等</span>
          </label>
          <label class="site-settings-field">
            <span class="site-settings-label">品牌图标字</span>
            <input type="text" id="site-brand-mark" maxlength="2" placeholder="猫" />
            <span class="site-settings-hint">侧栏小图标，建议 1～2 个字符</span>
          </label>
          <label class="site-settings-field site-settings-field--full">
            <span class="site-settings-label">前端地址</span>
            <input type="url" id="site-public-base-url" maxlength="240" placeholder="https://cert.example.com" />
            <span class="site-settings-hint">留空则使用当前站点域名；用于生成已发布证书的分享链接</span>
          </label>
          <label class="site-settings-field">
            <span class="site-settings-label">链接风格</span>
            <select id="site-public-cert-url-style" class="wp-select">
              <option value="query">查询参数 (?cert=9)</option>
              <option value="path">路径仿静态 (/cert/9)</option>
            </select>
            <span class="site-settings-hint">查询参数或路径形式；下方示例随本组设置实时更新</span>
          </label>
          <label class="site-settings-field">
            <span class="site-settings-label">证书路径前缀</span>
            <input type="text" id="site-public-cert-param" maxlength="32" placeholder="cert" />
            <span class="site-settings-hint">查询模式下为参数名；路径模式下为 URL 段（如 cert → /cert/9）</span>
          </label>
        </div>
        <div class="site-settings-preview site-settings-preview--url">
          <span class="site-settings-preview-label">前端链接示例</span>
          <code class="site-settings-url-preview" id="site-public-url-preview">—</code>
        </div>
        <div class="site-settings-preview">
          <span class="site-settings-preview-label">预览</span>
          <div class="site-settings-preview-card">
            <span class="site-settings-preview-mark" id="site-preview-mark">猫</span>
            <div>
              <strong id="site-preview-app">猫咪血统证书</strong>
              <span class="site-settings-preview-sub" id="site-preview-list">证书列表</span>
            </div>
          </div>
        </div>
        <p id="site-status" class="site-settings-status" role="status"></p>
      </div>
    </div>
  `

  const appNameInput = container.querySelector('#site-app-name')
  const appNameFullInput = container.querySelector('#site-app-name-full')
  const entityLabelInput = container.querySelector('#site-entity-label')
  const brandMarkInput = container.querySelector('#site-brand-mark')
  const publicBaseUrlInput = container.querySelector('#site-public-base-url')
  const publicCertParamInput = container.querySelector('#site-public-cert-param')
  const publicCertUrlStyleSelect = container.querySelector('#site-public-cert-url-style')
  const publicUrlPreview = container.querySelector('#site-public-url-preview')
  const previewMark = container.querySelector('#site-preview-mark')
  const previewApp = container.querySelector('#site-preview-app')
  const previewList = container.querySelector('#site-preview-list')
  const statusEl = container.querySelector('#site-status')
  const saveBtn = container.querySelector('#site-save')
  const groupSlot = container.querySelector('#site-settings-group-slot')
  const adminLoginOriginEl = container.querySelector('#site-admin-login-origin')
  const adminLoginPathInput = container.querySelector('#site-admin-login-path')
  const publicLoginOriginEl = container.querySelector('#site-public-login-origin')
  const publicLoginPathInput = container.querySelector('#site-public-login-path')

  /** @type {{ id: number, name: string }[]} */
  let accessGroups = []
  /** @type {number | null} */
  let currentGroupId = null
  /** @type {string} */
  let savedAdminLoginSlug = DEFAULT_ADMIN_LOGIN_SLUG
  /** @type {string} */
  let savedPublicLoginSlug = DEFAULT_PUBLIC_LOGIN_SLUG

  function updateLoginOriginUrls() {
    const origin = typeof window !== 'undefined' ? `${window.location.origin}/` : ''
    if (adminLoginOriginEl) adminLoginOriginEl.textContent = origin
    if (publicLoginOriginEl) publicLoginOriginEl.textContent = origin
  }

  function fillAdminLoginPath(slug) {
    savedAdminLoginSlug = slug || DEFAULT_ADMIN_LOGIN_SLUG
    if (!adminLoginPathInput) return
    adminLoginPathInput.value = isDefaultAdminLoginSlug(savedAdminLoginSlug) ? '' : savedAdminLoginSlug
    updateLoginOriginUrls()
  }

  function fillPublicLoginPath(slug) {
    savedPublicLoginSlug = slug || DEFAULT_PUBLIC_LOGIN_SLUG
    if (!publicLoginPathInput) return
    publicLoginPathInput.value = isDefaultPublicLoginSlug(savedPublicLoginSlug) ? '' : savedPublicLoginSlug
    updateLoginOriginUrls()
  }

  function readAdminLoginPathForSave() {
    const raw = adminLoginPathInput?.value ?? ''
    if (!String(raw).trim()) return DEFAULT_ADMIN_LOGIN_SLUG
    const validated = validateAdminLoginSlug(raw)
    if (!validated.ok) throw new Error(validated.error)
    return validated.slug
  }

  function readPublicLoginPathForSave() {
    const raw = publicLoginPathInput?.value ?? ''
    if (!String(raw).trim()) return DEFAULT_PUBLIC_LOGIN_SLUG
    const validated = validatePublicLoginSlug(raw)
    if (!validated.ok) throw new Error(validated.error)
    return validated.slug
  }

  function readLoginPathsForSave() {
    const adminLoginPath = readAdminLoginPathForSave()
    const publicLoginPath = readPublicLoginPathForSave()
    if (adminLoginPath === publicLoginPath) {
      throw new Error('前后端登录路径不能相同')
    }
    return { adminLoginPath, publicLoginPath }
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg || ''
    statusEl.classList.toggle('site-settings-status--error', isError)
  }

  function readForm() {
    return {
      appName: appNameInput.value.trim(),
      appNameFull: appNameFullInput.value.trim(),
      entityLabel: entityLabelInput.value.trim(),
      brandMark: brandMarkInput.value.trim(),
      publicBaseUrl: normalizePublicBaseUrl(publicBaseUrlInput?.value),
      publicCertParam: normalizePublicCertParam(publicCertParamInput?.value),
      publicCertUrlStyle: normalizePublicCertUrlStyle(publicCertUrlStyleSelect?.value),
    }
  }

  function updateParamHint() {
    const paramHint = publicCertParamInput?.closest('.site-settings-field')?.querySelector('.site-settings-hint')
    if (!paramHint) return
    const style = normalizePublicCertUrlStyle(publicCertUrlStyleSelect?.value)
    const param = normalizePublicCertParam(publicCertParamInput?.value)
    paramHint.textContent = style === 'path'
      ? `路径段名称，如 ${param} → /${param}/9`
      : `查询参数名，如 ${param} → ?${param}=9`
  }

  function updatePreview() {
    const form = readForm()
    const base = defaultSiteConfig()
    const appName = form.appName || base.appName
    const entity = form.entityLabel || base.entityLabel
    const mark = form.brandMark || base.brandMark
    previewMark.textContent = mark
    previewApp.textContent = appName
    previewList.textContent = `${entity}列表`
    updateParamHint()
    if (publicUrlPreview) {
      publicUrlPreview.textContent = buildPublicCertUrl(1, form) || '—'
    }
  }

  function fillForm(config) {
    const c = { ...defaultSiteConfig(), ...config }
    appNameInput.value = c.appName
    appNameFullInput.value = c.appNameFull
    entityLabelInput.value = c.entityLabel
    brandMarkInput.value = c.brandMark
    if (publicBaseUrlInput) {
      publicBaseUrlInput.value = c.publicBaseUrl ?? c.public_base_url ?? ''
    }
    if (publicCertParamInput) {
      publicCertParamInput.value = c.publicCertParam ?? c.public_cert_param ?? 'cert'
    }
    if (publicCertUrlStyleSelect) {
      publicCertUrlStyleSelect.value = normalizePublicCertUrlStyle(
        c.publicCertUrlStyle ?? c.public_cert_url_style,
      )
    }
    updatePreview()
  }

  function renderGroupField() {
    if (!groupSlot) return
    if (!shouldShowGroupUi(options.user, accessGroups)) {
      groupSlot.innerHTML = ''
      return
    }
    groupSlot.innerHTML = groupSelectFieldHtml({
      selectId: 'site-settings-group',
      groups: accessGroups,
      user: options.user,
      selectedId: currentGroupId,
      compact: false,
    })
  }

  function bindGroupFieldOnce() {
    if (bindGroupFieldOnce.bound || !groupSlot) return
    bindGroupFieldOnce.bound = true
    groupSlot.addEventListener('change', (e) => {
      if (e.target instanceof HTMLSelectElement && e.target.id === 'site-settings-group') {
        void loadConfigForSelectedGroup()
      }
    })
  }

  function resolveSelectedGroupId() {
    const fromSelect = readGroupSelectValue(container, 'site-settings-group', accessGroups, options.user)
    if (fromSelect) return fromSelect
    return currentGroupId ?? defaultGroupIdForUser(options.user, accessGroups)
  }

  async function loadConfigForSelectedGroup() {
    const groupId = resolveSelectedGroupId()
    if (!groupId) {
      fillForm(defaultSiteConfig())
      return
    }
    currentGroupId = groupId
    const data = await api.getSiteSettings(groupId)
    currentGroupId = data.group_id != null ? Number(data.group_id) : groupId
    fillAdminLoginPath(data.adminLoginPath ?? data.admin_login_path ?? savedAdminLoginSlug)
    fillPublicLoginPath(data.publicLoginPath ?? data.public_login_path ?? savedPublicLoginSlug)
    fillForm(data)
    renderGroupField()
    setStatus('')
  }

  async function loadConfig() {
    accessGroups = await loadAccessibleGroups(true)
    currentGroupId = defaultGroupIdForUser(options.user, accessGroups)
    renderGroupField()
    await loadConfigForSelectedGroup()
  }

  async function saveConfig() {
    const groupId = resolveSelectedGroupId()
    if (!groupId) throw new Error('请选择所属组')
    const { adminLoginPath, publicLoginPath } = readLoginPathsForSave()
    const body = {
      ...readForm(),
      group_id: groupId,
      adminLoginPath,
      publicLoginPath,
    }
    if (!body.appName) throw new Error('请填写产品名称')
    if (!body.entityLabel) throw new Error('请填写实体名称')
    const saved = await api.updateSiteSettings(body)
    currentGroupId = saved.group_id != null ? Number(saved.group_id) : groupId
    fillAdminLoginPath(saved.adminLoginPath ?? adminLoginPath)
    fillPublicLoginPath(saved.publicLoginPath ?? publicLoginPath)
    setSiteConfig(saved)
    fillForm(saved)
    options.onSaved?.(saved)
    const loginNotes = []
    if (!isDefaultAdminLoginSlug(saved.adminLoginPath ?? adminLoginPath)) {
      loginNotes.push('后台登录地址已更新')
    }
    if (!isDefaultPublicLoginSlug(saved.publicLoginPath ?? publicLoginPath)) {
      loginNotes.push('前端登录地址已更新')
    }
    const loginNote = loginNotes.length ? ` · ${loginNotes.join('、')}，请收藏新链接` : ''
    setStatus(`已保存（访问组 #${saved.group_id ?? groupId}）${loginNote}`)
  }

  for (const input of [appNameInput, appNameFullInput, entityLabelInput, brandMarkInput, publicBaseUrlInput, publicCertParamInput]) {
    input?.addEventListener('input', updatePreview)
  }
  publicCertUrlStyleSelect?.addEventListener('change', updatePreview)

  saveBtn.addEventListener('click', () => {
    saveConfig().catch((err) => setStatus(err.message || '保存失败', true))
  })

  return {
    async init() {
      try {
        bindGroupFieldOnce()
        fillAdminLoginPath(DEFAULT_ADMIN_LOGIN_SLUG)
        fillPublicLoginPath(DEFAULT_PUBLIC_LOGIN_SLUG)
        await loadConfig()
      } catch (err) {
        setStatus(err.message || '加载失败', true)
      }
    },
  }
}
