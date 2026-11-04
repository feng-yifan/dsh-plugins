/**
 * dsh-alertmanager · AlertManager HTTP API v2 客户端
 *
 * 只做三件事：拼地址与鉴权头、拉取 `/api/v2/alerts`、把响应归一化成面板与
 * prompt 都能直接消费的形状。默认走 Node 全局 `fetch`；`insecureTls` 且地址
 * 是 https 时改走 `node:https` 并关闭证书校验（不引第三方库）。
 */
import { request as httpsRequest } from 'node:https'
import type { SettingsPayload } from './settings.js'

/** `/api/v2/alerts` 的查询串：活跃、静默、抑制、未处理全部拉回，由面板筛选。 */
const ALERTS_PATH = '/api/v2/alerts?active=true&silenced=true&inhibited=true&unprocessed=true'

/** 单次拉取的超时时间（毫秒）。 */
export const ALERTMANAGER_TIMEOUT_MS = 10_000

/** 内存缓存有效期（毫秒）。 */
export const ALERTMANAGER_CACHE_TTL_MS = 5_000

/** 告警状态：由 `status.state` 映射，缺失按 active。 */
export type AlertState = 'active' | 'suppressed' | 'unprocessed'

/** 一条归一化后的告警。所有字段都保证存在，缺失值用空串/空数组兜底。 */
export interface Alert {
  fingerprint: string
  name: string
  severity: string
  state: AlertState
  startsAt: string
  endsAt: string
  updatedAt: string
  generatorURL: string
  summary: string
  description: string
  labels: Record<string, string>
  annotations: Record<string, string>
  receivers: string[]
  silencedBy: string[]
  inhibitedBy: string[]
}

/** 一次拉取的完整结果。 */
export interface AlertsPayload {
  fetchedAt: string
  alerts: Alert[]
  stats: {
    total: number
    active: number
    suppressed: number
  }
}

/** AlertManager 请求/响应错误；路由把它映射为 HTTP 502。 */
export class AlertmanagerError extends Error {
  readonly status = 502
  readonly httpStatus?: number

  constructor(message: string, httpStatus?: number) {
    super(message)
    this.name = 'AlertmanagerError'
    this.httpStatus = httpStatus
  }
}

/** 注入用的最小 fetch 形状，测试可替换。 */
export interface FetchResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<FetchResponseLike>

/** 客户端可注入的依赖。 */
export interface AlertmanagerSourceOptions {
  fetch?: FetchLike
  now?: () => number
  timeoutMs?: number
  cacheTtlMs?: number
}

/** 由设置生成设置签名，作为 5 秒缓存的 key。 */
export function settingsSignature(settings: SettingsPayload): string {
  return JSON.stringify([
    settings.url,
    settings.authMode,
    settings.username ?? '',
    settings.secret ?? '',
    settings.insecureTls === true,
  ])
}

/** 拼出 `base.replace(/\/+$/, '') + '/api/v2/alerts?...'`。 */
export function buildAlertsUrl(base: string): string {
  return String(base ?? '').replace(/\/+$/, '') + ALERTS_PATH
}

/** 根据鉴权方式生成请求头；none 时不加 Authorization。 */
export function buildAuthHeaders(settings: SettingsPayload): Record<string, string> {
  if (settings.authMode === 'basic') {
    const token = Buffer.from(`${settings.username ?? ''}:${settings.secret ?? ''}`, 'utf8').toString('base64')
    return { Authorization: `Basic ${token}` }
  }
  if (settings.authMode === 'bearer') {
    return { Authorization: `Bearer ${settings.secret ?? ''}` }
  }
  return {}
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function asStringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(asRecord(value))) {
    if (typeof item === 'string') result[key] = item
    else if (item !== null && item !== undefined) result[key] = String(item)
  }
  return result
}

function normalizeState(value: unknown): AlertState {
  const state = asString(value)
  if (state === 'suppressed' || state === 'unprocessed') return state
  return 'active'
}

const STATE_RANK: Record<AlertState, number> = { active: 0, suppressed: 1, unprocessed: 2 }
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity.toLowerCase()] ?? 3
}

/** 面板排序：状态（活跃在前）→ 严重度 critical>warning>info>其它 → 名称 → 开始时间倒序。 */
export function compareAlerts(left: Alert, right: Alert): number {
  if (left.state !== right.state) return STATE_RANK[left.state] - STATE_RANK[right.state]
  const severity = severityRank(left.severity) - severityRank(right.severity)
  if (severity !== 0) return severity
  if (left.name !== right.name) return left.name < right.name ? -1 : 1
  if (left.startsAt !== right.startsAt) {
    if (left.startsAt === '') return 1
    if (right.startsAt === '') return -1
    return left.startsAt < right.startsAt ? 1 : -1
  }
  if (left.fingerprint === right.fingerprint) return 0
  return left.fingerprint < right.fingerprint ? -1 : 1
}

/**
 * 归一化 AlertManager 的告警数组。
 *
 * 非数组输入视为无效 API 响应并抛错；数组里的单条字段缺失则逐项兜底。
 */
