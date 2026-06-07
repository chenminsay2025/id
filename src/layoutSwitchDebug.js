/** 布局模板切换调试：localStorage cat.debugLayoutSwitch=1 或 URL ?debug_layout_switch=1 */

export function isLayoutSwitchDebugEnabled() {
  try {
    if (new URLSearchParams(window.location.search).has('debug_layout_switch')) return true
    return localStorage.getItem('cat.debugLayoutSwitch') === '1'
  } catch {
    return false
  }
}

export function logLayoutSwitch(label, data) {
  if (data !== undefined) {
    console.info('[CAT布局切换]', label, data)
  } else {
    console.info('[CAT布局切换]', label)
  }
}

export function warnLayoutSwitch(label, data) {
  if (!isLayoutSwitchDebugEnabled()) return
  console.warn('[CAT布局切换]', label, data ?? '')
}

/** 控制台一次性说明 */
export function bootLayoutSwitchDebugHint() {
  if (!isLayoutSwitchDebugEnabled()) return
  console.info(
    '[CAT布局切换] 调试已开启。关闭：localStorage.removeItem("cat.debugLayoutSwitch") 并刷新',
  )
}
