/**
 * dsh-ask-highlight · 宿主侧结构化类型
 *
 * 本文件与 dsh-enhancement 一样刻意不 `import` 任何 `@deepseek-ai/*`：
 * 外部插件在 profile 里无法可靠解析这些包，运行时 import 会直接崩。
 * 这里只用结构化类型描述宿主提供的切片，编辑期有类型、运行时不产生依赖。
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

/** 宿主 cordis Context 中本插件用到的切片。 */
export interface HostContextLike {
  webServer: WebServerLike
  logger?: LoggerLike
  get(name: string): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): unknown
}

/** `webserver/index-inject` 表格中本插件用到的行（来自 @deepseek-ai/dsh-host-webserver）。 */
export type IndexInjectionRow =
  | { kind: 'style'; text: string }
  | { kind: 'script'; placement: 'head' | 'body'; text: string }

/** 控制 API 返回给设置页的状态。 */
export interface StatusPayload {
  enabled: boolean
  defaultExpanded: boolean
  statePath: string
  stateDir: string
}
