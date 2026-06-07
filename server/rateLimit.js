/**
 * 简易内存速率限制器
 * 按 key（用户名+IP）限制登录尝试次数，防止暴力破解
 */

const LOGIN_WINDOW_MS = 5 * 60 * 1000 // 5 分钟窗口
const LOGIN_MAX_ATTEMPTS = 10 // 最多 10 次

/** @type {Map<string, { count: number, resetAt: number }>} */
const attempts = new Map()

// 定期清理过期记录
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of attempts) {
    if (now >= entry.resetAt) attempts.delete(key)
  }
}, 60_000)

/**
 * 检查是否触发登录速率限制
 * @param {string} username
 * @param {string} ip
 * @returns {{ allowed: boolean, retryAfterSec: number, remaining: number }}
 */
export function checkLoginRateLimit(username, ip) {
  const now = Date.now()
  const key = `${username.trim().toLowerCase()}|${ip}`

  let entry = attempts.get(key)
  if (!entry || now >= entry.resetAt) {
    // 创建新窗口
    entry = { count: 1, resetAt: now + LOGIN_WINDOW_MS }
    attempts.set(key, entry)
    return { allowed: true, retryAfterSec: 0, remaining: LOGIN_MAX_ATTEMPTS - 1 }
  }

  entry.count += 1
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfterSec, remaining: 0 }
  }

  return { allowed: true, retryAfterSec: 0, remaining: LOGIN_MAX_ATTEMPTS - entry.count }
}

/**
 * 登录成功后清除对应记录（避免成功后还占着窗口）
 * @param {string} username
 * @param {string} ip
 */
export function clearLoginRateLimit(username, ip) {
  const key = `${username.trim().toLowerCase()}|${ip}`
  attempts.delete(key)
}

/**
 * 从 Hono Request 提取客户端 IP
 * @param {import('hono').Context} c
 * @returns {string}
 */
export function getClientIp(c) {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '127.0.0.1'
  )
}
