import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AlertmanagerAggregateError,
  AlertmanagerError,
  AlertmanagerSource,
  buildAlertsUrl,
  buildAuthHeaders,
  compareMergedAlerts,
  normalizeAlerts,
  summarizeResponse,
} from '../lib/alertmanager.js'

const INSTANCE_A = {
  id: 'a',
  name: '生产',
  url: 'https://am-a.example/',
  authMode: 'none',
}

const INSTANCE_B = {
  id: 'b',
  name: '测试',
  url: 'https://am-b.example',
  authMode: 'bearer',
  secret: 'token-b',
}

function rawAlert(overrides = {}) {
  return {
    fingerprint: 'fp-1',
    labels: { alertname: 'HighCPU', severity: 'critical' },
    annotations: { summary: 'CPU high', description: 'CPU above 90%' },
    status: { state: 'active' },
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '0001-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:10:00Z',
    generatorURL: 'https://am-a.example/graph',
    receivers: ['ops'],
    ...overrides,
  }
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

test('buildAlertsUrl 去掉尾部斜杠并带上四个查询参数', () => {
  assert.equal(
    buildAlertsUrl('https://am.example///'),
    'https://am.example/api/v2/alerts?active=true&silenced=true&inhibited=true&unprocessed=true',
  )
  assert.equal(
    buildAlertsUrl('http://am.example/base/'),
    'http://am.example/base/api/v2/alerts?active=true&silenced=true&inhibited=true&unprocessed=true',
  )
})

test('buildAuthHeaders 覆盖 none / basic / bearer', () => {
  assert.deepEqual(buildAuthHeaders(INSTANCE_A), {})
  assert.deepEqual(buildAuthHeaders({ ...INSTANCE_A, authMode: 'basic', username: 'alice', secret: 'p@ss' }), {
    Authorization: `Basic ${Buffer.from('alice:p@ss', 'utf8').toString('base64')}`,
  })
  assert.deepEqual(buildAuthHeaders(INSTANCE_B), {
    Authorization: 'Bearer token-b',
  })
})

test('normalizeAlerts 逐项容错、映射状态并按规则排序', () => {
  const alerts = normalizeAlerts([
    rawAlert({ fingerprint: 'b', labels: { alertname: 'Zed', severity: 'warning' }, startsAt: '2026-01-02T00:00:00Z' }),
    rawAlert({
      fingerprint: 'a',
      labels: { alertname: 'Alpha', severity: 'critical' },
      status: { state: 'suppressed', silencedBy: ['silence-1'] },
      startsAt: '2026-01-01T00:00:00Z',
    }),
    rawAlert({
      fingerprint: 'c',
      labels: { alertname: 'Beta', severity: 'info' },
      status: { state: 'unprocessed' },
    }),
    rawAlert({ fingerprint: 'd', labels: { alertname: 'Zed' }, status: {} }),
  ])
  assert.deepEqual(
    alerts.map((alert) => alert.fingerprint),
    ['b', 'd', 'a', 'c'],
  )
  const alpha = alerts.find((alert) => alert.fingerprint === 'a')
  assert.equal(alpha.name, 'Alpha')
  assert.equal(alpha.severity, 'critical')
  assert.equal(alpha.state, 'suppressed')
  assert.equal(alpha.summary, 'CPU high')
  assert.equal(alpha.description, 'CPU above 90%')
  assert.deepEqual(alpha.silencedBy, ['silence-1'])
  assert.equal(alpha.generatorURL, 'https://am-a.example/graph')

  const missing = normalizeAlerts([{}])[0]
  assert.equal(missing.name, '')
  assert.equal(missing.state, 'active')
  assert.deepEqual(missing.labels, {})
  assert.throws(() => normalizeAlerts({}), /不是告警数组/)
})

test('fetchAll 聚合多实例，合并列表带 instanceId/instanceName 且按规则排序', async () => {
  const calls = []
  const source = new AlertmanagerSource({
    now: () => 1_000_000,
    fetch: async (url) => {
      calls.push(url)
      if (url.startsWith('https://am-a')) {
        return response(
          JSON.stringify([
            rawAlert({ fingerprint: 'a-1', labels: { alertname: 'Alpha', severity: 'critical' }, status: {} }),
            rawAlert({
              fingerprint: 'a-2',
              labels: { alertname: 'Beta', severity: 'warning' },
              status: { state: 'suppressed' },
            }),
          ]),
        )
      }
      return response(
        JSON.stringify([
          rawAlert({ fingerprint: 'b-1', labels: { alertname: 'Alpha', severity: 'critical' }, status: {} }),
        ]),
      )
    },
  })

  const payload = await source.fetchAll([INSTANCE_A, INSTANCE_B])
  assert.equal(payload.fetchedAt, new Date(1_000_000).toISOString())
  assert.equal(payload.instances.length, 2)
  assert.deepEqual(
    payload.instances.map((instance) => ({ id: instance.id, name: instance.name, ok: instance.ok })),
    [
      { id: 'a', name: '生产', ok: true },
      { id: 'b', name: '测试', ok: true },
    ],
  )
  assert.deepEqual(payload.instances[0].stats, { total: 2, active: 1, suppressed: 1 })
  assert.deepEqual(payload.instances[1].stats, { total: 1, active: 1, suppressed: 0 })
  // 同状态/严重度/名称/开始时间时，先按 instanceId 再按 fingerprint 稳定断尾。
  assert.deepEqual(
    payload.alerts.map((alert) => `${alert.instanceId}/${alert.fingerprint}`),
    ['a/a-1', 'b/b-1', 'a/a-2'],
  )
  assert.equal(payload.alerts[0].instanceName, '生产')
  assert.equal(payload.alerts[0].instanceUrl, 'https://am-a.example/')
  assert.equal(calls.length, 2)
  assert.ok(calls.some((url) => url.startsWith('https://am-b.example/api/v2/alerts')))
})

test('compareMergedAlerts 完整排序：状态 → 严重度 → 名称 → 开始时间倒序 → 实例/指纹', () => {
  const base = {
    fingerprint: 'f',
    name: 'A',
    severity: 'critical',
    state: 'active',
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '',
    updatedAt: '',
    generatorURL: '',
    summary: '',
    description: '',
    labels: {},
    annotations: {},
    receivers: [],
    silencedBy: [],
    inhibitedBy: [],
    instanceId: 'a',
    instanceName: 'A',
    instanceUrl: '',
  }
  const sorted = [
    { ...base },
    { ...base, fingerprint: 'b', instanceId: 'b' },
    { ...base, fingerprint: 'a', instanceId: 'a', startsAt: '2026-01-02T00:00:00Z' },
    { ...base, fingerprint: 'c', instanceId: 'a', severity: 'warning' },
    { ...base, fingerprint: 'd', instanceId: 'a', state: 'suppressed' },
    { ...base, fingerprint: 'e', instanceId: 'a', name: 'B' },
  ].sort(compareMergedAlerts)
  assert.deepEqual(
    sorted.map((alert) => `${alert.state}/${alert.severity}/${alert.name}/${alert.startsAt}/${alert.instanceId}`),
    [
      'active/critical/A/2026-01-02T00:00:00Z/a',
      'active/critical/A/2026-01-01T00:00:00Z/a',
      'active/critical/A/2026-01-01T00:00:00Z/b',
      'active/critical/B/2026-01-01T00:00:00Z/a',
      'active/warning/A/2026-01-01T00:00:00Z/a',
      'suppressed/critical/A/2026-01-01T00:00:00Z/a',
    ],
  )
})

test('单实例失败不影响其它实例，失败项带 ok:false/error/code', async () => {
  const source = new AlertmanagerSource({
    fetch: async (url) => {
      if (url.startsWith('https://am-a')) throw new Error('network down')
      return response(JSON.stringify([rawAlert({ fingerprint: 'b-1' })]))
    },
  })
  const payload = await source.fetchAll([INSTANCE_A, INSTANCE_B])
  assert.equal(payload.instances[0].ok, false)
  assert.match(payload.instances[0].error, /network down/)
  assert.equal(payload.instances[0].code, 'alerts.network')
  assert.deepEqual(payload.instances[0].alerts, [])
  assert.deepEqual(payload.instances[0].stats, { total: 0, active: 0, suppressed: 0 })
  assert.equal(payload.instances[1].ok, true)
  assert.deepEqual(
    payload.alerts.map((alert) => `${alert.instanceId}/${alert.fingerprint}`),
    ['b/b-1'],
  )
})

test('全部实例失败 / 未配置实例分别抛出稳定 code', async () => {
  const failing = new AlertmanagerSource({
    fetch: async () => {
      throw new Error('down')
    },
  })
  await assert.rejects(
    () => failing.fetchAll([INSTANCE_A, INSTANCE_B]),
    (error) => {
      assert.ok(error instanceof AlertmanagerAggregateError)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'alerts.fetch-failed')
      assert.match(error.message, /所有 AlertManager 实例都不可达/)
      return true
    },
  )

  const noInstances = new AlertmanagerSource()
  await assert.rejects(
    () => noInstances.fetchAll([]),
    (error) => {
      assert.ok(error instanceof AlertmanagerAggregateError)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'alerts.not-configured')
      return true
    },
  )
})

