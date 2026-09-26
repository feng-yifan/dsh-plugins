# dsh-font-settings

DSH（DeepSeek Harness）字体设置插件：**单独设置默认正文字体与等宽字体**，写入宿主设置文档，浏览器半侧实时应用到 `--dsw-font-family` / `--ds-font-family-code`。

## 功能

- **插件管理页 → 字体设置** 配置卡（表单）：两个可搜索下拉字段（**正文字体** / **等宽字体**），候选来自宿主枚举的本机字体列表（`font-list` 跨平台：macOS 预编译 CoreText 二进制 / Windows PowerShell / Linux fc-list），输入即过滤、点选或回车选定；字段下方各有一个带「预览」label 的样例块（正文 / 代码），跟随暂存文本实时刷新。
- 每个字段有「已设置」徽标与「恢复默认」；编辑只改草稿，「保存」是落库唯一入口（与 DSH 设置表单同一套暂存→保存语义）。
- 输入任意字体家族名即生效（下拉失败时降级为自由输入）；留空 = 不覆盖，沿用 DSH 默认字体栈（选中文字体如「Source Han Sans CN」可得全角引号）。
- 持久化到宿主设置文档（profile patch），与 DSH 官方设置（主题、字号）同一套机制。

## 安装

```bash
dsh plugin --profile web add ./packages/dsh-font-settings
```

## 架构

- **宿主半侧**（`src/index.ts`）：导出 schemastery `Config`（`uiFont` / `monoFont`，volatile 字段）→ 宿主设置文档把条目 `dsh-font-settings` 暴露为同名命名空间；另注册 `FontsController`（`TypertRemoteService`，wire 命名空间 `dshFonts`），`@Remote list()` 经 `font-list` 枚举本机字体族名并缓存，浏览器侧同源 `POST /api/dshFonts/list` 调用。
- **浏览器半侧**（`src/client/`）：绑定命名空间 scope，快照变更时应用主题变量；注册 `plugins.bundle.config` 槽位的字体设置卡。`FontCombobox` 复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`/`Input`/`Tag` 搭建可搜索下拉，不手写下拉逻辑；`fontCatalog.ts` 负责拉取/缓存/过滤字体列表。
- **客户端 bundle**：`tsc` 产物（CommonJS）经 `scripts/build-client.mjs` 内联为 `window.__ModuleLoader__.load({ id, factory })` 包裹，输出 `lib/client.js`。

## 开发

```bash
pnpm install        # 安装 devDeps + font-list
pnpm build          # 宿主 tsc + 客户端 tsc + 包裹 → lib/
pnpm verify         # 两侧 --noEmit 类型检查
```

### 宿主运行时解析 @deepseek-ai

宿主半侧 `import z from '@deepseek-ai/schemastery'`、`import { getFonts } from 'font-list'` 需要宿主进程能解析。本机约定两个符号链接（`pnpm install` 重建 `node_modules` 后需重做，见仓库根 README）：

```bash
# 仓库根：@deepseek-ai → 运行中 profile 的 @deepseek-ai（与运行时同版本）
ln -s ~/.dsh/profiles/node_modules/@deepseek-ai node_modules/@deepseek-ai
# 包内：@deepseek-ai → 全局 dsh 安装的 @deepseek-ai（客户端类型/编译用，含 dsh-client-store 等）
ln -s /home/viktor/dev/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai packages/dsh-font-settings/node_modules/@deepseek-ai
```

## 备注

- 字体列表每页面会话拉取一次并缓存；宿主侧 Promise 缓存，重复调用即时返回。
- 引号宽度问题背景：DSH 默认界面栈里 U+2018–201D 优先命中拉丁字体（本机为 Segoe UI，约占汉字宽 38%）；中文字体（Source Han Sans CN 等）提供 1em 全角引号。
