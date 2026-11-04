import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchAlerts, DispatchError } from '../lib/dispatch.js'

const SETTINGS = {
  version: 2,
  instances: [
    { id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' },
    { id: 'b', name: '测试', url: 'https://am-b.example', authMode: 'bearer', secret: 'token-b' },
  ],
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
    generatorURL: 'https://am-a.example/graph',
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
  const calls = { create: [], rename: [], prompt: [], fetch: [] }
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
  const data = {
    a: { fetchedAt: '2026-01-01T00:00:00.000Z', alerts: [alert()], stats: { total: 1, active: 1, suppressed: 0 } },
    b: {
      fetchedAt: '2026-01-01T00:00:00.000Z',
      alerts: [alert({ fingerprint: 'fp-b', name: 'DiskFull', severity: 'warning', labels: { alertname: 'DiskFull', severity: 'warning' } })],
      stats: { total: 1, active: 1, suppressed: 0 },
    },
  }
  const deps = {
    settings: SETTINGS,
    fetchInstance: async (instance) => {
      calls.fetch.push(instance.id)
      const value = data[instance.id]
      if (value === undefined) throw new Error(`no data for ${instance.id}`)
      return value
    },
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

function selection(instanceId, fingerprint) {
  return { instanceId, fingerprint }
}

test('跨实例派发：按实例分组 prompt、create/rename/prompt 全链路', async () => {
  const { deps, calls } = makeDeps()
  const result = await dispatchAlerts(
    { workspaceId: 'ws-1', selections: [selection('a', 'fp-1'), selection('b', 'fp-b')] },
    deps,
  )

  assert.deepEqual(result, { sessionId: 'session-1' })
  assert.deepEqual(calls.create, [{ workspaceId: 'ws-1' }])
  assert.equal(calls.rename.length, 1)
  assert.equal(calls.rename[0].title, '告警处理：HighCPU 等 2 条')
  assert.equal(calls.prompt.length, 1)
  const { request, signal } = calls.prompt[0]
  assert.equal(request.requestId, 'request-1')
  assert.equal(request.sessionId, 'session-1')
  assert.equal(request.mode, 'queue')
  assert.equal(request.content.length, 1)
  assert.equal(request.content[0].type, 'text')
  const prompt = request.content[0].text
  assert.match(prompt, /## 实例：生产（https:\/\/am-a\.example）/)
  assert.match(prompt, /## 实例：测试（https:\/\/am-b\.example）/)
  assert.match(prompt, /HighCPU/)
  assert.match(prompt, /DiskFull/)
  assert.match(prompt, /\/srv\/app/)
  assert.match(prompt, /选中了 2 条告警/)
  assert.ok(signal instanceof AbortSignal)
  assert.deepEqual(calls.fetch.sort(), ['a', 'b'])
})

test('某实例不可达：prompt 单列说明，其它实例照常建会话', async () => {
  const { deps, calls, controller } = makeDeps()
  deps.fetchInstance = async (instance) => {
    calls.fetch.push(instance.id)
    if (instance.id === 'b') throw new Error('connection refused')
    return { fetchedAt: '2026-01-01T00:00:00.000Z', alerts: [alert()], stats: { total: 1, active: 1, suppressed: 0 } }
  }
  await dispatchAlerts(
    { workspaceId: 'ws-1', selections: [selection('a', 'fp-1'), selection('b', 'fp-b')] },
    deps,
  )
  const prompt = calls.prompt[0].request.content[0].text
  assert.match(prompt, /## 派发时不可达的实例/)
  assert.match(prompt, /实例 测试（https:\/\/am-b\.example） 当时不可达，其选中告警未包含：fp-b/)
  assert.match(prompt, /HighCPU/)
  assert.equal(calls.prompt.length, 1)
  assert.equal(calls.rename[0].title, '告警处理：HighCPU 等 2 条')
})

test('实例已不存在时同样列入不可达说明并继续', async () => {
  const { deps, calls } = makeDeps()
  await dispatchAlerts(
    { workspaceId: 'ws-1', selections: [selection('a', 'fp-1'), selection('gone', 'fp-gone')] },
    deps,
  )
  const prompt = calls.prompt[0].request.content[0].text
  assert.match(prompt, /实例 gone 当时不可达，其选中告警未包含：fp-gone/)
  assert.equal(calls.create.length, 1)
})

test('全部选中告警都取不到时返回 502 且不创建会话', async () => {
  const { deps, calls } = makeDeps({
    fetchInstance: async () => ({
      fetchedAt: '2026-01-01T00:00:00.000Z',
      alerts: [alert({ fingerprint: 'other' })],
      stats: { total: 1, active: 1, suppressed: 0 },
    }),
  })
  await assert.rejects(
    () => dispatchAlerts({ workspaceId: 'ws-1', selections: [selection('a', 'fp-1')] }, deps),
    (error) => {
      assert.ok(error instanceof DispatchError)
      assert.equal(error.status, 502)
      assert.equal(error.code, 'dispatch.alerts-unavailable')
      return true
    },
  )
  assert.equal(calls.create.length, 0)
})

test('已恢复告警写进 prompt，标题计数仍为选中条数', async () => {
  const { deps, calls } = makeDeps()
  await dispatchAlerts(
    { workspaceId: 'ws-1', selections: [selection('a', 'fp-1'), selection('a', 'gone-1')] },
    deps,
  )
  const prompt = calls.prompt[0].request.content[0].text
  assert.match(prompt, /## 派发时已不在告警列表的告警/)
  assert.match(prompt, /可能已恢复/)
  assert.match(prompt, /生产 \/ 指纹：gone-1/)
  assert.equal(calls.rename[0].title, '告警处理：HighCPU 等 2 条')
})

test('selections 去重，标题按去重后的条数', async () => {
  const { deps, calls } = makeDeps()
  await dispatchAlerts(
    {
      workspaceId: 'ws-1',
      selections: [selection('a', 'fp-1'), selection('a', 'fp-1'), selection('a', 'fp-1')],
    },
    deps,
  )
  assert.equal(calls.prompt.length, 1)
  assert.equal(calls.rename[0].title, '告警处理：HighCPU 等 1 条')
  const prompt = calls.prompt[0].request.content[0].text
  assert.equal((prompt.match(/HighCPU/g) ?? []).length > 0, true)
})

test('selections 校验：空、非法项、空工作区都返回 400 dispatch.invalid', async () => {
  const { deps } = makeDeps()
  const cases = [
    {},
    { workspaceId: 'ws-1', selections: [] },
    { workspaceId: 'ws-1', selections: [selection('a', 'fp-1'), { instanceId: '', fingerprint: 'x' }] },
    { workspaceId: 'ws-1', selections: [{ instanceId: 'a', fingerprint: '  ' }] },
    { workspaceId: '   ', selections: [selection('a', 'fp-1')] },
  ]
  for (const input of cases) {
    await assert.rejects(
      () => dispatchAlerts(input, deps),
      (error) => {
        assert.ok(error instanceof DispatchError)
        assert.equal(error.status, 400)
        assert.equal(error.code, 'dispatch.invalid')
        return true
      },
    )
  }
})

test('不再限制单次派发条数：25 条选择也能派发（仅匹配到的进入 prompt）', async () => {
  const { deps, calls } = makeDeps()
  const selections = Array.from({ length: 25 }, (_, index) => selection('a', `fp-${index}`))
  selections[0] = selection('a', 'fp-1')
  const result = await dispatchAlerts({ workspaceId: 'ws-1', selections }, deps)
  assert.equal(result.sessionId, 'session-1')
  assert.equal(calls.create.length, 1)
  const prompt = calls.prompt[0].request.content[0].text
  assert.match(prompt, /HighCPU/)
})

test('工作区不存在返回 404 dispatch.workspace-not-found 且不创建会话', async () => {
  const { deps, calls } = makeDeps({ workspaceRegistry: { get: () => undefined } })
  await assert.rejects(
    () => dispatchAlerts({ workspaceId: 'ws-missing', selections: [selection('a', 'fp-1')] }, deps),
    (error) => {
      assert.equal(error.status, 404)
      assert.equal(error.code, 'dispatch.workspace-not-found')
      return true
    },
  )
  assert.equal(calls.create.length, 0)
})

test('缺少 sessionController 返回 503 session.unavailable', async () => {
  const { deps } = makeDeps()
  deps.sessionController = undefined
  await assert.rejects(
    () => dispatchAlerts({ workspaceId: 'ws-1', selections: [selection('a', 'fp-1')] }, deps),
    (error) => {
      assert.equal(error.status, 503)
      assert.equal(error.code, 'session.unavailable')
      return true
    },
  )
})

test('未配置实例返回 400 alerts.not-configured', async () => {
  const { deps } = makeDeps({ settings: { version: 2, instances: [] } })
  await assert.rejects(
    () => dispatchAlerts({ workspaceId: 'ws-1', selections: [selection('a', 'fp-1')] }, deps),
    (error) => {
      assert.equal(error.status, 400)
      assert.equal(error.code, 'alerts.not-configured')
      return true
    },
  )
})

test('prompt 失败返回带 sessionId 的 502 dispatch.prompt-failed', async () => {
  const { deps, controller } = makeDeps()
  controller.prompt = async () => {
    throw new Error('agent unavailable')
  }
  await assert.rejects(
    () => dispatchAlerts({ workspaceId: 'ws-1', selections: [selection('a', 'fp-1')] }, deps),
    (error) => {
      assert.equal(error.status, 502)
      assert.equal(error.code, 'dispatch.prompt-failed')
      assert.equal(error.sessionId, 'session-1')
      assert.match(error.message, /发送首条消息失败/)
      return true
    },
  )
})

test('create 失败返回 502 dispatch.create-failed', async () => {
  const { deps, controller } = makeDeps()
  controller.create = async () => {
    throw new Error('cannot create')
  }
  await assert.rejects(
    () => dispatchAlerts({ workspaceId: 'ws-1', selections: [selection('a', 'fp-1')] }, deps),
    (error) => {
      assert.equal(error.status, 502)
      assert.equal(error.code, 'dispatch.create-failed')
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
  const result = await dispatchAlerts({ workspaceId: 'ws-1', selections: [selection('a', 'fp-1')] }, deps)
  assert.deepEqual(result, { sessionId: 'session-1' })
  assert.equal(calls.prompt.length, 1)
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][1]), /rename not supported/)
})
