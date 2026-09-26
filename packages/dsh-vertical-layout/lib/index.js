/**
 * dsh-vertical-layout
 *
 * 竖屏布局优化插件（只在电脑屏幕上生效）。
 *
 * 现象：DSH 的 Web UI 由左（导航）、中（对话）、右（文件 / 终端等停靠面板）三列构成。
 * 在竖屏（窗口宽 < 高）上打开右侧停靠面板时，中间的对话区域会被挤压得很窄。
 *
 * 做法：当浏览器窗口为竖屏且运行在电脑上（主指针为 fine 且支持 hover）时，
 * 把三栏重新排布为「左列导航区 + 顶部停靠区 + 下方对话区」：
 *   - 导航区（原左栏）占满整个左列；
 *   - 文件 / 终端停靠面板移到顶部（右侧区域的顶部一行），对话区移到下方；
 *   - 框架 grid 恒为两行：顶部停靠轨道 + 下方对话轨道（1fr）。停靠轨道在
 *     面板打开时为停靠区高度、关闭时为 0——行数不变，开合由轨道高度插值完成；
 *   - 开合动画改由「停靠轨道高度」驱动：打开时面板从顶部滑出（轨道 0 → 高度），
 *     关闭时向顶部收回（高度 → 0），全程无宽度变化。原生的开合动画是「水平」
 *     的（列宽过渡 + dockkit 宿主 translateX 滑入），竖屏布局下不再需要，
 *     因此把框架过渡接管为仅 grid-template-rows、并把 dockkit 宿主的水平
 *     滑入覆盖为无（内容藏起改由行轨道 + 右栏 overflow:hidden 裁切承担）；
 *   - 对话与停靠区之间用 DSH 面板边界同款分隔线（--dsw-alias-border-l4）；
 *   - 分隔线上带一个拖拽条，像原生宽度把手一样拖拽调整停靠区高度；
 *   - 停靠区自身的 dockkit pane 左边框（原右侧布局残留观感）仅在打开态移除；
 *     导航的 border-right（导航与停靠区 / 对话区的灰色分界线）保留；
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
export const name = 'vertical-layout';
const DEFAULT_CONFIG = {
    enabled: true,
    topRatio: 0.4,
    topMin: 220,
};
// ---------------------------------------------------------------------------
// 注入脚本
// ---------------------------------------------------------------------------
/**
 * 生成注入到 index.html 的布局脚本。
 *
 * 脚本在页面加载时（body 顶部）执行：
 *  1. 电脑检测：`(hover: hover) and (pointer: fine)` 不满足（手机 / 平板）直接退出；
 *  2. 用 MutationObserver 等待三栏布局框架出现；
 *  3. 激活条件 = 电脑 + 竖屏 + 非全屏（与面板开合、主面板类型无关）。
 *     激活与面板开合无关——关闭态也必须保持布局，行动画才能在开合之间平滑插值；
 *     不采用 data-panel-conversation 门：该属性依赖 DSH 前端 ConversationMarker，
 *     实测在当前 DSH 下并不总是落在框架上，会让布局永远不激活；
 *  4. 激活时把三栏重排为「左列导航 + 顶部停靠区 + 下方对话区」：
 *     - 框架 grid 恒为两行（顶部停靠轨道 + 下方 1fr 对话轨道），停靠轨道
 *       开 = 停靠区高度、关 = 0（行数不变，轨道高度可插值 → 垂直滑出 / 收回）；
 *     - 导航区占满左列整高，右栏占据顶部行，对话区占据下方行（跨列轨道）；
 *     - 停靠面板铺满顶部整行（样式表 !important，React 重写内联 width 也不会失效）；
 *     - dockkit 宿主强制常显、无水平位移、无过渡——内容藏起改由行轨道高度 +
 *       右栏 overflow:hidden 裁切承担，从而让行轨道动画表现为垂直滑出 / 收回；
 *     - 框架过渡接管为仅 grid-template-rows（!important 压过原生列过渡）；
 *     - 打开态：保留导航的 border-right 分界线；移除停靠区自身 dockkit pane 的
 *       左边框（原右侧布局残留观感）；对话与停靠区之间用 DSH 现有的设计令牌
 *       画一条分隔线，并提供高度拖拽条；关闭态：恢复原生外观（无拖拽条 / 分隔线）；
 *  5. 条件不满足时（横屏 / 全屏 / 全局面板）清空全部内联样式并移除拖拽条；
 *  6. 电脑竖屏时无论面板开关，都把打开 / 收起按钮的图标旋转 90°，
 *     使其表示「面板在顶部」而非「面板在右侧」。
 *
 * 实现要点：
 *  - grid 行列位置、分隔线、拖拽条通过内联样式写入，优先级高于 CSS Modules；
 *  - 停靠面板宽度通过样式表 !important 写入——React 每次重渲染都会重写面板的
 *    内联 width，内联 !important 会被整条替换而失效，只有样式表规则（作用域为
 *    data-dsh-vertical-layout 属性）能持续生效，且随属性自动启停；
 *  - `--dsh-sidebar-width` 是面板协议变量（收起滑出用），本插件不覆盖它——
 *    竖屏下 dockkit 宿主已强制无位移，该变量失去作用；
 *  - 框架行轨道归本插件管理（内联 grid-template-rows），React 只重写它自己
 *    管理的列轨道与面板宽度，不触碰这里设置的属性。
 */
