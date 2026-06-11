import { logPersistDone, logPersistScheduled } from './persistLog.js'

const LAYOUT_SETTINGS_URL = '/layout-settings.json'
const LAYOUT_STORAGE_KEY = 'catSvgGenerator.layout.v1'

let saveTimer = null
let fileHandle = null
/** @type {(() => object) | null} */
let pendingGetPayload = null

/** 仅编辑框布局，不含表格证书数据 */
export function buildLayoutSettingsPayload({ layoutOverrides, fontScale, showLayoutBoxes, showReferenceLayer, showTemplateLayer }) {
  return {
    v: 4,
    updatedAt: new Date().toISOString(),
    fontScale: fontScale ?? 1,
    showLayoutBoxes: !!showLayoutBoxes,
    showReferenceLayer: showReferenceLayer != null ? !!showReferenceLayer : false,
    showTemplateLayer: showTemplateLayer !== false,
    layoutOverrides: layoutOverrides ?? {},
  }
}

export function normalizeLayoutSettings(data) {
  if (!data || typeof data !== 'object') return null
  return {
    layoutOverrides: data.layoutOverrides && typeof data.layoutOverrides === 'object'
      ? data.layoutOverrides
      : {},
    fontScale: data.fontScale != null ? Number(data.fontScale) : null,
    showLayoutBoxes: data.showLayoutBoxes != null ? !!data.showLayoutBoxes : null,
    showReferenceLayer: data.showReferenceLayer != null ? !!data.showReferenceLayer : null,
    showTemplateLayer: data.showTemplateLayer != null ? !!data.showTemplateLayer : null,
    updatedAt: data.updatedAt || null,
    hadLegacyRows: Array.isArray(data.rows) && data.rows.length > 0,
  }
}

function pickNewerLayoutSettings(a, b) {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
  const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
  return tb > ta ? b : a
}

export function saveLayoutSettingsToLocal(payload) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch (err) {
    console.warn('[CAT 编辑框] localStorage 保存失败', err)
    return false
  }
}

export function loadLayoutSettingsFromLocal() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return null
    return normalizeLayoutSettings(JSON.parse(raw))
  } catch (err) {
    console.warn('[CAT 编辑框] localStorage 读取失败', err)
    return null
  }
}

export async function loadLayoutSettingsFromPublic() {
  try {
    const res = await fetch(`${LAYOUT_SETTINGS_URL}?t=${Date.now()}`)
    if (!res.ok) return null
    const data = await res.json()
    return normalizeLayoutSettings(data)
  } catch (err) {
    console.warn('[CAT 编辑框] 加载 layout-settings.json 失败', err)
    return null
  }
}

/** 合并磁盘 JSON 与 localStorage，取 updatedAt 较新者 */
export async function loadLayoutSettingsMerged() {
  const [fromFile, fromLocal] = await Promise.all([
    loadLayoutSettingsFromPublic(),
    Promise.resolve(loadLayoutSettingsFromLocal()),
  ])
  return pickNewerLayoutSettings(fromFile, fromLocal)
}

function hasMeaningfulLayoutOverrides(data) {
  if (!data?.layoutOverrides || typeof data.layoutOverrides !== 'object') return false
  return Object.keys(data.layoutOverrides).length > 0
}

function snapshotToLocalPayload(normalized) {
  return {
    v: 4,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    fontScale: normalized.fontScale ?? 1,
    showLayoutBoxes: normalized.showLayoutBoxes ?? false,
    showReferenceLayer: normalized.showReferenceLayer ?? false,
    showTemplateLayer: normalized.showTemplateLayer !== false,
    layoutOverrides: normalized.layoutOverrides ?? {},
  }
}

/**
 * 页面冷启动：优先 layout-settings.json，其次 localStorage，最后内置默认。
 * 磁盘有内容时写回 localStorage，避免旧缓存覆盖项目文件。
 * @param {() => Promise<{ layoutOverrides: object, fontScale: number, showLayoutBoxes: boolean, updatedAt: null, hadLegacyRows: false }>} loadBaked
 */
export async function loadLayoutSettingsOnStartup(loadBaked) {
  const [fromFile, fromLocal] = await Promise.all([
    loadLayoutSettingsFromPublic(),
    Promise.resolve(loadLayoutSettingsFromLocal()),
  ])

  if (hasMeaningfulLayoutOverrides(fromFile)) {
    saveLayoutSettingsToLocal(snapshotToLocalPayload(fromFile))
    return { data: fromFile, source: 'layout-settings.json' }
  }

  if (hasMeaningfulLayoutOverrides(fromLocal)) {
    return { data: fromLocal, source: '浏览器缓存（layout-settings.json 为空）' }
  }

  const baked = loadBaked ? await loadBaked() : null
  if (baked && hasMeaningfulLayoutOverrides(baked)) {
    return { data: baked, source: '内置默认配置（default-layout-settings.json）' }
  }

  return { data: fromFile || fromLocal || baked, source: '空布局（将使用模板默认）' }
}

