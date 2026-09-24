/**
 * dsh-vertical-layout
 *
 * 竖屏布局优化插件（只在电脑屏幕上生效）。
 *
 * 现象：DSH 的 Web UI 由左（导航）、中（对话）、右（文件 / 终端等停靠面板）三列构成。
 * 在竖屏（窗口宽 < 高）上打开右侧停靠面板时，中间的对话区域会被挤压得很窄。
 *
 * 做法：当浏览器窗口为竖屏且运行在电脑上（主指针为 fine 且支持 hover）时，
 * 把三栏重新排布为「左列导航区 + 右上文件 / 终端 + 右下对话」：
 *   - 导航区（原左栏）占满整个左列；
 *   - 文件 / 终端停靠面板移到右上（右侧区域的顶部一行），对话区移到右下；
 *   - 对话与停靠区之间用 DSH 面板边界同款分隔线（--dsw-alias-border-l4）；
 *   - 分隔线上带一个拖拽条，像原生宽度把手一样拖拽调整停靠区高度；
 *   - 去掉停靠区左缘的竖线（原右侧布局的 dockkit 左边框观感）——导航的
 *     border-right 与停靠区 pane 的 border-left 一并移除，边界交给底色差异
 *     与底部分隔线；
 *   - 打开 / 收起按钮的图标旋转 90°，从「面板在右侧」变为「面板在顶部」。
 * 手机 / 平板等触屏设备（主指针为 coarse）完全不受影响——脚本直接退出。
 *
 * 实现方式：这是宿主侧插件，不构建任何客户端 bundle。通过
 * `webserver/index-inject` 事件（与 ui-theme 的 boot 注入同一模式）在每次
 * index.html 渲染时注入一段 <script>。脚本在浏览器里等待布局框架出现，
 * 直接以内联样式重排三栏 grid，不依赖任何 CSS Modules 哈希类名，
 * 因此对 DSH 前端构建产物没有耦合。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 运行时依赖（外部插件无法可靠解析
 * 这些包），所需的类型均在本文件内结构化声明（与社区插件 dsh-web-mobile 同款做法）。
 */

// ---------------------------------------------------------------------------
// 结构化类型（仅在编辑期生效，运行时不产生任何 import）
// ---------------------------------------------------------------------------

/** `webserver/index-inject` 表格中的一行（来自 @deepseek-ai/dsh-host-webserver）。 */
type IndexInjectionRow =
  | { kind: 'global'; name: string; value: unknown }
  | { kind: 'script'; placement: 'head' | 'body'; text: string }
  | { kind: 'script-src'; placement: 'head' | 'body'; src: string }
  | { kind: 'script-preload'; src: string }
  | { kind: 'style'; text: string }
  | { kind: 'html'; placement: 'head' | 'body'; html: string }

/** 宿主 cordis Context 中本插件用到的切片。 */
interface HostContext {
  on(event: 'webserver/index-inject', listener: (table: IndexInjectionRow[]) => void): unknown
}

// ---------------------------------------------------------------------------
// 插件配置
// ---------------------------------------------------------------------------

/**
 * 插件配置，通过 cordis 行的 `config` 传入，例如：
 *
 * ```yaml
 * - id: vertical-layout
 *   name: dsh-vertical-layout
 *   config:
 *     topRatio: 0.45
 *     topMin: 240
 * ```
 *
 * 注意：这里只导出类型、不导出 Schemastery schema——外部插件无法可靠解析
 * `@deepseek-ai/schemastery`，因此由 `apply` 自行合并默认值。
 */
export interface Config {
  /** 总开关，默认 true。 */
  enabled?: boolean
  /** 右上停靠区高度占框架高度的比例（建议 0.2–0.6；分隔线拖拽条可调 0.15–0.7），默认 0.4。 */
  topRatio?: number
  /** 右上停靠区的最小高度（px），默认 220。 */
  topMin?: number
}

export const name = 'vertical-layout'

const DEFAULT_CONFIG: Required<Config> = {
  enabled: true,
  topRatio: 0.4,
  topMin: 220,
}

// ---------------------------------------------------------------------------
// 注入脚本
// ---------------------------------------------------------------------------

