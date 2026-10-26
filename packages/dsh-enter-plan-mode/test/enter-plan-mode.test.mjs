// dsh-enter-plan-mode 的行为测试：命名、状态机文案、缺服务报错、重名兜底、
// 以及"工具定义符合 DSH 支持的 JSON Schema 子集"这几件事。
//
// 运行：node --test test/enter-plan-mode.test.mjs
//
// 这里测的是构建产物（../lib/*.js），与 dsh-enhancement 的做法一致：测的就是
// 真正会上 npm 的那份代码。所以先 `npm run build`。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PACKAGE_NAME,
  TOOL_NAME,
  TOOL_PREFIX,
  TOOL_SUFFIX,
  UPSTREAM_EQUIVALENT_NAME,
  createDefinition,
  describeResult,
  enterPlanMode,
  registerTool,
  resolvePlanModeService,
} from '../lib/plan-mode-tool.js'

// ---------------------------------------------------------------------------
// 命名
// ---------------------------------------------------------------------------

test('工具名 = <包名前缀>_<具体工具名>', () => {
  // 命名方案：前缀取包名归一化（- → _），后缀是该工具的具体能力名。
  assert.equal(PACKAGE_NAME, 'dsh-enter-plan-mode')
  assert.equal(TOOL_PREFIX, 'dsh_enter_plan_mode')
  assert.equal(TOOL_SUFFIX, 'enter_plan_mode')
  assert.equal(TOOL_NAME, 'dsh_enter_plan_mode_enter_plan_mode')
})

test('工具名由包名派生，而不是写死（改名不会脱节）', () => {
  assert.equal(TOOL_PREFIX, PACKAGE_NAME.replaceAll('-', '_'))
  assert.equal(TOOL_NAME, `${TOOL_PREFIX}_${TOOL_SUFFIX}`)
})

test('工具名不等于上游可能采用的对称名', () => {
  // 关键约束：裸名 enter_plan_mode 是 DSH 将来补对称工具时最可能选的名字
  // （现在常量就叫 EXIT_PLAN_MODE = "exit_plan_mode"），而 dsh-tools 对同层
  // 重名是同步 throw、先到先得。谁把 TOOL_NAME 改成裸名，这里先红。
  assert.notEqual(TOOL_NAME, UPSTREAM_EQUIVALENT_NAME)
  assert.equal(UPSTREAM_EQUIVALENT_NAME, 'enter_plan_mode')
  assert.ok(
    TOOL_NAME.startsWith(TOOL_PREFIX) && TOOL_PREFIX.startsWith('dsh_'),
    '工具名必须落在第三方命名空间里，否则会与上游未来工具撞车',
  )
})

test('工具名是合法的 snake_case 标识符，且长度在宿主上限内', () => {
  assert.match(TOOL_NAME, /^[a-z][a-z0-9_]*$/)
  assert.ok(!TOOL_NAME.includes('__'), '不应含双下划线：那是 MCP 命名空间的形状')
  // 无下划线开头的段（避免 abc_ 与 abc__x 之类边界）。
  assert.ok(!TOOL_NAME.endsWith('_'), '不应以下划线结尾')
  // DSH 的 MCP 桥接把工具名上限设成 64；本名 35 字符，留足余量。
  assert.ok(TOOL_NAME.length <= 64, `工具名过长（${TOOL_NAME.length} > 64）`)
})

// ---------------------------------------------------------------------------
// 工具定义形状
// ---------------------------------------------------------------------------

/**
 * 递归收集 schema 里出现过的关键字名。
 *
 * 两点讲究：
 *  - visited 只防环（记 schema 对象本身），关键字名单独收，混在一个 Set 里会把
 *    对象本身也当成关键字名报出来；
 *  - `properties` 的**键**是属性名而不是关键字，值才是子 schema；`enum` /
 *    `const` / `default` / `examples` 里是数据而不是 schema，都不许往里走。
 */
const SCHEMA_CHILD_KEYS = new Set(['items', 'oneOf'])
const DATA_KEYS = new Set(['enum', 'const', 'default', 'examples'])

