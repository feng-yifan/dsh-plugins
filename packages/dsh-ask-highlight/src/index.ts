/**
 * dsh-ask-highlight
 *
 * 对话线程「提问」块高亮。
 *
 * 现象：DSH 的 Web UI 里，ask_user_question 工具调用会渲染成一个
 * 「提问 n/n 已回答」行（等待中显示「等待回答」）。这类块是对话里的决策点，
 * 但外观与普通工具行无异，容易在长对话中漏看。
 *
 * 做法：经 `webserver/index-inject` 事件（与 dsh-vertical-layout 同一模式）
 * 在每次 index.html 渲染时注入一段 `<style>`，用稳定属性选择器
 * `[data-tool="ask_user_question"][data-state="ok"]` 给已答复的提问块套上
 * 柔和卡片样式：浅品牌色底 + 圆角。
 *   - `data-tool` / `data-state` 由 dsh-client-ui-tool 的 ToolRow 输出
 *     （`ok` = 已答复，也含已取消；`running` = 等待中），是稳定契约，
 *     不依赖 CSS Modules 哈希类名；
 *   - 颜色用 `--dsw-alias-state-business-primary` 主题令牌 +
 *     `color-mix`，明暗主题自适应；
 *   - 展开态的留白：内层内容卡片自带 `margin: 4px 0 4px 4px`，会把左留白
 *     撑得比右边宽；内容末尾的「检查」按钮 `opacity: 0` 却仍占约 26px 高，
 *     让底部凭空多出一截。这里把内容卡的水平/底部外边距归零、把「检查」
 *     按钮移出文档流，四边留白才一致。
 *
 * 配置 `defaultExpanded: true` 时再注入一段 `<script>`：把线程里所有提问块
 * 默认展开。折叠态的提问明细根本不在 DOM 里，CSS 无从显示，所以只能复用
 * DSH 自己的展开动作——按 `data-*` 契约找到披露行点一次；每个提问块只处理
 * 一次，用户手动收起后不会被再展开。
 *
 * 配置来源有两层，优先级从低到高：
 *   1. cordis 行的 `config`（profile 的 cordis.patch.yml，作为初始种子）；
 *   2. 设置页写入的 state.json（`$DSH_HOME/profiles/<profile>/fengyifan-dsh-ask-highlight/`）。
 * 设置页改的是第 2 层，改完刷新页面即生效，不需要重启 dsh。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 运行时依赖（外部插件无法可靠解析
 * 这些包），所需类型在 types.ts 里结构化声明（与 dsh-enhancement 同款做法）。
 */
import { registerControl } from './control.js'
import { ConfigStore, configureStateDir, type StoredConfig } from './state.js'
import type { HostContextLike, IndexInjectionRow } from './types.js'

// ---------------------------------------------------------------------------
// 插件配置
// ---------------------------------------------------------------------------

/**
 * cordis 行配置（profile 的 cordis.patch.yml 里写的那层）。
 *
 * 它只是**初始种子**：首次加载时若 state.json 不存在，用这里的值建立状态；
 * 之后以设置页写入的 state.json 为准。这样既保留了「配置文件即可用」，
 * 又让设置页的改动不会被 profile 文件覆盖回去。
 */
export interface Config {
  /** 总开关，默认 true。关闭后既不注入高亮样式，也不注入展开脚本。 */
  enabled?: boolean
  /**
   * 提问块是否默认为展开状态，默认 false。
   * true = 线程里每个提问块（等待回答 / 已答复 / 已取消）首次出现时自动展开；
   * 用户手动收起后不会被强行再展开。
   */
  defaultExpanded?: boolean
}

export const name = 'dsh-ask-highlight'

export const inject = ['webServer']

// ---------------------------------------------------------------------------
// 高亮样式
// ---------------------------------------------------------------------------

/**
 * 已答复提问块的柔和卡片高亮。选择器限定 `data-tool="ask_user_question"`
 * 且 `data-state="ok"`，等待中（running）/ 已中断（stopped）的提问块不受影响。
 *
 * 几何说明（数值来自 DSH 0.2.x 的工具行样式）：
 *  - 折叠态沿用 snug 内边距，展开态才换成统一 8px，避免折叠行比其它工具行高；
 *  - DisclosureRow 的真实结构是
 *      div[data-open] > ( div[data-disclosure-header] > div[data-disclosure-row] , 内容 )
 *    即 `[data-disclosure-row]` 嵌在 header 里，展开内容与 **header** 同级；
 *    展开与否看披露根节点上的 `data-open`，内容容器取 `[data-disclosure-header] + *`；
 *  - 内容卡（AskQuestionCard / ioCard）自带 `margin: 4px 0 4px 4px`，
 *    水平外边距归零后左右留白才相等；顶部 4px 保留作头部与内容的间隔；
 *  - 「检查」按钮在内容卡之后常驻（`opacity: 0` 仍占约 26px），改为绝对
 *    定位贴内容卡右上角，不再把卡片撑高。
 */
