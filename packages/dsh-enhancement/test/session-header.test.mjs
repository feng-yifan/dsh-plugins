// 会话请求头注入的行为测试：注入/透传/开关/头名/多实例隔离/冻结入参/漂移防御。
//
// 运行：node --test test/session-header.test.mjs
// 覆盖的注入点与真实宿主一致：adapter 原型上的 streamWithSnapshot(options, snapshot)，
// 其中 snapshot.models.streamSimple(model, context, options) 是 options 交给 pi-ai 的入口。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SESSION_HEADER_NAME,
  injectSessionHeader,
  mountSessionHeader,
  normalizeHeaderName,
  patchAdapterPrototype,
  restorePrototypes,
  sweepAdapters,
} from '../lib/session-header.js'

const ON = { enabled: true, headerName: DEFAULT_SESSION_HEADER_NAME }
const OFF = { enabled: false, headerName: DEFAULT_SESSION_HEADER_NAME }

/** 复刻官方 pi-ai adapter 形态：stream/streamWithSnapshot + snapshot.models.streamSimple。 */
function makeHost() {
  const consumed = []
  const models = {
    streamSimple: (model, context, options) => {
      consumed.push({ model, context, options })
      return 'stream'
    },
  }
  class Adapter {
    stream(options) {
      return this.streamWithSnapshot(options, { models })
    }
    // eslint-disable-next-line require-yield
    async *streamWithSnapshot(options, snapshot) {
      return snapshot.models.streamSimple({ id: 'm', api: 'openai-completions' }, [], options)
    }
  }
  // eslint-disable-next-line require-yield
  function* _unused() {}
  return { Adapter, models, consumed }
}

/** 与真实 adapter 一致的同步形态（streamWithSnapshot 直接返回 streamSimple 结果）。 */
function makeSyncHost() {
  const consumed = []
  const models = {
    streamSimple: (model, context, options) => {
      consumed.push({ model, context, options })
      return 'stream'
    },
  }
  class Adapter {
    streamWithSnapshot(options, snapshot) {
      return snapshot.models.streamSimple({ id: 'm', api: 'openai-completions' }, [], options)
    }
    stream(options) {
      return this.streamWithSnapshot(options, { models })
    }
  }
  return { Adapter, models, consumed }
}

test('开启时把 sessionId 注入为默认头（与 DeepSeek 官方同名）', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const adapter = new Adapter()
  assert.equal(patchAdapterPrototype(adapter, () => ON, () => true), true)
  adapter.stream({ sessionId: 'session-abc' })
  assert.equal(consumed.at(-1).options.headers[DEFAULT_SESSION_HEADER_NAME], 'session-abc')
  restorePrototypes()
})

test('默认头名与 DeepSeek 官方发送的完全一致', () => {
  assert.equal(DEFAULT_SESSION_HEADER_NAME, 'x-deepseek-harness-session-id')
})

test('关闭时纯透传，不加任何头', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const adapter = new Adapter()
  patchAdapterPrototype(adapter, () => OFF, () => true)
  adapter.stream({ sessionId: 'session-abc' })
  assert.equal(consumed.at(-1).options.headers, undefined)
  restorePrototypes()
})

test('头名可改', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const adapter = new Adapter()
  patchAdapterPrototype(adapter, () => ({ enabled: true, headerName: 'x-my-session' }), () => true)
  adapter.stream({ sessionId: 'sid-1' })
  assert.equal(consumed.at(-1).options.headers['x-my-session'], 'sid-1')
  assert.equal(consumed.at(-1).options.headers[DEFAULT_SESSION_HEADER_NAME], undefined)
  restorePrototypes()
})

test('缺 sessionId 时透传，不注入空值', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const adapter = new Adapter()
  patchAdapterPrototype(adapter, () => ON, () => true)
  adapter.stream({})
  assert.equal(consumed.at(-1).options.headers, undefined)
  restorePrototypes()
})

test('已有同名头（大小写不敏感）时不覆盖用户配置', () => {
  const injected = injectSessionHeader({ sessionId: 'sid', headers: { 'X-Session-Id': 'preset' } }, {
    enabled: true,
    headerName: 'x-session-id',
  })
  assert.equal(injected.headers['X-Session-Id'], 'preset')
  assert.equal(Object.keys(injected.headers).length, 1)
})

test('保留调用方已有的其它头', () => {
  const injected = injectSessionHeader(
    { sessionId: 'sid', headers: { 'x-other': 'keep', 'user-agent': 'ua' } },
    ON,
  )
  assert.equal(injected.headers['x-other'], 'keep')
  assert.equal(injected.headers['user-agent'], 'ua')
  assert.equal(injected.headers[DEFAULT_SESSION_HEADER_NAME], 'sid')
})

