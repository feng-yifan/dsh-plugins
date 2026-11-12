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
| [`dsh-alertmanager`](packages/dsh-alertmanager) | AlertManager 告警面板（多实例）：并行读取多个 v2 实例的实时告警并聚合，多选后在指定工作区新建会话，让 agent 立即开始处理 |
| [`dsh-at-enhancement`](packages/dsh-at-enhancement) | 外部 @ 文件引用：让 @ 补全可逐级浏览并引用工作区外的绝对路径文件 |
| [`dsh-plan-tab-autoclose`](packages/dsh-plan-tab-autoclose) | 计划标签页自动关闭：计划评审点「同意执行」、计划模式退出后，自动关闭该会话全部计划标签页（含多轮修订产生的多个） |
| [`dsh-font-settings`](packages/dsh-font-settings) | **已废弃**：DSH 0.2.x 起内置字体设置，源码仅作参考实现 |

每个插件的用法见各自 README（中英双语）。

## 安装

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

插件从 npm 安装。需要配置的插件在 profile 的 `cordis.patch.yml` 里写 `config`，具体字段见各插件 README。改配置会自动热重载；升级插件后界面没变化就重启 `dsh web`，纯客户端样式类插件刷新浏览器即可。