const HIGHLIGHT_CSS = `/* dsh-ask-highlight: 已答复的提问块（柔和卡片，明暗主题自适应） */
[data-tool='ask_user_question'][data-state='ok'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent);
  border-radius: var(--dsw-radius-lg, 10px);
  padding: 2px 6px;
}

/* 展开态：四边统一 8px（头部行本身是内容，不在留白之内） */
[data-tool='ask_user_question'][data-state='ok']:has([data-open]) {
  padding: 8px;
}

/* 展开内容容器作为「检查」按钮的定位参照 */
[data-tool='ask_user_question'][data-state='ok'] [data-disclosure-header] + * {
  position: relative;
}

/* 内容卡自带 4px 左/下外边距，会把留白撑成左宽右窄、底部多一截 */
[data-tool='ask_user_question'][data-state='ok'] [data-disclosure-header] + * > :first-child {
  margin-right: 0;
  margin-bottom: 0;
  margin-left: 0;
}

/* 「检查」按钮常驻但 opacity: 0，留在文档流里会凭空垫出约 26px 空白。
   改为贴内容卡右上角浮层（位置与 DSH 详情行的原生 .inspectButton 一致：
   top/right 12px），不再参与布局。 */
[data-tool='ask_user_question'][data-state='ok'] [data-disclosure-header] + * > button {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  margin: 0;
}
`

// ---------------------------------------------------------------------------
// 默认展开脚本
// ---------------------------------------------------------------------------

/**
 * 默认展开脚本。
 *
 * 折叠态的内容（提问明细卡）根本不在 DOM 里，因此「默认展开」只能复用
 * DSH 自己的展开动作：找到披露行并点一次。
 *
 * 稳定契约（均不依赖 CSS Modules 哈希类名）：
 *  - 提问块根节点带 `data-tool="ask_user_question"`；
 *  - 披露行是 `[data-disclosure-row]`，它嵌在 `[data-disclosure-header]` 里；
 *  - 展开时 DisclosureRow 根节点带 `data-open`，且内容作为 header 的下一个
 *    兄弟节点挂出（折叠时内容根本不在 DOM 里）；
 *  - 整行可点时（ToolRow 路径）披露行带 `data-expandable` 且带 `aria-expanded`；
 *  - 只有前置按钮可点时（QuestionToolRow 路径，提问行带「面板」按钮），
 *    披露行内是 `button[aria-expanded]`；
 *  - 行的稳定身份是祖先上的 `data-chat-call-id`（ToolCallTree 输出），但本脚本
 *    刻意**不用它记账**（原因见下）。
 *
 * 已处理的块按 **DOM 节点**记账（`WeakSet`），所以：
 *  - 用户手动收起后不会被再次展开——流式输出、滚动等后续 DOM 变更会让脚本反复
 *    sweep，若不记账，用户永远收不起某个块；
 *  - 切换会话后重新展开——DSH 切换会话时卸载并重建整棵子树，节点全新但 callId
 *    不变；按 callId 记账会把它们误判成「已处理」，这正是 1.1.0 的 bug。
 * 记账集合是页面内存里的 `WeakSet`，不落盘、不写配置，刷新页面即清空；节点被
 * 回收时其条目自动消失。
 *
 * 展开放在定时器里做，避免在 React 提交阶段同步 setState。
 */
const EXPAND_SCRIPT = `/* dsh-ask-highlight: 提问块默认展开 */
(() => {
  if (window.__dshAskHighlightExpand) return
  window.__dshAskHighlightExpand = true
  var done = new WeakSet()
  var ROOT = '[data-tool="ask_user_question"]'
  var expand = (root) => {
    if (done.has(root)) return
    var row = root.querySelector('[data-disclosure-row]')
    if (row === null) return
    var header = row.parentElement
    var open = root.querySelector('[data-open]') !== null
      || (header !== null && header.hasAttribute('data-disclosure-header') && header.nextElementSibling !== null)
    if (open) {
      done.add(root)
      return
    }
    var control = row.hasAttribute('data-expandable') ? row : row.querySelector('button[aria-expanded]')
    if (control === null) return
    done.add(root)
    control.click()
  }
  var visit = (node) => {
    if (!(node instanceof Element)) return
    if (node.matches(ROOT)) expand(node)
    var roots = node.querySelectorAll(ROOT)
    for (var i = 0; i < roots.length; i += 1) expand(roots[i])
  }
  var scheduled = false
  var sweep = () => {
    scheduled = false
    visit(document.body)
  }
  var schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(sweep, 0)
  }
  var start = () => {
    schedule()
    new MutationObserver((records) => {
      for (var i = 0; i < records.length; i += 1) {
        if (records[i].addedNodes.length > 0) {
          schedule()
          return
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  }
  if (document.body === null) document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
`

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

/**
 * 挂载插件：建立配置存储、注册控制 API，并在每次 index 渲染时按**当前**配置注入。
 *
 * 注入读的是 store 的实时快照（而不是启动时的闭包值），所以设置页改完配置后
 * 刷新页面即可看到效果，无需重启 dsh。
 * @param ctx - 宿主上下文。
 * @param rawConfig - cordis 行配置，仅作为首次建立 state.json 的种子。
 */
export function apply(ctx: HostContextLike, rawConfig?: Config): void {
  // 先尝试用 DSH 给出的权威 profile 目录定位状态文件
  const profileContext = ctx.get('profileContext') as { dir?: unknown } | undefined
  if (typeof profileContext?.dir === 'string' && profileContext.dir) {
    configureStateDir(profileContext.dir)
  }

  const store = new ConfigStore(rawConfig)
  ctx.logger?.info?.(`[dsh-ask-highlight] state: ${store.statePath}`)

  ctx.on?.('webserver/index-inject', (table) => {
    const current: StoredConfig = store.config
    if (!current.enabled) return
    ;(table as IndexInjectionRow[]).push({ kind: 'style', text: HIGHLIGHT_CSS })
    if (current.defaultExpanded) {
      ;(table as IndexInjectionRow[]).push({ kind: 'script', placement: 'body', text: EXPAND_SCRIPT })
    }
  })

  const disposeControl = registerControl(ctx, store)
  ctx.effect?.(() => disposeControl, 'dsh-ask-highlight control API')
}
