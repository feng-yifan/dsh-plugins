/**
 * dsh-at-enhancement
 *
 * 让 DSH Web GUI 的 `@` 文件补全可以逐级浏览并引用**工作区外**的绝对路径文件/目录。
 *
 * 现象：DSH 的 `@` 补全只列当前会话工作区（cwd）内的文件；宿主 provider 是
 * `@deepseek-ai/dsh-file-reference-local`（`LocalFileReferenceService`），对绝对
 * 路径查询返回 `[]`。
 *
 * 做法：本插件不改 DSH 自带的 provider，只通过 `ctx.inject(['fileReferences'])`
 * 等它就绪后，把它实例的 `list` 包装一层（见 external-file-references.ts）：
 *   - 普通查询（相对路径 / 关键词）→ 纯透传；
 *   - 外部查询（`/…`、`~`、`~/…`）→ 追加本地逐级列出的候选，与原生结果去重合并。
 * 浏览器端 `@` 补全因此能显示绝对路径候选（如 `/home/viktor/Documents/a.md`），
 * 选中后插入绝对路径；模型随后用 `read` 工具按绝对路径读取（读不受沙箱限制）。
 *
 * 配置 `enabled` 有多层来源，优先级从低到高：
 *   1. cordis 行的 `config`（profile 的 cordis.patch.yml，作为初始种子）；
 *   2. 设置页写入的 state.json（`$DSH_HOME/profiles/<profile>/fengyifan-dsh-at-enhancement/`）。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 运行时依赖（外部插件无法可靠解析这些
 * 包），所需类型在 types.ts 里结构化声明（与 dsh-enhancement 同款做法）。
 */
import { registerControl } from './control.js'
import { mountExternalFileReferences } from './external-file-references.js'
import { ConfigStore, configureStateDir } from './state.js'
import type { HostContextLike } from './types.js'

/**
 * cordis 行配置（profile 的 cordis.patch.yml 里写的那层）。
 *
 * 它只是**初始种子**：首次加载时若 state.json 不存在，用这里的值建立状态；
 * 之后以设置页写入的 state.json 为准。
 */
export interface Config {
  /** 总开关，默认 true。关闭后 `list` 纯透传，不追加大外部候选。 */
  enabled?: boolean
}

export const name = 'dsh-at-enhancement'

export const inject = ['webServer']

/**
 * 挂载插件：建立配置存储、包装宿主 fileReferences、注册控制 API。
 *
 * 包装后的 `list` 每次调用都读 store 的实时快照，所以设置页改完开关立即生效，
 * 无需重启 dsh。
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
  // 不改 DSH 自带 provider，只包它的 list；外部绝对路径逐级浏览由 listExternal 完成。
  const mount = mountExternalFileReferences(ctx, () => store.config)
  const disposeControl = registerControl(ctx, store, mount)
  ctx.effect?.(() => disposeControl, 'dsh-at-enhancement control API')
  ctx.logger?.info?.(`[dsh-at-enhancement] state: ${store.statePath}`)
}
