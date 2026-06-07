import { api } from '../api/client.js'
import { invalidateGroupCache } from './groupUtils.js'
import { ADMIN_MODULES, moduleBadgesHtml } from './adminModules.js'

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function readCheckedGroupIds(wrap, prefix) {
  if (!wrap) return []
  return [...wrap.querySelectorAll(`input[name="${prefix}-group"]:checked`)]
    .map((el) => Number(el.value))
    .filter((id) => id > 0)
}

function readCheckedModuleKeys(wrap) {
  if (!wrap) return []
  return [...wrap.querySelectorAll('input[name="user-module"]:checked')]
    .map((el) => String(el.value))
    .filter(Boolean)
}

function groupBadgesHtml(groupIds, groups) {
  const ids = groupIds || []
  if (!ids.length) return '<span class="access-muted">—</span>'
  return ids.map((gid) => {
    const name = groups.find((g) => g.id === gid)?.name || `#${gid}`
    return `<span class="resource-group-badge">${escapeHtml(name)}</span>`
  }).join('')
}

function roleBadgeHtml(isSuperAdmin) {
  if (isSuperAdmin) {
    return '<span class="access-badge access-badge--super">超级管理员</span>'
  }
  return '<span class="access-badge access-badge--admin">管理员</span>'
}

function emptyRowHtml(colspan, message, actionHtml = '') {
  return `
    <tr class="access-table-empty">
      <td colspan="${colspan}">
        <div class="access-empty-state">
          <p class="access-empty-state-text">${escapeHtml(message)}</p>
          ${actionHtml}
        </div>
      </td>
    </tr>
  `
}

function isProtectedGroup(group) {
  return group?.slug === 'ungrouped'
}

/**
 * @param {HTMLElement} container
 * @param {{ editor?: { is_super_admin?: boolean }, onGroupsChanged?: () => void | Promise<void> }} [options]
 */
