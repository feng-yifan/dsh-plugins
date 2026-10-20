# dsh-ask-highlight

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

DSH 提问块高亮：把对话线程里**已答复**的「提问 n/n 已回答」工具块用柔和卡片凸显（浅品牌色底 + 圆角，明暗主题自适应），并可让提问块默认展开。等待中的提问块（「等待回答」）与其它工具块外观不变。

## 安装

```bash
dsh plugin --profile web add dsh-ask-highlight
```

安装后刷新浏览器即可看到效果；界面没变化就重启 `dsh web`。

## 配置

装好后在 **设置 → 插件 → 提问块高亮** 里配置，两个开关：

| 开关 | 默认值 | 说明 |
| --- | --- | --- |
| 高亮已答复的提问块 | 开 | 总开关。关掉后既不注入高亮样式，也不注入展开脚本 |
| 提问块默认展开 | 关 | 打开后，线程里每个提问块（等待回答 / 已答复 / 已取消）首次出现时自动展开 |

改完点「保存」，**刷新页面生效**（不需要重启 `dsh web`）。

配置存在当前 profile 目录里：

```
$DSH_HOME/profiles/<profile>/fengyifan-dsh-ask-highlight/state.json
```

设置页底部会显示实际路径。不同 profile 各有一套配置。

`cordis.patch.yml` 里也可以写这两个字段，但**它只是首次建立 state.json 的种子**：一旦设置页写过配置，就以 state.json 为准，不会再被 profile 文件覆盖回去。

### 为什么要单独存一份状态

`cordis.patch.yml` 是组合层的声明文件，插件在运行时改它会触发 Loader 重载整条插件链。本插件的两个开关只影响「注入什么」，存在自己的状态文件里、由 `webserver/index-inject` 每次渲染时读最新值即可，代价小得多。这也是 `dsh-enhancement` 采用的做法。

## 已知取舍

- 已取消的提问块（状态同为已结束，文案「已取消」）也会被高亮；严格区分需要读文案，本插件不做。
- 配色取自 DSH 主题令牌（`--dsw-alias-state-business-primary`），因此跟随亮色 / 暗色主题自动适配。
- 展开态四边留白统一 8px：内层内容卡自带的 `margin: 4px 0 4px 4px` 被抹平，常态隐藏的「检查」按钮改为绝对定位浮层，不再在卡片底部垫出空白。
- 「默认展开」依赖 DSH 的 `data-*` 契约（`data-tool`、`data-disclosure-row`、`data-disclosure-header`、`data-open`、`aria-expanded`、`data-chat-call-id`）。DSH 若改这些属性，展开会静默失效，但高亮样式不受影响。
- 折叠态的提问明细根本不在 DOM 里，所以展开复用 DSH 自己的展开动作（脚本对披露行点一次），而不是用 CSS 硬撑。记账按 **DOM 节点**（`WeakSet`，只在页面内存里，不落盘、刷新即清空），因此：块出现时默认展开；**在当前块上手动收起后不会被再次展开**（否则流式输出、滚动引起 DOM 变更时脚本会反复把它点开）；**刷新页面或切换会话后会重新展开**——切换会话时 DSH 卸载并重建子树，节点是新的，自然算新块。

## 版本适配

本插件不声明任何 `@deepseek-ai/dsh-*` peerDependencies，因此不受 DSH 版本门禁约束。