test('每实例 5 秒缓存：命中、fresh 绕过、签名变化失效', async () => {
  const calls = []
  let now = 1_000_000
  const source = new AlertmanagerSource({
    now: () => now,
    fetch: async (url) => {
      calls.push(url)
      return response(JSON.stringify([rawAlert()]))
    },
  })
  const first = { ...INSTANCE_A, authMode: 'bearer', secret: 'token' }

  await source.fetchInstance(first)
  assert.equal(calls.length, 1)
  await source.fetchInstance(first)
  assert.equal(calls.length, 1, '5 秒内命中缓存')

  now += 6_000
  await source.fetchInstance(first)
  assert.equal(calls.length, 2, '超过 5 秒后重新拉取')

  await source.fetchInstance(first, { fresh: true })
  assert.equal(calls.length, 3, 'fresh 绕过缓存')

  await source.fetchInstance({ ...first, url: 'https://other.example' })
  assert.equal(calls.length, 4, '同一实例 id 的设置签名变化后缓存失效')

  // 缓存按实例 id 分槽，另一个实例独立请求。
  await source.fetchInstance({ ...INSTANCE_B, secret: 'x' })
  assert.equal(calls.length, 5)
  await source.fetchAll([first, { ...INSTANCE_B, secret: 'x' }], { fresh: true })
  assert.equal(calls.length, 7)
})

