/** 布局模板名称匹配：用于按列值智能选择行布局 */

const SEPARATOR_RE = /[\s_\-—–·•.,，。、/\\|]+/

/** @param {string} s */
export function normalizePresetMatchText(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(SEPARATOR_RE, '')
}

/** @param {string} s @returns {string[]} */
function tokenizePresetMatchText(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .split(SEPARATOR_RE)
    .map((t) => normalizePresetMatchText(t))
    .filter(Boolean)
}

/** @param {string} a @param {string} b */
function levenshteinRatio(a, b) {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) matrix[i][0] = i
  for (let j = 0; j < cols; j++) matrix[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }
  const dist = matrix[a.length][b.length]
  return 1 - dist / Math.max(a.length, b.length)
}

/**
 * @param {string} cellValue
 * @param {string} presetName
 * @returns {number} 0–100
 */
export function scorePresetNameMatch(cellValue, presetName) {
  const rawCell = String(cellValue ?? '').trim()
  const rawPreset = String(presetName ?? '').trim()
  if (!rawCell || !rawPreset) return 0

  const a = normalizePresetMatchText(rawCell)
  const b = normalizePresetMatchText(rawPreset)
  if (!a || !b) return 0
  if (a === b) return 100

  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    return 80 + ratio * 18
  }

  let tokenScore = 0
  const tokensA = tokenizePresetMatchText(rawCell)
  const tokensB = tokenizePresetMatchText(rawPreset)
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (!ta || !tb) continue
      if (ta === tb) {
        tokenScore = Math.max(tokenScore, 72 + Math.min(ta.length, 6))
      } else if (ta.includes(tb) || tb.includes(ta)) {
        const ratio = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length)
        tokenScore = Math.max(tokenScore, 55 + ratio * 20)
      }
    }
  }

  const levScore = levenshteinRatio(a, b) * 68
  return Math.max(tokenScore, levScore)
}

/**
 * @param {string} cellValue
 * @param {Array<{ id: number, name: string }>} presets
 * @param {{ minScore?: number }} [options]
 * @returns {{ preset: { id: number, name: string }, score: number } | null}
 */
export function findBestPresetMatch(cellValue, presets, { minScore = 45 } = {}) {
  /** @type {{ preset: { id: number, name: string }, score: number } | null} */
  let best = null
  for (const preset of presets) {
    const score = scorePresetNameMatch(cellValue, preset.name)
    if (score < minScore) continue
    if (
      !best
      || score > best.score
      || (score === best.score && String(preset.name).length > String(best.preset.name).length)
    ) {
      best = { preset, score }
    }
  }
  return best
}
