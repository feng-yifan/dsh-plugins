/**
 * dsh-enter-plan-mode
 *
 * 给 DSH 补一个**模型可调用**的「进入计划模式」工具。
 *
 * 缺口：DSH 内置的 `@deepseek-ai/dsh-plan-mode` 只提供离开方向的工具
 * （`exit_plan_mode`）和给人用的 `/plan` 斜杠命令。模型没有进入方向的工具，
 * 所以"先把方案想清楚再动手"只能靠用户在界面上敲命令才触发。
 *
 * 做法：注册一个无参数工具（名字见 `TOOL_NAME`，带 `dsh_` 前缀，理由见
 * `src/plan-mode-tool.ts` 文件头），调用时转发到宿主的
 * `planMode.set(agent, true)`，再把 `committed` / `queued` / `noop` 语义翻成
 * 模型能照做的下一步。
 *
 * 四个刻意选择：
 *
 *  1. **`planMode` 在工具执行期从 `exec.agent.ctx` 取，不从插件自身的上下文取。**
 *     这是实测结论，但**1.0.2 修正过一次**：`dsh-web-app` 把 plan-mode 从宿主
 *     平面禁掉（`- id: plan-mode` + `disabled: true`），改在**每个 agent preset
 *     的 group 里**挂载，并带 `isolate: { planMode: true }`。isolate 意味着
 *     服务实例存在一个 **realm 私有的 symbol** 下，而 `ctx.get()` 只走当前
 *     上下文那条 realm 链——所以 `apply()` 期的根上下文、工具执行期的
 *     `exec.agent.ctx`，**两者都拿不到**（1.0.1 以为前者不行、后者行，实测
 *     后者同样返回 undefined，于是 web profile 下永远报"计划模式不可用"）。
 *     正确入口是宿主的 `agentPresets.serviceFor(agent, 'planMode')`：它按 fiber
 *     归属查 store，能越过 realm。详见 `src/plan-mode-tool.ts` 的
 *     `resolvePlanModeService()`。
 *  2. **不声明 `inject: ['planMode']`。** 静态 inject 会让本插件在缺少
 *     plan-mode 的部署里永远"等待依赖"（app-boot 失败表：注入的服务不可用 →
 *     optional 条目警告并等待），插件行看起来装了却什么都不提供。而且按上面
 *     第 1 点，任何静态声明在那条 realm 链上都解析不到——静态 inject 在这里
 *     是死路。惰性取则让插件照常加载、工具照常出现在目录里，只在真被调用时
 *     给一条能照做的报错。`tools` 必须静态声明——注册时机不能等。
 *  3. **工具在计划模式未激活时也一直注册着。** 上游 `exit_plan_mode` 同样常驻，
 *     目的都是让请求里的工具目录跨模式切换保持稳定（否则每次进出计划模式都会
 *     打掉 prompt 缓存）。进入与否只改变系统提示里的 `plan:policy` 段落。
 *  4. **不 import 任何 `@deepseek-ai/*` 运行时导出。** 外部插件在 profile 里无法
 *     可靠解析这些包，真正 import 会在加载时崩；类型用 `src/types.ts` 里的结构化
 *     声明描述（与 dsh-ask-highlight / dsh-enhancement 同款）。
 */
import { createDefinition, registerTool, TOOL_NAME } from './plan-mode-tool.js'
import type { HostContextLike } from './types.js'

export {
  PACKAGE_NAME,
  TOOL_NAME,
  TOOL_PREFIX,
  TOOL_SUFFIX,
  UPSTREAM_EQUIVALENT_NAME,
  resolvePlanModeService,
} from './plan-mode-tool.js'
export type { EnterPlanModeResult, PlanModeOutcome } from './types.js'

export const name = 'dsh-enter-plan-mode'

/** 工具注册表必须在 apply 阶段就绪：注册时机不能等。 */
export const inject = ['tools']

/**
 * 挂载插件：注册「进入计划模式」工具。
 *
 * @param ctx 宿主 cordis 上下文。
 */
export function apply(ctx: HostContextLike): void {
  // 把 ctx 本身交给工具定义：planMode 在每次调用时从 agent 作用域解析，
  // 插件上下文只作兜底（plan-mode 仍挂在宿主平面的部署里靠它命中）。
  const dispose = registerTool(ctx.tools, createDefinition(ctx), ctx.logger)

  if (dispose === undefined) {
    // 名字被占用：registerTool 已经留了 warning。这里不再抛，避免把 profile
    // 里这条 optional 插件行拖成"启动失败"——插件本来就提供不了工具了。
    return
  }

  // 用 ctx.effect 持有撤销函数：插件重载/卸载时宿主自动撤销注册。
  ctx.effect?.(() => dispose, `dsh-enter-plan-mode: ${TOOL_NAME} tool`)
  ctx.logger?.info?.(`[dsh-enter-plan-mode] registered tool "${TOOL_NAME}"`)
}
