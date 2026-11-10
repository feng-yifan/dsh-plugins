/**
 * dsh-at-enhancement · 控制 API（挂在 DSH webServer 的 /_dsh/at-enhancement/*）
 *
 * 鉴权沿用 DSH 官方的 `ctx.connection.requestRejection(req)`：只有通过 Host/
 * Origin 围栏且携带有效浏览器会话的请求才放行（与 dsh-enhancement 同款做法）。
 *
 * 两个端点：
 *   GET  /_dsh/at-enhancement/status  → 当前配置 + provider 挂载状态
 *   POST /_dsh/at-enhancement/config  → 合并写入配置（目前只有 enabled）
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ExternalFileReferencesMount } from './external-file-references.js'
import type { ConfigStore } from './state.js'
import type { ConnectionLike, HostContextLike, StatusPayload } from './types.js'

const PREFIX = '/_dsh/at-enhancement'

/** 对外暴露的最大候选数（与 listExternal 默认值一致）。 */
const MAX_RESULTS = 20

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

function statusPayload(store: ConfigStore, mount: ExternalFileReferencesMount): StatusPayload {
  return {
    enabled: store.config.enabled,
    provider: mount.status().provider,
    maxResults: MAX_RESULTS,
    statePath: store.statePath,
  }
}

/**
 * 注册控制 API。
 * @param ctx - 宿主上下文（需要 webServer 与 connection）。
 * @param store - 配置存储。
 * @param mount - 外部引用挂载结果（读取 provider 状态）。
 * @returns 释放函数，注销全部路由。
 */
export function registerControl(
  ctx: HostContextLike,
  store: ConfigStore,
  mount: ExternalFileReferencesMount,
): () => void {
  const disposers: Array<() => void> = []

  const wrap =
    (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    (req: IncomingMessage, res: ServerResponse): void => {
      handler(req, res).catch((error: unknown) => {
        ctx.logger?.error?.('[dsh-at-enhancement] control API error', error)
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
    json(res, 200, statusPayload(store, mount))
  })

  add(`${PREFIX}/config`, async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    const patch: { enabled?: boolean } = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (Object.keys(patch).length === 0) return json(res, 400, { error: 'no recognized fields' })
    store.updateConfig(patch)
    json(res, 200, statusPayload(store, mount))
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