function keywords(node, out = { keys: new Set(), visited: new Set() }) {
  if (node === null || typeof node !== 'object' || out.visited.has(node)) return out.keys
  out.visited.add(node)
  if (Array.isArray(node)) {
    for (const child of node) keywords(child, out)
    return out.keys
  }
  for (const [key, value] of Object.entries(node)) {
    out.keys.add(key)
    if (DATA_KEYS.has(key)) continue
    if (key === 'properties' && value !== null && typeof value === 'object') {
      // 属性名不是关键字；只有它们指向的子 schema 才参与收集。
      for (const child of Object.values(value)) keywords(child, out)
      continue
    }
    if (SCHEMA_CHILD_KEYS.has(key)) keywords(value, out)
  }
  return out.keys
}

test('工具定义只使用 DSH 支持的 JSON Schema 子集', () => {
  const definition = createDefinition({})
  // dsh-tools 的 assertSupportedJsonSchema 只接受这些关键字；多写一个
  // （比如 maximum / minLength / format）会在 register() 时抛 JsonSchemaError，
  // 插件加载就失败了。
  const allowed = new Set([
    'type', 'oneOf', 'properties', 'required', 'additionalProperties',
    'items', 'enum', 'const', 'description', 'title', 'default', 'examples',
  ])
  for (const key of keywords(definition.parameters)) {
    assert.ok(allowed.has(key), `parameters 里出现不支持的关键字 "${key}"`)
  }
  for (const key of keywords(definition.output.schema)) {
    assert.ok(allowed.has(key), `output.schema 里出现不支持的关键字 "${key}"`)
  }
})

test('定义必备字段齐全，且无参数', () => {
  const definition = createDefinition({})
  assert.equal(definition.name, TOOL_NAME)
  assert.equal(typeof definition.description, 'string')
  assert.ok(definition.description.length > 80, '描述要讲清何时用/何时不用')
  assert.deepEqual(definition.parameters, {
    type: 'object',
    properties: {},
    additionalProperties: false,
  })
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(typeof definition.execute, 'function')
  // 展示回调存在，Web UI 才有卡片标题可渲染。
  assert.equal(typeof definition.presentCall, 'function')
  assert.equal(typeof definition.presentResult, 'function')
})

test('output.schema 是 object 根，且 required 覆盖三个返回字段', () => {
  const { output } = createDefinition({})
  assert.equal(output.schema.type, 'object')
  assert.equal(output.schema.additionalProperties, false)
  assert.deepEqual([...output.schema.required].sort(), ['active', 'outcome', 'pending'])
  for (const [name, spec] of Object.entries(output.schema.properties)) {
    assert.ok(output.schema.required.includes(name), `${name} 未列入 required`)
    assert.ok(spec && typeof spec === 'object', `${name} 不是 schema 对象`)
  }
  assert.deepEqual(output.schema.properties.outcome.enum, [
    'committed', 'queued', 'cancelled', 'noop',
  ])
})


/**
 * 造一个最小的 cordis 式上下文：只有 `get(name)`。
 *
 * 刻意**不**提供属性访问（`ctx.planMode`）——真实 cordis 在未静态注入该服务时
 * 属性访问会抛 `cannot get property "planMode" without inject`，本插件据此改用
 * `get()`；这里复刻这个约束，防止实现退回去读属性。
 */
function fakeCtx(services) {
  const ctx = {
    get(name) {
      return services[name]
    },
    tools: { register: () => () => {}, get: () => undefined },
  }
  for (const key of Object.keys(services)) {
    Object.defineProperty(ctx, key, {
      get() {
        throw new Error(`cannot get property "${key}" without inject`)
      },
    })
  }
  return ctx
}

// ---------------------------------------------------------------------------
// enterPlanMode：调用行为
// ---------------------------------------------------------------------------

/** 造一个假的 planMode 服务，记录调用。 */
function fakePlanMode({ active = false, pending = false, outcome = 'committed' } = {}) {
  const calls = []
  return {
    calls,
    state: { active, pending },
    get() {
      return { ...this.state }
    },
    set(agent, want) {
      calls.push({ agent, want })
      return outcome
    },
  }
}

test('调用 set(agent, true) 把会话切进计划模式', () => {
  const planMode = fakePlanMode({ outcome: 'committed' })
  const agent = { id: 'a' }
  const result = enterPlanMode(planMode, agent)
  assert.deepEqual(planMode.calls, [{ agent, want: true }])
  assert.deepEqual(result, { outcome: 'committed', active: false, pending: false })
})

