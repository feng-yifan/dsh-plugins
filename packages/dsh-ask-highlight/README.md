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

`cordis.patch.yml` 里也可以写这两个字段，但它只是首次建立 state.json 的种子：一旦设置页写过配置，就以 state.json 为准，不会再被 profile 文件覆盖回去。

## 已知限制

- 已取消的提问块（状态同为已结束，文案「已取消」）也会被高亮。
- 配色跟随 DSH 亮色 / 暗色主题自动适配。
- 展开态四边留白统一为 8px。
- 「默认展开」依赖 DSH 的 DOM 约定；DSH 若改动这些属性，展开会静默失效，但高亮样式不受影响。
- 开启「默认展开」后：提问块出现时自动展开；在当前块上手动收起后不会被再次展开；刷新页面或切换会话后会重新展开。
