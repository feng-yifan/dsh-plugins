# dsh-ask-highlight

**简体中文** | [English](README.en.md)

DSH 提问块高亮：把对话线程里**已答复**的「提问 n/n 已回答」工具块用柔和卡片凸显（浅品牌色底 + 圆角，明暗主题自适应）。等待中的提问块（「等待回答」）与其它工具块外观不变。

## 安装

```bash
dsh plugin --profile web add dsh-ask-highlight
```

安装后刷新浏览器即可看到效果；界面没变化就重启 `dsh web`。

## 配置

默认开启。可在 profile 的 `cordis.patch.yml` 里关闭：

```yaml
- id: dsh-ask-highlight
  name: dsh-ask-highlight
  config:
    enabled: false
```

## 已知取舍

- 已取消的提问块（状态同为已结束，文案「已取消」）也会被高亮；严格区分需要读文案，本插件不做。
- 配色取自 DSH 主题令牌（`--dsw-alias-state-business-primary`），因此跟随亮色 / 暗色主题自动适配。

## 版本适配

本插件不声明任何 `@deepseek-ai/dsh-*` peerDependencies，因此不受 DSH 版本门禁约束。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
