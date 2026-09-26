/**
 * dsh-font-settings —— 浏览器半侧。
 *
 * 绑定宿主设置命名空间 dsh-font-settings（== 插件条目 id），把
 * uiFont / monoFont 应用到 `--dsw-font-family` / `--ds-font-family-code`，
 * 并在插件管理页（设置 → 插件 → 字体设置）提供配置卡。
 *
 * 表单思路（与 rewind 插件同款）：SettingsFormModel 包装 configForms 表单，
 * 「暂存 → 保存」——编辑只改草稿，保存按钮是草稿落库的唯一入口；
 * SettingsForm/SettingsValueField 由 @deepseek-ai/dsh-client-ui-primitives 提供。
 */
import { SettingsFormModel, settingsTextField } from '@deepseek-ai/dsh-client-ui-primitives'
import { FontCard, type FontCardInjected } from './FontCard'
import { applyFonts } from './fonts'
import { en, zh, type FontKey } from './locales'
import type { ClientContext, ConfigForm } from './types'
import { FONT_SETTINGS_NAMESPACE, MONO_FONT_FIELD, UI_FONT_FIELD, type FontSettings } from './constants'

/** 本特性设置行的文案命名空间。 */
export const SETTINGS_NS = 'settings.font'

export type { FontCardComponentProps, FontCardInjected } from './FontCard'
export type { FontKey } from './locales'
export type { FontSettings } from './constants'

/** 纤维注入：与本特性协作的浏览器插件服务（镜像运行版 ui-theme 客户端）。
 * 0.1.7-rc.1 无 `settingsScope`；configForms 由 ui-settings 客户端提供，
 * 写路径经其 remote.settings 传输。 */
export const inject = ['slots', 'locale', 'remote', 'configForms']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'dsh-font-settings: locales')

  const scope: ConfigForm<FontSettings> = ctx.configForms.get<FontSettings>(FONT_SETTINGS_NAMESPACE)

  // 持久值 → 主题变量：每次快照变更应用（含初始 ready）。启动即生效，
  // 与卡内「暂存实时预览」互补——这里是已落库的值，卡里额外跟随草稿。
  ctx.effect(() => {
    const sync = () => {
      const s = scope.getSnapshot()
      if (s.status !== 'ready') return
      applyFonts(s.value?.uiFont ?? '', s.value?.monoFont ?? '')
    }
    sync()
    return scope.subscribe(sync)
  }, 'dsh-font-settings: font application')

  // 表单模型：暂存 → 保存。store 供卡组件经 useFontCard 读取。
  const form = new SettingsFormModel(scope, [
    settingsTextField(UI_FONT_FIELD),
    settingsTextField(MONO_FONT_FIELD),
  ])
  const store = form.bind(() => ({
    ...form.shell(),
    uiFont: form.field(UI_FONT_FIELD),
    monoFont: form.field(MONO_FONT_FIELD),
  }))

  ctx.effect(() => () => form.dispose(), 'dsh-font-settings: form disposal')

  // 插件管理页（设置 → 插件 → 字体设置）的配置卡：与 rewind 插件同款，
  // key = 包名（插件管理器按包名分发每个 bundle 的配置面）。
  ctx.effect(() => {
    return ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: FONT_SETTINGS_NAMESPACE,
          locale: SETTINGS_NS,
          inject: (): FontCardInjected => ({ hooks: { fontCard: store }, ...form.actions() }),
        },
        FontCard,
      ),
    )
  }, 'dsh-font-settings: plugin config card')
}
