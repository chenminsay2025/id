import { Converter } from 'opencc-js'

/** 搜索匹配：繁体 → 简体，便于「猫/貓」「来/來」等视为相同 */
const toSimplified = Converter({ from: 'tw', to: 'cn' })

/**
 * 搜索用文本规范化：NFKC + 繁转简 + 小写（ASCII）
 * @param {unknown} value
 */
export function normalizeSearchText(value) {
  const raw = String(value ?? '').normalize('NFKC').trim()
  if (!raw) return ''
  let converted = raw
  try {
    converted = toSimplified(raw)
  } catch {
    converted = raw
  }
  return converted.toLowerCase()
}

/**
 * @param {unknown} haystack
 * @param {unknown} query
 */
export function searchTextIncludes(haystack, query) {
  const q = normalizeSearchText(query)
  if (!q) return true
  return normalizeSearchText(haystack).includes(q)
}
