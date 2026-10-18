import type { HostContextLike } from './types.js';
import type { PushSubscriptionRecord, StateStore } from './state.js';
interface PushMessage {
    title: string;
    body: string;
    sessionId?: string;
    tag?: string;
}
export interface PushStatus {
    enabled: boolean;
    publicKey: string | null;
    subscriptions: number;
    subject: string;
}
export declare class PushService {
    private readonly ctx;
    private readonly store;
    private readonly webpush;
    constructor(ctx: HostContextLike, store: StateStore);
    private ensureKeys;
    private configure;
    status(): PushStatus;
    subscribe(record: PushSubscriptionRecord): void;
    unsubscribe(endpoint: string): void;
    send(message: PushMessage): Promise<{
        sent: number;
        removed: number;
        failed: number;
    }>;
    test(): Promise<{
        sent: number;
        removed: number;
        failed: number;
    }>;
}
export {};
//# sourceMappingURL=push.d.ts.map