import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  publicSettings,
  readSettings,
  saveSettings,
  SETTINGS_KEY,
} from '../lib/settings.js'

/** 最小的假凭据服务：一条 grant 记录，读写都走真实 modifyRecord 语义。 */
function fakeCredentials(initial) {
  let record = initial === undefined ? undefined : { kind: 'grant', payload: initial }
  const service = {
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
  return service
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
      for (const key of Object.keys(next.payload)) {
        assert.notEqual(next.payload[key], undefined, `payload.${key} 是 undefined`)
      }
      record = next
      return record
    },
    get record() {
      return record
    },
  }
}

test('readSettings 无记录时返回默认值', async () => {
  const settings = await readSettings(fakeCredentials())
  assert.equal(settings.url, '')
  assert.equal(settings.authMode, 'none')
  assert.equal(settings.insecureTls, false)
  assert.equal(settings.refreshSeconds, 30)
  assert.equal(settings.secret, undefined)
})

test('readSettings 忽略非 grant 记录并容错非法字段', async () => {
  const service = fakeCredentials()
  service.replace({ kind: 'api-key', value: 'irrelevant' })
  const settings = await readSettings(service)
  assert.equal(settings.url, '')

  const odd = fakeCredentials({ url: '  https://am.example  ', authMode: 'weird', refreshSeconds: 'abc', insecureTls: 'yes' })
  const parsed = await readSettings(odd)
  assert.equal(parsed.url, 'https://am.example')
  assert.equal(parsed.authMode, 'none')
  assert.equal(parsed.refreshSeconds, 30)
  assert.equal(parsed.insecureTls, false)
})

test('publicSettings 绝不回传 secret，只给 hasSecret', () => {
  const view = publicSettings({
    url: 'https://am.example',
    authMode: 'bearer',
    secret: 'super-secret-token',
    insecureTls: true,
    refreshSeconds: 15,
  })
  assert.equal(view.hasSecret, true)
  assert.equal(view.insecureTls, true)
  assert.equal(view.refreshSeconds, 15)
  assert.equal(Object.hasOwn(view, 'secret'), false)
  assert.equal(JSON.stringify(view).includes('super-secret-token'), false)
})

test('saveSettings 以 grant 记录持久化，并保留被省略的旧 secret', async () => {
  const service = fakeCredentials()
  const first = await saveSettings(service, {
    url: 'https://am.example/',
    authMode: 'basic',
    username: 'alice',
    secret: 's3cret',
    refreshSeconds: 10,
  })
  assert.equal(first.hasSecret, true)
  assert.equal(service.record.kind, 'grant')
  assert.equal(service.record.payload.url, 'https://am.example/')
  assert.equal(service.record.payload.secret, 's3cret')

  const second = await saveSettings(service, {
    url: 'https://am.example',
    authMode: 'basic',
    username: 'alice',
    secret: '',
  })
  assert.equal(second.hasSecret, true)
  assert.equal(service.record.payload.secret, 's3cret')

  const third = await saveSettings(service, {
    url: 'https://am.example',
    authMode: 'basic',
    username: 'bob',
  })
  assert.equal(third.hasSecret, true)
  assert.equal(service.record.payload.secret, 's3cret')
  assert.equal(service.record.payload.username, 'bob')
})

test('authMode 为 none 时清空 secret 与 username', async () => {
  const service = fakeCredentials()
  await saveSettings(service, {
    url: 'https://am.example',
    authMode: 'basic',
    username: 'alice',
    secret: 's3cret',
  })
  const view = await saveSettings(service, { url: 'https://am.example', authMode: 'none' })
  assert.equal(view.hasSecret, false)
  assert.equal(service.record.payload.secret, undefined)
  assert.equal(service.record.payload.username, undefined)
})

test('authMode 为 none 时写入的 payload 不含 undefined，可被严格 JSON 校验', async () => {
  const service = strictCredentials()
  const view = await saveSettings(service, {
    url: 'http://am:9093',
    authMode: 'none',
    insecureTls: false,
    refreshSeconds: 30,
  })

  assert.equal(view.hasSecret, false)
  const payload = service.record.payload
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload)
  assert.deepEqual(Object.keys(payload).sort(), ['authMode', 'insecureTls', 'refreshSeconds', 'url'])
  assert.equal(Object.hasOwn(payload, 'username'), false)
  assert.equal(Object.hasOwn(payload, 'secret'), false)
  assert.equal(payload.secret, undefined)
  assert.equal(payload.username, undefined)
})

test('basic / bearer 带字符串 secret 时写入的 payload 仍严格可 JSON 校验', async () => {
  const service = strictCredentials()
  const basic = await saveSettings(service, {
    url: 'https://am.example',
    authMode: 'basic',
    username: 'alice',
    secret: 's3cret',
    refreshSeconds: 15,
  })
  assert.equal(basic.hasSecret, true)
  assert.equal(service.record.payload.username, 'alice')
  assert.equal(service.record.payload.secret, 's3cret')
  assert.deepEqual(JSON.parse(JSON.stringify(service.record.payload)), service.record.payload)

  const bearer = await saveSettings(service, {
    url: 'https://am.example',
    authMode: 'bearer',
    secret: 'token-123',
  })
  assert.equal(bearer.hasSecret, true)
  assert.equal(bearer.authMode, 'bearer')
  assert.equal(service.record.payload.secret, 'token-123')
  assert.equal(Object.hasOwn(service.record.payload, 'username'), false)
  assert.deepEqual(JSON.parse(JSON.stringify(service.record.payload)), service.record.payload)
})

test('refreshSeconds 被夹在 5–300 秒', async () => {
  const service = fakeCredentials()
  const low = await saveSettings(service, { url: 'https://am.example', authMode: 'none', refreshSeconds: 1 })
  assert.equal(low.refreshSeconds, 5)
  const high = await saveSettings(service, { url: 'https://am.example', authMode: 'none', refreshSeconds: 999 })
  assert.equal(high.refreshSeconds, 300)
  const invalid = await saveSettings(service, { url: 'https://am.example', authMode: 'none', refreshSeconds: 'nope' })
  assert.equal(invalid.refreshSeconds, 300)
})

test('saveSettings 拒绝非 http/https 绝对地址', async () => {
  const service = fakeCredentials()
  await assert.rejects(() => saveSettings(service, { url: '', authMode: 'none' }), /请填写 AlertManager 地址/)
  await assert.rejects(() => saveSettings(service, { url: 'ftp://am.example', authMode: 'none' }), /http\/https/)
  await assert.rejects(() => saveSettings(service, { url: 'not a url', authMode: 'none' }), /http\/https/)
})

test('saveSettings 拒绝非法鉴权方式', async () => {
  const service = fakeCredentials()
  await assert.rejects(
    () => saveSettings(service, { url: 'https://am.example', authMode: 'oauth' }),
    /鉴权方式/,
  )
})

test('normalizeSettings 与 DEFAULT_SETTINGS 对空输入一致', () => {
  const normalized = normalizeSettings(undefined)
  assert.equal(normalized.url, DEFAULT_SETTINGS.url)
  assert.equal(normalized.authMode, DEFAULT_SETTINGS.authMode)
  assert.equal(normalized.refreshSeconds, DEFAULT_SETTINGS.refreshSeconds)
  assert.equal(normalized.insecureTls, DEFAULT_SETTINGS.insecureTls)
})
