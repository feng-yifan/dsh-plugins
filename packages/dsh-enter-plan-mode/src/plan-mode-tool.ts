/**
 * dsh-enter-plan-mode · 工具定义与纯逻辑
 *
 * 本文件不 import 任何宿主包，因此可以在普通 node 进程里直接测（见
 * test/enter-plan-mode.test.mjs）——注册流程、重名兜底、结果文案都是纯函数。
 *
 * ## 为什么工具名带前缀
 *
 * DSH 内置的 `@deepseek-ai/dsh-plan-mode` 只提供**离开**计划模式的工具
 * （`exit_plan_mode`，常量为 `EXIT_PLAN_MODE`），进入方向的唯一入口是 `/plan`
 * 斜杠命令——那是给人用的，模型调不到。本插件补的正是"模型自己把会话切进
 * 计划模式"这个缺口。
 *
 * 也正因为这是补缺，最自然的名字就是 `enter_plan_mode`（与
 * `exit_plan_mode` 对称）。但**恰恰不能用它**：
 *
 *  1. 工具注册表 `@deepseek-ai/dsh-tools` 的 `register()` 落到
 *     `NamedEntries.insert()`，同层重名是同步 throw：
 *     `tool "<name>" is already registered ...`。没有"后注册者覆盖"或
 *     "自动改名"的兜底——**先注册的赢，后注册的 throw**（实测：两个插件抢同
 *     一个名字，稳定得到 `A: REGISTERED` / `B: THREW ...`）。
 *  2. 这个 throw 发生在 `apply()` 里，而 profile 里插入的插件行默认是
 *     **optional** 条目。按 app-boot 的启动失败表，optional 条目同步
 *     `apply()` throw 的处理是「警告；继续」——进程照常启动、退出码 0，只有
 *     一行 `dsh: warning: 1 entry did not activate`。
 *     更反直觉的是**谁倒下取决于加载顺序**：实测让自定义插件抢注册已被
 *     `plan-mode` 占用的 `exit_plan_mode`，结果是自定义插件注册成功、内置
 *     `plan-mode` 整行没激活。也就是说撞名不只可能让本插件的工具消失，还可能
 *     把上游计划模式功能整个顶掉，而界面看起来一切正常。
 *  3. `enter_plan_mode` 正是 DSH 将来补对称工具时最可能选的名字（它现在的
 *     常量就叫 `EXIT_PLAN_MODE = "exit_plan_mode"`）。这不是假想的撞车，而是
 *     顺着官方命名习惯走就会撞的那种。
 *
 * 靠"加载时先 `ctx.tools.get()` 探测一下再决定名字"并不可靠：注册表是分层的、
 * 工具目录还会随 `tools/change` 变动，探测结果取决于插件行的相对顺序，等于把
 * 一个启动期的竞态当成解决方案。所以这里用**固定命名方案**：
 *
 *     工具名 = <包名归一化> _ <具体工具名>
 *
 *   - 前缀 `dsh_enter_plan_mode` 来自包名 `dsh-enter-plan-mode`（`-` → `_`），
 *     一眼可读"这个工具由哪个插件提供"，并且天然落在第三方命名空间里；
 *   - 后缀 `enter_plan_mode` 是本次补的具体能力名（与上游 `exit_plan_mode` 对称）；
 *   - 拼起来是 `dsh_enter_plan_mode_enter_plan_mode`。整个名字 snake_case，
 *     与本仓库/宿主其它具名工具一致（`exit_plan_mode`、`ask_user_question`、
 *     `todo_write`、`run_code`），35 字符，远低于宿主 MCP 桥接的 64 字符上限；
 *   - 上游真要加对称工具，加的也是不带前缀的裸名 `enter_plan_mode`，两者并存；
 *   - 这与宿主自己的第三方命名空间做法同源：MCP 桥接把外部工具注册成
 *     `mcp__<serverName>__<rawName>`，即「外部来源要有自己的命名空间」。
 *
 * 名字**故意按规则派生**（`TOOL_NAME = TOOL_PREFIX + '_' + TOOL_SUFFIX`）而不是
 * 写死，改包名或改能力名时两者不会脱节，命名方案本身也能被测试断言。
 *
 * 工具名**故意不做成可配置**：一旦允许部署改成裸名，重名的风险就随配置回到
 * 用户手里，而失败模式是静默的。要裸名的人可以自己写一个两行的包装插件。
 */
