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
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
export const name = 'pwa-icon';
/**
 * 本插件要用的宿主服务。DSH loader 只认模块导出的 `inject`（patch 行的
 * `inject` 选项是另一条来源），缺了它 `ctx.webServer` 会在 apply 里直接抛
 * `cannot get property "webServer" without inject`。
 */
export const inject = ['webServer'];
/**
 * manifest 默认字段，对齐当前 DSH 发布版 dist 的 `manifest.webmanifest`。
 * `start_url` / `scope` 用根绝对路径，从而与 manifest 挂在哪个路径无关。
 */
const DEFAULT_MANIFEST = {
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
};
/** 常见图片扩展名 → MIME。 */
const MIME_BY_EXTENSION = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
};
/** 逐个 `<link>` 标签判定 manifest 链接：`data-rel` 这类同后缀属性名不算，`rel="manifest preload"` 这类多 token 也算。 */
const LINK_TAG = /<link\b[^>]*>/gi;
/** 属性名前必须是空白，故 `data-rel=` 不会被当作 `rel=`。 */
const REL_ATTRIBUTE = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
/** 该 `<link>` 标签的 rel 是否含 `manifest` token。 */
function isManifestLink(tag) {
    const match = REL_ATTRIBUTE.exec(tag);
    if (match === null)
        return false;
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    return value.split(/\s+/).some((token) => token.toLowerCase() === 'manifest');
}
/** 把一个值放进双引号 HTML 属性。 */
function escapeAttribute(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
/**
 * 去掉页面原有的 manifest 链接并注入本插件的一份（保证只有一条，且指向本插件路由）。
 * @param html - 原始 index.html。
 * @param href - 本插件的 manifest URL。
 * @returns 变换后的 index.html。
 */
export function replaceManifestLink(html, href) {
    const stripped = html.replace(LINK_TAG, (tag) => (isManifestLink(tag) ? '' : tag));
    const markup = `<link rel="manifest" href="${escapeAttribute(href)}">`;
    const close = /<\/head\s*>/i.exec(stripped);
    if (close !== null)
        return `${stripped.slice(0, close.index)}${markup}${stripped.slice(close.index)}`;
    const open = /<head(?:\s[^>]*)?>/i.exec(stripped);
    if (open !== null) {
        const at = open.index + open[0].length;
        return `${stripped.slice(0, at)}${markup}${stripped.slice(at)}`;
    }
    return `${markup}${stripped}`;
}
/** 组装要返回的 manifest 对象。 */
export function buildManifest(config, iconEntry) {
    const manifest = { ...DEFAULT_MANIFEST, ...(config.manifest ?? {}) };
    if (!Array.isArray(manifest.icons))
        manifest.icons = [iconEntry];
    return manifest;
}
/** 一条路由的 method 门（只接受 GET/HEAD）。 */
function methodAllowed(req) {
    return req.method === 'GET' || req.method === 'HEAD';
}
/**
 * 规范化一条对外路由路径。命名路由按 pathname 精确匹配，不以 `/` 开头的路径永远不会命中
 * （静默失效），故这里把非法值挡在注册之前。
 * @param value - config 里的值，缺省用 fallback。
 * @param fallback - 默认路径。
 * @param field - config 字段名（用于告警文案）。
 * @returns 合法路径；非法时 warn 并返回 undefined（调用方放弃加载）。
 */
function routePath(value, fallback, field, ctx) {
    const path = (value ?? fallback).trim();
    if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
        ctx.logger?.warn?.(`pwa-icon: config.${field} must be an absolute path starting with "/" (got ${JSON.stringify(path)})`);
        return undefined;
    }
    if (path.startsWith('/assets/')) {
        ctx.logger?.warn?.(`pwa-icon: config.${field} ${JSON.stringify(path)} shadows a frontend asset path`);
    }
    return path;
}
/** 写一个响应（HEAD 只写头）。 */
function respond(req, res, status, headers, body) {
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || body === undefined)
        res.end();
    else
        res.end(body);
}
/**
 * 注册 manifest 路由、图片路由、apple-touch-icon 注入与 manifest 链接改写。
 * @param ctx - 携带 webServer 服务的宿主上下文。
 * @param rawConfig - cordis 行传入的配置。
 */
