// dsh-plan-tab-autoclose · 自动关闭核心逻辑行为测试
//
// 运行：node --test test/autoclose.test.mjs
// 覆盖：isPlanActive / collectPlanTabIds / 多轮计划标签一次全关 /
//       kind 与会话过滤 / 保持 active 不关 / 初始 false 不关 /
//       binding 晚到重试 / dispose 后不再动作且退订。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tsc 的客户端构建产物是 CommonJS（package.json 自身是 type:module），
// 直接 import 会按 ESM 解析而报 "exports is not defined"。给 .client-build
// 放一个 type:commonjs 标记后，ESM 可按 CJS 互操作导入（命名导出由语法分析得出）。
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '..', '.client-build', 'package.json'), '{"type":"commonjs"}\n')

const { isPlanActive, collectPlanTabIds, closePlanTabs, installPlanTabAutoclose } = await import(
  '../.client-build/autoclose.js'
)

/** 可手动 set 的假快照。 */
function makeSnapshot(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    /** 测试用：更新值并通知所有订阅者。 */
    set(next) {
      value = next
      for (const callback of [...listeners]) callback()
    },
    listenerCount: () => listeners.size,
  }
}

/** 假 ctx：mounted/openTabs/list/plan 均可手动 set，closeIn 记录到数组。 */
function makeCtx() {
  const mounted = makeSnapshot(undefined)
  const openTabs = makeSnapshot([])
  const list = makeSnapshot({ ids: [] })
  const closed = []
  const bindings = new Map()
  const ctx = {
    sessions: {
      binding: (id) => bindings.get(id),
      list,
    },
    sidebarRight: {
      mounted,
      openTabs,
      closeIn: (sessionId, tabId) => {
        closed.push({ sessionId, tabId })
      },
    },
    effect: () => {},
    logger: { warn: () => {} },
    // 测试辅助（非插件契约）
    _mounted: mounted,
    _openTabs: openTabs,
    _list: list,
    _closed: closed,
    _bindings: bindings,
  }
  return ctx
}

/** 假会话绑定：faceOf('plan') 返回给定快照。 */
function makeBinding(planSnapshot) {
  return {
    session: {
      projections: {
        faceOf: (key) => (key === 'plan' ? planSnapshot : undefined),
      },
    },
  }
}

/** 造一个打开标签。 */
function tab(sessionId, tabId, kind = 'plan') {
  return { sessionId, tabId, kind, contentId: `content-${tabId}` }
}

test('isPlanActive：仅 active===true 视为计划模式开启', () => {
  assert.equal(isPlanActive({ active: true }), true)
  assert.equal(isPlanActive({ active: true, pending: true }), true)
  assert.equal(isPlanActive({ active: false }), false)
  assert.equal(isPlanActive({ pending: true }), false)
  assert.equal(isPlanActive(undefined), false)
  assert.equal(isPlanActive(null), false)
  assert.equal(isPlanActive('true'), false)
  assert.equal(isPlanActive(42), false)
})

test('collectPlanTabIds：只挑同会话且 kind=plan 的标签', () => {
  const tabs = [
    tab('s1', 'a'),
    tab('s1', 'b'),
    tab('s1', 'files-1', 'files'),
    tab('s2', 'd'),
    tab('s1', 'e'),
  ]
  assert.deepEqual(collectPlanTabIds(tabs, 's1'), ['a', 'b', 'e'])
  assert.deepEqual(collectPlanTabIds(tabs, 's2'), ['d'])
  assert.deepEqual(collectPlanTabIds(tabs, 'nope'), [])
})

test('单会话多个计划标签：false→true→false 后一次关闭全部，且不动其它标签', () => {
  const ctx = makeCtx()
  const plan = makeSnapshot({ active: false })
  ctx._bindings.set('s1', makeBinding(plan))
  ctx._mounted.set('s1')
  ctx._openTabs.set([
    tab('s1', 'plan-1'), // 第一轮
    tab('s1', 'plan-2'), // 第二轮修订
    tab('s1', 'plan-3'), // 第三轮修订
    tab('s1', 'files-1', 'files'), // 非计划标签
    tab('s2', 'plan-other'), // 别的会话的计划标签
  ])

  const dispose = installPlanTabAutoclose(ctx)
  try {
    plan.set({ active: true })
    plan.set({ active: false })
  } finally {
    dispose()
  }

  assert.deepEqual(ctx._closed, [
    { sessionId: 's1', tabId: 'plan-1' },
    { sessionId: 's1', tabId: 'plan-2' },
    { sessionId: 's1', tabId: 'plan-3' },
  ])
})

