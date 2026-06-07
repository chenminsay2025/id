const STORAGE_KEY = 'cat.editor.previewSettings.v3'
const LEGACY_KEYS = ['cat.editor.previewSettings.v2', 'cat.editor.previewSettings.v1']

/** @typedef {{ scale: number, panX: number, panY: number }} PreviewViewState */

/** 图层开关不写入 localStorage，每次进入页面使用此默认值 */
export const PREVIEW_LAYER_TOGGLE_DEFAULTS = {
  showLayoutBoxes: false,
  showReferenceLayer: false,
  showTemplateLayer: true,
}

const DEFAULTS = {
  panMode: false,
  /** @type {PreviewViewState | null} */
  view: null,
  ...PREVIEW_LAYER_TOGGLE_DEFAULTS,
}

/** @returns {typeof DEFAULTS} */
export function loadPreviewSettings() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      for (const legacyKey of LEGACY_KEYS) {
        const legacyRaw = localStorage.getItem(legacyKey)
        if (!legacyRaw) continue
        try {
          const legacy = JSON.parse(legacyRaw)
          if (legacy && typeof legacy === 'object') {
            const migrated = pickPersistedFields(legacy)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
            try {
              localStorage.removeItem(legacyKey)
            } catch {
              /* ignore */
            }
            return { ...DEFAULTS, ...migrated }
          }
        } catch {
          /* try next */
        }
      }
      return { ...DEFAULTS }
    }
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return { ...DEFAULTS }
    return { ...DEFAULTS, ...pickPersistedFields(data) }
  } catch {
    return { ...DEFAULTS }
  }
}

/** 仅持久化预览平移/缩放；不含字号与图层勾选 */
function pickPersistedFields(data) {
  const view = normalizeView(data.view)
  return {
    panMode: !!data.panMode,
    view,
  }
}

/** @param {{ panMode?: boolean, view?: PreviewViewState | null }} patch */
export function savePreviewSettings(patch) {
  try {
    const prev = pickPersistedFields(loadPreviewSettings())
    const next = {
      ...prev,
      updatedAt: new Date().toISOString(),
    }
    if (patch.panMode != null) {
      next.panMode = !!patch.panMode
    }
    if (patch.view !== undefined) {
      next.view = normalizeView(patch.view)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore quota / private mode
  }
}

/** @param {unknown} view @returns {PreviewViewState | null} */
function normalizeView(view) {
  if (!view || typeof view !== 'object') return null
  const scale = Number(/** @type {{ scale?: number }} */ (view).scale)
  if (!Number.isFinite(scale) || scale <= 0) return null
  return {
    scale: Math.min(8, Math.max(0.1, scale)),
    panX: Number(/** @type {{ panX?: number }} */ (view).panX) || 0,
    panY: Number(/** @type {{ panY?: number }} */ (view).panY) || 0,
  }
}

export function getDefaultPreviewSettings() {
  return { ...DEFAULTS }
}
