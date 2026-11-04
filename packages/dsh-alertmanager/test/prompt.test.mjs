import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alertStateLabel,
  buildBriefPrompt,
  buildPrompt,
  buildPromptForStyle,
  isZeroTime,
  MAX_PROMPT_CHARS,
} from '../lib/prompt.js'

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

test('按实例分组：标题含实例名与 URL，告警块用三级标题', () => {
  const prompt = buildPrompt(
    [
      alert({ instanceId: 'a', instanceName: '生产', instanceUrl: 'https://am-a.example' }),
      alert({
        fingerprint: 'fp-b',
        name: 'DiskFull',
        instanceId: 'b',
        instanceName: '测试',
        instanceUrl: 'https://am-b.example',
      }),
    ],
    { workspacePath: '/srv/app' },
  )
  assert.match(prompt, /## 实例：生产（https:\/\/am-a\.example）/)
  assert.match(prompt, /## 实例：测试（https:\/\/am-b\.example）/)
  assert.match(prompt, /### 告警 1\/2/)
  assert.match(prompt, /### 告警 2\/2/)
  assert.match(prompt, /HighCPU/)
  assert.match(prompt, /DiskFull/)
})

test('实例名/URL 可从 options.instances 按 instanceId 补全', () => {
  const prompt = buildPrompt([alert({ instanceId: 'a' })], {
    workspacePath: '/srv/app',
    instances: [{ id: 'a', name: '生产', url: 'https://am-a.example' }],
  })
  assert.match(prompt, /## 实例：生产（https:\/\/am-a\.example）/)
})

test('不可达实例与已恢复告警分别单列', () => {
  const prompt = buildPrompt([alert({ instanceId: 'a', instanceName: '生产', instanceUrl: 'https://am-a.example' })], {
    workspacePath: '/srv/app',
    missing: [{ instanceName: '生产', fingerprint: 'gone-1' }],
    unavailable: [
      { instanceName: '测试', url: 'https://am-b.example', fingerprints: ['fp-b', 'fp-b2'] },
    ],
  })
  assert.match(prompt, /选中了 4 条告警/)
  assert.match(prompt, /## 派发时不可达的实例/)
  assert.match(prompt, /实例 测试（https:\/\/am-b\.example） 当时不可达，其选中告警未包含：fp-b、fp-b2/)
  assert.match(prompt, /## 派发时已不在告警列表的告警/)
  assert.match(prompt, /生产 \/ 指纹：gone-1/)
})

test('v1 兼容：只有 missingFingerprints 时仍能写已恢复说明', () => {
  const prompt = buildPrompt([alert()], { missingFingerprints: ['gone-1'] })
  assert.match(prompt, /选中了 2 条告警/)
  assert.match(prompt, /- 指纹：gone-1/)
})

test('超长时先丢描述再裁剪，且总长不超过 20000', () => {
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
      instanceId: `i-${index % 3}`,
      instanceName: `实例-${index % 3}`,
      instanceUrl: `https://am-${index % 3}.example`,
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

test('工作区路径与实例信息有长度上限，但总长仍守 20000', () => {
  const prompt = buildPrompt(
    [
      alert({
        instanceName: 'n'.repeat(1000),
        instanceUrl: `https://am.example/${'u'.repeat(1000)}`,
      }),
    ],
    { workspacePath: '/'.repeat(5000) },
  )
  assert.ok(prompt.length <= MAX_PROMPT_CHARS)
  assert.match(prompt, /## 实例：/)
})

test('buildBriefPrompt：引导语 + 去重名称，可附已恢复/不可达提示', () => {
  const alerts = [
    { fingerprint: 'f1', name: 'HighCPU', severity: 'critical', state: 'active', startsAt: '', endsAt: '', labels: {}, annotations: {} },
    { fingerprint: 'f2', name: 'HighCPU', severity: 'warning', state: 'active', startsAt: '', endsAt: '', labels: {}, annotations: {} },
    { fingerprint: 'f3', name: 'DiskFull', severity: 'warning', state: 'active', startsAt: '', endsAt: '', labels: {}, annotations: {} },
  ]
  const text = buildBriefPrompt(alerts, {
    intro: '解决以下 AlertManager 告警：',
    missing: [{ instanceName: 'A', fingerprint: 'gone' }],
    unavailable: [{ instanceName: 'B', fingerprints: ['x'] }],
  })
  assert.equal(
    text,
    [
      '解决以下 AlertManager 告警：',
      '- HighCPU',
      '- DiskFull',
      '（另有 1 条派发时已不在告警列表，可能已恢复）',
      '（实例 B 当时不可达，其选中告警未包含）',
    ].join('\n'),
  )
})

test('buildBriefPrompt：无名称时回落指纹；引导语为空回落默认', () => {
  const text = buildBriefPrompt(
    [{ fingerprint: 'abc', name: '', severity: 'info', state: 'active', startsAt: '', endsAt: '', labels: {}, annotations: {} }],
    { intro: '   ' },
  )
  assert.equal(text, '解决以下 AlertManager 告警：\n- abc')
})

test('buildPromptForStyle 按风格分派', () => {
  const alerts = [
    { fingerprint: 'f1', name: 'HighCPU', severity: 'critical', state: 'active', startsAt: '', endsAt: '', labels: {}, annotations: {} },
  ]
  assert.match(buildPromptForStyle('brief', alerts, { intro: 'X：' }), /^X：\n- HighCPU$/)
  assert.match(buildPromptForStyle('detailed', alerts, {}), /## 告警 1\/1/)
  assert.match(buildPromptForStyle(undefined, alerts, { intro: 'Y：' }), /## 告警 1\/1/)
})
