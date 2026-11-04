# dsh-alertmanager

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

在 DSH Web 左侧栏加一个 **AlertManager** 主面板：并行读取多个 AlertManager HTTP API v2 实例，
把告警聚合为多列卡片；勾选任意条数、选一个 DSH 工作区后点「处理」，就会在该工作区
**新建会话、写入标题，并把按实例分组的告警上下文作为首条用户消息发给 agent 立即开始处理**，界面随后跳到该会话。

## 能力

- **侧栏入口**：图标 + 「AlertManager」+ 分级数量胶囊（严重 / 警告 / 提示 / 其他的计数）。
  入口挂载即自动拉取一次，**不打开面板也能看到数字**。
- **多实例**：设置里可添加任意多个实例，每个独立配置名称、地址、鉴权与 TLS 选项；
  并发拉取、单实例失败隔离（失败实例在列表上方单独提示，不阻塞其它实例）。
- **筛选**：搜索（告警名 / 标签 / 注解 / 实例名）+ 状态 + 级别 + 实例，**合并为一行**胶囊控件，
  右侧显示当前结果计数。
- **卡片**：左侧严重度色条作为普通布局子项（不会覆盖边框）；依次为实例标签、名称、
  严重度/状态标签、2 行摘要、单行标签；**只有内容确实溢出时**才出现「展开」，
  展开后显示来源外链、全部标签、注解、指纹、静默与抑制来源。
- **选择**：点击卡片即切换选中（拖选文字时不触发）；复选框是键盘可达的
  `role="checkbox"` 控件；**不限制单次选择条数**。
- **刷新**：Grafana 式两态「刷新 / 取消」。空闲时左段「⟳ 刷新」、右段「5s ▾」；
  刷新中左段变「◌ 取消」，点击 `AbortController.abort()` 中止在途请求并保留上次成功数据。
  间隔可选 `关闭 / 5s / 10s / 30s / 1m / 5m`，默认 5s，存 `localStorage`
  的 `dsh-alertmanager:refresh`；状态行显示倒计时，手动刷新会重置计时。
  自动刷新是**静默**的，不会把按钮切成取消态。
- **派发提示词可控**：设置里可选风格 —— **简洁**（默认，一句引导语 + 告警名称，如
  「解决以下 AlertManager 告警：」+ 名称列表）或**详细**（完整的告警上下文与处理要求）；
  简洁模式的引导语可自定义（≤500 字符）。
- **状态驱动**：面板与侧栏入口订阅同一个 store 快照，数据一到两者同时更新；
  全局只有一个自动刷新计时器。无告警且实例全部可达时显示「一切正常」成功态。
- **设置**：实例列表 + 添加/删除，名称、地址、鉴权方式（无 / Basic / Bearer）、用户名、
  口令或 token、忽略 TLS 证书校验；就地校验非法/重复 URL 与空名称；删除为**单击即删并给出行内撤销**
  （保存前都能反悔）。所有下拉/分段控件均自绘，不使用原生 `<select>`。
- **主题**：颜色/圆角/字号/阴影全部用 DSH 自身 CSS 变量（`--dsw-*` / `--dsh-*`），
  跟随浅色/暗色主题与用户字号设置；选中强调色用 `--dsw-alias-state-business-primary`
  （浅色 `#4176e6` / 暗色 `#7aaaff`）。
- 中文 / English 双语，全部可见文案走 DSH locale，不引入第三方 UI 库。

## 安装

本包暂未发布到 npm，用本地目录安装：

```bash
dsh plugin --profile web add /home/viktor/dev/projects/github/fengyifan/dsh-plugins/packages/dsh-alertmanager
```

装完重启 `dsh web`（新增插件行需要重新组合 profile；只是升级同版本号的话刷新页面就够）。

## 面板内配置

打开左侧栏 **AlertManager** 面板，点右上角「AlertManager 设置」：

