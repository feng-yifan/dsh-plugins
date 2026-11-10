# dsh-enter-plan-mode

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Gives DSH a **model-callable** "enter plan mode" tool, `dsh_enter_plan_mode_enter_plan_mode`.

When a task calls for thinking before acting, the model can use this tool to switch the current session into plan mode, explore non-mutatively, then hand the finished plan back for your review through the built-in `exit_plan_mode`.

## Install

```bash
dsh plugin --profile web add dsh-enter-plan-mode
```

Restart `dsh web` afterwards (a new plugin row needs the profile recomposed; a same-version upgrade only needs a page refresh).

## Prerequisite

`@deepseek-ai/dsh-plan-mode` must be in the profile. `dsh-base` includes it, so usually nothing to do. Without it the plugin still loads and the tool reports exactly what is missing when called.

## Tool

| Tool | Arguments | Effect |
| --- | --- | --- |
| `dsh_enter_plan_mode_enter_plan_mode` | none | Switches the current session into plan mode |

After a call the model receives one of three status lines:

| Situation | What the model sees |
| --- | --- |
| Already in force | Plan mode is active for this session. … |
| Switched mid-turn, applies next step | Plan mode is switched on for this session and applies from your next step. … |
| Not switched | Plan mode was not switched on for this session. … |

"Applies from your next step" is normal, not an error; the model can start planning right away.

## Known limitations

- **Guidance, not enforcement.** Plan mode is enforced by prompt text only; it restricts no tool. Use sandbox mode and approval policy for hard limits.
- **Current session only.** The tool acts on the calling agent's session. Subagents each have their own plan-mode state.
- **No exit tool.** Use upstream's `exit_plan_mode` to leave.
- **No settings page.** There is nothing to configure.
