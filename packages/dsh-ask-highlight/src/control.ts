/**
 * dsh-ask-highlight · 控制 API（挂在 DSH webServer 的 /_dsh/ask-highlight/*）
 *
 * 鉴权沿用 DSH 官方的 `ctx.connection.requestRejection(req)`：只有通过 Host/
 * Origin 围栏且携带有效浏览器会话的请求才放行（与 dsh-enhancement 同款做法）。
 *
 * 两个端点：
 *   GET  /_dsh/ask-highlight/status  → 当前配置
 *   POST /_dsh/ask-highlight/config  → 合并写入配置
 *
 * 写入后不需要重启：`webserver/index-inject` 每次渲染 index 时都会重新 emit，
 * 插件在其中读取 store 的实时配置，因此刷新页面即生效。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { STATE_DIR, STATE_PATH, type ConfigStore } from './state.js'
import type { ConnectionLike, HostContextLike, StatusPayload } from './types.js'

const PREFIX = '/_dsh/ask-highlight'

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

/** 宿主鉴权；返回 null 表示放行，否则返回应回写的 HTTP 状态码。 */
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

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buf.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object')
  return parsed as Record<string, unknown>
}

function statusPayload(store: ConfigStore): StatusPayload {
  return {
    enabled: store.config.enabled,
    defaultExpanded: store.config.defaultExpanded,
    statePath: STATE_PATH,
    stateDir: STATE_DIR,
  }
}

/**
 * 注册控制 API。
 * @param ctx - 宿主上下文（需要 webServer 与 connection）。
 * @param store - 配置存储；读取其快照、写入其配置。
 * @returns 释放函数，注销全部路由。
 */
export function registerControl(ctx: HostContextLike, store: ConfigStore): () => void {
  const disposers: Array<() => void> = []

  const wrap =
    (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    (req: IncomingMessage, res: ServerResponse): void => {
      handler(req, res).catch((error: unknown) => {
        ctx.logger?.error?.('[dsh-ask-highlight] control API error', error)
        if (!res.headersSent) json(res, 500, { error: 'internal error' })
        else res.end()
      })
    }

  const requireAuth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = authorized(ctx, req)
    if (rejection === null) return true
    json(res, rejection, {
      error: rejection === 503 ? 'DSH connection service unavailable' : 'authentication required',
    })
    return false
  }

  const add = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): void => {
    disposers.push(ctx.webServer.register({ kind: 'exact', path, handler: wrap(handler) }))
  }

  add(`${PREFIX}/status`, async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    json(res, 200, statusPayload(store))
  })

  add(`${PREFIX}/config`, async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    const patch: { enabled?: boolean; defaultExpanded?: boolean } = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.defaultExpanded === 'boolean') patch.defaultExpanded = body.defaultExpanded
    if (Object.keys(patch).length === 0) return json(res, 400, { error: 'no recognized fields' })
    store.updateConfig(patch)
    json(res, 200, statusPayload(store))
  })

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* 注销失败不影响退出 */
      }
    }
  }
}
