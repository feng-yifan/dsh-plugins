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
/** `webserver/index-inject` 表格中的一行（来自 @deepseek-ai/dsh-host-webserver）。 */
type IndexInjectionRow = {
    kind: 'global';
    name: string;
    value: unknown;
} | {
    kind: 'script';
    placement: 'head' | 'body';
    text: string;
} | {
    kind: 'script-src';
    placement: 'head' | 'body';
    src: string;
} | {
    kind: 'script-preload';
    src: string;
} | {
    kind: 'style';
    text: string;
} | {
    kind: 'html';
    placement: 'head' | 'body';
    html: string;
};
/** 宿主 cordis Context 中本插件用到的切片。 */
interface HostContext {
    on(event: 'webserver/index-inject', listener: (table: IndexInjectionRow[]) => void): unknown;
}
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
    enabled?: boolean;
    /** 顶部停靠区高度占框架高度的比例（建议 0.2–0.6；分隔线拖拽条可调 0.15–0.7），默认 0.4。 */
    topRatio?: number;
    /** 顶部停靠区的最小高度（px），默认 220。 */
    topMin?: number;
}
export declare const name = "vertical-layout";
export declare function apply(ctx: HostContext, rawConfig?: Config): void;
export {};
//# sourceMappingURL=index.d.ts.map