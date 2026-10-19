/**
 * dsh-enhancement · 持久化状态与密码 / 签名工具。
 *
 * 设计：所有运行配置与机密都放在 $DSH_HOME/fengyifan-dsh-enhancement/state.json（仅当前用户可读），
 * 不写 profile 的 cordis.patch.yml；插件行只负责加载插件本身。
 * 密码只存 scrypt 哈希；网关会话用 HMAC 签名 cookie；DSH 会话 cookie 每请求
 * 用宿主持久签名密钥即时签发（不落盘）。
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_SESSION_HEADER_NAME } from './session-header.js'

export type HttpsMode = 'off' | 'uploaded' | 'ca' | 'selfsigned'

export interface GatewayConfig {
  enabled: boolean
  bindHost: string
  port: number
  httpsMode: HttpsMode
  sessionDays: number
  loginThrottle: boolean
  httpsHostnames: string[]
  pwaEnabled: boolean
  pwaName: string
  pwaShortName: string
  pwaDisplay: 'standalone' | 'fullscreen' | 'minimal-ui'
  pwaThemeColor: string
  pwaBackgroundColor: string
  notifyEnabled: boolean
  notifyTask: boolean
  notifyAsk: boolean
  notifyApproval: boolean
  notifyDenied: boolean
  notifySubagent: boolean
  notifyGoal: boolean
  notifyJobs: boolean
  pushEnabled: boolean
  pushSubject: string
  sessionHeaderEnabled: boolean
  sessionHeaderName: string
}

export interface PasswordRecord {
  salt: string
  hash: string
  N: number
  r: number
  p: number
}

export interface PushSubscriptionRecord {
  endpoint: string
  keys: { p256dh: string; auth: string }
  origin?: string
  createdAt: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

export interface PersistedState {
  version: 1
  config: GatewayConfig
  gateSecret: string
  password?: PasswordRecord
  vapid?: VapidKeys
  subscriptions: PushSubscriptionRecord[]
  createdAt: string
  updatedAt: string
}

export interface PluginConfig {
  enabled?: boolean
  bindHost?: string
  port?: number
}

export interface CredentialRecordLike {
  kind?: string
  payload?: { version?: number; secret?: string }
}

export interface CredentialsLike {
  readRecord(key: string): Promise<CredentialRecordLike | undefined>
}

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_BYTES = 64
const SECRET_BYTES = 32

export const SESSION_COOKIE = 'dsh_enhancement_session'
export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

/** 从 CLI 参数解析当前 profile；systemd 默认 web。 */
function activeProfileName(): string {
  const argv = process.argv
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' || arg === '-p') {
      const value = argv[i + 1]
      if (value && !value.startsWith('-')) return value.replace(/[\\/]/g, '')
    }
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      if (value) return value.replace(/[\\/]/g, '')
    }
  }
  const env = process.env.DSH_PROFILE?.trim()
  return env && !env.includes('/') && !env.includes('\\') ? env : 'web'
}

export const PROFILE_NAME = activeProfileName()
export const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE_NAME)
/** 状态放在当前 profile 目录内；显式覆盖只用于特殊隔离测试。 */
const STATE_DIR_OVERRIDE = process.env.DSH_ENHANCEMENT_STATE_DIR?.trim()
export let STATE_DIR = STATE_DIR_OVERRIDE ? resolve(STATE_DIR_OVERRIDE) : join(PROFILE_DIR, 'fengyifan-dsh-enhancement')
export let STATE_PATH = join(STATE_DIR, 'state.json')
export let TLS_DIR = join(STATE_DIR, 'tls')
export let ICONS_DIR = join(STATE_DIR, 'icons')
export const TLS_FILES = {
  cert: join(TLS_DIR, 'server.crt'),
  key: join(TLS_DIR, 'server.key'),
  caCert: join(TLS_DIR, 'ca.crt'),
  caKey: join(TLS_DIR, 'ca.key'),
  uploadedCaCert: join(TLS_DIR, 'uploaded-ca.crt'),
  uploadedCaKey: join(TLS_DIR, 'uploaded-ca.key'),
}