function buildLayoutScript(config) {
    const topRatio = Math.min(0.6, Math.max(0.2, config.topRatio));
    const topMin = Math.max(120, Math.floor(config.topMin));
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

  // 注入样式表（全部以 data-dsh-vertical-layout 属性为作用域，布局激活时自动
  // 生效、失活时自动失效）：
  //  - 框架过渡接管：开合动画由行轨道高度驱动（0 ↔ 停靠区高度），
  //    !important 压过原生 [data-animating] 的列过渡（同元素、非 !important）。
  //    [data-rightbar-instant] 与 prefers-reduced-motion 下禁用动画；
  //  - 停靠面板宽度：position:absolute 右锚定 + 内联固定宽，只有样式表 !important
  //    能在 React 每次重写内联 width 时持续压过；
  //  - dockkit 宿主（dock/empty/divider）默认在关闭态 visibility:hidden +
  //    translateX(var(--dsh-sidebar-width)) 水平藏起。竖屏下「藏起」改由行轨道
  //    高度 + 右栏 overflow:hidden 裁切承担（垂直方向），故强制宿主常显、无位移、
  //    无过渡——行轨道动画即表现为面板垂直滑出 / 收回；
  //  - 停靠区左缘竖线（dockkit 给最左列 pane 画的 border-left）只在打开态移除；
  //  - 高度拖拽条在框架开合动画期间隐藏（[data-animating]，含 600ms 兜底），
  //    动画结束后显示在停靠区底缘，避免动画中悬在对话区上方。
  ;(function injectStyles() {
    var css = '[data-dsh-vertical-layout]{transition:grid-template-rows var(--ds-transition-duration-slow,220ms) var(--ds-ease-in-out,ease)!important}' + '\\n' +
      '[data-dsh-vertical-layout][data-rightbar-instant]{transition:none!important}' + '\\n' +
      '@media (prefers-reduced-motion:reduce){[data-dsh-vertical-layout]{transition:none!important}}' + '\\n' +
      '[data-dsh-vertical-layout] [data-sidebar-right-panel]{width:100%!important}' + '\\n' +
      '[data-dsh-vertical-layout] [data-sidebar-right-panel] [data-dockkit-host],' +
      '[data-dsh-vertical-layout] [data-sidebar-right-panel] [data-dockkit-empty],' +
      '[data-dsh-vertical-layout] [data-sidebar-right-panel] [data-dockkit-divider]{transform:none!important;visibility:visible!important;transition:none!important}' + '\\n' +
      '[data-dsh-vertical-layout]:not([data-rightbar-collapsed]) [data-rightbar-col] [data-dockkit-pane]{border-left:none!important}' + '\\n' +
      // 拖拽高度条期间行值每帧变化，压掉过渡以免滞后（拖拽由 handle 在框架上打标）。
      '[data-dsh-vertical-layout][data-dsh-vertical-layout-dragging]{transition:none!important}' + '\\n' +
      '[data-dsh-vertical-layout][data-animating] [data-dsh-vertical-layout-height-handle]{visibility:hidden!important}' + '\\n' +
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

  // 布局激活条件：电脑 + 竖屏 + 非全屏。与面板开合、主面板类型无关——
  // 关闭态也必须保持布局，行动画才能在开合之间平滑插值。
  // （不采用 data-panel-conversation 门：该属性依赖 DSH 前端 ConversationMarker
  // 的设置，实测在当前 DSH 下并不总是落在框架上，会让布局永远不激活；
  // 竖屏下全局面板重排为下方行，宽度反而更充分，可接受。）
  function isActive(frame) {
    if (!desktopQuery.matches || !portraitQuery.matches) return false
    return !frame.hasAttribute('data-rightbar-fullscreen')
  }

  // 框架行模板：开 = 停靠区高度，关 = 0。行数恒为两行，轨道高度可直接插值
  // （minmax 区间不能插值，故这里用确定 px 值）。
  function rows(frame) {
    var open = !frame.hasAttribute('data-rightbar-collapsed')
    return (open ? dockHeight(frame) : 0) + 'px minmax(0, 1fr)'
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
      if (state.frame) state.frame.removeAttribute('data-dsh-vertical-layout-dragging')
    }
    handle.addEventListener('pointerdown', function (e) {
      if (pointerId !== null || !state.frame) return
      pointerId = e.pointerId
      startY = e.clientY
      startRatio = dockRatio
      handle.setPointerCapture(pointerId)
      handle.setAttribute('data-dragging', '')
      // 拖拽期间行值每帧更新，压掉行过渡以免停靠区高度滞后于指针。
      state.frame.setAttribute('data-dsh-vertical-layout-dragging', '')
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
    state.frame.style.gridTemplateRows = rows(state.frame)
    positionHeightHandle()
  }

  // 激活期恒生效的部分：行列位置、右栏裁切、把手覆盖。
  // 列轨道（宽度）仍由 React 管理，这里只重排行列位置：
  // 导航区占满左列整高；右栏在顶部行，对话区在底部行，二者都跨到最后一列。
  function applyPosition(frame) {
    state.sidebar.style.gridColumn = '1'
    state.sidebar.style.gridRow = '1 / -1'
    state.rightbar.style.gridColumn = '2 / -1'
    state.rightbar.style.gridRow = '1'
    state.center.style.gridColumn = '2 / -1'
    state.center.style.gridRow = '2'
    // 右栏行轨道高度归本插件管理：行动画期间（含收回）停靠区内容由行轨道 +
    // 这里裁切，不能溢出到对话区。
    state.rightbar.style.overflow = 'hidden'
    // 导航区整高，其拖拽把手也随之整高。
    var sidebarHandle = frame.querySelector('[data-side="sidebar"]')
    if (sidebarHandle) {
      sidebarHandle.style.setProperty('top', '0')
      sidebarHandle.style.setProperty('bottom', '0')
    }
    // 右栏不再位于右侧，其宽度把手没有意义，隐藏。
    var rightHandle = frame.querySelector('[data-side="rightbar"]')
    if (rightHandle) rightHandle.style.setProperty('display', 'none')
  }

  // 打开 / 关闭态差异部分：分隔线、高度拖拽条。关闭态恢复原生外观。
  function applyOpenState(frame) {
    var open = !frame.hasAttribute('data-rightbar-collapsed')
    if (open) {
      // 对话与停靠区之间的分隔线：border-bottom 随右栏（行轨道）高度定位，
      // 打开动画中会随停靠区一起下滑；关闭时先移除，停靠区收回为纯裁切。
      state.rightbar.style.setProperty('border-bottom', divider)
      // 导航的 border-right（与停靠区 / 对话区的灰色分界线）保留不动；
      // 停靠区自身 dockkit pane 的左边框（原右侧布局残留观感）由样式表在
      // 打开态移除，避免同一条边上两条线重叠。
      ensureHeightHandle()
      positionHeightHandle()
    } else {
      state.rightbar.style.removeProperty('border-bottom')
      removeHeightHandle()
    }
  }

  function refresh() {
    var frame = state.frame
    if (!frame) return
    if (isActive(frame)) {
      var wasActive = frame.hasAttribute('data-dsh-vertical-layout')
      applyPosition(frame)
      applyOpenState(frame)
      // 行轨道：先落行再挂属性——激活瞬间不触发行过渡（避免页面加载 / 退出
      // 全屏时闪动），此后开合 / 高度变化完全走行过渡。
      if (!wasActive) frame.style.gridTemplateRows = rows(frame)
      frame.setAttribute('data-dsh-vertical-layout', '')
      if (wasActive) frame.style.gridTemplateRows = rows(frame)
    } else {
      // 先摘属性（过渡规则随之失效）再清样式：清空即时生效，不会反向动画。
      frame.removeAttribute('data-dsh-vertical-layout')
      frame.style.gridTemplateRows = ''
      state.sidebar.style.gridColumn = ''
      state.sidebar.style.gridRow = ''
      state.rightbar.style.gridColumn = ''
      state.rightbar.style.gridRow = ''
      state.rightbar.style.removeProperty('overflow')
      state.rightbar.style.removeProperty('border-bottom')
      state.center.style.gridColumn = ''
      state.center.style.gridRow = ''
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
})()`;
}
// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
export function apply(ctx, rawConfig) {
    const config = { ...DEFAULT_CONFIG, ...rawConfig };
    if (!config.enabled)
        return;
    ctx.on('webserver/index-inject', (table) => {
        table.push({
            kind: 'script',
            placement: 'body',
            text: buildLayoutScript(config),
        });
    });
}
//# sourceMappingURL=index.js.map