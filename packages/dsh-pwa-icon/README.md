# dsh-pwa-icon

DSH PWA 图标：把 Web GUI **安装 / 添加到桌面**时的应用图标换成你要的图。

Chromium 的 PWA 安装图标只取 Web App Manifest 的 `icons`（当前 DSH 前端 dist 的 manifest 只声明了自己的 `favicon.svg`，所以装出来是 DSH logo）；改 favicon 或 apple-touch-icon 都不影响它。本插件接管 manifest 路由，把 `icons` 换成**随包发布的图标集**（或你在 `icon` 里指定的图片），并注入 iOS「添加到主屏幕」用的 `apple-touch-icon`。

## 原理

宿主侧插件，无客户端 bundle，不依赖任何 `@deepseek-ai/*` 运行时包：

1. 注册 exact 路由 `/manifest.webmanifest`（可用 `manifestUrl` 改），返回按 config 生成的 manifest：默认字段对齐当前发布版（`name` / `short_name` / `start_url` / `scope` / `display`），`icons` **替换**成图标（追加会让浏览器可能挑回 SVG，故替换）。两种模式：
   - **包内图标集（`icon` 未配置，默认）**：用 `assets/` 里随包发布的一组——`192x192`、`512x512`、`maskable 512x512`（内容缩到 80% 居中、实底，符合 maskable 安全区）、`1600x1600` WebP，每条各自声明 `sizes` / `type` / `purpose`。这是规范做法：**一组不同尺寸**由浏览器按场景挑最合适的，而不是一张超大图（超大图每处都要缩放，且没有 maskable 安全区会被裁掉内容）；
   - **单图（配置了 `icon`）**：只用该文件，此时 `sizes` / `type` / `purpose` / `iconUrl` 生效。
2. 注册图标路由：包内集合每张一条（`/pwa/icon-192.png`、`/pwa/icon-512.png`、`/pwa/icon-maskable-512.png`、`/pwa/icon-1600.webp`），单图模式为 `/pwa/icon.<ext>`（可用 `iconUrl` 改）；按请求读取文件并给出正确 `content-type`，文件缺失返回 404，不改动磁盘；
3. 经 `webserver/index-inject` 注入 `<link rel="apple-touch-icon">`（可用 `appleTouchIcon: false` 关闭）：包内集用随包的 `apple-touch-icon-180.png`（PNG + `#FBFBFB` 实底，避免透明区域在 iOS 上变成黑角）；并用 `webServer.tapIndex` 把页面原有的 `<link rel="manifest">` 换成指向本插件路由的那一个——将来 DSH 换 manifest 文件名时不会静默失效；
4. `enabled: false` 才整体关闭；包内资产缺失只 warn（对应路由 404）；`icon` 指向的文件当前不存在也只 warn（路由照常注册，文件随后出现即生效）；`manifestUrl` / `iconUrl` 不是以 `/` 开头的绝对路径、或两者相同 → warn 后放弃加载（命名路由按 pathname 精确匹配，非法路径会静默永不命中）。

**挂载前缀（重要）**：`manifestUrl` / `iconUrl` 是**后端**路径（反向代理剥掉前缀后 DSH 看到的路径）；对外 URL 缺省一律用**相对形式**——注入的链接是 `./manifest.webmanifest`、`apple-touch-icon` 是 `./pwa/apple-touch-icon.png`、manifest 的 `start_url`/`scope` 是 `./`、`icons[].src` 是相对 manifest 的 `pwa/icon-192.png`，与 DSH 自带 dist manifest 同款。这样「根挂载」和「反向代理剥前缀」（如 DSH 经网关挂在 `/dsh` 下）两种部署都成立。

> 写死根绝对路径（`/manifest.webmanifest`、`start_url: "/"`）在 `/dsh` 这类挂载下会 404，浏览器取不到 manifest 与图标，只能回落到**自动生成的图标**（站点徽标 + 应用名的色块）——本机 2026-10-15 实际踩过。仅当页面不在挂载根时才用 `publicBase` 显式给出前缀。

Chromium 的安装判定要求图标为 PNG / SVG / **WebP** 且 ≥144px，并且 **`sizes` 属性必须显式声明**（原文：`Manifest does not contain a suitable icon - PNG, SVG or WebP format of at least 144px is required, the sizes attribute must be set, and the purpose attribute, if set, must include "any" or "maskable".`）。包内集合已各自声明真实尺寸；自定义单图时务必写对。

## 安装

```bash
dsh plugin --profile web add dsh-pwa-icon        # 从 npm 安装
```

**不配置任何东西就能用**：包内自带图标集，安装后 profile 的 `dsh.profile.bundles` 会追加一行，图标即生效。

> 从本地源码装（开发用）：先 `pnpm --filter dsh-pwa-icon build`，再 `dsh plugin --profile web add ./packages/dsh-pwa-icon`；link 依赖不会跑 `prepare`，必须先构建。

