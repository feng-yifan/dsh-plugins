# dsh-plugins

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件 monorepo（pnpm workspace）。

## 包

| 包 | 说明 |
|---|---|
| `packages/dsh-vertical-layout` | 竖屏布局优化：电脑竖屏时把右侧栏移到顶部（原独立仓库迁入，历史见原仓库 git）。 |
| `packages/dsh-font-settings` | 字体设置：设置页插件卡提供「正文字体」与「等宽字体」两个可搜索下拉（`font-list` 跨平台枚举本机字体），覆盖 `--dsw-font-family` / `--ds-font-family-code`。 |
| `packages/dsh-ask-highlight` | 提问块高亮：已答复的「提问 n/n 已回答」工具块柔和卡片凸显（浅色底 + 圆角）。 |

## 开发

```bash
pnpm install          # 安装依赖（typescript 等）
pnpm run build        # 构建全部包（tsc 宿主 + 客户端 bundle 包装）
pnpm run verify       # 类型检查全部包
```

### 类型解析约定

客户端插件（dsh-font-settings）会 import `@deepseek-ai/dsh-client-*` 的类型。构建/类型检查所需的 `@deepseek-ai/*` 包以 **devDependencies** 提供（固定 0.1.7-rc.2，与全局 dsh 安装同版本），`pnpm install` 后即可在干净环境（含 CI）构建，无需手工符号链接；运行时由 DSH 宿主进程/浏览器模块表提供，构建产物保持 external。

### 发布到 npm

发布由 GitHub Actions 自动完成（OIDC trusted publishing + provenance，见 `.github/workflows/npm-publish.yml`）。流程：

1. 升级目标包的版本：`pnpm --filter dsh-font-settings version x.y.z`（或手改 `packages/<pkg>/package.json`），提交并推送。
2. 打标签并推送：`git tag dsh-font-settings@x.y.z && git push origin dsh-font-settings@x.y.z`（标签名 = 包名@版本，须与 package.json 的 version 一致）。
3. 工作流构建并 `publish --provenance --access public` 该包；也可在 Actions 页用 `workflow_dispatch` 手动补发。

前置（一次性）：在 npmjs.com 为 `dsh-font-settings`（及 `dsh-vertical-layout`）配置 Trusted Publisher，GitHub 仓库选 `feng-yifan/dsh-plugins`。

### 安装进 profile

```bash
# 在 dsh-plugins 仓库根执行（profile 名为 web）：
dsh plugin --profile web add ./packages/dsh-vertical-layout
dsh plugin --profile web add ./packages/dsh-font-settings
dsh plugin --profile web add ./packages/dsh-ask-highlight
```

本地路径安装为 link 依赖；profile 的 `dsh.profile.bundles` 会各追加一行。改动后 HMR 热重载，刷新浏览器生效；若客户端 bundle 未被拾取，重启 dsh web。
