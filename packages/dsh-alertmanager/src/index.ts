/**
 * dsh-alertmanager host half.
 *
 * 在 DSH Web 服务器上挂四个同源路由：
 *   GET  /_dsh/alertmanager/settings  读设置（不含 secret）
 *   POST /_dsh/alertmanager/settings  保存设置
 *   GET  /_dsh/alertmanager/alerts    拉取并归一化实时告警
 *   POST /_dsh/alertmanager/dispatch  在指定工作区新建会话并派发告警
 *
 * 设置存 DSH 凭据服务；其它宿主服务（connection / sessionController /
 * workspaceRegistry）都按需惰性获取，缺失时返回可读 503，不让插件激活失败。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AlertmanagerError, AlertmanagerSource } from './alertmanager.js'
import { dispatchAlerts, DispatchError } from './dispatch.js'
import { publicSettings, readSettings, saveSettings, SettingsError } from './settings.js'
import type {
  ConnectionLike,
  CredentialsLike,
  HostContextLike,
  SessionControllerLike,
  WorkspaceRegistryLike,
} from './types.js'

export const name = 'dsh-alertmanager'
export const inject = ['webServer']

const PREFIX = '/_dsh/alertmanager'

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

/** 照抄 dsh-enhancement：只有通过 Host/Origin 围栏且携带有效浏览器会话的请求才放行。 */
function authorized(ctx: HostContextLike, req: IncomingMessage): number | null {
  const connection = ctx.get('connection') as ConnectionLike | undefined
  if (!connection || typeof connection.requestRejection !== 'function') return 503
  try {
    const rejection = connection.requestRejection(req)
    return rejection === undefined ? null : rejection
  } catch {
    return 503
  }
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

function credentialsOf(ctx: HostContextLike): CredentialsLike | undefined {
  const value = ctx.get('credentials') as
    | { readRecord?: unknown; modifyRecord?: unknown }
    | undefined
  if (
    value === undefined ||
    typeof value.readRecord !== 'function' ||
    typeof value.modifyRecord !== 'function'
  ) {
    return undefined
  }
  return value as unknown as CredentialsLike
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ErrorResult {
  status: number
  message: string
  sessionId?: string
}

function classify(error: unknown): ErrorResult {
  if (error instanceof DispatchError) {
    return { status: error.status, message: error.message, sessionId: error.sessionId }
  }
  if (error instanceof SettingsError) return { status: error.status, message: error.message }
  if (error instanceof AlertmanagerError) return { status: error.status, message: error.message }
  // readJson 的解析/大小错误按客户端错误处理；其余未知错误 500。
  if (error instanceof SyntaxError) return { status: 400, message: '请求体不是合法 JSON' }
  if (error instanceof Error && (error.message === '请求体过大' || error.message === '请求体必须是 JSON 对象')) {
    return { status: 400, message: error.message }
  }
  return { status: 500, message: `内部错误：${messageOf(error)}` }
}

export function apply(ctx: HostContextLike): void {
  const source = new AlertmanagerSource()
  const disposers: Array<() => void> = []

  const wrap = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) => {
    return (req: IncomingMessage, res: ServerResponse) => {
      void Promise.resolve(handler(req, res)).catch((error: unknown) => {
        const result = classify(error)
        ctx.logger?.warn?.('[dsh-alertmanager] request failed', result.message)
        if (!res.headersSent) {
          const payload =
            result.sessionId === undefined
              ? { error: result.message }
              : { error: result.message, sessionId: result.sessionId }
          json(res, result.status, payload)
        } else {
          res.end()
        }
      })
    }
  }

  const requireAuth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = authorized(ctx, req)
    if (rejection === null) return true
    json(res, rejection, {
      error: rejection === 503 ? 'DSH 连接服务不可用' : '需要登录后访问',
    })
    return false
  }

  const add = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
    disposers.push(ctx.webServer.register({ kind: 'exact', path, handler: wrap(handler) }))
  }

  // 同一 exact 路径只能注册一次（重复注册会抛错），GET 与 POST 在处理器内分流。
  add(`${PREFIX}/settings`, async (req, res) => {
    if (!requireAuth(req, res)) return
    const credentials = credentialsOf(ctx)
    if (credentials === undefined) {
      json(res, 503, { error: '凭据服务不可用，无法读写 AlertManager 设置' })
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      json(res, 200, publicSettings(await readSettings(credentials)))
      return
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const body = await readJson(req)
    const saved = await saveSettings(credentials, body)
    // 地址或凭据可能变了，旧缓存立即失效。
    source.invalidate()
    json(res, 200, saved)
  })

  add(`${PREFIX}/alerts`, async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!requireAuth(req, res)) return
    const credentials = credentialsOf(ctx)
    if (credentials === undefined) {
      json(res, 503, { error: '凭据服务不可用，无法读取 AlertManager 设置' })
      return
    }
    const settings = await readSettings(credentials)
    if (settings.url === '') {
      json(res, 400, { error: '尚未配置 AlertManager 地址' })
      return
    }
    json(res, 200, await source.fetch(settings))
  })

  add(`${PREFIX}/dispatch`, async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!requireAuth(req, res)) return
    const credentials = credentialsOf(ctx)
    if (credentials === undefined) {
      json(res, 503, { error: '凭据服务不可用，无法读取 AlertManager 设置' })
      return
    }
    const sessionController = ctx.get('sessionController') as SessionControllerLike | undefined
    if (
      sessionController === undefined ||
      typeof sessionController.create !== 'function' ||
      typeof sessionController.prompt !== 'function'
    ) {
      json(res, 503, { error: '当前 profile 不支持创建会话' })
      return
    }
    const body = await readJson(req)
    const settings = await readSettings(credentials)
    const workspaceRegistry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    const result = await dispatchAlerts(body, {
      settings,
      fetchAlerts: () => source.fetch(settings, { fresh: true }),
      sessionController,
      workspaceRegistry,
      logger: ctx.logger,
    })
    json(res, 200, result)
  })

  ctx.effect?.(() => () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
  }, 'dsh-alertmanager routes')
}
