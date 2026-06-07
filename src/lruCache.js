/**
 * 简单 LRU Map 缓存，超过容量时淘汰最早插入的条目
 * @template K, V
 */
export class LruCache {
  /** @param {number} maxSize 最大缓存条数 */
  constructor(maxSize = 10) {
    this.maxSize = maxSize
    this._map = new Map()
  }

  get(key) {
    if (!this._map.has(key)) return undefined
    // 访问时移到末尾（最近使用）
    const val = this._map.get(key)
    this._map.delete(key)
    this._map.set(key, val)
    return val
  }

  set(key, value) {
    if (this._map.has(key)) {
      this._map.delete(key)
    } else if (this._map.size >= this.maxSize) {
      // 删除最早插入的（Map 遍历顺序 = 插入顺序）
      const first = this._map.keys().next().value
      this._map.delete(first)
    }
    this._map.set(key, value)
  }

  has(key) {
    return this._map.has(key)
  }

  delete(key) {
    return this._map.delete(key)
  }

  clear() {
    this._map.clear()
  }

  keys() {
    return this._map.keys()
  }

  get size() {
    return this._map.size
  }
}