export async function saveLayoutSettingsToFile(payload, { keepalive = false } = {}) {
  try {
    const res = await fetch(LAYOUT_SETTINGS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
      keepalive,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[CAT 编辑框] 保存失败', res.status, text)
      return false
    }
    return true
  } catch (err) {
    console.error('[CAT 编辑框] 保存请求异常', err)
    return false
  }
}

async function saveToLinkedFile(payload) {
  if (!fileHandle) return false
  try {
    const perm = await fileHandle.queryPermission({ mode: 'readwrite' })
    if (perm !== 'granted') {
      const req = await fileHandle.requestPermission({ mode: 'readwrite' })
      if (req !== 'granted') return false
    }
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(payload, null, 2))
    await writable.close()
    return true
  } catch {
    return false
  }
}

function resolvePayload(getPayloadOrObject) {
  if (typeof getPayloadOrObject === 'function') return getPayloadOrObject()
  return getPayloadOrObject
}

async function runSave(getPayloadOrObject, onStatus, reason) {
  const payload = resolvePayload(getPayloadOrObject)
  if (!payload) return false

  const localOk = saveLayoutSettingsToLocal(payload)

  const [fileOk, linkedOk] = await Promise.all([
    saveLayoutSettingsToFile(payload),
    saveToLinkedFile(payload),
  ])

  logPersistDone(reason, payload, { devOk: fileOk, fileOk: linkedOk })
  if (onStatus) {
    if (fileOk || linkedOk) onStatus('布局已保存')
    else if (localOk) onStatus('布局已保存到浏览器')
    else onStatus('保存失败')
  }
  return fileOk || linkedOk || localOk
}

/**
 * @param {object | (() => object)} getPayloadOrObject 布局数据或获取最新数据的函数
 */
export function scheduleLayoutSettingsSave(getPayloadOrObject, onStatus, reason = '编辑框布局') {
  const snapshot = resolvePayload(getPayloadOrObject)
  if (snapshot) {
    saveLayoutSettingsToLocal(snapshot)
    logPersistScheduled(reason, snapshot)
  }
  pendingGetPayload = typeof getPayloadOrObject === 'function'
    ? getPayloadOrObject
    : () => getPayloadOrObject

  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const getter = pendingGetPayload
    pendingGetPayload = null
    if (getter) runSave(getter, onStatus, reason)
  }, 500)
}

export async function flushLayoutSettingsSave(getPayloadOrObject, onStatus, reason = '立即保存编辑框') {
  clearTimeout(saveTimer)
  pendingGetPayload = null
  const payload = resolvePayload(getPayloadOrObject)
  if (payload) saveLayoutSettingsToLocal(payload)
  return runSave(
    getPayloadOrObject,
    onStatus,
    reason,
  )
}

export function flushLayoutSettingsSaveKeepalive(getPayloadOrObject, reason = '关闭页面前保存编辑框') {
  const payload = resolvePayload(getPayloadOrObject)
  if (!payload) return
  saveLayoutSettingsToLocal(payload)
  saveLayoutSettingsToFile(payload, { keepalive: true })
}

export function downloadLayoutSettings(payload, filename = 'layout-settings.json') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function importLayoutSettingsFromFileInput(file) {
  const text = await file.text()
  return normalizeLayoutSettings(JSON.parse(text))
}

export async function linkLayoutSettingsFile(onStatus) {
  if (!window.showSaveFilePicker) {
    if (onStatus) onStatus('当前浏览器不支持直接链接文件，请使用导出 JSON')
    return false
  }
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: 'layout-settings.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    })
    if (onStatus) onStatus('已链接布局文件，编辑框修改将自动写入')
    return true
  } catch {
    return false
  }
}

export async function pickLayoutSettingsFile(onStatus) {
  if (!window.showOpenFilePicker) return null
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    })
    fileHandle = handle
    const file = await handle.getFile()
    const data = normalizeLayoutSettings(JSON.parse(await file.text()))
    if (onStatus) onStatus('已从文件加载编辑框布局')
    return data
  } catch {
    return null
  }
}