export function normalizeAlerts(raw: unknown): Alert[] {
  if (!Array.isArray(raw)) {
    throw new AlertmanagerError('AlertManager 返回的数据不是告警数组')
  }
  const alerts = raw.map((item): Alert => {
    const source = asRecord(item)
    const labels = asStringMap(source.labels)
    const annotations = asStringMap(source.annotations)
    const status = asRecord(source.status)
    return {
      fingerprint: asString(source.fingerprint),
      name: labels.alertname ?? '',
      severity: labels.severity ?? '',
      state: normalizeState(status.state),
      startsAt: asString(source.startsAt),
      endsAt: asString(source.endsAt),
      updatedAt: asString(source.updatedAt),
      generatorURL: asString(source.generatorURL),
      summary: annotations.summary ?? '',
      description: annotations.description ?? '',
      labels,
      annotations,
      receivers: asStringList(source.receivers),
      silencedBy: asStringList(status.silencedBy),
      inhibitedBy: asStringList(status.inhibitedBy),
    }
  })
  return alerts.sort(compareAlerts)
}

/** 把响应体压成不超过 300 字符的单行摘要，供错误信息使用。 */
export function summarizeResponse(body: string, limit = 300): string {
  const collapsed = String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= limit) return collapsed
  return `${collapsed.slice(0, Math.max(0, limit - 1))}…`
}

function requestError(error: unknown): AlertmanagerError {
  if (error instanceof AlertmanagerError) return error
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out/i.test(message)) {
    return new AlertmanagerError(`AlertManager 请求超时（${ALERTMANAGER_TIMEOUT_MS / 1000} 秒）`)
  }
  return new AlertmanagerError(`无法连接 AlertManager：${message || '未知网络错误'}`)
}

/** 关闭证书校验时的 https 请求；超时与响应体处理与 fetch 路径保持一致。 */
function httpsGetJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      { method: 'GET', headers, rejectUnauthorized: false, timeout: timeoutMs },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
        response.on('error', reject)
      },
    )
    request.on('timeout', () => {
      request.destroy(new Error(`AlertManager 请求超时（${Math.round(timeoutMs / 1000)} 秒）`))
    })
    request.on('error', reject)
    request.end()
  })
}

/**
 * 带 5 秒内存缓存的告警来源。缓存按设置签名隔离，设置一改就自然失效。
 */
export class AlertmanagerSource {
  private readonly options: AlertmanagerSourceOptions
  private cache: { key: string; at: number; value: AlertsPayload } | undefined

  constructor(options: AlertmanagerSourceOptions = {}) {
    this.options = options
  }

  /** 主动丢弃缓存；派发前强制拉最新时使用。 */
  invalidate(): void {
    this.cache = undefined
  }

  /**
   * 拉取告警。
   *
   * @param settings - 当前设置（必须已配置 url）。
   * @param options.fresh - true 时绕过 5 秒缓存。
   */
  async fetch(settings: SettingsPayload, options: { fresh?: boolean } = {}): Promise<AlertsPayload> {
    const key = settingsSignature(settings)
    const now = this.options.now?.() ?? Date.now()
    const ttl = this.options.cacheTtlMs ?? ALERTMANAGER_CACHE_TTL_MS
    if (options.fresh !== true && this.cache !== undefined && this.cache.key === key && now - this.cache.at < ttl) {
      return this.cache.value
    }
    const value = await this.load(settings, now)
    this.cache = { key, at: now, value }
    return value
  }

  private async load(settings: SettingsPayload, now: number): Promise<AlertsPayload> {
    if (settings.url === '') throw new AlertmanagerError('尚未配置 AlertManager 地址')
    const url = buildAlertsUrl(settings.url)
    const headers = { accept: 'application/json', ...buildAuthHeaders(settings) }
    const timeoutMs = this.options.timeoutMs ?? ALERTMANAGER_TIMEOUT_MS

    let status: number
    let body: string
    try {
      if (settings.insecureTls === true && url.toLowerCase().startsWith('https://')) {
        const result = await httpsGetJson(url, headers, timeoutMs)
        status = result.status
        body = result.body
      } else {
        const fetchImpl = this.options.fetch ?? (globalThis.fetch as unknown as FetchLike)
        const response = await fetchImpl(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        })
        status = response.status
        body = await response.text()
      }
    } catch (error) {
      throw requestError(error)
    }

    const summary = summarizeResponse(body)
    if (status < 200 || status >= 300) {
      throw new AlertmanagerError(
        `AlertManager 返回 HTTP ${status}${summary === '' ? '' : `：${summary}`}`,
        status,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body) as unknown
    } catch {
      throw new AlertmanagerError(
        `AlertManager 返回的不是 JSON（HTTP ${status}）${summary === '' ? '' : `：${summary}`}`,
        status,
      )
    }

    const alerts = normalizeAlerts(parsed)
    return {
      fetchedAt: new Date(now).toISOString(),
      alerts,
      stats: {
        total: alerts.length,
        active: alerts.filter((alert) => alert.state === 'active').length,
        suppressed: alerts.filter((alert) => alert.state === 'suppressed').length,
      },
    }
  }
}
