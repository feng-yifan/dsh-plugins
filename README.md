# dsh-plugins

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集合（pnpm monorepo）。

## 插件

| 插件 | 说明 |
| --- | --- |
| [`dsh-vertical-layout`](packages/dsh-vertical-layout) | 竖屏布局优化：电脑竖屏时把右侧文件 / 终端面板移到对话区上方，高度可拖拽调整 |
| [`dsh-ask-highlight`](packages/dsh-ask-highlight) | 提问块高亮：已答复的「提问 n/n 已回答」工具块用柔和卡片凸显；可让提问块默认展开，设置页可配 |
| [`dsh-pwa-icon`](packages/dsh-pwa-icon) | **已由 `dsh-enhancement` 取代**：PWA 图标/安装能力已并入增强套件；源码保留作参考 |
| [`dsh-enhancement`](packages/dsh-enhancement) | 远程安全访问网关（密码/HTTPS）+ PWA 安装/图标 + 桌面通知 + PWA Web Push；与 3081 入口共存 |
| [`dsh-enter-plan-mode`](packages/dsh-enter-plan-mode) | 进入计划模式工具：给模型一个可调用的 `dsh_enter_plan_mode_enter_plan_mode`，配合内置的 `exit_plan_mode` 构成"先规划、后评审"的闭环 |
| [`dsh-font-settings`](packages/dsh-font-settings) | **已废弃**：DSH 0.2.x 起内置字体设置，源码仅作参考实现 |

每个插件的用法见各自 README（中英双语）。

## 安装

```bash
dsh plugin --profile web add dsh-vertical-layout
dsh plugin --profile web add dsh-ask-highlight
# dsh-pwa-icon 已由 dsh-enhancement 取代；新增强套件本机开发时先用 link: 依赖
# （见 packages/dsh-enhancement/README.md）
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

DSH 在组合 profile 前读取插件的 `peerDependencies`，把其中 `@deepseek-ai/dsh*` 的项与运行中的 dsh 版本比对：**未声明这类 peer 的插件不受版本门禁约束**。本仓库在维护的三个插件都不声明（只依赖稳定的宿主接口与 DOM 数据属性），因此与 DSH 版本松耦合；`dsh-font-settings` 的类型检查冻结在写它时的 dsh 版本。

每周（及手动）由 [`.github/workflows/dsh-compat.yml`](.github/workflows/dsh-compat.yml) 在 `latest` / `alpha` 渠道上跑类型检查与真实 smoke：仅在 peer 范围过期且验证通过时自动开 PR，失败则开 issue、不自动改代码。