test('深冻结的 options 不被改写，返回新对象', () => {
  const options = Object.freeze({ sessionId: 'sid', headers: Object.freeze({ 'x-a': '1' }) })
  const injected = injectSessionHeader(options, ON)
  assert.notEqual(injected, options)
  assert.equal(options.headers[DEFAULT_SESSION_HEADER_NAME], undefined)
  assert.equal(injected.headers[DEFAULT_SESSION_HEADER_NAME], 'sid')
  assert.equal(injected.headers['x-a'], '1')
})

test('冻结的 models 不触发 Proxy 不变量错误', () => {
  restorePrototypes()
  const consumed = []
  // 真实风险点：snapshot.models 被冻结时，若用 Proxy 改写 streamSimple 会抛 TypeError 不变量错误。
  const frozenModels = Object.freeze({
    streamSimple: (model, context, options) => {
      consumed.push({ options })
      return 'stream'
    },
  })
  class Adapter {
    // 走补丁路径：snapshot 携带冻结的 models
    stream(options) {
      return this.streamWithSnapshot(options, { models: frozenModels })
    }
    streamWithSnapshot(options, snapshot) {
      return snapshot.models.streamSimple({ id: 'm' }, [], options)
    }
  }
  const adapter = new Adapter()
  patchAdapterPrototype(adapter, () => ON, () => true)
  assert.doesNotThrow(() => adapter.stream({ sessionId: 'sid-frozen' }))
  assert.equal(consumed.at(-1).options.headers[DEFAULT_SESSION_HEADER_NAME], 'sid-frozen')
  // 原冻结 models 未被改动
  assert.equal(frozenModels.streamSimple.name, 'streamSimple')
  restorePrototypes()
})

test('同一原型的多个实例互不串扰：只给登记过的实例注入', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const registered = new Adapter()
  const stranger = new Adapter()
  patchAdapterPrototype(registered, () => ON, () => true)
  stranger.stream({ sessionId: 'sid-stranger' })
  assert.equal(consumed.at(-1).options.headers, undefined)
  registered.stream({ sessionId: 'sid-registered' })
  assert.equal(consumed.at(-1).options.headers[DEFAULT_SESSION_HEADER_NAME], 'sid-registered')
  restorePrototypes()
})

test('isActive 为 false 时透传（卸载后不再注入）', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const adapter = new Adapter()
  let active = true
  patchAdapterPrototype(adapter, () => ON, () => active)
  adapter.stream({ sessionId: 'sid' })
  assert.equal(consumed.at(-1).options.headers[DEFAULT_SESSION_HEADER_NAME], 'sid')
  active = false
  adapter.stream({ sessionId: 'sid' })
  assert.equal(consumed.at(-1).options.headers, undefined)
  restorePrototypes()
})

test('设置热更新：每次请求重新求值', () => {
  restorePrototypes()
  const { Adapter, consumed } = makeSyncHost()
  const adapter = new Adapter()
  let settings = { enabled: false, headerName: DEFAULT_SESSION_HEADER_NAME }
  patchAdapterPrototype(adapter, () => settings, () => true)
  adapter.stream({ sessionId: 'sid' })
  assert.equal(consumed.at(-1).options.headers, undefined)
  settings = { enabled: true, headerName: 'x-live' }
  adapter.stream({ sessionId: 'sid' })
  assert.equal(consumed.at(-1).options.headers['x-live'], 'sid')
  restorePrototypes()
})

test('restorePrototypes 之后原始方法复原', () => {
  restorePrototypes()
  const { Adapter } = makeSyncHost()
  const proto = Adapter.prototype
  const original = proto.streamWithSnapshot
  patchAdapterPrototype(new Adapter(), () => ON, () => true)
  assert.notEqual(proto.streamWithSnapshot, original)
  restorePrototypes()
  assert.equal(proto.streamWithSnapshot, original)
})

test('版本漂移：原型上没有 streamWithSnapshot 时旁路，不抛错', () => {
  class NotPiAi {
    stream() {
      return 'plain'
    }
  }
  assert.equal(patchAdapterPrototype(new NotPiAi(), () => ON, () => true), false)
})

test('sweepAdapters: 非 Map 的 adapters 返回 0（漂移防御）', () => {
  assert.equal(sweepAdapters({ adapters: {} }, () => ON, () => true), 0)
  assert.equal(sweepAdapters({}, () => ON, () => true), 0)
})

test('sweepAdapters: 只补丁 pi-ai 型 adapter，官方形态不动', () => {
  restorePrototypes()
  const { Adapter } = makeSyncHost()
  class OfficialAdapter {
    stream() {
      return 'official'
    }
  }
  const pi = new Adapter()
  const official = new OfficialAdapter()
  const adapters = new Map([
    ['magpie', { provider: { id: 'magpie' }, adapter: pi }],
    ['deepseek-official', { provider: { id: 'deepseek-official' }, adapter: official }],
  ])
  assert.equal(sweepAdapters({ adapters }, () => ON, () => true), 1)
  assert.equal(official.stream(), 'official')
  restorePrototypes()
})

