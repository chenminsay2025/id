/**
 * IP 归属地解析（ip-api.com，结果内存缓存）
 */

/** @type {Map<string, { location: string, expiresAt: number }>} */
const cache = new Map()
const CACHE_TTL_MS = 7 * 86400 * 1000

/** @param {string} ip */
export function isPrivateIp(ip) {
  if (!ip) return true
  const v = String(ip).trim().toLowerCase()
  if (!v || v === '127.0.0.1' || v === '::1' || v === 'localhost' || v === 'unknown') return true
  if (v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
  return false
}

/** @param {{ status?: string, country?: string, regionName?: string, city?: string } | null | undefined} */
function formatLocation(data) {
  if (!data || data.status !== 'success') return '未知'
  /** @type {string[]} */
  const parts = []
  if (data.country) parts.push(data.country)
  if (data.regionName && data.regionName !== data.city) parts.push(data.regionName)
  if (data.city) parts.push(data.city)
  return parts.join(' ') || '未知'
}

/**
 * @param {string[]} ips
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveIpLocations(ips) {
  /** @type {Map<string, string>} */
  const result = new Map()
  /** @type {string[]} */
  const needLookup = []

  for (const ip of ips) {
    const key = String(ip || '').trim()
    if (!key) {
      result.set(ip, '未知')
      continue
    }
    if (isPrivateIp(key)) {
      result.set(key, '本地/内网')
      continue
    }
    const cached = cache.get(key)
    if (cached && Date.now() < cached.expiresAt) {
      result.set(key, cached.location)
    } else if (!needLookup.includes(key)) {
      needLookup.push(key)
    }
  }

  for (let i = 0; i < needLookup.length; i += 100) {
    const chunk = needLookup.slice(i, i + 100)
    try {
      const res = await fetch('http://ip-api.com/batch?lang=zh-CN', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`ip-api ${res.status}`)
      const batch = await res.json()
      chunk.forEach((ip, idx) => {
        const loc = formatLocation(Array.isArray(batch) ? batch[idx] : null)
        cache.set(ip, { location: loc, expiresAt: Date.now() + CACHE_TTL_MS })
        result.set(ip, loc)
      })
    } catch (err) {
      console.warn('[ipGeo] 批量解析失败:', err?.message || err)
      chunk.forEach((ip) => result.set(ip, '未知'))
    }
  }

  return result
}
