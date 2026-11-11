/**
 * dsh-enhancement host half.
 *
 * Phase 1：可配置网关（HTTP、密码、DSH 会话注入、HTTP/WS 反向代理）+ 控制 API。
 * 后续阶段在同一插件内加入 HTTPS、PWA、通知与 Web Push。
 */
import { realpathSync } from 'node:fs'
import { Gateway } from './gateway.js'
import { registerControl } from './control.js'
import { Pwa } from './pwa.js'
import { NotificationEngine } from './notify.js'
import { PushService } from './push.js'
import { StateStore, configureStateDir, type PluginConfig } from './state.js'
import { focusHub } from './focus.js'
import { mountSessionHeader, normalizeHeaderName } from './session-header.js'
import type { HostContextLike } from './types.js'

export const name = 'dsh-enhancement'
export const inject = ['webServer']

export function apply(ctx: HostContextLike, config?: PluginConfig): void {
  const profileContext = ctx.get('profileContext') as { dir?: unknown } | undefined
  if (typeof profileContext?.dir === 'string' && profileContext.dir) {
    let dir = profileContext.dir
    try { dir = realpathSync(dir) } catch { /* keep declared path */ }
    configureStateDir(dir)
  }
  const store = new StateStore(ctx.webServer.host, config)
  const gateway = new Gateway(ctx, store)
  const pwa = new Pwa(ctx, store)
  const push = new PushService(ctx, store)
  const notify = new NotificationEngine(ctx, store, gateway, push)
  notify.start()
  // 会话请求头注入：让非官方 API 路由（dsh-llm-pi-ai）也能携带 session id。
  // 每次请求读当前设置，因此在设置页改动即时生效、无需重启。
  const sessionHeader = mountSessionHeader(ctx, () => ({
    enabled: store.config.sessionHeaderEnabled,
    headerName: normalizeHeaderName(store.config.sessionHeaderName),
  }))
  registerControl(ctx, gateway, store, pwa, notify, push, sessionHeader)
  pwa.sync()
  ctx.effect?.(() => {
    void gateway.start().catch((error: unknown) => {
      ctx.logger?.error?.('[dsh-enhancement] gateway start failed', error)
    })
    return () => {
      notify.stop()
      pwa.dispose()
      focusHub.stop()
      sessionHeader.dispose()
      void gateway.stop()
    }
  }, 'dsh-enhancement gateway')
  ctx.logger?.info?.('[dsh-enhancement] loaded')
}
