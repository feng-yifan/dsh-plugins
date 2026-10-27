# dsh-plugins

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合（pnpm monorepo）。

## 插件

| 插件 | 说明 |
| --- | --- |
| [`dsh-vertical-layout`](packages/dsh-vertical-layout) | 竖屏布局优化：电脑竖屏时把右侧文件 / 终端面板移到对话区上方，高度可拖拽调整 |
| [`dsh-ask-highlight`](packages/dsh-ask-highlight) | 提问块高亮：已答复的「提问 n/n 已回答」工具块用柔和卡片凸显；可让提问块默认展开，设置页可配 |
| [`dsh-pwa-icon`](packages/dsh-pwa-icon) | PWA 图标：把 Web GUI 安装 / 添加到桌面时的应用图标换成自定义图片（桌面浏览器与 iOS 主屏幕都覆盖）；包内自带默认图标集，装完即用 |
| [`dsh-enhancement`](packages/dsh-enhancement) | 远程安全访问网关（密码/HTTPS）+ PWA 安装/图标 + 桌面通知 + PWA Web Push；与 3081 入口共存 |
| [`dsh-enter-plan-mode`](packages/dsh-enter-plan-mode) | 进入计划模式工具：给模型一个可调用的 `dsh_enter_plan_mode_enter_plan_mode`，配合内置的 `exit_plan_mode` 构成"先规划、后评审"的闭环 |
| [`dsh-font-settings`](packages/dsh-font-settings) | **已废弃**：DSH 0.2.x 起内置字体设置，源码仅作参考实现 |

每个插件的用法见各自 README（中英双语）。

## 安装

```bash
dsh plugin --profile web add dsh-vertical-layout
dsh plugin --profile web add dsh-ask-highlight
dsh plugin --profile web add dsh-pwa-icon
dsh plugin --profile web add dsh-enhancement
dsh plugin --profile web add dsh-enter-plan-mode
```

插件从 npm 安装；本机 link 的插件用本地目录。需要持久配置的插件在 profile 的 `cordis.patch.yml` 里写 `config`（例如 `dsh-enhancement` 的网关/PWA 运行状态存它自己的 `state.json`，不在 profile 里放密码），具体字段见各插件 README。

改配置会自动热重载；升级插件版本后界面如果没变化，重启 `dsh web`；纯客户端样式类的插件刷新浏览器即可。

## 开发

```bash
pnpm install
pnpm run build      # 构建全部包
pnpm run verify     # 类型检查
pnpm compat         # 用本机 dsh 检查插件兼容性
# 真实 dsh 起一次性 profile 做冒烟（需 node 直接调用，勿经 pnpm 转发）
node scripts/smoke-plugin.mjs --package dsh-ask-highlight --expect-html dsh-ask-highlight
```

## 发布

发布由 GitHub Actions 自动完成（OIDC 可信发布 + provenance，见 [`.github/workflows/npm-publish.yml`](.github/workflows/npm-publish.yml)）：

```bash
pnpm --filter dsh-vertical-layout version x.y.z     # 1. 升版本
git commit -am "chore: 版本号提升" && git push       #    提交推送
git tag dsh-vertical-layout@x.y.z                   # 2. 打 tag：包名@版本，须与 package.json 的 version 一致
git push origin dsh-vertical-layout@x.y.z           #    推送即触发发布
```

工作流会构建并以 `--provenance --access public` 发布该包；也可在 Actions 页用 `workflow_dispatch` 手动补发。`dsh-font-settings` 已废弃，不在发布列表里。

## DSH 版本兼容

DSH 在组合 profile 前做兼容性预检，规则有三条，**优先级不能搞反**：

1. 清单声明了 `engines.dsh` → **只由这个范围决定**，`peerDependencies` 被完全忽略；
2. 否则 `@deepseek-ai/dsh` 与每个 `@deepseek-ai/dsh-*` 的 peer 范围都必须匹配；
3. 两者都没声明 → 不受版本门禁约束。

这个门禁的后果是**硬的**：范围不满足时 DSH 在**安装阶段就拒绝**（`installation rejected`），插件根本装不上，不是"装上但不生效"。

### 本仓库的选择：不声明版本范围

本仓库在维护的插件都**有意不声明** DSH 版本要求。理由不是省事：

- **耦合面是接口，不是版本号。** 这些插件只依赖文档化的稳定接口——`webserver/index-inject`（`dsh-host-webserver` 的公开事件）、`webServer.register` / `tapIndex`、`ctx.tools`、`ctx.get('planMode')`——以及少量 DOM 数据属性约定（`data-tool`、`data-disclosure-*`）。给它们写一个版本范围等于声称"只在这些版本上验证过"，是**虚假精度**。
- **声明会把插件绑到 DSH 的发版节奏上。** 每次 DSH 出一个新的次要版本，都要跟着发一次版，否则老用户装新插件会被直接拒绝。`dsh-font-settings` 是唯一的反例，也是反面教材：它声明了 peers，范围一路钉死，最终因 DSH 内置该能力而废弃。
- **接口断裂时，我们的失败方式是响亮的。** 缺服务时插件会抛出可读错误（例如 `plan mode is not available to this call: …`），而不是崩溃或静默错乱。而版本门禁是"装上之前就拒绝"，还要求用户用 `allow-version --accept-risk` 接受"可能崩溃或数据丢失"的风险声明——这种说法比实际情况严重得多。
- **真正抓 API 断裂的是 CI，不是版本门禁。** 版本号不覆盖 ≠ 接口变了；反过来，版本号覆盖也不代表接口没变。所以下面的工作流跑的是 `verify`（tsc）+ 真机 smoke。

如果你确实要给某个包声明范围，**用 `engines.dsh` 而不是 peers**：它是单一真源（声明后 peers 被忽略，避免双轨），并且 `scripts/update-peer-ranges.mjs` 会按优先级自动放宽正确的那一层。

### 自动化

每周（及手动、或 DSH 发版 `repository_dispatch`）由 [`.github/workflows/dsh-compat.yml`](.github/workflows/dsh-compat.yml) 在 `latest` / `alpha` 渠道上：

1. 装好**目标版本**的 dsh CLI，让判定函数与被测运行时同版本；
2. `pnpm install` + `build` + `verify`（类型检查，抓 API 断裂）；
3. `check-compat` 预检；范围过期就 `update-peer-ranges --write` 自动放宽（按上面的优先级改 `engines.dsh` 或 peers）；
4. 真机 smoke 每个仍在维护的插件，逐个断言其 `index.html` 标记；
5. 放宽过就只提交 `packages/*/package.json` 开 PR；任何硬失败开/更新 issue，**不自动改插件代码**。

两个辅助脚本可直接用：

```bash
node scripts/check-compat.mjs                    # 用本机 dsh 版本预检
node scripts/check-compat.mjs --runtime 0.3.0 --json
node scripts/update-peer-ranges.mjs --runtime 0.3.0          # 只打印计划
node scripts/update-peer-ranges.mjs --runtime 0.3.0 --write  # 落盘
```

`dsh-font-settings` 已废弃，不参与适配（`DEPRECATED.md` 即标记，两个脚本都会跳过）。