/**
 * 生成注入到 index.html 的布局脚本。
 *
 * 脚本在页面加载时（body 顶部）执行：
 *  1. 电脑检测：`(hover: hover) and (pointer: fine)` 不满足（手机 / 平板）直接退出；
 *  2. 用 MutationObserver 等待三栏布局框架出现；
 *  3. 在「竖屏 + 停靠面板打开 + 非全屏」时，把三栏重排为
 *     「左列导航 + 右上文件 / 终端 + 右下对话」：
 *     - 框架 grid 改为两行（右侧区域的顶部停靠区 + 下方对话区）；
 *     - 导航区占满左列整高，右栏占据右上，对话区占据右下（跨列轨道）；
 *     - 停靠面板铺满顶部整行（样式表 !important，React 重写内联 width 也不会失效）；
 *     - 去掉导航区与停靠区之间的竖线（原右侧布局残留的左边框观感），
 *       对话与停靠区之间用 DSH 现有的设计令牌画一条分隔线；
 *     - 分隔线上放一个拖拽条，像原生宽度把手一样拖拽调整停靠区高度；
 *  4. 条件不满足时（横屏 / 面板关闭 / 全屏 / 手机）清空全部内联样式并移除拖拽条；
 *  5. 电脑竖屏时无论面板开关，都把打开 / 收起按钮的图标旋转 90°，
 *     使其表示「面板在顶部」而非「面板在右侧」。
 *
 * 实现要点：
 *  - grid 行列位置、分隔线、拖拽条通过内联样式写入，优先级高于 CSS Modules；
 *  - 停靠面板宽度通过样式表 !important 写入——React 每次重渲染都会重写面板的
 *    内联 width / --dsh-sidebar-width，内联 !important 会被整条替换而失效，
 *    只有样式表规则（作用域为 data-dsh-vertical-layout 属性）能持续生效，
 *    且随属性自动启停；
 *  - React 只会重写它自己管理的那几个样式属性，不会触碰这里设置的属性。
 */