import type {
  EnterPlanModeResult,
  PlanModeLike,
  PlanModeOutcome,
  ToolsLike,
  LoggerLike,
} from './types.js'

/**
 * 插件包名，也是工具名的前缀来源。
 */
export const PACKAGE_NAME = 'dsh-enter-plan-mode'

/**
 * 工具名前缀：包名归一化而来（`-` → `_`）。
 *
 * 用包名做前缀，是为了让"这个工具由哪个插件提供"在名字里直接可读，并且天然
 * 落在第三方命名空间里、不与上游工具抢名字（理由见文件头）。
 */
export const TOOL_PREFIX = PACKAGE_NAME.replaceAll('-', '_')

/**
 * 工具名的后半部分：本次要补的具体能力。
 *
 * 与上游 `exit_plan_mode` 对称的裸名，**单独绝不注册**——它正是上游将来补
 * 对称工具时最可能选的名字。
 */
export const TOOL_SUFFIX = 'enter_plan_mode'

/**
 * 本插件注册的工具名：`<包名前缀>_<具体工具名>`。
 *
 * 形如 `dsh_enter_plan_mode` + `_` + `enter_plan_mode`。刻意**按规则派生**而不是
 * 写死，这样命名方案本身可被测试断言，改包名或改能力名都不会让两者脱节。
 */
export const TOOL_NAME = `${TOOL_PREFIX}_${TOOL_SUFFIX}`

/**
 * 上游若补对称工具时最可能使用的名字（= `TOOL_SUFFIX` 的裸名）。
 *
 * 只用于文档、日志与测试断言，**绝不注册**——注册它就等于把上面说的撞车
 * 风险请回来。保留这个别名是为了让"我们刻意没占这个名字"这件事在代码里显式可见。
 */
export const UPSTREAM_EQUIVALENT_NAME = TOOL_SUFFIX

