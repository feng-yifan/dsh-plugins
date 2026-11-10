/**
 * dsh-at-enhancement · 宿主侧结构化类型
 *
 * 本文件与 dsh-enhancement / dsh-ask-highlight 一样刻意不 `import` 任何
 * `@deepseek-ai/*`：外部插件在 profile 里无法可靠解析这些包，运行时 import
 * 会直接崩。这里只用结构化类型描述宿主提供的切片，编辑期有类型、运行时不产生
 * 依赖。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebServerLike {
  host: string
  port: number
  protocol: string
  getOrigin(): string
  register(route: WebRouteLike): () => void
}

export interface ConnectionLike {
  requestRejection(req: IncomingMessage): number | undefined
}

export interface LoggerLike {
  debug?(...args: unknown[]): void
  info?(...args: unknown[]): void
  warn?(...args: unknown[]): void
  error?(...args: unknown[]): void
}

/**
 * 宿主 cordis Context 中本插件用到的切片。
 *
 * `inject(deps, callback)` 是 Cordis 提供的方法：依赖服务可用时运行 callback，
 * 服务变化会卸载并重跑；callback 的返回值作为清理函数。这里只声明本插件用到
 * 的形态，不引用宿主类型。
 */
export interface HostContextLike {
  webServer: WebServerLike
  logger?: LoggerLike
  get(name: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
  inject?(deps: string[], callback: (scope: unknown) => void | (() => void)): unknown
}

/** 文件引用候选，与宿主 `fileReferences.list` 的返回项形状一致。 */
export interface FileReferenceCandidateLike {
  path: string
  kind: 'file' | 'directory'
}

/** 宿主 `fileReferences` 服务中本插件依赖的方法（只声明 `list`）。 */
export interface FileReferenceServiceLike {
  list(agent: unknown, query: string, signal: AbortSignal): Promise<FileReferenceCandidateLike[]>
}

/** provider 挂载状态：active = 已包装宿主 provider；missing = 不可用已旁路。 */
export type ProviderStatus = 'active' | 'missing'

/** 控制 API 返回给设置页的状态。 */
export interface StatusPayload {
  enabled: boolean
  provider: ProviderStatus
  maxResults: number
  statePath: string
}
