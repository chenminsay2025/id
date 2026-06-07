const LOG_PREFIX = '[CAT 编辑框]'

export function summarizePersistPayload(payload) {
  const overrideCols = Object.keys(payload?.layoutOverrides || {})
  return {
    updatedAt: payload?.updatedAt,
    fontScale: payload?.fontScale,
    showLayoutBoxes: payload?.showLayoutBoxes,
    overrideColumnCount: overrideCols.length,
    overrideColumns: overrideCols,
  }
}

/** 排队写入（防抖中） */
export function logPersistScheduled(reason, payload) {
  const summary = summarizePersistPayload(payload)
  console.groupCollapsed(`${LOG_PREFIX} ⏳ 排队 · ${reason}`)
  console.log('时间', new Date().toLocaleString())
  console.log('摘要', {
    字号比例: `${Math.round((summary.fontScale ?? 1) * 100)}%`,
    显示编辑框: summary.showLayoutBoxes,
    已自定义列数: summary.overrideColumnCount,
    已自定义列: summary.overrideColumns.length ? summary.overrideColumns : '(无，使用代码默认)',
  })
  if (summary.overrideColumnCount > 0) {
    console.log('layoutOverrides 明细', payload.layoutOverrides)
  }
  console.groupEnd()
}

/** 写入完成 */
export function logPersistDone(reason, payload, { devOk, fileOk }) {
  const targets = []
  if (devOk) targets.push('layout-settings.json（项目根目录）')
  if (fileOk) targets.push('链接的 JSON 文件')

  const summary = summarizePersistPayload(payload)
  console.group(`${LOG_PREFIX} ✓ 已保存 · ${reason}`)
  console.log('时间', new Date().toLocaleString())
  console.log(
    '写入目标',
    targets.length ? targets.join('、') : '⚠ 未写入磁盘（需 npm run dev 或链接 JSON 文件）',
  )
  console.log('摘要', {
    字号比例: `${Math.round((summary.fontScale ?? 1) * 100)}%`,
    显示编辑框: summary.showLayoutBoxes,
    已自定义列数: summary.overrideColumnCount,
    已自定义列: summary.overrideColumns,
  })
  if (summary.overrideColumnCount > 0) {
    console.log('layoutOverrides 明细', payload.layoutOverrides)
  }
  console.log('完整 JSON（仅编辑框，不含表格）', structuredClone(payload))
  console.groupEnd()
}

/** 布局覆盖项变更对比 */
export function logLayoutOverrideChange(reason, prev, next) {
  const cols = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
  const changes = []
  for (const col of cols) {
    const a = prev?.[col]
    const b = next?.[col]
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ 列: col, 变更前: a ?? null, 变更后: b ?? null })
    }
  }
  if (changes.length === 0) return

  console.groupCollapsed(`${LOG_PREFIX} 布局变更 · ${reason}`)
  console.table(changes.map((c) => ({
    列: c.列,
    变更前: c.变更前 ? JSON.stringify(c.变更前) : '—',
    变更后: c.变更后 ? JSON.stringify(c.变更后) : '—',
  })))
  console.log('逐项明细', changes)
  console.groupEnd()
}

/** 从文件加载 */
export function logPersistLoad(source, data) {
  console.group(`${LOG_PREFIX} 已加载 · ${source}`)
  if (!data) {
    console.log('(无数据)')
  } else {
    if (data.hadLegacyRows) {
      console.warn('旧版 JSON 中的 rows 表格数据已忽略，仅应用编辑框布局')
    }
    const summary = summarizePersistPayload({
      fontScale: data.fontScale,
      showLayoutBoxes: data.showLayoutBoxes,
      layoutOverrides: data.layoutOverrides || {},
    })
    console.log('摘要', summary)
    if (summary.overrideColumnCount > 0) {
      console.log('layoutOverrides', data.layoutOverrides)
    }
  }
  console.groupEnd()
}