/**
 * 使用 DSH 提供的 profileContext.dir 作为权威目录。
 * 这样 Windows / macOS 以及自定义 DSH_HOME 下都不依赖猜测 argv 或 home 布局。
 */
export function configureStateDir(profileDir: string): void {
  STATE_DIR = resolve(profileDir, 'fengyifan-dsh-enhancement')
  STATE_PATH = join(STATE_DIR, 'state.json')
  TLS_DIR = join(STATE_DIR, 'tls')
  ICONS_DIR = join(STATE_DIR, 'icons')
  TLS_FILES.cert = join(TLS_DIR, 'server.crt')
  TLS_FILES.key = join(TLS_DIR, 'server.key')
  TLS_FILES.caCert = join(TLS_DIR, 'ca.crt')
  TLS_FILES.caKey = join(TLS_DIR, 'ca.key')
  TLS_FILES.uploadedCaCert = join(TLS_DIR, 'uploaded-ca.crt')
  TLS_FILES.uploadedCaKey = join(TLS_DIR, 'uploaded-ca.key')
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function randomSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url')
}

export function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  try {
    chmodSync(STATE_DIR, 0o700)
  } catch {
    /* best effort */
  }
}

export function atomicWrite(path: string, content: string | Buffer, mode = 0o600): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, { mode })
  try {
    chmodSync(tmp, mode)
  } catch {
    /* best effort */
  }
  renameSync(tmp, path)
}

export function defaultConfig(host: string): GatewayConfig {
  return {
    enabled: false,
    bindHost: host && host !== '0.0.0.0' && host !== '::' ? host : '127.0.0.1',
    port: 3088,
    httpsMode: 'off',
    sessionDays: 30,
    loginThrottle: true,
    httpsHostnames: [],
    pwaEnabled: false,
    pwaName: 'DeepSeek Harness',
    pwaShortName: 'DSH',
    pwaDisplay: 'fullscreen',
    pwaThemeColor: '#0f1115',
    pwaBackgroundColor: '#0f1115',
    notifyEnabled: true,
    notifyTask: true,
    notifyAsk: true,
    notifyApproval: true,
    notifyDenied: true,
    notifySubagent: true,
    notifyGoal: true,
    notifyJobs: true,
    pushEnabled: false,
    pushSubject: 'mailto:admin@example.com',
    sessionHeaderEnabled: false,
    sessionHeaderName: DEFAULT_SESSION_HEADER_NAME,
  }
}