| 字段 | 说明 |
| --- | --- |
| 名称 | 必填；新建实例时前端默认取 URL 的 host，后端也会兜底 |
| 地址 | 必填，`http://` 或 `https://` 绝对地址，多个实例的地址不能重复 |
| 鉴权方式 | 无 / Basic / Bearer（自绘分段控件） |
| 用户名 | 仅 Basic 使用 |
| 口令或 token | 仅 Basic / Bearer 使用；留空表示保留该实例已保存的值 |
| 忽略 TLS 证书校验 | 默认否；自签名证书且地址是 https 时使用 |
| 提示词风格 | 简洁（默认）/ 详细，见下文「派发提示词」 |
| 引导语 | 仅简洁模式：消息第一行，插件随后自动列出告警名称（≤500 字符） |

设置保存在 DSH 凭据服务里（记录 key `dsh-alertmanager/settings`，payload 版本 v2），
不写 profile 的 `cordis.patch.yml`。读取设置时**不会**把口令/token 回传给浏览器，只返回 `hasSecret`。
旧的 v1 单实例设置会在首次读取时自动迁移为 `id=default` 的实例；v1 的 `refreshSeconds` 丢弃，
刷新间隔改由浏览器 `localStorage` 保存。

保存是**全量替换**：请求里的实例列表就是最终列表；`secret` 省略或空串时按 `id` 保留旧值，
`authMode: 'none'` 会清空 secret。**保存后 store 立即同步**：清空全部实例会马上把面板切到
「未配置」态、清空卡片与选中项，并让侧栏数字归零、停止自动刷新。

## 派发提示词

派发时发给 agent 的首条消息由设置里的「提示词风格」决定：

- **简洁（默认）**：引导语 + 去重后的告警名称，别无其它。例如：

  ```
  解决以下 AlertManager 告警：
  - MemoryRequestTooLow
  - GitLabBackupStale
  ```

  若有派发时已恢复的告警或不可达实例，末尾会各加一行简短说明。
- **详细**：完整的结构化上下文（工作区路径、按实例分组的告警字段、标签、注解、
  指纹，以及「处理要求」），总长上限 20000 字符。

两种风格都仍受 20000 字符上限约束；引导语上限 500 字符。

## 行为

点「处理」后，插件会：

1. 校验工作区（不存在返回 404）；
2. 按涉及的实例分组、**并行重新拉取**最新告警（`?fresh=1` 绕过 5 秒缓存），
   按 `(instanceId, fingerprint)` 匹配选中项；
3. 在所选工作区调用 `sessionController.create({ workspaceId })` 新建会话；
4. 把标题改为 `告警处理：<第一个 alertname> 等 N 条`（≤60 字符，失败不阻断）；
5. 把按实例分组的中文 prompt 作为首条用户消息，以 `mode: 'queue'` 发给 agent；
6. 前端清空选择、刷新告警，并跳到新会话。

**点「处理」会立即新建会话并消耗一轮模型调用**；请确认工作区与告警内容后再点。
prompt 会要求 agent 先只读排查、改动前说明方案、处理完汇报根因/操作/验证/后续建议。
单条 prompt 总长上限 20000 字符，超长时先去掉「描述」，仍超则按实例/条从尾部裁剪并注明省略条数。

派发时若某条告警已恢复、不在最新列表里，prompt 会注明「派发时已不在告警列表，可能已恢复」；
若某个实例当时不可达，会在 prompt 里单列「实例 X 当时不可达，其选中告警未包含」，其余实例照常处理。
所有选中告警都取不到时返回 502，不创建会话。

## HTTP 接口

