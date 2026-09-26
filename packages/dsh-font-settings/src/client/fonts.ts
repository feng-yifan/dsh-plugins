/**
 * 字体应用：把用户选择接到 DSH 主题变量上。
 *
 * `--dsw-font-family` / `--ds-font-family-code` 由 dsh-client-ui-theme 基础
 * :root 声明；这里用 documentElement 内联样式覆盖（内联样式优先于样式表，
 * 无需 !important）；用户选择为空时移除内联值、回落主题默认。
 */

/** DSH 默认界面字体栈（dsh-client-ui-theme 基础 :root）。 */
export const DEFAULT_UI_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'

/** DSH 默认等宽字体栈。 */
export const DEFAULT_MONO_STACK =
  '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"'

/** 用户字体前置到默认栈；用户字体缺的字（如生僻汉字）回落到默认栈。 */
export function buildStack(userFont: string, fallback: string): string {
  const family = userFont.trim().replace(/^["']+|["']+$/g, '')
  if (!family) return fallback
  return `"${family}", ${fallback}`
}

/** 应用到文档根元素。 */
export function applyFonts(uiFont: string, monoFont: string): void {
  const root = document.documentElement
  if (uiFont) root.style.setProperty('--dsw-font-family', buildStack(uiFont, DEFAULT_UI_STACK))
  else root.style.removeProperty('--dsw-font-family')
  if (monoFont) root.style.setProperty('--ds-font-family-code', buildStack(monoFont, DEFAULT_MONO_STACK))
  else root.style.removeProperty('--ds-font-family-code')
}
