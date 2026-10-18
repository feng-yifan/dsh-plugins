export type HttpsMode = 'off' | 'uploaded' | 'ca' | 'selfsigned';
export interface GatewayConfig {
    enabled: boolean;
    bindHost: string;
    port: number;
    httpsMode: HttpsMode;
    sessionDays: number;
    loginThrottle: boolean;
    httpsHostnames: string[];
    pwaEnabled: boolean;
    pwaName: string;
    pwaShortName: string;
    pwaDisplay: 'standalone' | 'fullscreen' | 'minimal-ui';
    pwaThemeColor: string;
    pwaBackgroundColor: string;
    notifyEnabled: boolean;
    notifyTask: boolean;
    notifyAsk: boolean;
    notifyApproval: boolean;
    notifyDenied: boolean;
    notifySubagent: boolean;
    notifyGoal: boolean;
    notifyJobs: boolean;
    pushEnabled: boolean;
    pushSubject: string;
}
export interface PasswordRecord {
    salt: string;
    hash: string;
    N: number;
    r: number;
    p: number;
}
export interface PushSubscriptionRecord {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
    origin?: string;
    createdAt: string;
}
export interface VapidKeys {
    publicKey: string;
    privateKey: string;
}
export interface PersistedState {
    version: 1;
    config: GatewayConfig;
    gateSecret: string;
    password?: PasswordRecord;
    vapid?: VapidKeys;
    subscriptions: PushSubscriptionRecord[];
    createdAt: string;
    updatedAt: string;
}
export interface PluginConfig {
    enabled?: boolean;
    bindHost?: string;
    port?: number;
}
export interface CredentialRecordLike {
    kind?: string;
    payload?: {
        version?: number;
        secret?: string;
    };
}
export interface CredentialsLike {
    readRecord(key: string): Promise<CredentialRecordLike | undefined>;
}
export declare const SESSION_COOKIE = "dsh_enhancement_session";
export declare const DSH_HOME: string;
export declare const PROFILE_NAME: string;
export declare const PROFILE_DIR: string;
export declare let STATE_DIR: string;
export declare let STATE_PATH: string;
export declare let TLS_DIR: string;
export declare let ICONS_DIR: string;
export declare const TLS_FILES: {
    cert: string;
    key: string;
    caCert: string;
    caKey: string;
    uploadedCaCert: string;
    uploadedCaKey: string;
};
/**
 * 使用 DSH 提供的 profileContext.dir 作为权威目录。
 * 这样 Windows / macOS 以及自定义 DSH_HOME 下都不依赖猜测 argv 或 home 布局。
 */
export declare function configureStateDir(profileDir: string): void;
export declare function nowIso(): string;
export declare function randomSecret(): string;
export declare function formatHost(host: string): string;
export declare function ensureStateDir(): void;
export declare function atomicWrite(path: string, content: string | Buffer, mode?: number): void;
export declare function defaultConfig(host: string): GatewayConfig;
export declare function normalizeConfig(raw: Partial<GatewayConfig> | undefined, host: string): GatewayConfig;
export declare class StateStore {
    private readonly webServerHost;
    readonly statePath: string;
    private state;
    constructor(webServerHost: string, seed?: PluginConfig);
    private load;
    get config(): GatewayConfig;
    get passwordSet(): boolean;
    get gateSecret(): string;
    get createdPath(): string;
    save(): void;
    updateConfig(patch: Partial<GatewayConfig>): GatewayConfig;
    setPassword(password: string): void;
    verifyPassword(password: string): boolean;
    get vapid(): VapidKeys | undefined;
    get subscriptions(): PushSubscriptionRecord[];
    setVapid(keys: VapidKeys): void;
    addSubscription(record: PushSubscriptionRecord): void;
    removeSubscription(endpoint: string): void;
    rotateGateSecret(): void;
}
export interface SessionPayload {
    v: 1;
    sid: string;
    iat: number;
    exp: number;
}
export declare function signSession(secret: string, days: number): string;
export declare function verifySession(secret: string, value: string | undefined): SessionPayload | null;
export declare function sessionCookie(value: string, days: number, secure: boolean): string;
export declare function clearSessionCookie(secure: boolean): string;
export declare function requestAuthority(host: string, protocol: 'http:' | 'https:'): string;
export declare function mintDshCookie(secret: Buffer, authority: string, ttlMs: number): string;
export declare function readDshSecret(ctx: {
    get(name: string): unknown;
}): Promise<Buffer | null>;
//# sourceMappingURL=state.d.ts.map