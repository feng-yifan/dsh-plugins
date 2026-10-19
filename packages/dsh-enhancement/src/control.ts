/**
 * dsh-enhancement · 控制 API（挂在 DSH webServer 的 /_dsh/enhancement/*）
 *
 * 鉴权使用 DSH 官方的 ctx.connection.requestRejection(req)：只有通过 DSH
 * Host/Origin 围栏且携带有效浏览器会话的请求才放行；网关代理会给上游注入
 * 短时 DSH 会话 cookie，所以通过网关访问同样有效。
 */
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { atomicWrite, ICONS_DIR, StateStore } from './state.js'
import { focusHub } from './focus.js'
import type { Gateway } from './gateway.js'
import type { Pwa } from './pwa.js'
import type { NotificationEngine } from './notify.js'
import type { PushService } from './push.js'
import { caCertificatePem, generateSelfSigned, installUploadedCa, installUploadedCertificate, tlsStatus, useStoredUploadedCa } from './tls.js'
import type { ConnectionLike, HostContextLike, NetworkInterfaceInfo, StatusPayload } from './types.js'
import type { SessionHeaderMount } from './session-header.js'

const PREFIX = '/_dsh/enhancement'
const ICON_KINDS: Record<string, number> = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'icon-maskable-512.png': 512,
  'apple-touch-icon-180.png': 180,
}

function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function interfaces(): NetworkInterfaceInfo[] {
  const result: NetworkInterfaceInfo[] = []
  const all = networkInterfaces()
  for (const [name, list] of Object.entries(all)) {
    for (const info of list ?? []) {
      result.push({ name, address: info.address, family: String(info.family), internal: info.internal })
    }
  }
  result.sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address))
  return result
}

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
    if (size > limit) throw new Error('request body too large')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object')
  return parsed as Record<string, unknown>
}

function allowedHost(address: string): boolean {
  if (address === '0.0.0.0' || address === '::') return true
  const all = networkInterfaces()
  for (const list of Object.values(all)) {
    for (const info of list ?? []) {
      if (info.address === address) return true
    }
  }
  return address === '127.0.0.1' || address === '::1' || address === 'localhost'
}