/**
 * 工具描述：只承担**要不要调用**这一个职责。
 *
 * 三句 = 干什么 / 何时用 / 何时不用。刻意**不**写"进去之后怎么干"和"下一步做什么"
 * （见下面"为什么砍到三句"）。
 *
 * ## 为什么砍到三句（2026-10-27）
 *
 * 旧版 574 字符、五句，后两句是：
 *
 *   In plan mode, explore with non-mutating reads/searches, then present the
 *   finished plan through exit_plan_mode. The user reviews it there, and
 *   implementation starts only after approval.
 *
 * 它们讲的是**进入之后怎么做**，而这件事已有两个更权威、更完整的出处：
 *
 *  1. `plan:policy` 系统提示段（`@deepseek-ai/dsh-plan-mode` 的 `section` 配置，
 *     `dsh-base` 与 `dsh-web-app/presets/standard.patch.yml` 各有一份）。计划模式
 *     激活后逐请求注入，六段，明确到"禁止编辑/写文件/跑格式化/commit"以及
 *     "exit_plan_mode 必须是该轮唯一且最后的工具调用"。实测：人工 `/plan` 进入后
 *     系统提示从 8530 涨到 10890 字符，退出后缩回（session-a9de2c42，seq 3→4→10、
 *     904→906）。
 *  2. 工具**结果**文案（见 `describeResult()`）——三个分支全都带
 *     "Explore with non-mutating reads and searches, then present the complete
 *     plan through exit_plan_mode. Do not carry out the plan before the user
 *     approves it."，调用成功后的下一步由它负责。
 *
 * 留在描述里的版本反而是三处里**最不准的**：它把"用户可能选择继续规划、反馈回到
 * 工具结果里再改一版"这一支简化成了直线（准确版本在 `exit_plan_mode` 的
 * description 里）。同一份规则三个副本，改一处漂两处。
 *
 * ## 也刻意**不**写"计划模式不改变沙箱/审批"（2026-10-27 实测后推翻）
 *
 * 曾经想加一句 "Plan mode is guidance only: it changes no sandbox or approval
 * policy, and every tool stays callable."，理由是这条事实在模型可见文本里无处可
 * 寻（该说法只在上游 README 与源码注释里，是写给集成者看的；模型可见的六段
 * policy 里 sandbox/callable/does not restrict 一个词都没有）。
 *
 * 但**实测表明模型不需要它**：会话 session-a9de2c42 计划模式期间 154 次工具调用、
 * 11 种工具（bash 134、subagent、web_fetch、ask_user_question…），零次沙箱/审批
 * 拒绝，全部 assistant 消息里没有任何"因计划模式而不能/不可/禁止"的自我限制表述。
 * 工具目录进出前后完全一致（83 个，含 bash/write/edit）。上游把这条事实排除在模型
 * 可见提示之外是**刻意的**：模型需要知道该做什么，不需要知道有没有机制在拦。
 *
 * 更反面的理由：这句紧跟在 policy 段"不得写文件/不得 commit"之后，等于告诉模型
 * "这是纯建议、没人拦你"，会**削弱前文的遵守度**。合规靠 policy 段说"做什么"，
 * 不靠描述说"有没有拦"。
 *
 * 已知样本局限：全机 98 个会话只有 2 个进过计划模式，且都是 danger-full-access +
 * approval: never；"受限沙箱 + 计划模式"的组合从未实测。即便在那种情形，模型需要
 * 知道的也是"不要写文件"（policy 已说），不是"写文件其实不会被拦"。
 *
 * ## 顺便：不要再把空字符串放进数组
 *
 * 旧版用 `''` 分隔段落，而 `.join(' ')` 把它变成**两个**连续空格，原生 function
 * calling 路径原样透传（`dsh-tools` 的 `schemaOf()` 不做折叠），模型看到的就是
 * 带双空格的文本。上游 49 条工具描述里双空格 0 条、换行 0 条。现在单段落拼接，
 * 测试里有 `!description.includes('  ')` 守着。
 *
 * 长度：286 字符。上游工具描述长度中位数 100、最长 590。
 */
const TOOL_DESCRIPTION = [
  'Switch the CURRENT session into plan mode, so the next steps explore and design a reviewable plan instead of changing files.',
  'Use this when a task should be planned and approved before implementation, or when the user asks to plan first.',
  'Do not use it for work the user already approved.',
].join(' ')

/** 计划模式服务不可用时的报错文案。 */
export function unavailableMessage(): string {
  return (
    'plan mode is not available to this call: the @deepseek-ai/dsh-plan-mode plugin is not mounted in the ' +
    "calling agent's scope, so there is no plan-mode state to switch. Ask the user to enable it (or check the " +
    'active agent preset), or to use the /plan command instead.'
  )
}

/**
 * 把 `set()` 的结果翻成模型能照做的下一步。
 *
 * 注意 `queued` 在工具调用场景里是**正常结果**而不是异常：本工具正是在一轮
 * 进行中被调用的，而 `PlanModeController.set()` 在存在未闭合回合时只登记待生效
 * 选择（`pending`），等到下一个被接受的 in-turn pre-step 才落成 `plan/mode`
 * 事件。计划模式的提示段在这一期间已经按 pending 生效，所以模型当下就能开始
 * 规划。
 *
 * `outcome` 单独看会误导，必须和 `active`/`pending` 一起读：
 *  - `noop` 只表示"目标状态与当前选择相同"，而当前选择可能是待生效的
 *    （`pending: true` 且已落盘状态仍是 `active: false`）；
 *  - 因此文案按 after 状态的三个字段拼，而不是按 `outcome` 分支。
 *
 * @param result 切换结果。
 * @returns 面向模型的一句话说明。
 */
