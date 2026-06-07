/** 后台布局预设编辑器：图层开关（仅 CMS，不写前台） */
const STORAGE_KEY = 'cat.admin.layoutPresetLayers.v1'

export const ADMIN_LAYER_TOGGLE_DEFAULTS = {
  showLayoutBoxes: false,
  showReferenceLayer: false,
  showTemplateLayer: true,
}

/** @returns {typeof ADMIN_LAYER_TOGGLE_DEFAULTS} */
export function loadAdminLayoutLayerToggles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...ADMIN_LAYER_TOGGLE_DEFAULTS }
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return { ...ADMIN_LAYER_TOGGLE_DEFAULTS }
    return {
      showLayoutBoxes: data.showLayoutBoxes != null ? !!data.showLayoutBoxes : ADMIN_LAYER_TOGGLE_DEFAULTS.showLayoutBoxes,
      showReferenceLayer: data.showReferenceLayer != null ? !!data.showReferenceLayer : ADMIN_LAYER_TOGGLE_DEFAULTS.showReferenceLayer,
      showTemplateLayer: data.showTemplateLayer != null ? !!data.showTemplateLayer : ADMIN_LAYER_TOGGLE_DEFAULTS.showTemplateLayer,
    }
  } catch {
    return { ...ADMIN_LAYER_TOGGLE_DEFAULTS }
  }
}

/** @param {{ showLayoutBoxes?: boolean, showReferenceLayer?: boolean, showTemplateLayer?: boolean }} patch */
export function saveAdminLayoutLayerToggles(patch) {
  try {
    const prev = loadAdminLayoutLayerToggles()
    const next = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore quota / private mode
  }
}
