/**
 * dsh-font-settings —— 宿主半侧。
 *
 * 插件条目（id: dsh-font-settings）导出一个 schemastery Config：字段标记
 * volatile 后，宿主设置文档把本条目暴露为同名设置命名空间
 * （dsh-font-settings），浏览器半侧绑定该命名空间读写 uiFont / monoFont，
 * 并应用到 `--dsw-font-family` / `--ds-font-family-code`。
 *
 * 运行时依赖：@deepseek-ai/schemastery（宿主进程提供）与 font-list
 * （跨平台字体枚举，随插件声明安装）。设置 UI（字体设置卡）由浏览器半侧
 * （src/client）注册。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 加载 dsh-settings 对 cordis Context 的类型增强（ctx.settings 成员）。
import type {} from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getFonts } from 'font-list'

/** 插件名（= cordis.patch.yml 行 id = 设置文档命名空间）。 */
export const name = 'dsh-font-settings'

/** 设置文档字段：正文/界面默认字体（空串 = 不覆盖，沿用 DSH 默认栈）。 */
export const UI_FONT_FIELD = 'uiFont'
/** 设置文档字段：等宽字体（空串 = 不覆盖）。 */
export const MONO_FONT_FIELD = 'monoFont'

/** 用户可见配置形态。 */
export interface Config {
  uiFont: string
  monoFont: string
}

/** volatile → 设置文档允许写入并持久化到 profile patch。 */
export const Config = z.object({
  uiFont: z.string().default('').volatile(),
  monoFont: z.string().default('').volatile(),
})

/**
 * 系统字体列表宿主服务。
 *
 * 经 Typert Gateway 暴露为 wire 命名空间 `dshFonts`
 * （HTTP: POST /api/dshFonts/list）。底层用 font-list 跨平台枚举
 * （macOS: 预编译 CoreText 二进制；Windows: PowerShell/VBS；Linux: fc-list），
 * 三平台共用同一条调用路径，浏览器半侧用同源 fetch 调用，
 * 无需权限弹窗、与浏览器无关。
 */
export class FontsController extends TypertRemoteService {
  private listPromise: Promise<string[]> | null = null

  constructor(ctx: Context) {
    super(ctx, 'dshFontList', { namespace: 'dshFonts' })
  }

  /** 返回去重排序的系统字体族名列表；枚举失败时返回空数组。 */
  @Remote
  async list(): Promise<string[]> {
    this.listPromise ??= getFonts({ disableQuoting: true })
      .then((fonts) =>
        [...new Set(fonts.map((family) => family.trim()).filter(Boolean))].sort((a, b) =>
          a.localeCompare(b),
        ),
      )
      .catch(() => [])
    return this.listPromise
  }
}

/**
 * 行存在即加载。设置表单派生自 Config；关闭自动生成页（auto: false），
 * 自建的设置行由浏览器半侧注册。
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  // 注册字体枚举服务：cordis Service 构造器自动注册，随本 fiber 卸载。
  new FontsController(ctx)
}
