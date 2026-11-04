import assert from 'node:assert/strict'
import test from 'node:test'
import { createAlertsStore, countsOf } from '../lib/store.js'

/**
 * 核心 store 的行为约定（用假 deps 驱动，不依赖 DOM/网络）：
 * 数据驱动、自动刷新排程唯一、手动/自动区分、取消、失败保留旧数据。
 */
function makeStore(overrides = {}) {
  const timers = []
  let alerts = {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    instances: [{ id: 'a', name: 'A' }],
    alerts: [
      { fingerprint: 'f1', severity: 'critical', state: 'active' },
      { fingerprint: 'f2', severity: 'warning', state: 'suppressed' },
    ],
  }
  const calls = []
  const deps = {
    request: async (path) => {
      calls.push(path)
      if (path === '/settings') return { instances: [{ id: 'a' }] }
      if (path === '/alerts') {
        if (alerts instanceof Error) throw alerts
        return alerts
      }
      throw new Error(`unexpected ${path}`)
    },
    readInterval: () => '5s',
    writeInterval: () => {},
    isAbort: (error) => error !== null && typeof error === 'object' && error.name === 'AbortError',
    now: () => 1000,
    setTimeout: (fn, ms) => {
      const handle = { fn, ms, cleared: false }
      timers.push(handle)
      return handle
    },
    clearTimeout: (handle) => {
      if (handle !== null && typeof handle === 'object') handle.cleared = true
    },
    isHidden: () => false,
    ...overrides,
  }
  const store = createAlertsStore(deps)
  return {
    store,
    timers,
    calls,
    setAlerts(next) {
      alerts = next
    },
  }
}

test('countsOf 按严重度与状态统计', () => {
  const counts = countsOf({
    fetchedAt: '',
    instances: [{ id: 'a', name: 'A' }],
    alerts: [
      { fingerprint: '1', severity: 'critical', state: 'active' },
      { fingerprint: '2', severity: 'warning', state: 'suppressed' },
      { fingerprint: '3', severity: 'info', state: 'unprocessed' },
      { fingerprint: '4', severity: 'nope', state: 'active' },
    ],
  })
  assert.equal(counts.total, 4)
  assert.equal(counts.critical, 1)
  assert.equal(counts.warning, 1)
  assert.equal(counts.info, 1)
  assert.equal(counts.other, 1)
  assert.equal(counts.active, 2)
  assert.equal(counts.suppressed, 1)
  assert.equal(counts.unprocessed, 1)
  assert.equal(counts.configured, true)
})

test('bootstrap 一次加载后状态为 ready 且计数就绪', async () => {
  const { store } = makeStore()
  await store.bootstrap()
  const state = store.snapshot()
  assert.equal(state.phase, 'ready')
  assert.equal(state.payload.alerts.length, 2)
  assert.equal(state.counts.total, 2)
  assert.equal(state.counts.critical, 1)
  assert.equal(state.fetchedAt, '2026-01-01T00:00:00.000Z')
})

test('加载完成后自动排程下一次刷新（默认 5s，只有一个计时器）', async () => {
  const { store, timers } = makeStore()
  await store.bootstrap()
  const pending = timers.filter((timer) => !timer.cleared)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].ms, 5000)
  assert.ok(store.snapshot().nextAt > 0)
})

test('手动刷新会置 manualLoading，结束后复位并重新排程', async () => {
  const { store, timers } = makeStore()
  await store.bootstrap()
  const promise = store.load({ manual: true })
  assert.equal(store.snapshot().manualLoading, true)
  await promise
  assert.equal(store.snapshot().manualLoading, false)
  assert.equal(store.snapshot().loading, false)
  assert.equal(timers.filter((timer) => !timer.cleared).length, 1)
})

test('并发时不静默丢弃：第二次刷新以尾随方式补发一次', async () => {
  const { store, calls } = makeStore()
  await store.bootstrap()
  const before = calls.filter((path) => path === '/alerts').length
  await Promise.all([store.load({ manual: true }), store.load({ manual: true })])
  const after = calls.filter((path) => path === '/alerts').length
  // 第一次真正执行，第二次排队，结束后补发一次 → 共 2 次，而不是被吞掉 1 次
  assert.equal(after - before, 2)
  assert.equal(store.snapshot().manualLoading, false)
})

