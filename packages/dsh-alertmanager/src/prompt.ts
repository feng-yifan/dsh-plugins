/**
 * dsh-alertmanager · 派发 prompt 模板
 *
 * prompt 直接作为新会话的首条用户消息。总长上限 20000 字符：先逐条丢掉
 * 「描述」，仍然超长时从尾部省略告警块，并在末尾注明省略了多少条。
 */
import type { Alert } from './alertmanager.js'

/** prompt 总长上限（字符）。 */
export const MAX_PROMPT_CHARS = 20_000

/** 生成 prompt 的选项。 */
export interface PromptOptions {
  /** 目标工作区路径；缺省写「路径未知」。 */
  workspacePath?: string
  /** 派发时已不在最新告警列表里的指纹。 */
  missingFingerprints?: readonly string[]
}

const PROCESSING_REQUIREMENTS = `## 处理要求
1. 先只读排查：定位告警对应的服务/资源与最近变化，给出证据。
2. 需要改动时先说明方案与影响面；高风险操作先确认。
3. 处理完给出：根因、已做操作、验证结果、后续建议。`

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

function renderLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return '（无）'
  return keys.map((key) => `${key}=${labels[key]}`).join(', ')
}

function renderAlert(alert: Alert, index: number, total: number, includeDescription: boolean): string {
  const lines = [
    `## 告警 ${index + 1}/${total}`,
    `- 告警名：${alert.name || '未命名告警'}`,
    `- 严重度：${alert.severity || '未知'}`,
    `- 状态：${alertStateLabel(alert)}`,
    `- 开始：${formatAbsoluteTime(alert.startsAt)}`,
    `- 结束：${alert.endsAt === '' ? '未恢复' : formatAbsoluteTime(alert.endsAt)}`,
    `- 来源：${alert.generatorURL || '（无）'}`,
    `- 摘要：${alert.summary || '（无）'}`,
  ]
  if (includeDescription) lines.push(`- 描述：${alert.description || '（无）'}`)
  lines.push(`- 标签：${renderLabels(alert.labels)}`)
  lines.push(`- 指纹：${alert.fingerprint || '（无）'}`)
  return lines.join('\n')
}

function renderMissing(fingerprints: readonly string[]): string {
  const lines = [
    '## 派发时已不在告警列表的告警',
    '以下告警派发时已不在告警列表，可能已恢复：',
    ...fingerprints.map((fingerprint) => `- 指纹：${fingerprint.slice(0, 200)}`),
  ]
  return lines.join('\n')
}

function renderPrompt(
  alerts: readonly Alert[],
  options: PromptOptions,
  blocks: readonly string[],
  omitted: number,
): string {
  const missing = options.missingFingerprints ?? []
  const total = alerts.length + missing.length
  const workspacePath = (options.workspacePath ?? '').slice(0, 500) || '路径未知'
  const parts = [`我在 DSH 里从 AlertManager 选中了 ${total} 条告警，请在这个工作区（${workspacePath}）处理它们。`]
  if (missing.length > 0) parts.push(renderMissing(missing))
  parts.push(...blocks)
  parts.push(PROCESSING_REQUIREMENTS)
  if (omitted > 0) parts.push(`> 受 ${MAX_PROMPT_CHARS} 字符上限限制，已截断 ${omitted} 条告警的详情。`)
  return parts.join('\n\n')
}

/**
 * 生成派发 prompt。
 *
 * @param alerts - 派发时仍在列表里的选中告警（已按面板顺序排列）。
 * @param options - 工作区路径与已恢复告警的指纹。
 * @returns 总长不超过 {@link MAX_PROMPT_CHARS} 的纯文本 prompt。
 */
export function buildPrompt(alerts: readonly Alert[], options: PromptOptions = {}): string {
  const withDescriptions = alerts.map((alert, index) => renderAlert(alert, index, alerts.length, true))
  const first = renderPrompt(alerts, options, withDescriptions, 0)
  if (first.length <= MAX_PROMPT_CHARS) return first

  const withoutDescriptions = alerts.map((alert, index) => renderAlert(alert, index, alerts.length, false))
  const second = renderPrompt(alerts, options, withoutDescriptions, 0)
  if (second.length <= MAX_PROMPT_CHARS) return second

  // 仍然超长：从尾部整块省略，末尾注明省略条数。k=0 时只剩固定框架与省略说明，
  // 框架本身的路径与指纹都做过长度上限处理，因此一定能落在上限内。
  for (let kept = alerts.length - 1; kept >= 0; kept -= 1) {
    const blocks = withoutDescriptions.slice(0, kept)
    const text = renderPrompt(alerts, options, blocks, alerts.length - kept)
    if (text.length <= MAX_PROMPT_CHARS) return text
  }
  return renderPrompt(alerts, options, [], alerts.length).slice(0, MAX_PROMPT_CHARS)
}
