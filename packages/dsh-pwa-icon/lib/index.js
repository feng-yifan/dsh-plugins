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
 *      （name / short_name / start_url / scope / display），`icons` 换成图标
 *      （替换而非追加，否则浏览器可能挑回 DSH 的 SVG）——未配置 `icon` 时用
 *      **随包发布的图标集** `assets/`（规范做法：192 / 512 / maskable 512 /
 *      1600 各带自己的 `sizes`，浏览器按场景挑最合适的），配置了 `icon` 时
 *      只用那一个文件；
 *   2. 注册图标路由（包内集合逐张一条，或单图一条），按请求读取文件并给出
 *      正确 content-type；文件缺失返回 404，不改动磁盘；
 *   3. 经 `webserver/index-inject` 注入 `<link rel="apple-touch-icon">`
 *      （iOS「添加到主屏幕」；包内集合用随包的 180 PNG，实底避免透明变黑角），
 *      并用 `webServer.tapIndex` 把页面原有的 `<link rel="manifest">` 换成
 *      指向本插件路由的那一个（将来 DSH 换 manifest 文件名时不会静默失效）；
 *   4. 未配置任何东西也能工作：只有 `enabled: false` 才整体关闭；包内资产缺失
 *      只打 warn（对应路由 404）。
 *
 * **挂载前缀**：两个路由路径是**后端**路径（反向代理剥掉前缀后看到的）。对外 URL 缺省用
 * 相对形式（`./manifest.webmanifest` / `./pwa/icon.webp` / `start_url`、`scope` = `./`），
 * 与 DSH 自带 dist manifest 同款——页面挂在 `<前缀>/` 下时自动带上前缀，因此「根挂载」与
 * 「反向代理剥前缀（如 DSH 经网关挂在 `/dsh`）」两种部署都成立；写死根绝对路径会让后者的
 * manifest 与图标都 404，浏览器只能回落到自动生成的图标（本机 2026-10-15 实际踩过）。
 * 页面不在挂载根时用 `publicBase` 显式给出前缀。
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
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const name = 'pwa-icon';
/**
 * 本插件要用的宿主服务。DSH loader 只认模块导出的 `inject`（patch 行的
 * `inject` 选项是另一条来源），缺了它 `ctx.webServer` 会在 apply 里直接抛
 * `cannot get property "webServer" without inject`。
 */
export const inject = ['webServer'];
/**
 * manifest 默认字段，对齐当前 DSH 发布版 dist 的 `manifest.webmanifest`。
 * `start_url` / `scope` 由调用方按挂载方式给出（缺省 `./`，即 manifest 自身所在目录）。
 * @param startUrl - `start_url` 与 `scope` 的值。
 */
function defaultManifest(startUrl) {
    return {
        name: 'DeepSeek Harness',
        short_name: 'DSH',
        start_url: startUrl,
        scope: startUrl,
        display: 'fullscreen',
    };
}
/** 去掉前导斜杠：`/pwa/icon.webp` → `pwa/icon.webp`（供相对 URL 拼接）。 */
function relativeFromRoot(path) {
    return path.replace(/^\/+/, '');
}
/**
 * 规范化 `publicBase`：缺省返回 `''`（表示对外用相对路径），否则返回不带尾斜杠的前缀。
 * @param value - config 里的值。
 * @param ctx - 宿主上下文（用于告警）。
 * @returns 规范化后的前缀，或 undefined 表示非法（调用方放弃加载）。
 */
function publicBaseOf(value, ctx) {
    if (value === undefined)
        return '';
    const base = value.trim().replace(/\/+$/, '');
    if (base === '')
        return '';
    if (!base.startsWith('/') || base.includes('?') || base.includes('#')) {
        ctx.logger?.warn?.(`pwa-icon: config.publicBase must look like "/dsh" (got ${JSON.stringify(value)}); ` +
            'omit it to use relative URLs, which work behind a prefix-stripping proxy');
        return undefined;
    }
    return base;
}
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
/** 包内资产目录（随 npm 包发布，`files` 含 `assets`）。 */
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));
/**
 * 包内图标集：`icon` 未配置时使用。
 * 规范做法是一组不同尺寸（浏览器按场景挑最合适的），外加一张 `maskable` 供 Android 自适应图标。
 */
