# dsh-alertmanager

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

在 DSH Web 左侧栏加一个「告警」主面板：直接读取 AlertManager HTTP API v2 的实时告警，勾选 1–20 条后选一个 DSH 工作区，点「处理」就会**在该工作区新建会话、写入标题，并把告警上下文作为首条用户消息发给 agent 立即开始处理**，界面随后跳到该会话。

## 能力

- 左侧栏「告警」入口 + 独立主面板，不占用对话区。
- 读取 AlertManager v2 `/api/v2/alerts`，同时拉回活跃、静默、抑制、未处理告警。
- 搜索（告警名 / 标签 / 注解）、状态筛选、严重度色点、点行展开完整标签与注解、来源外链。
- 支持无鉴权 / Basic / Bearer 三种方式；可忽略自签名证书的 TLS 校验。
- 勾选 1–20 条后，在吸底栏选工作区并派发：新建会话 → 改标题 → 首条消息写入告警上下文 → agent 立即开始运行。
- 按配置的刷新间隔自动刷新，也可手动刷新。

## 安装

本包暂未发布到 npm，用本地目录安装：

```bash
dsh plugin --profile web add /home/viktor/dev/projects/github/fengyifan/dsh-plugins/packages/dsh-alertmanager
```

装完重启 `dsh web`（新增插件行需要重新组合 profile；只是升级同版本号的话刷新页面就够）。

## 面板内配置

打开左侧栏「告警」面板，按提示填写：

| 字段 | 说明 |
| --- | --- |
| AlertManager 地址 | 必填，`http://` 或 `https://` 绝对地址，例如 `https://alertmanager.example.com` |
| 鉴权方式 | 无 / Basic / Bearer |
| 用户名 | 仅 Basic 使用 |
| 口令或 token | 仅 Basic / Bearer 使用；留空表示保留已保存的值 |
| 忽略 TLS 证书校验 | 默认否；自签名证书且地址是 https 时使用 |
| 刷新间隔（秒） | 5–300，默认 30 |

设置保存在 DSH 凭据服务里（记录 key `dsh-alertmanager/settings`），不写 profile 的 `cordis.patch.yml`。读取设置时**不会**把口令/token 回传给浏览器，只返回 `hasSecret`。

## 行为

点「在所选工作区处理」后，插件会：

1. 重新拉取一次最新告警（绕过面板的 5 秒缓存），按指纹匹配选中项；
2. 在所选工作区调用 `sessionController.create({ workspaceId })` 新建会话；
3. 把标题改为 `告警处理：<第一个 alertname> 等 N 条`（≤60 字符，失败不阻断）；
4. 把生成的中文 prompt 作为首条用户消息，以 `mode: 'queue'` 发给 agent；
5. 前端清空选择、刷新告警，并跳到新会话。

**点「处理」会立即新建会话并消耗一轮模型调用**；请确认工作区与告警内容后再点。prompt 会要求 agent 先只读排查、改动前说明方案、处理完汇报根因/操作/验证/后续建议。单条 prompt 总长上限 20000 字符，超长时先去掉「描述」，仍超则省略尾部告警并在末尾注明条数。

派发时若某条告警已恢复、不在最新列表里，prompt 会注明「派发时已不在告警列表，可能已恢复」，其余告警照常处理。

## 限制

- 只支持 AlertManager HTTP API **v2**（`/api/v2/alerts`），不支持 v1。
- 不支持依赖反向代理 Cookie 登录态；需要 Basic / Bearer 或允许匿名读取。
- 不支持多实例：一个 profile 只配置一个 AlertManager 地址。
- 一次最多处理 20 条告警。
- 不做静默（silence）管理，只读取与派发。
- TLS 校验关闭只作用于本插件的 AlertManager 请求，不影响 DSH 自身。

## 开发

```bash
pnpm --filter dsh-alertmanager run build    # 宿主 tsc + 客户端 tsc + client bundle
pnpm --filter dsh-alertmanager run verify   # 只做类型检查
pnpm --filter dsh-alertmanager test         # node --test（测构建产物）
```

测试用注入的假 `fetch` / 假 `sessionController` 覆盖鉴权头、归一化、401/超时、设置不回传 secret、派发全链路与失败分支。

## 版本适配

本插件**有意不声明**任何 DSH 版本要求（既无 `engines.dsh`，也无 `@deepseek-ai/dsh-*` peer），因此不受版本门禁约束。它依赖的是接口形状而不是版本号：`webServer.register()`、`ctx.get('credentials')`、`sessionController.create/rename/prompt`、`workspaceRegistry.get()` 与客户端槽位 API。接口若变，失败方式是响亮的（可读 503/502 或面板错误态），而不是静默失效。
