# dsh-enhancement

**简体中文** | [English](README.en.md)

DSH 增强套件：在 DSH Web 之外提供一个**独立的密码网关**，并整合 **PWA 安装/图标**、**桌面通知**与 **PWA Web Push**。适用于把 DSH 暴露到局域网、手机主屏或远程网络，同时不依赖 DSH 启动时打印的 `?token=`。

> 状态：Phase 1–4 已实现，Phase 5（文档/依赖/清理）进行中。当前默认不启用网关、不启用 PWA 推送；先在“设置 → 插件 → dsh-enhancement”里配置。

## 功能

设置页按**网关配置 / 访问控制 / PWA / 通知**分区展开，每个配置块有独立保存按钮、未保存提示和块内保存反馈；表单使用 DSH 的 `--dsw-alias-*` 设计变量。网关配置把监听、访问与 HTTPS 收在同一块，只保留一个保存动作。

### 1. 安全访问网关

- 独立监听地址/端口（默认 `3088`，默认关闭），可配置网卡 IP、密码、会话有效期。
- 密码只存 scrypt 哈希；登录失败按 IP 节流（可关）。普通请求**不做全局限流**，避免误伤 DSH 的静态资源/WS/SSE。
- 登录页复用 DSH 深色风格；网关会话 cookie 为 `HttpOnly; SameSite=Strict`，HTTPS 下加 `Secure`。
- **不需要 DSH `?token=`**：插件从 DSH 的 `credentials` 服务读取持久签名密钥，每次代理请求即时签发一个短时 `dsh-auth-*` cookie 注入上游；浏览器永远看不到它。
- 上游 Host 改写为 DSH 绑定地址并剥离 Origin；网关自己校验同源 / `Sec-Fetch-Site` / CSRF。这样不需要修改 `dsh-web.service` 的 `--trusted-host`。
- 支持 HTTP 与 WebSocket（`/api/remote.mux`）反向代理；SSE 不缓冲。

### 2. HTTPS

四种模式：

| 模式 | 说明 |
| --- | --- |
| `off` | 纯 HTTP（PWA 安装/推送不可用） |
| `uploaded` | 上传证书链 + 私钥，直接使用 |
| `ca` | 上传 CA 证书 + CA 私钥，由插件为当前监听地址签发 leaf |
| `selfsigned` | 插件生成本地 CA + leaf，并提供 CA 证书下载 |

- 私钥写入 `$DSH_HOME/profiles/<profile>/fengyifan-dsh-enhancement/tls/`（仅当前用户可读）。
- 自签/私有 CA 需要设备安装并信任 CA：iOS 在“设置 → 通用 → VPN 与设备管理”安装描述文件，再到“关于本机 → 证书信任设置”开启完全信任；Android 在“安全 → 加密与凭据 → 安装证书”安装。
- 上传证书的 SAN 必须覆盖访问地址/IP，否则浏览器会报证书错误。

### 3. PWA

- 接管 `/manifest.webmanifest`、图标路由、`apple-touch-icon`、`/sw.js` 与安装提示；取代 `dsh-pwa-icon`。
- 默认图标集：192/512 `any`、512 `maskable`、1600 WebP、iOS 180。
- 桌面/安卓/iOS 没有 OS 专用的 manifest 图标字段；效果通过 `any`（桌面）+ `maskable`（Android 自适应）+ `apple-touch-icon`（iOS，优先级最高）组合实现。
- Chromium/Edge 支持 `beforeinstallprompt`，页面会显示 DSH 风格的安装浮层；iOS 只能显示“分享 → 添加到主屏幕”的手动指引。
- PWA 安装、Service Worker、Web Push 都要求 HTTPS（localhost 例外）。

### 4. 通知（桌面 + PWA 推送）

- 原生通知通道：Linux 调用 `notify-send --action`（因为 `node-notifier@11.0.0` 的 Linux 后端不透传 actions/click），macOS/Windows 使用 `node-notifier`。
- 点击原生通知时优先通过 SSE 通知已打开的 DSH 页面：页面 `window.focus()` 后调用 `uiWorkspace.openSession(id)`，不再新开标签页；没有已打开页面时才回退到 `<网关或 DSH>/?dsh-session=<id>` 深链。PWA 通知仍由 Service Worker 聚焦已有窗口或打开新窗口。
- 通知事件（默认开启）：任务完成、等待回答、等待审批、审批被拒绝、子任务结束、目标完成/受阻、后台任务结束（仅未 await 的后台任务，避免每条命令都弹）。事件勾选同时作用于桌面通知和 PWA 推送；两个渠道在设置页独立开关。
- 生命周期事件来自 DSH 公共事件：`agent/status`、`session/event`（`tool/call` / `approval/*`）、`subagent/end`、`goal/changed`、`jobs.events`。
- PWA 推送：`web-push` + VAPID；订阅记录与 VAPID 私钥存 `state.json`（仅当前用户可读）。VAPID subject 只是推送服务要求的联系方式，收在高级选项，默认值即可。
- PWA 推送必须 HTTPS；iOS/iPadOS 16.4+ 且必须“添加到主屏幕”，权限必须由用户点按钮触发。设置页提供“订阅本设备 / 取消订阅 / 发送测试推送”，并显示当前通知权限和订阅数。