**生效方式**：DSH 内置 `dsh-hmr`（`dsh-base` 的 `hmr` 行，在带 profile 上下文的组合里默认启用），它监听 profile 的 `cordis.patch.yml` 与 `package.json` → 安装插件、改配置后**热重载组合，无需重启 `dsh web`**（实测配置改动秒级生效）。

但要注意：**热重载只重放配置，不会重新导入已经加载过的插件模块**——升级到新的包版本后必须**重启 `dsh web`** 才会生效（2026-10-15 实测：同一进程里改配置立即生效、换 `node_modules` 里的模块不生效）。若某个组合显式禁用了 HMR，则一律在下次重启生效。

## 配置

默认**不需要任何配置**。要换成自己的图：

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    icon: /path/to/icon.webp
    sizes: 512x512
```

只想改名字（iOS 的「添加到主屏幕」标签取 manifest 的 `short_name`，默认是 `DSH`）：

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    manifest:
      short_name: DeepSeek Harness
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `icon` | 无（用**包内图标集**） | 图片文件路径（建议绝对路径；相对路径按 dsh 进程工作目录解析）。配置后只用这一个文件，`sizes` / `type` / `purpose` / `iconUrl` 才生效 |
| `sizes` | 单图模式下缺省 `any` + warn（SVG 为 `any`） | manifest icon 的 `sizes`，位图请写真实尺寸（写错/不写时 Chromium 可能忽略该图标） |
| `type` | 按扩展名判定 | 只接受 `image/*`（否则 warn 并回落到扩展名判定）；`.webp` / `.png` / `.jpg` / `.jpeg` / `.svg` / `.gif` / `.avif` / `.ico` |
| `purpose` | `any` | manifest icon 的 `purpose`（要让 Android 自适应图标用安全区，写 `maskable`） |
| `iconUrl` | `/pwa/icon<扩展名>` | 单图模式下图片在**服务端**的路由路径（必须以 `/` 开头，且与 `manifestUrl` 不同）；对外 URL 缺省按相对路径发出 |
| `manifestUrl` | `/manifest.webmanifest` | manifest 在**服务端**的路由路径（必须以 `/` 开头）；对外 URL 缺省按相对路径发出 |
| `publicBase` | 无（用相对路径） | 浏览器看到的挂载前缀（如 `/dsh`），仅当页面不在挂载根时才需要；填了则对外 URL 用 `<publicBase><路由路径>` 绝对形式 |
| `manifest` | 无 | 合并进 manifest 的额外字段（覆盖默认值，例如 `short_name` / `name`）；若显式给出 `icons` 数组则完全按它来 |
| `appleTouchIcon` | `true` | 是否注入 `<link rel="apple-touch-icon">` |

## 注意事项

- **已安装的 PWA 不会自动换图标**：安装图标与名称都是安装时抓取的，需先从浏览器卸载（或删除桌面快捷方式/主屏图标），再重新「安装 / 添加到桌面」。
- **包内图标集随 npm 公开分发**：那组图来自本仓库维护者的图，任何人 `npm pack` 都能拿到；想用私图就配 `icon` 指向自己的文件。
- **`icon` 指向的文件别放在易失目录**：`~/Downloads` 被清理后图标路由立刻 404（本机 2026-10-15 实际踩过）——想要"永不失效"就用包内图标集，或把图放到稳定目录。
- **iOS 用 PNG 最稳**：Apple 文档里的 Web Clip 图标是 PNG（`apple-touch-icon`，常用 180×180、背景不透明）；包内集已提供 `apple-touch-icon-180.png`。自己配 `icon` 时若给 WebP，iOS 侧不保证（实测 iOS 26 会读 manifest 的 WebP 图标，但 Apple 文档只保证 PNG）。
- **所有图标路由都是公开静态路由**：浏览器取 manifest 图标不带凭据，加认证门会导致取不到图标，因此图片对能访问该端口的网络可见（与现有 favicon、dist manifest 同性质）。
- **先确认浏览器真的取到了 manifest 与图标**：若装出来的图标是"站点徽标 + 应用名"的色块，说明浏览器没拿到可用 manifest（多半是挂载前缀问题，见上「挂载前缀」）。可用 DevTools → Application → Manifest 看解析结果，或 curl `<前缀>/manifest.webmanifest` 并逐个 curl 其中的 `icons[].src`（应全部 200）。
- 换图无需重启：图标路由每次请求重新读取。

## 版本适配

本包不声明任何 `@deepseek-ai/dsh-*` peerDependencies，因此不受 DSH 版本门禁约束（判定只看这类 peer）；只依赖 `webServer.register` / `webServer.tapIndex` / `webserver/index-inject` 三个稳定接口。
