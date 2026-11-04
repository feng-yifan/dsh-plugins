import assert from 'node:assert/strict'
import test from 'node:test'
import { alertStateLabel, buildPrompt, isZeroTime, MAX_PROMPT_CHARS } from '../lib/prompt.js'

function alert(overrides = {}) {
  return {
    fingerprint: 'fp-1',
    name: 'HighCPU',
    severity: 'critical',
    state: 'active',
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '',
    updatedAt: '2026-01-01T00:10:00Z',
    generatorURL: 'https://am.example/graph',
    summary: 'CPU high',
    description: 'CPU above 90% for 5 minutes',
    labels: { severity: 'critical', alertname: 'HighCPU' },
    annotations: { summary: 'CPU high' },
    receivers: ['ops'],
    silencedBy: [],
    inhibitedBy: [],
    ...overrides,
  }
}

test('buildPrompt 包含工作区、告警字段、标签与指纹', () => {
  const prompt = buildPrompt([alert()], { workspacePath: '/srv/app' })
  assert.match(prompt, /我在 DSH 里从 AlertManager 选中了 1 条告警/)
  assert.match(prompt, /\/srv\/app/)
  assert.match(prompt, /## 告警 1\/1/)
  assert.match(prompt, /- 告警名：HighCPU/)
  assert.match(prompt, /- 严重度：critical/)
  assert.match(prompt, /- 状态：活跃/)
  assert.match(prompt, /- 开始：2026-01-01 00:00:00 UTC/)
  assert.match(prompt, /- 结束：未恢复/)
  assert.match(prompt, /- 来源：https:\/\/am\.example\/graph/)
  assert.match(prompt, /- 摘要：CPU high/)
  assert.match(prompt, /- 描述：CPU above 90% for 5 minutes/)
  assert.match(prompt, /- 标签：alertname=HighCPU, severity=critical/)
  assert.match(prompt, /- 指纹：fp-1/)
  assert.match(prompt, /## 处理要求/)
  assert.match(prompt, /先只读排查/)
  assert.ok(prompt.length <= MAX_PROMPT_CHARS)
})

test('endsAt 为 Go 零值时间时显示未恢复，而非 0001 年', () => {
  const zero = buildPrompt([alert({ endsAt: '0001-01-01T00:00:00Z' })], { workspacePath: '/srv/app' })
  assert.match(zero, /- 结束：未恢复/)
  assert.equal(zero.includes('0001-01-01'), false)

  const empty = buildPrompt([alert({ endsAt: '' })], { workspacePath: '/srv/app' })
  assert.match(empty, /- 结束：未恢复/)

  const resolved = buildPrompt([alert({ endsAt: '2026-01-01T01:00:00Z' })], { workspacePath: '/srv/app' })
  assert.match(resolved, /- 结束：2026-01-01 01:00:00 UTC/)

  assert.equal(isZeroTime('0001-01-01T00:00:00Z'), true)
  assert.equal(isZeroTime(''), true)
  assert.equal(isZeroTime('2026-01-01T01:00:00Z'), false)
})

test('状态文案区分活跃 / 静默 / 抑制 / 未处理', () => {
  assert.equal(alertStateLabel(alert()), '活跃')
  assert.equal(alertStateLabel(alert({ state: 'suppressed', silencedBy: ['s'] })), '已静默')
  assert.equal(alertStateLabel(alert({ state: 'suppressed', inhibitedBy: ['i'] })), '被抑制')
  assert.equal(alertStateLabel(alert({ state: 'unprocessed' })), '未处理')
})

test('工作区路径未知与已恢复告警都会写进 prompt', () => {
  const prompt = buildPrompt([alert()], { missingFingerprints: ['gone-1'] })
  assert.match(prompt, /路径未知/)
  assert.match(prompt, /选中了 2 条告警/)
  assert.match(prompt, /派发时已不在告警列表的告警/)
  assert.match(prompt, /可能已恢复/)
  assert.match(prompt, /gone-1/)
})

test('超长时先丢描述再截断，且总长不超过 20000', () => {
  const longDescription = buildPrompt([alert({ description: 'x'.repeat(30_000) })], {
    workspacePath: '/srv/app',
  })
  assert.ok(longDescription.length <= MAX_PROMPT_CHARS)
  assert.equal(longDescription.includes('描述：'), false)
  assert.match(longDescription, /- 指纹：fp-1/)

  const many = Array.from({ length: 20 }, (_, index) =>
    alert({
      fingerprint: `fp-${index}`,
      name: `Alert-${index}`,
      summary: 's'.repeat(1_500),
      description: 'd'.repeat(5_000),
    }),
  )
  const truncated = buildPrompt(many, { workspacePath: '/srv/app' })
  assert.ok(truncated.length <= MAX_PROMPT_CHARS)
  assert.match(truncated, /已截断 \d+ 条告警的详情/)
  assert.match(truncated, /受 20000 字符上限限制/)
  assert.equal(truncated.includes('描述：'), false)
})
