/**
 * dsh-alertmanager · 浏览器半侧 API 客户端
 *
 * - 同源请求 `/_dsh/alertmanager/*`，支持 `AbortSignal`（取消刷新）；
 * - 非 JSON / 纯文本响应也容错；
 * - 识别 enhancement 网关 401 JSON 与 DSH 纯文本登录页，映射成稳定的本地化键；
 * - 已知服务端 `code` 走文案表，未知 code 显示服务端 `error` 原文。
 */
import type { Translate } from '../locales.js'

const API_BASE = '/_dsh/alertmanager'

/** 稳定的错误码集合（服务端 code 或客户端合成）。 */
export type ApiErrorCode =
  | 'settings.invalid'
  | 'alerts.fetch-failed'
  | 'alerts.not-configured'
  | 'dispatch.invalid'
  | 'dispatch.workspace-not-found'
  | 'dispatch.alerts-unavailable'
  | 'dispatch.create-failed'
  | 'dispatch.prompt-failed'
  | 'credentials.unavailable'
  | 'session.unavailable'
  | 'connection.unavailable'
  | 'request.invalid'
  | 'request.method-not-allowed'
  | 'auth.required'
  | 'auth.gateway'
  | 'auth.dsh'
  | 'aborted'
  | 'unknown'

/** 一次 API 失败。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly serverMessage: string
  readonly sessionId?: string

  constructor(options: {
    status: number
    code: string
    message: string
    serverMessage?: string
    sessionId?: string
  }) {
    super(options.message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.serverMessage = options.serverMessage ?? options.message
    this.sessionId = options.sessionId
  }
}

/** 服务端 code → 本地化键。未知 code 不在此表里。 */
const CODE_KEYS: Record<string, string> = {
  'settings.invalid': 'error.settingsInvalid',
  'alerts.fetch-failed': 'error.alertsFetchFailed',
  'alerts.not-configured': 'error.notConfigured',
  'dispatch.invalid': 'error.dispatchInvalid',
  'dispatch.workspace-not-found': 'error.workspaceNotFound',
  'dispatch.alerts-unavailable': 'error.alertsUnavailable',
  'dispatch.create-failed': 'error.dispatchCreateFailed',
  'dispatch.prompt-failed': 'error.dispatchPromptFailed',
  'credentials.unavailable': 'error.credentialsUnavailable',
  'session.unavailable': 'error.sessionUnavailable',
  'connection.unavailable': 'error.credentialsUnavailable',
  'request.invalid': 'error.requestInvalid',
  'request.method-not-allowed': 'error.methodNotAllowed',
  'auth.required': 'error.auth.dsh',
  'auth.gateway': 'error.auth.gateway',
  'auth.dsh': 'error.auth.dsh',
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 该错误是否由用户取消触发。 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === 'aborted'
  return error instanceof DOMException ? error.name === 'AbortError' : false
}

/** 该错误是否属于需要重新登录/刷新页面的鉴权错误。 */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'auth.gateway' || error.code === 'auth.dsh')
}

/** 把任意错误本地化成可展示文案；未知 code 显示服务端原文。 */
export function localizeApiError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const suffix =
      error.sessionId === undefined ? '' : t('error.sessionSuffix', { sessionId: error.sessionId })
    const key = CODE_KEYS[error.code]
    if (key !== undefined) return `${t(key)}${suffix}`
    if (error.serverMessage.trim() !== '') return `${error.serverMessage}${suffix}`
    if (error.status > 0) return `${t('error.http', { status: error.status })}${suffix}`
    return `${t('error.unknown')}${suffix}`
  }
  return t('error.unknown')
}

/**
 * 请求插件 API。
 *
 * @param path - 以 `/` 开头的相对路径，例如 `/settings`。
 * @param init - fetch 初始化（body 存在时自动带 JSON content-type）。
 * @param signal - 取消信号；调用方 `abort()` 时 fetch 以 AbortError 拒绝。
 */
export async function api<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> =
    init?.body === undefined ? {} : { 'content-type': 'application/json' }
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError({ status: 0, code: 'aborted', message: 'aborted' })
    }
    throw error
  }

  const text = await response.text()
  const parsed = parseJson(text)
  const data = recordOf(parsed)
  const serverMessage = typeof data.error === 'string' ? data.error : ''
  const serverCode = typeof data.code === 'string' ? data.code : ''

  // DSH 的纯文本登录提示可能来自任意状态码，优先识别。
  if (/dsh web authentication required/i.test(text)) {
    throw new ApiError({
      status: response.status,
      code: 'auth.dsh',
      message: 'dsh web authentication required',
      serverMessage: text.trim(),
    })
  }

  if (!response.ok) {
    // enhancement 网关：401 + {"error":"authentication required"}。
    if (
      response.status === 401 &&
      /authentication required/i.test(serverMessage || text)
    ) {
      throw new ApiError({
        status: response.status,
        code: 'auth.gateway',
        message: 'authentication required',
        serverMessage,
      })
    }
    throw new ApiError({
      status: response.status,
      code: serverCode !== '' ? serverCode : response.status === 401 ? 'auth.dsh' : 'unknown',
      message: serverMessage !== '' ? serverMessage : text.trim(),
      serverMessage: serverMessage !== '' ? serverMessage : text.trim(),
      ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    })
  }

  return (parsed === undefined ? {} : parsed) as T
}