export function describeResult(result: EnterPlanModeResult): string {
  const { active, pending } = result
  const tail =
    'Explore with non-mutating reads and searches, then present the complete plan through exit_plan_mode. Do not carry out the plan before the user approves it.'
  if (active) return `Plan mode is active for this session. ${tail}`
  if (pending) return `Plan mode is switched on for this session and applies from your next step. ${tail}`
  // 既没生效也不在待生效：只可能是 set() 报告了 cancelled（反向选择被清掉且
  // 落盘状态与本意不符）。如实交代，别谎称已进入。
  return `Plan mode was not switched on for this session. ${tail}`
}

/**
 * 执行一次"进入计划模式"。
 *
 * 抽成纯函数是为了能在 node 里直接测：不依赖 cordis、不依赖真实 DSH 进程。
 *
 * @param planMode 宿主 `ctx.planMode` 服务；未加载时为 undefined。
 * @param agent 发起调用的 agent（来自工具执行上下文）。
 * @returns 切换结果。
 * @throws 计划模式服务缺失、或调用没有归属 agent 时抛出——这两种都是部署/使用
 *   错误，应当作为工具失败明确冒到模型面前，而不是假装成功。
 */
export function enterPlanMode(
  planMode: PlanModeLike | undefined,
  agent: unknown,
): EnterPlanModeResult {
  if (planMode === undefined || planMode === null) throw new Error(unavailableMessage())
  if (agent === undefined || agent === null) {
    throw new Error(
      `${TOOL_NAME} requires a calling agent: there is no session to switch into plan mode.`,
    )
  }
  const outcome: PlanModeOutcome = planMode.set(agent, true)
  // 以 set() 之后的读取为准：`active` 是已落盘的日志状态，`pending` 是还没被
  // 下一个 pre-step 采纳的切换。两者都不会撒谎，模型据此决定下一步。
  const after = planMode.get(agent)
  return {
    outcome,
    active: after.active === true,
    pending: after.pending === true,
  }
}

/** `register()` 抛出的错误是不是"该名字已被占用"。 */
function isDuplicateRegistration(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('is already registered')
}

/**
 * 从一个上下文里安全地取任意服务。
 *
 * 必须用 `ctx.get(name)` 而不是 `ctx.<name>`：cordis 的属性访问要求该服务
 * 已在静态 `inject` 里声明，否则直接抛
 * `cannot get property "<name>" without inject`。而本插件不能静态声明它们
 * （理由见 `src/index.ts` 文件头：缺 plan-mode 的部署里整行插件会永远等待）。
 *
 * @param ctx 候选上下文。
 * @param name 服务名。
 * @returns 服务实例，或 undefined（缺失/取值抛错）。
 */
function readService(ctx: unknown, name: string): unknown {
  if (ctx === null || typeof ctx !== 'object') return undefined
  const getter = (ctx as { get?: unknown }).get
  if (typeof getter !== 'function') return undefined
  try {
    return (getter as (name: string) => unknown).call(ctx, name)
  } catch {
    return undefined
  }
}

/**
 * 从一个上下文里安全地取 `planMode` 服务。
 *
 * @param ctx 候选上下文。
 * @returns 服务实例，或 undefined（缺失/取值抛错/结构不符）。
 */
function readPlanMode(ctx: unknown): PlanModeLike | undefined {
  return asPlanMode(readService(ctx, 'planMode'))
}

/**
 * 把候选值校验成 `planMode` 服务。
 *
 * 与 `readPlanMode()` 分开是因为 `agentPresets.serviceFor()` 直接返回值本身
 * （不是经过 cordis 的 store 查询），校验逻辑必须共用同一套。
 *
 * @param service 候选值。
 * @returns 通过结构校验的服务；否则 undefined。
 */
