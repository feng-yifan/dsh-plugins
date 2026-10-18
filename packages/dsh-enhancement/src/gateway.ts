/**
 * dsh-enhancement · 网关监听器（Phase 1：HTTP + 密码 + DSH 会话注入 + 反向代理）
 *
 * 关键设计：
 * - 浏览器只拿到本插件的网关会话 cookie；DSH 的 dsh-auth-* cookie 每请求即时签发，
 *   浏览器无需知道 ?token=，也不受 DSH 会话 cookie 的 authority / 端口变化影响。
 * - 上游 Host 改写为 DSH 绑定地址（不带端口），并剥离 Origin；网关自己做同源校验，
 *   因此不需要修改 dsh-web.service 的 --trusted-host。
 * - 普通请求不限流；只对登录失败做每 IP 退避（可关）。
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect as netConnect, type Socket } from 'node:net'
import { URL } from 'node:url'
import {
  SESSION_COOKIE,
  StateStore,
  clearSessionCookie,
  formatHost,
  mintDshCookie,
  readDshSecret,
  requestAuthority,
  sessionCookie,
  signSession,
  verifySession,
} from './state.js'
import type { HostContextLike, NetworkInterfaceInfo, StatusPayload as Status } from './types.js'
import { caCertificatePem, prepareTls, tlsStatus } from './tls.js'

interface Target {
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  origin: string
}

interface LoginFailure {
  count: number
  firstAt: number
  lockedUntil: number
}

const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_LOCK_MS = 60 * 1000
const LOGIN_MAX_FAILURES = 5
const DSH_COOKIE_TTL_MS = 60 * 60 * 1000
const HOP_BY_HOP = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function parseCookies(header: string | undefined): Array<[string, string]> {
  if (!header) return []
  const result: Array<[string, string]> = []
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    const name = segment.slice(0, at).trim()
    if (!name) continue
    result.push([name, segment.slice(at + 1).trim()])
  }
  return result
}

function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (/[\r\n]/.test(raw)) return '/'
  return raw
}

function loginPage(options: { passwordSet: boolean; error?: string; next: string }): string {
  const error = options.error
    ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>`
    : ''
  const form = options.passwordSet
    ? `<form method="post" action="/__enhancement/login" autocomplete="current-password">
        <input type="hidden" name="next" value="${escapeHtml(options.next)}" />
        <label class="label" for="password">访问密码</label>
        <input class="input" id="password" name="password" type="password" required autofocus
               autocomplete="current-password" placeholder="请输入访问密码" />
        <button class="button" type="submit">进入 DSH</button>
      </form>`
    : `<div class="notice">
        <strong>尚未设置访问密码</strong>
        <p>请在 DSH 设置 → 插件 → dsh-enhancement 中设置密码并启用网关。设置完成后刷新本页。</p>
      </div>`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>DSH · 安全访问</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --card:#161a22; --border:#2a3040; --text:#e8ecf4; --muted:#8d97ab; --accent:#4d8dff; --accent-hover:#6aa1ff; --error:#ff7a7a; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin:0; background: radial-gradient(1200px 800px at 50% -10%, #1b2233 0%, var(--bg) 60%); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:380px; background:var(--card); border:1px solid var(--border); border-radius:18px; padding:28px 24px 24px; box-shadow:0 24px 70px rgba(0,0,0,.45); }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:18px; }
  .mark { width:34px; height:34px; border-radius:10px; background:linear-gradient(145deg, #4d8dff, #8a5cff); display:grid; place-items:center; font-weight:700; font-size:15px; color:#fff; letter-spacing:-.5px; }
  h1 { font-size:17px; margin:0; font-weight:650; }
  .sub { color:var(--muted); font-size:12px; margin-top:2px; }
  .label { display:block; font-size:13px; color:var(--muted); margin:14px 0 6px; }
  .input { width:100%; height:42px; border-radius:11px; border:1px solid var(--border); background:#0f131b; color:var(--text); padding:0 13px; font-size:15px; outline:none; }
  .input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(77,141,255,.18); }
  .button { width:100%; height:42px; margin-top:18px; border:0; border-radius:11px; background:var(--accent); color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  .button:hover { background:var(--accent-hover); }
  .error { margin:12px 0 0; padding:10px 12px; border-radius:10px; background:rgba(255,122,122,.1); border:1px solid rgba(255,122,122,.3); color:var(--error); font-size:13px; }
  .notice { font-size:13px; color:var(--muted); line-height:1.6; }
  .notice strong { color:var(--text); display:block; margin-bottom:6px; font-size:14px; }
  .foot { margin-top:18px; font-size:11px; color:#667085; text-align:center; }
</style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <div class="mark">DS</div>
      <div>
        <h1>DeepSeek Harness</h1>
        <div class="sub">dsh-enhancement 安全访问</div>
      </div>
    </div>
    ${error}
    ${form}
    <div class="foot">密码只用于本网关，不会发送给 DSH 以外的服务</div>
  </main>
</body>
</html>`
}

export class Gateway {
  private server: Server | null = null
  private sockets = new Set<Socket>()
  private started = false
  private error: string | null = null
  private dshSecret: Buffer | null = null
  private dshSecretTimer: ReturnType<typeof setTimeout> | null = null
  private secure = false
  private failures = new Map<string, LoginFailure>()

  constructor(
    private readonly ctx: HostContextLike,
    private readonly store: StateStore,
  ) {}

  get running(): boolean {
    return this.started
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]): void {
    const logger = this.ctx.logger
    const fn = logger?.[level]?.bind(logger)
    if (fn) fn('[dsh-enhancement]', ...args)
  }

  private get target(): Target | null {
    try {
      const url = new URL(this.ctx.webServer.getOrigin())
      const protocol = url.protocol === 'https:' ? 'https:' : 'http:'
      return {
        protocol,
        hostname: url.hostname,
        port: Number(url.port || (protocol === 'https:' ? 443 : 80)),
        origin: url.origin,
      }
    } catch {
      return null
    }
  }

  async start(): Promise<void> {
    await this.stop()
    this.error = null
    const config = this.store.config
    if (!config.enabled) {
      this.log('info', 'gateway disabled by configuration')
      return
    }
    if (!this.store.passwordSet) {
      this.error = '尚未设置访问密码，网关不会启动'
      this.log('warn', this.error)
      return
    }
    this.secure = false
    let tlsOptions: { cert: string; key: string } | undefined
    if (config.httpsMode !== 'off') {
      try {
        const prepared = await prepareTls(config, this.ctx.webServer.host)
        if (!prepared) throw new Error('TLS material unavailable')
        tlsOptions = { cert: prepared.material.cert, key: prepared.material.key }
        this.secure = true
        for (const warning of prepared.warnings) this.log('warn', warning)
      } catch (error) {
        this.error = `HTTPS 启动失败：${error instanceof Error ? error.message : String(error)}`
        this.log('error', this.error)
        return
      }
    }
    this.dshSecret = await readDshSecret(this.ctx)
    if (!this.dshSecret) {
      this.log('warn', '无法读取 DSH 浏览器会话签名密钥；会在后台重试（网关自身仍可登录）')
      this.scheduleDshSecretRetry()
    }
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      void this.handleRequest(req, res).catch((err: unknown) => {
        this.log('error', 'request handler failed', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        }
        res.end('dsh-enhancement: internal error\n')
      })
    }
    const server = tlsOptions ? createHttpsServer(tlsOptions, handler) : createServer(handler)
    server.requestTimeout = 0
    server.headersTimeout = 60_000
    server.keepAliveTimeout = 65_000
    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket as Socket, head).catch((err: unknown) => {
        this.log('error', 'upgrade handler failed', err)
        socket.destroy()
      })
    })
    server.on('clientError', (err, socket) => {
      this.log('debug', 'client error', err.message)
      socket.destroy()
    })
    server.on('error', (err) => {
      this.error = err.message
      this.started = false
      this.log('error', 'gateway server error', err)
    })
    this.server = server
    await new Promise<void>((resolve) => {
      const onError = (err: Error) => {
        this.error = err.message
        this.started = false
        this.log('error', `failed to listen on ${config.bindHost}:${config.port}`, err)
        resolve()
      }
      server.once('error', onError)
      server.listen(config.port, config.bindHost, () => {
        server.off('error', onError)
        this.started = true
        this.log('info', `gateway listening on ${this.secure ? 'https' : 'http'}://${formatHost(config.bindHost)}:${config.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.dshSecretTimer) {
      clearTimeout(this.dshSecretTimer)
      this.dshSecretTimer = null
    }
    const server = this.server
    this.server = null
    this.started = false
    this.secure = false
    for (const socket of this.sockets) {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    if (server) {
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve())
          server.closeAllConnections?.()
        } catch {
          resolve()
        }
      })
    }
  }

  async restart(): Promise<void> {
    await this.start()
  }

  status(interfaces: NetworkInterfaceInfo[]): Status {
    const config = this.store.config
    const origin = this.ctx.webServer.getOrigin()
    let dshAccessUrl = origin
    try {
      const connection = this.ctx.get('connection') as { authenticatedUrl?: (url: string) => string } | undefined
      if (connection?.authenticatedUrl) dshAccessUrl = connection.authenticatedUrl(origin)
    } catch {
      /* connection service unavailable; keep clean origin */
    }
    const displayHost = config.bindHost === '0.0.0.0' || config.bindHost === '::' ? this.ctx.webServer.host : config.bindHost
    const url = this.started ? `${this.secure ? 'https' : 'http'}://${formatHost(displayHost)}:${config.port}` : null
    return {
      enabled: config.enabled,
      running: this.started,
      bindHost: config.bindHost,
      port: config.port,
      url,
      httpsMode: config.httpsMode,
      passwordSet: this.store.passwordSet,
      sessionDays: config.sessionDays,
      loginThrottle: config.loginThrottle,
      dshSecretReady: this.dshSecret !== null,
      dshHost: this.ctx.webServer.host,
      dshOrigin: origin,
      dshAccessUrl,
      interfaces,
      stateDir: this.store.statePath.replace(/\/state\.json$/, ''),
      statePath: this.store.statePath,
      error: this.error,
      https: tlsStatus(config, this.ctx.webServer.host),
      pwa: {
        enabled: config.pwaEnabled,
        name: config.pwaName,
        shortName: config.pwaShortName,
        display: config.pwaDisplay,
        themeColor: config.pwaThemeColor,
        backgroundColor: config.pwaBackgroundColor,
        customIcons: [],
        error: null,
      },
      push: {
        enabled: config.pushEnabled,
        publicKey: null,
        subscriptions: 0,
        subject: config.pushSubject,
      },
      notify: {
        enabled: config.notifyEnabled,
        task: config.notifyTask,
        ask: config.notifyAsk,
        approval: config.notifyApproval,
        denied: config.notifyDenied,
        subagent: config.notifySubagent,
        goal: config.notifyGoal,
        jobs: config.notifyJobs,
      },
    }
  }

  // -------------------------------------------------------------------------
  // 认证
  // -------------------------------------------------------------------------

  private isAuthenticated(req: IncomingMessage): boolean {
    if (!this.store.passwordSet) return false
    const cookies = parseCookies(req.headers.cookie)
    const raw = cookies.find(([name]) => name === SESSION_COOKIE)?.[1]
    return verifySession(this.store.gateSecret, raw) !== null
  }

  private isSameOrigin(req: IncomingMessage): boolean {
    const host = req.headers.host
    if (!host) return false
    const origin = req.headers.origin
    const fetchSite = String(req.headers['sec-fetch-site'] ?? '')
    if (fetchSite === 'cross-site') return false
    // 浏览器声明同源时直接信任（Origin/Host 可能被反向代理或隐私模式改写）。
    if (fetchSite === 'same-origin') return true
    // 部分浏览器/隐私模式对同源表单也发 Origin: null；用 Fetch Metadata 兜底。
    if (origin === 'null') return fetchSite === 'same-origin' || fetchSite === 'none' || fetchSite === ''
    if (!origin) return true
    let originUrl: URL
    try {
      originUrl = new URL(origin)
    } catch {
      return false
    }
    const originHost = originUrl.host.toLowerCase()
    const originHostname = originUrl.hostname.toLowerCase()
    const candidates = [host, req.headers['x-forwarded-host'], req.headers['x-real-host']]
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim().toLowerCase())
    if (candidates.includes(originHost)) return true
    // 反向代理可能剥掉 Host 的端口，但浏览器 Origin 仍带端口；同主机名放行。
    for (const candidate of candidates) {
      try {
        const parsed = new URL(`http://${candidate}`)
        if (parsed.hostname.toLowerCase() === originHostname) return true
      } catch {
        /* ignore malformed forwarded host */
      }
    }
    return false
  }

  private gatewayOrigin(req: IncomingMessage): string {
    return `${this.secure ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`
  }

  private tooManyFailures(key: string): boolean {
    if (!this.store.config.loginThrottle) return false
    const rec = this.failures.get(key)
    if (!rec) return false
    if (rec.lockedUntil > Date.now()) return true
    if (Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
      this.failures.delete(key)
      return false
    }
    return false
  }

  private recordFailure(key: string): void {
    if (!this.store.config.loginThrottle) return
    const now = Date.now()
    const rec = this.failures.get(key)
    if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
      this.failures.set(key, { count: 1, firstAt: now, lockedUntil: 0 })
      return
    }
    rec.count += 1
    if (rec.count >= LOGIN_MAX_FAILURES) rec.lockedUntil = now + LOGIN_LOCK_MS
  }

  private clearFailures(key: string): void {
    this.failures.delete(key)
  }

  // -------------------------------------------------------------------------
  // 请求入口
  // -------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', this.gatewayOrigin(req))
    const path = url.pathname

    if (path === '/__enhancement/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, running: this.started }))
      return
    }
    if (path === '/__enhancement/ca.crt') {
      const pem = caCertificatePem()
      if (!pem) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('no local CA\n')
        return
      }
      res.writeHead(200, {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="dsh-enhancement-ca.crt"',
        'cache-control': 'no-store',
      })
      res.end(pem)
      return
    }
    if (path === '/__enhancement/login') {
      if (req.method === 'POST') {
        await this.handleLogin(req, res)
        return
      }
      this.renderLogin(res, url.searchParams.get('next') ?? '/')
      return
    }
    if (path === '/__enhancement/logout') {
      res.writeHead(303, {
        location: '/__enhancement/login',
        'set-cookie': clearSessionCookie(this.secure),
        'cache-control': 'no-store',
      })
      res.end()
      return
    }

    const publicAsset = path === '/manifest.webmanifest' || path === '/sw.js' || path === '/favicon.ico' || path.startsWith('/pwa/')
    if (publicAsset) {
      await this.proxyRequest(req, res)
      return
    }

    if (!this.isAuthenticated(req)) {
      if (req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html')) {
        const next = `${url.pathname}${url.search}`
        res.writeHead(303, { location: `/__enhancement/login?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' })
        res.end()
        return
      }
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'authentication required' }))
      return
    }

    // 不把 DSH 启动 token 带进上游；网关会话已经足够。
    if (url.searchParams.has('token')) {
      url.searchParams.delete('token')
      req.url = `${url.pathname}${url.search}`
    }
    await this.ensureDshSecret()
    await this.proxyRequest(req, res)
  }

  /** DSH 的 browser-session 凭据可能在本插件启动之后才生成；按需重读。 */
  private async ensureDshSecret(): Promise<Buffer | null> {
    if (this.dshSecret) return this.dshSecret
    const secret = await readDshSecret(this.ctx)
    if (secret) {
      this.dshSecret = secret
      if (this.dshSecretTimer) {
        clearTimeout(this.dshSecretTimer)
        this.dshSecretTimer = null
      }
      this.log('info', 'DSH 浏览器会话签名密钥已就绪')
    }
    return this.dshSecret
  }

  /** 供控制接口在状态查询前刷新一次，避免设置页长期显示“不可用”。 */
  async refreshDshSecret(): Promise<void> {
    await this.ensureDshSecret()
  }

  private scheduleDshSecretRetry(attempt = 0): void {
    if (this.dshSecret || attempt > 120 || !this.started) return
    this.dshSecretTimer = setTimeout(() => {
      this.dshSecretTimer = null
      void this.ensureDshSecret().finally(() => this.scheduleDshSecretRetry(attempt + 1))
    }, 1000)
  }

  private renderLogin(res: ServerResponse, next: string, error?: string): void {
    res.writeHead(error ? 401 : 200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    res.end(loginPage({ passwordSet: this.store.passwordSet, error, next: safeNext(next) }))
  }

  private async handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.isSameOrigin(req)) {
      this.log('warn', 'cross-origin login rejected', {
        host: req.headers.host,
        origin: req.headers.origin,
        fetchSite: req.headers['sec-fetch-site'],
        forwardedHost: req.headers['x-forwarded-host'],
      })
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('cross-origin login rejected\n')
      return
    }
    const key = req.socket.remoteAddress ?? 'unknown'
    if (this.tooManyFailures(key)) {
      this.renderLogin(res, '/', '登录失败次数过多，请约 1 分钟后再试')
      return
    }
    const body = await readBody(req, 16 * 1024)
    const form = new URLSearchParams(body)
    const password = form.get('password') ?? ''
    const next = safeNext(form.get('next'))
    if (!this.store.passwordSet) {
      this.renderLogin(res, next, '尚未设置访问密码')
      return
    }
    if (!password || !this.store.verifyPassword(password)) {
      this.recordFailure(key)
      this.log('warn', `gateway login failed from ${key}`)
      this.renderLogin(res, next, '密码不正确')
      return
    }
    this.clearFailures(key)
    const token = signSession(this.store.gateSecret, this.store.config.sessionDays)
    res.writeHead(303, {
      location: next,
      'set-cookie': sessionCookie(token, this.store.config.sessionDays, this.secure),
      'cache-control': 'no-store',
    })
    res.end()
  }

  // -------------------------------------------------------------------------
  // 反向代理
  // -------------------------------------------------------------------------

  private async proxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = this.target
    if (!target) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-enhancement: upstream DSH origin unavailable\n')
      return
    }
    const headers = this.upstreamHeaders(req, target)
    const upstream = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
        agent: false,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, this.responseHeaders(upstreamRes.headers))
        upstreamRes.pipe(res)
        upstreamRes.on('error', (err) => {
          this.log('warn', 'upstream response error', err.message)
          res.destroy()
        })
      },
    )
    upstream.on('error', (err) => {
      this.log('warn', 'upstream request error', err.message)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      }
      res.end('dsh-enhancement: upstream request failed\n')
    })
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  }

  private upstreamHeaders(req: IncomingMessage, target: Target): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      const lower = name.toLowerCase()
      if (HOP_BY_HOP.has(lower)) continue
      if (lower === 'host' || lower === 'origin' || lower === 'cookie') continue
      headers[lower] = value
    }
    headers.host = target.hostname
    const remote = req.socket.remoteAddress
    if (remote) {
      const forwarded = req.headers['x-forwarded-for']
      headers['x-forwarded-for'] = forwarded ? `${String(forwarded)}, ${remote}` : remote
    }
    headers['x-forwarded-proto'] = this.secure ? 'https' : 'http'
    headers['x-forwarded-host'] = req.headers.host ?? target.hostname
    const cookies = parseCookies(req.headers.cookie).filter(([name]) => !name.startsWith('dsh-auth-'))
    const dshCookie = this.dshSecret ? mintDshCookie(this.dshSecret, this.dshAuthority(target), DSH_COOKIE_TTL_MS) : null
    if (dshCookie) cookies.push(dshCookie.split('=').length >= 2 ? [dshCookie.slice(0, dshCookie.indexOf('=')), dshCookie.slice(dshCookie.indexOf('=') + 1)] : ['dsh-auth', ''])
    if (cookies.length > 0) headers.cookie = cookies.map(([name, value]) => `${name}=${value}`).join('; ')
    return headers
  }

  private dshAuthority(target: Target): string {
    return requestAuthority(target.hostname, target.protocol)
  }

  private responseHeaders(raw: IncomingMessage['headers']): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(raw)) {
      if (value === undefined) continue
      const lower = name.toLowerCase()
      if (HOP_BY_HOP.has(lower)) continue
      if (lower === 'set-cookie') {
        const list = Array.isArray(value) ? value : [value]
        const filtered = list.filter((cookie) => !cookie.startsWith('dsh-auth-'))
        if (filtered.length > 0) headers['set-cookie'] = filtered
        continue
      }
      headers[lower] = value
    }
    return headers
  }

  private async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    if (!this.isAuthenticated(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n')
      socket.destroy()
      return
    }
    const target = this.target
    if (!target) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const headers = this.upstreamHeaders(req, target)
    headers.connection = 'Upgrade'
    headers.upgrade = String(req.headers.upgrade ?? 'websocket')
    const upstream = netConnect({ host: target.hostname.replace(/^\[|\]$/g, ''), port: target.port })
    this.sockets.add(upstream)
    this.sockets.add(socket)
    const cleanup = () => {
      this.sockets.delete(upstream)
      this.sockets.delete(socket)
      upstream.destroy()
      socket.destroy()
    }
    upstream.on('error', (err) => {
      this.log('warn', 'websocket upstream error', err.message)
      cleanup()
    })
    socket.on('error', cleanup)
    socket.on('close', cleanup)
    upstream.on('close', cleanup)
    upstream.on('connect', () => {
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`]
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`)
        else lines.push(`${name}: ${value}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}
