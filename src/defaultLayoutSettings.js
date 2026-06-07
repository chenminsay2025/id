import baked from './default-layout-settings.json'

const DEFAULT_LAYOUT_SETTINGS_URL = '/default-layout-settings.json'

/** 项目内置编辑框默认配置（与 src/default-layout-settings.json 同步，写死在构建产物中） */
export const DEFAULT_LAYOUT_SETTINGS_BAKED = baked

/** @returns {{ layoutOverrides: object, fontScale: number, showLayoutBoxes: boolean, updatedAt: null, hadLegacyRows: false }} */
export function getDefaultLayoutSettings() {
  return {
    layoutOverrides: structuredClone(baked.layoutOverrides),
    fontScale: baked.fontScale ?? 1,
    showLayoutBoxes: baked.showLayoutBoxes ?? true,
    showReferenceLayer: baked.showReferenceLayer ?? true,
    showTemplateLayer: baked.showTemplateLayer !== false,
    updatedAt: null,
    hadLegacyRows: false,
  }
}

/** 用于写入 layout-settings.json 的完整 payload */
export function buildDefaultLayoutSettingsPayload() {
  return {
    v: 4,
    updatedAt: new Date().toISOString(),
    fontScale: baked.fontScale ?? 1,
    showLayoutBoxes: !!baked.showLayoutBoxes,
    showReferenceLayer: baked.showReferenceLayer != null ? !!baked.showReferenceLayer : true,
    showTemplateLayer: baked.showTemplateLayer !== false,
    layoutOverrides: structuredClone(baked.layoutOverrides),
  }
}

/** 从当前页面状态生成要写入 src/default-layout-settings.json 的内容 */
export function buildDefaultLayoutSettingsFromCurrent({
  layoutOverrides,
  fontScale,
  showLayoutBoxes,
  showReferenceLayer,
  showTemplateLayer,
}) {
  return {
    v: 4,
    fontScale: fontScale ?? 1,
    showLayoutBoxes: !!showLayoutBoxes,
    showReferenceLayer: showReferenceLayer != null ? !!showReferenceLayer : true,
    showTemplateLayer: showTemplateLayer !== false,
    layoutOverrides: structuredClone(layoutOverrides ?? {}),
  }
}

/** 开发模式下写入项目内置默认配置（需 npm run dev） */
export async function saveDefaultLayoutSettingsToProject(payload) {
  try {
    const res = await fetch(DEFAULT_LAYOUT_SETTINGS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[CAT 默认配置] 写入失败', res.status, text)
      return false
    }
    return true
  } catch (err) {
    console.error('[CAT 默认配置] 写入请求异常', err)
    return false
  }
}

/** 从 dev 服务或静态资源读取最新内置默认（优先于构建时 import 的副本） */
export async function loadBakedLayoutSettingsFromServer() {
  try {
    const res = await fetch(`${DEFAULT_LAYOUT_SETTINGS_URL}?t=${Date.now()}`)
    if (!res.ok) return getDefaultLayoutSettings()
    const data = await res.json()
    if (!data || typeof data !== 'object') return getDefaultLayoutSettings()
    return {
      layoutOverrides: data.layoutOverrides && typeof data.layoutOverrides === 'object'
        ? structuredClone(data.layoutOverrides)
        : structuredClone(baked.layoutOverrides),
      fontScale: data.fontScale != null ? Number(data.fontScale) : (baked.fontScale ?? 1),
      showLayoutBoxes: data.showLayoutBoxes != null ? !!data.showLayoutBoxes : !!baked.showLayoutBoxes,
      showReferenceLayer: data.showReferenceLayer != null ? !!data.showReferenceLayer : (baked.showReferenceLayer ?? true),
      updatedAt: data.updatedAt || null,
      hadLegacyRows: false,
    }
  } catch {
    return getDefaultLayoutSettings()
  }
}

export function downloadDefaultLayoutSettings(payload, filename = 'default-layout-settings.json') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