function asPlanMode(service: unknown): PlanModeLike | undefined {
  if (service === null || typeof service !== 'object') return undefined
  const candidate = service as PlanModeLike
  // 结构校验：只接受真的具备 get/set 的服务，避免拿到同名的别的东西。
  return typeof candidate.get === 'function' && typeof candidate.set === 'function'
    ? candidate
    : undefined
}

/**
 * 通过宿主的 `agentPresets` 服务解析 agent 所属 preset 里挂载的服务。
 *
 * **这是 web profile 下唯一能取到 `planMode` 的路径。** 原因在 cordis 的
 * isolate 语义，不在装载顺序：
 *
 *  - preset 里 plan-mode 那一行带 `isolate: { planMode: true }`。cordis 的
 *    loader 为它分配一个**独立的 realm symbol**（`LocalRealm`，
 *    `Symbol("planMode#<entryId>")`），服务实例存在 `reflect.store` 的这个
 *    symbol 下。
 *  - `ctx.get()` / `_getImpl()` 走的是 `this.ctx[Context.isolate][name]`，
 *    也就是**当前上下文那条 realm 的** symbol。agent 作用域是 preset 作用域的
 *    子节点，但它继承的那条 realm 链上没有为 `planMode` 分配新 symbol，
 *    于是解析到的是根 realm 的 symbol——那里没有实例，`get()` 返回 undefined。
 *  - 实测（真实 cordis，与 `dsh-web-app` 同构地搭出 preset isolate + agent
 *    作用域）：`agent.ctx.get('planMode') === undefined`、
 *    `root.get('planMode') === undefined`，但 `store` 里确实有实例。
 *
 * 因此必须问 preset registry 要：它按 fiber 归属遍历 store（`withinFiber` 是
 * 对象身份比较），能跨 realm 命中。这也是上游自己的用法——见
 * `dsh-api-session-controller` 里解析 `skills`：
 * `presets?.serviceFor(live, 'skills') ?? this.ctx.get('skills')`。
 *
 * @param presets 宿主的 `agentPresets` 服务（可能不存在）。
 * @param agent 发起调用的 agent。
 * @returns 服务实例，或 undefined。
 */
function readFromAgentPresets(presets: unknown, agent: unknown): PlanModeLike | undefined {
  if (presets === null || typeof presets !== 'object') return undefined
  const resolver = (presets as { serviceFor?: unknown }).serviceFor
  if (typeof resolver !== 'function') return undefined
  if (agent === null || typeof agent !== 'object') return undefined
  try {
    return asPlanMode((resolver as (agent: unknown, name: string) => unknown).call(presets, agent, 'planMode'))
  } catch {
    return undefined
  }
}

/**
 * 解析宿主 `planMode` 服务。
 *
 * 三条路径，顺序是**实测确定的**，不是猜的：
 *
 *  1. **`agentPresets.serviceFor(agent, 'planMode')`** —— web profile 的主路径。
 *     plan-mode 挂在每个 agent preset 的 `isolate: { planMode: true }` group
 *     里，服务实例位于一个 realm 私有的 symbol 下，`ctx.get()` 从 agent 作用域
 *     和根作用域都取不到（理由与实测见 `readFromAgentPresets()`）。registry 按
 *     fiber 归属查 store，能越过 realm。
 *  2. **agent 作用域的 `ctx.get('planMode')`** —— 保持兼容：preset 若没用
 *     isolate 挂载（自定义 preset、旧配置），这条路直接命中，无需 registry。
 *  3. **插件自身上下文** —— 只在 plan-mode 仍挂在宿主平面的部署里命中
 *     （例如 `headless` profile：dsh-base 在扁平层挂 plan-mode，没有 preset）。
 *
 * 不能只留第 2 条：第 2 条在 web profile 下**永远**返回 undefined，那正是
 * 1.0.1 及之前版本在真实会话里报 "plan mode is not available" 的原因。
 *
 * @param pluginCtx 插件自身的 cordis 上下文（根/宿主平面）。
 * @param agent 发起调用的 agent。
 * @returns 可用的 planMode 服务；三处都没有时为 undefined。
 */