export function mountAccessManagePanel(container, options = {}) {
  const editorIsSuper = !!options.editor?.is_super_admin
  container.innerHTML = `
    <div class="wp-settings-panel-inner access-manage-panel">
      <header class="wp-settings-header access-manage-header">
        <div>
          <h2 class="wp-settings-title">权限管理</h2>
          <p class="wp-settings-desc">
            通过访问组隔离证书与模板资源；后台管理员按组授权；访客账号仅可只读浏览已发布内容。
          </p>
        </div>
      </header>

      <div class="access-manage-layout">
        <nav class="access-nav" role="tablist" aria-label="权限管理分类">
          <button type="button" class="access-nav-item is-active" role="tab" aria-selected="true" data-tab="groups">
            <span class="access-nav-label">访问组</span>
            <span class="access-nav-count" id="access-nav-count-groups">0</span>
          </button>
          <button type="button" class="access-nav-item" role="tab" aria-selected="false" data-tab="users">
            <span class="access-nav-label">管理用户</span>
            <span class="access-nav-count" id="access-nav-count-users">0</span>
          </button>
          <button type="button" class="access-nav-item" role="tab" aria-selected="false" data-tab="visitors">
            <span class="access-nav-label">访客账号</span>
            <span class="access-nav-count" id="access-nav-count-visitors">0</span>
          </button>
        </nav>

        <div class="access-main">
          <section class="access-panel is-active" data-panel="groups" role="tabpanel">
            <div class="access-section-head">
              <div class="access-section-head-text">
                <h3 class="access-section-title">访问组</h3>
                <p class="access-section-desc">资源隔离的基本单位。SVG 模板、布局模板、证书等均归属某一访问组。</p>
              </div>
              <button type="button" class="button button-primary button-sm" id="access-group-new">新建组</button>
            </div>
            <div id="access-group-form-wrap" class="access-form-card" hidden>
              <div class="access-form-card-head">
                <h4 class="access-form-title" id="access-group-form-title">新建访问组</h4>
                <button type="button" class="access-form-close" data-cancel-form="group" aria-label="关闭">×</button>
              </div>
              <form id="access-group-form" class="access-form">
                <input type="hidden" name="group_id" value="" />
                <div class="access-form-grid">
                  <label class="access-form-field">
                    <span class="access-form-label">组名称</span>
                    <input type="text" name="name" required maxlength="40" placeholder="例如：A 组" autocomplete="off" />
                  </label>
                  <label class="access-form-field">
                    <span class="access-form-label">标识 slug</span>
                    <input type="text" name="slug" maxlength="40" placeholder="留空则自动生成" autocomplete="off" />
                    <span class="access-form-hint-inline">用于导入导出时的唯一标识，创建后一般无需修改</span>
                  </label>
                </div>
                <div class="access-form-actions">
                  <button type="submit" class="button button-primary button-sm" id="access-group-submit">创建</button>
                  <button type="button" class="button button-sm" data-cancel-form="group">取消</button>
                </div>
              </form>
            </div>
            <div class="access-table-wrap">
              <table class="access-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>标识</th>
                    <th class="access-th-actions">操作</th>
                  </tr>
                </thead>
                <tbody id="access-groups-list"></tbody>
              </table>
            </div>
            <div id="access-group-action-wrap" class="access-form-card" hidden>
              <div class="access-form-card-head">
                <h4 class="access-form-title" id="access-group-action-title">迁移并删除访问组</h4>
                <button type="button" class="access-form-close" data-cancel-action="group" aria-label="关闭">×</button>
              </div>
              <p class="access-form-hint" id="access-group-action-desc"></p>
              <form id="access-group-action-form" class="access-form">
                <input type="hidden" name="action_type" value="" />
                <input type="hidden" name="group_id" value="" />
                <label class="access-form-field">
                  <span class="access-form-label" id="access-group-action-target-label">资源迁移到</span>
                  <select name="target_group_id" id="access-group-action-target" class="wp-select" required></select>
                </label>
                <div class="access-form-actions">
                  <button type="submit" class="button button-primary button-sm" id="access-group-action-submit">确认</button>
                  <button type="button" class="button button-sm" data-cancel-action="group">取消</button>
                </div>
              </form>
            </div>
            <div class="access-section-head access-section-head--sub">
              <div class="access-section-head-text">
                <h3 class="access-section-title">合并历史</h3>
                <p class="access-section-desc">访问组合并或删除时的资源迁移记录，可撤销以恢复原组并迁回资源。</p>
              </div>
            </div>
            <div class="access-table-wrap">
              <table class="access-table">
                <thead>
                  <tr>
                    <th>来源组</th>
                    <th>目标组</th>
                    <th>时间</th>
                    <th class="access-th-actions">操作</th>
                  </tr>
                </thead>
                <tbody id="access-merge-history-list"></tbody>
              </table>
            </div>
          </section>

          <section class="access-panel" data-panel="users" role="tabpanel" hidden>
            <div class="access-section-head">
              <div class="access-section-head-text">
                <h3 class="access-section-title">管理用户</h3>
                <p class="access-section-desc">后台登录账号。普通管理员仅能操作其所属组内的资源；超级管理员不受组限制。</p>
              </div>
              <button type="button" class="button button-primary button-sm" id="access-user-new">新建用户</button>
            </div>
            <div id="access-user-form-wrap" class="access-form-card" hidden>
              <div class="access-form-card-head">
                <h4 class="access-form-title" id="access-user-form-title">新建管理用户</h4>
                <button type="button" class="access-form-close" data-cancel-form="user" aria-label="关闭">×</button>
              </div>
              <form id="access-user-form" class="access-form">
                <input type="hidden" name="user_id" value="" />
                <div class="access-form-grid">
                  <label class="access-form-field">
                    <span class="access-form-label">用户名</span>
                    <input type="text" name="username" required maxlength="40" autocomplete="off" />
                  </label>
                  <label class="access-form-field">
                    <span class="access-form-label" id="access-user-password-label">初始密码</span>
                    <input type="password" name="password" minlength="4" autocomplete="new-password" />
                    <span class="access-form-hint-inline" id="access-user-password-hint" hidden>留空则不修改密码</span>
                  </label>
                  <label class="access-form-field">
                    <span class="access-form-label">角色</span>
                    <select name="role" id="access-user-role" class="wp-select">
                      <option value="admin">管理员（仅所属组）</option>
                      <option value="super_admin">超级管理员（全部组）</option>
                    </select>
                  </label>
                </div>
                <fieldset id="access-user-groups-field" class="access-form-groups">
                  <legend class="access-form-label">所属访问组</legend>
                  <p class="access-form-hint">至少选择一个组；超级管理员无需分配组。</p>
                  <div id="access-user-groups-checks" class="access-check-list"></div>
                </fieldset>
                <fieldset id="access-user-modules-field" class="access-form-groups">
                  <legend class="access-form-label">模块访问权限</legend>
                  <p class="access-form-hint">控制后台侧栏可进入的模板与设置页面。超级管理员默认拥有全部模块。</p>
                  <div id="access-user-modules-checks" class="access-check-list access-check-list--modules"></div>
                </fieldset>
                <div class="access-form-actions">
                  <button type="submit" class="button button-primary button-sm" id="access-user-submit">创建</button>
                  <button type="button" class="button button-sm" data-cancel-form="user">取消</button>
                </div>
              </form>
            </div>
            <div class="access-table-wrap">
              <table class="access-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>角色</th>
                    <th>所属组</th>
                    <th>模块权限</th>
                    <th class="access-th-actions">操作</th>
                  </tr>
                </thead>
                <tbody id="access-users-list"></tbody>
              </table>
            </div>
          </section>

          <section class="access-panel" data-panel="visitors" role="tabpanel" hidden>
            <div class="access-section-head">
              <div class="access-section-head-text">
                <h3 class="access-section-title">访客账号</h3>
                <p class="access-section-desc">前端只读页登录用。访客只能浏览所选访问组内、已发布的证书内容。</p>
              </div>
              <button type="button" class="button button-primary button-sm" id="access-visitor-new">新建访客</button>
            </div>
            <div id="access-visitor-form-wrap" class="access-form-card" hidden>
              <div class="access-form-card-head">
                <h4 class="access-form-title" id="access-visitor-form-title">新建访客账号</h4>
                <button type="button" class="access-form-close" data-cancel-form="visitor" aria-label="关闭">×</button>
              </div>
              <p class="access-form-hint" id="access-visitor-form-desc">访客用于前端只读页登录，仅能查看下方所选组内已发布内容。</p>
              <form id="access-visitor-form" class="access-form">
                <input type="hidden" name="visitor_id" value="" />
                <div class="access-form-grid">
                  <label class="access-form-field">
                    <span class="access-form-label">用户名</span>
                    <input type="text" name="username" required maxlength="40" autocomplete="off" />
                  </label>
                  <label class="access-form-field">
                    <span class="access-form-label" id="access-visitor-password-label">密码</span>
                    <input type="password" name="password" minlength="4" autocomplete="new-password" id="access-visitor-password-input" />
                    <span class="access-form-hint-inline" id="access-visitor-password-hint" hidden>留空则不修改密码</span>
                  </label>
                </div>
                <fieldset class="access-form-groups">
                  <legend class="access-form-label">可查看的访问组</legend>
                  <p class="access-form-hint">至少选择一个组，否则访客无法看到任何内容。</p>
                  <div id="access-visitor-groups-checks" class="access-check-list"></div>
                </fieldset>
                <div class="access-form-actions">
                  <button type="submit" class="button button-primary button-sm" id="access-visitor-submit">创建</button>
                  <button type="button" class="button button-sm" data-cancel-form="visitor">取消</button>
                </div>
              </form>
            </div>
            <div class="access-table-wrap">
              <table class="access-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>可查看组</th>
                    <th class="access-th-actions">操作</th>
                  </tr>
                </thead>
                <tbody id="access-visitors-list"></tbody>
              </table>
            </div>
          </section>

          <p id="access-status" class="access-status" role="status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  `

  const statusEl = container.querySelector('#access-status')
  const groupsListEl = container.querySelector('#access-groups-list')
  const mergeHistoryListEl = container.querySelector('#access-merge-history-list')
  const groupActionWrap = container.querySelector('#access-group-action-wrap')
  const groupActionForm = container.querySelector('#access-group-action-form')
  const groupActionTitle = container.querySelector('#access-group-action-title')
  const groupActionDesc = container.querySelector('#access-group-action-desc')
  const groupActionSubmit = container.querySelector('#access-group-action-submit')
  const groupActionTarget = container.querySelector('#access-group-action-target')
  const groupActionTargetLabel = container.querySelector('#access-group-action-target-label')
  const usersListEl = container.querySelector('#access-users-list')
  const visitorsListEl = container.querySelector('#access-visitors-list')
  const navCountGroups = container.querySelector('#access-nav-count-groups')
  const navCountUsers = container.querySelector('#access-nav-count-users')
  const navCountVisitors = container.querySelector('#access-nav-count-visitors')

  const groupFormWrap = container.querySelector('#access-group-form-wrap')
  const groupForm = container.querySelector('#access-group-form')
  const groupFormTitle = container.querySelector('#access-group-form-title')
  const groupSubmitBtn = container.querySelector('#access-group-submit')
  const userFormWrap = container.querySelector('#access-user-form-wrap')
  const userForm = container.querySelector('#access-user-form')
  const userRoleSelect = container.querySelector('#access-user-role')
  const userGroupsField = container.querySelector('#access-user-groups-field')
  const userGroupsChecks = container.querySelector('#access-user-groups-checks')
  const userModulesField = container.querySelector('#access-user-modules-field')
  const userModulesChecks = container.querySelector('#access-user-modules-checks')
  const visitorFormWrap = container.querySelector('#access-visitor-form-wrap')
  const visitorForm = container.querySelector('#access-visitor-form')
  const visitorGroupsChecks = container.querySelector('#access-visitor-groups-checks')
  const userFormTitle = container.querySelector('#access-user-form-title')
  const userSubmitBtn = container.querySelector('#access-user-submit')
  const userPasswordInput = userForm?.querySelector('[name="password"]')
  const userPasswordLabel = container.querySelector('#access-user-password-label')
  const userPasswordHint = container.querySelector('#access-user-password-hint')

  if (!editorIsSuper) {
    userModulesField?.setAttribute('hidden', '')
    userRoleSelect?.querySelector('option[value="super_admin"]')?.remove()
  }
  const visitorFormTitle = container.querySelector('#access-visitor-form-title')
  const visitorFormDesc = container.querySelector('#access-visitor-form-desc')
  const visitorSubmitBtn = container.querySelector('#access-visitor-submit')
  const visitorPasswordInput = container.querySelector('#access-visitor-password-input')
  const visitorPasswordLabel = container.querySelector('#access-visitor-password-label')
  const visitorPasswordHint = container.querySelector('#access-visitor-password-hint')

  /** @type {{ id: number, name: string, slug: string }[]} */
  let groups = []
  /** @type {number} */
  let userCount = 0
  /** @type {number} */
  let visitorCount = 0

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg || ''
    statusEl.classList.toggle('access-status--error', !!isError)
    statusEl.hidden = !msg
  }

  function updateNavCounts() {
    if (navCountGroups) navCountGroups.textContent = String(groups.length)
    if (navCountUsers) navCountUsers.textContent = String(userCount)
    if (navCountVisitors) navCountVisitors.textContent = String(visitorCount)
  }

  function activateTab(tab) {
    container.querySelectorAll('.access-nav-item').forEach((btn) => {
      const active = btn.dataset.tab === tab
      btn.classList.toggle('is-active', active)
      btn.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    container.querySelectorAll('.access-panel').forEach((panel) => {
      const active = panel.dataset.panel === tab
      panel.classList.toggle('is-active', active)
      panel.hidden = !active
    })
  }

  function switchTab(tab) {
    hideAllForms()
    activateTab(tab)
    setStatus('')
  }

  function hideAllForms() {
    groupFormWrap.hidden = true
    userFormWrap.hidden = true
    visitorFormWrap.hidden = true
    hideGroupActionForm()
  }

  function renderGroupCheckboxes(targetEl, prefix, selectedIds = []) {
    if (!targetEl) return
    const set = new Set(selectedIds)
    if (!groups.length) {
      targetEl.innerHTML = '<p class="access-form-empty">请先创建访问组</p>'
      return
    }
    targetEl.innerHTML = groups.map((g) => `
      <label class="access-check">
        <input type="checkbox" name="${prefix}-group" value="${g.id}" ${set.has(g.id) ? 'checked' : ''} />
        <span>${escapeHtml(g.name)}</span>
      </label>
    `).join('')
  }

  function renderModuleCheckboxes(targetEl, selectedKeys = []) {
    if (!targetEl) return
    const set = new Set(selectedKeys)
    targetEl.innerHTML = ADMIN_MODULES.map((m) => `
      <label class="access-check">
        <input type="checkbox" name="user-module" value="${m.key}" ${set.has(m.key) ? 'checked' : ''} />
        <span>${escapeHtml(m.label)}</span>
      </label>
    `).join('')
  }

  function syncUserRoleGroupsVisibility() {
    const isSuper = userRoleSelect.value === 'super_admin'
    userGroupsField.hidden = isSuper
    userModulesField.hidden = isSuper || !editorIsSuper
  }

  function openGroupForm(group = null) {
    hideAllForms()
    groupForm.reset()
    groupForm.querySelector('[name="group_id"]').value = group ? String(group.id) : ''
    groupFormTitle.textContent = group ? '编辑访问组' : '新建访问组'
    groupSubmitBtn.textContent = group ? '保存' : '创建'
    if (group) {
      groupForm.querySelector('[name="name"]').value = group.name
      groupForm.querySelector('[name="slug"]').value = group.slug || ''
      const slugInput = groupForm.querySelector('[name="slug"]')
      if (slugInput) slugInput.disabled = isProtectedGroup(group)
    } else {
      const slugInput = groupForm.querySelector('[name="slug"]')
      if (slugInput) slugInput.disabled = false
    }
    activateTab('groups')
    groupFormWrap.hidden = false
    groupForm.querySelector('[name="name"]')?.focus()
  }

  function openUserForm(user = null) {
    hideAllForms()
    userForm.reset()
    userForm.querySelector('[name="user_id"]').value = user ? String(user.id) : ''
    userFormTitle.textContent = user ? '编辑管理用户' : '新建管理用户'
    userSubmitBtn.textContent = user ? '保存' : '创建'
    userPasswordLabel.textContent = user ? '新密码' : '初始密码'
    userPasswordHint.hidden = !user
    userPasswordInput.required = !user
    if (user) {
      userForm.querySelector('[name="username"]').value = user.username
      userRoleSelect.value = user.is_super_admin ? 'super_admin' : 'admin'
      renderGroupCheckboxes(userGroupsChecks, 'user', user.group_ids || [])
      renderModuleCheckboxes(userModulesChecks, user.module_keys || [])
    } else {
      userRoleSelect.value = 'admin'
      renderGroupCheckboxes(userGroupsChecks, 'user')
      renderModuleCheckboxes(userModulesChecks, ['templates', 'table-templates', 'layout-presets', 'site', 'fonts'])
    }
    syncUserRoleGroupsVisibility()
    activateTab('users')
    userFormWrap.hidden = false
    userForm.querySelector('[name="username"]')?.focus()
  }

  function openVisitorForm(visitor = null) {
    hideAllForms()
    visitorForm.reset()
    visitorForm.querySelector('[name="visitor_id"]').value = visitor ? String(visitor.id) : ''
    visitorFormTitle.textContent = visitor ? '编辑访客账号' : '新建访客账号'
    visitorFormDesc.hidden = !!visitor
    visitorSubmitBtn.textContent = visitor ? '保存' : '创建'
    if (visitorPasswordLabel) {
      visitorPasswordLabel.textContent = visitor ? '新密码' : '密码'
    }
    visitorPasswordHint.hidden = !visitor
    visitorPasswordInput.required = !visitor
    if (visitor) {
      visitorForm.querySelector('[name="username"]').value = visitor.username
      renderGroupCheckboxes(visitorGroupsChecks, 'visitor', visitor.group_ids || [])
    } else {
      renderGroupCheckboxes(visitorGroupsChecks, 'visitor')
    }
    activateTab('visitors')
    visitorFormWrap.hidden = false
    visitorForm.querySelector('[name="username"]')?.focus()
  }

  function hideGroupActionForm() {
    if (groupActionWrap) groupActionWrap.hidden = true
  }

  function openGroupActionForm({ type, group }) {
    hideAllForms()
    hideGroupActionForm()
    if (!groupActionWrap || !groupActionForm || !group) return
    groupActionForm.querySelector('[name="action_type"]').value = type
    groupActionForm.querySelector('[name="group_id"]').value = String(group.id)
    const ungrouped = groups.find((g) => g.slug === 'ungrouped')
    const targets = groups.filter((g) => g.id !== group.id)
    if (type === 'delete') {
      groupActionTitle.textContent = `删除访问组「${group.name}」`
      groupActionDesc.textContent = '该组内的证书、模板等资源将迁移到所选目标组，不会直接删除。'
      groupActionSubmit.textContent = '删除并迁移'
      groupActionSubmit.className = 'button button-sm button-danger'
      groupActionTargetLabel.textContent = '资源迁移到'
      groupActionTarget.innerHTML = [
        ungrouped ? `<option value="${ungrouped.id}">未分组（系统默认）</option>` : '',
        ...targets.filter((g) => g.slug !== 'ungrouped').map((g) =>
          `<option value="${g.id}">${escapeHtml(g.name)}</option>`,
        ),
      ].join('')
      if (ungrouped) groupActionTarget.value = String(ungrouped.id)
    } else {
      groupActionTitle.textContent = `合并访问组「${group.name}」`
      groupActionDesc.textContent = '将本组全部资源与用户/访客关联合并到目标组，然后删除本组。'
      groupActionSubmit.textContent = '确认合并'
      groupActionSubmit.className = 'button button-primary button-sm'
      groupActionTargetLabel.textContent = '合并到'
      groupActionTarget.innerHTML = targets
        .filter((g) => g.slug !== 'ungrouped')
        .map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`)
        .join('')
    }
    if (!groupActionTarget.options.length) {
      setStatus('没有可用的目标访问组', true)
      return
    }
    activateTab('groups')
    groupActionWrap.hidden = false
  }

  async function notifyGroupsChanged() {
    try {
      await options.onGroupsChanged?.()
    } catch {
      // ignore callback errors
    }
  }

  async function refreshMergeHistory() {
    if (!mergeHistoryListEl) return
    let logs = []
    try {
      const data = await api.listGroupMergeHistory()
      logs = data.logs || []
    } catch {
      logs = []
    }
    mergeHistoryListEl.innerHTML = logs.length
      ? logs.map((log) => {
        const time = log.created_at ? new Date(log.created_at).toLocaleString() : '—'
        const revertBtn = log.reverted
          ? '<span class="access-muted">已撤销</span>'
          : `<button type="button" class="button button-sm" data-action="revert-merge" data-id="${log.id}">撤销</button>`
        return `
          <tr data-id="${log.id}">
            <td>${escapeHtml(log.from_group_name)}</td>
            <td>${escapeHtml(log.to_group_name)}</td>
            <td><span class="access-muted">${escapeHtml(time)}</span></td>
            <td class="access-td-actions">${revertBtn}</td>
          </tr>
        `
      }).join('')
      : emptyRowHtml(4, '暂无合并记录')
  }

  async function refreshGroups() {
    const data = await api.listGroups()
    groups = data.groups || []
    invalidateGroupCache()
    groupsListEl.innerHTML = groups.length
      ? groups.map((g) => {
        const protectedBadge = isProtectedGroup(g)
          ? ' <span class="access-badge access-badge--system">系统组</span>'
          : ''
        const actions = isProtectedGroup(g)
          ? `<button type="button" class="button button-sm" data-action="edit-group" data-id="${g.id}">编辑</button>`
            + '<span class="access-muted">不可删除/合并</span>'
          : `<button type="button" class="button button-sm" data-action="edit-group" data-id="${g.id}">编辑</button>`
            + `<button type="button" class="button button-sm" data-action="merge-group" data-id="${g.id}">合并</button>`
            + `<button type="button" class="button button-sm button-danger" data-action="delete-group" data-id="${g.id}">删除</button>`
        return `
        <tr data-id="${g.id}">
          <td><strong class="access-cell-name">${escapeHtml(g.name)}</strong>${protectedBadge}</td>
          <td><code class="access-code">${escapeHtml(g.slug)}</code></td>
          <td class="access-td-actions">${actions}</td>
        </tr>
      `
      }).join('')
      : emptyRowHtml(3, '暂无访问组', '<button type="button" class="button button-sm button-primary" data-action="open-group-form">创建第一个访问组</button>')
    updateNavCounts()
    await refreshMergeHistory()
  }

  async function refreshUsers() {
    const { users } = await api.listUsers()
    const list = users || []
    userCount = list.length
    usersListEl.innerHTML = list.length
      ? list.map((u) => `
        <tr data-id="${u.id}">
          <td><strong class="access-cell-name">${escapeHtml(u.username)}</strong></td>
          <td>${roleBadgeHtml(u.is_super_admin)}</td>
          <td><div class="access-badge-row">${u.is_super_admin ? '<span class="access-muted">全部组</span>' : groupBadgesHtml(u.group_ids, groups)}</div></td>
          <td><div class="access-badge-row">${u.is_super_admin ? '<span class="access-muted">全部模块</span>' : moduleBadgesHtml(u.module_keys)}</div></td>
          <td class="access-td-actions">
            <button type="button" class="button button-sm" data-action="edit-user" data-id="${u.id}">编辑</button>
            <button type="button" class="button button-sm button-danger" data-action="delete-user" data-id="${u.id}">删除</button>
          </td>
        </tr>
      `).join('')
      : emptyRowHtml(5, '暂无管理用户', '<button type="button" class="button button-sm button-primary" data-action="open-user-form">新建用户</button>')
    updateNavCounts()
  }

  async function refreshVisitors() {
    const { visitors } = await api.listVisitorUsers()
    const list = visitors || []
    visitorCount = list.length
    visitorsListEl.innerHTML = list.length
      ? list.map((v) => `
        <tr data-id="${v.id}">
          <td><strong class="access-cell-name">${escapeHtml(v.username)}</strong></td>
          <td><div class="access-badge-row">${groupBadgesHtml(v.group_ids, groups) || '<span class="access-muted">未分配</span>'}</div></td>
          <td class="access-td-actions">
            <button type="button" class="button button-sm" data-action="edit-visitor" data-id="${v.id}">编辑</button>
            <button type="button" class="button button-sm button-danger" data-action="delete-visitor" data-id="${v.id}">删除</button>
          </td>
        </tr>
      `).join('')
      : emptyRowHtml(3, '暂无访客账号', '<button type="button" class="button button-sm button-primary" data-action="open-visitor-form">新建访客</button>')
    updateNavCounts()
  }

  async function refreshAll() {
    await refreshGroups()
    await refreshUsers()
    await refreshVisitors()
  }

  container.querySelectorAll('.access-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab || 'groups'))
  })

  container.querySelector('#access-group-new')?.addEventListener('click', () => {
    if (groupFormWrap.hidden) openGroupForm(null)
    else hideAllForms()
  })

  container.querySelector('#access-user-new')?.addEventListener('click', () => {
    if (userFormWrap.hidden) openUserForm(null)
    else hideAllForms()
  })

  container.querySelector('#access-visitor-new')?.addEventListener('click', () => {
    if (visitorFormWrap.hidden) openVisitorForm(null)
    else hideAllForms()
  })

  container.querySelectorAll('[data-cancel-form]').forEach((btn) => {
    btn.addEventListener('click', () => hideAllForms())
  })

  container.querySelectorAll('[data-cancel-action]').forEach((btn) => {
    btn.addEventListener('click', () => hideGroupActionForm())
  })

  groupActionForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(groupActionForm)
    const actionType = String(fd.get('action_type') || '')
    const groupId = Number(fd.get('group_id')) || 0
    const targetId = Number(fd.get('target_group_id')) || 0
    const g = groups.find((x) => x.id === groupId)
    if (!g || !targetId) return
    try {
      if (actionType === 'delete') {
        const res = await api.deleteGroup(groupId, targetId)
        hideGroupActionForm()
        await refreshAll()
        await notifyGroupsChanged()
        const target = res.moved_to_group_name || groups.find((x) => x.id === targetId)?.name || '目标组'
        const movedTotal = res.moved
          ? Object.values(res.moved).reduce((n, v) => n + (Number(v) || 0), 0)
          : 0
        setStatus(movedTotal > 0
          ? `访问组已删除，${movedTotal} 项资源已迁移到「${target}」`
          : '访问组已删除')
      } else if (actionType === 'merge') {
        const res = await api.mergeGroups(groupId, targetId)
        hideGroupActionForm()
        await refreshAll()
        await notifyGroupsChanged()
        const target = res.moved_to_group_name || groups.find((x) => x.id === targetId)?.name || '目标组'
        setStatus(`已合并到「${target}」`)
      }
    } catch (err) {
      setStatus(err.message || '操作失败', true)
    }
  })

  userRoleSelect?.addEventListener('change', syncUserRoleGroupsVisibility)

  groupForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(groupForm)
    const groupId = Number(fd.get('group_id')) || 0
    const name = String(fd.get('name') || '').trim()
    const slug = String(fd.get('slug') || '').trim()
    if (!name) {
      setStatus('请填写组名称', true)
      return
    }
    try {
      if (groupId) {
        await api.updateGroup(groupId, { name, slug: slug || undefined })
        setStatus('访问组已更新')
      } else {
        await api.createGroup({ name, slug: slug || undefined })
        setStatus('访问组已创建')
      }
      hideAllForms()
      groupForm.reset()
      await refreshAll()
      await notifyGroupsChanged()
    } catch (err) {
      setStatus(err.message || (groupId ? '更新失败' : '创建失败'), true)
    }
  })

  userForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(userForm)
    const userId = Number(fd.get('user_id')) || 0
    const username = String(fd.get('username') || '').trim()
    const password = String(fd.get('password') || '')
    const role = fd.get('role') === 'super_admin' ? 'super_admin' : 'admin'
    const groupIds = role === 'super_admin' ? [] : readCheckedGroupIds(userGroupsChecks, 'user')
    const moduleKeys = role === 'super_admin' ? [] : readCheckedModuleKeys(userModulesChecks)
    if (!username) {
      setStatus('请填写用户名', true)
      return
    }
    if (!userId && !password) {
      setStatus('请填写密码', true)
      return
    }
    if (role !== 'super_admin' && !groupIds.length) {
      setStatus('普通管理员请至少选择一个访问组', true)
      return
    }
    try {
      const body = { username, role, group_ids: groupIds, module_keys: moduleKeys }
      if (password) body.password = password
      if (userId) {
        await api.updateUser(userId, body)
        setStatus('用户已更新')
      } else {
        await api.createUser({ ...body, password })
        setStatus('用户已创建')
      }
      hideAllForms()
      userForm.reset()
      await refreshUsers()
    } catch (err) {
      setStatus(err.message || (userId ? '更新失败' : '创建失败'), true)
    }
  })

  visitorForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(visitorForm)
    const visitorId = Number(fd.get('visitor_id')) || 0
    const username = String(fd.get('username') || '').trim()
    const password = String(fd.get('password') || '')
    const groupIds = readCheckedGroupIds(visitorGroupsChecks, 'visitor')
    if (!username) {
      setStatus('请填写用户名', true)
      return
    }
    if (!visitorId && !password) {
      setStatus('请填写密码', true)
      return
    }
    if (!groupIds.length) {
      setStatus('请至少选择一个可查看的访问组', true)
      return
    }
    try {
      const body = { username, group_ids: groupIds }
      if (password) body.password = password
      if (visitorId) {
        await api.updateVisitorUser(visitorId, body)
        setStatus('访客已更新')
      } else {
        await api.createVisitorUser({ ...body, password })
        setStatus('访客已创建')
      }
      hideAllForms()
      visitorForm.reset()
      await refreshVisitors()
    } catch (err) {
      setStatus(err.message || (visitorId ? '更新失败' : '创建失败'), true)
    }
  })

  groupsListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]')
    if (!btn) return
    const id = Number(btn.dataset.id)
    const g = groups.find((x) => x.id === id)
    if (btn.dataset.action === 'open-group-form') {
      openGroupForm(null)
      return
    }
    if (!g && btn.dataset.action !== 'open-group-form') return
    if (btn.dataset.action === 'edit-group') {
      openGroupForm(g)
    }
    if (btn.dataset.action === 'merge-group') {
      if (isProtectedGroup(g)) {
        setStatus('「未分组」为系统组，不可合并', true)
        return
      }
      openGroupActionForm({ type: 'merge', group: g })
    }
    if (btn.dataset.action === 'delete-group') {
      if (isProtectedGroup(g)) {
        setStatus('「未分组」为系统组，不可删除', true)
        return
      }
      openGroupActionForm({ type: 'delete', group: g })
    }
  })

  mergeHistoryListEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="revert-merge"]')
    if (!btn) return
    const logId = Number(btn.dataset.id)
    if (!logId) return
    if (!window.confirm('撤销后将恢复原访问组并把资源迁回，确定继续？')) return
    try {
      const res = await api.revertGroupMerge(logId)
      await refreshAll()
      await notifyGroupsChanged()
      setStatus(`已撤销合并，恢复访问组「${res.restored_group_name || ''}」`)
    } catch (err) {
      setStatus(err.message || '撤销失败', true)
    }
  })

  usersListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]')
    if (!btn) return
    if (btn.dataset.action === 'open-user-form') {
      openUserForm(null)
      return
    }
    const id = Number(btn.dataset.id)
    if (btn.dataset.action === 'delete-user') {
      if (!window.confirm('确定删除该用户？')) return
      try {
        await api.deleteUser(id)
        await refreshUsers()
        setStatus('用户已删除')
      } catch (err) {
        setStatus(err.message || '删除失败', true)
      }
    }
    if (btn.dataset.action === 'edit-user') {
      const { users } = await api.listUsers()
      const u = users.find((x) => x.id === id)
      if (!u) return
      openUserForm(u)
    }
  })

  visitorsListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]')
    if (!btn) return
    if (btn.dataset.action === 'open-visitor-form') {
      openVisitorForm(null)
      return
    }
    const id = Number(btn.dataset.id)
    if (btn.dataset.action === 'delete-visitor') {
      if (!window.confirm('确定删除该访客？')) return
      try {
        await api.deleteVisitorUser(id)
        await refreshVisitors()
        setStatus('访客已删除')
      } catch (err) {
        setStatus(err.message || '删除失败', true)
      }
    }
    if (btn.dataset.action === 'edit-visitor') {
      const { visitors } = await api.listVisitorUsers()
      const v = visitors.find((x) => x.id === id)
      if (!v) return
      openVisitorForm(v)
    }
  })

  return {
    async init() {
      try {
        await refreshAll()
        setStatus('')
      } catch (err) {
        setStatus(err.message || '加载失败', true)
      }
    },
  }
}
