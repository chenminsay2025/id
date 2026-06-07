import { Converter } from 'opencc-js'

/** 列名匹配用：繁体 → 简体，便于「猫名」与「貓名」等视为同一列 */
const toSimplified = Converter({ from: 'tw', to: 'cn' })

/**
 * 规范化 Excel / 模板列名以便匹配（trim + 繁转简）。
 * 输出列名仍使用模板原始列名，此处仅用于比较。
 * @param {unknown} value
 */
export function normalizeColumnKey(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  try {
    return toSimplified(trimmed)
  } catch {
    return trimmed
  }
}

/**
 * 解析表格列顺序：有表格模板时严格按模板列顺序，否则沿用已保存顺序。
 * @param {string[] | null | undefined} templateColumns
 * @param {string[] | null | undefined} savedColumnOrder
 * @returns {string[] | null}
 */
export function resolveTemplateColumnOrder(templateColumns, savedColumnOrder) {
  const template = (templateColumns || [])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
  if (template.length) return [...template]
  const saved = (savedColumnOrder || [])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
  return saved.length ? [...saved] : null
}
