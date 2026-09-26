/**
 * 与宿主半侧（src/index.ts）共享的常量。
 *
 * 浏览器半侧刻意不 import 任何 @deepseek-ai 包（客户端 bundle 纯净门禁：
 * 跨插件值导入是构建错误，运行时依赖由浏览器模块表以外部 require 提供）。
 * 因此常量在这里按值复制，改动需两侧同步。
 */

/** 设置文档命名空间（== 插件条目 id）。 */
export const FONT_SETTINGS_NAMESPACE = 'dsh-font-settings'
/** 界面默认字体字段。 */
export const UI_FONT_FIELD = 'uiFont'
/** 等宽字体字段。 */
export const MONO_FONT_FIELD = 'monoFont'

/** 命名空间 section 的用户可见形态（与宿主 Config 对齐）。 */
export interface FontSettings {
  uiFont: string
  monoFont: string
}
