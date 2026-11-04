/**
 * dsh-alertmanager · AlertManager HTTP API v2 客户端（多实例）
 *
 * 只做四件事：拼地址与鉴权头、拉取单个实例的 `/api/v2/alerts`、把响应
 * 归一化成面板与 prompt 都能直接消费的形状、并行聚合多个实例并按统一规则
 * 排序。默认走 Node 全局 `fetch`；`insecureTls` 且地址是 https 时改走
 * `node:https` 并关闭证书校验（不引第三方库）。
 */
import { request as httpsRequest } from 'node:https'
import type { InstanceSettings } from './settings.js'

/** `/api/v2/alerts` 的查询串：活跃、静默、抑制、未处理全部拉回，由面板筛选。 */
const ALERTS_PATH = '/api/v2/alerts?active=true&silenced=true&inhibited=true&unprocessed=true'

/** 单次拉取的超时时间（毫秒）。 */
export const ALERTMANAGER_TIMEOUT_MS = 10_000

/** 内存缓存有效期（毫秒）。 */
export const ALERTMANAGER_CACHE_TTL_MS = 5_000

/** 单实例失败时返回给前端的稳定错误码。 */
export const INSTANCE_ERROR_CODE = 'alerts.instance-failed'

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

/** 合并列表里的告警：在单条告警上补实例信息。 */
export interface MergedAlert extends Alert {
  instanceId: string
  instanceName: string
  instanceUrl: string
}

/** 单个实例的拉取统计。 */
export interface AlertStats {
  total: number
  active: number
  suppressed: number
}

/** 单个实例的拉取结果（成功或失败都保留这一项，便于前端逐实例展示）。 */
export interface InstanceAlertsResult {
  id: string
  name: string
  url: string
  ok: boolean
  error?: string
  code?: string
  alerts: Alert[]
  stats: AlertStats
}

/** 一次多实例拉取的完整结果。 */
export interface AlertsPayload {
  fetchedAt: string
  instances: InstanceAlertsResult[]
  alerts: MergedAlert[]
}

/** 单个实例的纯数据（不含 id/name/url，供缓存与派发复用）。 */
export interface InstanceAlertData {
  fetchedAt: string
  alerts: Alert[]
  stats: AlertStats
}

/** 单实例失败的细分原因（客户端按 code 做本地化，未知 code 回退服务端文案）。 */
export const INSTANCE_ERROR_CODES = {
  tls: 'alerts.tls-untrusted',
  timeout: 'alerts.timeout',
  network: 'alerts.network',
  http: 'alerts.http',
  invalidResponse: 'alerts.invalid-response',
  notConfigured: 'alerts.not-configured',
} as const

/** 单实例请求错误；路由把它映射为 HTTP 502。 */
export class AlertmanagerError extends Error {
  readonly status = 502
  readonly code: string
  readonly httpStatus?: number

  constructor(message: string, httpStatus?: number, code: string = INSTANCE_ERROR_CODE) {
    super(message)
    this.name = 'AlertmanagerError'
    this.httpStatus = httpStatus
    this.code = code
  }
}

/** 聚合层错误：未配置实例、全部实例失败等；路由按携带的 status/code 返回。 */
export class AlertmanagerAggregateError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'AlertmanagerAggregateError'
    this.status = status
    this.code = code
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

/** 由实例设置生成设置签名，作为 5 秒缓存的 key。 */
export function settingsSignature(instance: InstanceSettings): string {
  return JSON.stringify([
    instance.id,
    instance.url,
    instance.authMode,
    instance.username ?? '',
    instance.secret ?? '',
    instance.insecureTls === true,
  ])
}

/** 拼出 `base.replace(/\/+$/, '') + '/api/v2/alerts?...'`。 */
export function buildAlertsUrl(base: string): string {
  return String(base ?? '').replace(/\/+$/, '') + ALERTS_PATH
}