const BUNDLED_ICONS = [
    { file: 'icon-192.png', route: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { file: 'icon-512.png', route: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { file: 'icon-1600.webp', route: '/pwa/icon-1600.webp', sizes: '1600x1600', type: 'image/webp', purpose: 'any' },
    {
        file: 'icon-maskable-512.png',
        route: '/pwa/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
    },
];
/** 包内 apple-touch-icon：iOS 这条路径按 Apple 文档走 PNG，实底避免透明区域变黑角。 */
const BUNDLED_APPLE_TOUCH_ICON = {
    file: 'apple-touch-icon-180.png',
    route: '/pwa/apple-touch-icon.png',
    type: 'image/png',
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
/**
 * 组装要返回的 manifest 对象。
 * @param config - 插件配置。
 * @param iconEntries - 由 `icon`（单图）或包内图标集生成的 icon 项数组。
 * @param startUrl - `start_url` / `scope` 的默认值。
 */
export function buildManifest(config, iconEntries, startUrl) {
    const manifest = { ...defaultManifest(startUrl), ...(config.manifest ?? {}) };
    if (!Array.isArray(manifest.icons))
        manifest.icons = iconEntries;
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
 * 注册一条"按请求读取本地文件"的公开静态路由（GET/HEAD；文件缺失返回 404）。
 * @param ctx - 携带 webServer 服务的宿主上下文。
 * @param route - 服务端路由路径（公开 URL 由 `publicBase` 决定相对还是绝对）。
 * @param filePath - 要读取的文件（每次请求重读，换图不必重启）。
 * @param mime - 响应的 content-type。
 */
function registerFileRoute(ctx, route, filePath, mime) {
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: route,
        handler: async (req, res) => {
            if (!methodAllowed(req)) {
                respond(req, res, 405, { allow: 'GET, HEAD' });
                return;
            }
            let bytes;
            try {
                bytes = await readFile(filePath);
            }
            catch {
                respond(req, res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'icon not found');
                return;
            }
            respond(req, res, 200, {
                'content-type': mime,
                'content-length': String(bytes.byteLength),
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            }, bytes);
        },
    }), `pwa-icon: file route ${route}`);
}
/**
 * 注册 manifest 路由、图标路由（包内图标集或单个文件）、apple-touch-icon 注入与 manifest 链接改写。
 *
 * 两种模式：`config.icon` 未配置 → 用随包发布的图标集（192 / 512 / maskable 512 / 1600 + 180 PNG）；
 * 配置了 → 只用该文件（此时 `sizes` / `type` / `purpose` / `iconUrl` 生效）。
 * @param ctx - 携带 webServer 服务的宿主上下文。
 * @param rawConfig - cordis 行传入的配置。
 */
export function apply(ctx, rawConfig) {
    const config = rawConfig ?? {};
    if (config.enabled === false)
        return;
    const publicBase = publicBaseOf(config.publicBase, ctx);
    if (publicBase === undefined)
        return;
    const appleTouchIcon = config.appleTouchIcon !== false;
    const manifestUrl = routePath(config.manifestUrl, '/manifest.webmanifest', 'manifestUrl', ctx);
    if (manifestUrl === undefined)
        return;
    // 对外 URL 换算：缺省相对（页面在 <前缀>/ 下时自动带上前缀，根挂载同样成立），只有显式配了
    // publicBase 才用绝对形式。manifest 里的 src 按规范相对 **manifest URL** 解析；页面里的 href
    // 相对**页面目录**解析——两者在挂载根下落到同一处。
    const manifestSrc = (route) => (publicBase === '' ? relativeFromRoot(route) : `${publicBase}${route}`);
    const pageHref = (route) => (publicBase === '' ? `./${relativeFromRoot(route)}` : `${publicBase}${route}`);
    const manifestHref = pageHref(manifestUrl);
    const startUrl = publicBase === '' ? './' : `${publicBase}/`;
    const icon = typeof config.icon === 'string' ? config.icon.trim() : '';
    let iconEntries;
    let appleTouchHref;
    if (icon === '') {
        // ---- 包内图标集模式：npm 安装即自带图标，不依赖任何本机路径 ----
        if (config.iconUrl !== undefined ||
            config.sizes !== undefined ||
            config.type !== undefined ||
            config.purpose !== undefined) {
            ctx.logger?.warn?.('pwa-icon: config.iconUrl / sizes / type / purpose take effect only together with config.icon — ' +
                'using the bundled icon set');
        }
        iconEntries = BUNDLED_ICONS.map((entry) => ({
            src: manifestSrc(entry.route),
            sizes: entry.sizes,
            type: entry.type,
            purpose: entry.purpose,
        }));
        for (const entry of BUNDLED_ICONS) {
            const file = join(ASSETS_DIR, entry.file);
            if (!existsSync(file)) {
                ctx.logger?.warn?.(`pwa-icon: bundled asset ${file} is missing — its route answers 404 (broken package?)`);
            }
            registerFileRoute(ctx, entry.route, file, entry.type);
        }
        if (appleTouchIcon) {
            const file = join(ASSETS_DIR, BUNDLED_APPLE_TOUCH_ICON.file);
            if (!existsSync(file)) {
                ctx.logger?.warn?.(`pwa-icon: bundled asset ${file} is missing — its route answers 404 (broken package?)`);
            }
            appleTouchHref = pageHref(BUNDLED_APPLE_TOUCH_ICON.route);
            registerFileRoute(ctx, BUNDLED_APPLE_TOUCH_ICON.route, file, BUNDLED_APPLE_TOUCH_ICON.type);
        }
    }
    else {
        // ---- 单图模式：只用 config.icon 指定的那一个文件 ----
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
        const iconUrl = routePath(config.iconUrl, `/pwa/icon${extension}`, 'iconUrl', ctx);
        if (iconUrl === undefined)
            return;
        if (manifestUrl === iconUrl) {
            ctx.logger?.warn?.('pwa-icon: config.manifestUrl and config.iconUrl must differ — the plugin stays inactive');
            return;
        }
        if (!existsSync(iconFile)) {
            // 不阻断注册：文件随后出现即可生效（图片路由每次请求重读），只是把静默失败变成启动期可见。
            ctx.logger?.warn?.(`pwa-icon: icon file ${iconFile} does not exist yet — the icon route answers 404 until it appears`);
        }
        let sizes = typeof config.sizes === 'string' && config.sizes.trim() !== '' ? config.sizes.trim() : undefined;
        if (sizes === undefined && imageType !== 'image/svg+xml') {
            ctx.logger?.warn?.(`pwa-icon: config.sizes is not set for ${imageType} — Chromium requires the sizes attribute on manifest ` +
                'icons and may reject the app icon; set sizes to the real pixel size (for example "512x512")');
            sizes = 'any';
        }
        iconEntries = [
            {
                src: manifestSrc(iconUrl),
                sizes: sizes ?? 'any',
                type: imageType,
                purpose: typeof config.purpose === 'string' && config.purpose.trim() !== '' ? config.purpose.trim() : 'any',
            },
        ];
        registerFileRoute(ctx, iconUrl, iconFile, imageType);
        if (appleTouchIcon)
            appleTouchHref = pageHref(iconUrl);
    }
    // manifest 路由：与 dist 里 <link rel="manifest"> 指向的 URL 同名，直接覆盖即可命中。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: manifestUrl,
        handler: (req, res) => {
            if (!methodAllowed(req)) {
                respond(req, res, 405, { allow: 'GET, HEAD' });
                return;
            }
            const body = `${JSON.stringify(buildManifest(config, iconEntries, startUrl), null, 2)}\n`;
            respond(req, res, 200, {
                'content-type': 'application/manifest+json; charset=utf-8',
                'content-length': String(Buffer.byteLength(body)),
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            }, body);
        },
    }), 'pwa-icon: manifest route');
    // iOS「添加到主屏幕」用 apple-touch-icon；结构化注入行即可表达。
    if (appleTouchHref !== undefined) {
        ctx.on('webserver/index-inject', (table) => {
            table.push({
                kind: 'html',
                placement: 'head',
                html: `<link rel="apple-touch-icon" href="${escapeAttribute(appleTouchHref)}">`,
            });
        });
    }
    // 页面原有的 manifest 链接改指向本插件路由（只保留一条）。
    ctx.effect(() => ctx.webServer.tapIndex((html) => replaceManifestLink(html, manifestHref)), 'pwa-icon: manifest link rewrite');
}
//# sourceMappingURL=index.js.map