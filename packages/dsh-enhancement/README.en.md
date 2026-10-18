# dsh-enhancement

DSH enhancement suite: a standalone **password gateway** for DSH Web, plus **PWA install/icons**, **desktop notifications**, and **PWA Web Push**. Useful for exposing DSH on a LAN, adding it to a phone home screen, or reaching it remotely without the `?token=` URL printed by `dsh web`.

> Status: Phases 1–4 implemented; Phase 5 (docs/deps/cleanup) in progress. The gateway and push are disabled by default.

## Features

The settings card is organized into expanded **Gateway / Access / PWA / Notifications** sections, each with its own save action, dirty indicator, inline feedback, and DSH `--dsw-alias-*` styling. Gateway settings, HTTPS, and listener options live in one block with a single save.

### Secure gateway

- Independent listener (default `3088`, disabled by default); configurable interface, port, password and session lifetime.
- scrypt password hashing; login failures are rate-limited per IP. Normal requests are not globally throttled.
- DSH-styled dark login page; `HttpOnly; SameSite=Strict` session cookie, `Secure` under HTTPS.
- Does not need DSH's `?token=`: the plugin reads the persistent signing secret from DSH `credentials` and mints a short-lived `dsh-auth-*` cookie per proxied request.
- Rewrites upstream Host to the DSH bind address, strips Origin, and enforces same-origin/CSRF itself — no `--trusted-host` change or `dsh-web.service` edit.
- HTTP + WebSocket reverse proxy; SSE is not buffered.

### HTTPS

`off`, `uploaded` (certificate chain + key), `ca` (uploaded CA signs a leaf for the listener), `selfsigned` (plugin-generated local CA; CA certificate downloadable). Private keys stay in `$DSH_HOME/profiles/<profile>/fengyifan-dsh-enhancement/tls/` (current user only). Mobile devices must trust a self-signed/private CA.

### PWA

Takes over `/manifest.webmanifest`, icons, `apple-touch-icon`, `/sw.js` and the install prompt; replaces `dsh-pwa-icon`. Default icon set: 192/512 `any`, 512 `maskable`, 1600 WebP, iOS 180. Per-platform slots can be replaced by PNG upload (192, 512, maskable 512, Apple 180). Chromium gets `beforeinstallprompt`; iOS gets a manual “Share → Add to Home Screen” hint. HTTPS is required for installation, Service Worker and push.

### Desktop notifications

Linux uses a small `notify-send --action` shim because `node-notifier@11.0.0`'s Linux backend drops actions/clicks; macOS/Windows use `node-notifier`. Clicking opens `<base>/?dsh-session=<id>`; the browser half calls `uiWorkspace.openSession(id)`. PWA notification clicks focus an existing window or post a message through the Service Worker.

Types: task complete, waiting for answer (`ask_user_question`), approval requested, approval denied, subagent finished, goal complete/blocked, background job settled (unawaited jobs only).

### PWA Web Push

`web-push` + VAPID. Subscription records and the VAPID private key live in `state.json` (current user only). HTTPS is mandatory; iOS/iPadOS 16.4+ requires the app to be installed on the Home Screen, and permission must be requested from a user gesture. The settings card offers subscribe/unsubscribe/test and shows permission/subscription state.

## Install

From npm:

```bash
dsh plugin --profile web add dsh-enhancement
```

The bundle patch inserts the plugin row and also inserts `dsh-web-mobile` and `dsh-vertical-layout`; do **not** enable those two bundles separately.

Local development (link the source):

```bash
cd ~/dev/projects/github/fengyifan/dsh-plugins
pnpm --filter dsh-enhancement build
cd ~/.dsh/profiles/web
pnpm add link:../../dev/projects/github/fengyifan/dsh-plugins/packages/dsh-enhancement
```

Add `dsh-enhancement` to `dsh.profile.bundles`; mobile/vertical are inserted by its patch.

## Configuration and test isolation

Runtime state lives at `$DSH_HOME/profiles/<profile>/fengyifan-dsh-enhancement/state.json` (current user only) and `tls/`. Passwords/private keys never go into the profile patch.

For multi-instance or test profiles, override the state directory:

```bash
DSH_HOME="$HOME/.local/state/dsh-enhancement-test/home" \
  dsh --profile enhancement-test --host 10.0.0.2 --port 3090 --no-open
```

Use a separate gateway port (e.g. 3098) so the production gateway on 3088 is not taken. Host-side code changes then only require restarting the test process, not the DSH instance hosting your current session.

## Known limitations

- Linux click support depends on a notification daemon that implements actions; without `notify-send`/actions, notifications are display-only.
- Native click opens/focuses a browser tab; exact focus of an existing tab is handled by the PWA Service Worker path.
- iOS Web Push only works in an installed Home Screen web app on 16.4+; Safari tabs cannot receive push.
- Self-signed certificates require installing the CA on every device.
- Real-device iOS/Android acceptance and user-provided icon assets are still pending.

## Development

```bash
pnpm --filter dsh-enhancement verify
pnpm --filter dsh-enhancement build
node scripts/smoke-plugin.mjs --package dsh-enhancement   # from repo root
```

## License

MIT