test('服务端报 alerts.not-configured 时清空数据进入未配置态', async () => {
  const { store } = makeStore({
    request: async (path) => {
      if (path === '/settings') return { instances: [{ id: 'a' }] }
      const error = new Error('not configured')
      error.code = 'alerts.not-configured'
      throw error
    },
  })
  await store.bootstrap()
  const state = store.snapshot()
  assert.equal(state.phase, 'unconfigured')
  assert.equal(state.payload, null)
  assert.equal(state.counts.total, 0)
  assert.equal(state.selected.size, 0)
})

test('saveSettings 清空实例后立即清零并停止排程', async () => {
  const { store, timers } = makeStore({
    request: async (path, init) => {
      if (path === '/settings') {
        if (init?.method === 'POST') return { instances: [] }
        return { instances: [{ id: 'a' }] }
      }
      return { fetchedAt: 't', instances: [{ id: 'a', name: 'A' }], alerts: [{ fingerprint: 'f', severity: 'critical', state: 'active' }] }
    },
  })
  await store.bootstrap()
  assert.equal(store.snapshot().counts.total, 1)
  await store.saveSettings({ instances: [] })
  const state = store.snapshot()
  assert.equal(state.phase, 'unconfigured')
  assert.equal(state.payload, null)
  assert.equal(state.counts.total, 0)
  assert.equal(state.counts.configured, false)
  assert.equal(state.nextAt, 0)
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0)
})

test('dispose 后不再发起请求与排程', async () => {
  const { store, calls, timers } = makeStore()
  await store.bootstrap()
  store.dispose()
  const before = calls.length
  await store.load({ manual: true })
  assert.equal(calls.length, before)
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0)
})

test('切换到 off 取消排程，改回 5s 恢复', async () => {
  const { store, timers } = makeStore()
  await store.bootstrap()
  store.setIntervalKey('off')
  assert.equal(store.snapshot().nextAt, 0)
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0)
  store.setIntervalKey('5s')
  // ready 状态下切回 5s 会立即重新排程
  assert.equal(store.snapshot().nextAt, 6000)
  assert.equal(timers.filter((timer) => !timer.cleared).length, 1)
})

test('失败时保留旧数据且不退回错误页', async () => {
  const ctx = makeStore()
  await ctx.store.bootstrap()
  const previous = ctx.store.snapshot().payload
  ctx.setAlerts(new Error('boom'))
  await ctx.store.load({ manual: true })
  assert.equal(ctx.store.snapshot().phase, 'ready')
  assert.equal(ctx.store.snapshot().payload, previous)
  assert.ok(ctx.store.snapshot().error !== null)
})

test('取消请求置 cancelled 且不写入错误', async () => {
  const { store } = makeStore({
    request: async (path) => {
      if (path === '/settings') return { instances: [{ id: 'a' }] }
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    },
  })
  await store.bootstrap()
  await store.load({ manual: true })
  assert.equal(store.snapshot().cancelled, true)
  assert.equal(store.snapshot().error, null)
})

test('未配置实例时为 unconfigured，且不排程自动刷新', async () => {
  const { store, timers } = makeStore({
    request: async () => ({ instances: [] }),
  })
  await store.bootstrap()
  assert.equal(store.snapshot().phase, 'unconfigured')
  assert.equal(store.snapshot().counts.total, 0)
  assert.equal(timers.filter((timer) => !timer.cleared).length, 0)
})

test('选中集合更新与替换语义', async () => {
  const { store } = makeStore()
  store.updateSelected((current) => new Set([...current, 'k1']))
  assert.deepEqual([...store.snapshot().selected], ['k1'])
  const same = store.snapshot().selected
  store.updateSelected((current) => new Set(current))
  assert.equal(store.snapshot().selected, same, '内容相同的集合不应触发新引用')
})
