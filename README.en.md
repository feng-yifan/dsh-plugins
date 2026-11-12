# dsh-plugins

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (pnpm monorepo).

## Plugins

| Plugin | What it does |
| --- | --- |
| [`dsh-vertical-layout`](packages/dsh-vertical-layout) | Portrait layout: on a portrait desktop window, moves the file / terminal panel above the conversation; its height is draggable |
| [`dsh-ask-highlight`](packages/dsh-ask-highlight) | Ask-block highlight: answered "question n/n answered" tool rows get a soft card look; optional expand-by-default, configurable in Settings |
| [`dsh-pwa-icon`](packages/dsh-pwa-icon) | PWA icon: sets the icon (and manifest app name) used when the Web GUI is installed or added to the desktop, on both desktop browsers and the iOS home screen; ships a default icon set that works with no configuration |
| [`dsh-enhancement`](packages/dsh-enhancement) | Remote-access password gateway (HTTPS/password) + PWA install/icons + desktop notifications + PWA Web Push; coexists with the 3081 entry |
| [`dsh-enter-plan-mode`](packages/dsh-enter-plan-mode) | Enter-plan-mode tool: gives the model a callable `dsh_enter_plan_mode_enter_plan_mode` that pairs with the built-in `exit_plan_mode` to close the plan-then-review loop |
| [`dsh-alertmanager`](packages/dsh-alertmanager) | AlertManager alerts panel (multi-instance): reads live alerts from several v2 instances in parallel, aggregates them, and dispatches selected alerts into a new Session in a chosen Workspace so the agent starts immediately |
| [`dsh-at-enhancement`](packages/dsh-at-enhancement) | External @ file references: lets @ completion browse and reference absolute-path files outside the workspace, level by level |
| [`dsh-plan-tab-autoclose`](packages/dsh-plan-tab-autoclose) | Auto-close plan tabs: after approving a plan (plan mode exits), close every plan tab of that session in the right sidebar, including tabs left by earlier revision rounds |
| [`dsh-font-settings`](packages/dsh-font-settings) | **Deprecated**: DSH 0.2.x has built-in font settings; the source is kept as a reference implementation |

See each plugin's README for usage (Chinese and English).

## Install

```bash
dsh plugin --profile web add dsh-vertical-layout
dsh plugin --profile web add dsh-ask-highlight
dsh plugin --profile web add dsh-pwa-icon
dsh plugin --profile web add dsh-enhancement
dsh plugin --profile web add dsh-enter-plan-mode
dsh plugin --profile web add dsh-alertmanager
dsh plugin --profile web add dsh-at-enhancement
dsh plugin --profile web add dsh-plan-tab-autoclose
```

Plugins install from npm. Plugins that need configuration take a `config` block in the profile's `cordis.patch.yml`; see each plugin's README for the fields. Config changes hot-reload automatically; if the UI does not change after upgrading a plugin, restart `dsh web` (client-style-only plugins just need a browser refresh).
