/**
 * dsh-enter-plan-mode · 宿主侧结构化类型
 *
 * 与 dsh-ask-highlight / dsh-enhancement 一致：本文件刻意不 `import` 任何
 * `@deepseek-ai/*` 运行时导出。外部插件装进 profile 后无法可靠解析这些包，
 * 真正 import 会在加载时直接崩；这里只用结构化类型描述宿主提供的切片，
 * 编辑期有类型提示，运行时不产生任何依赖边。
 */

/** 宿主 logger 中本插件用到的切片。 */
export interface LoggerLike {
  debug?(...args: unknown[]): void
  info?(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error?(...args: unknown[]): void
}

/** 一个已注册工具的读视图（`ctx.tools.get()` 的返回值中本插件用到的部分）。 */
export interface ToolDefinitionLike {
  name: string
}

/**
 * `@deepseek-ai/dsh-tools` 的 ToolRuntime 中本插件用到的切片。
 *
 * `register` 在同层遇到重名会同步抛错（`NamedEntries.insert`），因此调用点
 * 必须自己兜住——见 `src/index.ts` 里的注册流程。
 */
export interface ToolsLike {
  register(definition: ToolDefinitionLike & Record<string, unknown>): () => void
  get(name: string): ToolDefinitionLike | undefined
}

/** 计划模式切换的结果语义，取自 `@deepseek-ai/dsh-plan-mode` 的 `set()`。 */
export type PlanModeOutcome = 'committed' | 'queued' | 'cancelled' | 'noop'

/** 本插件工具返回给模型的结构化结果，同时也是 output schema 的形状。 */
export interface EnterPlanModeResult {
  /** `set()` 的原始结果，保留它便于诊断工具调用期的边界情况。 */
  outcome: PlanModeOutcome
  /** 调用之后计划模式是否已在生效。 */
  active: boolean
  /** 是否还有一次未生效的切换在等下一个被接受的 pre-step。 */
  pending: boolean
}

/** `ctx.planMode` 服务中本插件用到的切片。 */
export interface PlanModeLike {
  /** 读取当前会话的计划模式状态；`pending` 表示还有一次未生效的切换。 */
  get(agent: unknown): { active: boolean; pending?: boolean }
  /** 请求把该会话切到计划模式。 */
  set(agent: unknown, active: boolean): PlanModeOutcome
}

/**
 * cordis Context 中本插件用到的切片。
 *
 * `get` 用来**惰性**解析 `planMode`：部署里可能根本没装
 * `@deepseek-ai/dsh-plan-mode`，那种情况下插件应当照常加载、只在工具被调用时
 * 给出可操作的报错，而不是让整条插件行因为缺少注入服务而永远等待。
 */
export interface HostContextLike {
  tools: ToolsLike
  logger?: LoggerLike
  get(name: string): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
}

/** 工具执行上下文（`exec`）中本插件用到的切片。 */
export interface ToolExecutionContextLike {
  /** 发起本次调用的 agent；没有它就没有可切换的会话。 */
  agent?: unknown
}