export function resolvePlanModeService(
  pluginCtx: unknown,
  agent: unknown,
): PlanModeLike | undefined {
  const agentCtx = (agent as { ctx?: unknown } | undefined)?.ctx
  // 宿主平面上的 agentPresets（dsh-web-app 把它挂在根层，不在 preset 里）。
  const presets = readService(pluginCtx, 'agentPresets')
  return readFromAgentPresets(presets, agent) ?? readPlanMode(agentCtx) ?? readPlanMode(pluginCtx)
}

/**
 * 注册工具，并对"名字已被占用"做兜底。
 *
 * 正常路径下不会命中：工具名带 `dsh_` 前缀就是为了不撞车。保留兜底是因为
 * 跨插件仍可能有人手工注册同一个名字（或本插件被同一个 profile 插入两次），
 * 那种情况下应当留一条可诊断的 warning，而不是把 profile 的启动拖进失败态。
 *
 * @param tools 宿主工具注册表。
 * @param definition 工具定义。
 * @param logger 宿主 logger。
 * @returns 撤销本次注册的函数；名字被占用时为 undefined。
 * @throws 非重名的注册错误照常抛出——定义写错（比如 schema 不在支持的子集里）
 *   应当响亮地失败，不能被这里吞掉。
 */
export function registerTool(
  tools: ToolsLike,
  definition: Record<string, unknown>,
  logger?: LoggerLike,
): (() => void) | undefined {
  try {
    const dispose = tools.register(definition as never)
    return typeof dispose === 'function' ? dispose : undefined
  } catch (error) {
    if (!isDuplicateRegistration(error)) throw error
    const detail = error instanceof Error ? error.message : String(error)
    logger?.warn?.(
      `[dsh-enter-plan-mode] tool "${String(definition.name)}" is already registered; ` +
        `this plugin is not providing it. If another plugin squats the name, remove one of them. (${detail})`,
    )
    return undefined
  }
}

/**
 * 构造工具定义。
 *
 * 只声明 `output` + `execute` + 展示回调，全部走 `@deepseek-ai/dsh-tools`
 * 支持的 JSON Schema 子集（type/oneOf/properties/required/additionalProperties/
 * items/enum/const + annotations），不依赖只有官方插件能用的 `defineTool`。
 *
 * `planMode` 在**每次调用时**才解析，而且从 `exec.agent.ctx` 取——实测在
 * `apply()` 阶段根上下文里根本看不到这个服务（`dsh-web-app` 把它挂进了每个
 * agent preset 的隔离 group）。详见 `resolvePlanModeService()`。
 *
 * @param pluginCtx 插件自身的 cordis 上下文，作为 agent 作用域的兜底。
 * @returns 可直接交给 `ctx.tools.register()` 的定义。
 */
export function createDefinition(pluginCtx: unknown): Record<string, unknown> {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    // 无参数：进入计划模式不需要模型提供任何东西。
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['outcome', 'active', 'pending'],
        properties: {
          outcome: {
            type: 'string',
            enum: ['committed', 'queued', 'cancelled', 'noop'],
            description: 'How the switch was applied.',
          },
          active: { type: 'boolean', description: 'Whether plan mode is in force after the call.' },
          pending: {
            type: 'boolean',
            description: 'Whether an unexpired switch is still waiting for the next step.',
          },
        },
      },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: describeResult(value as EnterPlanModeResult) },
      ],
    },
    execute: async (args: unknown, exec: { agent?: unknown }) => {
      void args
      const planMode = resolvePlanModeService(pluginCtx, exec.agent)
      return enterPlanMode(planMode, exec.agent)
    },
    presentCall: () => ({ card: 'generic', title: 'Enter plan mode', kind: 'other' }),
    presentResult: (_args: unknown, result: { content: unknown }) => ({
      card: 'generic',
      title: 'Plan mode',
      content: result.content,
    }),
  }
}
