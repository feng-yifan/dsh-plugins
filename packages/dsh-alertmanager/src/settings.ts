/**
 * dsh-alertmanager · 设置持久化（v2：多实例）
 *
 * 设置不写 profile 的 `cordis.patch.yml`，而是作为一条 grant 记录存进 DSH
 * 凭据服务（`ctx.credentials`），key 固定为 `dsh-alertmanager/settings`。
 * 记录 payload 是插件自有 JSON；口令/token 永远不会出现在读接口的响应里。
 *
 * v1 只有一个 `url`，读取时自动迁移成 v2 的单实例（id=`default`），v1 的
 * `refreshSeconds` 丢弃（刷新间隔改由浏览器 localStorage 保存）。
 */
import type { CredentialsLike } from './types.js'

/** 凭据服务里的记录 key。 */
export const SETTINGS_KEY = 'dsh-alertmanager/settings'

/** 当前设置结构版本。 */
export const SETTINGS_VERSION = 2

/** 支持的 AlertManager 鉴权方式。 */
export type AuthMode = 'none' | 'basic' | 'bearer'

/** 一个 AlertManager 实例的完整设置（含 secret，仅宿主内部使用）。 */
export interface InstanceSettings {
  id: string
  name: string
  url: string
  authMode: AuthMode
  username?: string
  secret?: string
  insecureTls?: boolean
}

/** 凭据记录里的完整设置。 */
export interface SettingsPayload {
  version: typeof SETTINGS_VERSION
  instances: InstanceSettings[]
}

/** 面向前端的单实例视图：绝不含 secret，只暴露 `hasSecret`。 */
export interface PublicInstance {
  id: string
  name: string
  url: string
  authMode: AuthMode
  username: string
  hasSecret: boolean
  insecureTls: boolean
}

/** 面向前端的设置视图。 */
export interface PublicSettings {
  instances: PublicInstance[]
}

/** 设置校验失败；路由把它映射为 HTTP 400 + `settings.invalid`。 */
export class SettingsError extends Error {
  readonly status = 400
  readonly code = 'settings.invalid'

  constructor(message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

/** 未配置时的默认值。 */
export const DEFAULT_SETTINGS: SettingsPayload = { version: SETTINGS_VERSION, instances: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === 'none' || value === 'basic' || value === 'bearer'
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

/** 从地址里取 host 作为实例名称的兜底；取不到时返回 `fallback`。 */
export function deriveInstanceName(url: string, fallback = ''): string {
  try {
    const parsed = new URL(url)
    if (parsed.host !== '') return parsed.host
  } catch {
    /* 非法地址在读取路径上不做校验，交给拉取阶段报可读错误。 */
  }
  return fallback
}

function normalizeInstance(value: unknown, index: number): InstanceSettings | undefined {
  if (!isRecord(value)) return undefined
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  // 空地址的实例不可用；读取时直接丢弃，避免「看起来配置了但永远 502」。
  if (url === '') return undefined
  const id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : `instance-${index + 1}`
  const name =
    typeof value.name === 'string' && value.name.trim() !== ''
      ? value.name.trim()
      : deriveInstanceName(url, `实例 ${index + 1}`)
  const authMode = isAuthMode(value.authMode) ? value.authMode : 'none'
  const username =
    authMode === 'basic' && typeof value.username === 'string' && value.username !== ''
      ? value.username
      : undefined
  const secret =
    authMode !== 'none' && typeof value.secret === 'string' && value.secret !== ''
      ? value.secret
      : undefined
  return {
    id,
    name,
    url,
    authMode,
    ...(username === undefined ? {} : { username }),
    ...(secret === undefined ? {} : { secret }),
    ...(value.insecureTls === true ? { insecureTls: true } : {}),
  }
}

/**
 * 把凭据记录里的任意 payload 收敛成 v2 设置。
 *
 * - `{version:2, instances:[...]}`：逐项容错读取；
 * - v1 `{url,...}`：迁移成单实例（id=`default`，名称取 URL host），
 *   丢弃 `refreshSeconds`；
 * - 空/缺失/无法识别：`{version:2, instances:[]}`。
 *
 * 读取路径刻意不做 URL 合法性校验：历史记录可能已经失效，此时应让告警拉取
 * 给出可读错误，而不是让设置接口本身 500。
 */
export function normalizeSettings(value: unknown): SettingsPayload {
  const source = isRecord(value) ? value : {}
  if (Array.isArray(source.instances)) {
    const seenIds = new Set<string>()
    const instances: InstanceSettings[] = []
    source.instances.forEach((item, index) => {
      const instance = normalizeInstance(item, index)
      if (instance === undefined) return
      // 读取容错：重复 id 只保留第一条，避免后续按 id 覆盖时语义不明。
      if (seenIds.has(instance.id)) return
      seenIds.add(instance.id)
      instances.push(instance)
    })
    return { version: SETTINGS_VERSION, instances }
  }

  const legacyUrl = typeof source.url === 'string' ? source.url.trim() : ''
  if (legacyUrl === '') return { version: SETTINGS_VERSION, instances: [] }
  const authMode = isAuthMode(source.authMode) ? source.authMode : 'none'
  const legacy: InstanceSettings = {
    id: 'default',
    name: deriveInstanceName(legacyUrl, '默认实例'),
    url: legacyUrl,
    authMode,
    ...(authMode === 'basic' && typeof source.username === 'string' && source.username !== ''
      ? { username: source.username }
      : {}),
    ...(authMode !== 'none' && typeof source.secret === 'string' && source.secret !== ''
      ? { secret: source.secret }
      : {}),
    ...(source.insecureTls === true ? { insecureTls: true } : {}),
  }
  return { version: SETTINGS_VERSION, instances: [legacy] }
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
    instances: settings.instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      url: instance.url,
      authMode: instance.authMode,
      username: instance.username ?? '',
      hasSecret: typeof instance.secret === 'string' && instance.secret !== '',
      insecureTls: instance.insecureTls === true,
    })),
  }
}

