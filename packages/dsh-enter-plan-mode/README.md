# dsh-enter-plan-mode

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

给 DSH 补一个**模型可调用**的「进入计划模式」工具 `dsh_enter_plan_mode_enter_plan_mode`。

模型遇到「先想清楚再动手」的任务时，可以用这个工具把当前会话切进计划模式，先做非破坏性探索，再用内置的 `exit_plan_mode` 把方案交给你评审。

## 安装

```bash
dsh plugin --profile web add dsh-enter-plan-mode
```

装完重启 `dsh web`（新增插件行需要重新组合 profile；只是升级同版本号的话刷新页面就够）。

## 前置条件

profile 里需要有 `@deepseek-ai/dsh-plan-mode`。`dsh-base` 默认带，一般不用管；缺了本插件照样加载，只在工具被调用时返回一条说明缺什么。

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

「下一步生效」不是异常，模型当下即可开始规划。

## 已知限制

- **引导而非强制。** 计划模式只靠提示词约束，不限制任何工具；需要强制限制请另外配沙箱模式与审批策略。
- **只切当前会话。** 工具作用于发起调用的 agent 的会话，子 agent 各有独立的计划模式状态。
- **不提供离开方向的工具。** 退出请用上游的 `exit_plan_mode`。
- **没有设置页。** 本插件没有可配项。
