/**
 * dsh-alertmanager · 派发（多实例）
 *
 * 把面板里选中的告警变成“在新会话里立即开始的一轮工作”：
 * 校验 → 解析工作区 → 按实例分组并行拉最新告警 → 生成 prompt → 新建会话 →
 * 尽力改标题 → 发送首条用户消息（mode: queue）并立即开始运行。
 *
 * 单实例不可达不阻断派发：prompt 里单列说明，其余实例的告警照常处理。
 * 依赖全部可注入，测试无需真实宿主。
 */
import { randomUUID } from 'node:crypto'
import type { Alert, InstanceAlertData } from './alertmanager.js'
import { buildPrompt, type PromptMissingAlert, type PromptUnavailableInstance } from './prompt.js'
import type { InstanceSettings, SettingsPayload } from './settings.js'
import type { LoggerLike, SessionControllerLike, WorkspaceRegistryLike } from './types.js'

export type DispatchErrorCode =
  | 'dispatch.invalid'
  | 'dispatch.workspace-not-found'
  | 'dispatch.alerts-unavailable'
  | 'dispatch.create-failed'
  | 'dispatch.prompt-failed'
  | 'alerts.not-configured'
  | 'session.unavailable'

/** 派发失败；`status`/`code` 供 HTTP 路由映射，`sessionId` 在会话已创建后携带。 */
export class DispatchError extends Error {
  readonly status: number
  readonly code: DispatchErrorCode
  readonly sessionId?: string

  constructor(message: string, status = 400, code: DispatchErrorCode = 'dispatch.invalid', sessionId?: string) {
    super(message)
    this.name = 'DispatchError'
    this.status = status
    this.code = code
    this.sessionId = sessionId
  }
}

/** 一条选中项。 */
export interface DispatchSelection {
  instanceId: string
  fingerprint: string
}

/** 派发依赖。 */
export interface DispatchDeps {
  /** 当前设置；没有实例时给出可读 400。 */
  settings: SettingsPayload | undefined
  /** 拉取单个实例的最新告警（实现里必须绕过面板缓存，即 fresh）。 */
  fetchInstance: (instance: InstanceSettings) => Promise<InstanceAlertData>
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

function normalizeSelections(value: unknown): DispatchSelection[] {
  if (!Array.isArray(value)) throw new DispatchError('selections 必须是数组')
  if (value.length < 1) throw new DispatchError('请至少选择 1 条告警')
  const seen = new Set<string>()
  const selections: DispatchSelection[] = []
  for (const item of value) {
    if (!isRecord(item)) throw new DispatchError('每条选择必须包含 instanceId 与 fingerprint')
    const instanceId = typeof item.instanceId === 'string' ? item.instanceId.trim() : ''
    if (instanceId === '') throw new DispatchError('实例 ID 必须是非空字符串')
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    if (fingerprint === '') throw new DispatchError('告警指纹必须是非空字符串')
    const key = JSON.stringify([instanceId, fingerprint])
    if (seen.has(key)) continue
    seen.add(key)
    selections.push({ instanceId, fingerprint })
  }
  return selections
}

function normalizeWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new DispatchError('请选择工作区')
  return value.trim()
}

interface GroupOutcome {
  instanceId: string
  instanceName: string
  instanceUrl: string
  ok: boolean
  alerts: Map<string, Alert>
  error?: string
}

/**
 * 执行一次派发。
 *
 * @param input - 请求体：`{ workspaceId, selections: [{ instanceId, fingerprint }] }`。
 * @param deps - 可注入依赖。
 * @returns 新会话的 id。
 * @throws {DispatchError} 校验失败、工作区不存在、缺少会话服务、告警不可用或 prompt 失败。
 */
