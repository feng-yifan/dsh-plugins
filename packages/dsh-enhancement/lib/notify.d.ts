import type { HostContextLike } from './types.js';
import type { Gateway } from './gateway.js';
import type { PushService } from './push.js';
import { StateStore } from './state.js';
interface NotificationRequest {
    title: string;
    body: string;
    sessionId?: string;
    tag?: string;
}
export declare class NativeNotifier {
    private readonly icon;
    private readonly notifier;
    private readonly children;
    private readonly logger;
    constructor(ctx: HostContextLike);
    private open;
    private focusOrOpen;
    show(request: NotificationRequest, url: string): void;
    private showLinux;
    stop(): void;
}
export declare class NotificationEngine {
    private readonly ctx;
    private readonly store;
    private readonly gateway;
    private readonly push;
    private disposers;
    private timers;
    private lastAssistant;
    private pendingApprovals;
    private native;
    private started;
    constructor(ctx: HostContextLike, store: StateStore, gateway: Gateway, push: PushService);
    start(): void;
    stop(): void;
    test(): void;
    private on;
    private baseUrl;
    private sessionTitle;
    private deliver;
    private onAgentStatus;
    private onSessionEvent;
    private onSubagentEnd;
    private onGoalChanged;
    private onJobEvent;
}
export {};
//# sourceMappingURL=notify.d.ts.map