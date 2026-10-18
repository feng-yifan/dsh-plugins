import type { HostContextLike } from './types.js';
export declare class Pwa {
    private readonly ctx;
    private readonly store;
    private disposers;
    private applied;
    private lastError;
    constructor(ctx: HostContextLike, store: {
        config: {
            pwaEnabled: boolean;
            pwaName: string;
            pwaShortName: string;
            pwaDisplay: string;
            pwaThemeColor: string;
            pwaBackgroundColor: string;
        };
    });
    get enabled(): boolean;
    customIcons(): string[];
    get error(): string | null;
    sync(): void;
    private add;
    private apply;
    dispose(): void;
}
//# sourceMappingURL=pwa.d.ts.map