test('保持 active（只真不假）：不关闭任何标签', () => {
  const ctx = makeCtx()
  const plan = makeSnapshot({ active: false })
  ctx._bindings.set('s1', makeBinding(plan))
  ctx._mounted.set('s1')
  ctx._openTabs.set([tab('s1', 'plan-1')])

  const dispose = installPlanTabAutoclose(ctx)
  try {
    plan.set({ active: true })
    // 没有回落
  } finally {
    dispose()
  }

  assert.deepEqual(ctx._closed, [])
})

test('初始即 false 且从未 active：不关闭任何标签', () => {
  const ctx = makeCtx()
  const plan = makeSnapshot({ active: false })
  ctx._bindings.set('s1', makeBinding(plan))
  ctx._mounted.set('s1')
  ctx._openTabs.set([tab('s1', 'plan-1')])

  const dispose = installPlanTabAutoclose(ctx)
  try {
    plan.set({ active: false }) // 重复通知，仍非 active
  } finally {
    dispose()
  }

  assert.deepEqual(ctx._closed, [])
})

test('binding 晚到：sessions.list 触发重试后可正常自动关闭', () => {
  const ctx = makeCtx()
  const plan = makeSnapshot({ active: false })
  // 先 mounted，但 binding 尚不可用
  ctx._mounted.set('s1')
  ctx._openTabs.set([tab('s1', 'plan-1'), tab('s1', 'plan-2'), tab('s1', 'plan-3')])

  const dispose = installPlanTabAutoclose(ctx)
  try {
    // 尚未物化时应无订阅，切换不误关
    plan.set({ active: true })
    plan.set({ active: false })
    assert.deepEqual(ctx._closed, [])

    // 会话物化：binding 可用，session 列表变化触发重试
    ctx._bindings.set('s1', makeBinding(plan))
    ctx._list.set({ ids: ['s1'] })

    plan.set({ active: true })
    plan.set({ active: false })
  } finally {
    dispose()
  }

  assert.deepEqual(ctx._closed, [
    { sessionId: 's1', tabId: 'plan-1' },
    { sessionId: 's1', tabId: 'plan-2' },
    { sessionId: 's1', tabId: 'plan-3' },
  ])
})

test('dispose 后再变化：不再调用 closeIn，且所有订阅被退订', () => {
  const ctx = makeCtx()
  const plan = makeSnapshot({ active: false })
  ctx._bindings.set('s1', makeBinding(plan))
  ctx._mounted.set('s1')
  ctx._openTabs.set([tab('s1', 'plan-1')])

  const dispose = installPlanTabAutoclose(ctx)
  // 安装后订阅已建立
  assert.ok(plan.listenerCount() > 0)
  assert.ok(ctx._mounted.listenerCount() > 0)
  assert.ok(ctx._list.listenerCount() > 0)

  dispose()

  assert.equal(plan.listenerCount(), 0)
  assert.equal(ctx._mounted.listenerCount(), 0)
  assert.equal(ctx._list.listenerCount(), 0)

  plan.set({ active: true })
  plan.set({ active: false })
  ctx._mounted.set('s2') // 触发 mounted 订阅（若未退订）
  ctx._list.set({ ids: ['s2'] })

  assert.deepEqual(ctx._closed, [])
})

test('closePlanTabs：逐项容错，closeIn 抛错时其余照关并记录 warn', () => {
  const ctx = makeCtx()
  const warnings = []
  ctx.logger.warn = (...args) => warnings.push(args.join(' '))
  ctx._openTabs.set([tab('s1', 'plan-1'), tab('s1', 'plan-2'), tab('s1', 'plan-3')])
  let call = 0
  ctx.sidebarRight.closeIn = (sessionId, tabId) => {
    call += 1
    if (tabId === 'plan-2') throw new Error('boom')
    ctx._closed.push({ sessionId, tabId })
  }

  const closed = closePlanTabs(ctx, 's1')
  assert.equal(closed, 2)
  assert.deepEqual(ctx._closed, [
    { sessionId: 's1', tabId: 'plan-1' },
    { sessionId: 's1', tabId: 'plan-3' },
  ])
  assert.equal(call, 3)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /plan-2/)
})
