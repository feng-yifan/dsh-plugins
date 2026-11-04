import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import { SETTINGS_KEY } from '../lib/settings.js'

const PREFIX = '/_dsh/alertmanager'

function rawAlert(overrides = {}) {
  return {
    fingerprint: 'fp-a-1',
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

function fetchResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

function fakeRequest({ method = 'GET', url = '/', body } = {}) {
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    payload: '',
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
      this.headersSent = true
    },
    end(chunk) {
      if (chunk !== undefined) this.payload += String(chunk)
    },
  }
}

async function invoke(route, options) {
  const res = fakeResponse()
  await route.handler(fakeRequest(options), res)
  return {
    status: res.statusCode,
    headers: res.headers,
    text: res.payload,
    json: res.payload === '' ? undefined : JSON.parse(res.payload),
  }
}

function makeCtx({ initialSettings, connection, sessionController, workspaceRegistry } = {}) {
  let record = initialSettings === undefined ? undefined : { kind: 'grant', payload: initialSettings }
  const routes = new Map()
  const disposers = []
  const credentials = {
    async readRecord(key) {
      assert.equal(key, SETTINGS_KEY)
      return record
    },
    async modifyRecord(key, mutate) {
      assert.equal(key, SETTINGS_KEY)
      record = await mutate(record)
      return record
    },
  }
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    logger: { warn() {} },
    get(name) {
      if (name === 'connection') {
        return connection === false ? undefined : { requestRejection: () => undefined }
      }
      if (name === 'credentials') return credentials
      if (name === 'sessionController') return sessionController
      if (name === 'workspaceRegistry') return workspaceRegistry
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  apply(ctx)
  return {
    routes,
    getRecord: () => record,
    dispose: () => disposers.forEach((dispose) => dispose()),
  }
}

async function withFetch(impl, callback) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await callback()
  } finally {
    globalThis.fetch = original
  }
}

test('路由只注册三个 exact path（settings 的 GET/POST 共用一个）', () => {
  const { routes, dispose } = makeCtx()
  assert.deepEqual([...routes.keys()].sort(), [
    `${PREFIX}/alerts`,
    `${PREFIX}/dispatch`,
    `${PREFIX}/settings`,
  ])
  dispose()
})

test('GET /settings 迁移 v1，返回 hasSecret 但绝不回传 secret', async () => {
  const { routes } = makeCtx({
    initialSettings: { url: 'https://am.example', authMode: 'bearer', secret: 'top-secret', refreshSeconds: 30 },
  })
  const result = await invoke(routes.get(`${PREFIX}/settings`), { method: 'GET', url: `${PREFIX}/settings` })
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.text.includes('top-secret'), false)
  assert.deepEqual(result.json, {
    instances: [
      {
        id: 'default',
        name: 'am.example',
        url: 'https://am.example',
        authMode: 'bearer',
        username: '',
        hasSecret: true,
        insecureTls: false,
      },
    ],
  })
})

test('POST /settings 全量保存并返回同构视图（不回 secret）', async () => {
  const { routes, getRecord } = makeCtx()
  const post = await invoke(routes.get(`${PREFIX}/settings`), {
    method: 'POST',
    url: `${PREFIX}/settings`,
    body: {
      instances: [
        {
          id: 'a',
          name: '生产',
          url: 'https://am.example',
          authMode: 'bearer',
          secret: 'token-1',
        },
      ],
    },
  })
  assert.equal(post.status, 200)
  assert.equal(post.text.includes('token-1'), false)
  assert.equal(post.json.instances[0].hasSecret, true)
  assert.equal(getRecord().payload.instances[0].secret, 'token-1')

  const get = await invoke(routes.get(`${PREFIX}/settings`), { method: 'GET', url: `${PREFIX}/settings` })
  assert.equal(get.text.includes('token-1'), false)
  assert.equal(get.json.instances[0].name, '生产')
})

test('POST /settings 非法设置返回 400 settings.invalid', async () => {
  const { routes } = makeCtx()
  const result = await invoke(routes.get(`${PREFIX}/settings`), {
    method: 'POST',
    url: `${PREFIX}/settings`,
    body: {
      instances: [
        { id: 'a', name: 'A', url: 'https://same.example', authMode: 'none' },
        { id: 'b', name: 'B', url: 'https://same.example', authMode: 'none' },
      ],
    },
  })
  assert.equal(result.status, 400)
  assert.equal(result.json.code, 'settings.invalid')
  assert.match(result.json.error, /地址重复/)
})

