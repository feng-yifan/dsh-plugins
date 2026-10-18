import { StateStore } from './state.js';
import type { HostContextLike, NetworkInterfaceInfo, StatusPayload as Status } from './types.js';
export declare class Gateway {
    private readonly ctx;
    private readonly store;
    private server;
    private sockets;
    private started;
    private error;
    private dshSecret;
    private dshSecretTimer;
    private secure;
    private failures;
    constructor(ctx: HostContextLike, store: StateStore);
    get running(): boolean;
    private log;
    private get target();
    start(): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    status(interfaces: NetworkInterfaceInfo[]): Status;
    private isAuthenticated;
    private isSameOrigin;
    private gatewayOrigin;
    private tooManyFailures;
    private recordFailure;
    private clearFailures;
    private handleRequest;
    /** DSH 的 browser-session 凭据可能在本插件启动之后才生成；按需重读。 */
    private ensureDshSecret;
    /** 供控制接口在状态查询前刷新一次，避免设置页长期显示“不可用”。 */
    refreshDshSecret(): Promise<void>;
    private scheduleDshSecretRetry;
    private renderLogin;
    private handleLogin;
    private proxyRequest;
    private upstreamHeaders;
    private dshAuthority;
    private responseHeaders;
    private handleUpgrade;
}
//# sourceMappingURL=gateway.d.ts.map