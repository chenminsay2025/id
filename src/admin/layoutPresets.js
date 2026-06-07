import { api } from '../api/client.js'
import {
  loadAccessibleGroups,
  pickGroupIdForCreate,
  userNeedsGroupPick,
  shouldShowGroupUi,
} from './groupUtils.js'
import { groupSelectFieldHtml, groupBadgeHtml } from './groupSelectorUi.js'
import {
  downloadJsonFile,
  readJsonFile,
  askImportConflictMode,
  alertImportDetails,
  formatImportResultMessage,
  dataTransferMenuHtml,
  setupDataTransferMenu,
} from './dataTransferUi.js'
import { collapsiblePanelHtml, mountCollapsiblePanels, mountCollapsiblePanelReorderGroups, mountCollapsiblePanelResizeGroups } from '../collapsiblePanel.js'
import { generateSvgFromRow, refillSvgRowText, emptyRow, applyTemplateBackgroundTransform } from '../svgEngine.js'
import { mountLayoutEditor } from '../layoutEditor.js'
import { mountLayoutPanel } from '../layoutPanel.js'
import { mountPreviewViewport } from '../previewViewport.js'
import { wrapSvgInLayoutWorkspace, queryPreviewArtboard, queryPreviewSvg } from '../previewWorkspace.js'
import {
  renameLayoutBox,
  syncAutoColumnBindings,
  getPrimaryColumnForBox,
  getBindings,
  bindColumnToBox,
  createLayoutBox,
  deleteLayoutBox,
  hideLayoutBoxes as hideLayoutBoxesInOverrides,
  defaultNewBoxBounds,
  resolveBoxId,
  unhideLayoutBoxes,
  listLayoutBoxes,
  stripLayoutOverrideMeta,
  pruneLayoutOverridesForTable,
  TABLE_TEMPLATE_SCOPE_KEY,
  TABLE_TEMPLATE_COLUMNS_KEY,
} from '../layoutBinding.js'
import {
  computeColumnRenames,
  applyColumnRenamesToLayoutOverrides,
  applyColumnRenamesToPreviewSampleRow,
  applyColumnRenamesToPageNavColumn,
  applyColumnRenamesToRecordKeys,
} from '../tableTemplateColumnDiff.js'
import {
  layoutHasBox,
  isLayoutBoxActive,
  getColumnLayout,
  applyColumnBoxBounds,
  listLayoutBoxIds,
  isPedigreeStyleTable,
  clampLayoutBoxBounds,
} from '../svgEngine.js'
import {
  initLayoutHistory,
  updateLayoutHistoryBaseline,
  recordLayoutHistory,
  undoLayout,
  redoLayout,
  getLayoutHistoryState,
  LAYOUT_HISTORY_PRESETS,
} from '../layoutHistory.js'
import {
  loadAdminLayoutLayerToggles,
  saveAdminLayoutLayerToggles,
} from './adminLayoutLayerStorage.js'
import {
  copyLayoutBoxToClipboard,
  copyLayoutBoxesToClipboard,
  pasteLayoutBoxesFromClipboard,
  hasLayoutBoxClipboard,
  getLayoutBoxClipboard,
} from '../layoutBoxClipboard.js'
import { loadFontCatalog, ensureCatalogFontFaces } from '../fontCatalog.js'
import {
  toolbarBtnHtml,
  toolbarSep,
  toolbarZoomGroupHtml,
  toolbarLayerTogglesHtml,
  toolbarOverlayVisualHtml,
} from '../toolbarUi.js'
import { resolveRuntimeFontUrl } from '../fontRuntime.js'
import {
  SAMPLE_ADORN_KEY_PREFIX,
  encodeSampleStorage,
  parseSampleAdornment,
  parseSampleStorage,
  sampleSegmentsToDisplayText,
} from '../sampleDialogSegments.js'
import { EMPTY_SVG_TEMPLATE, loadSvgTemplateContent } from '../svgTemplateLoader.js'
import {
  DEFAULT_PAGE_WIDTH_MM,
  DEFAULT_PAGE_HEIGHT_MM,
  pageSizeFromPreset,
} from '../pageSize.js'
import {
  parsePageNavColumns,
  serializePageNavColumns,
  pageNavColumnsEqual,
  normalizePageNavColumnStorage,
} from '../pageNavColumn.js'
import {
  TEMPLATE_BACKGROUND_KEY,
  TEMPLATE_BACKGROUND_BOX_ID,
  TEMPLATE_BACKGROUND_LEGACY_BOX_ID,
  getDefaultTemplateBackground,
  getTemplateBackground,
  isTemplateBackgroundLocked,
  withTemplateBackgroundLock,
} from '../templateBackground.js'

/** Photoshop 风格图层可见性图标 */
const LAYER_EYE_ON_SVG =
  '<svg class="layout-layer-eye" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>'
const LAYER_EYE_OFF_SVG =
  '<svg class="layout-layer-eye" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.3 3.3 2 4.6l3.5 3.5C3.4 9.7 2.2 10.8 1 12c1.7 3.9 6 7 11 7 1.5 0 2.9-.3 4.2-.8l3.2 3.2 1.3-1.3L3.3 3.3zm8.7 14.7c-5 0-9.3-3.1-11-7 .6-1.4 1.5-2.6 2.6-3.5l2.9 2.9c-.3.7-.5 1.5-.5 2.3a4 4 0 0 0 6.3 3.3l2.2 2.2c-1 .4-2.1.6-3.2.6zm7.4-4.1-2.5-2.5c.9-1.3 1.4-2.9 1.4-4.6 0-.5-.1-1-.2-1.4l3.6 3.6c-.8 1.5-2 2.8-3.3 3.9z"/></svg>'

const LAYERS_PANEL_COLLAPSED_KEY = 'layout-preset-layers-collapsed'

/** 穿透容器上滚轮仍滚动 stack（padding / 间隙区点击已穿透到画布） */
function mountPassthroughScrollStack(stackEl) {
  if (!stackEl || stackEl.dataset.passthroughScrollMounted === '1') return
  stackEl.dataset.passthroughScrollMounted = '1'
  stackEl.addEventListener('wheel', (e) => {
    if (!stackEl.contains(e.target)) return
    const innerScroll = e.target.closest('.layout-layers-list, [data-collapsible-resize-body]')
    if (innerScroll instanceof HTMLElement && innerScroll !== stackEl) {
      const canInnerScroll = innerScroll.scrollHeight > innerScroll.clientHeight + 1
      if (canInnerScroll) {
        const { scrollTop, clientHeight, scrollHeight } = innerScroll
        const scrollingUp = e.deltaY < 0
        const scrollingDown = e.deltaY > 0
        const atTop = scrollTop <= 0
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1
        if ((scrollingUp && !atTop) || (scrollingDown && !atBottom)) return
      }
    }
    if (stackEl.scrollHeight <= stackEl.clientHeight + 1) return
    stackEl.scrollTop += e.deltaY
    e.preventDefault()
  }, { passive: false, capture: true })
}

/**
 * @param {HTMLElement} container
 * @param {{ user?: { is_super_admin?: boolean, group_ids?: number[] }, onChange?: () => void }} [options]
 */
