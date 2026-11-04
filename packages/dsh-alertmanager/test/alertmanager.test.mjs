import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AlertmanagerSource,
  buildAlertsUrl,
  buildAuthHeaders,
  normalizeAlerts,
  summarizeResponse,
} from '../lib/alertmanager.js'
import { DEFAULT_SETTINGS } from '../lib/settings.js'

const settings = {
  ...DEFAULT_SETTINGS,
  url: 'https://am.example/',
  authMode: 'none',
}

const RAW_ALERTS = [
  {
    fingerprint: 'b',
    labels: { alertname: 'Zed', severity: 'warning' },
    status: { state: 'active' },
    startsAt: '2026-01-02T00:00:00Z',
  },
  {
    fingerprint: 'a',
    labels: { alertname: 'Alpha', severity: 'critical' },
    annotations: { summary: 'CPU high', description: 'CPU above 90%' },
    status: { state: 'suppressed', silencedBy: ['silence-1'] },
    receivers: ['ops'],
    generatorURL: 'https://am.example/graph',
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-01-01T01:00:00Z',
    updatedAt: '2026-01-01T00:10:00Z',
  },
  {
    fingerprint: 'c',
    labels: { alertname: 'Beta', severity: 'info' },
    status: { state: 'unprocessed' },
  },
  {
    fingerprint: 'd',
    labels: { alertname: 'Zed' },
    status: {},
  },
]

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
  assert.deepEqual(buildAuthHeaders(settings), {})
  assert.deepEqual(buildAuthHeaders({ ...settings, authMode: 'basic', username: 'alice', secret: 'p@ss' }), {
    Authorization: `Basic ${Buffer.from('alice:p@ss', 'utf8').toString('base64')}`,
  })
  assert.deepEqual(buildAuthHeaders({ ...settings, authMode: 'bearer', secret: 'token' }), {
    Authorization: 'Bearer token',
  })
})

test('normalizeAlerts 逐项容错、映射状态并按规则排序', () => {
  const alerts = normalizeAlerts(RAW_ALERTS)
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
  assert.deepEqual(alpha.receivers, ['ops'])
  assert.deepEqual(alpha.silencedBy, ['silence-1'])
  assert.deepEqual(alpha.inhibitedBy, [])
  assert.deepEqual(alpha.labels, { alertname: 'Alpha', severity: 'critical' })
  assert.equal(alpha.startsAt, '2026-01-01T00:00:00Z')
  assert.equal(alpha.endsAt, '2026-01-01T01:00:00Z')
  assert.equal(alpha.generatorURL, 'https://am.example/graph')

  const missing = normalizeAlerts([{}])[0]
  assert.equal(missing.name, '')
  assert.equal(missing.severity, '')
  assert.equal(missing.state, 'active')
  assert.equal(missing.summary, '')
  assert.deepEqual(missing.labels, {})
  assert.deepEqual(missing.receivers, [])
})

test('normalizeAlerts 拒绝非数组响应', () => {
  assert.throws(() => normalizeAlerts({}), /不是告警数组/)
})

test('fetch 使用设置拼地址、带鉴权头与超时信号，并按签名缓存 5 秒', async () => {
  const calls = []
  let now = 1_000_000
  const source = new AlertmanagerSource({
    now: () => now,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, text: async () => JSON.stringify(RAW_ALERTS) }
    },
  })
  const bearer = { ...settings, authMode: 'bearer', secret: 'token' }

  const first = await source.fetch(bearer)
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    'https://am.example/api/v2/alerts?active=true&silenced=true&inhibited=true&unprocessed=true',
  )
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.accept, 'application/json')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.equal(first.stats.total, 4)
  assert.equal(first.stats.active, 2)
  assert.equal(first.stats.suppressed, 1)
  assert.equal(first.fetchedAt, new Date(1_000_000).toISOString())

  await source.fetch(bearer)
  assert.equal(calls.length, 1, '5 秒内命中缓存')

  now += 6_000
  await source.fetch(bearer)
  assert.equal(calls.length, 2, '超过 5 秒后重新拉取')

  await source.fetch(bearer, { fresh: true })
  assert.equal(calls.length, 3, 'fresh 绕过缓存')

  await source.fetch({ ...bearer, url: 'https://other.example' })
  assert.equal(calls.length, 4, '设置签名变化后缓存失效')
})

test('fetch 把非 2xx 响应转成带状态码和摘要的可读错误', async () => {
  const source = new AlertmanagerSource({
    fetch: async () => ({ ok: false, status: 401, text: async () => 'bad credentials' }),
  })
  await assert.rejects(
    () => source.fetch(settings),
    (error) => {
      assert.match(error.message, /HTTP 401/)
      assert.match(error.message, /bad credentials/)
      return true
    },
  )
})

test('fetch 把超时转成可读错误', async () => {
  const source = new AlertmanagerSource({
    fetch: async () => {
      const error = new Error('The operation was aborted.')
      error.name = 'TimeoutError'
      throw error
    },
  })
  await assert.rejects(() => source.fetch(settings), /请求超时/)
})

test('fetch 拒绝非 JSON 与非数组 JSON', async () => {
  const notJson = new AlertmanagerSource({
    fetch: async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' }),
  })
  await assert.rejects(() => notJson.fetch(settings), /不是 JSON/)

  const notArray = new AlertmanagerSource({
    fetch: async () => ({ ok: true, status: 200, text: async () => '{"status":"success"}' }),
  })
  await assert.rejects(() => notArray.fetch(settings), /不是告警数组/)
})

test('summarizeResponse 压成单行且不超过 300 字符', () => {
  const summary = summarizeResponse(`line one\n\nline two ${'x'.repeat(1000)}`)
  assert.equal(summary.includes('\n'), false)
  assert.equal(summary.length, 300)
  assert.ok(summary.endsWith('…'))
})