function normalizeInputName(value: unknown, index: number, url: string, previousName?: string): string {
  if (value === undefined) {
    const fallback = previousName ?? deriveInstanceName(url, `实例 ${index + 1}`)
    return fallback
  }
  if (typeof value !== 'string') throw new SettingsError('实例名称必须是字符串')
  const name = value.trim()
  if (name === '') throw new SettingsError('实例名称不能为空')
  return name
}

/**
 * 保存设置（全量替换）。
 *
 * - `secret` 省略或空串 = 按 `id` 保留旧 secret；`authMode: 'none'` 清空 secret；
 * - 新 id 无旧 secret 且鉴权方式需要 secret 时按空串处理，不报错；
 * - 写入 payload 的 JSON 不含任何 undefined 自有属性（DSH 凭据服务严格校验）。
 */
export async function saveSettings(credentials: CredentialsLike, input: unknown): Promise<PublicSettings> {
  if (!isRecord(input)) throw new SettingsError('请求体必须是 JSON 对象')
  if (!Array.isArray(input.instances)) throw new SettingsError('instances 必须是数组')
  const current = await readSettings(credentials)
  const previousById = new Map(current.instances.map((instance) => [instance.id, instance]))
  const seenIds = new Set<string>()
  const seenUrls = new Set<string>()
  const instances: InstanceSettings[] = []

  input.instances.forEach((raw, index) => {
    if (!isRecord(raw)) throw new SettingsError('每个实例必须是 JSON 对象')

    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (id === '') throw new SettingsError('实例 ID 不能为空')
    if (seenIds.has(id)) throw new SettingsError(`实例 ID 重复：${id}`)
    seenIds.add(id)

    const url = normalizeUrl(raw.url)
    if (seenUrls.has(url)) throw new SettingsError(`实例地址重复：${url}`)
    seenUrls.add(url)

    const previous = previousById.get(id)
    const name = normalizeInputName(raw.name, index, url, previous?.name)

    let authMode: AuthMode
    if (raw.authMode === undefined) authMode = previous?.authMode ?? 'none'
    else if (isAuthMode(raw.authMode)) authMode = raw.authMode
    else throw new SettingsError('鉴权方式只能是 none、basic 或 bearer')

    let username: string | undefined
    if (authMode === 'basic') {
      if (raw.username === undefined) username = previous?.username
      else if (typeof raw.username === 'string') username = raw.username.trim() || undefined
      else throw new SettingsError('用户名必须是字符串')
    }

    let secret: string | undefined
    if (authMode === 'none') {
      secret = undefined
    } else if (typeof raw.secret === 'string' && raw.secret !== '') {
      secret = raw.secret
    } else if (typeof raw.secret !== 'undefined' && typeof raw.secret !== 'string') {
      throw new SettingsError('口令 / token 必须是字符串')
    } else {
      secret = previous?.secret
    }
    // 新实例没有旧 secret 且鉴权方式需要它：按空串处理，保存不报错。
    if (authMode !== 'none' && secret === undefined) secret = ''

    const next: InstanceSettings = {
      id,
      name,
      url,
      authMode,
      ...(username === undefined ? {} : { username }),
      ...(secret === undefined ? {} : { secret }),
      ...(raw.insecureTls === true ? { insecureTls: true } : {}),
    }
    instances.push(next)
  })

  const payload: SettingsPayload = { version: SETTINGS_VERSION, instances }
  await credentials.modifyRecord(SETTINGS_KEY, async () => ({ kind: 'grant', payload }))
  return publicSettings(payload)
}

/** 是否已经配置到可以拉取告警。 */
export function isSettingsConfigured(settings: SettingsPayload | undefined): settings is SettingsPayload {
  return settings !== undefined && settings.instances.length > 0
}
