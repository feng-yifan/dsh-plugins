/**
 * dsh-alertmanager · 派发 prompt 模板（按实例分组）
 *
 * prompt 直接作为新会话的首条用户消息。总长上限 20000 字符：先逐条丢掉
 * 「描述」，仍然超长时按实例/条从尾部省略，并在末尾注明省略了多少条。
 */
import type { Alert } from './alertmanager.js'

/** prompt 总长上限（字符）。 */
export const MAX_PROMPT_CHARS = 20_000

/** 工作区路径、实例名、实例 URL 在 prompt 里的长度上限。 */
export const MAX_WORKSPACE_PATH_CHARS = 500
export const MAX_INSTANCE_NAME_CHARS = 120
export const MAX_INSTANCE_URL_CHARS = 300
export const MAX_FINGERPRINT_CHARS = 200

/** 带实例信息的告警（合并列表天然满足）。 */
export interface PromptAlert extends Alert {
  instanceId?: string
  instanceName?: string
  instanceUrl?: string
}

/** prompt 里用于补全实例名与 URL 的实例表。 */
export interface PromptInstance {
  id: string
  name: string
  url: string
}

/** 派发时已恢复（不在最新列表）的选中告警。 */
export interface PromptMissingAlert {
  instanceName: string
  fingerprint: string
}

/** 派发时不可达的实例及其未包含的选中告警。 */
export interface PromptUnavailableInstance {
  instanceName: string
  url?: string
  fingerprints: readonly string[]
}

/** 生成 prompt 的选项。 */
export interface PromptOptions {
  /** 目标工作区路径；缺省写「路径未知」。 */
  workspacePath?: string
  /** 涉及的实例；用于按 instanceId 补全名称与 URL。 */
  instances?: readonly PromptInstance[]
  /** 已恢复告警（结构化，带实例名）。 */
  missing?: readonly PromptMissingAlert[]
  /** 不可达实例（结构化）。 */
  unavailable?: readonly PromptUnavailableInstance[]
  /** v1 兼容：只有指纹、没有实例名。 */
  missingFingerprints?: readonly string[]
}

const PROCESSING_REQUIREMENTS = `## 处理要求
1. 先只读排查：定位告警对应的服务/资源与最近变化，给出证据。
2. 需要改动时先说明方案与影响面；高风险操作先确认。
3. 处理完给出：根因、已做操作、验证结果、后续建议。`

/**
 * 判断 AlertManager v2 的 `endsAt` 是否表示「未恢复」。
 *
 * 未恢复告警的 `endsAt` 可能是空串，也可能是 Go 的零值时间
 * `0001-01-01T00:00:00Z`；两者都不应渲染成 0001 年。
 */
export function isZeroTime(value: string): boolean {
  if (value === '') return true
  if (value.startsWith('0001-01-01')) return true
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() <= 1
}

/** 把 ISO 时间写成绝对时间（UTC），无法解析时原样返回。 */
export function formatAbsoluteTime(value: string): string {
  if (value === '') return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

/** 状态的中文文案：静默与抑制都映射到 suppressed，靠 silencedBy/inhibitedBy 区分。 */
export function alertStateLabel(alert: Alert): string {
  if (alert.state === 'active') return '活跃'
  if (alert.state === 'unprocessed') return '未处理'
  if (alert.inhibitedBy.length > 0 && alert.silencedBy.length === 0) return '被抑制'
  return '已静默'
}

function truncate(value: string, limit: number): string {
  const characters = Array.from(value)
  if (characters.length <= limit) return value
  return `${characters.slice(0, Math.max(0, limit - 1)).join('')}…`
}

function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return '（无）'
  return keys.map((key) => `${key}=${labels[key]}`).join(', ')
}

function renderAlert(
  alert: PromptAlert,
  index: number,
  total: number,
  includeDescription: boolean,
  grouped: boolean,
): string {
  const lines = [
    `${grouped ? '###' : '##'} 告警 ${index + 1}/${total}`,
    `- 告警名：${alert.name || '未命名告警'}`,
    `- 严重度：${alert.severity || '未知'}`,
    `- 状态：${alertStateLabel(alert)}`,
    `- 开始：${formatAbsoluteTime(alert.startsAt)}`,
    `- 结束：${isZeroTime(alert.endsAt) ? '未恢复' : formatAbsoluteTime(alert.endsAt)}`,
    `- 来源：${alert.generatorURL || '（无）'}`,
    `- 摘要：${alert.summary || '（无）'}`,
  ]
  if (includeDescription) lines.push(`- 描述：${alert.description || '（无）'}`)
  lines.push(`- 标签：${renderLabels(alert.labels)}`)
  lines.push(`- 指纹：${alert.fingerprint || '（无）'}`)
  return lines.join('\n')
}

interface ResolvedGroup {
  key: string
  name: string
  url: string
  alerts: PromptAlert[]
}

function resolveInstance(
  alert: PromptAlert,
  instancesById: ReadonlyMap<string, PromptInstance>,
): { name: string; url: string; key: string } {
  const known = alert.instanceId === undefined ? undefined : instancesById.get(alert.instanceId)
  const name = truncate(alert.instanceName ?? known?.name ?? '', MAX_INSTANCE_NAME_CHARS)
  const url = truncate(alert.instanceUrl ?? known?.url ?? '', MAX_INSTANCE_URL_CHARS)
  const key = alert.instanceId ?? name
  return { name, url, key }
}

