/** 自定义框示例内容分段存储分隔符（前缀 / 原内容 / 后缀） */
export const SAMPLE_SEGMENT_SEP = '\u001e'

/** preview_sample_row 中表格列前后缀键前缀 */
export const SAMPLE_ADORN_KEY_PREFIX = '__adorn__:'

/**
 * @param {string} value
 * @returns {{ prefix: string[], core: string, suffix: string[] }}
 */
export function parseSampleStorage(value) {
  const s = String(value ?? '')
  if (!s.includes(SAMPLE_SEGMENT_SEP)) {
    return { prefix: [], core: s, suffix: [] }
  }
  const parts = s.split(SAMPLE_SEGMENT_SEP)
  const prefixBlock = parts[0] ?? ''
  const core = parts[1] ?? ''
  const suffixBlock = parts[2] ?? ''
  return {
    prefix: prefixBlock ? prefixBlock.split('\n') : [],
    core,
    suffix: suffixBlock ? suffixBlock.split('\n') : [],
  }
}

/**
 * @param {{ prefix?: string[], core?: string, suffix?: string[] }} segments
 * @returns {string}
 */
export function encodeSampleStorage(segments) {
  const prefix = segments.prefix || []
  const core = segments.core ?? ''
  const suffix = segments.suffix || []
  const prefixBlock = prefix.join('\n')
  const suffixBlock = suffix.join('\n')
  if (!prefixBlock && !suffixBlock) return core
  return `${prefixBlock}${SAMPLE_SEGMENT_SEP}${core}${SAMPLE_SEGMENT_SEP}${suffixBlock}`
}

/**
 * @param {{ prefix?: string[], core?: string, suffix?: string[] }} segments
 * @returns {string}
 */
export function sampleSegmentsToDisplayText(segments) {
  const prefixText = (segments.prefix || []).map((p) => String(p ?? '')).join('')
  const core = String(segments.core ?? '')
  const suffixText = (segments.suffix || []).map((s) => String(s ?? '')).join('')
  return `${prefixText}${core}${suffixText}`
}

/**
 * @param {unknown} raw
 * @returns {{ prefix: string[], suffix: string[] }}
 */
export function parseSampleAdornment(raw) {
  if (!raw || typeof raw !== 'object') return { prefix: [], suffix: [] }
  const prefix = Array.isArray(raw.prefix) ? raw.prefix.map((v) => String(v ?? '')) : []
  const suffix = Array.isArray(raw.suffix) ? raw.suffix.map((v) => String(v ?? '')) : []
  return { prefix, suffix }
}
