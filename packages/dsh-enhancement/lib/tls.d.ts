import { type GatewayConfig, type HttpsMode } from './state.js';
export interface TlsCertInfo {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    fingerprint256: string;
    subjectAltName: string;
}
export interface TlsStatus {
    mode: HttpsMode;
    hostnames: string[];
    cert: TlsCertInfo | null;
    caAvailable: boolean;
    caInfo: TlsCertInfo | null;
    uploadedCaAvailable: boolean;
    uploadedCaInfo: TlsCertInfo | null;
}
export interface TlsMaterial {
    cert: string;
    key: string;
    caCert?: string;
}
export declare function tlsHosts(config: GatewayConfig, webHost: string): string[];
export declare function certInfo(path: string): TlsCertInfo | null;
export declare function tlsStatus(config: GatewayConfig, webHost: string): TlsStatus;
export interface PreparedTls {
    material: TlsMaterial;
    warnings: string[];
    caCertPem?: string;
}
/**
 * 根据当前配置准备 TLS 材料；失败时抛错，由网关把错误展示在状态里。
 * 自签/CA 模式会在每次启动时重新签发 leaf（CA 不变，信任不受影响）。
 */
export declare function prepareTls(config: GatewayConfig, webHost: string): Promise<PreparedTls | null>;
export declare function installUploadedCertificate(certPem: string, keyPem: string, config: GatewayConfig, webHost: string): Promise<string[]>;
export declare function installUploadedCa(caCertPem: string, caKeyPem: string, config: GatewayConfig, webHost: string): Promise<string[]>;
export declare function useStoredUploadedCa(config: GatewayConfig, webHost: string): Promise<void>;
export declare function generateSelfSigned(config: GatewayConfig, webHost: string): Promise<void>;
export declare function caCertificatePem(): string | null;
//# sourceMappingURL=tls.d.ts.map