export function normalizeConfig(raw: Partial<GatewayConfig> | undefined, host: string): GatewayConfig {
  const base = defaultConfig(host)
  const cfg: GatewayConfig = { ...base, ...(raw || {}) }
  cfg.enabled = cfg.enabled === true
  cfg.bindHost = typeof cfg.bindHost === 'string' && cfg.bindHost.trim() ? cfg.bindHost.trim() : base.bindHost
  cfg.port = Number.isSafeInteger(cfg.port) && cfg.port > 0 && cfg.port < 65536 ? cfg.port : base.port
  cfg.httpsMode = ['off', 'uploaded', 'ca', 'selfsigned'].includes(cfg.httpsMode) ? cfg.httpsMode : 'off'
  cfg.sessionDays = Number.isSafeInteger(cfg.sessionDays) && cfg.sessionDays >= 1 && cfg.sessionDays <= 365 ? cfg.sessionDays : base.sessionDays
  cfg.loginThrottle = cfg.loginThrottle !== false
  cfg.httpsHostnames = Array.isArray(cfg.httpsHostnames)
    ? cfg.httpsHostnames.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
    : []
  cfg.pwaEnabled = cfg.pwaEnabled === true
  cfg.pwaName = typeof cfg.pwaName === 'string' && cfg.pwaName.trim() ? cfg.pwaName.trim() : base.pwaName
  cfg.pwaShortName = typeof cfg.pwaShortName === 'string' && cfg.pwaShortName.trim() ? cfg.pwaShortName.trim() : base.pwaShortName
  cfg.pwaDisplay = ['standalone', 'fullscreen', 'minimal-ui'].includes(cfg.pwaDisplay) ? cfg.pwaDisplay : base.pwaDisplay
  cfg.pwaThemeColor = typeof cfg.pwaThemeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cfg.pwaThemeColor) ? cfg.pwaThemeColor : base.pwaThemeColor
  cfg.pwaBackgroundColor = typeof cfg.pwaBackgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cfg.pwaBackgroundColor) ? cfg.pwaBackgroundColor : base.pwaBackgroundColor
  cfg.notifyEnabled = cfg.notifyEnabled !== false
  for (const key of ['notifyTask', 'notifyAsk', 'notifyApproval', 'notifyDenied', 'notifySubagent', 'notifyGoal', 'notifyJobs'] as const) {
    cfg[key] = cfg[key] !== false
  }
  cfg.pushEnabled = cfg.pushEnabled === true
  cfg.pushSubject = typeof cfg.pushSubject === 'string' && cfg.pushSubject.trim() ? cfg.pushSubject.trim() : base.pushSubject
  cfg.sessionHeaderEnabled = cfg.sessionHeaderEnabled === true
  cfg.sessionHeaderName = typeof cfg.sessionHeaderName === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cfg.sessionHeaderName.trim())
    ? cfg.sessionHeaderName.trim()
    : base.sessionHeaderName
  return cfg
}

export class StateStore {
  readonly statePath = STATE_PATH
  private state: PersistedState

  constructor(
    private readonly webServerHost: string,
    seed?: PluginConfig,
  ) {
    ensureStateDir()
    this.state = this.load(seed)
  }

  private load(seed?: PluginConfig): PersistedState {
    if (existsSync(this.statePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<PersistedState>
        const seeded: Partial<GatewayConfig> = {}
        if (seed) {
          if (typeof seed.enabled === 'boolean') seeded.enabled = seed.enabled
          if (typeof seed.bindHost === 'string') seeded.bindHost = seed.bindHost
          if (typeof seed.port === 'number') seeded.port = seed.port
        }
        const config = normalizeConfig({ ...seeded, ...(raw.config || {}) }, this.webServerHost)
        return {
          version: 1,
          config,
          gateSecret: typeof raw.gateSecret === 'string' && raw.gateSecret.length >= 32 ? raw.gateSecret : randomSecret(),
          password: raw.password && typeof raw.password.hash === 'string' ? raw.password : undefined,
          vapid: raw.vapid && typeof raw.vapid.publicKey === 'string' && typeof raw.vapid.privateKey === 'string' ? raw.vapid : undefined,
          subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions.filter((item): item is PushSubscriptionRecord => Boolean(item && typeof item.endpoint === 'string' && item.keys && typeof item.keys.p256dh === 'string' && typeof item.keys.auth === 'string')) : [],
          createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
          updatedAt: nowIso(),
        }
      } catch {
        /* fall through to a fresh state; keep a warning via caller */
      }
    }
    const config = defaultConfig(this.webServerHost)
    if (seed) {
      if (typeof seed.enabled === 'boolean') config.enabled = seed.enabled
      if (typeof seed.bindHost === 'string' && seed.bindHost) config.bindHost = seed.bindHost
      if (typeof seed.port === 'number') config.port = seed.port
    }
    return { version: 1, config, gateSecret: randomSecret(), subscriptions: [], createdAt: nowIso(), updatedAt: nowIso() }
  }

  get config(): GatewayConfig {
    return this.state.config
  }

  get passwordSet(): boolean {
    return this.state.password !== undefined
  }

  get gateSecret(): string {
    return this.state.gateSecret
  }

  get createdPath(): string {
    return this.statePath
  }

