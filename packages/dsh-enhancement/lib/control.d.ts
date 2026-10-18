import { StateStore } from './state.js';
import type { Gateway } from './gateway.js';
import type { Pwa } from './pwa.js';
import type { NotificationEngine } from './notify.js';
import type { PushService } from './push.js';
import type { HostContextLike } from './types.js';
export declare function registerControl(ctx: HostContextLike, gateway: Gateway, store: StateStore, pwa: Pwa, notify: NotificationEngine, push: PushService): void;
//# sourceMappingURL=control.d.ts.map