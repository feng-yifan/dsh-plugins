import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchAlerts } from '../lib/dispatch.js'

const SETTINGS = {
  url: 'https://am.example',
  authMode: 'none',
  insecureTls: false,
  refreshSeconds: 30,
}

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
    description: 'CPU above 90%',
    labels: { alertname: 'HighCPU', severity: 'critical' },
    annotations: { summary: 'CPU high' },
    receivers: ['ops'],
    silencedBy: [],
    inhibitedBy: [],
    ...overrides,
  }
}

function makeDeps(overrides = {}) {
  const calls = { create: [], rename: [], prompt: [] }
  const controller = {
    async create(request) {
      calls.create.push(request)
      return { sessionId: 'session-1' }
    },
    async rename(request) {
      calls.rename.push(request)
      return { title: request.title, seq: 1 }
    },
    async prompt(request, signal) {
      calls.prompt.push({ request, signal })
      return { accepted: true }
    },
  }
  const deps = {
    settings: SETTINGS,
    fetchAlerts: async () => ({
      fetchedAt: '2026-01-01T00:00:00.000Z',
      alerts: [alert()],
      stats: { total: 1, active: 1, suppressed: 0 },
    }),
    sessionController: controller,
    workspaceRegistry: {
      get(id) {
        return { id, path: '/srv/app', title: 'app' }
      },
    },
    randomUUID: () => 'request-1',
    ...overrides,
  }
  return { deps, calls, controller }
}

test('派发全链路：create 收到 workspaceId，rename 标题，prompt 含告警名与指纹', async () => {
  const { deps, calls } = makeDeps()
  const result = await dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-1' }, deps)

  assert.deepEqual(result, { sessionId: 'session-1' })
  assert.deepEqual(calls.create, [{ workspaceId: 'ws-1' }])
  assert.deepEqual(calls.rename, [{ sessionId: 'session-1', title: '告警处理：HighCPU 等 1 条' }])
  assert.equal(calls.prompt.length, 1)
  const { request, signal } = calls.prompt[0]
  assert.equal(request.requestId, 'request-1')
  assert.equal(request.sessionId, 'session-1')
  assert.equal(request.mode, 'queue')
  assert.equal(request.content.length, 1)
  assert.equal(request.content[0].type, 'text')
  assert.match(request.content[0].text, /HighCPU/)
  assert.match(request.content[0].text, /fp-1/)
  assert.match(request.content[0].text, /\/srv\/app/)
  assert.ok(signal instanceof AbortSignal)
})

test('派发时已消失的告警写进 prompt，但仍创建会话', async () => {
  const { deps, calls } = makeDeps({
    fetchAlerts: async () => ({
      fetchedAt: '2026-01-01T00:00:00.000Z',
      alerts: [alert()],
      stats: { total: 1, active: 1, suppressed: 0 },
    }),
  })
  await dispatchAlerts({ fingerprints: ['fp-1', 'gone-1'], workspaceId: 'ws-1' }, deps)
  const prompt = calls.prompt[0].request.content[0].text
  assert.match(prompt, /gone-1/)
  assert.match(prompt, /可能已恢复/)
  assert.equal(calls.rename[0].title, '告警处理：HighCPU 等 2 条')
})

test('缺少 sessionController 返回 503', async () => {
  const { deps } = makeDeps()
  deps.sessionController = undefined
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-1' }, deps),
    (error) => {
      assert.equal(error.status, 503)
      assert.match(error.message, /当前 profile 不支持创建会话/)
      return true
    },
  )
})

test('工作区不存在返回 404 且不创建会话', async () => {
  const { deps, calls } = makeDeps({ workspaceRegistry: { get: () => undefined } })
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-missing' }, deps),
    (error) => {
      assert.equal(error.status, 404)
      assert.match(error.message, /工作区不存在/)
      return true
    },
  )
  assert.equal(calls.create.length, 0)
})

test('prompt 失败返回带 sessionId 的 502', async () => {
  const { deps, controller } = makeDeps()
  controller.prompt = async () => {
    throw new Error('agent unavailable')
  }
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-1' }, deps),
    (error) => {
      assert.equal(error.status, 502)
      assert.equal(error.sessionId, 'session-1')
      assert.match(error.message, /发送首条消息失败/)
      assert.match(error.message, /agent unavailable/)
      return true
    },
  )
})

test('rename 失败只记日志，不阻断派发', async () => {
  const warnings = []
  const { deps, controller, calls } = makeDeps({ logger: { warn: (...args) => warnings.push(args) } })
  controller.rename = async () => {
    throw new Error('rename not supported')
  }
  const result = await dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-1' }, deps)
  assert.deepEqual(result, { sessionId: 'session-1' })
  assert.equal(calls.prompt.length, 1)
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][1]), /rename not supported/)
})

test('拉取最新告警失败返回 502', async () => {
  const { deps } = makeDeps({
    fetchAlerts: async () => {
      throw new Error('network down')
    },
  })
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-1' }, deps),
    (error) => {
      assert.equal(error.status, 502)
      assert.match(error.message, /拉取最新告警失败/)
      assert.match(error.message, /network down/)
      return true
    },
  )
})

test('校验告警条数、指纹与工作区', async () => {
  const { deps } = makeDeps()
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: [], workspaceId: 'ws-1' }, deps),
    /请选择 1–20 条告警/,
  )
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: Array.from({ length: 21 }, (_, i) => `fp-${i}`), workspaceId: 'ws-1' }, deps),
    /请选择 1–20 条告警/,
  )
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: [''], workspaceId: 'ws-1' }, deps),
    /非空字符串/,
  )
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: '   ' }, deps),
    /请选择工作区/,
  )
})

test('未配置 AlertManager 地址时拒绝派发', async () => {
  const { deps } = makeDeps({ settings: { ...SETTINGS, url: '' } })
  await assert.rejects(
    () => dispatchAlerts({ fingerprints: ['fp-1'], workspaceId: 'ws-1' }, deps),
    /尚未配置 AlertManager 地址/,
  )
})