export async function dispatchAlerts(input: unknown, deps: DispatchDeps): Promise<DispatchResult> {
  if (!isRecord(input)) throw new DispatchError('请求体必须是 JSON 对象')
  const selections = normalizeSelections(input.selections)
  const workspaceId = normalizeWorkspaceId(input.workspaceId)

  if (deps.settings === undefined || deps.settings.instances.length === 0) {
    throw new DispatchError('尚未配置 AlertManager 实例', 400, 'alerts.not-configured')
  }
  if (deps.sessionController === undefined) {
    throw new DispatchError('当前 profile 不支持创建会话', 503, 'session.unavailable')
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
    if (workspace === undefined) throw new DispatchError('工作区不存在', 404, 'dispatch.workspace-not-found')
    if (typeof workspace.path === 'string') workspacePath = workspace.path
  }

  const instancesById = new Map(deps.settings.instances.map((instance) => [instance.id, instance]))

  // 2. 按涉及的实例分组、并行 fresh 拉取；单实例失败不阻断其它实例。
  const involvedIds = [...new Set(selections.map((selection) => selection.instanceId))]
  const outcomes = new Map<string, GroupOutcome>()
  await Promise.all(
    involvedIds.map(async (instanceId) => {
      const instance = instancesById.get(instanceId)
      if (instance === undefined) {
        outcomes.set(instanceId, {
          instanceId,
          instanceName: instanceId,
          instanceUrl: '',
          ok: false,
          alerts: new Map(),
          error: '实例已不存在',
        })
        return
      }
      try {
        const data = await deps.fetchInstance(instance)
        const alerts = new Map<string, Alert>()
        for (const alert of data.alerts) {
          if (!alerts.has(alert.fingerprint)) alerts.set(alert.fingerprint, alert)
        }
        outcomes.set(instanceId, {
          instanceId,
          instanceName: instance.name,
          instanceUrl: instance.url,
          ok: true,
          alerts,
        })
      } catch (error) {
        outcomes.set(instanceId, {
          instanceId,
          instanceName: instance.name,
          instanceUrl: instance.url,
          ok: false,
          alerts: new Map(),
          error: errorMessage(error),
        })
      }
    }),
  )

  // 3. 匹配 fingerprint，并把取不到的选择分门别类写进 prompt。
  const matched: Array<Alert & { instanceId: string; instanceName: string; instanceUrl: string }> = []
  const missing: PromptMissingAlert[] = []
  const unavailable: PromptUnavailableInstance[] = []
  const unavailableByInstance = new Map<string, { instanceName: string; url: string; fingerprints: string[] }>()
  for (const selection of selections) {
    const outcome = outcomes.get(selection.instanceId)
    if (outcome === undefined) {
      const item = unavailableByInstance.get(selection.instanceId) ?? {
        instanceName: selection.instanceId,
        url: '',
        fingerprints: [],
      }
      item.fingerprints.push(selection.fingerprint)
      unavailableByInstance.set(selection.instanceId, item)
      continue
    }
    if (!outcome.ok) {
      const item = unavailableByInstance.get(selection.instanceId) ?? {
        instanceName: outcome.instanceName,
        url: outcome.instanceUrl,
        fingerprints: [],
      }
      item.fingerprints.push(selection.fingerprint)
      unavailableByInstance.set(selection.instanceId, item)
      continue
    }
    const alert = outcome.alerts.get(selection.fingerprint)
    if (alert === undefined) {
      missing.push({ instanceName: outcome.instanceName, fingerprint: selection.fingerprint })
      continue
    }
    matched.push({
      ...alert,
      instanceId: outcome.instanceId,
      instanceName: outcome.instanceName,
      instanceUrl: outcome.instanceUrl,
    })
  }
  unavailable.push(...unavailableByInstance.values())

  if (matched.length === 0) {
    throw new DispatchError('选中的告警都已不可用（已恢复或实例不可达）', 502, 'dispatch.alerts-unavailable')
  }

  // 4. 生成 prompt（按实例分组）。
  const prompt = buildPrompt(matched, {
    workspacePath,
    instances: deps.settings.instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      url: instance.url,
    })),
    missing,
    unavailable,
  })

  // 5. 新建会话。
  let sessionId: string
  try {
    const created = await deps.sessionController.create({ workspaceId })
    if (typeof created?.sessionId !== 'string' || created.sessionId === '') {
      throw new Error('宿主未返回会话 ID')
    }
    sessionId = created.sessionId
  } catch (error) {
    throw new DispatchError(`新建会话失败：${errorMessage(error)}`, 502, 'dispatch.create-failed')
  }

  // 6. 改标题：尽力而为，失败只记日志。
  const title = buildSessionTitle(matched[0]?.name ?? '', selections.length)
  try {
    await deps.sessionController.rename?.({ sessionId, title })
  } catch (error) {
    deps.logger?.warn?.('[dsh-alertmanager] 重命名会话失败', errorMessage(error))
  }

  // 7. 写入首条用户消息并立即开始运行；失败时把 sessionId 带回前端。
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
    throw new DispatchError(
      `会话已创建，但发送首条消息失败：${errorMessage(error)}`,
      502,
      'dispatch.prompt-failed',
      sessionId,
    )
  }

  return { sessionId }
}
