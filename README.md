# dsh-plugins

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件 monorepo（pnpm workspace）。

## 包

| 包 | 说明 |
|---|---|
| `packages/dsh-vertical-layout` | 竖屏布局优化：电脑竖屏时把右侧栏移到顶部（原独立仓库迁入，历史见原仓库 git）。 |
| `packages/dsh-font-settings` | 字体设置：设置页插件卡提供「正文字体」与「等宽字体」两个可搜索下拉（`font-list` 跨平台枚举本机字体），覆盖 `--dsw-font-family` / `--ds-font-family-code`。 |

## 开发

```bash
pnpm install          # 安装依赖（typescript 等）
pnpm run build        # 构建全部包（tsc 宿主 + 客户端 bundle 包装）
pnpm run verify       # 类型检查全部包
```

### 类型解析约定

客户端插件（dsh-font-settings）会 import `@deepseek-ai/dsh-client-*` 的类型。为与运行中的 DSH 保持同版本（0.1.7-rc.1），tsconfig 的 `paths` 把 `@deepseek-ai/*` 指向全局 dsh 安装的编译产物（`lib/types/*.d.ts`），不安装任何 `@deepseek-ai` 运行时依赖——运行时由 DSH 浏览器的模块表（module table）提供，构建时保持 external。

### 安装进 profile

```bash
# 在 dsh-plugins 仓库根执行（profile 名为 web）：
dsh plugin --profile web add ./packages/dsh-vertical-layout
dsh plugin --profile web add ./packages/dsh-font-settings
```

本地路径安装为 link 依赖；profile 的 `dsh.profile.bundles` 会各追加一行。改动后 HMR 热重载，刷新浏览器生效；若客户端 bundle 未被拾取，重启 dsh web。