export function mountLayoutPresetsPanel(container, options = {}) {
  async function presetBodyWithGroup(body) {
    if (body.group_id != null) return body
    if (!userNeedsGroupPick(options.user)) return body
    const groupId = await pickGroupIdForCreate(options.user, '新建布局模板的访问组')
    if (groupId == null) return null
    return { ...body, group_id: groupId }
  }

  container.innerHTML = `
    <div class="wp-settings-panel-inner layout-presets-panel">
      <div class="layout-presets-body">
      <div class="layout-presets-layout">
        <aside class="layout-presets-sidebar" aria-label="布局模板列表">
          <header class="layout-presets-sidebar-header">
            <h2 class="wp-settings-title layout-presets-sidebar-page-title">布局模板库</h2>
            <p class="wp-settings-desc layout-presets-sidebar-header-desc">管理证书排版布局：选择或新建模板，右侧编辑 SVG 与编辑框。模板按<strong>访问组</strong>隔离。</p>
          </header>
          <div class="layout-presets-sidebar-head">
            <div class="layout-presets-sidebar-toolbar">
              <h3 class="layout-presets-sidebar-title">模板文件</h3>
              <div class="layout-presets-sidebar-actions">
                ${dataTransferMenuHtml({ prefix: 'layout-preset' })}
                <button type="button" class="button button-primary button-sm" id="layout-preset-new">新建</button>
                <button type="button" class="button button-sm" id="layout-preset-copy" disabled>复制</button>
                <button type="button" class="button button-sm" id="layout-preset-delete" disabled>删除</button>
              </div>
            </div>
            <p class="templates-list-hint layout-presets-sidebar-hint">勾选后可用「复制」；点击名称在新选项卡打开，顶部选项卡切换，× 关闭。</p>
          </div>
          <ul id="layout-preset-list" class="layout-presets-list"></ul>
        </aside>
        <div class="layout-presets-main">
          <div class="layout-presets-editor" id="layout-preset-editor">
          <div class="layout-presets-editor-chrome">
          <div class="layout-presets-top-bar layout-presets-view-toolbar svg-chrome-toolbar" role="toolbar" aria-label="布局编辑与预览">
            <div class="layout-presets-top-bar__tabs layout-preset-tabs-bar" id="layout-preset-tabs-bar">
              <div class="layout-preset-tabs-scroll" id="layout-preset-tabs" role="tablist" aria-label="已打开的布局模板"></div>
            </div>
            <span class="tb-sep layout-presets-top-bar__tabs-sep" id="layout-preset-tabs-sep" role="separator" aria-hidden="true"></span>
            <input type="text" class="layout-presets-editor-title-input layout-presets-top-bar__title" id="layout-preset-editor-title" value="" placeholder="未打开布局模板" spellcheck="false" title="点击修改布局模板名称" disabled />
            <span class="tb-sep" role="separator" aria-hidden="true"></span>
            <div class="layout-presets-top-bar__tools">
            <div class="tb-group tb-group--history layout-presets-top-edit" role="group" aria-label="编辑操作">
              ${toolbarBtnHtml({ id: 'layout-preset-undo', icon: 'undo', label: '撤销', title: '撤销 (Ctrl+Z)', disabled: true })}
              ${toolbarBtnHtml({ id: 'layout-preset-redo', icon: 'redo', label: '重做', title: '重做 (Ctrl+Shift+Z)', disabled: true })}
              ${toolbarBtnHtml({ id: 'layout-preset-select-all', label: '全选', title: '全选编辑框 (Ctrl+A)' })}
            </div>
            ${toolbarSep()}
            <div class="tb-group layout-presets-top-docs" role="group" aria-label="模板文件">
              <label class="tb-field tb-field--inline" title="关联的 SVG 文件">
                <span class="tb-field__label">SVG</span>
                <select id="layout-preset-svg-select" class="tb-select"></select>
              </label>
              <label class="tb-field tb-field--inline" title="关联的表格列结构">
                <span class="tb-field__label">表格</span>
                <select id="layout-preset-table-select" class="tb-select"></select>
              </label>
              <span id="layout-preset-group-slot" class="layout-preset-group-slot"></span>
            </div>
            ${toolbarSep()}
            ${toolbarLayerTogglesHtml({
              boxesId: 'layout-preset-show-boxes',
              referenceId: 'layout-preset-show-reference',
              templateId: 'layout-preset-show-template',
              templateChecked: true,
            })}
            ${toolbarSep()}
            ${toolbarBtnHtml({ id: 'layout-preset-template-bg-lock', label: '底图锁定', title: '底图默认锁定铺满页面；解锁后可拖拽调整底图显示区域' })}
            ${toolbarSep()}
            ${toolbarOverlayVisualHtml({
              borderId: 'layout-preset-overlay-border',
              handlesId: 'layout-preset-overlay-handles',
              borderChecked: true,
              handlesChecked: true,
              showTitle: false,
            })}
            </div>
          </div>
          </div>
          <div class="layout-presets-workspace">
            <div class="layout-presets-canvas">
              <div class="preview-area layout-presets-preview-area" id="layout-preset-preview-area">
                <p class="preview-empty-msg">加载预览…</p>
              </div>
            </div>
            <aside class="layout-presets-tools-rail svg-chrome-toolbar" role="complementary" aria-label="布局编辑工具">
              <div class="layout-presets-tools-rail-stack" data-collapsible-reorder-group="layout-preset-rail">
                ${collapsiblePanelHtml({
                  panelId: 'layout-preset-page-panel',
                  title: '基本操作',
                  panelClass: 'layout-basic-ops-panel',
                  storageKey: 'layout-preset-page-collapsed',
                  reorderId: 'basic-ops',
                  content: `
                    <div class="layout-basic-ops-body" data-collapsible-resize-body="">
                      <div class="layout-presets-page-size-row">
                        <label class="tb-field tb-field--stacked" title="导出 PDF 的页面宽度（毫米）">
                          <span class="tb-field__label">页面宽 (mm)</span>
                          <input type="number" id="layout-preset-page-width-mm" class="tb-input-num" min="10" max="2000" step="0.1" value="297" />
                        </label>
                        <label class="tb-field tb-field--stacked" title="导出 PDF 的页面高度（毫米）">
                          <span class="tb-field__label">页面高 (mm)</span>
                          <input type="number" id="layout-preset-page-height-mm" class="tb-input-num" min="10" max="2000" step="0.1" value="210" />
                        </label>
                      </div>
                      <div class="tb-field tb-field--stacked layout-preset-page-nav-column-field" title="公开预览页码栏除页码外显示的表格列，可多选">
                        <span class="tb-field__label">页码栏显示列</span>
                        <div id="layout-preset-page-nav-columns" class="layout-preset-page-nav-columns" role="group" aria-label="页码栏显示列"></div>
                        <p class="layout-preset-page-nav-columns-hint">可多选，按表格列顺序显示</p>
                      </div>
                      <div class="layout-basic-ops-slot" id="layout-preset-basic-ops-slot" aria-live="polite"></div>
                    </div>`,
                })}
                ${collapsiblePanelHtml({
                  panelId: 'layout-preset-layers-panel',
                  title: '编辑框',
                  panelClass: 'layout-layers-panel',
                  storageKey: LAYERS_PANEL_COLLAPSED_KEY,
                  reorderId: 'layers',
                  metaHtml: '<span class="layout-layers-panel-meta" id="layout-preset-layer-count" title="可见 / 总数">—</span>',
                  content: `
                    <div class="layout-preset-column-tools">
                      <div
                        id="layout-preset-column-checks"
                        class="layout-layers-list"
                        data-collapsible-resize-body=""
                        role="listbox"
                        aria-label="编辑框图层"
                        aria-multiselectable="true"
                      ></div>
                      <div class="layout-layers-panel-actions">
                        ${toolbarBtnHtml({ id: 'layout-preset-add-custom-box', label: '+ 自定义框', title: '添加未绑定列名的自定义文本框' })}
                        ${toolbarBtnHtml({ id: 'layout-preset-copy-box', label: '复制框', title: '复制选中编辑框（含预览内容，Ctrl+C）' })}
                        ${toolbarBtnHtml({ id: 'layout-preset-paste-box', label: '粘贴框', title: '粘贴为自定义编辑框（Ctrl+V）' })}
                      </div>
                    </div>`,
                })}
              </div>
              <div class="layout-panel layout-panel--toolbar layout-panel--dock-right" id="layout-preset-layout-panel" hidden aria-hidden="true"></div>
            </aside>
          </div>
          <div class="layout-presets-bottom-bar layout-presets-view-toolbar svg-chrome-toolbar" role="toolbar" aria-label="预览缩放与保存">
            <div class="layout-presets-bottom-bar__inner">
              <div class="tb-group tb-group--selection">
                <span class="tb-kicker" title="框内可点选；拖边移动/缩放；框外框选多选">选中</span>
                <span class="layout-panel-column" id="layout-preset-panel-layout-panel-column">未选择</span>
              </div>
              <div class="tb-group layout-preset-sample-pagination" id="layout-preset-sample-pagination" hidden aria-label="示例行分页">
                <button type="button" class="btn btn-sm tb-btn" id="layout-preset-sample-prev" disabled>← 上一页</button>
                <span id="layout-preset-sample-index" class="table-pagination-index">- / -</span>
                <button type="button" class="btn btn-sm tb-btn" id="layout-preset-sample-next" disabled>下一页 →</button>
              </div>
              ${toolbarZoomGroupHtml({
                outId: 'layout-preset-zoom-out',
                inId: 'layout-preset-zoom-in',
                fitId: 'layout-preset-zoom-fit',
                valueId: 'layout-preset-zoom-value',
                showReset: false,
              })}
              <div class="layout-presets-editor-actions">
                <button type="button" class="button button-sm" id="layout-preset-revisions" title="查看并恢复保存历史（最多 50 条）">历史</button>
                <button type="button" class="button button-sm button-primary" id="layout-preset-save" title="保存布局 (Ctrl+S)">保存</button>
              </div>
            </div>
          </div>
          <p class="layout-presets-status" id="layout-preset-status" aria-live="polite"></p>
        </div>
        </div>
      </div>
      </div>
    </div>
    <dialog id="layout-preset-revisions-dialog" class="cms-dialog layout-preset-revisions-dialog">
      <h3>保存历史</h3>
      <p class="layout-preset-revisions-hint">每个模板最多保留 50 条保存记录，可恢复到任意历史版本。</p>
      <ul id="layout-preset-revisions-list" class="layout-preset-revisions-list"></ul>
      <div class="cms-dialog-actions">
        <button type="button" class="button" id="layout-preset-revisions-close">关闭</button>
      </div>
    </dialog>
  `

  const listEl = container.querySelector('#layout-preset-list')
  const tabsEl = container.querySelector('#layout-preset-tabs')
  const editorTitleEl = container.querySelector('#layout-preset-editor-title')
  const statusEl = container.querySelector('#layout-preset-status')
  const saveBtn = container.querySelector('#layout-preset-save')
  const revisionsBtn = container.querySelector('#layout-preset-revisions')
  const revisionsDialog = container.querySelector('#layout-preset-revisions-dialog')
  const revisionsListEl = container.querySelector('#layout-preset-revisions-list')
  const revisionsCloseBtn = container.querySelector('#layout-preset-revisions-close')
  const deleteBtn = container.querySelector('#layout-preset-delete')
  const copyBtn = container.querySelector('#layout-preset-copy')
  const newBtn = container.querySelector('#layout-preset-new')
  const svgSelectEl = container.querySelector('#layout-preset-svg-select')
  const tableSelectEl = container.querySelector('#layout-preset-table-select')
  const pageWidthEl = container.querySelector('#layout-preset-page-width-mm')
  const pageHeightEl = container.querySelector('#layout-preset-page-height-mm')
  const pageNavColumnsEl = container.querySelector('#layout-preset-page-nav-columns')
  const templateBgLockBtn = container.querySelector('#layout-preset-template-bg-lock')
  const toolsRailStackEl = container.querySelector('.layout-presets-tools-rail-stack')
  const layersPanelEl = container.querySelector('#layout-preset-layers-panel')
  const layerCountEl = container.querySelector('#layout-preset-layer-count')
  const columnChecksEl = container.querySelector('#layout-preset-column-checks')
  const topUndoBtn = container.querySelector('#layout-preset-undo')
  const topRedoBtn = container.querySelector('#layout-preset-redo')
  const topSelectAllBtn = container.querySelector('#layout-preset-select-all')
  const addCustomBoxBtn = container.querySelector('#layout-preset-add-custom-box')
  const copyBoxBtn = container.querySelector('#layout-preset-copy-box')
  const pasteBoxBtn = container.querySelector('#layout-preset-paste-box')
  const showBoxesEl = container.querySelector('#layout-preset-show-boxes')
  const showReferenceEl = container.querySelector('#layout-preset-show-reference')
  const showTemplateEl = container.querySelector('#layout-preset-show-template')
  const overlayBorderEl = container.querySelector('#layout-preset-overlay-border')
  const overlayHandlesEl = container.querySelector('#layout-preset-overlay-handles')
  const previewArea = container.querySelector('#layout-preset-preview-area')
  const layoutPanelRoot = container.querySelector('#layout-preset-layout-panel')
  const selectionColumnEl = container.querySelector('#layout-preset-panel-layout-panel-column')
  const zoomValueEl = container.querySelector('#layout-preset-zoom-value')
  const samplePaginationEl = container.querySelector('#layout-preset-sample-pagination')
  const samplePrevBtn = container.querySelector('#layout-preset-sample-prev')
  const sampleNextBtn = container.querySelector('#layout-preset-sample-next')
  const sampleIndexEl = container.querySelector('#layout-preset-sample-index')

  /** @type {{ id: number, name: string, slug: string, is_default?: boolean, group_id?: number | null }[]} */
  let presets = []
  /** @type {((opts?: { reinsertRow?: boolean }) => void) | null} */
  let presetListReorderCleanup = null
  /** @type {{ id: number, name: string }[]} */
  let accessGroups = []
  let groupSaving = false
  /** @type {number | null} 当前打开模板的所属组（与 presets 缓存同步） */
  let currentPresetGroupId = null
  /** @type {{ id: number, name: string }[]} */
  let svgTemplates = []
  /** @type {{ id: number, name: string, columns?: string[] }[]} */
  let tableTemplates = []
  let currentId = null
  let draftDirty = false
  let saveInFlight = false
  let autosaveTimer = null
  let statusClearTimer = null
  const AUTOSAVE_MS = 5 * 60_000
  let layoutOverrides = {}
  let fontScale = 1
  let pageWidthMm = DEFAULT_PAGE_WIDTH_MM
  let pageHeightMm = DEFAULT_PAGE_HEIGHT_MM
  /** @type {string} 公开预览页码栏显示的表格列名 */
  let pageNavColumn = ''
  let showLayoutBoxes = false
  /** @type {boolean | null} 中键拖拽画布前「编辑框」开关状态 */
  let showBoxesBeforeMiddlePan = null
  let showReferenceLayer = false
  let showTemplateLayer = true
  let overlayShowBorder = true
  let overlayShowHandles = true
  let templateSvg = EMPTY_SVG_TEMPLATE
  /** @type {string[]} */
  let previewColumns = []
  /** @type {Record<string, string>} */
  let sampleRow = {}
  /** 表格列编辑框的前后缀示例（原内容随表格模板示例行更新） */
  /** @type {Record<string, { prefix: string[], suffix: string[] }>} */
  let sampleAdornments = {}
  /** 当前表格模板全部示例行（每行对应预览一页） */
  /** @type {Record<string, string>[]} */
  let tableTemplateSampleRows = []
  let previewSamplePageIndex = 0
  /** 已加载 sample_rows 的表格模板 id（用于切换模板时重置页码） */
  let sampleRowsTableTemplateId = null
  let fontUrl = ''
  /** @type {import('../fontCatalog.js').FontCatalog | null} */
  let fontCatalog = null
  let previewGeneration = 0
  /** 切换布局预设时递增，避免异步加载完成后写错预设的示例行 */
  let loadContextGeneration = 0
  /** 当前预设是否已完成加载（加载完成前不记入撤销历史） */
  let presetLoadReady = false
  /** 当前已应用的表格模板 id（用于判断是否需清空编辑框） */
  let activeTableTemplateId = null
  /** 正在切换/加载布局预设时禁止自动保存，避免写入错误预设 */
  let presetLoading = false
  /** 取消勾选列时暂存的编辑框配置（再次勾选时恢复，避免复位） */
  /** @type {Record<string, { boxId: string, layout: object }>} */
  let columnLayoutStash = {}
  /**
   * 当前预设编辑会话内，按表格模板 id 暂存的布局与示例数据。
   * 来回切换表格模板时可恢复，避免切回原表后 SVG 内容丢失。
   * @type {Map<number, {
   *   layoutOverrides: object,
   *   sampleRow: Record<string, string>,
   *   sampleAdornments: Record<string, { prefix: string[], suffix: string[] }>,
   *   columnLayoutStash: Record<string, { boxId: string, layout: object }>,
   *   previewSamplePageIndex: number,
   * }>}
   */
  let tableTemplateSessionCache = new Map()
  /** 已打开的布局预设选项卡（有序） */
  /** @type {number[]} */
  let openTabIds = []
  /** @type {Set<number>} */
  const checkedPresetIds = new Set()
  /**
   * 选项卡切换时暂存的编辑状态（未保存到服务器也可保留）
   * @type {Map<number, object>}
   */
  let presetTabSessionCache = new Map()
  /** 正在后台拉取预设数据的选项卡 */
  /** @type {Set<number>} */
  let loadingTabIds = new Set()
  /** @type {Map<number, Promise<object|null>>} */
  let presetSessionLoadTasks = new Map()
  /** 选项卡切换时缓存的预览 DOM，避免重复 generateSvgFromRow */
  /** @type {Map<number, { stage: HTMLElement, viewState: object | null }>} */
  let presetTabPreviewDomCache = new Map()
  /** @type {Map<number, Promise<void>>} */
  let presetPreviewWarmTasks = new Map()
  /** @type {Promise<void> | null} */
  let previewRebuildPromise = null
  let tabSwitchDebugSeq = 0
  const TAB_SWITCH_LOG = '[布局选项卡]'

  /** @type {ReturnType<typeof mountLayoutEditor> | null} */
  let layoutEditor = null
  /** @type {ReturnType<typeof mountLayoutPanel> | null} */
  let layoutPanel = null

  function setMiddlePanLayoutBoxesSuppressed(active) {
    if (active) {
      if (showBoxesBeforeMiddlePan != null) return
      showBoxesBeforeMiddlePan = showLayoutBoxes
      if (showLayoutBoxes) {
        layoutEditor?.setVisible(false)
        if (showBoxesEl) showBoxesEl.checked = false
      }
      return
    }
    if (showBoxesBeforeMiddlePan == null) return
    const saved = showBoxesBeforeMiddlePan
    showBoxesBeforeMiddlePan = null
    if (showBoxesEl) showBoxesEl.checked = saved
    layoutEditor?.setVisible(saved)
  }

  const previewViewport = mountPreviewViewport(previewArea, {
    workspacePaddingMm: 40,
    onScaleChange(scale) {
      if (zoomValueEl) zoomValueEl.textContent = `${Math.round(scale * 100)}%`
    },
    onViewChange() {
      layoutEditor?.repositionOverlay?.()
    },
    onMiddlePanActiveChange(active) {
      setMiddlePanLayoutBoxesSuppressed(active)
    },
  })
  let previewViewportInitialized = false

  function persistLayerTogglesToBrowser() {
    saveAdminLayoutLayerToggles({
      showLayoutBoxes,
      showReferenceLayer,
      showTemplateLayer,
    })
  }

  function syncLayerToggleInputs() {
    if (showBoxesEl) showBoxesEl.checked = showLayoutBoxes
    if (showReferenceEl) showReferenceEl.checked = showReferenceLayer
    if (showTemplateEl) showTemplateEl.checked = showTemplateLayer
  }

  function applyLayerToggles(next, { persistBrowser = true, refreshPreview = false } = {}) {
    showLayoutBoxes = !!next.showLayoutBoxes
    showReferenceLayer = !!next.showReferenceLayer
    showTemplateLayer = next.showTemplateLayer !== false
    syncLayerToggleInputs()
    layoutEditor?.setVisible(showLayoutBoxes)
    if (persistBrowser) persistLayerTogglesToBrowser()
    if (refreshPreview) {
      void rebuildPreview(layoutEditor?.getSelectedColumns?.() ?? [])
    }
  }

  function layerTogglesFromPreset(preset) {
    return {
      showLayoutBoxes: preset?.show_layout_boxes != null ? !!preset.show_layout_boxes : false,
      showReferenceLayer: preset?.show_reference_layer != null ? !!preset.show_reference_layer : false,
      showTemplateLayer: preset?.show_template_layer != null ? !!preset.show_template_layer : true,
    }
  }

  /** 清空编辑器全局状态（保留已打开选项卡） */
  function resetPresetEditorGlobals() {
    previewColumns = []
    sampleRow = {}
    sampleAdornments = {}
    tableTemplateSampleRows = []
    previewSamplePageIndex = 0
    sampleRowsTableTemplateId = null
    activeTableTemplateId = null
    columnLayoutStash = {}
    tableTemplateSessionCache = new Map()
    layoutOverrides = {}
    fontScale = 1
    presetLoadReady = false
    previewViewportInitialized = false
    setStatus('')
  }

  /** 切换布局预设前清空编辑会话，避免与上一预设共用内存状态 */
  function resetPresetEditorSession() {
    resetPresetEditorGlobals()
    openTabIds = []
    presetTabSessionCache = new Map()
    presetTabPreviewDomCache = new Map()
    loadingTabIds = new Set()
    presetSessionLoadTasks = new Map()
  }

  function setPreviewLoading(loading, label = '') {
    if (!previewArea) return
    let overlay = previewArea.querySelector('.layout-preset-preview-loading')
    if (loading) {
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.className = 'layout-preset-preview-loading'
        overlay.innerHTML = (
          '<div class="layout-preset-preview-loading-inner">'
          + '<span class="layout-preset-preview-spinner" aria-hidden="true"></span>'
          + '<span class="layout-preset-preview-loading-text">加载中…</span>'
          + '</div>'
        )
        previewArea.appendChild(overlay)
      }
      const textEl = overlay.querySelector('.layout-preset-preview-loading-text')
      if (textEl) {
        textEl.textContent = label ? `正在打开「${label}」…` : '加载中…'
      }
      overlay.hidden = false
      previewArea.classList.add('is-loading')
    } else {
      overlay?.remove()
      previewArea.classList.remove('is-loading')
    }
  }

  function turnOnLayoutBoxes() {
    if (showLayoutBoxes) return
    applyLayerToggles({
      showLayoutBoxes: true,
      showReferenceLayer,
      showTemplateLayer,
    }, { persistBrowser: true })
  }

  function showListError(msg) {
    listEl.innerHTML = `<li class="templates-empty-item templates-error">${escapeHtml(msg)}</li>`
  }

  function syncPageSizeInputs() {
    if (pageWidthEl) pageWidthEl.value = String(pageWidthMm)
    if (pageHeightEl) pageHeightEl.value = String(pageHeightMm)
  }

  function syncPageNavColumnCheckboxes() {
    if (!pageNavColumnsEl) return
    const cols = previewColumns.length ? [...previewColumns] : []
    let selected = parsePageNavColumns(pageNavColumn)
    if (cols.length > 0) {
      selected = selected.filter((col) => cols.includes(col))
      pageNavColumn = serializePageNavColumns(selected)
    }
    const selectedSet = new Set(selected)
    const ordered = [...cols]
    for (const col of selected) {
      if (!ordered.includes(col)) ordered.push(col)
    }
    if (!ordered.length) {
      pageNavColumnsEl.innerHTML = '<p class="layout-preset-page-nav-columns-empty">请先选择表格模板</p>'
      return
    }
    pageNavColumnsEl.innerHTML = ordered.map((col) => {
      const checked = selectedSet.has(col) ? ' checked' : ''
      const inTable = cols.includes(col)
      const missingClass = inTable ? '' : ' layout-preset-page-nav-col--missing'
      const disabled = inTable ? '' : ' disabled'
      return (
        `<label class="layout-preset-page-nav-col${missingClass}">`
        + `<input type="checkbox" data-page-nav-col="${escapeHtml(col)}" value="${escapeHtml(col)}"${checked}${disabled} />`
        + `<span>${escapeHtml(col)}</span>`
        + '</label>'
      )
    }).join('')
  }

  function verifyPageNavColumnSaved(preset, expected) {
    if (!preset || preset.page_nav_column === undefined) return false
    return pageNavColumnsEqual(preset.page_nav_column, expected)
  }

  function readPageNavColumnsFromUi() {
    if (!pageNavColumnsEl) {
      pageNavColumn = ''
      return ''
    }
    const cols = previewColumns.length ? previewColumns : []
    const selected = []
    for (const col of cols) {
      const input = pageNavColumnsEl.querySelector(`input[data-page-nav-col="${CSS.escape(col)}"]`)
      if (input?.checked) selected.push(col)
    }
    pageNavColumn = serializePageNavColumns(selected)
    return pageNavColumn
  }

  function readPageSizeFromInputs() {
    const w = Number(pageWidthEl?.value)
    const h = Number(pageHeightEl?.value)
    pageWidthMm = Number.isFinite(w) && w > 0 ? w : DEFAULT_PAGE_WIDTH_MM
    pageHeightMm = Number.isFinite(h) && h > 0 ? h : DEFAULT_PAGE_HEIGHT_MM
    syncPageSizeInputs()
  }

  function normalizeOverlayBoxId(boxId) {
    return boxId === TEMPLATE_BACKGROUND_LEGACY_BOX_ID ? TEMPLATE_BACKGROUND_BOX_ID : boxId
  }

  function previewTemplateBackgroundTransform(overrides = layoutOverrides) {
    if (!showTemplateLayer) return
    const svgEl = queryPreviewSvg(previewArea)
    if (svgEl) applyTemplateBackgroundTransform(svgEl, overrides, pageWidthMm, pageHeightMm)
  }

  function isTemplateBackgroundBoxActive() {
    return showTemplateLayer && !isTemplateBackgroundLocked(layoutOverrides)
  }

  function templateBackgroundBoxLayout(overrides = layoutOverrides) {
    const bg = getTemplateBackground(overrides, pageWidthMm, pageHeightMm)
    return {
      boxLeft: bg.boxLeft,
      boxRight: bg.boxRight,
      boxTop: bg.boxTop,
      boxBottom: bg.boxBottom,
    }
  }

  function applyTemplateBackgroundBoxBounds(overrides, _boxId, bounds, edge) {
    const merged = clampLayoutBoxBounds({
      ...templateBackgroundBoxLayout(overrides),
      ...bounds,
    }, edge)
    return {
      ...overrides,
      [TEMPLATE_BACKGROUND_KEY]: {
        ...getTemplateBackground(overrides, pageWidthMm, pageHeightMm),
        ...merged,
        locked: false,
      },
    }
  }

  function getTemplateBackgroundLayoutBoxBridge() {
    return {
      getLayout: (boxId, overrides) => (
        boxId === TEMPLATE_BACKGROUND_BOX_ID
          ? templateBackgroundBoxLayout(overrides)
          : getColumnLayout(boxId, overrides)
      ),
      applyBounds: (overrides, boxId, bounds, edge) => (
        boxId === TEMPLATE_BACKGROUND_BOX_ID
          ? applyTemplateBackgroundBoxBounds(overrides, boxId, bounds, edge)
          : applyColumnBoxBounds(overrides, boxId, bounds, edge)
      ),
    }
  }

  function syncTemplateBgLockUi() {
    if (!templateBgLockBtn) return
    const locked = isTemplateBackgroundLocked(layoutOverrides)
    templateBgLockBtn.textContent = locked ? '底图锁定' : '底图解锁'
    templateBgLockBtn.classList.toggle('active', !locked)
    templateBgLockBtn.title = locked
      ? '底图已锁定铺满页面；点击解锁后可拖拽调整底图区域'
      : '底图已解锁，可拖拽调整；点击恢复锁定并铺满页面'
  }

  function onPageSizeInputChange() {
    if (!presetLoadReady || presetLoading) {
      syncPageSizeInputs()
      return
    }
    readPageSizeFromInputs()
    previewViewport.setPageAspectRatio(pageWidthMm, pageHeightMm)
    if (isTemplateBackgroundLocked(layoutOverrides)) {
      layoutOverrides = {
        ...layoutOverrides,
        [TEMPLATE_BACKGROUND_KEY]: getDefaultTemplateBackground(pageWidthMm, pageHeightMm),
      }
    }
    draftDirty = true
    setStatus('有未保存的修改（页面尺寸）')
    void rebuildPreview(layoutEditor?.getSelectedColumns?.() ?? [])
  }

  function toggleTemplateBackgroundLock() {
    if (!presetLoadReady || presetLoading) return
    const locked = isTemplateBackgroundLocked(layoutOverrides)
    layoutOverrides = withTemplateBackgroundLock(layoutOverrides, !locked, pageWidthMm, pageHeightMm)
    draftDirty = true
    syncTemplateBgLockUi()
    setStatus(locked ? '已解锁 SVG 底图，可拖拽调整区域' : '已锁定 SVG 底图并铺满页面')
    const selection = locked
      ? (layoutEditor?.getSelectedColumns?.() ?? []).filter((id) => id !== TEMPLATE_BACKGROUND_BOX_ID)
      : [TEMPLATE_BACKGROUND_BOX_ID]
    void rebuildPreview(selection)
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return
    clearTimeout(statusClearTimer)
    statusEl.textContent = msg || ''
    statusEl.classList.toggle('is-error', !!isError)
    statusEl.classList.toggle('is-saving', false)
    if (msg && !isError) {
      statusClearTimer = setTimeout(() => {
        if (statusEl.textContent === msg) statusEl.textContent = ''
      }, 4000)
    }
  }

  function formatPresetTime(iso) {
    try {
      return new Date(iso).toLocaleString('zh-CN')
    } catch {
      return iso
    }
  }

  async function saveCurrentPreset({ revisionNote = '保存', quiet = false } = {}) {
    if (!currentId || saveInFlight) return false
    saveInFlight = true
    if (!quiet && statusEl) {
      statusEl.classList.add('is-saving')
      statusEl.textContent = '正在保存…'
      statusEl.classList.remove('is-error')
    }
    try {
      readPageSizeFromInputs()
      const res = await api.updatePreset(currentId, {
        layout_overrides: layoutOverridesForSave(),
        preview_sample_row: getCustomSampleRowForSave(),
        font_scale: fontScale,
        show_layout_boxes: showLayoutBoxes,
        show_reference_layer: showReferenceLayer,
        show_template_layer: showTemplateLayer,
        svg_template_id: getSelectedSvgTemplateId(),
        table_template_id: getSelectedTableTemplateId(),
        page_width_mm: pageWidthMm,
        page_height_mm: pageHeightMm,
        page_nav_column: readPageNavColumnsFromUi(),
        record_revision: true,
        revision_note: revisionNote,
      })
      if (res.preset && !verifyPresetTemplateRefsSaved(res.preset)) {
        setStatus('布局已保存，但 SVG/表格模板关联未写入数据库。请 Ctrl+C 后重新运行 npm run dev:local', true)
        return false
      }
      draftDirty = false
      if (currentId) capturePresetTabSession(currentId)
      if (!quiet) {
        setStatus(revisionNote === '自动保存' ? '已自动保存' : '布局已保存')
      }
      await refreshList(currentId)
      renderPresetTabs()
      options.onChange?.()
      return true
    } catch (err) {
      setStatus(err.message || '保存失败', true)
      return false
    } finally {
      saveInFlight = false
      statusEl?.classList.remove('is-saving')
    }
  }

  function startAutosaveTimer() {
    clearInterval(autosaveTimer)
    autosaveTimer = setInterval(() => {
      if (draftDirty && currentId && !saveInFlight && !presetLoading) {
        void saveCurrentPreset({ revisionNote: '自动保存' })
      }
    }, AUTOSAVE_MS)
  }

  function onDocumentKeydownSave(e) {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 's') return
    const presetView = container.closest('[data-view="layout-presets"]')
    if (presetView && !presetView.classList.contains('is-active')) return
    if (!currentId) return
    e.preventDefault()
    void saveCurrentPreset({ revisionNote: '手动保存' })
  }

  function onDocumentKeydownUndoRedo(e) {
    if (!(e.ctrlKey || e.metaKey)) return
    const presetView = container.closest('[data-view="layout-presets"]')
    if (!presetView?.classList.contains('is-active')) return
    if (!currentId || !presetLoadReady) return
    if (e.target.closest('#table-wrap') || e.target.closest('#tbl-tpl-table-wrap')) return
    if (e.target.closest('.spreadsheet-cell.is-editing')) return
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return

    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) {
      if (!getLayoutHistoryState(LAYOUT_HISTORY_PRESETS).canUndo) return
      e.preventDefault()
      e.stopImmediatePropagation()
      performLayoutUndo()
      return
    }
    if (key === 'z' && e.shiftKey) {
      if (!getLayoutHistoryState(LAYOUT_HISTORY_PRESETS).canRedo) return
      e.preventDefault()
      e.stopImmediatePropagation()
      performLayoutRedo()
    }
  }

  function syncSidebarActions() {
    const hasOpenTab = currentId != null && openTabIds.includes(currentId)
    deleteBtn.disabled = !hasOpenTab
    if (copyBtn) copyBtn.disabled = checkedPresetIds.size === 0
  }

  function isEditorActive() {
    return currentId != null && openTabIds.includes(currentId)
  }

  function showPreviewIdle() {
    if (previewArea?.querySelector('.layout-presets-preview-idle')) return
    destroyLayoutEditor()
    previewGeneration += 1
    previewViewportInitialized = false
    setPreviewLoading(false)
    const p = document.createElement('p')
    p.className = 'preview-empty-msg layout-presets-preview-idle'
    p.textContent = '在左侧点击模板名称打开编辑，或点击「新建」创建布局模板。'
    previewViewport.setContent(p)
    if (selectionColumnEl) selectionColumnEl.textContent = '未选择'
    if (zoomValueEl) zoomValueEl.textContent = '100%'
    renderColumnPicker()
    refreshTopEditToolbar()
  }

  function syncEditorIdleState() {
    const hasTab = isEditorActive()
    const toolsEnabled = hasTab && presetLoadReady && !presetLoading

    if (editorTitleEl) {
      editorTitleEl.disabled = !hasTab
      if (!hasTab) editorTitleEl.value = ''
    }
    if (!hasTab) {
      currentPresetGroupId = null
      renderPresetGroupField(null)
    }
    const groupSelectEl = container.querySelector('#layout-preset-edit-group')
    if (groupSelectEl) groupSelectEl.disabled = !toolsEnabled
    for (const el of [
      saveBtn,
      revisionsBtn,
      svgSelectEl,
      tableSelectEl,
      pageWidthEl,
      pageHeightEl,
      topSelectAllBtn,
      templateBgLockBtn,
      addCustomBoxBtn,
      copyBoxBtn,
      pasteBoxBtn,
      showBoxesEl,
      showReferenceEl,
      showTemplateEl,
      overlayBorderEl,
      overlayHandlesEl,
      samplePrevBtn,
      sampleNextBtn,
      container.querySelector('#layout-preset-zoom-in'),
      container.querySelector('#layout-preset-zoom-out'),
      container.querySelector('#layout-preset-zoom-fit'),
    ]) {
      if (el) el.disabled = !toolsEnabled
    }
    refreshTopEditToolbar()
  }

  function syncEditorVisibility() {
    const hasOpenTabs = openTabIds.length > 0
    if (!hasOpenTabs) {
      currentId = null
      presetLoadReady = false
    }

    if (!isEditorActive()) {
      showPreviewIdle()
    }
    syncEditorIdleState()
    syncSidebarActions()
  }

  function pruneCheckedPresetIds() {
    for (const id of [...checkedPresetIds]) {
      if (!presets.some((p) => p.id === id)) checkedPresetIds.delete(id)
    }
  }

  function createTabSwitchTrace(event, meta = {}) {
    const id = ++tabSwitchDebugSeq
    const t0 = performance.now()
    /** @type {{ label: string, ms: number, extra?: object }[]} */
    const marks = []
    return {
      id,
      event,
      mark(label, extra) {
        marks.push({ label, ms: performance.now() - t0, extra })
      },
      end(extra = {}) {
        const totalMs = performance.now() - t0
        console.groupCollapsed(`${TAB_SWITCH_LOG} #${id} ${event} · ${totalMs.toFixed(1)}ms`)
        console.log('摘要', {
          ...meta,
          totalMs: Number(totalMs.toFixed(2)),
          ...extra,
        })
        for (const { label, ms, extra: markExtra } of marks) {
          console.log(`  ${ms.toFixed(1).padStart(7, ' ')}ms  ${label}`, markExtra ?? '')
        }
        console.groupEnd()
        return totalMs
      },
      cancel(reason, extra = {}) {
        this.end({ cancelled: reason, ...extra })
      },
    }
  }

  function explainTabSwitchPath(presetId) {
    const hasSession = presetTabSessionCache.get(presetId)?.templateSvg != null
    const hasDom = presetTabPreviewDomCache.has(presetId)
    if (hasDom && hasSession) return 'fastRestore'
    if (!hasSession) return 'coldSession'
    if (!hasDom) return 'coldDom'
    return 'unknown'
  }

  function prefetchOpenPresetSessions(exceptId = currentId) {
    const run = () => {
      for (const tabId of openTabIds) {
        if (tabId === exceptId) continue
        if (presetTabSessionCache.get(tabId)?.templateSvg != null) {
          void warmPresetTabPreviewDom(tabId)
          continue
        }
        if (presetSessionLoadTasks.has(tabId)) continue
        void ensurePresetSessionLoaded(tabId)
      }
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2500 })
    } else {
      setTimeout(run, 120)
    }
  }

  /** 从 session 快照构建预览行（后台预热 DOM 用，不依赖当前编辑态） */
  function buildPreviewRowFromSession(session) {
    const layoutOverridesLocal = session.layoutOverrides || {}
    const previewColumnsLocal = session.previewColumns || []
    const sampleRowLocal = session.sampleRow || {}
    const sampleAdornmentsLocal = session.sampleAdornments || {}
    const columnLayoutStashLocal = session.columnLayoutStash || {}
    const tableRows = session.tableTemplateSampleRows || []
    const pageIndex = session.previewSamplePageIndex ?? 0
    const tableRow = tableRows[pageIndex] || tableRows[0] || {}

    const getTableVal = (col) => {
      const fromTable = tableRow[col]
      if (fromTable != null && String(fromTable).trim() !== '') return fromTable
      return col
    }

    const getDisplayText = (boxId) => {
      const resolved = resolveBoxId(boxId, layoutOverridesLocal)
      const isCustom = !previewColumnsLocal.includes(resolved)
      if (isCustom) {
        return sampleSegmentsToDisplayText(parseSampleStorage(sampleRowLocal[resolved] ?? ''))
      }
      const col = getPrimaryColumnForBox(resolved, layoutOverridesLocal)
      const adorn = sampleAdornmentsLocal[resolved] || { prefix: [], suffix: [] }
      return sampleSegmentsToDisplayText({
        prefix: [...adorn.prefix],
        core: getTableVal(col),
        suffix: [...adorn.suffix],
      })
    }

    const customIds = new Set()
    for (const b of listLayoutBoxes(layoutOverridesLocal, previewColumnsLocal)) {
      if (!previewColumnsLocal.includes(b.id)) customIds.add(b.id)
    }
    for (const key of Object.keys(columnLayoutStashLocal)) {
      if (!previewColumnsLocal.includes(key)) {
        const stashedId = columnLayoutStashLocal[key]?.boxId
        customIds.add(stashedId || key)
      }
    }

    const row = {}
    for (const col of previewColumnsLocal) {
      if (!isLayoutBoxActive(getColumnLayout(col, layoutOverridesLocal))) continue
      row[col] = getDisplayText(col)
    }
    for (const boxId of [...customIds].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
      const primary = getPrimaryColumnForBox(boxId, layoutOverridesLocal)
      if (!isLayoutBoxActive(getColumnLayout(primary, layoutOverridesLocal))) continue
      const display = getDisplayText(boxId)
      if (display.trim()) row[boxId] = display
    }
    return row
  }

  /** 后台为未激活选项卡预生成预览 DOM，首次切换时可走 fastRestore */
  function warmPresetTabPreviewDom(presetId) {
    if (!presetId || presetId === currentId) return Promise.resolve()
    if (!openTabIds.includes(presetId)) return Promise.resolve()
    if (presetTabPreviewDomCache.has(presetId)) return Promise.resolve()

    const existing = presetPreviewWarmTasks.get(presetId)
    if (existing) return existing

    const task = (async () => {
      try {
        let session = presetTabSessionCache.get(presetId)
        if (!session?.templateSvg) {
          session = await ensurePresetSessionLoaded(presetId)
        }
        if (!session?.templateSvg) return
        if (presetId === currentId || !openTabIds.includes(presetId)) return
        if (presetTabPreviewDomCache.has(presetId)) return
        if (session.draftDirty) return

        const t0 = performance.now()
        const fillOpts = {
          fontScale: session.fontScale ?? 1,
          layoutOverrides: session.layoutOverrides,
          showReferenceLayer: session.showReferenceLayer,
          showTemplateLayer: session.showTemplateLayer !== false,
          skipFontInject: false,
          fontCatalog,
          restrictToRowColumns: true,
          pageWidthMm: session.pageWidthMm,
          pageHeightMm: session.pageHeightMm,
          editorPreview: true,
          clipToArtboard: false,
        }
        const svgEl = await generateSvgFromRow(
          session.templateSvg,
          buildPreviewRowFromSession(session),
          fontUrl,
          fillOpts,
        )
        if (presetId === currentId || !openTabIds.includes(presetId)) return
        if (presetTabPreviewDomCache.has(presetId)) return

        const { stage } = wrapSvgInLayoutWorkspace(svgEl)
        presetTabPreviewDomCache.set(presetId, { stage, viewState: null })
        console.log(`${TAB_SWITCH_LOG} warmPreviewDom`, {
          presetId,
          ms: Number((performance.now() - t0).toFixed(1)),
        })
      } catch (err) {
        console.warn(`${TAB_SWITCH_LOG} warmPreviewDom failed`, presetId, err)
      } finally {
        presetPreviewWarmTasks.delete(presetId)
      }
    })()

    presetPreviewWarmTasks.set(presetId, task)
    return task
  }

  /** 切换选项卡时只更新高亮，避免整表 innerHTML 重建 */
  function updatePresetListHighlight() {
    if (!listEl || !presets.length) return
    listEl.querySelectorAll('.layout-preset-list-item').forEach((btn) => {
      const pid = Number(btn.dataset.id)
      const isOpen = openTabIds.includes(pid)
      const isActive = pid === currentId
      btn.classList.toggle('is-active', isActive)
      btn.classList.toggle('is-open', isOpen && !isActive)
      if (isActive) btn.setAttribute('aria-current', 'true')
      else btn.removeAttribute('aria-current')
      let dot = btn.querySelector('.layout-preset-list-open-dot')
      if (isOpen && !dot) {
        dot = document.createElement('span')
        dot.className = 'layout-preset-list-open-dot'
        dot.setAttribute('aria-hidden', 'true')
        btn.insertBefore(dot, btn.firstChild)
      } else if (!isOpen && dot) {
        dot.remove()
      }
      dot?.classList.toggle('layout-preset-list-open-dot--current', isActive)
    })
  }

  function syncPresetTabUi({ list = true, tabs = true } = {}) {
    if (tabs) renderPresetTabs()
    if (list) updatePresetListHighlight()
  }

  function snapshotPreviewDomForTab(presetId, trace) {
    if (!presetId || !presetLoadReady) return false
    const stage = previewArea?.querySelector('.preview-stage')
    if (!stage) return false
    presetTabPreviewDomCache.set(presetId, {
      stage,
      viewState: previewViewportInitialized ? previewViewport.getViewState() : null,
    })
    trace?.mark('snapshotPreviewDom', { presetId, reusedNode: true })
    return true
  }

  function capturePresetTabSession(presetId = currentId, trace) {
    if (!presetId) return
    const t0 = performance.now()
    if (presetId === currentId) {
      readPageNavColumnsFromUi()
      snapshotPreviewDomForTab(presetId, trace)
    }

    const existing = presetTabSessionCache.get(presetId)
    if (!draftDirty && existing?.templateSvg && presetLoadReady && presetId === currentId) {
      presetTabSessionCache.set(presetId, {
        ...existing,
        presetId,
        editorTitle: editorTitleEl?.value?.trim() || existing.editorTitle || '',
        svgTemplateId: getSelectedSvgTemplateId(),
        tableTemplateId: getSelectedTableTemplateId(),
        templateSvg,
        previewColumns: [...previewColumns],
        tableTemplateSampleRows: structuredClone(tableTemplateSampleRows),
        showLayoutBoxes,
        showReferenceLayer,
        showTemplateLayer,
        overlayShowBorder,
        overlayShowHandles,
        pageWidthMm,
        pageHeightMm,
        pageNavColumn,
        draftDirty: false,
      })
      trace?.mark('captureSession(light)', { ms: performance.now() - t0, presetId })
      return
    }

    presetTabSessionCache.set(presetId, {
      presetId,
      layoutOverrides: structuredClone(layoutOverrides),
      fontScale,
      sampleRow: structuredClone(sampleRow),
      sampleAdornments: structuredClone(sampleAdornments),
      columnLayoutStash: structuredClone(columnLayoutStash),
      tableTemplateSessionEntries: [...tableTemplateSessionCache.entries()].map(([k, v]) => [k, structuredClone(v)]),
      activeTableTemplateId,
      previewSamplePageIndex,
      sampleRowsTableTemplateId,
      showLayoutBoxes,
      showReferenceLayer,
      showTemplateLayer,
      overlayShowBorder,
      overlayShowHandles,
      pageWidthMm,
      pageHeightMm,
      pageNavColumn,
      draftDirty,
      svgTemplateId: getSelectedSvgTemplateId(),
      tableTemplateId: getSelectedTableTemplateId(),
      editorTitle: editorTitleEl?.value?.trim() || '',
      templateSvg,
      previewColumns: [...previewColumns],
      tableTemplateSampleRows: structuredClone(tableTemplateSampleRows),
    })
    trace?.mark('captureSession(full)', {
      ms: performance.now() - t0,
      presetId,
      draftDirty,
    })
  }

  function overlayPresetSampleRowInto(presetRow, layoutOverridesLocal, previewColumnsLocal, columnLayoutStashLocal = {}) {
    const sampleRowLocal = {}
    const sampleAdornmentsLocal = {}
    if (!presetRow || typeof presetRow !== 'object') {
      return { sampleRow: sampleRowLocal, sampleAdornments: sampleAdornmentsLocal }
    }
    const layoutBoxIds = new Set([
      ...listLayoutBoxIds(layoutOverridesLocal),
      ...Object.keys(columnLayoutStashLocal),
    ])
    const isSampleKey = (boxId) => {
      if (previewColumnsLocal.includes(boxId)) return true
      const col = getPrimaryColumnForBox(boxId, layoutOverridesLocal)
      return previewColumnsLocal.includes(col)
    }
    for (const [key, saved] of Object.entries(presetRow)) {
      if (key.startsWith(SAMPLE_ADORN_KEY_PREFIX)) {
        const boxId = key.slice(SAMPLE_ADORN_KEY_PREFIX.length)
        if (!isSampleKey(boxId)) continue
        try {
          const adorn = parseSampleAdornment(JSON.parse(String(saved)))
          if (adorn.prefix.length || adorn.suffix.length) {
            sampleAdornmentsLocal[boxId] = adorn
          }
        } catch {
          /* ignore invalid adornment */
        }
        continue
      }
      if (previewColumnsLocal.includes(key)) continue
      if (!layoutBoxIds.has(key) && !isCustomLayoutBox(key)) continue
      if (!hasMeaningfulSampleCell(saved)) continue
      sampleRowLocal[key] = saved
    }
    return { sampleRow: sampleRowLocal, sampleAdornments: sampleAdornmentsLocal }
  }

  async function buildPresetTabSessionFromPreset(preset) {
    const svgId = preset.svg_template_id ?? svgTemplates[0]?.id ?? null
    const tableId = preset.table_template_id ?? tableTemplates[0]?.id ?? null

    let templateSvgLocal = EMPTY_SVG_TEMPLATE
    if (svgId) {
      templateSvgLocal = await loadSvgTemplateContent(api, svgId, { fallback: EMPTY_SVG_TEMPLATE })
    }

    let previewColumnsLocal = []
    let tableTemplateSampleRowsLocal = []
    if (tableId) {
      const { template } = await api.getTableTemplate(tableId)
      previewColumnsLocal = (template.columns || []).map((c) => String(c).trim()).filter(Boolean)
      tableTemplateSampleRowsLocal = Array.isArray(template?.sample_rows)
        ? template.sample_rows.map((row) => structuredClone(row))
        : []
    }

    let layoutOverridesLocal = stripLayoutOverrideMeta(structuredClone(preset.layout_overrides || {}))
    layoutOverridesLocal = pruneLayoutOverridesForTable(layoutOverridesLocal, previewColumnsLocal)
    if (!isPedigreeStyleTable(previewColumnsLocal)) {
      layoutOverridesLocal[TABLE_TEMPLATE_SCOPE_KEY] = true
      layoutOverridesLocal[TABLE_TEMPLATE_COLUMNS_KEY] = [...previewColumnsLocal]
    } else {
      delete layoutOverridesLocal[TABLE_TEMPLATE_SCOPE_KEY]
      delete layoutOverridesLocal[TABLE_TEMPLATE_COLUMNS_KEY]
    }

    const { sampleRow: sampleRowLocal, sampleAdornments: sampleAdornmentsLocal } = overlayPresetSampleRowInto(
      preset.preview_sample_row || {},
      layoutOverridesLocal,
      previewColumnsLocal,
    )
    const toggles = layerTogglesFromPreset(preset)
    const pageSize = pageSizeFromPreset(preset)

    return {
      presetId: preset.id,
      layoutOverrides: layoutOverridesLocal,
      fontScale: preset.font_scale ?? 1,
      pageWidthMm: pageSize.pageWidthMm,
      pageHeightMm: pageSize.pageHeightMm,
      pageNavColumn: normalizePageNavColumnStorage(preset.page_nav_column),
      sampleRow: sampleRowLocal,
      sampleAdornments: sampleAdornmentsLocal,
      columnLayoutStash: {},
      tableTemplateSessionEntries: [],
      activeTableTemplateId: tableId,
      previewSamplePageIndex: 0,
      sampleRowsTableTemplateId: tableId,
      showLayoutBoxes: toggles.showLayoutBoxes,
      showReferenceLayer: toggles.showReferenceLayer,
      showTemplateLayer: toggles.showTemplateLayer,
      overlayShowBorder: true,
      overlayShowHandles: true,
      draftDirty: false,
      svgTemplateId: svgId,
      tableTemplateId: tableId,
      editorTitle: preset.name || '编辑布局',
      templateSvg: templateSvgLocal,
      previewColumns: previewColumnsLocal,
      tableTemplateSampleRows: tableTemplateSampleRowsLocal,
    }
  }

  async function fetchPresetTabSession(presetId) {
    const { preset } = await api.getPreset(presetId)
    if (!preset) return null
    return buildPresetTabSessionFromPreset(preset)
  }

  async function refreshSessionPageNavColumnFromApi(presetId, session) {
    if (!session || session.draftDirty) return session
    try {
      const { preset } = await api.getPreset(presetId)
      if (!preset) return session
      const col = normalizePageNavColumnStorage(preset.page_nav_column)
      const next = { ...session, pageNavColumn: col }
      const cached = presetTabSessionCache.get(presetId)
      if (cached && !cached.draftDirty) {
        presetTabSessionCache.set(presetId, { ...cached, pageNavColumn: col })
      }
      return next
    } catch {
      return session
    }
  }

  function ensurePresetSessionLoaded(presetId) {
    const cached = presetTabSessionCache.get(presetId)
    if (cached?.templateSvg != null) {
      return refreshSessionPageNavColumnFromApi(presetId, { ...cached, presetId })
    }

    let task = presetSessionLoadTasks.get(presetId)
    if (!task) {
      task = (async () => {
        try {
          const session = await fetchPresetTabSession(presetId)
          if (session && openTabIds.includes(presetId)) {
            const existing = presetTabSessionCache.get(presetId)
            if (existing?.draftDirty) {
              presetTabSessionCache.set(presetId, {
                ...session,
                ...existing,
                presetId,
                templateSvg: session.templateSvg,
                previewColumns: session.previewColumns,
                tableTemplateSampleRows: session.tableTemplateSampleRows,
              })
            } else {
              presetTabSessionCache.set(presetId, session)
            }
            if (presetId !== currentId) {
              void warmPresetTabPreviewDom(presetId)
            }
          }
          return session
        } finally {
          presetSessionLoadTasks.delete(presetId)
          loadingTabIds.delete(presetId)
          syncPresetTabUi()
        }
      })()
      presetSessionLoadTasks.set(presetId, task)
      loadingTabIds.add(presetId)
      renderPresetTabs()
    }
    return task
  }

  function canFastRestorePresetTab(presetId) {
    const session = presetTabSessionCache.get(presetId)
    if (session?.draftDirty) return false
    return presetTabPreviewDomCache.has(presetId)
      && session?.templateSvg != null
  }

  async function waitForPreviewRebuild() {
    if (!previewRebuildPromise) return
    try {
      await previewRebuildPromise
    } catch {
      // ignore — next restore will rebuild
    }
  }

  function restorePreviewFromDomCache(presetId, loadGen, restoreSelection = [], trace) {
    const cached = presetTabPreviewDomCache.get(presetId)
    if (!cached?.stage) return false
    if (loadGen !== loadContextGeneration || currentId !== presetId) return true

    trace?.mark('restorePreviewFromDomCache:start', { presetId, reusedNode: true })

    destroyLayoutEditor()
    ensureLayoutPanel()
    layoutPanel.setOverrides(layoutOverrides)

    previewViewport.setContent(cached.stage)
    trace?.mark('restorePreviewFromDomCache:domAttached')

    if (cached.viewState) {
      previewViewportInitialized = true
      requestAnimationFrame(() => {
        if (loadGen === loadContextGeneration && currentId === presetId) {
          previewViewport.setViewState(cached.viewState)
        }
      })
    } else {
      previewViewportInitialized = false
      previewViewport.scheduleFitView()
      previewViewportInitialized = true
    }

    initLayoutHistory(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    updateLayoutHistoryBaseline(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    presetLoadReady = true

    renderColumnPicker()
    attachLayoutEditor(restoreSelection)
    trace?.mark('restorePreviewFromDomCache:editorAttached')

    setPreviewLoading(false)
    trace?.mark('restorePreviewFromDomCache:done')
    return true
  }

  async function applyPresetTabSession(session, loadGen, trace) {
    const presetId = session.presetId ?? currentId
    if (loadGen !== loadContextGeneration || currentId !== presetId) return false

    const fastRestore = canFastRestorePresetTab(presetId)
    trace?.mark('applySession:start', { presetId, fastRestore })
    if (session.draftDirty) presetTabPreviewDomCache.delete(presetId)
    presetLoading = true
    syncEditorIdleState()
    ++previewGeneration
    if (!fastRestore) {
      destroyLayoutEditor()
      previewViewportInitialized = false
      setPreviewLoading(true, session.editorTitle || '')
    } else {
      setPreviewLoading(false)
    }

    const cloneT0 = performance.now()
    if (fastRestore && !session.draftDirty) {
      layoutOverrides = session.layoutOverrides
      fontScale = session.fontScale ?? 1
      pageWidthMm = session.pageWidthMm ?? DEFAULT_PAGE_WIDTH_MM
      pageHeightMm = session.pageHeightMm ?? DEFAULT_PAGE_HEIGHT_MM
      sampleRow = session.sampleRow || {}
      sampleAdornments = session.sampleAdornments || {}
      columnLayoutStash = session.columnLayoutStash || {}
      tableTemplateSessionCache = new Map(session.tableTemplateSessionEntries || [])
    } else {
      layoutOverrides = structuredClone(session.layoutOverrides)
      fontScale = session.fontScale ?? 1
      pageWidthMm = session.pageWidthMm ?? DEFAULT_PAGE_WIDTH_MM
      pageHeightMm = session.pageHeightMm ?? DEFAULT_PAGE_HEIGHT_MM
      sampleRow = structuredClone(session.sampleRow || {})
      sampleAdornments = structuredClone(session.sampleAdornments || {})
      columnLayoutStash = structuredClone(session.columnLayoutStash || {})
      tableTemplateSessionCache = new Map(
        (session.tableTemplateSessionEntries || []).map(([k, v]) => [k, structuredClone(v)]),
      )
    }
    activeTableTemplateId = session.activeTableTemplateId ?? null
    previewSamplePageIndex = session.previewSamplePageIndex ?? 0
    sampleRowsTableTemplateId = session.sampleRowsTableTemplateId ?? null
    overlayShowBorder = session.overlayShowBorder ?? true
    overlayShowHandles = session.overlayShowHandles ?? true
    draftDirty = !!session.draftDirty

    applyLayerToggles({
      showLayoutBoxes: session.showLayoutBoxes,
      showReferenceLayer: session.showReferenceLayer,
      showTemplateLayer: session.showTemplateLayer !== false,
    }, { persistBrowser: false })
    if (overlayBorderEl) overlayBorderEl.checked = overlayShowBorder
    if (overlayHandlesEl) overlayHandlesEl.checked = overlayShowHandles
    if (editorTitleEl) editorTitleEl.value = session.editorTitle || '编辑布局'
    pageNavColumn = normalizePageNavColumnStorage(session.pageNavColumn)
    syncPageNavColumnCheckboxes()
    syncPageSizeInputs()
    previewViewport.setPageAspectRatio(pageWidthMm, pageHeightMm)
    syncTemplateBgLockUi()

    populateTemplateSelects()
    if (svgSelectEl && session.svgTemplateId) svgSelectEl.value = String(session.svgTemplateId)
    if (tableSelectEl && session.tableTemplateId) tableSelectEl.value = String(session.tableTemplateId)
    const presetRow = presets.find((p) => p.id === presetId)
    currentPresetGroupId = presetRow?.group_id != null ? Number(presetRow.group_id) : null
    renderPresetGroupField(currentPresetGroupId)

    if (session.templateSvg) {
      templateSvg = session.templateSvg
    }
    if (session.previewColumns) {
      previewColumns = [...session.previewColumns]
      tableTemplateSampleRows = structuredClone(session.tableTemplateSampleRows || [])
      sampleRowsTableTemplateId = session.sampleRowsTableTemplateId ?? session.tableTemplateId ?? null
      previewSamplePageIndex = session.previewSamplePageIndex ?? 0
      clampPreviewSamplePageIndex()
      updateSamplePagePaginationUi()
    }

    try {
      if (!session.templateSvg && session.svgTemplateId) {
        const t0 = performance.now()
        await loadSvgTemplate(session.svgTemplateId)
        trace?.mark('applySession:loadSvgTemplate', { ms: performance.now() - t0 })
        if (loadGen !== loadContextGeneration || currentId !== presetId) return false
      } else if (!session.svgTemplateId) {
        templateSvg = EMPTY_SVG_TEMPLATE
      }

      if (!session.previewColumns && session.tableTemplateId) {
        const t0 = performance.now()
        await loadTableTemplateColumns(session.tableTemplateId)
        trace?.mark('applySession:loadTableTemplateColumns', { ms: performance.now() - t0 })
        if (loadGen !== loadContextGeneration || currentId !== presetId) return false
      } else if (!session.tableTemplateId && !session.previewColumns?.length) {
        previewColumns = []
        tableTemplateSampleRows = []
        sampleRowsTableTemplateId = null
        previewSamplePageIndex = 0
        updateSamplePagePaginationUi()
      }

      activeTableTemplateId = session.tableTemplateId ?? session.activeTableTemplateId
      finalizeLayoutForCurrentTable()
      if (session.tableTemplateId) captureTableTemplateSessionState(session.tableTemplateId)

      pageNavColumn = normalizePageNavColumnStorage(session.pageNavColumn)
      syncPageNavColumnCheckboxes()
      trace?.mark('applySession:stateRestored', { cloneMs: performance.now() - cloneT0, fastRestore })

      if (!session.draftDirty && restorePreviewFromDomCache(presetId, loadGen, [], trace)) {
        if (loadGen !== loadContextGeneration || currentId !== presetId) return false
        trace?.mark('applySession:fastPathComplete')
        setStatus('')
        return true
      }

      initLayoutHistory(layoutOverrides, LAYOUT_HISTORY_PRESETS)
      updateLayoutHistoryBaseline(layoutOverrides, LAYOUT_HISTORY_PRESETS)
      presetLoadReady = true
      renderColumnPicker()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      if (loadGen !== loadContextGeneration || currentId !== presetId) return false
      const rebuildT0 = performance.now()
      await rebuildPreview([])
      trace?.mark('applySession:rebuildPreview', { ms: performance.now() - rebuildT0 })
      if (loadGen !== loadContextGeneration || currentId !== presetId) return false

      snapshotPreviewDomForTab(presetId, trace)
      setPreviewLoading(false)
      setStatus('')
      return true
    } catch (err) {
      if (loadGen === loadContextGeneration && currentId === presetId) {
        setPreviewLoading(false)
        setStatus(err.message || '加载失败', true)
      }
      return false
    } finally {
      if (loadGen === loadContextGeneration && currentId === presetId) {
        presetLoading = false
        syncEditorIdleState()
      }
    }
  }

  async function restorePresetTabSession(cached) {
    const loadGen = ++loadContextGeneration
    await applyPresetTabSession({ ...cached, presetId: currentId }, loadGen)
  }

  function renderPresetTabs() {
    if (!tabsEl) return
    tabsEl.innerHTML = openTabIds.map((id) => {
      const row = presets.find((p) => p.id === id)
      const name = row?.name || `布局 ${id}`
      const isActive = id === currentId
      const isDirty = isActive ? draftDirty : presetTabSessionCache.get(id)?.draftDirty
      const isLoading = loadingTabIds.has(id) || (isActive && !presetLoadReady)
      return (
        `<div class="layout-preset-tab${isActive ? ' is-active' : ''}${isLoading ? ' is-loading' : ''}" role="presentation">`
        + `<button type="button" class="layout-preset-tab-btn" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-tab-id="${id}" title="${escapeHtml(name)}">`
        + `${isLoading ? '<span class="layout-preset-tab-spinner" aria-hidden="true"></span>' : ''}`
        + `<span class="layout-preset-tab-name">${escapeHtml(name)}</span>`
        + `${isDirty ? '<span class="layout-preset-tab-dirty" title="未保存">•</span>' : ''}`
        + `</button>`
        + `<button type="button" class="layout-preset-tab-close" data-close-tab="${id}" aria-label="关闭选项卡" title="关闭">×</button>`
        + `</div>`
      )
    }).join('')

    syncEditorVisibility()
  }

  function dedupePresets(list) {
    const seen = new Set()
    const out = []
    for (const p of list) {
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }

  function applyPresetOrder(ids) {
    const uniqueIds = [...new Set(ids)]
    const map = new Map(presets.map((p) => [p.id, p]))
    presets = uniqueIds.map((id) => map.get(id)).filter(Boolean)
    for (const p of map.values()) {
      if (!uniqueIds.includes(p.id)) presets.push(p)
    }
  }

  function getPresetListRowEls() {
    return [...listEl.querySelectorAll('.layout-preset-list-row[data-preset-id]')]
  }

  function readPresetListOrderFromDom() {
    const ids = []
    const seen = new Set()
    let hasDuplicateRows = false
    for (const el of getPresetListRowEls()) {
      const id = Number(el.dataset.presetId)
      if (!Number.isFinite(id) || id <= 0) continue
      if (seen.has(id)) {
        hasDuplicateRows = true
        continue
      }
      seen.add(id)
      ids.push(id)
    }
    return { ids, hasDuplicateRows }
  }

  function cancelPresetListReorderSession() {
    if (!presetListReorderCleanup) return
    const cleanup = presetListReorderCleanup
    presetListReorderCleanup = null
    cleanup({ reinsertRow: false })
  }

  async function persistPresetListOrder() {
    const { ids, hasDuplicateRows } = readPresetListOrderFromDom()
    if (hasDuplicateRows || ids.length !== presets.length || new Set(ids).size !== ids.length) {
      renderPresetList()
      return
    }

    const prevOrder = presets.map((p) => p.id)
    if (ids.every((id, i) => id === prevOrder[i])) return

    applyPresetOrder(ids)
    try {
      await api.reorderPresets(ids)
    } catch (err) {
      applyPresetOrder(prevOrder)
      renderPresetList()
      setStatus(err.message || '保存顺序失败', true)
    }
  }

  function mountPresetListReorder() {
    if (!listEl || listEl.dataset.presetListReorderMounted === '1') return
    listEl.dataset.presetListReorderMounted = '1'

    listEl.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.layout-preset-list-drag')
      if (!grip) return
      const row = grip.closest('.layout-preset-list-row')
      if (!row || !listEl.contains(row)) return
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()

      const pointerId = e.pointerId
      try {
        grip.setPointerCapture(pointerId)
      } catch { /* ignore */ }

      let moved = false
      let finished = false
      let rafId = 0
      let pendingY = e.clientY
      let lastPlaceholderBefore = null

      cancelPresetListReorderSession()

      const startRect = row.getBoundingClientRect()
      const offsetY = e.clientY - startRect.top

      const placeholder = document.createElement('li')
      placeholder.className = 'layout-preset-list-row layout-preset-list-reorder-placeholder'
      placeholder.dataset.reorderPlaceholder = '1'
      placeholder.style.height = `${Math.round(startRect.height)}px`
      listEl.insertBefore(placeholder, row)

      const restoreStyles = {
        position: row.style.position,
        top: row.style.top,
        left: row.style.left,
        width: row.style.width,
        zIndex: row.style.zIndex,
        margin: row.style.margin,
        pointerEvents: row.style.pointerEvents,
      }

      row.classList.add('is-reorder-dragging')
      document.body.classList.add('layout-collapsible-reorder-active')
      row.style.position = 'fixed'
      row.style.left = `${startRect.left}px`
      row.style.top = `${startRect.top}px`
      row.style.width = `${startRect.width}px`
      row.style.zIndex = '50'
      row.style.margin = '0'
      row.style.pointerEvents = 'none'

      function cleanupDrag({ reinsertRow = true } = {}) {
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', finish, true)
        document.removeEventListener('pointercancel', finish, true)

        if (listEl.contains(placeholder)) {
          if (reinsertRow && listEl.contains(row)) {
            listEl.insertBefore(row, placeholder)
          }
          placeholder.remove()
        }

        row.classList.remove('is-reorder-dragging')
        document.body.classList.remove('layout-collapsible-reorder-active')
        row.style.position = restoreStyles.position
        row.style.top = restoreStyles.top
        row.style.left = restoreStyles.left
        row.style.width = restoreStyles.width
        row.style.zIndex = restoreStyles.zIndex
        row.style.margin = restoreStyles.margin
        row.style.pointerEvents = restoreStyles.pointerEvents
      }

      presetListReorderCleanup = cleanupDrag

      function getSiblingRows() {
        return getPresetListRowEls().filter((el) => el !== row)
      }

      function movePlaceholder(clientY) {
        const items = getSiblingRows()
        let beforeEl = null

        for (const sib of items) {
          const sibRect = sib.getBoundingClientRect()
          if (sibRect.height <= 0) continue
          const mid = sibRect.top + sibRect.height / 2
          if (clientY < mid) {
            beforeEl = sib
            break
          }
        }

        const key = beforeEl ? String(beforeEl.dataset.presetId) : '__end__'
        if (key === lastPlaceholderBefore) return
        lastPlaceholderBefore = key

        if (beforeEl) {
          listEl.insertBefore(placeholder, beforeEl)
        } else {
          listEl.appendChild(placeholder)
        }
      }

      function applyDragFrame(clientY) {
        row.style.top = `${clientY - offsetY}px`
        row.style.left = `${startRect.left}px`
        movePlaceholder(clientY)
      }

      function onMove(ev) {
        if (finished || ev.pointerId !== pointerId) return
        ev.preventDefault()
        moved = true
        pendingY = ev.clientY
        if (rafId) return
        rafId = requestAnimationFrame(() => {
          rafId = 0
          applyDragFrame(pendingY)
        })
      }

      function finish(ev) {
        if (finished) return
        if (ev && ev.pointerId !== pointerId) return
        finished = true
        presetListReorderCleanup = null

        try {
          grip.releasePointerCapture(pointerId)
        } catch { /* ignore */ }

        const canReinsert = listEl.contains(row)
        cleanupDrag({ reinsertRow: canReinsert })

        if (moved && canReinsert) void persistPresetListOrder()
      }

      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', finish, true)
      document.addEventListener('pointercancel', finish, true)
    })
  }

  function renderPresetGroupField(groupId) {
    const slot = container.querySelector('#layout-preset-group-slot')
    if (!slot) return
    if (!currentId || !shouldShowGroupUi(options.user, accessGroups)) {
      slot.innerHTML = ''
      return
    }
    const selectedId = groupId != null ? Number(groupId) : (currentPresetGroupId ?? null)
    slot.innerHTML = groupSelectFieldHtml({
      selectId: 'layout-preset-edit-group',
      groups: accessGroups,
      user: options.user,
      selectedId,
      compact: true,
    })
    const groupSelectEl = slot.querySelector('#layout-preset-edit-group')
    if (groupSelectEl) {
      groupSelectEl.disabled = !(isEditorActive() && presetLoadReady && !presetLoading)
    }
  }

  function bindPresetGroupSelectOnce() {
    if (bindPresetGroupSelectOnce.bound) return
    bindPresetGroupSelectOnce.bound = true
    container.addEventListener('change', (e) => {
      const sel = e.target
      if (sel instanceof HTMLSelectElement && sel.id === 'layout-preset-edit-group') {
        void onPresetGroupSelectChange(e)
      }
    })
  }

  async function onPresetGroupSelectChange(e) {
    const sel = e.target
    if (!(sel instanceof HTMLSelectElement) || sel.id !== 'layout-preset-edit-group') return
    if (!currentId || groupSaving) return
    const groupId = Number(sel.value)
    if (!Number.isFinite(groupId) || groupId <= 0) return
    const knownGroupId = currentPresetGroupId ?? presets.find((p) => p.id === currentId)?.group_id
    if (Number(knownGroupId) === groupId) return
    await persistPresetGroup(groupId)
  }

  async function persistPresetGroup(groupId) {
    if (!currentId || groupSaving) return false
    groupSaving = true
    try {
      const res = await api.updatePresetGroup(currentId, groupId)
      const savedGroupId = res.group_id != null
        ? Number(res.group_id)
        : (res.preset?.group_id != null ? Number(res.preset.group_id) : null)
      if (savedGroupId == null || Number(savedGroupId) !== Number(groupId)) {
        throw new Error('所属组未写入数据库。请 Ctrl+C 后执行 npm run dev:local 重启后端')
      }
      currentPresetGroupId = savedGroupId
      patchPresetCache(currentId, { group_id: savedGroupId })
      renderPresetList()
      renderPresetGroupField(savedGroupId)
      setStatus('所属组已更新')
      options.onChange?.()
      return true
    } catch (err) {
      setStatus(err.message || '更新所属组失败', true)
      renderPresetGroupField(currentPresetGroupId ?? presets.find((p) => p.id === currentId)?.group_id ?? null)
      return false
    } finally {
      groupSaving = false
    }
  }

  function renderPresetList() {
    cancelPresetListReorderSession()
    presets = dedupePresets(presets)

    if (!presets.length) {
      listEl.innerHTML = '<li class="templates-empty-item">暂无布局预设，请点击「新建」</li>'
      return
    }

    listEl.innerHTML = presets.map((p) => {
      const isOpen = openTabIds.includes(p.id)
      const isActive = p.id === currentId
      const isChecked = checkedPresetIds.has(p.id)
      return (
        `<li class="layout-preset-list-row" data-preset-id="${p.id}">`
        + `<span class="layout-preset-list-drag" role="button" tabindex="-1" title="拖拽排序" aria-label="拖拽排序 ${escapeHtml(p.name)}">⠿</span>`
        + `<label class="layout-preset-list-check" title="勾选以复制">`
        + `<input type="checkbox" class="layout-preset-list-checkbox" data-check-id="${p.id}"${isChecked ? ' checked' : ''} aria-label="选择 ${escapeHtml(p.name)}" />`
        + `</label>`
        + `<button type="button" class="layout-preset-list-item${isActive ? ' is-active' : ''}${isOpen && !isActive ? ' is-open' : ''}" data-id="${p.id}"${isActive ? ' aria-current="true"' : ''}>`
        + `${isOpen ? `<span class="layout-preset-list-open-dot${isActive ? ' layout-preset-list-open-dot--current' : ''}" aria-hidden="true"></span>` : ''}`
        + `<span class="layout-preset-list-name">${escapeHtml(p.name)}</span>`
        + `${groupBadgeHtml(p.group_id, accessGroups)}`
        + `${p.is_default ? '<span class="layout-preset-list-badge">默认</span>' : ''}`
        + `</button>`
        + `</li>`
      )
    }).join('')
  }

  function bindPresetPanelEvents() {
    mountPresetListReorder()
    tabsEl?.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-tab]')
      if (closeBtn) {
        e.stopPropagation()
        void closePresetTab(Number(closeBtn.dataset.closeTab))
        return
      }
      const tabBtn = e.target.closest('[data-tab-id]')
      if (tabBtn) {
        void switchPresetTab(Number(tabBtn.dataset.tabId))
      }
    })

    listEl?.addEventListener('change', (e) => {
      const input = e.target.closest('.layout-preset-list-checkbox')
      if (!input) return
      const id = Number(input.dataset.checkId)
      if (input.checked) checkedPresetIds.add(id)
      else checkedPresetIds.delete(id)
      syncSidebarActions()
    })

    listEl?.addEventListener('click', (e) => {
      if (e.target.closest('.layout-preset-list-drag')) return
      if (e.target.closest('.layout-preset-list-check')) return
      const item = e.target.closest('.layout-preset-list-item')
      if (item) {
        void openPresetFromList(Number(item.dataset.id))
      }
    })
  }

  async function switchPresetTab(id) {
    if (!presets.some((p) => p.id === id)) return
    if (!openTabIds.includes(id)) return
    if (id === currentId && presetLoadReady) {
      syncPresetTabUi()
      return
    }

    const row = presets.find((p) => p.id === id)
    const prevId = currentId
    const pathBefore = explainTabSwitchPath(id)
    const canFastRestore = canFastRestorePresetTab(id)
    const trace = createTabSwitchTrace('switchPresetTab', {
      from: prevId,
      to: id,
      path: pathBefore,
      fastRestore: canFastRestore,
    })

    if (prevId != null && prevId !== id) {
      await waitForPreviewRebuild()
      capturePresetTabSession(prevId, trace)
    }

    const loadGen = ++loadContextGeneration
    currentId = id
    presetLoadReady = false
    trace.mark('uiImmediate')

    const cachedTitle = presetTabSessionCache.get(id)?.editorTitle
    if (editorTitleEl) {
      editorTitleEl.value = cachedTitle || row?.name || '编辑布局'
    }
    syncEditorVisibility()
    syncPresetTabUi()

    const willFastRestore = canFastRestorePresetTab(id)
    setPreviewLoading(!willFastRestore, row?.name || '')

    try {
      if (!canFastRestorePresetTab(id) && presetTabSessionCache.get(id)?.templateSvg) {
        const warmT0 = performance.now()
        await warmPresetTabPreviewDom(id)
        trace.mark('warmPreviewDom', {
          ms: performance.now() - warmT0,
          nowFast: canFastRestorePresetTab(id),
        })
      } else if (!canFastRestorePresetTab(id)) {
        const warm = presetPreviewWarmTasks.get(id)
        if (warm) {
          const warmT0 = performance.now()
          await warm
          trace.mark('awaitWarmPreview', {
            ms: performance.now() - warmT0,
            nowFast: canFastRestorePresetTab(id),
          })
        }
      }

      let session = presetTabSessionCache.get(id)
      if (!session?.templateSvg) {
        const loadT0 = performance.now()
        session = await ensurePresetSessionLoaded(id)
        trace.mark('ensurePresetSessionLoaded', { ms: performance.now() - loadT0 })
      }
      if (!openTabIds.includes(id)) {
        trace.cancel('tabClosed')
        return
      }
      if (loadGen !== loadContextGeneration || currentId !== id) {
        trace.cancel('superseded', { loadGen, currentId })
        return
      }
      if (session) {
        await applyPresetTabSession({ ...session, presetId: id }, loadGen, trace)
      } else {
        setStatus('加载布局失败', true)
        setPreviewLoading(false)
        trace.end({ failed: true })
        return
      }
    } catch (err) {
      if (loadGen === loadContextGeneration && currentId === id) {
        setStatus(err.message || '加载失败', true)
        setPreviewLoading(false)
      }
      trace.end({ error: err.message })
      return
    } finally {
      if (loadGen === loadContextGeneration && currentId === id) {
        syncEditorIdleState()
        syncPresetTabUi()
        prefetchOpenPresetSessions(id)
      }
    }
    trace.end({
      path: explainTabSwitchPath(id),
      fastRestore: canFastRestorePresetTab(id),
      slowReason: canFastRestorePresetTab(id) ? null : explainTabSwitchPath(id),
    })
  }

  async function syncPresetsFromApi() {
    const res = await api.listPresets()
    presets = dedupePresets(res.presets || [])

    if (!presets.length) {
      listEl.innerHTML = '<li class="templates-empty-item">暂无布局预设，请点击「新建」</li>'
      checkedPresetIds.clear()
      openTabIds = []
      presetTabSessionCache.clear()
      presetTabPreviewDomCache.clear()
      currentId = null
      syncEditorVisibility()
      renderPresetTabs()
      return false
    }

    openTabIds = openTabIds.filter((id) => presets.some((p) => p.id === id))
    if (currentId != null && !openTabIds.includes(currentId)) {
      currentId = null
      presetLoadReady = false
      destroyLayoutEditor()
    }
    pruneCheckedPresetIds()
    for (const key of [...presetTabSessionCache.keys()]) {
      if (!presets.some((p) => p.id === key)) {
        presetTabSessionCache.delete(key)
        presetTabPreviewDomCache.delete(key)
      }
    }
    renderPresetList()
    renderPresetTabs()
    syncEditorVisibility()
    return true
  }

  function scrollPresetTabIntoView(id) {
    requestAnimationFrame(() => {
      tabsEl?.querySelector(`[data-tab-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    })
  }

  async function openPresetFromList(id) {
    if (!presets.some((p) => p.id === id)) return

    if (openTabIds.includes(id)) {
      await switchPresetTab(id)
      return
    }

    if (currentId != null) {
      capturePresetTabSession(currentId)
    }
    openTabIds.push(id)
    syncPresetTabUi()
    scrollPresetTabIntoView(id)
    void ensurePresetSessionLoaded(id).then(() => warmPresetTabPreviewDom(id))
    await switchPresetTab(id)
  }

  async function openPresetTab(id) {
    return openPresetFromList(id)
  }

  async function closePresetTab(id) {
    if (!openTabIds.includes(id)) return

    const isLoading = loadingTabIds.has(id) || (id === currentId && !presetLoadReady)
    const cached = id === currentId ? null : presetTabSessionCache.get(id)
    const isDirty = !isLoading && (id === currentId ? draftDirty : !!cached?.draftDirty)
    if (isDirty && !window.confirm('该选项卡有未保存修改，关闭将丢失，确定？')) return

    if (id === currentId && presetLoadReady) capturePresetTabSession(id)
    presetTabSessionCache.delete(id)
    presetTabPreviewDomCache.delete(id)
    presetPreviewWarmTasks.delete(id)
    openTabIds = openTabIds.filter((tabId) => tabId !== id)
    loadingTabIds.delete(id)

    if (currentId === id) {
      ++loadContextGeneration
      setPreviewLoading(false)
      const nextId = openTabIds[openTabIds.length - 1] ?? null
      currentId = null
      presetLoadReady = false
      destroyLayoutEditor()
      if (nextId) {
        await switchPresetTab(nextId)
      } else {
        resetPresetEditorSession()
        syncEditorVisibility()
        syncPresetTabUi()
      }
      return
    }

    syncPresetTabUi()
  }

  function getSelectedSvgTemplateId() {
    const id = Number(svgSelectEl?.value)
    return Number.isFinite(id) && id > 0 ? id : null
  }

  function getSelectedTableTemplateId() {
    const id = Number(tableSelectEl?.value)
    return Number.isFinite(id) && id > 0 ? id : null
  }

  function verifyPresetTemplateRefsSaved(preset) {
    if (!preset) return false
    return preset.svg_template_id === getSelectedSvgTemplateId()
      && preset.table_template_id === getSelectedTableTemplateId()
  }

  function patchPresetCache(id, patch) {
    const row = presets.find((p) => p.id === id)
    if (row) Object.assign(row, patch)
  }

  async function ensureApiReady() {
    const meta = await api.meta()
    if (!meta.features?.includes('layout_preset_template_refs')) {
      throw new Error('后端 API 过旧，布局预设无法保存 SVG/表格模板选择。请 Ctrl+C 后重新运行 npm run dev:local')
    }
    if (!meta.features?.includes('layout_preset_page_nav_column')) {
      throw new Error('后端 API 过旧，页码栏显示列无法保存。请 Ctrl+C 后重新运行 npm run dev:local')
    }
    if (!meta.features?.includes('layout_preset_group')) {
      throw new Error('后端 API 过旧，布局模板所属组无法保存。请 Ctrl+C 后执行 npm run dev:local')
    }
    return meta
  }

  let templateRefsSaving = false
  let pageNavColumnSaving = false

  function patchPresetTabSession(presetId, patch) {
    const cached = presetTabSessionCache.get(presetId)
    if (cached) presetTabSessionCache.set(presetId, { ...cached, ...patch })
  }

  async function persistPageNavColumn({ quiet = false } = {}) {
    if (!currentId || pageNavColumnSaving) return false
    pageNavColumnSaving = true
    const col = readPageNavColumnsFromUi()
    try {
      const res = await api.updatePreset(currentId, {
        page_nav_column: col,
        record_revision: false,
      })
      if (!verifyPageNavColumnSaved(res.preset, col)) {
        const msg = res.preset?.page_nav_column === undefined
          ? '页码栏显示列未写入数据库。请 Ctrl+C 后重新运行 npm run dev:local'
          : '页码栏显示列保存失败，请重试'
        if (!quiet) setStatus(msg, true)
        return false
      }
      const saved = normalizePageNavColumnStorage(res.preset.page_nav_column)
      pageNavColumn = saved
      syncPageNavColumnCheckboxes()
      patchPresetCache(currentId, { page_nav_column: saved })
      patchPresetTabSession(currentId, { pageNavColumn: saved })
      if (!quiet) setStatus('页码栏显示列已保存')
      return true
    } catch (err) {
      if (!quiet) setStatus(err.message || '页码栏显示列保存失败', true)
      return false
    } finally {
      pageNavColumnSaving = false
    }
  }

  async function persistPresetTemplateRefs({ quiet = false } = {}) {
    if (!currentId || templateRefsSaving) return false
    templateRefsSaving = true
    const svgId = getSelectedSvgTemplateId()
    const tableId = getSelectedTableTemplateId()
    try {
      const res = await api.updatePreset(currentId, {
        svg_template_id: svgId,
        table_template_id: tableId,
        record_revision: false,
      })
      if (res.preset && !verifyPresetTemplateRefsSaved(res.preset)) {
        if (!quiet) {
          setStatus('模板选择未写入数据库。请停止 dev 后重新运行 npm run dev:local', true)
        }
        return false
      }
      patchPresetCache(currentId, { svg_template_id: svgId, table_template_id: tableId })
      if (!quiet) setStatus('模板选择已保存')
      return true
    } catch (err) {
      if (!quiet) setStatus(err.message || '保存模板选择失败', true)
      return false
    } finally {
      templateRefsSaving = false
    }
  }

  function getSamplePageCount() {
    if (tableTemplateSampleRows.length > 0) return tableTemplateSampleRows.length
    return previewColumns.length > 0 ? 1 : 0
  }

  function getActiveTableSampleRow() {
    if (!tableTemplateSampleRows.length) return {}
    const idx = Math.max(0, Math.min(previewSamplePageIndex, tableTemplateSampleRows.length - 1))
    return tableTemplateSampleRows[idx] || {}
  }

  function clampPreviewSamplePageIndex() {
    const count = getSamplePageCount()
    if (count <= 0) {
      previewSamplePageIndex = 0
      return
    }
    previewSamplePageIndex = Math.max(0, Math.min(previewSamplePageIndex, count - 1))
  }

  function updateSamplePagePaginationUi() {
    const count = getSamplePageCount()
    const hasTable = previewColumns.length > 0 && getSelectedTableTemplateId()
    if (samplePaginationEl) samplePaginationEl.hidden = !hasTable
    if (!hasTable || count <= 0) {
      if (sampleIndexEl) sampleIndexEl.textContent = '- / -'
      if (samplePrevBtn) samplePrevBtn.disabled = true
      if (sampleNextBtn) sampleNextBtn.disabled = true
      return
    }
    clampPreviewSamplePageIndex()
    if (sampleIndexEl) sampleIndexEl.textContent = `${previewSamplePageIndex + 1} / ${count}`
    if (samplePrevBtn) samplePrevBtn.disabled = previewSamplePageIndex <= 0
    if (sampleNextBtn) sampleNextBtn.disabled = previewSamplePageIndex >= count - 1
  }

  function goToSamplePage(nextIndex) {
    const count = getSamplePageCount()
    if (count <= 0) return
    const idx = Math.max(0, Math.min(nextIndex, count - 1))
    if (idx === previewSamplePageIndex) return
    previewSamplePageIndex = idx
    updateSamplePagePaginationUi()
    const selection = layoutEditor?.getSelectedColumns?.() ?? layoutPanel?.getSelectedColumns?.() ?? []
    if (!refreshPreviewLayout(selection)) {
      void rebuildPreview(selection)
    }
  }

  function getTableColumnPreviewValue(col) {
    const fromTable = getActiveTableSampleRow()[col]
    if (fromTable != null && String(fromTable).trim() !== '') return fromTable
    return col
  }

  /** 从 sampleRow 中移除表格列键（表格列内容始终取自表格模板示例行） */
  function applyTableTemplateScopeToOverrides() {
    if (!isPedigreeStyleTable(previewColumns)) {
      layoutOverrides[TABLE_TEMPLATE_SCOPE_KEY] = true
      layoutOverrides[TABLE_TEMPLATE_COLUMNS_KEY] = [...previewColumns]
    } else {
      delete layoutOverrides[TABLE_TEMPLATE_SCOPE_KEY]
      delete layoutOverrides[TABLE_TEMPLATE_COLUMNS_KEY]
    }
  }

  function layoutOverridesForSave() {
    return pruneLayoutOverridesForTable(layoutOverrides, previewColumns)
  }

  function prunePresetAuxForTable(columns = previewColumns) {
    const colSet = new Set(columns)
    for (const key of Object.keys(columnLayoutStash)) {
      if (!colSet.has(key) && !colSet.has(getPrimaryColumnForBox(key, layoutOverrides))) {
        delete columnLayoutStash[key]
      }
    }
    for (const key of Object.keys(sampleAdornments)) {
      const col = getPrimaryColumnForBox(key, layoutOverrides)
      if (!colSet.has(col) && !colSet.has(key)) {
        delete sampleAdornments[key]
      }
    }
  }

  function applyRenamedTableColumns(prevCols, nextCols) {
    const renames = computeColumnRenames(prevCols, nextCols)
    if (!renames.length) return false

    layoutOverrides = applyColumnRenamesToLayoutOverrides(layoutOverrides, renames, nextCols)
    sampleRow = applyColumnRenamesToPreviewSampleRow(sampleRow, renames)
    sampleAdornments = applyColumnRenamesToRecordKeys(sampleAdornments, renames)

    for (const { from, to } of renames) {
      const boxFrom = resolveBoxId(from, layoutOverrides)
      if (columnLayoutStash[from]) {
        columnLayoutStash[to] = columnLayoutStash[from]
        delete columnLayoutStash[from]
      }
      if (boxFrom !== from && columnLayoutStash[boxFrom]) {
        const boxTo = resolveBoxId(to, layoutOverrides)
        columnLayoutStash[boxTo] = columnLayoutStash[boxFrom]
        delete columnLayoutStash[boxFrom]
      }
      if (sampleAdornments[from]) {
        sampleAdornments[to] = sampleAdornments[from]
        delete sampleAdornments[from]
      }
      if (boxFrom !== from && sampleAdornments[boxFrom]) {
        const boxTo = resolveBoxId(to, layoutOverrides)
        sampleAdornments[boxTo] = sampleAdornments[boxFrom]
        delete sampleAdornments[boxFrom]
      }
    }

    pageNavColumn = applyColumnRenamesToPageNavColumn(pageNavColumn, renames)
    syncPageNavColumnCheckboxes()
    commitLayoutOverrides(layoutOverrides, {
      reason: '表格列标题已变更',
      previewMode: 'full',
    })
    return true
  }

  function pruneDroppedTableColumns(prevCols, nextCols) {
    const nextSet = new Set(nextCols)
    const dropped = prevCols.filter((c) => !nextSet.has(c))
    if (!dropped.length) return
    let next = layoutOverrides
    for (const col of dropped) {
      const boxId = resolveBoxId(col, next)
      delete columnLayoutStash[col]
      delete columnLayoutStash[boxId]
      delete sampleAdornments[col]
      delete sampleAdornments[boxId]
      delete sampleRow[col]
      next = deleteLayoutBox(next, boxId)
      if (boxId !== col) next = deleteLayoutBox(next, col)
    }
    layoutOverrides = pruneLayoutOverridesForTable(next, nextCols)
    prunePresetAuxForTable(nextCols)
    applyTableTemplateScopeToOverrides()
  }

  function finalizeLayoutForCurrentTable() {
    layoutOverrides = pruneLayoutOverridesForTable(layoutOverrides, previewColumns)
    prunePresetAuxForTable()
    applyTableTemplateScopeToOverrides()
  }

  function pruneSampleRowTableColumns() {
    for (const col of previewColumns) {
      delete sampleRow[col]
    }
  }

  function isSampleKeyForCurrentPreset(boxId) {
    if (previewColumns.includes(boxId)) return true
    const col = getPrimaryColumnForBox(boxId, layoutOverrides)
    return previewColumns.includes(col)
  }

  function overlayPresetSampleRow(presetRow) {
    if (!presetRow || typeof presetRow !== 'object') return
    sampleAdornments = {}
    const merged = overlayPresetSampleRowInto(presetRow, layoutOverrides, previewColumns, columnLayoutStash)
    for (const [key, val] of Object.entries(merged.sampleRow)) {
      sampleRow[key] = val
    }
    Object.assign(sampleAdornments, merged.sampleAdornments)
    pruneSampleRowTableColumns()
  }

  function getSampleSegmentsForBox(boxId) {
    const resolved = resolveBoxId(boxId, layoutOverrides)
    if (isCustomLayoutBox(resolved)) {
      return parseSampleStorage(sampleRow[resolved] ?? '')
    }
    const col = getPrimaryColumnForBox(resolved, layoutOverrides)
    const adorn = sampleAdornments[resolved] || { prefix: [], suffix: [] }
    return {
      prefix: [...adorn.prefix],
      core: getTableColumnPreviewValue(col),
      suffix: [...adorn.suffix],
    }
  }

  function getBoxDisplaySampleText(boxId) {
    return sampleSegmentsToDisplayText(getSampleSegmentsForBox(boxId))
  }

  function getPreviewRow() {
    const row = {}
    for (const col of previewColumns) {
      if (!isTableColumnVisible(col)) continue
      row[col] = getBoxDisplaySampleText(col)
    }
    for (const boxId of listCustomLayoutBoxIds()) {
      if (!isCustomBoxVisible(boxId)) continue
      const display = getBoxDisplaySampleText(boxId)
      if (display.trim()) row[boxId] = display
    }
    return row
  }

  /** 持久化时保存自定义编辑框示例与表格列前后缀 */
  function getCustomSampleRowForSave() {
    const row = {}
    for (const boxId of listCustomLayoutBoxIds()) {
      const v = sampleRow[boxId]
      if (hasMeaningfulSampleCell(v)) row[boxId] = v
    }
    for (const key of Object.keys(sampleRow)) {
      if (previewColumns.includes(key) || row[key] != null) continue
      if (!isCustomLayoutBox(key)) continue
      if (hasMeaningfulSampleCell(sampleRow[key])) row[key] = sampleRow[key]
    }
    for (const [boxId, adorn] of Object.entries(sampleAdornments)) {
      if (!adorn.prefix?.length && !adorn.suffix?.length) continue
      row[`${SAMPLE_ADORN_KEY_PREFIX}${boxId}`] = JSON.stringify(adorn)
    }
    return row
  }

  function getSampleTextForBox(boxId) {
    return getBoxDisplaySampleText(boxId)
  }

  function isSampleCoreReadonlyForBox(boxId) {
    const resolved = resolveBoxId(boxId, layoutOverrides)
    return !isCustomLayoutBox(resolved)
  }

  function isCustomLayoutBox(boxId) {
    return !previewColumns.includes(boxId)
  }

  function listCustomLayoutBoxIds() {
    const ids = new Set()
    for (const b of listLayoutBoxes(layoutOverrides, previewColumns)) {
      if (isCustomLayoutBox(b.id)) ids.add(b.id)
    }
    for (const key of Object.keys(columnLayoutStash)) {
      if (isCustomLayoutBox(key)) ids.add(key)
      const stashedId = columnLayoutStash[key]?.boxId
      if (stashedId && isCustomLayoutBox(stashedId)) ids.add(stashedId)
    }
    return [...ids].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }

  function hasMeaningfulSampleCell(value) {
    if (value == null) return false
    return String(value).trim() !== ''
  }

  function isTableColumnVisible(col, overrides = layoutOverrides) {
    return isLayoutBoxActive(getColumnLayout(col, overrides))
  }

  function isCustomBoxVisible(boxId, overrides = layoutOverrides) {
    const primary = getPrimaryColumnForBox(boxId, overrides)
    return isLayoutBoxActive(getColumnLayout(primary, overrides))
  }

  /** @deprecated 使用 isTableColumnVisible / isCustomBoxVisible */
  function isLayoutBoxVisible(boxId) {
    if (boxId === TEMPLATE_BACKGROUND_BOX_ID) return isTemplateBackgroundBoxActive()
    if (previewColumns.includes(boxId)) return isTableColumnVisible(boxId)
    return isCustomBoxVisible(boxId)
  }

  function columnLayoutKeys(col, overrides = layoutOverrides) {
    const sync = syncAutoColumnBindings(overrides, previewColumns)
    const resolved = resolveBoxId(col, sync)
    return { sync, resolved, keys: [...new Set([col, resolved])] }
  }

  const COL_CHECK_LOG = '[布局列勾选]'

  function summarizeTableColumnCheck(col, overrides = layoutOverrides) {
    const { sync, resolved, keys } = columnLayoutKeys(col, overrides)
    const layout = getColumnLayout(col, sync)
    const stored = {}
    for (const key of keys) {
      if (sync[key]) stored[key] = { ...sync[key], boxHidden: !!sync[key].boxHidden }
    }
    return {
      col,
      resolved,
      keys,
      bindings: getBindings(sync),
      visible: isTableColumnVisible(col, sync),
      layoutHasBox: layoutHasBox(layout),
      layoutActive: isLayoutBoxActive(layout),
      boxHidden: !!layout?.boxHidden,
      effectiveLayout: layoutHasBox(layout) ? { boxHidden: !!layout.boxHidden } : null,
      storedOverrides: stored,
      stashKeys: Object.keys(columnLayoutStash).filter((k) => (
        k === col || k === resolved || getPrimaryColumnForBox(k, sync) === col
      )),
    }
  }

  function summarizeCustomBoxCheck(boxId, overrides = layoutOverrides) {
    const sync = syncAutoColumnBindings(overrides, previewColumns)
    const primary = getPrimaryColumnForBox(boxId, sync)
    const layout = getColumnLayout(primary, sync)
    return {
      boxId,
      primary,
      visible: isCustomBoxVisible(boxId, sync),
      layoutHasBox: layoutHasBox(layout),
      layoutActive: isLayoutBoxActive(layout),
      boxHidden: !!layout?.boxHidden,
      storedOverride: sync[boxId] ? { ...sync[boxId], boxHidden: !!sync[boxId].boxHidden } : null,
      stashKeys: Object.keys(columnLayoutStash).filter((k) => k === boxId),
    }
  }

  function logColumnCheck(title, payload) {
    console.groupCollapsed(`${COL_CHECK_LOG} ${title}`)
    console.log('时间', new Date().toISOString())
    console.log('会话', {
      currentId,
      presetLoadReady,
      presetLoading,
      draftDirty,
      activeTableTemplateId,
    })
    console.log('数据', payload)
    console.groupEnd()
  }

  function logColumnCheckAfterCommit(col, action, beforeSnap) {
    const after = summarizeTableColumnCheck(col)
    logColumnCheck(`${action} → 提交后`, {
      before: beforeSnap,
      after,
      changed: beforeSnap.visible !== after.visible,
      noop: beforeSnap.visible === after.visible,
    })
  }

  function stashLayoutBoxForTarget(targetColOrBox, overrides = layoutOverrides) {
    const col = previewColumns.includes(targetColOrBox)
      ? targetColOrBox
      : getPrimaryColumnForBox(targetColOrBox, overrides)
    const layout = getColumnLayout(col, overrides)
    if (!layoutHasBox(layout)) return
    const resolved = resolveBoxId(col, overrides)
    const entry = {
      boxId: resolved,
      layout: structuredClone(layout),
    }
    columnLayoutStash[col] = entry
    if (resolved !== col) columnLayoutStash[resolved] = entry
  }

  function stashLayoutBox(boxId) {
    stashLayoutBoxForTarget(boxId, layoutOverrides)
  }

  function restoreLayoutBoxFromStash(stashKey, storeAsId, overrides = layoutOverrides) {
    const entry = columnLayoutStash[stashKey]
    if (!entry?.layout || !layoutHasBox(entry.layout)) return null
    const restoredLayout = structuredClone(entry.layout)
    delete restoredLayout.boxHidden
    const storeId = storeAsId ?? entry.boxId ?? stashKey
    let next = { ...overrides, [storeId]: restoredLayout }
    for (const legacyId of [entry.boxId, stashKey]) {
      if (legacyId && legacyId !== storeId && !previewColumns.includes(legacyId) && next[legacyId]) {
        delete next[legacyId]
      }
    }
    return { overrides: next, boxId: storeId }
  }

  function hideLayoutBoxes(boxIds) {
    let next = syncAutoColumnBindings(layoutOverrides, previewColumns)
    const hideIds = new Set()
    for (const boxId of boxIds) {
      const col = previewColumns.includes(boxId) ? boxId : getPrimaryColumnForBox(boxId, next)
      const { keys } = columnLayoutKeys(col, next)
      for (const id of keys) hideIds.add(id)
      if (isTableColumnVisible(col, next) || isCustomBoxVisible(col, next)) {
        stashLayoutBoxForTarget(col, next)
      }
    }
    return hideLayoutBoxesInOverrides(next, [...hideIds])
  }

  function showTableColumn(col) {
    const before = summarizeTableColumnCheck(col)
    const { sync, resolved, keys } = columnLayoutKeys(col, layoutOverrides)
    let next = sync
    const layout = getColumnLayout(col, next)

    if (isLayoutBoxActive(layout)) {
      logColumnCheck(`勾选「${col}」→ 跳过（已显示）`, { before, path: 'noop-already-active' })
      renderColumnPicker()
      return
    }

    let path = 'unknown'
    const restored = restoreColumnLayoutFromStash(col, next)
    if (restored) {
      path = 'restore-from-stash'
      next = unhideLayoutBoxes(restored.overrides, keys)
    } else if (layoutHasBox(layout)) {
      path = 'unhide-existing'
      next = unhideLayoutBoxes(next, keys)
    } else {
      path = 'create-new-box'
      const idx = Math.max(0, previewColumns.indexOf(col))
      next = createLayoutBox(next, resolved, boundsForColumnIndex(idx)).overrides
    }

    logColumnCheck(`勾选「${col}」→ ${path}`, { before, resolved, keys, path })
    turnOnLayoutBoxes()
    commitLayoutOverrides(next, {
      restoreSelection: [col],
      reason: `显示列「${col}」编辑框`,
      affectedColumns: [col],
    })
    logColumnCheckAfterCommit(col, '勾选', before)
  }

  function hideTableColumn(col) {
    const before = summarizeTableColumnCheck(col)
    const { sync, keys } = columnLayoutKeys(col, layoutOverrides)
    if (!isTableColumnVisible(col, sync)) {
      logColumnCheck(`取消「${col}」→ 跳过（已隐藏）`, { before, path: 'noop-already-hidden' })
      renderColumnPicker()
      return
    }

    let next = sync
    if (isTableColumnVisible(col, next)) {
      stashLayoutBoxForTarget(col, next)
    }
    next = hideLayoutBoxesInOverrides(next, keys)
    logColumnCheck(`取消「${col}」→ hide`, { before, keys, path: 'hide' })
    commitLayoutOverrides(next, {
      reason: `隐藏列「${col}」编辑框`,
      affectedColumns: [col],
    })
    logColumnCheckAfterCommit(col, '取消', before)
  }

  function showCustomLayoutBox(boxId) {
    const before = summarizeCustomBoxCheck(boxId)
    let next = syncAutoColumnBindings(layoutOverrides, previewColumns)
    if (isCustomBoxVisible(boxId, next)) {
      logColumnCheck(`勾选自定义「${boxId}」→ 跳过（已显示）`, { before, path: 'noop-already-active' })
      renderColumnPicker()
      return
    }

    let path = 'unknown'
    const restored = restoreLayoutBoxFromStash(boxId, boxId, next)
      ?? restoreLayoutBoxFromStash(boxId, resolveBoxId(boxId, next), next)
    if (restored) {
      path = 'restore-from-stash'
      next = unhideLayoutBoxes(restored.overrides, [boxId, restored.boxId])
      turnOnLayoutBoxes()
      logColumnCheck(`勾选自定义「${boxId}」→ ${path}`, { before, path })
      commitLayoutOverrides(next, {
        restoreSelection: [boxId],
        reason: `恢复自定义编辑框「${boxId}」`,
      })
      logColumnCheck(`勾选自定义「${boxId}」→ 提交后`, {
        before,
        after: summarizeCustomBoxCheck(boxId),
      })
      return
    }

    if (layoutHasBox(getColumnLayout(boxId, next))) {
      path = 'unhide-existing'
      next = unhideLayoutBoxes(next, [boxId])
      turnOnLayoutBoxes()
      logColumnCheck(`勾选自定义「${boxId}」→ ${path}`, { before, path })
      commitLayoutOverrides(next, {
        restoreSelection: [boxId],
        reason: `显示自定义编辑框「${boxId}」`,
      })
      logColumnCheck(`勾选自定义「${boxId}」→ 提交后`, {
        before,
        after: summarizeCustomBoxCheck(boxId),
      })
      return
    }

    path = 'create-new-box'
    const created = createLayoutBox(next, boxId, defaultNewBoxBounds())
    turnOnLayoutBoxes()
    logColumnCheck(`勾选自定义「${boxId}」→ ${path}`, { before, path })
    commitLayoutOverrides(created.overrides, {
      restoreSelection: [created.boxId],
      reason: `显示自定义编辑框「${boxId}」`,
    })
    logColumnCheck(`勾选自定义「${boxId}」→ 提交后`, {
      before,
      after: summarizeCustomBoxCheck(boxId),
    })
  }

  function hideCustomLayoutBox(boxId) {
    const before = summarizeCustomBoxCheck(boxId)
    const next = syncAutoColumnBindings(layoutOverrides, previewColumns)
    if (!isCustomBoxVisible(boxId, next)) {
      logColumnCheck(`取消自定义「${boxId}」→ 跳过（已隐藏）`, { before, path: 'noop-already-hidden' })
      renderColumnPicker()
      return
    }
    logColumnCheck(`取消自定义「${boxId}」→ hide`, { before, path: 'hide' })
    commitLayoutOverrides(hideLayoutBoxes([boxId]), {
      reason: `隐藏自定义编辑框「${boxId}」`,
    })
    logColumnCheck(`取消自定义「${boxId}」→ 提交后`, {
      before,
      after: summarizeCustomBoxCheck(boxId),
    })
  }

  function permanentlyDeleteCustomBox(boxId) {
    if (!boxId || !isCustomLayoutBox(boxId)) return
    if (!window.confirm(`彻底删除自定义编辑框「${boxId}」？\n\n取消勾选仅会隐藏，可再勾选恢复；此处删除后需重新添加。`)) {
      return
    }
    delete columnLayoutStash[boxId]
    delete sampleRow[boxId]
    delete sampleAdornments[boxId]
    const next = deleteLayoutBox(layoutOverrides, boxId)
    commitLayoutOverrides(next, {
      restoreSelection: [],
      reason: `彻底删除自定义编辑框「${boxId}」`,
    })
    setStatus(`已彻底删除「${boxId}」`)
  }

  function setSampleSegmentsForBox(boxId, segments) {
    const resolved = resolveBoxId(boxId, layoutOverrides)
    if (isCustomLayoutBox(resolved)) {
      sampleRow[resolved] = encodeSampleStorage(segments)
    } else {
      const adorn = {
        prefix: (segments.prefix || []).map((v) => String(v ?? '')),
        suffix: (segments.suffix || []).map((v) => String(v ?? '')),
      }
      if (!adorn.prefix.length && !adorn.suffix.length) {
        delete sampleAdornments[resolved]
      } else {
        sampleAdornments[resolved] = adorn
      }
    }
    draftDirty = true
    setStatus('有未保存的修改（示例内容）')
    if (!refreshPreviewLayout()) void rebuildPreview(layoutEditor?.getSelectedColumns?.() ?? [])
  }

  function getFillOptions() {
    return {
      fontScale,
      layoutOverrides,
      showReferenceLayer,
      showTemplateLayer,
      skipFontInject: false,
      fontCatalog,
      restrictToRowColumns: true,
      pageWidthMm,
      pageHeightMm,
      editorPreview: true,
      clipToArtboard: false,
    }
  }

  function handleCopyLayoutBoxes(boxIds) {
    if (!ensureLayoutEditorAttached()) {
      setStatus('预览尚未就绪，请稍候再试', true)
      return
    }
    layoutEditor?.flushPendingState?.()
    const overrides = layoutEditor?.getPendingOverrides?.() ?? layoutOverrides
    const ids = [...new Set((Array.isArray(boxIds) ? boxIds : [boxIds]).filter(Boolean))]
    if (!ids.length) return

    const entries = ids.map((boxId) => {
      const resolved = resolveBoxId(boxId, overrides)
      const adorn = sampleAdornments[resolved] ?? sampleAdornments[boxId]
      return {
        boxId,
        content: encodeSampleStorage(getSampleSegmentsForBox(boxId)),
        sampleAdornments: (adorn?.prefix?.length || adorn?.suffix?.length)
          ? structuredClone(adorn)
          : null,
      }
    })

    const ok = copyLayoutBoxesToClipboard(entries, overrides, {
      sourcePresetId: currentId,
      tableColumns: previewColumns,
    })
    if (!ok) {
      setStatus('无法复制所选编辑框', true)
      return
    }
    if (ids.length === 1) {
      setStatus(`已复制编辑框「${resolveBoxId(ids[0], overrides)}」`)
    } else {
      setStatus(`已复制 ${ids.length} 个编辑框`)
    }
  }

  function stashOnlyBoxIds() {
    return Object.keys(columnLayoutStash).filter((id) => {
      const layout = getColumnLayout(id, layoutOverrides)
      return !layoutHasBox(layout)
    })
  }

  function applyPastedLayoutItemToSession(item, overrides) {
    const { boxId, content, sampleAdornments: pastedAdornments } = item
    const resolved = resolveBoxId(boxId, overrides)

    if (previewColumns.includes(boxId)) {
      delete sampleRow[boxId]
      delete sampleRow[resolved]
      delete sampleAdornments[boxId]
      delete sampleAdornments[resolved]
      if (pastedAdornments?.prefix?.length || pastedAdornments?.suffix?.length) {
        sampleAdornments[boxId] = structuredClone(pastedAdornments)
      }
    } else {
      sampleRow[boxId] = content
      delete sampleAdornments[boxId]
      if (pastedAdornments?.prefix?.length || pastedAdornments?.suffix?.length) {
        sampleAdornments[boxId] = structuredClone(pastedAdornments)
      }
    }

    delete columnLayoutStash[boxId]
    delete columnLayoutStash[resolved]
  }

  async function handlePasteLayoutBox() {
    if (!hasLayoutBoxClipboard()) {
      setStatus('剪贴板中没有已复制的编辑框', true)
      return
    }
    const clip = getLayoutBoxClipboard()
    const crossPreset = clip?.sourcePresetId != null && clip.sourcePresetId !== currentId
    const result = pasteLayoutBoxesFromClipboard(layoutOverrides, {
      tableColumns: previewColumns,
      customBoxIds: listCustomLayoutBoxIds(),
      reservedIds: stashOnlyBoxIds(),
      isVisible: (id) => isLayoutBoxVisible(id),
      offsetX: crossPreset ? 0 : undefined,
      offsetY: crossPreset ? 0 : undefined,
    })
    if (!result?.items?.length) {
      setStatus('粘贴失败', true)
      return
    }

    for (const item of result.items) {
      applyPastedLayoutItemToSession(item, result.overrides)
    }

    turnOnLayoutBoxes()
    const reuseCount = result.items.filter((item) => item.mode === 'reuse').length
    const copyCount = result.items.length - reuseCount
    await commitLayoutOverrides(result.overrides, {
      restoreSelection: result.boxIds,
      previewLight: false,
      reason: result.items.length > 1 ? '批量粘贴编辑框' : (reuseCount ? '粘贴并启用编辑框' : '粘贴编辑框'),
      affectedColumns: result.boxIds.filter((id) => previewColumns.includes(id)),
    })
    renderColumnPicker()
    syncLayerListSelection()

    if (result.items.length === 1) {
      const { boxId, mode } = result.items[0]
      if (mode === 'reuse') {
        setStatus(`已启用编辑框「${boxId}」并应用复制的样式`)
      } else if (mode === 'new') {
        setStatus(`已粘贴为自定义编辑框「${boxId}」`)
      } else {
        setStatus(`已粘贴为自定义编辑框「${boxId}」（原框已启用）`)
      }
      return
    }
    const parts = []
    if (reuseCount) parts.push(`启用 ${reuseCount} 个`)
    if (copyCount) parts.push(`新建 ${copyCount} 个`)
    setStatus(`已粘贴 ${result.items.length} 个编辑框${parts.length ? `（${parts.join('，')}）` : ''}`)
  }

  function destroyLayoutEditor() {
    if (layoutEditor) {
      layoutEditor.destroy()
      layoutEditor = null
    }
  }

  function getSelectedLayoutBoxIds() {
    const fromEditor = layoutEditor?.getSelectedColumns?.() ?? []
    if (fromEditor.length) return fromEditor
    const fromPanel = layoutPanel?.getSelectedColumns?.() ?? []
    if (fromPanel.length) return fromPanel
    return []
  }

  function ensureLayoutEditorAttached() {
    if (layoutEditor) return true
    const artboard = queryPreviewArtboard(previewArea)
    if (!artboard?.querySelector('svg')) return false
    attachLayoutEditor(getSelectedLayoutBoxIds())
    return !!layoutEditor
  }

  function ensureLayoutPanel() {
    if (layoutPanel) return
    layoutPanel = mountLayoutPanel(layoutPanelRoot, {
      idPrefix: 'layout-preset-panel-',
      queryRoot: container,
      basicOpsSlot: container.querySelector('#layout-preset-basic-ops-slot'),
      dockStackSlot: toolsRailStackEl,
      reorderStorageKey: 'layout-preset-rail-order',
      dockResizeStorageKeyPrefix: 'layout-preset-panel-dock-panel-',
      layoutOverrides,
      overlayShowBorder,
      overlayShowHandles,
      showFileButtons: false,
      showOverlayVisual: false,
      hideHistoryToolbar: true,
      hideSelectionToolbar: true,
      selectionColumnEl,
      dockFontPropsGroup: true,
      contentStyleOnly: true,
      onOverlayVisualChange({ showBorder, showHandles }) {
        if (showBorder != null) overlayShowBorder = !!showBorder
        if (showHandles != null) overlayShowHandles = !!showHandles
        if (overlayBorderEl) overlayBorderEl.checked = overlayShowBorder
        if (overlayHandlesEl) overlayHandlesEl.checked = overlayShowHandles
        layoutEditor?.setOverlayVisual?.({ showBorder, showHandles })
      },
      getFontCatalog: () => fontCatalog,
      onChange: (next, meta) => {
        commitLayoutOverrides(next, {
          restoreSelection: layoutPanel?.getSelectedColumns?.() ?? [],
          previewLight: !!meta?.previewLight,
          affectedColumns: meta?.affectedColumns,
          reason: meta?.reason || '布局面板',
        })
      },
      onUndo: performLayoutUndo,
      onRedo: performLayoutRedo,
      getHistoryState: () => getLayoutHistoryState(LAYOUT_HISTORY_PRESETS),
      onStartPropertyPick(_targets, onPicked) {
        layoutEditor?.startPropertyPick?.(onPicked)
        setStatus('请点击要复制属性的源编辑框（Esc 取消）')
      },
      onCancelPropertyPick() {
        layoutEditor?.cancelPropertyPick?.()
      },
      getBoxLayout(boxId, overrides) {
        if (boxId === TEMPLATE_BACKGROUND_BOX_ID) return templateBackgroundBoxLayout(overrides)
        return getColumnLayout(boxId, overrides)
      },
      applyBoxBounds(overrides, boxId, bounds, edge) {
        if (boxId === TEMPLATE_BACKGROUND_BOX_ID) {
          return applyTemplateBackgroundBoxBounds(overrides, boxId, bounds, edge)
        }
        return applyColumnBoxBounds(overrides, resolveBoxId(boxId, overrides), bounds, edge)
      },
      getLayoutBoxBridge: getTemplateBackgroundLayoutBoxBridge,
      isLayoutOnlyBox: (boxId) => boxId === TEMPLATE_BACKGROUND_BOX_ID,
      getBoxLabel: (boxId) => (boxId === TEMPLATE_BACKGROUND_BOX_ID ? 'SVG底图' : boxId),
      boundsInMm: true,
      getPageSizeMm: () => ({ pageWidthMm, pageHeightMm }),
      getPreviewSvg: () => queryPreviewSvg(previewArea),
    })
    refreshTopEditToolbar()
  }

  function refreshPreviewLayout(restoreSelection = [], { affectedColumns = null } = {}) {
    const selection = restoreSelection.length
      ? restoreSelection
      : (layoutEditor?.getSelectedColumns?.() ?? layoutPanel?.getSelectedColumns?.() ?? [])
    const svgEl = queryPreviewSvg(previewArea)
    if (!svgEl) return false
    const fillOpts = getFillOptions()
    if (affectedColumns?.length) {
      fillOpts.affectedColumns = affectedColumns
    }
    refillSvgRowText(svgEl, getPreviewRow(), fillOpts)
    layoutPanel?.setOverrides(layoutOverrides)
    layoutPanel?.refreshColorSwatches?.()
    if (layoutEditor) {
      layoutEditor.syncOverrides?.(layoutOverrides) ?? layoutEditor.setOverrides(layoutOverrides)
      if (selection.length) layoutEditor.selectColumns(selection)
    }
    return true
  }

  async function rebuildPreview(restoreSelection = []) {
    const selection = restoreSelection.length ? [...restoreSelection] : getSelectedLayoutBoxIds()
    const gen = ++previewGeneration
    const savedView = previewViewportInitialized ? previewViewport.getViewState() : null
    destroyLayoutEditor()
    ensureLayoutPanel()
    layoutPanel.setOverrides(layoutOverrides)

    try {
      const svgEl = await generateSvgFromRow(templateSvg, getPreviewRow(), fontUrl, getFillOptions())
      if (gen !== previewGeneration) return

      const { stage } = wrapSvgInLayoutWorkspace(svgEl)
      previewViewport.setContent(stage)
      const genPresetId = currentId
      attachLayoutEditor(selection)

      if (!previewViewportInitialized) {
        previewViewport.scheduleFitView()
        previewViewportInitialized = true
      } else if (savedView) {
        requestAnimationFrame(() => {
          if (gen !== previewGeneration) return
          previewViewport.setViewState(savedView)
        })
      }

      if (genPresetId) {
        requestAnimationFrame(() => {
          if (gen !== previewGeneration || currentId !== genPresetId) return
          snapshotPreviewDomForTab(genPresetId)
        })
      }
    } catch (err) {
      console.error(err)
      previewViewport.setContent(document.createElement('p'))
      previewArea.querySelector('p').className = 'preview-empty-msg'
      previewArea.querySelector('p').textContent = '预览加载失败'
      setStatus(err.message || '预览失败', true)
    }
  }

  function attachLayoutEditor(restoreSelection = []) {
    const artboard = queryPreviewArtboard(previewArea)
    const svgEl = artboard?.querySelector('svg')
    if (!artboard || !svgEl) return

    destroyLayoutEditor()
    layoutPanel?.setOverrides(layoutOverrides)

    layoutEditor = mountLayoutEditor(artboard, svgEl, {
      layoutOverrides,
      visible: showLayoutBoxes,
      overlayShowBorder,
      overlayShowHandles,
      sampleInputs: false,
      getSampleText: getSampleTextForBox,
      getSampleDialogSegments: getSampleSegmentsForBox,
      isSampleCoreReadonly: isSampleCoreReadonlyForBox,
      onSampleChange: setSampleSegmentsForBox,
      sampleDialogHint: '表格列「原内容」随所选表格模板示例行更新；可在其前后追加自定义文字。自定义编辑框可编辑原内容，并会保存到本布局预设。',
      tableColumns: previewColumns,
      getReservedBoxIds: stashOnlyBoxIds,
      onDragDuplicate(idMap) {
        for (const [oldId, newId] of Object.entries(idMap)) {
          sampleRow[newId] = encodeSampleStorage(getSampleSegmentsForBox(oldId))
          delete columnLayoutStash[newId]
        }
      },
      onRenameBox: (oldId, newId) => {
        const trimmed = String(newId || '').trim()
        if (!trimmed || trimmed === oldId) return
        if (layoutOverrides[trimmed] && trimmed !== oldId && !previewColumns.includes(trimmed)) {
          setStatus(`已存在编辑框「${trimmed}」`, true)
          return
        }
        const oldKey = getPrimaryColumnForBox(oldId, layoutOverrides)
        let next = renameLayoutBox(layoutOverrides, oldId, trimmed)
        next = syncAutoColumnBindings(next, previewColumns)
        const newKey = getPrimaryColumnForBox(trimmed, next)
        if (oldKey !== newKey && isCustomLayoutBox(oldId) && sampleRow[oldId] != null) {
          sampleRow[trimmed] = sampleRow[oldId]
          delete sampleRow[oldId]
        }
        if (sampleAdornments[oldId]) {
          sampleAdornments[trimmed] = sampleAdornments[oldId]
          delete sampleAdornments[oldId]
        }
        if (oldId !== trimmed && columnLayoutStash[oldId]) {
          columnLayoutStash[trimmed] = columnLayoutStash[oldId]
          delete columnLayoutStash[oldId]
        }
        commitLayoutOverrides(next, {
          restoreSelection: [trimmed],
          previewLight: true,
          reason: '重命名编辑框',
        })
        if (previewColumns.includes(trimmed)) {
          setStatus(`编辑框「${trimmed}」已与表格列自动绑定`)
        } else {
          setStatus(`编辑框已重命名为「${trimmed}」`)
        }
      },
      onCommit(next, reason) {
        commitLayoutOverrides(next, {
          restoreSelection: layoutEditor?.getSelectedColumns?.() ?? [],
          previewLight: true,
          reason: reason || '编辑框',
        })
        if (reason === '拖拽复制编辑框') {
          setStatus('已拖拽复制编辑框')
        }
      },
      onSelectColumns(boxIds, { syncTable = true } = {}) {
        if (boxIds.length === 0) {
          layoutPanel?.selectColumns([])
          layoutEditor?.clearVisualState?.()
          syncLayerListSelection()
          return
        }
        layoutPanel?.selectColumns(boxIds)
        syncLayerListSelection()
        if (syncTable && boxIds.length === 1) {
          scrollLayerListToBoxIds(boxIds)
        }
      },
      onDeleteBoxes(boxIds) {
        if (!boxIds?.length) return
        const next = hideLayoutBoxes(boxIds)
        commitLayoutOverrides(next, {
          restoreSelection: [],
          reason: boxIds.length > 1 ? `删除 ${boxIds.length} 个编辑框` : `删除编辑框「${boxIds[0]}」`,
        })
      },
      onCopyBox: handleCopyLayoutBoxes,
      onPasteBox: handlePasteLayoutBox,
      getSelectedBoxIdsForCopy: getSelectedLayoutBoxIds,
      onUndo: performLayoutUndo,
      onRedo: performLayoutRedo,
      isShortcutScopeActive: isLayoutPresetsShortcutActive,
      onLayoutPreview: previewTemplateBackgroundTransform,
      auxiliaryBox: {
        id: TEMPLATE_BACKGROUND_BOX_ID,
        label: 'SVG底图',
        className: 'layout-template-bg-box',
        isActive: isTemplateBackgroundBoxActive,
        getLayout: templateBackgroundBoxLayout,
        setLayout(overrides, layout) {
          return applyTemplateBackgroundBoxBounds(overrides, TEMPLATE_BACKGROUND_BOX_ID, layout)
        },
        noDelete: true,
        noCopy: true,
        noRename: true,
        noDuplicate: true,
        noSample: true,
      },
    })

    if (restoreSelection.length) {
      layoutEditor.selectColumns(restoreSelection)
    }
    syncLayerListSelection()
    syncTemplateBgLockUi()
    refreshTopEditToolbar()
  }

  function commitLayoutOverrides(next, {
    recordHistory = true,
    restoreSelection = [],
    previewLight = true,
    reason = '布局编辑',
    affectedColumns = null,
  } = {}) {
    const prevOverrides = layoutOverrides
    layoutOverrides = pruneLayoutOverridesForTable(next, previewColumns)
    migrateColumnLayoutStash(prevOverrides, layoutOverrides, previewColumns)
    applyTableTemplateScopeToOverrides()
    if (recordHistory && presetLoadReady) recordLayoutHistory(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    draftDirty = true
    setStatus(`有未保存的修改（${reason}）`)

    layoutPanel?.setOverrides(layoutOverrides)
    layoutPanel?.refreshHistoryButtons?.()
    refreshTopEditToolbar()

    renderColumnPicker()
    renderPresetTabs()

    if (currentId) {
      presetTabPreviewDomCache.delete(currentId)
    }

    if (previewLight && refreshPreviewLayout(restoreSelection, { affectedColumns })) {
      previewRebuildPromise = null
      return Promise.resolve()
    }
    const rebuild = rebuildPreview(restoreSelection)
    previewRebuildPromise = rebuild.finally(() => {
      if (previewRebuildPromise === rebuild) previewRebuildPromise = null
    })
    return previewRebuildPromise
  }

  function refreshTopEditToolbar() {
    const st = getLayoutHistoryState(LAYOUT_HISTORY_PRESETS)
    if (topUndoBtn) topUndoBtn.disabled = !st.canUndo
    if (topRedoBtn) topRedoBtn.disabled = !st.canRedo
    const hasBoxes = previewColumns.length > 0 || listCustomLayoutBoxIds().length > 0
    if (topSelectAllBtn) topSelectAllBtn.disabled = !layoutEditor || !hasBoxes
  }

  function selectAllLayoutBoxes() {
    if (!layoutEditor?.selectAllBoxes) return
    layoutEditor.selectAllBoxes()
    syncLayerListSelection()
  }

  function performLayoutUndo() {
    const prev = undoLayout(LAYOUT_HISTORY_PRESETS)
    if (!prev) return
    layoutOverrides = pruneLayoutOverridesForTable(prev, previewColumns)
    applyTableTemplateScopeToOverrides()
    syncAuxStateWithLayoutOverrides()
    layoutPanel?.setOverrides(layoutOverrides)
    layoutPanel?.refreshHistoryButtons?.()
    refreshTopEditToolbar()
    layoutEditor?.syncOverrides?.(layoutOverrides) ?? layoutEditor?.setOverrides(layoutOverrides)
    draftDirty = true
    renderColumnPicker()
    const selection = filterSelectionToVisible(layoutEditor?.getSelectedColumns?.() ?? [])
    if (!refreshPreviewLayout(selection)) {
      void rebuildPreview(selection)
    } else if (selection.length) {
      layoutEditor?.selectColumns(selection)
    }
    setStatus('已撤销')
  }

  function performLayoutRedo() {
    const next = redoLayout(LAYOUT_HISTORY_PRESETS)
    if (!next) return
    layoutOverrides = pruneLayoutOverridesForTable(next, previewColumns)
    applyTableTemplateScopeToOverrides()
    syncAuxStateWithLayoutOverrides()
    layoutPanel?.setOverrides(layoutOverrides)
    layoutPanel?.refreshHistoryButtons?.()
    refreshTopEditToolbar()
    layoutEditor?.syncOverrides?.(layoutOverrides) ?? layoutEditor?.setOverrides(layoutOverrides)
    draftDirty = true
    renderColumnPicker()
    const selection = filterSelectionToVisible(layoutEditor?.getSelectedColumns?.() ?? [])
    if (!refreshPreviewLayout(selection)) {
      void rebuildPreview(selection)
    } else if (selection.length) {
      layoutEditor?.selectColumns(selection)
    }
    setStatus('已重做')
  }

  async function loadSvgTemplate(id) {
    if (!id) {
      templateSvg = EMPTY_SVG_TEMPLATE
      return
    }
    templateSvg = await loadSvgTemplateContent(api, id, { fallback: EMPTY_SVG_TEMPLATE })
  }

  /**
   * @param {number | null} id
   * @returns {Promise<object | null>} 表格模板对象（无 id 时为 null）
   */
  async function loadTableTemplateColumns(id) {
    const prevCols = [...previewColumns]
    if (!id) {
      previewColumns = []
      tableTemplateSampleRows = []
      sampleRowsTableTemplateId = null
      previewSamplePageIndex = 0
      pruneSampleRowTableColumns()
      updateSamplePagePaginationUi()
      return null
    }
    const { template } = await api.getTableTemplate(id)
    previewColumns = (template.columns || []).map((c) => String(c).trim()).filter(Boolean)
    const sampleRows = Array.isArray(template?.sample_rows) ? template.sample_rows : []
    tableTemplateSampleRows = sampleRows.map((row) => structuredClone(row))
    if (id !== sampleRowsTableTemplateId) {
      previewSamplePageIndex = 0
    }
    sampleRowsTableTemplateId = id
    clampPreviewSamplePageIndex()
    pruneSampleRowTableColumns()
    if (prevCols.length) {
      applyRenamedTableColumns(prevCols, previewColumns)
      pruneDroppedTableColumns(prevCols, previewColumns)
    } else {
      finalizeLayoutForCurrentTable()
    }
    updateSamplePagePaginationUi()
    return template
  }

  function boundsForColumnIndex(index) {
    const base = defaultNewBoxBounds()
    const offset = index * 28
    return {
      ...base,
      boxLeft: base.boxLeft + offset,
      boxRight: base.boxRight + offset,
      boxTop: base.boxTop + offset * 0.4,
      boxBottom: base.boxBottom + offset * 0.4,
    }
  }

  function clearColumnLayoutStash() {
    columnLayoutStash = {}
  }

  /** 撤销/重做后：清理已不存在的自定义框示例数据，并去掉与当前可见框冲突的暂存 */
  function syncAuxStateWithLayoutOverrides() {
    const activeBoxIds = new Set(listLayoutBoxIds(layoutOverrides))

    for (const boxId of Object.keys(columnLayoutStash)) {
      if (activeBoxIds.has(boxId) && isLayoutBoxVisible(boxId)) {
        delete columnLayoutStash[boxId]
      }
    }

    for (const key of Object.keys(sampleRow)) {
      if (!previewColumns.includes(key) && !activeBoxIds.has(key)) {
        delete sampleRow[key]
      }
    }

    for (const boxId of Object.keys(sampleAdornments)) {
      if (!activeBoxIds.has(boxId)) {
        delete sampleAdornments[boxId]
      }
    }
  }

  function filterSelectionToVisible(boxIds = []) {
    return boxIds
      .map(normalizeOverlayBoxId)
      .filter((id) => isLayoutBoxVisible(id))
  }

  function stashColumnLayout(col) {
    stashLayoutBox(resolveBoxId(col, layoutOverrides))
  }

  function migrateColumnLayoutStash(prevOverrides, nextOverrides, columns = previewColumns) {
    const prevBindings = getBindings(prevOverrides)
    const nextBindings = getBindings(nextOverrides)
    for (const col of columns) {
      const prevTarget = prevBindings[col]
      if (!prevTarget || prevTarget === col) continue
      if (nextBindings[col] != null && nextBindings[col] !== col) continue
      const entry = columnLayoutStash[prevTarget]
      if (!entry) continue
      if (!columnLayoutStash[col]) {
        columnLayoutStash[col] = { ...entry, boxId: col }
      }
      delete columnLayoutStash[prevTarget]
    }
  }

  function restoreColumnLayoutFromStash(col, overrides = layoutOverrides) {
    const resolved = resolveBoxId(col, overrides)
    const storeId = resolved
    for (const key of [col, resolved]) {
      const restored = restoreLayoutBoxFromStash(key, storeId, overrides)
      if (restored) {
        restored.boxId = col
        return restored
      }
    }
    for (const [key, entry] of Object.entries(columnLayoutStash)) {
      if (key === col || key === resolved) continue
      const stashCol = getPrimaryColumnForBox(entry?.boxId || key, overrides)
      if (stashCol !== col) continue
      const restored = restoreLayoutBoxFromStash(key, storeId, overrides)
      if (restored) {
        restored.boxId = col
        return restored
      }
    }
    return null
  }

  function updateLayersPanelMeta() {
    if (!layerCountEl) return
    const customIds = listCustomLayoutBoxIds()
    const total = previewColumns.length + customIds.length
    if (!total) {
      layerCountEl.textContent = '—'
      layerCountEl.title = '无图层'
      if (layersPanelEl) layersPanelEl.classList.add('is-empty')
      return
    }
    if (layersPanelEl) layersPanelEl.classList.remove('is-empty')
    let visible = 0
    const visibleNames = []
    for (const col of previewColumns) {
      if (isTableColumnVisible(col)) {
        visible += 1
        visibleNames.push(col)
      }
    }
    for (const boxId of customIds) {
      if (isCustomBoxVisible(boxId)) {
        visible += 1
        visibleNames.push(boxId)
      }
    }
    layerCountEl.textContent = visible === total ? String(total) : `${visible}/${total}`
    layerCountEl.title = visibleNames.length ? visibleNames.join('、') : '全部隐藏'
  }

  function getLayerListSelectionSet() {
    return new Set(layoutEditor?.getSelectedColumns?.() ?? layoutPanel?.getSelectedColumns?.() ?? [])
  }

  function layerRowMatchesBoxId(row, boxId) {
    if (!row || !boxId) return false
    const layerId = row.dataset.layerId || ''
    const rowBoxId = row.dataset.boxId || ''
    if (rowBoxId === boxId || layerId === boxId) return true
    if (layerId && resolveBoxId(layerId, layoutOverrides) === boxId) return true
    if (layerId && getPrimaryColumnForBox(boxId, layoutOverrides) === layerId) return true
    return false
  }

  function findLayerRowForBoxId(boxId) {
    if (!columnChecksEl || !boxId) return null
    return [...columnChecksEl.querySelectorAll('.layout-layer-row')].find((row) => (
      layerRowMatchesBoxId(row, boxId)
    )) ?? null
  }

  function scrollLayerListToBoxIds(boxIds) {
    if (!columnChecksEl || !boxIds?.length) return
    const targetId = boxIds[boxIds.length - 1]

    const layersPanel = container.querySelector('#layout-preset-layers-panel')
    if (layersPanel?.classList.contains('is-collapsed')) {
      layersPanel.classList.remove('is-collapsed')
      layersPanel.querySelector('.layout-collapsible-panel-toggle')?.setAttribute('aria-expanded', 'true')
      try {
        localStorage.setItem(LAYERS_PANEL_COLLAPSED_KEY, '0')
      } catch { /* ignore */ }
    }

    requestAnimationFrame(() => {
      const row = findLayerRowForBoxId(targetId)
      if (!row) return
      row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    })
  }

  function syncLayerListSelection() {
    if (!columnChecksEl) return
    const selected = getLayerListSelectionSet()
    columnChecksEl.querySelectorAll('.layout-layer-row').forEach((row) => {
      const isSelected = [...selected].some((boxId) => layerRowMatchesBoxId(row, boxId))
      row.classList.toggle('is-selected', isSelected)
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false')
    })
  }

  function renderPsLayerRow({ layerId, label, type, visible, colIdx, boxId }) {
    const mockRow = { dataset: { layerId, boxId: boxId || '' } }
    const selected = [...getLayerListSelectionSet()].some((sid) => layerRowMatchesBoxId(mockRow, sid))
    const hiddenClass = visible ? '' : ' is-hidden'
    const selectedClass = selected ? ' is-selected' : ''
    const typeClass = type === 'custom' ? 'layout-layer-row--custom' : 'layout-layer-row--table'
    const dataAttrs = type === 'table'
      ? `data-layer-id="${escapeHtml(layerId)}" data-col-idx="${colIdx}"`
      : `data-layer-id="${escapeHtml(layerId)}" data-box-id="${escapeHtml(boxId)}"`
    const deleteBtn = type === 'custom'
      ? `<button type="button" class="layout-layer-action layout-layer-delete" data-delete-box-id="${escapeHtml(boxId)}" title="彻底删除此自定义编辑框" aria-label="删除图层">×</button>`
      : ''
    const eyeIcon = visible ? LAYER_EYE_ON_SVG : LAYER_EYE_OFF_SVG
    const visLabel = visible ? `隐藏「${label}」` : `显示「${label}」`
    const visLabelAttr = escapeHtml(visLabel)
    return (
      `<div class="layout-layer-row ${typeClass}${hiddenClass}${selectedClass}" role="option" ${dataAttrs} aria-selected="${selected ? 'true' : 'false'}" tabindex="-1">`
      + `<button type="button" class="layout-layer-visibility" aria-label="${visLabelAttr}" aria-pressed="${visible ? 'true' : 'false'}">${eyeIcon}</button>`
      + `<button type="button" class="layout-layer-name" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`
      + deleteBtn
      + `</div>`
    )
  }

  function renderColumnPicker() {
    if (!columnChecksEl) return
    const selected = getLayerListSelectionSet()
    /** @type {{ layerId: string, label: string, type: 'table'|'custom', visible: boolean, colIdx?: number, boxId?: string }[]} */
    const items = []

    for (let idx = 0; idx < previewColumns.length; idx += 1) {
      const col = previewColumns[idx]
      items.push({
        layerId: col,
        label: col,
        type: 'table',
        visible: isTableColumnVisible(col),
        colIdx: idx,
      })
    }
    for (const boxId of listCustomLayoutBoxIds()) {
      items.push({
        layerId: boxId,
        label: boxId,
        type: 'custom',
        visible: isCustomBoxVisible(boxId),
        boxId,
      })
    }
    items.reverse()

    if (!items.length) {
      const emptyMsg = isEditorActive()
        ? '请先选择表格模板，或点「+ 自定义框」'
        : '请先在左侧打开布局模板'
      columnChecksEl.innerHTML = `<div class="layout-layers-empty">${emptyMsg}</div>`
    } else {
      columnChecksEl.innerHTML = items.map((item) => renderPsLayerRow({
        ...item,
        visible: item.visible,
      })).join('')
      if (selected.size) syncLayerListSelection()
    }
    updateLayersPanelMeta()
  }

  function applyLayerVisibilityToggle(row, makeVisible) {
    const boxId = row?.dataset?.boxId
    const colIdx = row?.dataset?.colIdx
    if (boxId) {
      if (makeVisible) showCustomLayoutBox(boxId)
      else hideCustomLayoutBox(boxId)
      return
    }
    if (colIdx != null) {
      const col = previewColumns[Number(colIdx)]
      if (!col) return
      if (makeVisible) showTableColumn(col)
      else hideTableColumn(col)
    }
  }

  function captureTableTemplateSessionState(tableId) {
    if (!tableId) return
    tableTemplateSessionCache.set(tableId, {
      layoutOverrides: structuredClone(layoutOverrides),
      sampleRow: structuredClone(sampleRow),
      sampleAdornments: structuredClone(sampleAdornments),
      columnLayoutStash: structuredClone(columnLayoutStash),
      previewSamplePageIndex,
    })
  }

  function restoreTableTemplateSessionState(tableId) {
    const cached = tableTemplateSessionCache.get(tableId)
    if (!cached) return false
    layoutOverrides = structuredClone(cached.layoutOverrides)
    sampleRow = structuredClone(cached.sampleRow)
    sampleAdornments = structuredClone(cached.sampleAdornments)
    columnLayoutStash = structuredClone(cached.columnLayoutStash)
    previewSamplePageIndex = cached.previewSamplePageIndex ?? 0
    initLayoutHistory(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    updateLayoutHistoryBaseline(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    presetLoadReady = true
    return true
  }

  function clearLayoutForTableTemplate() {
    layoutOverrides = {}
    sampleRow = {}
    sampleAdornments = {}
    tableTemplateSampleRows = []
    previewSamplePageIndex = 0
    sampleRowsTableTemplateId = null
    clearColumnLayoutStash()
    initLayoutHistory(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    updateLayoutHistoryBaseline(layoutOverrides, LAYOUT_HISTORY_PRESETS)
    presetLoadReady = true
    layoutPanel?.setOverrides(layoutOverrides)
    renderColumnPicker()
  }

  async function applyTableTemplateSelection() {
    const loadGen = loadContextGeneration
    const presetId = currentId
    const tableId = getSelectedTableTemplateId()
    const prevTableId = activeTableTemplateId

    if (prevTableId && prevTableId !== tableId) {
      captureTableTemplateSessionState(prevTableId)
    }

    const restoredFromCache = !!(tableId && restoreTableTemplateSessionState(tableId))

    if (!restoredFromCache && prevTableId != null && prevTableId !== tableId) {
      clearLayoutForTableTemplate()
      draftDirty = true
    }

    await loadTableTemplateColumns(tableId)
    if (loadGen !== loadContextGeneration || presetId !== currentId) {
      return { restoredFromCache, cleared: !restoredFromCache && prevTableId != null && prevTableId !== tableId }
    }

    activeTableTemplateId = tableId
    if (restoredFromCache) {
      finalizeLayoutForCurrentTable()
    }
    renderColumnPicker()
    syncPageNavColumnCheckboxes()
    await rebuildPreview([])
    return { restoredFromCache, cleared: !restoredFromCache && prevTableId != null && prevTableId !== tableId }
  }

  async function refreshPreviewContext() {
    const loadGen = loadContextGeneration
    const presetId = currentId
    const svgId = getSelectedSvgTemplateId()
    const tableId = getSelectedTableTemplateId()
    await Promise.all([
      loadSvgTemplate(svgId),
      loadTableTemplateColumns(tableId),
    ])
    if (loadGen !== loadContextGeneration || presetId !== currentId) return
    activeTableTemplateId = tableId
    finalizeLayoutForCurrentTable()
    renderColumnPicker()
    syncPageNavColumnCheckboxes()
    await rebuildPreview(layoutEditor?.getSelectedColumns?.() ?? [])
  }

  function populateTemplateSelects(preset = null) {
    if (svgSelectEl) {
      svgSelectEl.innerHTML = svgTemplates.length
        ? svgTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
        : '<option value="">（无 SVG 模板）</option>'
      const savedSvg = preset?.svg_template_id != null ? Number(preset.svg_template_id) : null
      const svgId = savedSvg && svgTemplates.some((t) => t.id === savedSvg)
        ? savedSvg
        : (svgTemplates[0]?.id ?? '')
      if (svgId) svgSelectEl.value = String(svgId)
    }
    if (tableSelectEl) {
      tableSelectEl.innerHTML = tableTemplates.length
        ? tableTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
        : '<option value="">（无表格模板）</option>'
      const savedTable = preset?.table_template_id != null ? Number(preset.table_template_id) : null
      const tableId = savedTable && tableTemplates.some((t) => t.id === savedTable)
        ? savedTable
        : (tableTemplates[0]?.id ?? '')
      if (tableId) tableSelectEl.value = String(tableId)
    }
  }

  async function loadDraftFromPreset(preset) {
    const session = await buildPresetTabSessionFromPreset(preset)
    if (!session) return

    presetTabSessionCache.set(preset.id, session)
    presetTabPreviewDomCache.delete(preset.id)
    if (!openTabIds.includes(preset.id)) openTabIds.push(preset.id)
    currentId = preset.id

    const loadGen = ++loadContextGeneration
    syncEditorVisibility()
    renderPresetTabs()
    renderPresetList()
    setPreviewLoading(true, preset.name || '')

    try {
      await applyPresetTabSession(session, loadGen)
    } finally {
      if (loadGen === loadContextGeneration && currentId === preset.id) {
        renderPresetTabs()
        renderPresetList()
        syncEditorVisibility()
      }
    }
  }

  function isLayoutPresetsViewActive() {
    const view = document.querySelector('#cms-view-layout-presets')
    if (view) return view.classList.contains('is-active')
    return document.body.classList.contains('layout-presets-page-standalone')
  }

  function isLayoutPresetsShortcutActive() {
    if (!isLayoutPresetsViewActive()) return false
    const artboard = queryPreviewArtboard(previewArea)
    if (!artboard?.isConnected || !artboard.getClientRects().length) return false
    if (layoutEditor) return true
    return !!artboard.querySelector('svg')
  }

  function suspendLayoutEditorInput() {
    layoutEditor?.cancelPendingKeyboardNudge?.()
  }

  async function duplicatePreset(id, { openAfter = true } = {}) {
    if (currentId) capturePresetTabSession(currentId)
    try {
      const { preset } = await api.getPreset(id)
      if (!preset) return null
      const rootName = String(preset.name || '布局').trim().replace(/\s+copy(?:\s+\d+)?$/i, '').trim() || '布局'
      let copyName = `${rootName} copy`
      let n = 2
      while (presets.some((p) => p.name === copyName)) {
        copyName = `${rootName} copy ${n}`
        n += 1
      }
      const payload = await presetBodyWithGroup({
        name: copyName,
        layout_overrides: preset.layout_overrides || {},
        preview_sample_row: preset.preview_sample_row || {},
        font_scale: preset.font_scale ?? 1,
        show_layout_boxes: preset.show_layout_boxes,
        show_reference_layer: preset.show_reference_layer,
        show_template_layer: preset.show_template_layer,
        page_width_mm: preset.page_width_mm ?? DEFAULT_PAGE_WIDTH_MM,
        page_height_mm: preset.page_height_mm ?? DEFAULT_PAGE_HEIGHT_MM,
        page_nav_column: preset.page_nav_column ?? '',
        svg_template_id: preset.svg_template_id ?? null,
        table_template_id: preset.table_template_id ?? null,
        group_id: preset.group_id ?? undefined,
      })
      if (!payload) return null
      const { id: newId } = await api.createPreset(payload)
      draftDirty = false
      await syncPresetsFromApi()
      if (!openTabIds.includes(newId)) openTabIds.push(newId)
      renderPresetTabs()
      renderPresetList()
      if (openAfter) await openPresetFromList(newId)
      options.onChange?.()
      setStatus(`已复制为「${copyName}」`)
      return newId
    } catch (err) {
      setStatus(err.message || '复制失败', true)
      return null
    }
  }

  async function savePresetNameFromTitle() {
    if (!currentId || !editorTitleEl) return
    const name = editorTitleEl.value.trim()
    if (!name) {
      const row = presets.find((p) => p.id === currentId)
      editorTitleEl.value = row?.name || '编辑布局'
      return
    }
    const row = presets.find((p) => p.id === currentId)
    if (row?.name === name) return
    try {
      await api.updatePreset(currentId, { name })
      patchPresetCache(currentId, { name })
      listEl.querySelectorAll('.layout-preset-list-name').forEach((el) => {
        const item = el.closest('.layout-preset-list-item')
        if (item && Number(item.dataset.id) === currentId) el.textContent = name
      })
      renderPresetTabs()
      options.onChange?.()
    } catch (err) {
      setStatus(err.message || '名称保存失败', true)
      if (row) editorTitleEl.value = row.name
    }
  }

  async function refreshList(selectId = currentId) {
    const ok = await syncPresetsFromApi()
    if (!ok) return

    if (openTabIds.length > 0 && (currentId == null || !openTabIds.includes(currentId))) {
      await switchPresetTab(openTabIds[openTabIds.length - 1])
      return
    }

    if (selectId != null && presets.some((p) => p.id === selectId)) {
      if (!openTabIds.includes(selectId)) {
        openTabIds.push(selectId)
      }
      if (currentId !== selectId) {
        await switchPresetTab(selectId)
      } else {
        syncEditorVisibility()
        renderPresetTabs()
        renderPresetList()
        const row = presets.find((p) => p.id === currentId)
        if (row) {
          currentPresetGroupId = row.group_id != null ? Number(row.group_id) : null
          renderPresetGroupField(currentPresetGroupId)
        }
      }
    } else {
      syncEditorVisibility()
    }
  }

  async function confirmDiscardDraft() {
    if (!draftDirty) return true
    const ok = window.confirm('当前布局有未保存修改，继续将丢失，确定？')
    if (ok) {
      draftDirty = false
      if (currentId) {
        presetTabSessionCache.delete(currentId)
        renderPresetTabs()
      }
    }
    return ok
  }

  saveBtn?.addEventListener('click', () => {
    void saveCurrentPreset({ revisionNote: '手动保存' })
  })

  revisionsBtn?.addEventListener('click', async () => {
    if (!currentId) return
    try {
      const { revisions } = await api.listPresetRevisions(currentId)
      revisionsListEl.innerHTML = revisions.length === 0
        ? '<li class="layout-preset-revisions-empty">暂无保存记录</li>'
        : revisions.map((r) => `
          <li>
            <span>${escapeHtml(r.note || '保存')} · ${formatPresetTime(r.created_at)}</span>
            <button type="button" class="button button-sm" data-rev="${r.id}">恢复</button>
          </li>
        `).join('')
      revisionsListEl.querySelectorAll('button[data-rev]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const revId = Number(btn.dataset.rev)
          if (!window.confirm('恢复此保存记录？当前未保存的修改将丢失。')) return
          try {
            const res = await api.restorePresetRevision(currentId, revId)
            if (!res.preset) throw new Error('恢复失败')
            await loadDraftFromPreset(res.preset)
            syncEditorVisibility()
            revisionsDialog?.close()
            setStatus('已恢复保存记录')
            await refreshList(currentId)
            options.onChange?.()
          } catch (err) {
            setStatus(err.message || '恢复失败', true)
          }
        })
      })
      revisionsDialog?.showModal()
    } catch (err) {
      setStatus(err.message || '加载保存历史失败', true)
    }
  })

  revisionsCloseBtn?.addEventListener('click', () => revisionsDialog?.close())

  copyBtn?.addEventListener('click', async () => {
    const ids = [...checkedPresetIds].filter((id) => presets.some((p) => p.id === id))
    if (!ids.length) return
    copyBtn.disabled = true
    try {
      for (let i = 0; i < ids.length; i++) {
        const newId = await duplicatePreset(ids[i], { openAfter: i === ids.length - 1 })
        if (newId == null) break
      }
    } finally {
      syncSidebarActions()
    }
  })

  setupDataTransferMenu(container, {
    prefix: 'layout-preset',
    onExport: async () => {
      try {
        const checked = [...checkedPresetIds].filter((id) => presets.some((p) => p.id === id))
        let ids = checked.length ? checked : null
        if (!checked.length && presets.length) {
          const ok = window.confirm('未勾选任何模板，是否导出全部布局模板？')
          if (!ok) return
        }
        const bundle = await api.exportLayoutPresets(ids)
        const stamp = new Date().toISOString().slice(0, 10)
        downloadJsonFile(`layout-presets-${stamp}.json`, bundle)
        setStatus(`已导出 ${bundle.item_count ?? bundle.items?.length ?? 0} 个布局模板`)
      } catch (err) {
        setStatus(err.message || '导出失败', true)
      }
    },
    onImport: async () => {
      try {
        const mode = askImportConflictMode()
        const bundle = await readJsonFile()
        const result = await api.importLayoutPresets(bundle, mode)
        alertImportDetails(result)
        await syncPresetsFromApi()
        if (result.ids?.length) await switchPresetTab(result.ids[result.ids.length - 1])
        options.onChange?.()
        setStatus(formatImportResultMessage(result, '布局模板'))
      } catch (err) {
        if (err?.message !== 'cancelled') setStatus(err.message || '导入失败', true)
      }
    },
  })

  deleteBtn?.addEventListener('click', async () => {
    if (!currentId) return
    const deletedId = currentId
    const row = presets.find((p) => p.id === deletedId)
    if (!window.confirm(`确定删除布局预设「${row?.name || deletedId}」？`)) return
    try {
      await api.deletePreset(deletedId)
      checkedPresetIds.delete(deletedId)
      presetTabSessionCache.delete(deletedId)
      presetTabPreviewDomCache.delete(deletedId)
      openTabIds = openTabIds.filter((id) => id !== deletedId)
      const nextTabId = openTabIds[openTabIds.length - 1] ?? null
      if (currentId === deletedId) {
        currentId = null
        draftDirty = false
        presetLoading = false
        presetLoadReady = false
        destroyLayoutEditor()
        if (nextTabId) {
          await switchPresetTab(nextTabId)
        } else {
          previewViewportInitialized = false
        }
      }
      await refreshList(currentId ?? nextTabId ?? undefined)
      options.onChange?.()
      setStatus('已删除')
    } catch (err) {
      setStatus(err.message || '删除失败', true)
    }
  })

  newBtn?.addEventListener('click', async () => {
    if (currentId) capturePresetTabSession(currentId)
    const name = window.prompt('布局预设名称', '新布局')
    if (name == null || !name.trim()) return
    try {
      const payload = await presetBodyWithGroup({
        name: name.trim(),
        layout_overrides: {},
        preview_sample_row: {},
        font_scale: 1,
        show_layout_boxes: false,
        show_reference_layer: false,
        show_template_layer: true,
        page_width_mm: DEFAULT_PAGE_WIDTH_MM,
        page_height_mm: DEFAULT_PAGE_HEIGHT_MM,
        svg_template_id: svgTemplates[0]?.id ?? null,
        table_template_id: tableTemplates[0]?.id ?? null,
      })
      if (!payload) return
      const { id } = await api.createPreset(payload)
      draftDirty = false
      await syncPresetsFromApi()
      if (!openTabIds.includes(id)) openTabIds.push(id)
      renderPresetTabs()
      renderPresetList()
      await openPresetFromList(id)
      options.onChange?.()
      setStatus('已创建，请调整后保存')
    } catch (err) {
      alert(err.message || '创建失败')
    }
  })

  svgSelectEl?.addEventListener('change', () => {
    draftDirty = true
    presetTabPreviewDomCache.delete(currentId)
    void (async () => {
      await refreshPreviewContext()
      await persistPresetTemplateRefs({ quiet: true })
      setStatus('有未保存的修改（SVG 模板选择已自动保存）')
    })()
  })

  pageNavColumnsEl?.addEventListener('change', (e) => {
    if (!e.target.matches('input[data-page-nav-col]')) return
    readPageNavColumnsFromUi()
    void (async () => {
      const ok = await persistPageNavColumn({ quiet: false })
      if (ok) setStatus('页码栏显示列已保存')
    })()
  })

  tableSelectEl?.addEventListener('change', () => {
    draftDirty = true
    presetTabPreviewDomCache.delete(currentId)
    void (async () => {
      const result = await applyTableTemplateSelection()
      await persistPresetTemplateRefs({ quiet: true })
      if (result?.restoredFromCache) {
        setStatus('有未保存的修改；已恢复该表格模板下的编辑内容（表格模板选择已自动保存）')
      } else if (result?.cleared) {
        setStatus('有未保存的修改；已切换表格模板，编辑框已清空（表格模板选择已自动保存）')
      } else {
        setStatus('有未保存的修改（表格模板选择已自动保存）')
      }
    })()
  })

  topUndoBtn?.addEventListener('click', () => performLayoutUndo())
  topRedoBtn?.addEventListener('click', () => performLayoutRedo())
  topSelectAllBtn?.addEventListener('click', () => selectAllLayoutBoxes())

  if (toolsRailStackEl) {
    mountPassthroughScrollStack(toolsRailStackEl)
    mountCollapsiblePanels(toolsRailStackEl)
    mountCollapsiblePanelReorderGroups(toolsRailStackEl, {
      storageKeys: {
        'layout-preset-rail': 'layout-preset-rail-order',
      },
      legacyStorageKeys: {
        'layout-preset-rail': ['layout-preset-panel-dock-order'],
      },
    })
    mountCollapsiblePanelResizeGroups(toolsRailStackEl, {
      storageKeys: {
        'layout-preset-rail': 'layout-preset-rail-panel-',
      },
    })
  }

  columnChecksEl?.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-delete-box-id], .layout-layer-visibility')) {
      e.preventDefault()
      e.stopPropagation()
    }
  })

  columnChecksEl?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-delete-box-id]')
    if (delBtn) {
      e.preventDefault()
      e.stopPropagation()
      permanentlyDeleteCustomBox(delBtn.dataset.deleteBoxId)
      return
    }

    const visBtn = e.target.closest('.layout-layer-visibility')
    if (visBtn) {
      e.preventDefault()
      e.stopPropagation()
      const row = visBtn.closest('.layout-layer-row')
      if (!row || !presetLoadReady || presetLoading) {
        if (!presetLoadReady || presetLoading) renderColumnPicker()
        return
      }
      const makeVisible = visBtn.getAttribute('aria-pressed') !== 'true'
      const layerId = row.dataset.layerId || ''
      logColumnCheck(`${layerId} 可见性 ${makeVisible ? '显示' : '隐藏'}`, { layerId })
      applyLayerVisibilityToggle(row, makeVisible)
      renderColumnPicker()
      return
    }

    const row = e.target.closest('.layout-layer-row')
    if (!row?.dataset.layerId) return
    const layerId = row.dataset.layerId
    if (!ensureLayoutEditorAttached()) return
    e.preventDefault()
    const current = layoutEditor.getSelectedColumns()
    if (e.shiftKey) {
      const next = current.includes(layerId)
        ? current.filter((id) => id !== layerId)
        : [...current, layerId]
      layoutEditor.selectColumns(next)
    } else {
      layoutEditor.selectColumns([layerId])
    }
  })

  addCustomBoxBtn?.addEventListener('click', () => {
    const { overrides, boxId } = createLayoutBox(layoutOverrides, null, defaultNewBoxBounds())
    turnOnLayoutBoxes()
    commitLayoutOverrides(overrides, {
      restoreSelection: [boxId],
      reason: '添加自定义文本框',
    })
    setStatus(`已添加自定义文本框「${boxId}」`)
  })

  pageWidthEl?.addEventListener('change', onPageSizeInputChange)
  pageHeightEl?.addEventListener('change', onPageSizeInputChange)
  templateBgLockBtn?.addEventListener('click', toggleTemplateBackgroundLock)

  copyBoxBtn?.addEventListener('click', () => {
    if (!ensureLayoutEditorAttached()) {
      setStatus('预览尚未就绪，请稍候再试', true)
      return
    }
    layoutEditor?.flushPendingState?.()
    const boxIds = getSelectedLayoutBoxIds()
    if (!boxIds.length) {
      setStatus('请先选中至少一个编辑框', true)
      return
    }
    handleCopyLayoutBoxes(boxIds)
  })

  pasteBoxBtn?.addEventListener('click', () => handlePasteLayoutBox())

  showBoxesEl?.addEventListener('change', () => {
    applyLayerToggles({
      showLayoutBoxes: !!showBoxesEl.checked,
      showReferenceLayer,
      showTemplateLayer,
    }, { persistBrowser: true })
    draftDirty = true
    setStatus('有未保存的修改')
  })

  showReferenceEl?.addEventListener('change', () => {
    applyLayerToggles({
      showLayoutBoxes,
      showReferenceLayer: !!showReferenceEl.checked,
      showTemplateLayer,
    }, { persistBrowser: true, refreshPreview: true })
    draftDirty = true
    setStatus('有未保存的修改')
  })

  showTemplateEl?.addEventListener('change', () => {
    applyLayerToggles({
      showLayoutBoxes,
      showReferenceLayer,
      showTemplateLayer: !!showTemplateEl.checked,
    }, { persistBrowser: true, refreshPreview: true })
    draftDirty = true
    setStatus('有未保存的修改')
  })

  overlayBorderEl?.addEventListener('change', () => {
    overlayShowBorder = !!overlayBorderEl.checked
    layoutEditor?.setOverlayVisual?.({ showBorder: overlayShowBorder })
  })

  overlayHandlesEl?.addEventListener('change', () => {
    overlayShowHandles = !!overlayHandlesEl.checked
    layoutEditor?.setOverlayVisual?.({ showHandles: overlayShowHandles })
  })

  editorTitleEl?.addEventListener('change', () => {
    void savePresetNameFromTitle()
  })
  editorTitleEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      editorTitleEl.blur()
    }
  })

  container.querySelector('#layout-preset-zoom-in')?.addEventListener('click', () => previewViewport.zoomIn())
  container.querySelector('#layout-preset-zoom-out')?.addEventListener('click', () => previewViewport.zoomOut())
  container.querySelector('#layout-preset-zoom-fit')?.addEventListener('click', () => previewViewport.fitView())

  samplePrevBtn?.addEventListener('click', () => {
    goToSamplePage(previewSamplePageIndex - 1)
  })
  sampleNextBtn?.addEventListener('click', () => {
    goToSamplePage(previewSamplePageIndex + 1)
  })

  listEl.addEventListener('dblclick', async (e) => {
    const btn = e.target.closest('.layout-preset-list-item')
    if (!btn) return
    const id = Number(btn.dataset.id)
    const row = presets.find((p) => p.id === id)
    if (!row) return
    const name = window.prompt('预设名称', row.name)
    if (name == null || !name.trim() || name.trim() === row.name) return
    try {
      await api.updatePreset(id, { name: name.trim() })
      await refreshList(id)
      options.onChange?.()
    } catch (err) {
      alert(err.message || '重命名失败')
    }
  })

  return {
    async init() {
      try {
        window.addEventListener('keydown', onDocumentKeydownSave)
        window.addEventListener('keydown', onDocumentKeydownUndoRedo, true)
        startAutosaveTimer()
        await ensureApiReady()
        bindPresetGroupSelectOnce()
        accessGroups = await loadAccessibleGroups()
        fontUrl = await resolveRuntimeFontUrl()
        fontCatalog = await loadFontCatalog()
        await ensureCatalogFontFaces(fontCatalog) // 失败项由 fontNotice 顶部栏提示，不阻塞

        const [svgRes, tableRes] = await Promise.all([
          api.listTemplates(),
          api.listTableTemplates(),
        ])
        svgTemplates = svgRes.templates || []
        tableTemplates = tableRes.templates || []
        populateTemplateSelects()
        applyLayerToggles(loadAdminLayoutLayerToggles(), { persistBrowser: false })
        bindPresetPanelEvents()
        await refreshList()
      } catch (err) {
        console.error(err)
        showListError(err.message || '加载布局预设失败')
      }
    },
    async repaint() {
      try {
        accessGroups = await loadAccessibleGroups(true)
        const [svgRes, tableRes] = await Promise.all([
          api.listTemplates(),
          api.listTableTemplates(),
        ])
        svgTemplates = svgRes.templates || []
        tableTemplates = tableRes.templates || []
        await refreshList(currentId)
        if (currentId && presetLoadReady) {
          await loadTableTemplateColumns(getSelectedTableTemplateId())
          await rebuildPreview(layoutEditor?.getSelectedColumns?.() ?? [])
        }
      } catch (err) {
        console.error(err)
        showListError(err.message || '加载布局预设失败')
      }
    },
    suspend() {
      suspendLayoutEditorInput()
      showPreviewIdle()
    },
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

if (document.body?.classList.contains('layout-presets-page-standalone')) {
  const next = new URL('/admin.html', window.location.origin)
  next.searchParams.set('view', 'layout-presets')
  window.location.replace(next.pathname + next.search)
}
