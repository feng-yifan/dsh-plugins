# dsh-ask-highlight

DSH 提问块高亮：把对话线程里**已答复**的「提问 n/n 已回答」工具块用柔和卡片样式凸显（浅品牌色底 + 圆角，明暗主题自适应）。等待中的提问块（「等待回答」）与其它工具块外观不变。

## 原理

「提问」块由 `dsh-client-ui-tool` 渲染，根节点带稳定属性 `data-tool="ask_user_question"` 与 `data-state`（已答复/已取消为 `ok`，等待中为 `running`）。本插件经 `webserver/index-inject` 注入一段 `<style>`，用 `[data-tool="ask_user_question"][data-state="ok"]` 属性选择器定位，不依赖 CSS Modules 哈希类名；颜色使用 `--dsw-alias-state-business-primary` 主题令牌 + `color-mix`，明暗主题自适应。宿主侧实现，无客户端 bundle。

## 安装

```bash
# 在 dsh-plugins 仓库根执行（profile 名为 web）：
dsh plugin --profile web add ./packages/dsh-ask-highlight
```

本地路径安装为 link 依赖；profile 的 `dsh.profile.bundles` 会追加一行。样式随 index.html 渲染注入，刷新浏览器生效；若未生效，重启 dsh web。

## 配置

默认开启。可在 profile 的 `cordis.patch.yml` 里通过 config 关闭：

```yaml
- id: dsh-ask-highlight
  name: dsh-ask-highlight
  config:
    enabled: false
```

## 已知取舍

- 已取消的提问块（`data-state` 同为 `ok`，文案「已取消」）也会被高亮；严格排除需引入 JS 检查文案，本插件不做。