export function registerControl(ctx: HostContextLike, gateway: Gateway, store: StateStore, pwa: Pwa, notify: NotificationEngine, push: PushService, sessionHeader?: SessionHeaderMount): void {
  const disposers: Array<() => void> = []
  let restartTimer: NodeJS.Timeout | undefined
  const scheduleRestart = (): void => {
    if (restartTimer) clearTimeout(restartTimer)
    // 先让控制 API 的响应离开网关，再断开监听；否则通过网关保存配置时会读到 failed to fetch。
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      void gateway.restart()
    }, 200)
    restartTimer.unref?.()
  }
  disposers.push(() => {
    if (restartTimer) clearTimeout(restartTimer)
  })

  const wrap = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) => {
    return (req: IncomingMessage, res: ServerResponse) => {
      void Promise.resolve(handler(req, res)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.('[dsh-enhancement] control handler failed', message)
        if (!res.headersSent) json(res, 400, { error: message })
        else res.end()
      })
    }
  }

  const requireAuth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = authorized(ctx, req)
    if (rejection === null) return true
    json(res, rejection, { error: rejection === 503 ? 'DSH connection service unavailable' : 'authentication required' })
    return false
  }

  const status = async (): Promise<StatusPayload> => {
    await gateway.refreshDshSecret()
    const value = gateway.status(interfaces())
    value.pwa.enabled = pwa.enabled
    value.pwa.error = pwa.error
    value.push = push.status()
    value.pwa.customIcons = pwa.customIcons()
    value.focusClients = focusHub.size
    if (sessionHeader !== undefined) value.sessionHeader = sessionHeader.status()
    return value
  }

  const add = (kind: 'exact' | 'prefix', path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    disposers.push(ctx.webServer.register({ kind, path, handler }))
  }

  add('exact', `${PREFIX}/focus`, wrap(async (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    focusHub.subscribe(req, res)
  }))

  add('exact', `${PREFIX}/status`, wrap(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    json(res, 200, await status())
  }))

  add('exact', `${PREFIX}/config`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    const patch: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.bindHost === 'string') {
      if (!allowedHost(body.bindHost)) return json(res, 400, { error: `不允许监听 ${body.bindHost}` })
      patch.bindHost = body.bindHost
    }
    if (body.port !== undefined) {
      const port = Number(body.port)
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return json(res, 400, { error: '端口必须在 1-65535 之间' })
      if (port === ctx.webServer.port) return json(res, 400, { error: '端口不能与 DSH 自身端口相同' })
      patch.port = port
    }
    if (body.sessionDays !== undefined) {
      const days = Number(body.sessionDays)
      if (!Number.isSafeInteger(days) || days < 1 || days > 365) return json(res, 400, { error: '会话有效天数必须在 1-365 之间' })
      patch.sessionDays = days
    }
    if (typeof body.loginThrottle === 'boolean') patch.loginThrottle = body.loginThrottle
    if (typeof body.pwaEnabled === 'boolean') patch.pwaEnabled = body.pwaEnabled
    if (typeof body.pwaName === 'string' && body.pwaName.trim()) patch.pwaName = body.pwaName.trim()
    if (typeof body.pwaShortName === 'string' && body.pwaShortName.trim()) patch.pwaShortName = body.pwaShortName.trim()
    if (typeof body.pwaDisplay === 'string' && ['standalone', 'fullscreen', 'minimal-ui'].includes(body.pwaDisplay)) patch.pwaDisplay = body.pwaDisplay
    if (typeof body.pwaThemeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.pwaThemeColor)) patch.pwaThemeColor = body.pwaThemeColor
    if (typeof body.pwaBackgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.pwaBackgroundColor)) patch.pwaBackgroundColor = body.pwaBackgroundColor
    for (const key of ['notifyEnabled', 'notifyTask', 'notifyAsk', 'notifyApproval', 'notifyDenied', 'notifySubagent', 'notifyGoal', 'notifyJobs'] as const) {
      if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean
    }
    if (typeof body.pushEnabled === 'boolean') patch.pushEnabled = body.pushEnabled
    if (typeof body.pushSubject === 'string' && /^(mailto:|https:\/\/)/i.test(body.pushSubject.trim())) patch.pushSubject = body.pushSubject.trim()
    if (typeof body.sessionHeaderEnabled === 'boolean') patch.sessionHeaderEnabled = body.sessionHeaderEnabled
    if (typeof body.sessionHeaderName === 'string') {
      const name = body.sessionHeaderName.trim()
      // 头名必须是合法的 HTTP token，否则请求会被上游直接拒绝。
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return json(res, 400, { error: '请求头名称不合法' })
      patch.sessionHeaderName = name
    }
    if (Array.isArray(body.httpsHostnames)) {
      patch.httpsHostnames = body.httpsHostnames
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim())
    }
    if (body.httpsMode === 'off') patch.httpsMode = 'off'
    if (patch.enabled === true && !store.passwordSet) {
      return json(res, 400, { error: '请先设置访问密码，再启用网关' })
    }
    const before = store.config
    store.updateConfig(patch)
    pwa.sync()
    const listenerKeys = ['enabled', 'bindHost', 'port', 'httpsMode', 'httpsHostnames'] as const
    const needsRestart = listenerKeys.some((key) => JSON.stringify(before[key]) !== JSON.stringify(store.config[key]))
    json(res, 200, await status())
    if (needsRestart && body.restart !== false) scheduleRestart()
  }))

  add('exact', `${PREFIX}/password`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    const next = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (next.length < 6) return json(res, 400, { error: '新密码至少 6 个字符' })
    // 控制接口本身已要求 DSH 登录；按产品设计允许直接重设，不再要求旧密码。
    store.setPassword(next)
    json(res, 200, { ...(await status()), passwordSet: true })
    scheduleRestart()
  }))

  add('exact', `${PREFIX}/logout-all`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    store.rotateGateSecret()
    json(res, 200, { ok: true })
  }))

  add('exact', `${PREFIX}/restart`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    json(res, 200, await status())
    scheduleRestart()
  }))


  add('exact', `${PREFIX}/tls/upload`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req, 256 * 1024)
    const certPem = typeof body.certPem === 'string' ? body.certPem : ''
    const keyPem = typeof body.keyPem === 'string' ? body.keyPem : ''
    if (!certPem.includes('BEGIN CERTIFICATE') || !keyPem.includes('PRIVATE KEY')) {
      return json(res, 400, { error: '需要 PEM 格式的证书链与私钥' })
    }
    const warnings = await installUploadedCertificate(certPem, keyPem, store.config, ctx.webServer.host)
    store.updateConfig({ httpsMode: 'uploaded' })
    for (const warning of warnings) ctx.logger?.warn?.('[dsh-enhancement]', warning)
    json(res, 200, await status())
    if (body.restart !== false) scheduleRestart()
  }))

  add('exact', `${PREFIX}/tls/upload-ca`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req, 256 * 1024)
    const caCertPem = typeof body.caCertPem === 'string' ? body.caCertPem : ''
    const caKeyPem = typeof body.caKeyPem === 'string' ? body.caKeyPem : ''
    if (!caCertPem.includes('BEGIN CERTIFICATE') || !caKeyPem.includes('PRIVATE KEY')) {
      return json(res, 400, { error: '需要 PEM 格式的 CA 证书与 CA 私钥' })
    }
    await installUploadedCa(caCertPem, caKeyPem, store.config, ctx.webServer.host)
    store.updateConfig({ httpsMode: 'ca' })
    json(res, 200, await status())
    if (body.restart !== false) scheduleRestart()
  }))

  add('exact', `${PREFIX}/tls/use-ca`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    await useStoredUploadedCa(store.config, ctx.webServer.host)
    store.updateConfig({ httpsMode: 'ca' })
    json(res, 200, await status())
    if (body.restart !== false) scheduleRestart()
  }))

  add('exact', `${PREFIX}/tls/selfsigned`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    if (Array.isArray(body.httpsHostnames)) {
      store.updateConfig({
        httpsHostnames: body.httpsHostnames
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map((item) => item.trim()),
      })
    }
    await generateSelfSigned(store.config, ctx.webServer.host)
    store.updateConfig({ httpsMode: 'selfsigned' })
    json(res, 200, await status())
    if (body.restart !== false) scheduleRestart()
  }))

  add('exact', `${PREFIX}/tls/off`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    store.updateConfig({ httpsMode: 'off' })
    json(res, 200, await status())
    if (body.restart !== false) scheduleRestart()
  }))

  add('exact', `${PREFIX}/tls/ca`, wrap(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const pem = caCertificatePem()
    if (!pem) return json(res, 404, { error: '尚未生成或上传 CA 证书' })
    res.writeHead(200, {
      'content-type': 'application/x-x509-ca-cert',
      'content-disposition': 'attachment; filename="dsh-enhancement-ca.crt"',
      'cache-control': 'no-store',
    })
    res.end(pem)
  }))

  add('exact', `${PREFIX}/tls/status`, wrap(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    json(res, 200, tlsStatus(store.config, ctx.webServer.host))
  }))


  add('exact', `${PREFIX}/notify/test`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    notify.test()
    json(res, 200, { ok: true })
  }))


  add('exact', `${PREFIX}/push/status`, wrap(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    json(res, 200, push.status())
  }))

  add('exact', `${PREFIX}/push/subscribe`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req, 64 * 1024)
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
    const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined
    if (!endpoint || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      return json(res, 400, { error: '订阅缺少 endpoint/keys' })
    }
    push.subscribe({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      origin: typeof body.origin === 'string' ? body.origin : undefined,
      createdAt: new Date().toISOString(),
    })
    if (!store.config.pushEnabled) store.updateConfig({ pushEnabled: true })
    json(res, 200, await status())
  }))

  add('exact', `${PREFIX}/push/unsubscribe`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    if (typeof body.endpoint === 'string') push.unsubscribe(body.endpoint)
    json(res, 200, await status())
  }))

  add('exact', `${PREFIX}/push/test`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const result = await push.test()
    json(res, 200, { ...result, ...push.status() })
  }))


  add('exact', `${PREFIX}/icons/upload`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req, 3 * 1024 * 1024)
    const kind = typeof body.kind === 'string' ? body.kind : ''
    const expected = ICON_KINDS[kind]
    if (!expected) return json(res, 400, { error: '未知图标类型' })
    const raw = typeof body.data === 'string' ? body.data : ''
    const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
    if (!base64) return json(res, 400, { error: '缺少图片数据' })
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) return json(res, 400, { error: '图标必须小于 2MB' })
    const size = pngSize(buffer)
    if (!size) return json(res, 400, { error: '只接受 PNG 图标' })
    if (size.width !== expected || size.height !== expected) {
      return json(res, 400, { error: `${kind} 需要 ${expected}×${expected}，当前是 ${size.width}×${size.height}` })
    }
    mkdirSync(ICONS_DIR, { recursive: true, mode: 0o700 })
    atomicWrite(join(ICONS_DIR, kind), buffer, 0o600)
    json(res, 200, await status())
  }))

  add('exact', `${PREFIX}/icons/reset`, wrap(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!requireAuth(req, res)) return
    const body = await readJson(req)
    const kind = typeof body.kind === 'string' ? body.kind : ''
    if (kind && !ICON_KINDS[kind]) return json(res, 400, { error: '未知图标类型' })
    const targets = kind ? [kind] : Object.keys(ICON_KINDS)
    for (const target of targets) {
      const path = join(ICONS_DIR, target)
      if (existsSync(path)) unlinkSync(path)
    }
    json(res, 200, await status())
  }))

  ctx.effect?.(() => () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
  }, 'dsh-enhancement control routes')
}
