/**
 * dsh-enhancement · PWA（manifest / 图标 / Service Worker / 安装提示）。
 *
 * 取代 dsh-pwa-icon：同一套路由与注入，外加 SW 和 Chromium 安装提示。
 * 只有 pwaEnabled 时才注册；避免与旧 pwa-icon 同时占用 /manifest.webmanifest。
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ICONS_DIR } from './state.js';
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
const ICON_PREFIX = '/pwa/enhancement';
const ICONS = {
    [`${ICON_PREFIX}/icon-192.png`]: { file: 'icon-192.png', type: 'image/png' },
    [`${ICON_PREFIX}/icon-512.png`]: { file: 'icon-512.png', type: 'image/png' },
    [`${ICON_PREFIX}/icon-maskable-512.png`]: { file: 'icon-maskable-512.png', type: 'image/png' },
    [`${ICON_PREFIX}/icon-1600.webp`]: { file: 'icon-1600.webp', type: 'image/webp' },
    [`${ICON_PREFIX}/apple-touch-icon-180.png`]: { file: 'apple-touch-icon-180.png', type: 'image/png' },
};
function escapeAttr(value) {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function methodAllowed(req) {
    return req.method === 'GET' || req.method === 'HEAD';
}
function respond(req, res, status, headers, body) {
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
}
const SW = `/* dsh-enhancement service worker：仅做推送/点击/安装提示，不缓存页面。 */
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('message', (event) => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', () => { /* 透传：不调用 respondWith，请求直接走网络 */ });
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (error) { payload = { body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'DSH';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/pwa/enhancement/icon-192.png',
    badge: payload.badge || '/pwa/enhancement/icon-192.png',
    tag: payload.tag || undefined,
    data: { sessionId: payload.sessionId || null, url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const sessionId = data.sessionId || null;
  const url = data.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = all.filter((client) => { try { return new URL(client.url).origin === self.location.origin; } catch (error) { return false; } });
    if (sameOrigin.length > 0) {
      const client = sameOrigin[0];
      await client.focus();
      if (sessionId && client.postMessage) client.postMessage({ type: 'dsh-enhancement-open-session', sessionId });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
`;
const INSTALL_SCRIPT = String.raw `(function(){
  try {
    var KEY='dsh-enhancement-install-dismissed';
    var dismissed=0; try { dismissed=Number(localStorage.getItem(KEY)||0); } catch(e) {}
    if (Date.now()-dismissed < 30*86400000) return;
    var standalone=(window.matchMedia && matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
    if (standalone) return;
    if ('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')) {
      navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});
    }
    var deferred=null;
    var ID='dsh-enhancement-install';
    function hide(){ var el=document.getElementById(ID); if(el&&el.parentNode) el.parentNode.removeChild(el); }
    function dismiss(){ try { localStorage.setItem(KEY,String(Date.now())); } catch(e) {} hide(); }
    function show(title,text,buttonText){
      if (document.getElementById(ID)) return;
      var wrap=document.createElement('div'); wrap.id=ID;
      wrap.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;max-width:min(92vw,520px);background:#161a22;color:#e8ecf4;border:1px solid #2a3040;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:12px 14px;display:flex;gap:12px;align-items:center;font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Noto Sans SC",sans-serif;';
      var body=document.createElement('div'); body.style.cssText='flex:1;min-width:0;';
      var h=document.createElement('div'); h.textContent=title; h.style.cssText='font-weight:650;margin-bottom:2px;';
      var p=document.createElement('div'); p.textContent=text; p.style.cssText='color:#8d97ab;font-size:12px;';
      body.appendChild(h); body.appendChild(p); wrap.appendChild(body);
      if (buttonText) {
        var btn=document.createElement('button'); btn.textContent=buttonText; btn.style.cssText='border:0;border-radius:9px;background:#4d8dff;color:#fff;font-weight:600;font-size:12px;padding:7px 12px;cursor:pointer;white-space:nowrap;';
        btn.onclick=function(){ if(!deferred) return; var p=deferred; deferred=null; p.prompt(); p.userChoice.then(function(){ hide(); }).catch(function(){ hide(); }); };
        wrap.appendChild(btn);
      }
      var close=document.createElement('button'); close.setAttribute('aria-label','关闭'); close.textContent='×'; close.style.cssText='border:0;background:transparent;color:#8d97ab;font-size:18px;line-height:1;cursor:pointer;padding:2px 4px;';
      close.onclick=dismiss; wrap.appendChild(close);
      document.body.appendChild(wrap);
    }
    window.addEventListener('beforeinstallprompt', function(event){ event.preventDefault(); deferred=event; show('安装 DSH 到桌面','安装后可像应用一样打开，并支持 PWA 通知。','安装'); });
    window.addEventListener('appinstalled', function(){ try { localStorage.removeItem(KEY); } catch(e) {} hide(); });
    var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    if (isIOS && location.protocol==='https:') show('添加到主屏幕','Safari 中点击「分享」→「添加到主屏幕」，即可获得独立窗口并接收通知。',null);
  } catch (error) { /* 安装提示失败不影响 DSH */ }
})();`;
function installScript() {
    return INSTALL_SCRIPT;
}
function manifest(store) {
    const config = store.config;
    return `${JSON.stringify({
        id: '/',
        name: config.pwaName,
        short_name: config.pwaShortName,
        description: 'DeepSeek Harness Web UI',
        start_url: '/',
        scope: '/',
        display: config.pwaDisplay,
        background_color: config.pwaBackgroundColor,
        theme_color: config.pwaThemeColor,
        lang: 'zh-CN',
        dir: 'ltr',
        prefer_related_applications: false,
        icons: [
            { src: `${ICON_PREFIX}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${ICON_PREFIX}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${ICON_PREFIX}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: `${ICON_PREFIX}/icon-1600.webp`, sizes: '1600x1600', type: 'image/webp', purpose: 'any' },
        ],
    }, null, 2)}\n`;
}
function rewriteIndex(html, store) {
    const name = escapeAttr(store.config.pwaName);
    const shortName = escapeAttr(store.config.pwaShortName);
    let next = html
        .replace(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*>/gi, '')
        .replace(/<link\b[^>]*\brel\s*=\s*["']apple-touch-icon["'][^>]*>/gi, '')
        .replace(/<meta\b[^>]*\bname\s*=\s*["']theme-color["'][^>]*>/gi, '');
    const tags = [
        '<link rel="manifest" href="/manifest.webmanifest">',
        '<link rel="apple-touch-icon" sizes="180x180" href="/pwa/enhancement/apple-touch-icon-180.png">',
        `<meta name="theme-color" content="${escapeAttr(store.config.pwaThemeColor)}">`,
        `<meta name="apple-mobile-web-app-title" content="${name}">`,
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        `<meta name="application-name" content="${shortName}">`,
    ].join('');
    if (next.includes('</head>'))
        next = next.replace('</head>', `${tags}</head>`);
    else
        next = `${tags}${next}`;
    return next;
}
export class Pwa {
    ctx;
    store;
    disposers = [];
    applied = false;
    lastError = null;
    constructor(ctx, store) {
        this.ctx = ctx;
        this.store = store;
    }
    get enabled() {
        return this.applied;
    }
    customIcons() {
        return [...new Set(Object.values(ICONS).map((entry) => entry.file))].filter((file) => existsSync(join(ICONS_DIR, file)));
    }
    get error() {
        return this.lastError;
    }
    sync() {
        const wanted = this.store.config.pwaEnabled === true;
        if (wanted && !this.applied)
            this.apply();
        else if (!wanted && this.applied)
            this.dispose();
    }
    add(dispose) {
        this.disposers.push(dispose);
    }
    apply() {
        const ctx = this.ctx;
        const store = this.store;
        try {
            this.add(ctx.webServer.register({
                kind: 'exact',
                path: '/manifest.webmanifest',
                handler: (req, res) => {
                    if (!methodAllowed(req))
                        return respond(req, res, 405, { allow: 'GET, HEAD' });
                    const body = manifest(store);
                    respond(req, res, 200, {
                        'content-type': 'application/manifest+json; charset=utf-8',
                        'content-length': String(Buffer.byteLength(body)),
                        'cache-control': 'no-cache',
                        'x-content-type-options': 'nosniff',
                    }, body);
                },
            }));
            this.add(ctx.webServer.register({
                kind: 'exact',
                path: '/sw.js',
                handler: (req, res) => {
                    if (!methodAllowed(req))
                        return respond(req, res, 405, { allow: 'GET, HEAD' });
                    respond(req, res, 200, {
                        'content-type': 'text/javascript; charset=utf-8',
                        'cache-control': 'no-cache',
                        'service-worker-allowed': '/',
                        'x-content-type-options': 'nosniff',
                    }, SW);
                },
            }));
            this.add(ctx.webServer.register({
                kind: 'prefix',
                path: ICON_PREFIX,
                handler: async (req, res) => {
                    if (!methodAllowed(req))
                        return respond(req, res, 405, { allow: 'GET, HEAD' });
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    const entry = ICONS[url.pathname];
                    if (!entry)
                        return respond(req, res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found\n');
                    try {
                        const custom = join(ICONS_DIR, entry.file);
                        const body = await readFile(existsSync(custom) ? custom : join(ASSETS, entry.file));
                        respond(req, res, 200, {
                            'content-type': entry.type,
                            'content-length': String(body.byteLength),
                            'cache-control': 'no-cache',
                            'x-content-type-options': 'nosniff',
                        }, body);
                    }
                    catch {
                        respond(req, res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found\n');
                    }
                },
            }));
            if (typeof ctx.webServer.tapIndex === 'function') {
                this.add(ctx.webServer.tapIndex((html) => rewriteIndex(html, store)));
            }
            if (typeof ctx.on === 'function') {
                const off = ctx.on('webserver/index-inject', (table) => {
                    if (!Array.isArray(table))
                        return;
                    table.push({ kind: 'script', placement: 'body', text: installScript() });
                });
                if (typeof off === 'function')
                    this.add(off);
            }
            this.applied = true;
            ctx.logger?.info?.('[dsh-enhancement] PWA enabled');
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            ctx.logger?.error?.('[dsh-enhancement] PWA registration failed', error);
            this.dispose();
        }
    }
    dispose() {
        for (const dispose of this.disposers.splice(0).reverse()) {
            try {
                dispose();
            }
            catch {
                /* ignore */
            }
        }
        this.applied = false;
    }
}
//# sourceMappingURL=pwa.js.map