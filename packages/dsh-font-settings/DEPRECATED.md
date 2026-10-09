# 已废弃：dsh-font-settings

**废弃日期**：2026-10-10

**原因**：DSH 0.2.x 起 `@deepseek-ai/dsh-client-ui-theme` 原生支持字体设置，且是本插件的超集：

| 原生字段 | 作用 |
|---|---|
| `textFontFamily` | 界面与会话正文 |
| `codeFontFamily` | 代码块、行内代码等使用 `--ds-font-family-code` 的文本 |
| `terminalFontFamily` | 侧栏终端 |

设置页有对应输入行，接受逗号分隔的字体名，失焦或回车提交，清空即恢复内置字体栈。插件此前只有「正文 + 等宽」两档，且需要自建 `FontsController` 经 `font-list` 枚举本机字体；原生实现由宿主内嵌到 index 响应，首帧即生效，无需额外插件。

**替代做法**：用 DSH 内置设置，或在 profile 的 `ui-theme` 行直接配置：

```yaml
- id: ui-theme
  name: "@deepseek-ai/dsh-client-ui-theme"
  config:
    textFontFamily: '"思源黑体 CN"'
    codeFontFamily: '"Maple Mono NF CN"'
    terminalFontFamily: '"Maple Mono NF CN"'
```

**本包状态**：

- 不再发布新版本（`npm-publish.yml` 已摘除其 tag 触发与手动发布列表）。npm 上的 deprecated
  标记须人工在包页 Settings → Deprecate 执行——OIDC Trusted Publishing 不覆盖 `npm deprecate`
  （2026-10-10 在 npm 12.2.0 上实测 PUT 未认证返回 404）；
- 已从 CI 的版本适配中摘除：`scripts/check-compat.mjs` / `scripts/update-peer-ranges.mjs` 遇到本目录的 `DEPRECATED.md` 会跳过该包，`dsh-compat.yml` 不再为它做目标版本类型检查与 smoke；
- `npm-publish.yml` 不再接受 `dsh-font-settings@*` 的 tag 触发，也不在手动发布列表中；
- 源码保留在本目录，仅作参考实现（宿主设置命名空间 + Typert remote + 客户端表单那一套的样例），**不再保证与新版 DSH 兼容**。
