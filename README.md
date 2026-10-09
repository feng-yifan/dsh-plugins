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

客户端插件（dsh-font-settings）会 import `@deepseek-ai/dsh-client-*` 的类型。构建/类型检查所需的 `@deepseek-ai/*` 包以 **devDependencies** 提供，固定为你当前运行的 dsh 精确版本（现为 `0.2.1-alpha.1`，与全局 dsh 安装同版本），`pnpm install` 后即可在干净环境（含 CI）构建，无需手工符号链接；运行时由 DSH 宿主进程/浏览器模块表提供，构建产物保持 external。

升级本地 dsh 后应同步这批 devDependencies（见下节「DSH 版本适配」）。

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

## DSH 版本适配

### DSH 怎么判定插件兼容

DSH 在组合 profile 前读取每个插件的 `peerDependencies`，把其中名为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项与运行中的 dsh 版本比较（预发布版本参与范围匹配）。**未声明这类 peer 的插件不受版本约束**；`engines` 不参与判定。任一 peer 不满足，该插件行会被置为 `disabled` 且模块永不导入；组合包（bundle）不兼容则整体被跳过。安装时同样检查——不兼容的包在 pnpm 运行前就被拒绝。

因此 `@deepseek-ai/dsh-*` 的 peer 范围就是插件的**支持矩阵**：范围覆盖哪个版本，就等于声明支持哪个版本。

### 本地命令

```bash
pnpm compat                                   # 用本机 dsh 判定全部插件（退出码 1 = 会被拒绝加载）
pnpm compat -- --runtime 0.2.1-alpha.2 --json # 针对指定版本预检，JSON 输出
pnpm compat:update -- --runtime 0.3.0-rc.1    # 只打印需要追加的 peer 波带（dry-run）
pnpm compat:update -- --runtime 0.3.0-rc.1 --write   # 落盘
pnpm smoke -- --package dsh-font-settings     # 一次性 DSH_HOME 里真启动 dsh web 验证插件被加载
```

判定函数取自已安装的 dsh（`--dsh`/`$DSH_BIN` 可指定），保证判定与被测运行时同版本。

**放宽范围前必须先验证**：`pnpm verify`（对目标版本的宿主类型编译）+ `pnpm smoke` 都通过，才把新波带写进 peer 范围——否则等于凭空声明支持。

### 流水线自动适应

[`.github/workflows/dsh-compat.yml`](.github/workflows/dsh-compat.yml) 每周（及手动 / `repository_dispatch`）对 `latest` 与 `alpha` 两个渠道执行：

1. 解析目标 dsh 版本；
2. 按该版本装宿主类型并 `pnpm -r verify`（抓 API 断裂）；
3. `check-compat` 预检 peer 范围；
4. 若仅范围过期且 2 通过：`update-peer-ranges --write` → 复跑 verify → 用目标版本跑 smoke → 全绿则开 PR（`chore: support dsh <version>`）；
5. 任一步失败 → 开 issue 并失败，**不自动改代码**。

豁免（`dsh plugin allow-version … --accept-risk`）刻意保留为人工操作：它要求明确接受崩溃/数据损坏风险，插件升级与 dsh 升级都不继承。
