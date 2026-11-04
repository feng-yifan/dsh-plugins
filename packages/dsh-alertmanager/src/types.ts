/**
 * dsh-alertmanager · 宿主侧结构化类型
 *
 * 与 dsh-enhancement / dsh-enter-plan-mode 一致：本文件刻意不 `import` 任何
 * `@deepseek-ai/*` 运行时导出。外部插件装进 profile 后无法可靠解析这些包，
 * 真正 import 会在加载时直接崩；这里只用结构化类型描述宿主提供的切片，
 * 编辑期有类型提示，运行时不产生任何依赖边。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 宿主 logger 中本插件用到的切片。 */
export interface LoggerLike {
  debug?(...args: unknown[]): void
  info?(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error?(...args: unknown[]): void
}

/** `webServer.register()` 接受的精确路径路由。 */
export interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** `ctx.webServer` 中本插件用到的切片。 */
export interface WebServerLike {
  register(route: WebRouteLike): () => void
}

/** `ctx.connection` 中本插件用到的切片；`requestRejection` 返回状态码即拒绝。 */
export interface ConnectionLike {
  requestRejection(req: IncomingMessage): number | undefined
}

/**
 * 凭据服务里的一条记录。真实类型是 `ApiKeyRecord | GrantRecord`，
 * 本插件只写 `{ kind: 'grant', payload }`，读时按 `kind === 'grant'` 过滤。
 */
export interface CredentialRecordLike {
  kind?: string
  payload?: unknown
}

/** `ctx.credentials` 中本插件用到的切片。key 在运行时是普通字符串。 */
export interface CredentialsLike {
  readRecord(key: string): Promise<CredentialRecordLike | undefined>
  modifyRecord(
    key: string,
    mutate: (current: CredentialRecordLike | undefined) => Promise<CredentialRecordLike | undefined>,
  ): Promise<CredentialRecordLike | undefined>
}

/** `ctx.workspaceRegistry.get()` 返回实体中本插件用到的字段。 */
export interface WorkspaceLike {
  id?: string
  path: string
  title?: string
}

/** `ctx.workspaceRegistry` 中本插件用到的切片。 */
export interface WorkspaceRegistryLike {
  get(id: string): WorkspaceLike | undefined
}

/** `sessionController.create()` 的返回值中本插件用到的字段。 */
export interface SessionCreateValueLike {
  sessionId: string
}

/** 首条用户消息的文本片段。 */
export interface PromptContentPartLike {
  type: 'text'
  text: string
}

/** `sessionController.prompt()` 中本插件用到的入参形状。 */
export interface SessionPromptRequestLike {
  requestId: string
  sessionId: string
  mode: 'queue' | 'steer'
  content: readonly PromptContentPartLike[]
}

/**
 * `ctx.sessionController` 中本插件用到的切片。
 *
 * `sessionController` 可能根本不存在（精简 profile / 无会话能力的部署），
 * 因此调用点先用 `ctx.get('sessionController')` 惰性解析，缺失时返回 503。
 * `rename` 在部分宿主版本里可能没有，因此按可选处理并尽力而为。
 */
export interface SessionControllerLike {
  create(request: { workspaceId: string }): Promise<SessionCreateValueLike>
  rename?(request: { sessionId: string; title: string }): Promise<unknown>
  prompt(request: SessionPromptRequestLike, signal: AbortSignal): Promise<unknown>
}

/** cordis Context 中本插件用到的切片。 */
export interface HostContextLike {
  webServer: WebServerLike
  logger?: LoggerLike
  get(name: string): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
}