test('返回的是 set() 之后读取的状态，不是切换前的', () => {
  const planMode = fakePlanMode({ active: false, pending: true, outcome: 'queued' })
  // 模拟真实语义：queued 时已落盘状态仍是 false，但 pending 为 true。
  const result = enterPlanMode(planMode, {})
  assert.equal(result.active, false)
  assert.equal(result.pending, true)
  assert.equal(result.outcome, 'queued')
})

test('计划模式未加载时抛出可照做的报错，而不是假装成功', () => {
  for (const missing of [undefined, null]) {
    assert.throws(() => enterPlanMode(missing, {}), /plan mode is not available/)
  }
  // 报错要指出缺失的是哪个插件、以及替代手段。
  try {
    enterPlanMode(undefined, {})
    assert.fail('应当抛出')
  } catch (error) {
    assert.match(error.message, /dsh-plan-mode/)
    assert.match(error.message, /\/plan/)
  }
})

test('没有 agent 时抛出明确错误（无会话可切换）', () => {
  const planMode = fakePlanMode()
  for (const missing of [undefined, null]) {
    assert.throws(() => enterPlanMode(planMode, missing), /requires a calling agent/)
  }
  // 不应在报错前就动了状态。
  assert.equal(planMode.calls.length, 0)
})

// ---------------------------------------------------------------------------
// describeResult：文案不能撒谎
// ---------------------------------------------------------------------------

test('已生效时告知已进入，并要求走 exit_plan_mode 提交方案', () => {
  const text = describeResult({ outcome: 'committed', active: true, pending: false })
  assert.match(text, /plan mode is active/i)
  assert.match(text, /exit_plan_mode/)
  assert.doesNotMatch(text, /not switched on/i)
})

test('待生效时如实说"从下一步开始生效"，不谎称已激活', () => {
  const text = describeResult({ outcome: 'queued', active: false, pending: true })
  assert.match(text, /next step/i)
  // 关键：不能出现"已激活"的说法。
  assert.doesNotMatch(text, /is active for this session/i)
})

test('noop + pending 走待生效文案，而不是"本来就在"', () => {
  // 这是真实会出现的组合：同一轮里重复调用，set() 返回 noop，
  // 但已落盘状态仍是 false、pending 仍是 true。
  const text = describeResult({ outcome: 'noop', active: false, pending: true })
  assert.match(text, /next step/i)
  assert.doesNotMatch(text, /is active for this session/i)
})

test('noop + 已激活时才说本来就在', () => {
  const text = describeResult({ outcome: 'noop', active: true, pending: false })
  assert.match(text, /plan mode is active/i)
})

test('cancelled 且未生效时如实说没切成，不骗模型', () => {
  const text = describeResult({ outcome: 'cancelled', active: false, pending: false })
  assert.match(text, /not switched on/i)
})

test('所有结果文案都包含 exit_plan_mode 指引', () => {
  for (const outcome of ['committed', 'queued', 'cancelled', 'noop']) {
    for (const active of [true, false]) {
      for (const pending of [true, false]) {
        const text = describeResult({ outcome, active, pending })
        assert.ok(text.length > 0, `${outcome}/${active}/${pending} 文案为空`)
        assert.equal(typeof text, 'string')
        assert.match(text, /exit_plan_mode/, `${outcome}/${active}/${pending} 缺提交指引`)
      }
    }
  }
})

// ---------------------------------------------------------------------------
// registerTool：重名兜底
// ---------------------------------------------------------------------------

/** 造一个假的 tools 注册表。 */
function fakeTools({ fail } = {}) {
  const registered = []
  return {
    registered,
    register(definition) {
      if (fail !== undefined) throw fail
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    get() {
      return undefined
    },
  }
}

test('正常注册返回可用的撤销函数', () => {
  const tools = fakeTools()
  const dispose = registerTool(tools, { name: TOOL_NAME })
  assert.equal(tools.registered.length, 1)
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(tools.registered.length, 0)
})

test('重名时返回 undefined 并留一条可诊断的 warning，不抛', () => {
  const warnings = []
  const tools = fakeTools({
    fail: new Error(`tool "${TOOL_NAME}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)`),
  })
  const dispose = registerTool(tools, { name: TOOL_NAME }, { warn: (...args) => warnings.push(args.join(' ')) })
  assert.equal(dispose, undefined)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /already registered/)
  // warning 要能定位到插件，否则日志里一堆重名分不清谁。
  assert.match(warnings[0], /dsh-enter-plan-mode/)
})

