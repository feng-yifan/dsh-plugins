import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SETTINGS,
  deriveInstanceName,
  normalizeSettings,
  publicSettings,
  readSettings,
  saveSettings,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  SettingsError,
} from '../lib/settings.js'

/** 最小的假凭据服务：一条 grant 记录，读写都走真实 modifyRecord 语义。 */
function fakeCredentials(initial) {
  let record = initial === undefined ? undefined : { kind: 'grant', payload: initial }
  return {
    async readRecord(key) {
      assert.equal(key, SETTINGS_KEY)
      return record
    },
    async modifyRecord(key, mutate) {
      assert.equal(key, SETTINGS_KEY)
      record = await mutate(record)
      return record
    },
    get record() {
      return record
    },
    replace(next) {
      record = next
    },
  }
}

/** 递归校验值是否严格可 JSON 表示：undefined / 函数 / symbol / 非有限数字都拒绝。 */
function assertJsonRepresentable(value, path = 'payload') {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${path} 不是有限数字`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonRepresentable(item, `${path}[${index}]`))
    return
  }
  assert.equal(type, 'object', `${path} 的类型 ${type} 不可 JSON 表示`)
  for (const key of Reflect.ownKeys(value)) {
    assert.equal(typeof key, 'string', `${path} 含 symbol 键`)
    assert.notEqual(value[key], undefined, `${path}.${key} 是 undefined`)
    assertJsonRepresentable(value[key], `${path}.${key}`)
  }
}

/** 严格校验 payload 的假凭据服务：模拟 DSH 凭据服务对 JSON 表示的要求。 */
function strictCredentials(initial) {
  let record = initial === undefined ? undefined : { kind: 'grant', payload: initial }
  return {
    async readRecord(key) {
      assert.equal(key, SETTINGS_KEY)
      return record
    },
    async modifyRecord(key, mutate) {
      assert.equal(key, SETTINGS_KEY)
      const next = await mutate(record)
      assert.equal(next.kind, 'grant')
      assertJsonRepresentable(next.payload)
      assert.deepEqual(JSON.parse(JSON.stringify(next.payload)), next.payload)
      record = next
      return record
    },
    get record() {
      return record
    },
  }
}

const INSTANCE_A = {
  id: 'a',
  name: '生产',
  url: 'https://am.example',
  authMode: 'basic',
  username: 'alice',
  secret: 's3cret',
  insecureTls: true,
}

test('readSettings 无记录时返回 v2 空实例列表', async () => {
  const settings = await readSettings(fakeCredentials())
  assert.deepEqual(settings, { version: SETTINGS_VERSION, instances: [] })
  assert.deepEqual(DEFAULT_SETTINGS, { version: SETTINGS_VERSION, instances: [] })
})

test('v1 payload 自动迁移成单实例，丢弃 refreshSeconds', async () => {
  const parsed = normalizeSettings({
    url: '  https://alertmanager.example.com/  ',
    authMode: 'bearer',
    secret: 'token-1',
    insecureTls: true,
    refreshSeconds: 15,
  })
  assert.equal(parsed.version, 2)
  assert.equal(parsed.instances.length, 1)
  assert.deepEqual(parsed.instances[0], {
    id: 'default',
    name: 'alertmanager.example.com',
    url: 'https://alertmanager.example.com/',
    authMode: 'bearer',
    secret: 'token-1',
    insecureTls: true,
  })
  assert.equal(Object.hasOwn(parsed.instances[0], 'refreshSeconds'), false)
  assert.equal(Object.hasOwn(parsed, 'refreshSeconds'), false)
})

test('v1 空地址与无法识别的 payload 都归一为空实例列表', async () => {
  assert.deepEqual(normalizeSettings({ url: '', authMode: 'none' }), {
    version: 2,
    instances: [],
  })
  assert.deepEqual(normalizeSettings(undefined), { version: 2, instances: [] })
  assert.deepEqual(normalizeSettings({ hello: 'world' }), { version: 2, instances: [] })
  assert.deepEqual(normalizeSettings('nope'), { version: 2, instances: [] })
  assert.deepEqual(normalizeSettings({ version: 2, instances: [] }), { version: 2, instances: [] })
})

test('readSettings 忽略非 grant 记录并容错非法字段', async () => {
  const service = fakeCredentials()
  service.replace({ kind: 'api-key', value: 'irrelevant' })
  assert.deepEqual(await readSettings(service), { version: 2, instances: [] })

  const odd = fakeCredentials({
    version: 2,
    instances: [
      { id: 'x', name: '', url: 'https://am.example', authMode: 'weird', insecureTls: 'yes' },
      { id: 'x', name: '重复 id', url: 'https://dup.example', authMode: 'none' },
      { id: 'y', name: '无地址', url: '', authMode: 'none' },
      { id: 'z', url: 'https://z.example', authMode: 'bearer', secret: '' },
    ],
  })
  const parsed = await readSettings(odd)
  assert.deepEqual(
    parsed.instances.map((instance) => instance.id),
    ['x', 'z'],
  )
  assert.equal(parsed.instances[0].name, 'am.example')
  assert.equal(parsed.instances[0].authMode, 'none')
  assert.equal(parsed.instances[0].secret, undefined)
  assert.equal(parsed.instances[0].insecureTls, undefined)
  assert.equal(parsed.instances[1].name, 'z.example')
  assert.equal(parsed.instances[1].secret, undefined)
})

test('publicSettings 绝不回传 secret，只给 hasSecret', () => {
  const view = publicSettings({ version: 2, instances: [INSTANCE_A] })
  assert.deepEqual(view, {
    instances: [
      {
        id: 'a',
        name: '生产',
        url: 'https://am.example',
        authMode: 'basic',
        username: 'alice',
        hasSecret: true,
        insecureTls: true,
      },
    ],
  })
  assert.equal(JSON.stringify(view).includes('s3cret'), false)
})

test('saveSettings 全量保存，按 id 保留被省略/空串的旧 secret', async () => {
  const service = fakeCredentials()
  const first = await saveSettings(service, { instances: [INSTANCE_A] })
  assert.equal(first.instances[0].hasSecret, true)
  assert.equal(service.record.kind, 'grant')
  assert.equal(service.record.payload.version, 2)
  assert.equal(service.record.payload.instances[0].secret, 's3cret')

  const second = await saveSettings(service, {
    instances: [{ ...INSTANCE_A, name: '生产 2', secret: '' }],
  })
  assert.equal(second.instances[0].name, '生产 2')
  assert.equal(second.instances[0].hasSecret, true)
  assert.equal(service.record.payload.instances[0].secret, 's3cret')

  const third = await saveSettings(service, {
    instances: [{ id: 'a', name: '生产 3', url: 'https://am.example', authMode: 'basic', username: 'bob' }],
  })
  assert.equal(third.instances[0].hasSecret, true)
  assert.equal(service.record.payload.instances[0].secret, 's3cret')
  assert.equal(service.record.payload.instances[0].username, 'bob')
})

test('authMode 为 none 时清空 secret 与 username', async () => {
  const service = fakeCredentials()
  await saveSettings(service, { instances: [INSTANCE_A] })
  const view = await saveSettings(service, {
    instances: [{ id: 'a', name: '生产', url: 'https://am.example', authMode: 'none' }],
  })
  assert.equal(view.instances[0].hasSecret, false)
  assert.equal(view.instances[0].username, '')
  assert.equal(service.record.payload.instances[0].secret, undefined)
  assert.equal(service.record.payload.instances[0].username, undefined)
})

test('保存空数组合法，并删除旧实例', async () => {
  const service = fakeCredentials()
  await saveSettings(service, { instances: [INSTANCE_A] })
  const view = await saveSettings(service, { instances: [] })
  assert.deepEqual(view, { instances: [] })
  assert.deepEqual(service.record.payload, { version: 2, instances: [] })
})

test('删除其中一个实例时其余实例保留', async () => {
  const service = fakeCredentials()
  await saveSettings(service, {
    instances: [INSTANCE_A, { id: 'b', name: '测试', url: 'https://test.example', authMode: 'none' }],
  })
  const view = await saveSettings(service, {
    instances: [{ id: 'b', name: '测试', url: 'https://test.example', authMode: 'none' }],
  })
  assert.deepEqual(
    view.instances.map((instance) => instance.id),
    ['b'],
  )
})

test('settings.invalid：重复 URL / 非法 URL / 重复 id / 空名称都拒绝', async () => {
  const service = fakeCredentials()
  const cases = [
    [
      {
        instances: [
          { id: 'a', name: 'A', url: 'https://am.example', authMode: 'none' },
          { id: 'b', name: 'B', url: 'https://am.example', authMode: 'none' },
        ],
      },
      /地址重复/,
    ],
    [{ instances: [{ id: 'a', name: 'A', url: 'ftp://am.example', authMode: 'none' }] }, /http\/https/],
    [{ instances: [{ id: 'a', name: 'A', url: 'not a url', authMode: 'none' }] }, /http\/https/],
    [
      {
        instances: [
          { id: 'a', name: 'A', url: 'https://a.example', authMode: 'none' },
          { id: 'a', name: 'B', url: 'https://b.example', authMode: 'none' },
        ],
      },
      /实例 ID 重复/,
    ],
    [{ instances: [{ id: 'a', name: '   ', url: 'https://a.example', authMode: 'none' }] }, /名称不能为空/],
    [{ instances: [{ id: '', name: 'A', url: 'https://a.example', authMode: 'none' }] }, /实例 ID 不能为空/],
    [{ instances: [{ id: 'a', name: 'A', url: 'https://a.example', authMode: 'oauth' }] }, /鉴权方式/],
    [{ instances: 'nope' }, /instances 必须是数组/],
  ]
  for (const [input, pattern] of cases) {
    await assert.rejects(
      () => saveSettings(service, input),
      (error) => {
        assert.ok(error instanceof SettingsError)
        assert.equal(error.status, 400)
        assert.equal(error.code, 'settings.invalid')
        assert.match(error.message, pattern)
        return true
      },
    )
  }
})

test('新建实例省略名称时用 URL host 兜底', async () => {
  const service = fakeCredentials()
  const view = await saveSettings(service, {
    instances: [{ id: 'new', url: 'https://am.internal.example/base', authMode: 'none' }],
  })
  assert.equal(view.instances[0].name, 'am.internal.example')
})

test('新建实例需要 secret 但没有旧值时按空串处理，不报错', async () => {
  const service = fakeCredentials()
  const view = await saveSettings(service, {
    instances: [{ id: 'fresh', name: 'Fresh', url: 'https://fresh.example', authMode: 'bearer' }],
  })
  assert.equal(view.instances[0].hasSecret, false)
  assert.equal(service.record.payload.instances[0].secret, '')
})

test('写入 payload 不含 undefined 自有属性，可被严格 JSON 校验', async () => {
  const service = strictCredentials()
  await saveSettings(service, {
    instances: [
      { id: 'a', name: 'A', url: 'http://a:9093', authMode: 'none', insecureTls: false },
      { id: 'b', url: 'https://b.example', authMode: 'basic', username: 'u', secret: 'p' },
      { id: 'c', url: 'https://c.example', authMode: 'bearer' },
    ],
  })
  const payload = service.record.payload
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload)
  for (const instance of payload.instances) {
    for (const key of Object.keys(instance)) {
      assert.notEqual(instance[key], undefined, `payload.${instance.id}.${key} 是 undefined`)
    }
  }
  assert.equal(Object.hasOwn(payload.instances[0], 'username'), false)
  assert.equal(Object.hasOwn(payload.instances[0], 'secret'), false)
  assert.equal(Object.hasOwn(payload.instances[0], 'insecureTls'), false)
  assert.equal(Object.hasOwn(payload.instances[2], 'username'), false)
  assert.equal(payload.instances[2].secret, '')
})

test('normalizeSettings 与 DEFAULT_SETTINGS 对空输入一致', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
})

test('deriveInstanceName 从 URL 取 host，失败时回退', () => {
  assert.equal(deriveInstanceName('https://am.example:9093/path'), 'am.example:9093')
  assert.equal(deriveInstanceName('not a url', '回退'), '回退')
})
