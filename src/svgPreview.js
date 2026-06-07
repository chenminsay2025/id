const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * 规范化 SVG 尺寸属性，便于在缩略图容器内缩放显示。
 * @param {string} svgContent
 * @returns {string}
 */
export function normalizeSvgForPreview(svgContent) {
  if (!svgContent || !svgContent.includes('<svg')) return svgContent
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.localName !== 'svg') return svgContent

  const parseError = doc.querySelector('parsererror')
  if (parseError) return svgContent

  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width')) || 100
    const h = parseFloat(svg.getAttribute('height')) || 100
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  }
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', SVG_NS)
  }

  return new XMLSerializer().serializeToString(svg)
}

function revokeContainerObjectUrl(container) {
  const prev = container?.dataset?.svgObjectUrl
  if (prev) {
    URL.revokeObjectURL(prev)
    delete container.dataset.svgObjectUrl
  }
}

/**
 * 用 <img> + blob URL 隔离展示 SVG，避免多个内联 SVG 的 class/id 样式互相污染。
 * @param {HTMLElement} container
 * @param {string} svgContent
 * @returns {boolean} 是否成功挂载
 */
export function mountIsolatedSvgPreview(container, svgContent) {
  if (!container) return false
  revokeContainerObjectUrl(container)
  container.replaceChildren()

  if (!svgContent || !svgContent.includes('<svg')) return false

  const normalized = normalizeSvgForPreview(svgContent)
  const blob = new Blob([normalized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  container.dataset.svgObjectUrl = url

  const img = document.createElement('img')
  img.className = 'svg-preview-img'
  img.alt = ''
  img.decoding = 'async'
  img.src = url
  img.addEventListener('error', () => revokeContainerObjectUrl(container), { once: true })
  container.appendChild(img)
  return true
}

/** @param {HTMLElement} container */
export function unmountIsolatedSvgPreview(container) {
  if (!container) return
  revokeContainerObjectUrl(container)
  container.replaceChildren()
}