function buildLayoutScript(config: Required<Config>): string {
  const topRatio = Math.min(0.6, Math.max(0.2, config.topRatio))
  const topMin = Math.max(120, Math.floor(config.topMin))
  return `(() => {
  'use strict'
  // 电脑检测：主指针为 fine（鼠标 / 触控板）且支持 hover 才视为电脑屏幕。
  // 手机 / 平板的主指针为 coarse，直接退出——竖屏表现交给原生布局，本插件不干预。
  var desktopQuery = matchMedia('(hover: hover) and (pointer: fine)')
  if (!desktopQuery.matches) return

  // 同一页面重复注入时只生效一次（例如 profile 与 --patch 同时启用）。
  // 标记放在桌面判定之后：触屏设备上不设置，便于从控制台确认插件是否在起作用。
  if (window.__dshVerticalLayout) return
  window.__dshVerticalLayout = true

  var portraitQuery = matchMedia('(orientation: portrait)')
  // 对话与停靠区之间的分隔线：与 DSH 面板边界同款（dockkit 列边界用
  // --dsw-alias-border-l4，比导航的 l3 更深，实测渲染值一致）。
  var divider = '0.5px solid var(--dsw-alias-border-l4)'
  // 停靠区高度：初始来自配置（topRatio / topMin），可被分隔线上的拖拽条调整（会话内生效）。
  var dockRatio = Math.min(0.6, Math.max(0.2, ${topRatio}))
  var dockMin = Math.max(120, ${topMin})
  var RATIO_MIN = 0.15
  var RATIO_MAX = 0.7

  var state = { frame: null, sidebar: null, center: null, rightbar: null, observer: null, sizeObserver: null, heightHandle: null }

  // 注入样式表：
  //  - 停靠面板宽度用样式表 !important（React 每次重渲染都会重写面板的内联
  //    width / --dsh-sidebar-width，内联 !important 会被整条替换而失效，只有
  //    样式表规则能持续压过它）；
  //  - 停靠区左缘的竖线其实来自 dockkit 给最左列 tabHost（data-dockkit-pane）
  //    画的 border-left（--dsw-alias-border-l4）——右侧布局时它就是这个面板的
  //    “左边框”，移到顶部后跟着面板一起过来了。激活布局时去掉它，让 x=280
  //    整条无线，停靠区只保留底部一条分隔线。
  // 规则都以 data-dsh-vertical-layout 属性为作用域，布局激活时自动生效、失活时自动失效。
  ;(function injectStyles() {
    var css = '[data-dsh-vertical-layout] [data-sidebar-right-panel]{width:100%!important;--dsh-sidebar-width:100%!important}' + '\\n' +
      '[data-dsh-vertical-layout] [data-rightbar-col] [data-dockkit-pane]{border-left:none!important}' + '\\n' +
      '[data-dsh-vertical-layout-height-handle]{position:absolute;cursor:row-resize;touch-action:none;user-select:none;z-index:11;right:0;height:8px}' + '\\n' +
      '[data-dsh-vertical-layout-height-handle]:hover,[data-dsh-vertical-layout-height-handle][data-dragging]{background:var(--dsw-alias-interactive-bg-hover)}'
    var style = document.createElement('style')
    style.setAttribute('data-dsh-vertical-layout-styles', '')
    style.textContent = css
    document.head.appendChild(style)
  })()

  // 三栏框架 = 拥有 [data-rightbar-col] 子元素的 grid 容器。
  function findFrame() {
    var col = document.querySelector('[data-rightbar-col]')
    return col && col.parentElement ? col.parentElement : null
  }

  // 按 DOM 顺序定位三栏：…、sidebar、center、rightbar(col)、…。
  // 不依赖哈希类名；darwin 的 leadingBand 位于最前，用索引定位自动兼容。
  function locate(frame) {
    var children = frame.children
    var idx = -1
    for (var i = 0; i < children.length; i++) {
      if (children[i].hasAttribute('data-rightbar-col')) {
        idx = i
        break
      }
    }
    if (idx < 2) return null
    return { sidebar: children[idx - 2], center: children[idx - 1], rightbar: children[idx] }
  }

  function clearHandleOverrides(frame) {
    if (!frame) return
    var sidebarHandle = frame.querySelector('[data-side="sidebar"]')
    if (sidebarHandle) {
      sidebarHandle.style.removeProperty('top')
      sidebarHandle.style.removeProperty('bottom')
    }
    var rightHandle = frame.querySelector('[data-side="rightbar"]')
    if (rightHandle) rightHandle.style.removeProperty('display')
  }

  // 停靠区高度（px）：比例 × 框架高度，不小于最小高度。
  function dockHeight(frame) {
    var h = frame ? frame.getBoundingClientRect().height : 0
    if (!(h > 0)) return dockMin
    return Math.max(dockMin, Math.round(dockRatio * h))
  }

  // 框架 grid 两行：顶部停靠区 + 下方对话区。
  function rows() {
    return 'minmax(' + dockMin + 'px, ' + Math.round(dockRatio * 1000) / 10 + '%) minmax(0, 1fr)'
  }

  // 打开 / 收起按钮的图标：竖屏（电脑）时旋转 90°（顺时针），把「竖分隔线
  // = 面板在右侧」变成「横分隔线在下方 = 面板在顶部」。与面板开合无关——
  // 收起时对话头部的展开按钮同样应指向「面板在顶部」。
  function applyIconRotation() {
    if (!state.frame) return
    var rotate = desktopQuery.matches && portraitQuery.matches
    var expandSvg = document.querySelector('[data-sidebar-right-expand] svg')
    var collapseSvg = document.querySelector('[data-sidebar-right-toggle] svg')
    if (rotate) {
      if (expandSvg) expandSvg.style.transform = 'rotate(90deg)'
      if (collapseSvg) collapseSvg.style.transform = 'rotate(90deg)'
    } else {
      if (expandSvg) expandSvg.style.removeProperty('transform')
      if (collapseSvg) collapseSvg.style.removeProperty('transform')
    }
  }

  // 分隔线上的拖拽条：像原生宽度把手一样，用指针捕获拖拽调整停靠区高度。
  function ensureHeightHandle() {
    if (state.heightHandle || !state.frame) return
    var handle = document.createElement('div')
    handle.setAttribute('data-dsh-vertical-layout-height-handle', '')
    var pointerId = null
    var startY = 0
    var startRatio = dockRatio
    function endDrag(e) {
      if (e.pointerId !== pointerId) return
      pointerId = null
      handle.removeAttribute('data-dragging')
    }
    handle.addEventListener('pointerdown', function (e) {
      if (pointerId !== null || !state.frame) return
      pointerId = e.pointerId
      startY = e.clientY
      startRatio = dockRatio
      handle.setPointerCapture(pointerId)
      handle.setAttribute('data-dragging', '')
      e.preventDefault()
    })
    handle.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pointerId || !state.frame) return
      var fb = state.frame.getBoundingClientRect()
      if (!(fb.height > 0)) return
      dockRatio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, startRatio + (e.clientY - startY) / fb.height))
      applyDockLayout()
    })
    handle.addEventListener('pointerup', endDrag)
    handle.addEventListener('pointercancel', endDrag)
    state.frame.appendChild(handle)
    state.heightHandle = handle
  }

  function removeHeightHandle() {
    if (!state.heightHandle) return
    state.heightHandle.remove()
    state.heightHandle = null
  }

  // 拖拽条位置：横跨停靠区宽度，中心压在分隔线上（top = 停靠区高度 - 4px）。
  function positionHeightHandle() {
    var handle = state.heightHandle
    if (!handle || !state.frame || !state.sidebar) return
    var fb = state.frame.getBoundingClientRect()
    var sb = state.sidebar.getBoundingClientRect()
    handle.style.top = (dockHeight(state.frame) - 4) + 'px'
    handle.style.left = (sb.right - fb.left) + 'px'
  }

  // 应用当前停靠区高度（框架行高 + 拖拽条位置）。
  function applyDockLayout() {
    if (!state.frame) return
    state.frame.style.gridTemplateRows = rows()
    positionHeightHandle()
  }

  function refresh() {
    var frame = state.frame
    if (!frame) return
    var open = !frame.hasAttribute('data-rightbar-collapsed')
    var fullscreen = frame.hasAttribute('data-rightbar-fullscreen')
    var active = desktopQuery.matches && portraitQuery.matches && open && !fullscreen
    if (active) {
      applyDockLayout()
      frame.setAttribute('data-dsh-vertical-layout', '')
      // 导航区占满左列整高；右栏（文件 / 终端）在右上，对话区在右下。
      // 列轨道（宽度）仍由 React 管理，这里只重排行列位置：
      // 右栏与对话区都跨到最后一列轨道，从而覆盖整个右侧区域。
      state.sidebar.style.gridColumn = '1'
      state.sidebar.style.gridRow = '1 / -1'
      // 左侧导航的原生竖线（border-right）正好落在停靠区左缘，看起来像停靠区
      // 残留的左边框：激活布局时去掉它（停靠区自身的 dockkit pane 左边框由
      // 样式表一并移除），x=280 整条无线，边界交给底色差异与底部分隔线。
      state.sidebar.style.borderRight = 'none'
      state.rightbar.style.gridColumn = '2 / -1'
      state.rightbar.style.gridRow = '1'
      state.center.style.gridColumn = '2 / -1'
      state.center.style.gridRow = '2'
      // 对话与停靠区之间的分隔线。
      state.rightbar.style.setProperty('border-bottom', divider)
      ensureHeightHandle()
      // 导航区整高，其拖拽把手也随之整高。
      var sidebarHandle = frame.querySelector('[data-side="sidebar"]')
      if (sidebarHandle) {
        sidebarHandle.style.setProperty('top', '0')
        sidebarHandle.style.setProperty('bottom', '0')
      }
      // 右栏不再位于右侧，其宽度把手没有意义，隐藏。
      var rightHandle = frame.querySelector('[data-side="rightbar"]')
      if (rightHandle) rightHandle.style.setProperty('display', 'none')
    } else {
      frame.style.gridTemplateRows = ''
      frame.removeAttribute('data-dsh-vertical-layout')
      state.sidebar.style.gridColumn = ''
      state.sidebar.style.gridRow = ''
      state.sidebar.style.borderRight = ''
      state.rightbar.style.gridColumn = ''
      state.rightbar.style.gridRow = ''
      state.center.style.gridColumn = ''
      state.center.style.gridRow = ''
      state.rightbar.style.removeProperty('border-bottom')
      clearHandleOverrides(frame)
      removeHeightHandle()
    }
    applyIconRotation()
  }

  // 等待框架出现 / 被替换（布局插件 HMR 重挂载会生成新框架）。
  function ensure() {
    var frame = findFrame()
    if (!frame) return
    var parts = locate(frame)
    if (!parts) return
    if (state.frame === frame) return
    if (state.observer) state.observer.disconnect()
    if (state.sizeObserver) state.sizeObserver.disconnect()
    state.frame = frame
    state.sidebar = parts.sidebar
    state.center = parts.center
    state.rightbar = parts.rightbar
    state.observer = new MutationObserver(refresh)
    state.observer.observe(frame, {
      attributes: true,
      attributeFilter: ['data-rightbar-collapsed', 'data-rightbar-fullscreen']
    })
    // 拖拽左侧导航会改变导航宽度、窗口尺寸变化会改变框架高度，这些都会影响
    // 停靠区 / 拖拽条的几何位置，用 ResizeObserver 跟进，保证拖拽条不滞后。
    if (typeof ResizeObserver !== 'undefined') {
      state.sizeObserver = new ResizeObserver(function () { schedule() })
      state.sizeObserver.observe(state.sidebar)
      state.sizeObserver.observe(frame)
    }
    refresh()
  }

  // rAF 合批：聊天流式渲染会高频触发 DOM 变更，ensure/refresh 很廉价，但没必要每帧都跑。
  // ensure 负责框架出现 / 被替换时重建状态，refresh 负责按当前状态应用或清空样式。
  var raf = null
  function schedule() {
    if (raf !== null) return
    raf = requestAnimationFrame(function () {
      raf = null
      ensure()
      refresh()
    })
  }

  var treeObserver = new MutationObserver(schedule)
  treeObserver.observe(document.documentElement, { childList: true, subtree: true })

  if (portraitQuery.addEventListener) {
    portraitQuery.addEventListener('change', schedule)
    desktopQuery.addEventListener('change', schedule)
  } else {
    portraitQuery.addListener(schedule)
    desktopQuery.addListener(schedule)
  }
  window.addEventListener('resize', schedule)

  ensure()
})()`
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export function apply(ctx: HostContext, rawConfig?: Config): void {
  const config: Required<Config> = { ...DEFAULT_CONFIG, ...rawConfig }
  if (!config.enabled) return
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'script',
      placement: 'body',
      text: buildLayoutScript(config),
    })
  })
}
