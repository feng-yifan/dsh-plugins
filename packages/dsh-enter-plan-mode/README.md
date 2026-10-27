# dsh-enter-plan-mode

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

给 DSH 补一个**模型可调用**的「进入计划模式」工具 `dsh_enter_plan_mode_enter_plan_mode`。

DSH 内置的计划模式（`@deepseek-ai/dsh-plan-mode`）有**离开**方向的工具 `exit_plan_mode`，进入方向却只有 `/plan` 斜杠命令——那是给人敲的，模型调不到。本插件补上这一半：模型遇到"先想清楚再动手"的任务时，可以自己把当前会话切进计划模式，探索完之后再用内建的 `exit_plan_mode` 把方案交给你评审。

## 安装

```bash
dsh plugin --profile web add dsh-enter-plan-mode
```

装完重启 `dsh web`（新增插件行需要重新组合 profile；只是升级同版本号的话刷新页面就够）。

前置条件：profile 里要有 `@deepseek-ai/dsh-plan-mode`。`dsh-base` 默认带，一般不用管；缺了本插件照样加载，只在工具被调用时返回一条说明缺什么。

## 工具

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `dsh_enter_plan_mode_enter_plan_mode` | 无 | 把当前会话切进计划模式 |

调用后模型会收到一句状态说明，分三种：

| 情况 | 模型看到的话 |
| --- | --- |
| 已生效 | Plan mode is active for this session. … |
| 本轮内切换、下一步生效 | Plan mode is switched on for this session and applies from your next step. … |
| 没切成 | Plan mode was not switched on for this session. … |

"下一步生效"不是异常。计划模式的状态落盘发生在某个被接受的 in-turn pre-step 上；工具在一轮进行中被调用时，宿主的 `set()` 只登记一个待生效选择（`pending`），而计划模式的提示段在这期间**已经**按待生效状态生效了，所以模型当下就能开始规划。本插件把 `set()` 的 `committed` / `queued` / `cancelled` / `noop` 如实翻译出来，不去假装"已激活"。

工具在计划模式**未**激活时也一直注册着——跟上游 `exit_plan_mode` 一样，目的是让请求里的工具目录跨模式切换保持稳定，否则每次进出都会打掉 prompt 缓存。进出计划模式改变的是系统提示里的 `plan:policy` 段，不是工具目录。

### 工具描述为什么只有三句（286 字符）

描述只承担**要不要调用**：干什么 / 何时用 / 何时不用。它不讲"进去之后怎么干"，也不讲"下一步做什么"——那两件事各有更权威的出处：

| 内容 | 归属 | 送达时机 |
| --- | --- | --- |
| 进入后禁止编辑/写文件/跑格式化/commit；`exit_plan_mode` 必须是该轮唯一且最后的调用 | `plan:policy` 系统提示段（上游 `section` 配置，六段） | 计划模式激活后逐请求注入 |
| "先非破坏性探索，再用 `exit_plan_mode` 交方案，批准前别动手" | `describeResult()` 的工具结果文案（三个分支都带） | 每次调用成功后 |

早先的描述把这两件事各写了一遍（574 字符、五句），结果是同一份规则有三个副本，而且描述里的那份最不准——它把"用户可能选择继续规划、反馈回到工具结果里再改一版"简化成了直线，准确版本在 `exit_plan_mode` 的 description 里。

也**刻意不写**"计划模式不改变沙箱/审批、工具全能调"。这条事实在模型可见文本里确实无处可寻（只在上游 README 与源码注释里，是写给集成者看的），但实测模型不需要它：一次真实的计划模式会话里 154 次工具调用、11 种工具、零次沙箱/审批拒绝，也没有任何"因计划模式而不能/禁止"的自我限制表述。上游把它排除在模型可见提示之外是刻意的——模型需要知道该做什么，不需要知道有没有机制在拦。何况这句话紧跟 policy 的禁令，等于说"没人拦你"，反而削弱遵守度。

顺带修掉了旧版的一处机械瑕疵：用 `''` 分隔段落再 `.join(' ')`，会拼出**两个**连续空格，而原生 function calling 路径原样透传（`dsh-tools` 的 `schemaOf()` 不折叠空白）。上游 49 条工具描述里双空格 0 条、换行 0 条。测试有断言守着这两点。

## 工具名怎么来的：`<包名前缀>_<具体工具名>`

最自然的名字是 `enter_plan_mode`：与 `exit_plan_mode` 对称，语义一眼就懂。**但本插件故意不用它。**

1. **重名是硬错误，且先到先得。** 工具注册表（`@deepseek-ai/dsh-tools`）的 `register()` 落到 `NamedEntries.insert()`，同层重名直接同步抛 `tool "<name>" is already registered`。没有"后注册者覆盖"，也没有"自动改名"：**先注册的那个赢，后注册的那个 throw**。实测两个插件抢同一个名字，输出稳定是 `A: REGISTERED` / `B: THREW tool "my_new_tool" is already registered`。
2. **失败方向会伤到别人。** throw 发生在 `apply()` 里，而 profile 里插入的插件行默认是 **optional** 条目。按 app-boot 的启动失败表，optional 条目同步 `apply()` throw 的处理是「警告；继续」——进程照常启动，退出码 0，只有一行 `dsh: warning: 1 entry did not activate`。
   这一条最反直觉的地方是**谁倒下取决于加载顺序**：实测让一个自定义插件注册已被 `plan-mode` 占用的 `exit_plan_mode`，结果是**自定义插件注册成功、内置 `plan-mode` 整行没激活**（`plan-mode (@deepseek-ai/dsh-plan-mode): Error: tool "exit_plan_mode" is already registered`）。也就是说撞名不只可能让本插件的工具消失，还可能把**上游计划模式功能整个顶掉**，而界面看起来一切正常——没有 `exit_plan_mode`、没有 `/plan` 的进入语义，只留一行容易被日志淹没的 warning。
