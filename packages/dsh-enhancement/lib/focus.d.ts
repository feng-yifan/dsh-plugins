/**
 * dsh-enhancement · 聚焦已有 DSH 页面
 *
 * 原生通知（尤其是 Linux notify-send）没有 PWA Service Worker 的 clients.matchAll，
 * 直接 xdg-open 会在浏览器里新开标签。这里用 SSE 维护已打开的 DSH 页面：
 * 点击原生通知时先广播 sessionId；有页面连接则由页面 window.focus() + openSession()，
 * 没有页面连接才回退到打开 URL。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
declare class FocusHub {
    private readonly clients;
    private heartbeat;
    subscribe(req: IncomingMessage, res: ServerResponse): void;
    get size(): number;
    /** @returns true when at least one open page received the event. */
    broadcast(sessionId?: string): boolean;
    stop(): void;
}
export declare const focusHub: FocusHub;
export {};
//# sourceMappingURL=focus.d.ts.map