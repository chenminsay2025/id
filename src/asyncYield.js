/** 让出主线程，避免长任务导致页面无响应 */
export function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * 有限并发执行任务（用于批量上传等 IO）
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 */
export async function runAsyncPool(items, concurrency, worker) {
  if (!items.length) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) break
      results[i] = await worker(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()))
  return results
}
