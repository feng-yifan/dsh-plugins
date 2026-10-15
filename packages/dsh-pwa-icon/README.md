# dsh-pwa-icon

**简体中文** | [English](README.en.md)

把 DSH Web GUI **安装 / 添加到桌面**时的应用图标换成你要的图（桌面浏览器与 iOS 主屏幕都覆盖）。

- **装完即用**：包内自带一组图标（192 / 512 / maskable 512 / 1600，另加 iOS 用的 180 PNG），不需要任何配置。
- **可换成自己的图**：配置 `icon` 指向你的图片文件即可。
- **可改应用名**：manifest 的 `short_name` 默认是 `DSH`（安装后显示为桌面快捷方式 / 主屏标签），用 `manifest.short_name` 覆盖。

## 安装

```bash
dsh plugin --profile web add dsh-pwa-icon
```

## 配置（可选）

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    icon: /path/to/icon.webp          # 换成自己的图；不写则用包内图标集
    sizes: 512x512                    # 配了 icon 才需要：图片的真实像素尺寸
    manifest:
      short_name: DeepSeek Harness    # 桌面 / 主屏标签
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `icon` | 用包内图标集 | 自己的图片路径；配了它就只用这一个文件，`sizes` / `type` / `purpose` / `iconUrl` 才生效 |
| `sizes` | — | 配 `icon` 时填图片真实尺寸（如 `512x512`）；写错时浏览器可能不使用这张图标 |
| `type` | 按扩展名判断 | 只接受 `image/*` |
| `purpose` | `any` | 想让 Android 用自适应图标就填 `maskable` |
| `manifest` | — | 追加 / 覆盖 manifest 字段，例如 `short_name`、`name` |
| `appleTouchIcon` | `true` | 是否注入 iOS 用的 `apple-touch-icon` |
| `iconUrl` / `manifestUrl` / `publicBase` | — | 进阶：改图标或 manifest 的路由路径、反向代理挂载前缀，一般不用动 |

## 生效与更新

- **改配置**：保存 profile 的 `cordis.patch.yml` 后自动热重载，秒级生效。
- **升级插件版本**：热重载不保证重新导入模块——先核对实际输出（`curl <你的入口>/manifest.webmanifest`），没变化就重启 `dsh web`。
- **换图片文件**：图标每次请求重新读取，不用重启。
- **已经装好的 PWA 不会自动换图标或名字**：图标与名称都是「安装时」抓取的，需要先从浏览器卸载（或删掉桌面快捷方式 / 主屏图标），再重新「安装 / 添加到桌面」。

## 常见问题

- **装出来的图标是「站点徽标 + 应用名」的色块** → 浏览器没拿到可用的 manifest。确认你的入口下 `manifest.webmanifest` 能访问，并且里面 `icons` 的每个地址都返回 200。
- **配了 `icon` 之后图标 404** → 那个图片文件被移动或删除了（放在 `~/Downloads` 里就容易被清理）。换到稳定目录，或改用包内图标集。
- **图标路由是公开的** → 浏览器取图标不带凭据（与 favicon 同性质），配了 `icon` 就意味着这张图对能访问该端口的网络可见。
- **iOS** → 主屏标签取 manifest 的 `short_name`；图标优先用 `apple-touch-icon`（包内已提供 180×180 PNG、实底）；iOS 26 实测也会读 manifest 里的 WebP。
- **包内那组图标来自本仓库维护者**，随 npm 公开分发；要用自己的图请配 `icon`。

## 版本适配

本包不声明任何 `@deepseek-ai/dsh-*` peerDependencies，因此不受 DSH 版本门禁约束。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
