/**
 * dsh-enhancement · PWA Web Push（Phase 4）。
 *
 * VAPID 私钥与订阅存 $DSH_HOME/dsh-enhancement/state.json（仅当前用户可读）。
 * 推送必须 HTTPS：Service Worker / PushManager 都是 secure context 能力；
 * iOS 还要求 16.4+ 且已“添加到主屏幕”。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export class PushService {
    ctx;
    store;
    webpush;
    constructor(ctx, store) {
        this.ctx = ctx;
        this.store = store;
        this.webpush = require('web-push');
    }
    ensureKeys() {
        const existing = this.store.vapid;
        if (existing)
            return existing;
        const generated = this.webpush.generateVAPIDKeys();
        this.store.setVapid(generated);
        return generated;
    }
    configure() {
        const keys = this.ensureKeys();
        try {
            this.webpush.setVapidDetails(this.store.config.pushSubject, keys.publicKey, keys.privateKey);
        }
        catch (error) {
            this.ctx.logger?.warn?.('[dsh-enhancement] VAPID subject invalid', error);
            this.webpush.setVapidDetails('mailto:admin@example.com', keys.publicKey, keys.privateKey);
        }
    }
    status() {
        const keys = this.ensureKeys();
        return {
            enabled: this.store.config.pushEnabled,
            publicKey: keys?.publicKey ?? null,
            subscriptions: this.store.subscriptions.length,
            subject: this.store.config.pushSubject,
        };
    }
    subscribe(record) {
        if (!/^https:\/\//i.test(record.endpoint))
            throw new Error('推送订阅 endpoint 必须是 HTTPS');
        if (!record.keys.p256dh || !record.keys.auth)
            throw new Error('推送订阅缺少密钥');
        this.store.addSubscription(record);
    }
    unsubscribe(endpoint) {
        this.store.removeSubscription(endpoint);
    }
    async send(message) {
        const result = { sent: 0, removed: 0, failed: 0 };
        if (!this.store.config.pushEnabled)
            return result;
        const subscriptions = this.store.subscriptions;
        if (subscriptions.length === 0)
            return result;
        this.configure();
        const payload = JSON.stringify({
            title: message.title,
            body: message.body,
            sessionId: message.sessionId ?? null,
            tag: message.tag ?? (message.sessionId ? `dsh-${message.sessionId}` : undefined),
            icon: '/pwa/enhancement/icon-192.png',
            badge: '/pwa/enhancement/icon-192.png',
            url: message.sessionId ? `/?dsh-session=${encodeURIComponent(message.sessionId)}` : '/',
        });
        await Promise.all(subscriptions.map(async (subscription) => {
            try {
                await this.webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload);
                result.sent += 1;
            }
            catch (error) {
                const statusCode = error.statusCode;
                if (statusCode === 404 || statusCode === 410) {
                    this.store.removeSubscription(subscription.endpoint);
                    result.removed += 1;
                }
                else {
                    result.failed += 1;
                    this.ctx.logger?.warn?.('[dsh-enhancement] push failed', statusCode ?? (error instanceof Error ? error.message : String(error)));
                }
            }
        }));
        return result;
    }
    test() {
        return this.send({ title: 'DSH 推送测试', body: '如果你在手机上看到这条通知，Web Push 通道正常。' });
    }
}
//# sourceMappingURL=push.js.map