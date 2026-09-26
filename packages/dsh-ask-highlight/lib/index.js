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
 *     `color-mix`，明暗主题自适应。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 运行时依赖（外部插件无法可靠解析
 * 这些包），所需类型均在本文件内结构化声明（与 dsh-vertical-layout 同款做法）。
 */
export const name = 'dsh-ask-highlight';
const DEFAULT_CONFIG = {
    enabled: true,
};
// ---------------------------------------------------------------------------
// 高亮样式
// ---------------------------------------------------------------------------
/**
 * 已答复提问块的柔和卡片高亮。选择器限定 `data-tool="ask_user_question"`
 * 且 `data-state="ok"`，等待中（running）/ 已中断（stopped）的提问块不受影响。
 */
const HIGHLIGHT_CSS = `/* dsh-ask-highlight: 已答复的提问块（柔和卡片，明暗主题自适应） */
[data-tool='ask_user_question'][data-state='ok'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent);
  border-radius: var(--dsw-radius-lg, 10px);
  padding: 2px 6px;
}
`;
// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
export function apply(ctx, rawConfig) {
    const config = { ...DEFAULT_CONFIG, ...rawConfig };
    if (!config.enabled)
        return;
    ctx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'style', text: HIGHLIGHT_CSS });
    });
}
//# sourceMappingURL=index.js.map