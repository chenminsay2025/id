const SVG_NS = 'http://www.w3.org/2000/svg'

/** 不参与重命名的内嵌样式（字体等） */
const SKIP_STYLE_IDS = new Set(['cat-font-face', 'cat-font-datauri'])

let scopeCounter = 0

/** @param {string} name */
function escapeRegex(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 为 SVG 内 Illustrator 等导出的 CSS class 添加唯一前缀，避免页面上多个内联 SVG 的
 * `.st0` / `.st1` 等全局样式互相覆盖（表现为填色丢失、只剩描边、颜色错乱）。
 * @param {Element} svgRoot
 */
export function scopeSvgStyleClasses(svgRoot) {
  if (!svgRoot || svgRoot.namespaceURI !== SVG_NS) return

  /** @type {Set<string>} */
  const classNames = new Set()

  for (const styleEl of svgRoot.querySelectorAll('style')) {
    if (SKIP_STYLE_IDS.has(styleEl.id || '')) continue
    const css = styleEl.textContent || ''
    const re = /\.([a-zA-Z_][\w-]*)/g
    let match
    while ((match = re.exec(css)) !== null) {
      classNames.add(match[1])
    }
  }

  if (classNames.size === 0) return

  const prefix = `cs${(++scopeCounter).toString(36)}_`
  /** @type {Map<string, string>} */
  const rename = new Map()
  for (const name of classNames) {
    rename.set(name, `${prefix}${name}`)
  }

  const ordered = [...rename.keys()].sort((a, b) => b.length - a.length)

  for (const styleEl of svgRoot.querySelectorAll('style')) {
    if (SKIP_STYLE_IDS.has(styleEl.id || '')) continue
    let css = styleEl.textContent || ''
    for (const oldName of ordered) {
      css = css.replace(
        new RegExp(`\\.${escapeRegex(oldName)}(?![\\w-])`, 'g'),
        `.${rename.get(oldName)}`,
      )
    }
    styleEl.textContent = css
  }

  for (const el of svgRoot.querySelectorAll('[class]')) {
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)
    if (!classes.length) continue
    el.setAttribute(
      'class',
      classes.map((c) => rename.get(c) || c).join(' '),
    )
  }
}
