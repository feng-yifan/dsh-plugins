/**
 * dsh-enhancement host half.
 *
 * Phase 1：可配置网关（HTTP、密码、DSH 会话注入、HTTP/WS 反向代理）+ 控制 API。
 * 后续阶段在同一插件内加入 HTTPS、PWA、通知与 Web Push。
 */
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway } from './gateway.js';
import { registerControl } from './control.js';
import { Pwa } from './pwa.js';
import { NotificationEngine } from './notify.js';
import { PushService } from './push.js';
import { STATE_DIR, StateStore, configureStateDir } from './state.js';
import { focusHub } from './focus.js';
export const name = 'dsh-enhancement';
export const inject = ['webServer'];
/**
 * DSH 卸载没有单独的“卸载前”插件回调；dispose 在普通重启/禁用时也会执行。
 * 因此只在 dispose 后轮询 profile 清单：确认依赖和 bundle 都已移除，才删除状态目录。
 * 插件仍被禁用但依赖保留时不会误删；进程退出后自然停止。
 */
function scheduleUninstallPurge(profileDir, stateDir) {
    if (!profileDir)
        return;
    const manifest = join(profileDir, 'package.json');
    const deadline = Date.now() + 30_000;
    const tick = () => {
        if (Date.now() > deadline)
            return;
        try {
            const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
            const dependencies = parsed.dependencies ?? {};
            const bundles = Array.isArray(parsed.dsh?.profile?.bundles) ? parsed.dsh.profile.bundles : [];
            if (!('dsh-enhancement' in dependencies) && !bundles.includes('dsh-enhancement')) {
                rmSync(stateDir, { recursive: true, force: true });
                return;
            }
        }
        catch {
            /* profile missing/unreadable: do not delete on uncertainty */
        }
        const timer = setTimeout(tick, 1_500);
        timer.unref?.();
    };
    const timer = setTimeout(tick, 4_000);
    timer.unref?.();
}
export function apply(ctx, config) {
    const profileContext = ctx.get('profileContext');
    let profileDir;
    if (typeof profileContext?.dir === 'string' && profileContext.dir) {
        let dir = profileContext.dir;
        try {
            dir = realpathSync(dir);
        }
        catch { /* keep declared path */ }
        profileDir = dir;
        configureStateDir(dir);
    }
    const store = new StateStore(ctx.webServer.host, config);
    const gateway = new Gateway(ctx, store);
    const pwa = new Pwa(ctx, store);
    const push = new PushService(ctx, store);
    const notify = new NotificationEngine(ctx, store, gateway, push);
    notify.start();
    registerControl(ctx, gateway, store, pwa, notify, push);
    pwa.sync();
    ctx.effect?.(() => {
        void gateway.start().catch((error) => {
            ctx.logger?.error?.('[dsh-enhancement] gateway start failed', error);
        });
        return () => {
            notify.stop();
            pwa.dispose();
            focusHub.stop();
            void gateway.stop();
            scheduleUninstallPurge(profileDir, STATE_DIR);
        };
    }, 'dsh-enhancement gateway');
    ctx.logger?.info?.('[dsh-enhancement] loaded');
}
//# sourceMappingURL=index.js.map