/** 根据鉴权方式生成请求头；none 时不加 Authorization。 */
export function buildAuthHeaders(
  instance: Pick<InstanceSettings, 'authMode' | 'username' | 'secret'>,
): Record<string, string> {
  if (instance.authMode === 'basic') {
    const token = Buffer.from(`${instance.username ?? ''}:${instance.secret ?? ''}`, 'utf8').toString('base64')
    return { Authorization: `Basic ${token}` }
  }
  if (instance.authMode === 'bearer') {
    return { Authorization: `Bearer ${instance.secret ?? ''}` }
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

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** 单实例排序：状态（活跃在前）→ 严重度 critical>warning>info>其它 → 名称 → 开始时间倒序。 */
export function compareAlerts(left: Alert, right: Alert): number {
  if (left.state !== right.state) return STATE_RANK[left.state] - STATE_RANK[right.state]
  const severity = severityRank(left.severity) - severityRank(right.severity)
  if (severity !== 0) return severity
  if (left.name !== right.name) return compareText(left.name, right.name)
  if (left.startsAt !== right.startsAt) {
    if (left.startsAt === '') return 1
    if (right.startsAt === '') return -1
    return left.startsAt < right.startsAt ? 1 : -1
  }
  if (left.fingerprint === right.fingerprint) return 0
  return compareText(left.fingerprint, right.fingerprint)
}

/** 合并列表排序：状态 → 严重度 → 名称 → 开始时间倒序 → instanceId / fingerprint 稳定断尾。 */
export function compareMergedAlerts(left: MergedAlert, right: MergedAlert): number {
  if (left.state !== right.state) return STATE_RANK[left.state] - STATE_RANK[right.state]
  const severity = severityRank(left.severity) - severityRank(right.severity)
  if (severity !== 0) return severity
  if (left.name !== right.name) return compareText(left.name, right.name)
  if (left.startsAt !== right.startsAt) {
    if (left.startsAt === '') return 1
    if (right.startsAt === '') return -1
    return left.startsAt < right.startsAt ? 1 : -1
  }
  if (left.instanceId !== right.instanceId) return compareText(left.instanceId, right.instanceId)
  return compareText(left.fingerprint, right.fingerprint)
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

/** 计算单实例统计。 */
export function alertStats(alerts: readonly Alert[]): AlertStats {
  return {
    total: alerts.length,
    active: alerts.filter((alert) => alert.state === 'active').length,
    suppressed: alerts.filter((alert) => alert.state === 'suppressed').length,
  }
}

/** 把响应体压成不超过 300 字符的单行摘要，供错误信息使用。 */
export function summarizeResponse(body: string, limit = 300): string {
  const collapsed = String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= limit) return collapsed
  return `${collapsed.slice(0, Math.max(0, limit - 1))}…`
}

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/** 从 fetch 的 cause 链里取出最底层错误码（undici 把原因放在 `error.cause`）。 */
function causeCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && code !== '') return code
      current = (current as { cause?: unknown }).cause
    } else {
      return undefined
    }
  }
  return undefined
}

function requestError(error: unknown): AlertmanagerError {
  if (error instanceof AlertmanagerError) return error
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  const code = causeCode(error)
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out/i.test(message)) {
    return new AlertmanagerError(
      `AlertManager 请求超时（${ALERTMANAGER_TIMEOUT_MS / 1000} 秒）`,
      undefined,
      INSTANCE_ERROR_CODES.timeout,
    )
  }
  if (code !== undefined && TLS_ERROR_CODES.has(code)) {
    return new AlertmanagerError(
      `无法连接 AlertManager（证书链不受信任：${code}）：可在实例设置里勾选「忽略 TLS 证书校验」，` +
        '或让 DSH 进程使用系统 CA（启动时加 NODE_OPTIONS=--use-openssl-ca，或设置 NODE_EXTRA_CA_CERTS）。',
      undefined,
      INSTANCE_ERROR_CODES.tls,
    )
  }
  return new AlertmanagerError(
    `无法连接 AlertManager：${message || '未知网络错误'}${code === undefined ? '' : `（${code}）`}`,
    undefined,
    INSTANCE_ERROR_CODES.network,
  )
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

interface CacheEntry {
  signature: string
  at: number
  value: InstanceAlertData
}

/**
 * 带 5 秒内存缓存的告警来源。
 *
 * 缓存按实例 id 分槽、槽内按设置签名校验，设置一改就自然失效。`fresh` 绕过缓存。
 */
export class AlertmanagerSource {
  private readonly options: AlertmanagerSourceOptions
  private readonly cache = new Map<string, CacheEntry>()

  constructor(options: AlertmanagerSourceOptions = {}) {
    this.options = options
  }

