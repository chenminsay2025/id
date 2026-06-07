/**
 * 布局模板库预览结构：
 * - preview-stage--workspace：比页面大的工作区（含四周留白），便于查看拖出页面的编辑框
 * - preview-artboard：页面边界容器，挂载 SVG 与 layout-overlay；本身透明，仅保留细线标示页缘
 * @param {SVGSVGElement} svgEl
 * @returns {{ stage: HTMLElement, artboard: HTMLElement, svgEl: SVGSVGElement }}
 */
export function wrapSvgInLayoutWorkspace(svgEl) {
  const stage = document.createElement('div')
  stage.className = 'preview-stage preview-stage--workspace'

  const artboard = document.createElement('div')
  artboard.className = 'preview-artboard'
  artboard.appendChild(svgEl)
  stage.appendChild(artboard)

  return { stage, artboard, svgEl }
}

/** @param {ParentNode} root */
export function queryPreviewArtboard(root) {
  return root.querySelector('.preview-artboard') || root.querySelector('.preview-stage')
}

/** @param {ParentNode} root */
export function queryPreviewSvg(root) {
  return queryPreviewArtboard(root)?.querySelector('svg') ?? null
}