  save(): void {
    this.state.updatedAt = nowIso()
    atomicWrite(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`)
  }

  updateConfig(patch: Partial<GatewayConfig>): GatewayConfig {
    this.state.config = normalizeConfig({ ...this.state.config, ...patch }, this.webServerHost)
    this.save()
    return this.state.config
  }

  setPassword(password: string): void {
    const salt = randomBytes(16)
    const hash = scryptSync(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    this.state.password = {
      salt: salt.toString('base64url'),
      hash: hash.toString('base64url'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    }
    this.state.gateSecret = randomSecret()
    this.save()
  }

  verifyPassword(password: string): boolean {
    const rec = this.state.password
    if (!rec) return false
    try {
      const salt = Buffer.from(rec.salt, 'base64url')
      const expected = Buffer.from(rec.hash, 'base64url')
      const actual = scryptSync(password, salt, expected.length, { N: rec.N, r: rec.r, p: rec.p })
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    } catch {
      return false
    }
  }

  get vapid(): VapidKeys | undefined {
    return this.state.vapid
  }

  get subscriptions(): PushSubscriptionRecord[] {
    return this.state.subscriptions
  }

  setVapid(keys: VapidKeys): void {
    this.state.vapid = keys
    this.save()
  }

  addSubscription(record: PushSubscriptionRecord): void {
    this.state.subscriptions = [...this.state.subscriptions.filter((item) => item.endpoint !== record.endpoint), record]
    this.save()
  }

  removeSubscription(endpoint: string): void {
    const next = this.state.subscriptions.filter((item) => item.endpoint !== endpoint)
    this.state.subscriptions = next
    this.save()
  }

  rotateGateSecret(): void {
    this.state.gateSecret = randomSecret()
    this.save()
  }
}

// ---------------------------------------------------------------------------
// 网关会话 cookie（HMAC 签名，无服务端状态；轮换 gateSecret 即可全部吊销）
// ---------------------------------------------------------------------------

export interface SessionPayload {
  v: 1
  sid: string
  iat: number
  exp: number
}

export function signSession(secret: string, days: number): string {
  const iat = Date.now()
  const exp = iat + days * 86400 * 1000
  const payload: SessionPayload = { v: 1, sid: randomBytes(16).toString('hex'), iat, exp }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
  return `v1.${body}.${sig}`
}

export function verifySession(secret: string, value: string | undefined): SessionPayload | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const [, body, sig] = parts
  const expected = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest()
  const actual = Buffer.from(sig, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (payload.v !== 1 || typeof payload.exp !== 'number' || typeof payload.exp !== 'number') return null
    if (payload.exp <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function sessionCookie(value: string, days: number, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    `Max-Age=${Math.max(1, Math.floor(days * 86400))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

// ---------------------------------------------------------------------------
// DSH 会话 cookie 签发（与 @deepseek-ai/dsh-client-connection 的 v1 格式一致）
// ---------------------------------------------------------------------------

export function requestAuthority(host: string, protocol: 'http:' | 'https:'): string {
  const url = new URL(`${protocol}//${host}`)
  return protocol === 'https:' ? url.origin : url.host
}

export function mintDshCookie(secret: Buffer, authority: string, ttlMs: number): string {
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + ttlMs }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  const value = `v1.${body}.${sig}`
  const name = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
  return `${name}=${value}`
}

export async function readDshSecret(ctx: { get(name: string): unknown }): Promise<Buffer | null> {
  const credentials = ctx.get('credentials') as CredentialsLike | undefined
  if (!credentials || typeof credentials.readRecord !== 'function') return null
  try {
    const record = await credentials.readRecord('client-connection/browser-session')
    const encoded = record?.payload?.secret
    if (record?.kind !== 'grant' || typeof encoded !== 'string') return null
    const secret = Buffer.from(encoded, 'base64url')
    return secret.length === SECRET_BYTES ? secret : null
  } catch {
    return null
  }
}