test('GET /alerts 聚合多实例，带 instanceId/instanceName 并缓存 5 秒', async () => {
  let calls = 0
  await withFetch(
    async (url) => {
      calls += 1
      if (url.startsWith('https://am-a')) {
        return fetchResponse(JSON.stringify([rawAlert()]))
      }
      return fetchResponse(
        JSON.stringify([
          rawAlert({
            fingerprint: 'fp-b-1',
            labels: { alertname: 'DiskFull', severity: 'warning' },
            status: { state: 'suppressed' },
          }),
        ]),
      )
    },
    async () => {
      const { routes } = makeCtx({
        initialSettings: {
          version: 2,
          instances: [
            { id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' },
            { id: 'b', name: '测试', url: 'https://am-b.example', authMode: 'none' },
          ],
        },
      })
      const first = await invoke(routes.get(`${PREFIX}/alerts`), { method: 'GET', url: `${PREFIX}/alerts` })
      assert.equal(first.status, 200)
      assert.equal(first.headers['cache-control'], 'no-store')
      assert.equal(first.json.instances.length, 2)
      assert.deepEqual(
        first.json.instances.map((instance) => instance.ok),
        [true, true],
      )
      assert.deepEqual(
        first.json.alerts.map((alert) => `${alert.instanceId}/${alert.fingerprint}/${alert.instanceName}`),
        ['a/fp-a-1/生产', 'b/fp-b-1/测试'],
      )
      assert.equal(first.json.alerts[0].instanceUrl, 'https://am-a.example')
      assert.equal(calls, 2)

      const second = await invoke(routes.get(`${PREFIX}/alerts`), { method: 'GET', url: `${PREFIX}/alerts` })
      assert.equal(second.status, 200)
      assert.equal(calls, 2, '5 秒内命中每实例缓存')

      const fresh = await invoke(routes.get(`${PREFIX}/alerts`), {
        method: 'GET',
        url: `${PREFIX}/alerts?fresh=1`,
      })
      assert.equal(fresh.status, 200)
      assert.equal(calls, 4, 'fresh=1 绕过缓存')
    },
  )
})

test('GET /alerts 单实例失败仍返回 200，全部失败返回 400 alerts.fetch-failed', async () => {
  await withFetch(
    async (url) => {
      if (url.startsWith('https://am-a')) throw new Error('down')
      return fetchResponse(JSON.stringify([rawAlert()]))
    },
    async () => {
      const partial = makeCtx({
        initialSettings: {
          version: 2,
          instances: [
            { id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' },
            { id: 'b', name: '测试', url: 'https://am-b.example', authMode: 'none' },
          ],
        },
      })
      const result = await invoke(partial.routes.get(`${PREFIX}/alerts`), { method: 'GET', url: `${PREFIX}/alerts` })
      assert.equal(result.status, 200)
      assert.equal(result.json.instances[0].ok, false)
      assert.match(result.json.instances[0].error, /down/)
      assert.equal(result.json.instances[0].code, 'alerts.network')
      assert.equal(result.json.alerts.length, 1)
    },
  )

  await withFetch(
    async () => {
      throw new Error('down')
    },
    async () => {
      const allFailed = makeCtx({
        initialSettings: {
          version: 2,
          instances: [{ id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' }],
        },
      })
      const result = await invoke(allFailed.routes.get(`${PREFIX}/alerts`), {
        method: 'GET',
        url: `${PREFIX}/alerts`,
      })
      assert.equal(result.status, 400)
      assert.equal(result.json.code, 'alerts.fetch-failed')
    },
  )
})

test('GET /alerts 未配置实例返回 400 alerts.not-configured', async () => {
  const { routes } = makeCtx({ initialSettings: { version: 2, instances: [] } })
  const result = await invoke(routes.get(`${PREFIX}/alerts`), { method: 'GET', url: `${PREFIX}/alerts` })
  assert.equal(result.status, 400)
  assert.equal(result.json.code, 'alerts.not-configured')
})

test('POST /dispatch 参数校验返回 400 dispatch.invalid，且不创建会话', async () => {
  const created = []
  const sessionController = {
    async create(request) {
      created.push(request)
      return { sessionId: 'session-1' }
    },
    async prompt() {},
  }
  const { routes } = makeCtx({
    initialSettings: {
      version: 2,
      instances: [{ id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' }],
    },
    sessionController,
    workspaceRegistry: { get: (id) => ({ id, path: '/srv/app' }) },
  })
  for (const body of [
    { workspaceId: 'ws-1', selections: [] },
    { workspaceId: 'ws-1', selections: [{ instanceId: 'a', fingerprint: '' }] },
    { workspaceId: 'ws-1', selections: [{ instanceId: 'a', fingerprint: 'fp-1' }, { instanceId: '', fingerprint: 'x' }] },
  ]) {
    const result = await invoke(routes.get(`${PREFIX}/dispatch`), {
      method: 'POST',
      url: `${PREFIX}/dispatch`,
      body,
    })
    assert.equal(result.status, 400)
    assert.equal(result.json.code, 'dispatch.invalid')
  }
  assert.equal(created.length, 0)
})

test('POST /dispatch 成功：按实例 fresh 拉取、建会话并发送分组 prompt', async () => {
  const calls = { create: [], prompt: [] }
  const sessionController = {
    async create(request) {
      calls.create.push(request)
      return { sessionId: 'session-9' }
    },
    async rename() {},
    async prompt(request) {
      calls.prompt.push(request)
    },
  }
  const workspaceRegistry = { get: (id) => (id === 'ws-1' ? { id, path: '/srv/app' } : undefined) }
  await withFetch(
    async () =>
      fetchResponse(
        JSON.stringify([
          rawAlert(),
          rawAlert({
            fingerprint: 'fp-b-1',
            labels: { alertname: 'DiskFull', severity: 'warning' },
            status: { state: 'suppressed' },
          }),
        ]),
      ),
    async () => {
      const { routes } = makeCtx({
        initialSettings: {
          version: 2,
          instances: [
            { id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' },
            { id: 'b', name: '测试', url: 'https://am-b.example', authMode: 'none' },
          ],
        },
        sessionController,
        workspaceRegistry,
      })
      const result = await invoke(routes.get(`${PREFIX}/dispatch`), {
        method: 'POST',
        url: `${PREFIX}/dispatch`,
        body: {
          workspaceId: 'ws-1',
          selections: [
            { instanceId: 'a', fingerprint: 'fp-a-1' },
            { instanceId: 'b', fingerprint: 'fp-b-1' },
          ],
        },
      })
      assert.equal(result.status, 200)
      assert.deepEqual(result.json, { sessionId: 'session-9' })
      assert.deepEqual(calls.create, [{ workspaceId: 'ws-1' }])
      const prompt = calls.prompt[0].content[0].text
      assert.match(prompt, /## 实例：生产（https:\/\/am-a\.example）/)
      assert.match(prompt, /## 实例：测试（https:\/\/am-b\.example）/)
      assert.match(prompt, /\/srv\/app/)
    },
  )
})

test('缺少连接服务 / 凭据服务 / 会话服务时返回 503 + 稳定 code', async () => {
  const noConnection = makeCtx({ connection: false })
  const connectionResult = await invoke(noConnection.routes.get(`${PREFIX}/settings`), {
    method: 'GET',
    url: `${PREFIX}/settings`,
  })
  assert.equal(connectionResult.status, 503)
  assert.equal(connectionResult.json.code, 'connection.unavailable')

  const noSession = makeCtx({
    initialSettings: {
      version: 2,
      instances: [{ id: 'a', name: '生产', url: 'https://am-a.example', authMode: 'none' }],
    },
    workspaceRegistry: { get: (id) => ({ id, path: '/srv/app' }) },
  })
  const sessionResult = await invoke(noSession.routes.get(`${PREFIX}/dispatch`), {
    method: 'POST',
    url: `${PREFIX}/dispatch`,
    body: { workspaceId: 'ws-1', selections: [{ instanceId: 'a', fingerprint: 'fp-a-1' }] },
  })
  assert.equal(sessionResult.status, 503)
  assert.equal(sessionResult.json.code, 'session.unavailable')
})

test('错误请求体与不支持的方法都带稳定 code', async () => {
  const { routes } = makeCtx()
  const badJson = await invoke(routes.get(`${PREFIX}/settings`), {
    method: 'POST',
    url: `${PREFIX}/settings`,
    body: '{not json',
  })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.json.code, 'request.invalid')

  const method = await invoke(routes.get(`${PREFIX}/settings`), { method: 'PUT', url: `${PREFIX}/settings` })
  assert.equal(method.status, 405)
  assert.equal(method.json.code, 'request.method-not-allowed')
})
