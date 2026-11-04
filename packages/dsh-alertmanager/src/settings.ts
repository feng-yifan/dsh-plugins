/**
 * dsh-alertmanager · 设置持久化
 *
 * 设置不写 profile 的 `cordis.patch.yml`，而是作为一条 grant 记录存进 DSH
 * 凭据服务（`ctx.credentials`），key 固定为 `dsh-alertmanager/settings`。
 * 记录 payload 是插件自有 JSON；口令/token 永远不会出现在读接口的响应里。
 */
import type { CredentialsLike } from './types.js'

/** 凭据服务里的记录 key。 */
export const SETTINGS_KEY = 'dsh-alertmanager/settings'

/** 支持的 AlertManager 鉴权方式。 */
export type AuthMode = 'none' | 'basic' | 'bearer'

/** 凭据记录里的完整设置（含 secret，仅宿主内部使用）。 */
export interface SettingsPayload {
  url: string
  authMode: AuthMode
  username?: string
  secret?: string
  insecureTls: boolean
  refreshSeconds: number
}

/** 面向前端的设置视图：绝不含 secret，只暴露 `hasSecret`。 */
export interface PublicSettings {
  url: string
  authMode: AuthMode
  username: string
  hasSecret: boolean
  insecureTls: boolean
  refreshSeconds: number
}

/** 设置校验失败；路由把它映射为 HTTP 400。 */
export class SettingsError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

/** 刷新间隔允许范围（秒）。 */
export const MIN_REFRESH_SECONDS = 5
export const MAX_REFRESH_SECONDS = 300

/** 未配置时的默认值。 */
export const DEFAULT_SETTINGS: SettingsPayload = {
  url: '',
  authMode: 'none',
  insecureTls: false,
  refreshSeconds: 30,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === 'none' || value === 'basic' || value === 'bearer'
}

/** 把任意数值夹到 5–300 秒；非法值回落到默认 30。 */
export function clampRefreshSeconds(value: unknown, fallback = DEFAULT_SETTINGS.refreshSeconds): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, Math.round(number)))
}

/** 校验并规范化 AlertManager 地址；只接受 http/https 绝对地址。 */
export function normalizeUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : ''
  if (url === '') throw new SettingsError('请填写 AlertManager 地址')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SettingsError('AlertManager 地址必须是 http/https 绝对地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SettingsError('AlertManager 地址必须是 http/https 绝对地址')
  }
  return url
}

/**
 * 把凭据记录里的任意 payload 收敛成完整设置。
 *
 * 读取路径刻意不做 URL 合法性校验：历史记录可能已经失效，此时应让告警拉取
 * 给出可读错误，而不是让设置接口本身 500。
 */
export function normalizeSettings(value: unknown): SettingsPayload {
  const source = isRecord(value) ? value : {}
  return {
    url: typeof source.url === 'string' ? source.url.trim() : '',
    authMode: isAuthMode(source.authMode) ? source.authMode : 'none',
    username: typeof source.username === 'string' && source.username !== '' ? source.username : undefined,
    secret: typeof source.secret === 'string' && source.secret !== '' ? source.secret : undefined,
    insecureTls: source.insecureTls === true,
    refreshSeconds: clampRefreshSeconds(source.refreshSeconds),
  }
}

/** 读取当前设置；没有记录或记录类型不符时返回默认值。 */
export async function readSettings(credentials: CredentialsLike): Promise<SettingsPayload> {
  const record = await credentials.readRecord(SETTINGS_KEY)
  const payload = record !== undefined && record.kind === 'grant' ? record.payload : undefined
  return normalizeSettings(payload)
}

/** 前端可见的设置视图；secret 只以 `hasSecret` 的形式出现。 */
export function publicSettings(settings: SettingsPayload): PublicSettings {
  return {
    url: settings.url,
    authMode: settings.authMode,
    username: settings.username ?? '',
    hasSecret: typeof settings.secret === 'string' && settings.secret !== '',
    insecureTls: settings.insecureTls,
    refreshSeconds: settings.refreshSeconds,
  }
}

/**
 * 保存设置。
 *
 * - `secret` 省略或空串 = 保留旧值；`authMode: 'none'` 时清空 secret。
 * - `refreshSeconds` 夹在 5–300 秒。
 * - `url` 必须是 http/https 绝对地址。
 */
export async function saveSettings(credentials: CredentialsLike, input: unknown): Promise<PublicSettings> {
  if (!isRecord(input)) throw new SettingsError('请求体必须是 JSON 对象')
  const current = await readSettings(credentials)

  const url = normalizeUrl(input.url === undefined ? current.url : input.url)

  let authMode: AuthMode
  if (input.authMode === undefined) {
    authMode = current.authMode
  } else if (isAuthMode(input.authMode)) {
    authMode = input.authMode
  } else {
    throw new SettingsError('鉴权方式只能是 none、basic 或 bearer')
  }

  let username: string | undefined
  if (authMode === 'basic') {
    if (typeof input.username === 'string') username = input.username.trim() || undefined
    else username = current.username
  }

  let secret: string | undefined
  if (authMode === 'none') {
    secret = undefined
  } else if (typeof input.secret === 'string' && input.secret.trim() !== '') {
    secret = input.secret
  } else {
    secret = current.secret
  }

  const next: SettingsPayload = {
    url,
    authMode,
    username,
    secret,
    insecureTls: typeof input.insecureTls === 'boolean' ? input.insecureTls : current.insecureTls,
    refreshSeconds:
      input.refreshSeconds === undefined
        ? current.refreshSeconds
        : clampRefreshSeconds(input.refreshSeconds, current.refreshSeconds),
  }

  // 凭据服务要求 payload 严格可 JSON 表示：显式构造不含 undefined 自有属性的对象，
  // 否则 `authMode: 'none'`（username/secret 均为 undefined）会在保存时被拒绝。
  const payload: SettingsPayload = {
    url: next.url,
    authMode: next.authMode,
    insecureTls: next.insecureTls,
    refreshSeconds: next.refreshSeconds,
    ...(next.username === undefined ? {} : { username: next.username }),
    ...(next.secret === undefined ? {} : { secret: next.secret }),
  }

  await credentials.modifyRecord(SETTINGS_KEY, async () => ({ kind: 'grant', payload }))
  return publicSettings(next)
}

/** 是否已经配置到可以拉取告警。 */
export function isSettingsConfigured(settings: SettingsPayload | undefined): settings is SettingsPayload {
  return settings !== undefined && settings.url !== ''
}