function groupAlerts(
  alerts: readonly PromptAlert[],
  instances: readonly PromptInstance[] | undefined,
): ResolvedGroup[] {
  const instancesById = new Map((instances ?? []).map((instance) => [instance.id, instance]))
  const groups: ResolvedGroup[] = []
  const byKey = new Map<string, ResolvedGroup>()
  for (const alert of alerts) {
    const resolved = resolveInstance(alert, instancesById)
    let group = byKey.get(resolved.key)
    if (group === undefined) {
      group = { key: resolved.key, name: resolved.name, url: resolved.url, alerts: [] }
      byKey.set(resolved.key, group)
      groups.push(group)
    }
    group.alerts.push(alert)
  }
  return groups
}

function renderMissing(options: PromptOptions): string {
  const missing: PromptMissingAlert[] = [
    ...(options.missing ?? []),
    ...(options.missingFingerprints ?? []).map((fingerprint) => ({ instanceName: '', fingerprint })),
  ]
  if (missing.length === 0) return ''
  const lines = ['## 派发时已不在告警列表的告警', '以下告警派发时已不在告警列表，可能已恢复：']
  for (const item of missing) {
    const fingerprint = truncate(item.fingerprint, MAX_FINGERPRINT_CHARS)
    const instanceName = truncate(item.instanceName ?? '', MAX_INSTANCE_NAME_CHARS)
    lines.push(instanceName === '' ? `- 指纹：${fingerprint}` : `- ${instanceName} / 指纹：${fingerprint}`)
  }
  return lines.join('\n')
}

function renderUnavailable(options: PromptOptions): string {
  if (options.unavailable === undefined || options.unavailable.length === 0) return ''
  const lines = ['## 派发时不可达的实例']
  for (const item of options.unavailable) {
    const name = truncate(item.instanceName || '未知实例', MAX_INSTANCE_NAME_CHARS)
    const url = truncate(item.url ?? '', MAX_INSTANCE_URL_CHARS)
    const fingerprints = item.fingerprints
      .map((fingerprint) => truncate(fingerprint, MAX_FINGERPRINT_CHARS))
      .join('、')
    lines.push(
      `- 实例 ${name}${url === '' ? '' : `（${url}）`} 当时不可达，其选中告警未包含：${fingerprints || '（无）'}`,
    )
  }
  return lines.join('\n')
}

function countMissing(options: PromptOptions): number {
  return (
    (options.missing?.length ?? 0) +
    (options.missingFingerprints?.length ?? 0) +
    (options.unavailable ?? []).reduce((total, item) => total + item.fingerprints.length, 0)
  )
}

function renderPrompt(
  alerts: readonly PromptAlert[],
  options: PromptOptions,
  allAlerts: readonly PromptAlert[],
  includeDescription: boolean,
  omitted: number,
): string {
  const workspacePath = truncate((options.workspacePath ?? '').trim(), MAX_WORKSPACE_PATH_CHARS) || '路径未知'
  const total = allAlerts.length + countMissing(options)
  const parts = [
    `我在 DSH 里从 AlertManager 选中了 ${total} 条告警，请在这个工作区（${workspacePath}）处理它们。`,
  ]

  const unavailable = renderUnavailable(options)
  if (unavailable !== '') parts.push(unavailable)

  const groups = groupAlerts(alerts, options.instances)
  const grouped = groups.some((group) => group.name !== '' || group.url !== '')
  let number = 0
  for (const group of groups) {
    if (group.name !== '' || group.url !== '') {
      const name = group.name || '未命名实例'
      const url = group.url || '地址未知'
      parts.push(`## 实例：${name}（${url}）`)
    }
    for (const alert of group.alerts) {
      number += 1
      parts.push(renderAlert(alert, number - 1, allAlerts.length, includeDescription, grouped))
    }
  }

  const missing = renderMissing(options)
  if (missing !== '') parts.push(missing)
  parts.push(PROCESSING_REQUIREMENTS)
  if (omitted > 0) parts.push(`> 受 ${MAX_PROMPT_CHARS} 字符上限限制，已截断 ${omitted} 条告警的详情。`)
  return parts.join('\n\n')
}

/**
 * 生成派发 prompt。
 *
 * @param alerts - 派发时仍在列表里的选中告警（已按面板顺序排列）。
 * @param options - 工作区路径、实例表、已恢复/不可达告警。
 * @returns 总长不超过 {@link MAX_PROMPT_CHARS} 的纯文本 prompt。
 */
export function buildPrompt(alerts: readonly PromptAlert[], options: PromptOptions = {}): string {
  const withDescriptions = renderPrompt(alerts, options, alerts, true, 0)
  if (withDescriptions.length <= MAX_PROMPT_CHARS) return withDescriptions

  const withoutDescriptions = renderPrompt(alerts, options, alerts, false, 0)
  if (withoutDescriptions.length <= MAX_PROMPT_CHARS) return withoutDescriptions

  // 仍然超长：保留前面的告警，从尾部按条省略，并在末尾注明省略条数。
  for (let kept = alerts.length - 1; kept >= 0; kept -= 1) {
    const text = renderPrompt(alerts.slice(0, kept), options, alerts, false, alerts.length - kept)
    if (text.length <= MAX_PROMPT_CHARS) return text
  }
  return renderPrompt([], options, alerts, false, alerts.length).slice(0, MAX_PROMPT_CHARS)
}
