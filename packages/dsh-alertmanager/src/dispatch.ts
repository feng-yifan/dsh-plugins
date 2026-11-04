/**
 * dsh-alertmanager · 派发
 *
 * 把面板里选中的告警变成“在新会话里立即开始的一轮工作”：
 * 校验 → 解析工作区 → 重新拉最新告警 → 生成 prompt → 新建会话 →
 * 尽力改标题 → 发送首条用户消息（mode: queue）并立即开始运行。
 *
 * 依赖全部可注入，测试无需真实宿主。
 */
import { randomUUID } from 'node:crypto'
import type { AlertsPayload, Alert } from './alertmanager.js'
import { buildPrompt } from './prompt.js'
import type { SettingsPayload } from './settings.js'
import type {
  LoggerLike,
  SessionControllerLike,
  WorkspaceRegistryLike,
} from './types.js'

/** 一次派发最多处理的告警条数。 */
export const MAX_DISPATCH_ALERTS = 20

/** 派发失败；`status` 供 HTTP 路由映射，`sessionId` 在会话已创建后携带。 */
export class DispatchError extends Error {
  readonly status: number
  readonly sessionId?: string

  constructor(message: string, status = 400, sessionId?: string) {
    super(message)
    this.name = 'DispatchError'
    this.status = status
    this.sessionId = sessionId
  }
}

/** 派发依赖。 */
export interface DispatchDeps {
  /** 当前设置；未配置 url 时给出可读 400。 */
  settings: SettingsPayload | undefined
  /** 重新拉取最新告警（必须绕过面板列表的缓存）。 */
  fetchAlerts: () => Promise<AlertsPayload>
  /** 会话服务；缺失时返回 503「当前 profile 不支持创建会话」。 */
  sessionController?: SessionControllerLike
  /** 工作区注册表；缺失时只跳过路径解析。 */
  workspaceRegistry?: WorkspaceRegistryLike
  /** 可选日志器；改名失败只记日志、不阻断。 */
  logger?: LoggerLike
  /** 测试注入：UUID 生成器。 */
  randomUUID?: () => string
}

/** 派发成功结果。 */
export interface DispatchResult {
  sessionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 标题上限 60 个字符（按码点截断，避免切坏代理对）。 */
export function buildSessionTitle(firstName: string, count: number): string {
  const name = firstName.trim() === '' ? '未命名告警' : firstName.trim()
  const title = `告警处理：${name} 等 ${count} 条`
  const characters = Array.from(title)
  if (characters.length <= 60) return title
  return `${characters.slice(0, 59).join('')}…`
}

function normalizeFingerprints(value: unknown): string[] {
  if (!Array.isArray(value)) throw new DispatchError('请选择 1–20 条告警')
  if (value.length < 1 || value.length > MAX_DISPATCH_ALERTS) {
    throw new DispatchError(`请选择 1–${MAX_DISPATCH_ALERTS} 条告警`)
  }
  const fingerprints: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new DispatchError('告警指纹必须是非空字符串')
    }
    fingerprints.push(item)
  }
  return fingerprints
}

function normalizeWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new DispatchError('请选择工作区')
  return value.trim()
}

/**
 * 执行一次派发。
 *
 * @param input - 请求体：`{ fingerprints: string[], workspaceId: string }`。
 * @param deps - 可注入依赖。
 * @returns 新会话的 id。
 * @throws {DispatchError} 校验失败、工作区不存在、缺少会话服务或 prompt 失败。
 */
export async function dispatchAlerts(input: unknown, deps: DispatchDeps): Promise<DispatchResult> {
  if (!isRecord(input)) throw new DispatchError('请求体必须是 JSON 对象')
  const fingerprints = normalizeFingerprints(input.fingerprints)
  const workspaceId = normalizeWorkspaceId(input.workspaceId)

  if (deps.settings === undefined || deps.settings.url === '') {
    throw new DispatchError('尚未配置 AlertManager 地址')
  }
  if (deps.sessionController === undefined) {
    throw new DispatchError('当前 profile 不支持创建会话', 503)
  }

  // 1. 解析工作区：有注册表时必须存在；没有注册表时 prompt 里标注路径未知。
  let workspacePath = ''
  if (deps.workspaceRegistry !== undefined) {
    let workspace: { path?: string } | undefined
    try {
      workspace = deps.workspaceRegistry.get(workspaceId)
    } catch {
      workspace = undefined
    }
    if (workspace === undefined) throw new DispatchError('工作区不存在', 404)
    if (typeof workspace.path === 'string') workspacePath = workspace.path
  }

  // 2. 重新拉最新告警，按指纹选出选中项；不在列表里的记下来写进 prompt。
  let latest: AlertsPayload
  try {
    latest = await deps.fetchAlerts()
  } catch (error) {
    throw new DispatchError(`拉取最新告警失败：${errorMessage(error)}`, 502)
  }
  const byFingerprint = new Map<string, Alert>()
  for (const alert of latest.alerts) {
    if (!byFingerprint.has(alert.fingerprint)) byFingerprint.set(alert.fingerprint, alert)
  }
  const selected: Alert[] = []
  const missing: string[] = []
  for (const fingerprint of fingerprints) {
    const alert = byFingerprint.get(fingerprint)
    if (alert === undefined) missing.push(fingerprint)
    else selected.push(alert)
  }

  // 3. 生成 prompt。
  const prompt = buildPrompt(selected, { workspacePath, missingFingerprints: missing })

  // 4. 新建会话。
  let sessionId: string
  try {
    const created = await deps.sessionController.create({ workspaceId })
    if (typeof created?.sessionId !== 'string' || created.sessionId === '') {
      throw new Error('宿主未返回会话 ID')
    }
    sessionId = created.sessionId
  } catch (error) {
    throw new DispatchError(`新建会话失败：${errorMessage(error)}`, 502)
  }

  // 5. 改标题：尽力而为，失败只记日志。
  const title = buildSessionTitle(selected[0]?.name ?? '', fingerprints.length)
  try {
    await deps.sessionController.rename?.({ sessionId, title })
  } catch (error) {
    deps.logger?.warn?.('[dsh-alertmanager] 重命名会话失败', errorMessage(error))
  }

  // 6. 写入首条用户消息并立即开始运行；失败时把 sessionId 带回前端。
  try {
    await deps.sessionController.prompt(
      {
        requestId: (deps.randomUUID ?? randomUUID)(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      },
      AbortSignal.timeout(15_000),
    )
  } catch (error) {
    throw new DispatchError(`会话已创建，但发送首条消息失败：${errorMessage(error)}`, 502, sessionId)
  }

  return { sessionId }
}