插件在 DSH Web 服务器上挂三个同源 exact path（`GET`/`POST` 在同一 handler 内分流），
全部经过 `ctx.connection.requestRejection` 鉴权，响应带 `cache-control: no-store`：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /_dsh/alertmanager/settings` | 读取设置（不含 secret） |
| `POST /_dsh/alertmanager/settings` | 全量保存设置 |
| `GET /_dsh/alertmanager/alerts` | 并行拉取全部实例；`?fresh=1` 绕过 5 秒缓存 |
| `POST /_dsh/alertmanager/dispatch` | 在指定工作区新建会话并派发选中告警 |

错误响应统一带稳定 `code`：`settings.invalid`、`alerts.not-configured`、`alerts.fetch-failed`、
`dispatch.invalid`、`dispatch.workspace-not-found`、`dispatch.alerts-unavailable`、
`dispatch.prompt-failed`、`credentials.unavailable`、`session.unavailable`，
以及鉴权相关的 `auth.required` / `auth.gateway` / `auth.dsh`（后两者由前端识别并本地化）。
前端对 `alerts.not-configured` 视为权威信号：立即清空数据并进入未配置态，不保留旧卡片。

## 代码结构

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | 宿主插件：注册 `/settings`、`/alerts`、`/dispatch` 路由与设置读写 |
| `src/settings.ts` | 设置模型、v1→v2 迁移、凭据记录读写、严格 JSON 负载 |
| `src/alertmanager.ts` | 多实例拉取、5 秒按实例缓存、归一化与排序、错误分类、TLS 处理 |
| `src/prompt.ts` / `src/dispatch.ts` | 分组 prompt 生成与派发编排（create→rename→prompt） |
| `src/store.ts` | 与运行环境无关的核心状态机（副作用经依赖注入，可在 Node 单测） |
| `src/client/store.ts` | 浏览器适配（同源 fetch / localStorage / 计时器 / 可见性）并广播计数 |
| `src/client/pieces.tsx` | 自绘控件：Dropdown / Modal / Segmented / Switch / TextInput / Tag / FilterChip |
| `src/client/panel.tsx` | 主面板与设置弹窗 |
| `src/client/index.tsx` | 槽位注册（`sidebar.panellist` + `main`）与侧栏胶囊 |
| `src/locales.ts` | 双语文案；`zh` 为键集真源，`en` 在编译期约束为同键集 |

## 限制

- 只支持 AlertManager HTTP API **v2**（`/api/v2/alerts`），不支持 v1。
- 不支持依赖反向代理 Cookie 登录态；需要 Basic / Bearer 或允许匿名读取。
- 不做静默（silence）管理，只读取与派发；单次派发条数不设上限。
- TLS 校验关闭只作用于本插件的 AlertManager 请求，不影响 DSH 自身。
- 侧栏入口的文字标签由 DSH 侧栏渲染，同一个值也被用作该行按钮的 `aria-label`；
  为了让标签能显示数量胶囊，标签是 React 节点，因此该按钮的 `aria-label` 会退化为
  `[object Object]`（视觉正常，读屏体验受影响；如在意可改为纯文本标签）。

## 开发

```bash
pnpm --filter dsh-alertmanager run build    # 宿主 tsc + 客户端 tsc + client bundle
pnpm --filter dsh-alertmanager run verify   # 只做类型检查
pnpm --filter dsh-alertmanager test         # node --test（测构建产物）
```

测试覆盖（76 条）：v1→v2 迁移、secret 保留/清空、严格 JSON payload、多实例聚合与排序、
单实例失败隔离、每实例缓存与 `fresh`、分组 prompt、超长裁剪、`endsAt` 零值、跨实例派发、
工作区 404、prompt 失败带 sessionId、zh/en 键集一致、假 ctx 走真实路由 handler 的接口测试，
以及核心 store（计数、bootstrap、排程唯一性、手动/自动区分、尾随补发、`not-configured` 清空、
saveSettings 清空后停排程、dispose、失败保留旧数据、取消、选中集合语义）。

> 注意：`src/locales.ts` 同时被宿主与客户端编译，客户端产物保留在 `src/client/**`；
> `src/store.ts` 被两侧共用。`lib/` 与 `.client-build/` 是构建产物，不提交。

## 版本适配

本插件**有意不声明**任何 DSH 版本要求（既无 `engines.dsh`，也无 `@deepseek-ai/dsh-*` peer），
因此不受版本门禁约束。它依赖的是接口形状而不是版本号：`webServer.register()`、
`ctx.get('credentials')`、`sessionController.create/rename/prompt`、`workspaceRegistry.get()`
与客户端槽位 / locale API。接口若变，失败方式是响亮的（可读 503/502 或面板错误态），
而不是静默失效。