export function apply(ctx, rawConfig) {
    const config = rawConfig ?? {};
    if (config.enabled === false)
        return;
    const icon = typeof config.icon === 'string' ? config.icon.trim() : '';
    if (icon === '') {
        ctx.logger?.warn?.('pwa-icon: config.icon is not set — the plugin stays inactive; set the icon file path in the profile patch');
        return;
    }
    const iconFile = resolve(icon);
    const extension = extname(iconFile).toLowerCase();
    const declaredType = typeof config.type === 'string' ? config.type.trim() : '';
    let imageType = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
    if (declaredType !== '') {
        // 只接受 image/*：type 会原样进 content-type，配置成 text/html 等于把同源公开路由变成 HTML 提供点。
        if (declaredType.toLowerCase().startsWith('image/'))
            imageType = declaredType;
        else
            ctx.logger?.warn?.(`pwa-icon: config.type ${JSON.stringify(declaredType)} is not an image/* type — falling back to ${imageType}`);
    }
    const manifestUrl = routePath(config.manifestUrl, '/manifest.webmanifest', 'manifestUrl', ctx);
    const iconUrl = routePath(config.iconUrl, `/pwa/icon${extension}`, 'iconUrl', ctx);
    if (manifestUrl === undefined || iconUrl === undefined)
        return;
    if (manifestUrl === iconUrl) {
        ctx.logger?.warn?.('pwa-icon: config.manifestUrl and config.iconUrl must differ — the plugin stays inactive');
        return;
    }
    const appleTouchIcon = config.appleTouchIcon !== false;
    if (!existsSync(iconFile)) {
        // 不阻断注册：文件随后出现即可生效（图片路由每次请求重读），只是把静默失败变成启动期可见。
        ctx.logger?.warn?.(`pwa-icon: icon file ${iconFile} does not exist yet — the icon route answers 404 until it appears`);
    }
    let sizes = typeof config.sizes === 'string' && config.sizes.trim() !== '' ? config.sizes.trim() : undefined;
    if (sizes === undefined && imageType !== 'image/svg+xml') {
        ctx.logger?.warn?.(`pwa-icon: config.sizes is not set for ${imageType} — Chromium requires the sizes attribute on manifest ` +
            'icons and may reject the app icon; set sizes to the real pixel size (for example "400x400")');
        sizes = 'any';
    }
    const iconEntry = {
        src: iconUrl,
        sizes: sizes ?? 'any',
        type: imageType,
        purpose: typeof config.purpose === 'string' && config.purpose.trim() !== '' ? config.purpose.trim() : 'any',
    };
    // manifest 路由：与 dist 里 <link rel="manifest"> 指向的 URL 同名，直接覆盖即可命中。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: manifestUrl,
        handler: (req, res) => {
            if (!methodAllowed(req)) {
                respond(req, res, 405, { allow: 'GET, HEAD' });
                return;
            }
            const body = `${JSON.stringify(buildManifest(config, iconEntry), null, 2)}\n`;
            respond(req, res, 200, {
                'content-type': 'application/manifest+json; charset=utf-8',
                'content-length': String(Buffer.byteLength(body)),
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            }, body);
        },
    }), 'pwa-icon: manifest route');
    // 图片路由：每次请求重新读取，替换图片无需重启；缺失返回 404。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: iconUrl,
        handler: async (req, res) => {
            if (!methodAllowed(req)) {
                respond(req, res, 405, { allow: 'GET, HEAD' });
                return;
            }
            let bytes;
            try {
                bytes = await readFile(iconFile);
            }
            catch {
                respond(req, res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'icon not found');
                return;
            }
            respond(req, res, 200, {
                'content-type': imageType,
                'content-length': String(bytes.byteLength),
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            }, bytes);
        },
    }), 'pwa-icon: icon route');
    // iOS「添加到主屏幕」用 apple-touch-icon；结构化注入行即可表达。
    if (appleTouchIcon) {
        ctx.on('webserver/index-inject', (table) => {
            table.push({
                kind: 'html',
                placement: 'head',
                html: `<link rel="apple-touch-icon" href="${escapeAttribute(iconUrl)}">`,
            });
        });
    }
    // 页面原有的 manifest 链接改指向本插件路由（只保留一条）。
    ctx.effect(() => ctx.webServer.tapIndex((html) => replaceManifestLink(html, manifestUrl)), 'pwa-icon: manifest link rewrite');
}
//# sourceMappingURL=index.js.map