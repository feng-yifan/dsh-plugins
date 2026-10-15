# dsh-pwa-icon

DSH PWA 图标：把 Web GUI **安装 / 添加到桌面**时的应用图标换成你指定的图片。

Chromium 的 PWA 安装图标只取 Web App Manifest 的 `icons`（当前 DSH 前端 dist 的 manifest 只声明了自己的 `favicon.svg`，所以装出来是 DSH logo）；改 favicon 或 apple-touch-icon 都不影响它。本插件接管 manifest 路由，把 `icons` 换成配置的图片，并顺带注入 iOS「添加到主屏幕」用的 `apple-touch-icon`。

## 原理

宿主侧插件，无客户端 bundle，不依赖任何 `@deepseek-ai/*` 运行时包：

1. 注册 exact 路由 `/manifest.webmanifest`（可用 `manifestUrl` 改），返回按 config 生成的 manifest：默认字段对齐当前发布版（`name` / `short_name` / `start_url` / `scope` / `display`），`icons` **替换**为配置图片（追加会让浏览器可能挑回 SVG，故替换）；
2. 注册 exact 路由 `/pwa/icon.<ext>`（可用 `iconUrl` 改），按请求读取配置的图片文件并给出正确 `content-type`；文件缺失返回 404，不改动磁盘；
3. 经 `webserver/index-inject` 注入 `<link rel="apple-touch-icon">`（可用 `appleTouchIcon: false` 关闭），并用 `webServer.tapIndex` 把页面原有的 `<link rel="manifest">` 换成指向本插件路由的那一个——将来 DSH 换 manifest 文件名时不会静默失效；
4. 未配置 `icon` 时只打一条 warn、不注册任何路由，不影响启动；`icon` 指向的文件当前不存在也只 warn（路由照常注册，文件随后出现即生效）；`manifestUrl` / `iconUrl` 不是以 `/` 开头的绝对路径、或两者相同 → warn 后放弃加载（命名路由按 pathname 精确匹配，非法路径会静默永不命中）。

Chromium 的安装判定要求图标为 PNG / SVG / **WebP** 且 ≥144px，并且 **`sizes` 属性必须显式声明**（原文：`Manifest does not contain a suitable icon - PNG, SVG or WebP format of at least 144px is required, the sizes attribute must be set, and the purpose attribute, if set, must include "any" or "maskable".`）。因此位图务必在配置里写真实尺寸。

## 安装

```bash
# 在 dsh-plugins 仓库根执行（profile 名为 web）：
pnpm --filter dsh-pwa-icon build          # link 安装不会跑 prepare，先构建
dsh plugin --profile web add ./packages/dsh-pwa-icon
```

本地路径安装为 link 依赖；profile 的 `dsh.profile.bundles` 会追加一行。

**生效方式**：DSH 内置 `dsh-hmr`（`dsh-base` 的 `hmr` 行，在带 profile 上下文的组合里默认启用），它监听 profile 的 `cordis.patch.yml` 与 `package.json` → 安装/改配置后**热重载组合，无需重启 `dsh web`**；`root: []` 只是关掉「插件源码目录」监听，因此**改本插件源码后要 `pnpm build` 并触发一次重载或重启**才会生效。若某个组合显式禁用了 HMR，则一律在下次重启生效。

## 配置

在 profile 的 `cordis.patch.yml` 里给出图片路径（不配置则插件不生效）：

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    icon: /home/viktor/Downloads/400x400bb-75.webp
    sizes: 400x400
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `icon` | 无 | 图片文件路径（建议绝对路径；相对路径按 dsh 进程工作目录解析）。**不配置则插件不生效** |
| `sizes` | SVG 为 `any`，其它格式为 `any` + warn | manifest icon 的 `sizes`，位图请写真实尺寸 |
| `type` | 按扩展名判定 | 只接受 `image/*`（否则 warn 并回落到扩展名判定）；`.webp` / `.png` / `.jpg` / `.jpeg` / `.svg` / `.gif` / `.avif` / `.ico` |
| `purpose` | `any` | manifest icon 的 `purpose` |
| `iconUrl` | `/pwa/icon<扩展名>` | 图片对外 URL 路径（必须以 `/` 开头，且与 `manifestUrl` 不同） |
| `manifestUrl` | `/manifest.webmanifest` | manifest 对外 URL 路径（必须以 `/` 开头） |
| `manifest` | 无 | 合并进 manifest 的额外字段（覆盖默认值）；若显式给出 `icons` 数组则完全按它来 |
| `appleTouchIcon` | `true` | 是否注入 `<link rel="apple-touch-icon">` |

## 注意事项

- **已安装的 PWA 不会自动换图标**：安装图标是安装时抓取的，需先从浏览器卸载（或删除桌面快捷方式），再从菜单重新「安装 / 添加到桌面」。
- **iOS 的 `apple-touch-icon` 建议另配 PNG**：Safari 对该链接的 WebP 支持有限、且通常期望 180×180 的 PNG；本插件只按原样提供配置的那张图，不做缩放/转码（Chromium 侧走 manifest，WebP 没问题）。
- **两个路由都是公开静态路由**：浏览器取 manifest 图标不带凭据，加认证门会导致取不到图标，因此图片对能访问该端口的网络可见（与现有 favicon、dist manifest 同性质）。若需收敛，可把 `iconUrl` 改成带随机令牌的路径。
- **子路径部署需自行调整**：默认 `iconUrl` / `manifestUrl` / manifest 的 `start_url`、`scope` 都按「GUI 挂在 origin 根」写绝对路径；若将来经反代挂到 `/dsh/` 这类前缀下，需要用 config 改成对应前缀（dist 自身用 `./` 相对链接 + `<base href="./">`）。
- 换图无需重启：图片路由每次请求重新读取。

## 版本适配

本包不声明任何 `@deepseek-ai/dsh-*` peerDependencies，因此不受 DSH 版本门禁约束（判定只看这类 peer）；只依赖 `webServer.register` / `webServer.tapIndex` / `webserver/index-inject` 三个稳定接口。