  /** 主动丢弃全部缓存；保存设置或派发前强制拉最新时使用。 */
  invalidate(): void {
    this.cache.clear()
  }

  /**
   * 拉取单个实例的告警。
   *
   * @param instance - 当前设置的实例（url 必须非空）。
   * @param options.fresh - true 时绕过 5 秒缓存。
   */
  async fetchInstance(instance: InstanceSettings, options: { fresh?: boolean } = {}): Promise<InstanceAlertData> {
    const signature = settingsSignature(instance)
    const now = this.options.now?.() ?? Date.now()
    const ttl = this.options.cacheTtlMs ?? ALERTMANAGER_CACHE_TTL_MS
    const cached = this.cache.get(instance.id)
    if (options.fresh !== true && cached !== undefined && cached.signature === signature && now - cached.at < ttl) {
      return cached.value
    }
    const value = await this.load(instance, now)
    this.cache.set(instance.id, { signature, at: now, value })
    return value
  }

  /**
   * 并行拉取多个实例并聚合成面板响应。
   *
   * 单实例失败只影响自己的 `ok:false/error`，其它实例照常返回；全部失败时
   * 抛 {@link AlertmanagerAggregateError}（code `alerts.fetch-failed`）。
   * 没有实例时抛 code `alerts.not-configured`。
   */
  async fetchAll(
    instances: readonly InstanceSettings[],
    options: { fresh?: boolean } = {},
  ): Promise<AlertsPayload> {
    if (instances.length === 0) {
      throw new AlertmanagerAggregateError('尚未配置 AlertManager 实例', 'alerts.not-configured', 400)
    }
    const now = this.options.now?.() ?? Date.now()
    const results: InstanceAlertsResult[] = await Promise.all(
      instances.map(async (instance): Promise<InstanceAlertsResult> => {
        try {
          const data = await this.fetchInstance(instance, options)
          return {
            id: instance.id,
            name: instance.name,
            url: instance.url,
            ok: true,
            alerts: data.alerts,
            stats: data.stats,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            id: instance.id,
            name: instance.name,
            url: instance.url,
            ok: false,
            error: message,
            code: error instanceof AlertmanagerError ? error.code : 'alerts.instance-failed',
            alerts: [],
            stats: { total: 0, active: 0, suppressed: 0 },
          }
        }
      }),
    )

    if (results.every((result) => !result.ok)) {
      const detail = results
        .map((result) => `${result.name}：${result.error ?? '未知错误'}`)
        .join('；')
      throw new AlertmanagerAggregateError(`所有 AlertManager 实例都不可达：${detail}`, 'alerts.fetch-failed', 400)
    }

    const merged: MergedAlert[] = []
    for (const result of results) {
      if (!result.ok) continue
      for (const alert of result.alerts) {
        merged.push({
          ...alert,
          instanceId: result.id,
          instanceName: result.name,
          instanceUrl: result.url,
        })
      }
    }
    merged.sort(compareMergedAlerts)

    return {
      fetchedAt: new Date(now).toISOString(),
      instances: results,
      alerts: merged,
    }
  }

  private async load(instance: InstanceSettings, now: number): Promise<InstanceAlertData> {
    if (instance.url === '') {
      throw new AlertmanagerError('尚未配置 AlertManager 地址', undefined, INSTANCE_ERROR_CODES.notConfigured)
    }
    const url = buildAlertsUrl(instance.url)
    const headers = { accept: 'application/json', ...buildAuthHeaders(instance) }
    const timeoutMs = this.options.timeoutMs ?? ALERTMANAGER_TIMEOUT_MS

    let status: number
    let body: string
    try {
      if (instance.insecureTls === true && url.toLowerCase().startsWith('https://')) {
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
        INSTANCE_ERROR_CODES.http,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body) as unknown
    } catch {
      throw new AlertmanagerError(
        `AlertManager 返回的不是 JSON（HTTP ${status}）${summary === '' ? '' : `：${summary}`}`,
        status,
        INSTANCE_ERROR_CODES.invalidResponse,
      )
    }

    const alerts = normalizeAlerts(parsed)
    return {
      fetchedAt: new Date(now).toISOString(),
      alerts,
      stats: alertStats(alerts),
    }
  }
}
