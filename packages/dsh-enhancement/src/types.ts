import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { TlsStatus } from './tls.js'

export interface NetworkInterfaceInfo {
  name: string
  address: string
  family: string
  internal: boolean
}

export interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebUpgradeRouteLike {
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

export interface WebServerLike {
  host: string
  port: number
  protocol: string
  getOrigin(): string
  register(route: WebRouteLike): () => void
  registerUpgrade?(route: WebUpgradeRouteLike): () => void
  tapIndex?(transform: (html: string) => string): () => void
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

export interface HostContextLike {
  webServer: WebServerLike
  logger?: LoggerLike
  get(name: string): unknown
  effect?(callback: () => void | (() => void), label?: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface PwaStatus {
  enabled: boolean
  name: string
  shortName: string
  display: 'standalone' | 'fullscreen' | 'minimal-ui'
  themeColor: string
  backgroundColor: string
  customIcons: string[]
  error: string | null
}

export interface PushStatus {
  enabled: boolean
  publicKey: string | null
  subscriptions: number
  subject: string
}

export interface NotifyStatus {
  enabled: boolean
  task: boolean
  ask: boolean
  approval: boolean
  denied: boolean
  subagent: boolean
  goal: boolean
  jobs: boolean
}

export interface StatusPayload {
  enabled: boolean
  running: boolean
  bindHost: string
  port: number
  url: string | null
  httpsMode: string
  passwordSet: boolean
  sessionDays: number
  loginThrottle: boolean
  dshSecretReady: boolean
  dshHost: string
  dshOrigin: string
  dshAccessUrl: string
  interfaces: NetworkInterfaceInfo[]
  stateDir: string
  statePath: string
  focusClients?: number
  error: string | null
  https: TlsStatus
  pwa: PwaStatus
  notify: NotifyStatus
  push: PushStatus
}