test('单实例请求把非 2xx、超时、非 JSON 转成可读 AlertmanagerError', async () => {
  const unauthorized = new AlertmanagerSource({
    fetch: async () => response('bad credentials', 401),
  })
  await assert.rejects(
    () => unauthorized.fetchInstance(INSTANCE_A),
    (error) => {
      assert.ok(error instanceof AlertmanagerError)
      assert.equal(error.status, 502)
      assert.match(error.message, /HTTP 401/)
      assert.match(error.message, /bad credentials/)
      return true
    },
  )

  const timeout = new AlertmanagerSource({
    fetch: async () => {
      const error = new Error('The operation was aborted.')
      error.name = 'TimeoutError'
      throw error
    },
  })
  await assert.rejects(() => timeout.fetchInstance(INSTANCE_A), /请求超时/)

  const notJson = new AlertmanagerSource({
    fetch: async () => response('<html>oops</html>'),
  })
  await assert.rejects(() => notJson.fetchInstance(INSTANCE_A), /不是 JSON/)

  const notArray = new AlertmanagerSource({
    fetch: async () => response('{"status":"success"}'),
  })
  await assert.rejects(() => notArray.fetchInstance(INSTANCE_A), /不是告警数组/)
})

test('summarizeResponse 压成单行且不超过 300 字符', () => {
  const summary = summarizeResponse(`line one\n\nline two ${'x'.repeat(1000)}`)
  assert.equal(summary.includes('\n'), false)
  assert.equal(summary.length, 300)
  assert.ok(summary.endsWith('…'))
})
