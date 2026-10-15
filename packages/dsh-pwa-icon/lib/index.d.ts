/**
 * dsh-pwa-icon
 *
 * 让 Web GUI 在「安装 / 添加到桌面」为 PWA 时使用指定的图片作为应用图标。
 *
 * 现象：Chromium 安装 PWA 时，桌面图标只取 Web App Manifest 的 `icons`。
 * 当前 DSH 前端 dist 的 `manifest.webmanifest` 只声明了 DSH 自己的
 * `favicon.svg`，因此装出来的桌面图标是 DSH logo，而不是用户想用的图；
 * 仅改 favicon / apple-touch-icon 都不足以影响 Chromium 的安装图标。
 *
 * 做法：这是宿主侧插件，不构建任何客户端 bundle。
 *   1. 抢占 manifest 路由（默认 `/manifest.webmanifest`，与 dist 里
 *      `<link rel="manifest">` 指向的 URL 一致，因此直接覆盖即可命中），
 *      返回按 config 生成的 manifest：默认字段沿用当前发布版
 *      （name / short_name / start_url / scope / display），`icons` 替换为
 *      配置的图片——替换而非追加，否则浏览器可能挑回 DSH 的 SVG；
 *   2. 注册图片路由（默认 `/pwa/icon.<ext>`），按请求读取配置的图片文件，
 *      按扩展名给出 content-type；文件缺失返回 404，不改动磁盘；
 *   3. 经 `webserver/index-inject` 注入 `<link rel="apple-touch-icon">`
 *      （iOS「添加到主屏幕」），并用 `webServer.tapIndex` 把页面原有的
 *      `<link rel="manifest">` 换成指向本插件路由的那一个（将来 DSH 换
 *      manifest 文件名时不会静默失效）；
 *   4. 未配置 `icon` 时只打一条 warn，不注册任何路由，不影响启动。
 *
 * 注意：两个路由都是公开静态路由。浏览器取 manifest 图标时不带凭据，
 * 若加认证门会取不到图标，因此图片本身对能访问该端口的网络可见
 * （与现有的 favicon / dist manifest 同性质）。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 运行时依赖（外部插件无法可靠
 * 解析这些包），所需的宿主类型均在本文件内结构化声明。运行时只依赖 node
 * 内置模块与三个稳定接口：`webServer.register`、`webServer.tapIndex`、
 * `webserver/index-inject` 事件（社区插件 dsh-vertical-layout / dsh-ask-highlight
 * 用的是其中第三条；本例因为要接管路由，多用了前两条）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** `webserver/index-inject` 表格中的一行（来自 @deepseek-ai/dsh-host-webserver）。 */
type IndexInjectionRow = {
    kind: 'global';
    name: string;
    value: unknown;
} | {
    kind: 'script';
    placement: 'head' | 'body';
    text: string;
} | {
    kind: 'script-src';
    placement: 'head' | 'body';
    src: string;
} | {
    kind: 'script-preload';
    src: string;
} | {
    kind: 'style';
    text: string;
} | {
    kind: 'html';
    placement: 'head' | 'body';
    html: string;
};
/** 一条命名路由（来自 @deepseek-ai/dsh-host-webserver 的 `webServer.register`）。 */
interface HostRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
/** 宿主 cordis Context 中本插件用到的切片。 */
interface HostContext {
    webServer: {
        /** 注册命名路由；返回移除该路由的 disposer。路径重复会抛错。 */
        register(route: HostRoute): () => void;
        /** 注册 index.html 原文变换（在结构化注入行之后执行）；返回 disposer。 */
        tapIndex(transform: (html: string) => string): () => void;
    };
    on(event: 'webserver/index-inject', listener: (table: IndexInjectionRow[]) => void): unknown;
    effect(callback: () => void | (() => void), label?: string): unknown;
    logger?: {
        warn?: (...args: unknown[]) => void;
    };
}
/**
 * 插件配置，通过 cordis 行的 `config` 传入，例如：
 *
 * ```yaml
 * - id: pwa-icon
 *   name: dsh-pwa-icon
 *   config:
 *     icon: /home/viktor/Downloads/400x400bb-75.webp
 *     sizes: 400x400
 * ```
 *
 * 注意：这里只导出类型、不导出 Schemastery schema——外部插件无法可靠解析
 * `@deepseek-ai/schemastery`，因此由 `apply` 自行合并默认值。
 */
export interface Config {
    /** 总开关，默认 true。 */
    enabled?: boolean;
    /**
     * 图标图片的文件路径（绝对路径；相对路径按 dsh 进程工作目录解析）。
     * 不配置时插件不生效（只打一条 warn）。
     */
    icon?: string;
    /**
     * manifest icon 的 `sizes`。Chromium 的安装判定要求该属性必须存在
     * （"PNG, SVG or WebP format of at least 144px is required, the sizes
     * attribute must be set"），因此位图建议写真实尺寸（如 `400x400`）。
     * 缺省值：SVG 为 `any`，其它格式为 `any` 并打一条 warn。
     */
    sizes?: string;
    /** 图片 MIME 类型，默认按扩展名判定（.webp/.png/.jpg/.jpeg/.svg/.gif/.avif/.ico）。 */
    type?: string;
    /** manifest icon 的 `purpose`，默认 `any`。 */
    purpose?: string;
    /** 图片对外 URL 路径，默认 `/pwa/icon<扩展名>`。 */
    iconUrl?: string;
    /** manifest 对外 URL 路径，默认 `/manifest.webmanifest`。 */
    manifestUrl?: string;
    /**
     * 要合并进 manifest 的字段（覆盖默认值）。若其中显式提供了 `icons` 数组，
     * 则完全按它来，不再由 `icon` 生成。
     */
    manifest?: Record<string, unknown>;
    /** 是否注入 `<link rel="apple-touch-icon">`（iOS 添加到主屏幕），默认 true。 */
    appleTouchIcon?: boolean;
}
export declare const name = "pwa-icon";
/**
 * 本插件要用的宿主服务。DSH loader 只认模块导出的 `inject`（patch 行的
 * `inject` 选项是另一条来源），缺了它 `ctx.webServer` 会在 apply 里直接抛
 * `cannot get property "webServer" without inject`。
 */
export declare const inject: string[];
/**
 * 去掉页面原有的 manifest 链接并注入本插件的一份（保证只有一条，且指向本插件路由）。
 * @param html - 原始 index.html。
 * @param href - 本插件的 manifest URL。
 * @returns 变换后的 index.html。
 */
export declare function replaceManifestLink(html: string, href: string): string;
/** 组装要返回的 manifest 对象。 */
export declare function buildManifest(config: Config, iconEntry: Record<string, string>): Record<string, unknown>;
/**
 * 注册 manifest 路由、图片路由、apple-touch-icon 注入与 manifest 链接改写。
 * @param ctx - 携带 webServer 服务的宿主上下文。
 * @param rawConfig - cordis 行传入的配置。
 */
export declare function apply(ctx: HostContext, rawConfig?: Config): void;
export {};
//# sourceMappingURL=index.d.ts.map