## 安装

从 npm：

```bash
dsh plugin --profile web add dsh-enhancement
```

插件行由包内 `cordis.patch.yml` 自动插入；`dsh-web-mobile`、`dsh-vertical-layout` 也由同一个 patch 一并插入，**不要**在 profile 里再重复启用这两个 bundle。

本机开发（link 源码）：

```bash
cd ~/dev/projects/github/fengyifan/dsh-plugins
pnpm --filter dsh-enhancement build
cd ~/.dsh/profiles/web
pnpm add link:../../dev/projects/github/fengyifan/dsh-plugins/packages/dsh-enhancement
```

profile 的 `dsh.profile.bundles` 加入 `dsh-enhancement`；mobile/vertical 不用再单独加入。

## 配置

打开 DSH → 设置 → 插件 → `dsh-enhancement`。运行配置与秘密都在：

```
$DSH_HOME/profiles/<profile>/fengyifan-dsh-enhancement/state.json   # 仅当前用户可读：密码哈希、网关签名密钥、VAPID、订阅
$DSH_HOME/profiles/<profile>/fengyifan-dsh-enhancement/tls/         # 仅当前用户可读：证书与私钥
```

插件行本身只负责加载；`cordis.patch.yml` 不存放密码/私钥。

## 与现有入口共存

- 本插件默认监听 `3088`，与现有 `3081`（Envoy + `dsh-bootstrap`）互不影响。
- 浏览器原有的 `dsh-auth-*` cookie 在网关代理时会被过滤，只使用插件即时签发的短时 cookie。

## 已知限制

- `node-notifier@11.0.0` 的 Linux 后端不支持点击，所以 Linux 点击由本插件的 `notify-send` shim 实现；如果系统没有 `notify-send` 或通知守护不支持 actions，只能显示、不能点击。
- 原生通知点击是“打开 URL”，通常会新开/聚焦浏览器标签；精确聚焦已有标签由 PWA Service Worker 通道完成。
- iOS Web Push 仅 16.4+ 且必须已添加到主屏幕；Safari 标签页不能收推送。
- 自签证书需要每台设备安装 CA；不想装 CA 就用上传证书模式。
- PWA 图标上传（桌面/Android/iOS 分别替换）在资产提供后加入；当前使用包内默认图标。

## 开发与隔离测试

```bash
pnpm --filter dsh-enhancement verify
pnpm --filter dsh-enhancement build
```

不要在正在使用的 `web` profile 里反复重启 DSH 做测试。为多实例/测试隔离，本插件支持状态目录覆盖：

```bash
# 1) 建一个只加载本插件（及 base/web-app）的测试 profile，例如 ~/.dsh/profiles/enhancement-test
#    package.json 的 dsh.profile.bundles 里放：
#    @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-enhancement
# 2) 用独立状态目录启动另一个 DSH 进程（不同端口，避免与 3080/3088 冲突）
DSH_HOME="$HOME/.local/state/dsh-enhancement-test/home" \
  dsh --profile enhancement-test --host 10.0.0.2 --port 3090 --no-open
# 3) 测试网关用另一个端口（例如 3098），不要把生产网关的 3088 抢掉
```

状态默认放在当前 profile 目录下：`$DSH_HOME/profiles/<profile>/fengyifan-dsh-enhancement/`。`DSH_ENHANCEMENT_STATE_DIR` 仅用于特殊隔离测试，必须是绝对路径。测试 profile 的网关/密码/证书/推送订阅全部落在该目录，不会影响正在使用的 profile。测试环境应使用持久目录（例如 `~/.local/state/dsh-enhancement-test/home`），不要用 `/tmp`。

宿主侧代码变更需要重启**测试进程**（测试进程不托管当前 Agent 会话）；主 `web` profile 只在最终验收时重启一次。

- 宿主半侧：`src/index.ts`、`src/gateway.ts`、`src/control.ts`、`src/tls.ts`、`src/pwa.ts`、`src/notify.ts`、`src/push.ts`。
- 浏览器半侧：`src/client/index.tsx`，构建为 `lib/client.js`（`scripts/build-client.mjs`）。
- 测试：`pnpm --filter dsh-enhancement verify`；HTTPS/证书与 PWA 路由可用临时 `DSH_HOME` 做进程内集成测试。

## License

MIT