test('非重名的注册错误照常抛出（定义写错要响亮失败）', () => {
  const tools = fakeTools({ fail: new Error('schema.oneOf must be an array of at least two schemas') })
  assert.throws(() => registerTool(tools, { name: TOOL_NAME }), /oneOf/)
})

test('没有 logger 时重名也不崩', () => {
  const tools = fakeTools({ fail: new Error(`tool "${TOOL_NAME}" is already registered`) })
  assert.equal(registerTool(tools, { name: TOOL_NAME }), undefined)
})

// ---------------------------------------------------------------------------
// execute：串联到宿主服务
// ---------------------------------------------------------------------------

test('execute 从 agent 作用域解析 planMode（web profile 的唯一可行路径）', async () => {
  const planMode = fakePlanMode({ outcome: 'committed' })
  const agent = { id: 'agent-1', ctx: fakeCtx({ planMode }) }
  // 插件自身的上下文里没有这个服务——这正是 dsh-web-app 的真实形态。
  const definition = createDefinition(fakeCtx({}))
  const result = await definition.execute(undefined, { agent })
  assert.deepEqual(planMode.calls, [{ agent, want: true }])
  assert.equal(result.outcome, 'committed')
})

test('agent 作用域没有时回退到插件上下文（headless 等宿主平面部署）', async () => {
  const planMode = fakePlanMode({ outcome: 'committed' })
  const definition = createDefinition(fakeCtx({ planMode }))
  const result = await definition.execute(undefined, { agent: { id: 'a', ctx: fakeCtx({}) } })
  assert.equal(result.outcome, 'committed')
  assert.equal(planMode.calls.length, 1)
})

test('execute 在两处都没有 planMode 时抛出，而不是静默成功', async () => {
  const definition = createDefinition(fakeCtx({}))
  await assert.rejects(
    () => definition.execute(undefined, { agent: { ctx: fakeCtx({}) } }),
    /plan mode is not available/,
  )
})

test('render 把结果翻成文本块', () => {
  const { output } = createDefinition({})
  const blocks = output.render(undefined, { outcome: 'committed', active: true, pending: false })
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /exit_plan_mode/)
})

// ---------------------------------------------------------------------------
// resolvePlanModeService：作用域解析顺序（本插件最容易写错的地方）
// ---------------------------------------------------------------------------

test('优先用 agent 作用域，插件上下文有也不抢', () => {
  const fromAgent = fakePlanMode()
  const fromPlugin = fakePlanMode()
  const picked = resolvePlanModeService(fakeCtx({ planMode: fromPlugin }), { ctx: fakeCtx({ planMode: fromAgent }) })
  assert.equal(picked, fromAgent)
})

test('agent 作用域没有时回退到插件上下文', () => {
  const fromPlugin = fakePlanMode()
  const picked = resolvePlanModeService(fakeCtx({ planMode: fromPlugin }), { ctx: fakeCtx({}) })
  assert.equal(picked, fromPlugin)
})

test('两处都没有时返回 undefined', () => {
  assert.equal(resolvePlanModeService(fakeCtx({}), { ctx: fakeCtx({}) }), undefined)
})

test('永不通过属性访问读服务（真实 cordis 会因此抛错）', () => {
  // fakeCtx 对已注册服务的属性访问是抛错的；能拿到值就说明实现走的是 get()。
  const planMode = fakePlanMode()
  assert.doesNotThrow(() => resolvePlanModeService(fakeCtx({ planMode }), {}))
})

test('服务结构不对（缺 get/set）时视为不可用，不交给调用点乱用', () => {
  for (const bogus of [{}, { get() {} }, { set() {} }, null, 'nope', 42]) {
    assert.equal(resolvePlanModeService(fakeCtx({ planMode: bogus }), {}), undefined, `${JSON.stringify(bogus)} 被误当成服务`)
  }
})

test('取值抛错时吞掉并降级为不可用（工具报错比崩进程好）', () => {
  const throwing = {
    get() {
      throw new Error('service container disposed')
    },
  }
  assert.equal(resolvePlanModeService(throwing, {}), undefined)
})

test('agent 缺失/形状异常时安全降级', () => {
  const planMode = fakePlanMode()
  for (const agent of [undefined, null, {}, { ctx: null }, { ctx: 42 }]) {
    assert.equal(resolvePlanModeService(fakeCtx({ planMode }), agent), planMode)
  }
})
