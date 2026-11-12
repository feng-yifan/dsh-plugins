# dsh-plan-tab-autoclose

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

计划评审点「同意执行」、计划模式退出后，自动关闭该会话右侧边栏里的**全部**计划标签页（含多轮修订产生的多个）。

DSH 内置的 `@deepseek-ai/dsh-plan-mode` 会让每轮 `exit_plan_mode` 的计划在右侧栏占一个标签页（`kind === 'plan'`）。多轮修订会累积出好几个计划标签。本插件在计划模式退出（plan 投影 `active` 由真转假）时，把这个会话的计划标签一次性全关。

## 安装

```bash
dsh plugin --profile web add dsh-plan-tab-autoclose
```

装完重启 `dsh web`（新增插件行需要重新组合 profile；只是升级同版本号的话刷新页面就够）。

## 行为

- 监听当前屏幕会话的 `plan` 投影。
- 当 `active` 由**真**转**假**（例如计划评审点「同意执行」）时，关闭该会话右侧边栏里全部 `kind === 'plan'` 的标签。
- 一次全关：多轮修订累积的多个计划标签会在同一次退出时一起关掉。

## 边界

- **只作用于同一会话。** 其它会话的标签不动。
- **非计划标签不动。** `files`、终端等其它 `kind` 的标签不受影响。
- **手动 `/plan off` 也会触发。** 触发条件是「计划模式退出」，不限于点「同意执行」。
- **可从对话里的计划产物卡片重新打开。** 关闭只是收起右侧标签，不会删除计划本身；需要时仍能从对话中的计划卡片再打开。

## 已知限制

- **触发时机是计划模式退出，通常紧接批准。** 不是逐轮关闭，而是最终一次性关闭。
- **没有设置页。** 本插件没有可配项。

## 实现说明

- 宿主半侧（`src/index.ts`）为空实现，仅提供插件行，让 `dsh.client` 挂载客户端模块。
- 浏览器半侧（`src/client/*`）只使用公开的 `ctx.sessions` / `ctx.sidebarRight` 能力，不 import 任何 `@deepseek-ai/*` 运行时，也不依赖 DOM。
- 核心纯逻辑在 `src/client/autoclose.ts`，可在 node 里直接单测（`node --test test/autoclose.test.mjs`）。