test('头名校验：非法名回退默认值', () => {
  assert.equal(normalizeHeaderName('x-ok'), 'x-ok')
  assert.equal(normalizeHeaderName('  x-trim  '), 'x-trim')
  assert.equal(normalizeHeaderName('bad header'), DEFAULT_SESSION_HEADER_NAME)
  assert.equal(normalizeHeaderName('bad\nheader'), DEFAULT_SESSION_HEADER_NAME)
  assert.equal(normalizeHeaderName(''), DEFAULT_SESSION_HEADER_NAME)
  assert.equal(normalizeHeaderName(undefined), DEFAULT_SESSION_HEADER_NAME)
  assert.equal(normalizeHeaderName(123), DEFAULT_SESSION_HEADER_NAME)
})

test('mountSessionHeader: 无 llm 服务时旁路并记录原因', () => {
  const status = mountSessionHeader(
    { webServer: { host: '127.0.0.1', port: 0, protocol: 'http', getOrigin: () => '', register: () => () => {} }, get: () => undefined },
    () => ON,
  ).status()
  assert.equal(status.patched, 0)
  assert.equal(status.reason, 'llm-unavailable')
  assert.equal(status.lastError, 'llm service unavailable')
})

test('mountSessionHeader: 事件补齐后注册的 adapter', () => {
  restorePrototypes()
  const { Adapter } = makeSyncHost()
  const listeners = new Map()
  const adapters = new Map()
  const llm = { adapters }
  const mount = mountSessionHeader(
    {
      webServer: { host: '127.0.0.1', port: 0, protocol: 'http', getOrigin: () => '', register: () => () => {} },
      get: (name) => (name === 'llm' ? llm : undefined),
      on: (event, listener) => {
        listeners.set(event, listener)
        return () => listeners.delete(event)
      },
    },
    () => ON,
  )
  const before = mount.status()
  assert.equal(before.patched, 0)
  // 关键：没有 adapter 时是「未配置路由」而不是故障
  assert.equal(before.reason, 'no-adapters')
  assert.equal(before.lastError, null)
  // 模拟宿主晚注册：先注册 adapter，再广播 adapters-updated
  const pi = new Adapter()
  adapters.set('magpie', { provider: { id: 'magpie' }, adapter: pi })
  listeners.get('llm/adapters-updated')()
  const after = mount.status()
  assert.equal(after.patched, 1)
  assert.equal(after.reason, 'ok')
  assert.equal(after.adapterCount, 1)
  assert.equal(after.lastError, null)
  mount.dispose()
  restorePrototypes()
})

test('models 是类实例时保留原型方法（回归：getModel is not a function）', () => {
  restorePrototypes()
  const consumed = []
  // 复刻 pi-ai ModelsImpl：streamSimple 在原型上，实例只持有状态字段。
  class ModelsImpl {
    providers = new Map()
    constructor() {
      this.marker = 'instance-field'
    }
    getModel(id) {
      return `model:${id}`
    }
    getProviders() {
      return [...this.providers.values()]
    }
    streamSimple(model, context, options) {
      consumed.push({ model, context, options, prototypeWorks: this.getModel('x') })
      return 'stream'
    }
  }
  const models = new ModelsImpl()
  class Adapter {
    stream(options) {
      return this.streamWithSnapshot(options, { models })
    }
    streamWithSnapshot(options, snapshot) {
      // 真实宿主会在同一个方法里调用多个原型方法
      snapshot.models.getProviders()
      return snapshot.models.streamSimple({ id: 'm' }, [], options)
    }
  }
  const adapter = new Adapter()
  patchAdapterPrototype(adapter, () => ON, () => true)
  assert.doesNotThrow(() => adapter.stream({ sessionId: 'sid-proto' }))
  assert.equal(consumed.at(-1).options.headers[DEFAULT_SESSION_HEADER_NAME], 'sid-proto')
  // 原型方法仍可用
  assert.equal(consumed.at(-1).prototypeWorks, 'model:x')
  restorePrototypes()
})

test('有 adapter 但都不是 pi-ai 形态时 reason=no-pi-ai-adapter', () => {
  restorePrototypes()
  class OfficialOnly {
    stream() {
      return 'official'
    }
  }
  const adapters = new Map([['deepseek-official', { provider: { id: 'deepseek-official' }, adapter: new OfficialOnly() }]])
  const mount = mountSessionHeader(
    {
      webServer: { host: '127.0.0.1', port: 0, protocol: 'http', getOrigin: () => '', register: () => () => {} },
      get: (name) => (name === 'llm' ? { adapters } : undefined),
    },
    () => ON,
  )
  const st = mount.status()
  assert.equal(st.patched, 0)
  assert.equal(st.adapterCount, 1)
  assert.equal(st.reason, 'no-pi-ai-adapter')
  assert.equal(st.lastError, null)
  mount.dispose()
})
