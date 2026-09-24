# dsh-vertical-layout

**中文版** | [English](README.en.md)

DSH 竖屏布局优化插件：**只在电脑屏幕（非手机）上**，当浏览器窗口为竖屏时，把三栏布局重排为「左列导航区 + 右上文件 / 终端 + 右下对话」，让对话区在竖屏下获得完整宽度。

[![DSH 0.1.7-alpha.2](https://img.shields.io/badge/DSH-0.1.7--alpha.2-4f7cff)](https://github.com/feng-yifan/dsh-vertical-layout)

## 解决的问题

DSH 的 Web UI 由三列构成：左侧导航、中间对话、右侧承载文件与终端的停靠面板。

- 在**竖屏**（窗口宽 < 高，例如竖置显示器、窄窗口）上打开右侧面板时，中间对话区会被挤压到很窄，影响使用。
- 本插件在检测到「电脑 + 竖屏 + 右侧面板打开」时，把三栏重排为：
  - **左列**：导航区，占满整列高度；
  - **右上**：文件 / 终端停靠面板（高度约等于窗口高度的 40%，可配置，也可拖拽调整）；
  - **右下**：对话区，横跨导航区外的全部宽度；
  - 对话与停靠区之间画一条分隔线（使用 DSH 面板边界同款设计令牌 `--dsw-alias-border-l4`，与原生列边界渲染一致），分隔线上带一个**拖拽条**，像原生宽度把手一样拖拽调整停靠区高度；
  - 移除停靠区左缘的竖线（原右侧布局的 dockkit 左边框观感）——导航的 `border-right` 与停靠区 dockkit pane 的 `border-left` 一并移除，边界交给底色差异与底部分隔线；
  - 打开 / 收起按钮的图标旋转 90°，从「面板在右侧」变为「面板在顶部」。
- **手机 / 平板等触屏设备完全不受影响**：主指针为 `coarse` 时不注入任何样式，竖屏表现与原生 DSH 一致。

## 效果

| 环境 | 行为 |
| --- | --- |
| 电脑 · 横屏 | 不做任何改动（原生三列布局） |
| 电脑 · 竖屏 · 右侧面板关闭 | 不改动布局（仅打开按钮图标旋转，表示面板在顶部） |
| 电脑 · 竖屏 · 右侧面板打开 | 导航占左列整高；文件 / 终端在右上、对话在右下，之间有分隔线；可拖拽分隔线调整停靠区高度 |

## 安装

### 方式一：打包安装（推荐）

在仓库根目录构建产物（本仓库已提交 `lib/`，可直接安装）：

```sh
dsh plugin --profile web add ./dsh-vertical-layout
```

> 首次安装 pnpm 会链接本目录；如需从 git 安装，`prepare` 脚本会自动执行 `npm run build`（需要在 pnpm ≥ 10 中为 git 依赖授权 `allowBuilds`，参见 [DSH 插件发布文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)）。

安装后重启 `dsh web` 生效。

### 方式二：`--patch` 本地调试

不需要任何构建（依赖 Node ≥ 22.18 的原生 TypeScript type-stripping 直接加载源码）：

```sh
# 在仓库根目录
dsh web --patch ./cordis.dev.patch.yml
```

如需在更旧的 Node 上使用，先 `npm run build`，再把 `cordis.dev.patch.yml` 中插件的 `name` 改为 `./lib/index.js`。

## 配置

在 profile 的 `cordis.patch.yml`（或任意 overlay）中覆盖插件行：

```yaml
- id: vertical-layout
  name: dsh-vertical-layout
  config:
    enabled: true      # 总开关，默认 true
    topRatio: 0.4      # 右上停靠区初始高度 / 窗口高度，默认 0.4（限制在 0.2–0.6）
    topMin: 220        # 右上停靠区最小高度 px，默认 220
```

> 初始高度由 `topRatio` 决定；之后可以用分隔线上的拖拽条调整，会话内可调到
> 窗口高度的 0.15–0.7（且不小于 `topMin`）。

> 覆盖配置时 `name` 必须与插件行完全一致（打包安装为 `dsh-vertical-layout`，
> `--patch` 本地调试为解析后的 `file://...src/index.ts`），否则 patch 会因
> name 不匹配而跳过该行。

修改配置后需要重启 `dsh web`（index.html 注入发生在服务渲染时）。

## 工作原理

- 这是**宿主侧插件**，不构建任何客户端 bundle，不依赖前端 CSS Modules 哈希类名。
- 插件监听 `webserver/index-inject` 事件（与 DSH 内置 `ui-theme` 的 boot 注入同一模式），在每次 `index.html` 渲染时注入一段 `<script>`。
- 注入的脚本在浏览器中：
  1. 用 `matchMedia('(hover: hover) and (pointer: fine)')` 判断是否为电脑屏幕，手机 / 平板直接退出；
  2. 用 `MutationObserver` 等待三栏布局框架出现（`[data-rightbar-col]` 的父级）；
  3. 当「竖屏 + 右侧面板打开（无 `data-rightbar-collapsed`）+ 非全屏」时，重排 grid：
     - 框架变为两行：右上停靠区 + 右下对话区；列轨道（宽度）仍由 React 管理，右栏与对话区用 `grid-column: 2 / -1` 跨到最后一列轨道，从而覆盖整个右侧区域；
     - 导航区（原左栏）用 `grid-row: 1 / -1` 占满左列整高，并去掉其原生竖线（`border-right`）；停靠区 dockkit pane 的 `border-left`（`--dsw-alias-border-l4`）由样式表一并移除——这两条线都落在 x=280 上，正是“残留左边框”的来源，去掉后整条竖线消失；
     - 停靠面板铺满右上区域：通过注入的样式表规则 `[data-dsh-vertical-layout] [data-sidebar-right-panel] { width: 100% !important }` 实现——React 每次重渲染都会重写面板的内联 `width`，内联 `!important` 会被整条替换而失效，只有样式表规则能持续生效（并随 `data-dsh-vertical-layout` 属性自动启停）；
     - 右栏底部画分隔线（`0.5px solid var(--dsw-alias-border-l4)`——与 DSH 原生列边界同款：dockkit 给最左列 tabHost 画的左边框就是这一档，浅色主题渲染为 1px rgb(214,214,214)）；
     - 分隔线上放一个绝对定位的拖拽条：指针捕获 + `pointermove` 换算停靠区高度比例（钳制在 0.15–0.7），写入 `grid-template-rows` 并同步拖拽条位置；用 `ResizeObserver` 跟随导航宽度变化（拖拽左侧导航时）与窗口尺寸变化；
     - 右栏宽度把手隐藏（宽度由「铺满右上」取代），导航把手随之整高；
  4. 条件不满足（横屏 / 面板关闭 / 全屏 / 触屏）时清空全部内联样式、移除拖拽条，恢复原生布局；
  5. 电脑竖屏时（无论面板开关），把「打开右侧边栏」与「收起右侧边栏」按钮的图标旋转 90°——从「面板在右侧」（竖分隔线）变为「面板在顶部」（横分隔线在下方）。
- 全部改动在浏览器运行时内联完成，卸载插件后（重新加载页面）即完全还原。

## DSH 版本兼容

DSH 插件生态**没有专门的「支持版本」字段**：`dsh.bundle` manifest 只声明 `patch` 文件，不存在 `requiresVersion` / `minDshVersion` 之类的键。实际兼容性靠三种方式表达：

- **官方 bundle 用 peerDependencies 钉内部包版本**（例如 `"@deepseek-ai/dsh-llm": "0.1.7-alpha.2"`、`"@deepseek-ai/cordis": "~4.0.4"`）。profile 的 node_modules 会把它们解析到 DSH 安装里的内部包，因此 peer 范围就相当于「兼容 DSH 版本 X」的声明——本机 DSH 内部包不匹配时 pnpm 会警告或失败。
- **`engines` 只用来声明运行时（Node）要求**，与 DSH 版本无关：本插件声明 `"node": ">=22.18.0"`，因为 `--patch` 调试模式依赖 Node 原生 type-stripping 直接加载 TS 源码。
- **README 徽章标注实测版本**：本插件基于 DSH **`0.1.7-alpha.2`** 构建并验证。

**本插件如何约定**：刻意不钉任何版本、保持版本无关。作为宿主侧插件，它不 import 任何 `@deepseek-ai/*` 运行时包（声明 peerDependencies 也没有意义——profile 的 node_modules 里没有 `@deepseek-ai/dsh` 可解析，CLI 是全局的），只依赖稳定的 DOM 数据属性（`data-rightbar-col`、`data-sidebar-right-panel`、`data-sidebar-right-expand` 等）与设计令牌 CSS 变量（`--dsw-alias-border-l4`、`--dsw-alias-interactive-bg-hover`）。因此对 DSH 版本是松耦合：只有当 DSH 改名这些稳定属性或令牌时才会失效。升级 DSH 后启动时看一眼界面即可确认。

## 已知限制

- 窗口宽度过窄（约 < 700px，视侧边栏状态而定）时，DSH 原生逻辑判定“无空间”而无法打开右侧面板，本插件对此无能为力（这是框架的列宽求解决定的，不会造成回归）。
- 右侧面板处于全屏（`data-rightbar-fullscreen`）时插件不干预，面板照常覆盖整个窗口。
- 竖屏下隐藏了右栏宽度拖拽把手（宽度由“铺满右上”取代）；恢复横屏后把手自动恢复。拖拽左侧导航会按比例收窄停靠区（右侧区域总宽 = 窗口宽 − 导航宽），面板始终铺满该区域。
- 分隔线拖拽条只在竖屏激活布局时出现；停靠区高度调整仅会话内生效，刷新页面后回到 `topRatio`。
- 打开 / 收起按钮的图标旋转使用内联 `transform` 覆盖 DSH 自带的镜像变换，仅改变外观、不影响点击区域。
- 手机 / 平板完全跳过本插件，竖屏优化由其它移动端方案（如 dsh-web-mobile）负责。

## 验证

仓库自带 Playwright 验证脚本，覆盖五种场景（电脑竖屏生效 / 电脑横屏不干预 /
手机触屏不执行 / 平板触屏不干预 / 拖拽交互——导航拖拽后面板仍铺满、高度拖拽与钳制、收起再打开保留高度）：

```sh
pnpm add -D playwright        # 首次运行需要安装 playwright
node scripts/verify-layout.mjs "http://127.0.0.1:3090/?token=<TOKEN>"
```

## 开发

```sh
npm run build    # 编译 src/ 到 lib/（tsc）
npm run verify   # 仅类型检查
```

## License

MIT