3. **撞车不是假想。** `enter_plan_mode` 正是 DSH 将来补对称工具时最可能选的名字——它现在的常量就叫 `EXIT_PLAN_MODE = "exit_plan_mode"`，顺着官方命名习惯走就会撞。一旦那天到来，最坏情况是**本插件抢到名字、把官方的计划模式挤出 profile**。

靠"加载时先 `ctx.tools.get()` 探一下再决定注册哪个名字"**不可靠**：注册表是分层的，工具目录还会随 `tools/change` 变动，探测结果取决于插件行的相对顺序——那是把一个启动期竞态当成解决方案。而探测本身还有个硬伤：实测工具注册表是按 *scope* 分层的，`plan-mode` 在 `dsh-web-app` 里被挂进每个 agent preset 的**隔离 group**，根上下文里既没有这个服务、也看不到它的工具，加载期探测根本探不到该防的对手。

所以采用一条固定命名方案：

```
工具名 = <包名归一化> _ <具体工具名>
       = dsh-enter-plan-mode  →  dsh_enter_plan_mode   +   _   +   enter_plan_mode
       = dsh_enter_plan_mode_enter_plan_mode
```

- **前缀 = 包名**：`dsh-enter-plan-mode` 把 `-` 归一成 `_`，得到 `dsh_enter_plan_mode`。一眼可读"这个工具由哪个插件提供"，且天然落在第三方命名空间里。
- **后缀 = 具体能力名**：`enter_plan_mode`，与上游 `exit_plan_mode` 对称，语义自明。
- **命名习惯一致**：整名 snake_case，与宿主其它具名工具一致（`exit_plan_mode`、`ask_user_question`、`todo_write`、`run_code`）。
- **正好落在缝里**：上游官方的工具不带这种前缀。上游真要加，加的也是裸名 `enter_plan_mode`，两者可以并存——不会互相顶掉。
- **长度安全**：35 字符，远低于宿主 MCP 桥接的 64 字符上限（`MAX_PUBLIC_NAME_LENGTH`），也是合法的 XID 标识符，PTC 生成 SDK 时可按裸标识符处理。
- **与宿主自己的做法同源**：MCP 桥接把外部工具注册成 `mcp__<serverName>__<rawName>`，即"外部来源要有自己的命名空间"。用插件名做前缀是同一思路。
- **给同族工具留位**：同一插件将来再加工具时沿用同一前缀（如 `dsh_enter_plan_mode_<另一个能力>`），不会互相打架。

名字是**按规则派生**的（`TOOL_NAME = TOOL_PREFIX + '_' + TOOL_SUFFIX`），不是写死：改包名或改能力名时两者不会脱节，命名方案本身也被测试断言锁住。

**工具名故意不做成可配置。** 一旦允许部署改成裸名，撞车风险就随配置回到用户手里，而失败是静默的、且可能顶掉上游功能——代价远大于便利。确实需要裸名的话，自己写个两行的包装插件转调即可，撞车责任也就明确落在那个插件上。

真撞上了本插件不会让 profile 启动失败：注册被拒绝时它留一条带插件名的 warning 然后安静退出，因为此时它已经提供不了工具，没必要把整条插件行拖成启动故障。

## 已知取舍

- **引导而非强制。** 计划模式只靠提示词约束，不限制任何工具。要强制限制请另外配沙箱模式与审批策略（这是上游设计，本插件不改）。
- **只切当前会话。** 工具作用于发起调用的 agent 的会话。子 agent 有各自独立的计划模式状态。
- **不提供离开方向的工具。** 上游的 `exit_plan_mode` 自带"呈现方案 → 用户批准"的评审闭环，重复实现只会让评审路径分叉。退出请用它。
- **没有设置页。** 本插件没有可配项，不存在 `state.json`。

## 开发

```bash
pnpm --filter dsh-enter-plan-mode run build    # tsc → lib/
pnpm --filter dsh-enter-plan-mode run verify   # 只做类型检查
pnpm --filter dsh-enter-plan-mode test         # node --test（测构建产物）
```

测试覆盖的是命名约束、状态机文案（`committed`/`queued`/`cancelled`/`noop` × `active`/`pending` 全组合）、缺服务时的报错、重名兜底，以及"工具定义只用 DSH 支持的 JSON Schema 子集"——多写一个 `maximum` 之类关键字，`register()` 会抛 `JsonSchemaError`，插件就加载失败了。

## 版本适配

本插件**有意不声明**任何 DSH 版本要求（既无 `engines.dsh`，也无 `@deepseek-ai/dsh-*` peer），因此不受版本门禁约束。

理由与全仓库一致（见[根 README](https://github.com/feng-yifan/dsh-plugins#dsh-版本兼容)）：它依赖的是接口形状而非版本号——只有 `ctx.tools.register()` / `get()`，以及 `ctx.get('planMode')` 拿到的 `get()` / `set()`。给这类插件写版本范围是虚假精度，还会把插件绑到 DSH 的发版节奏上（门禁不满足时是在**安装阶段**直接拒绝）。

接口若变，失败方式是响亮的：取不到 `planMode` 时工具会返回一条可照做的错误，而不是静默失效或崩溃。API 断裂由 CI 的 `verify` + 真机 smoke 捕捉。
