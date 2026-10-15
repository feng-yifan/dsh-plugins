# dsh-pwa-icon

DSH PWA icon: use the picture you want as the app icon when the Web GUI is **installed / added to the desktop** as a PWA.

Chromium takes the installed app icon only from the Web App Manifest `icons` (the shipped DSH dist manifest declares its own `favicon.svg`, so the default install icon is the DSH logo); touching the favicon or `apple-touch-icon` does not affect it. This plugin takes over the manifest route, replaces `icons` with the **icon set shipped inside the package** (or with the image you configure), and injects the `apple-touch-icon` used by iOS "Add to Home Screen".

## How it works

A host-side plugin with no client bundle and no `@deepseek-ai/*` runtime dependency:

1. registers the exact route `/manifest.webmanifest` (configurable via `manifestUrl`) and serves a manifest built from config: the default fields mirror the shipped release (`name` / `short_name` / `start_url` / `scope` / `display`), while `icons` is **replaced** by the icon set (appending would let the browser pick the SVG back, hence replacement). Two modes:
   - **bundled icon set (default, when `icon` is not set)**: the set published inside `assets/` — `192x192`, `512x512`, `maskable 512x512` (content scaled to 80% on an opaque background, i.e. inside the maskable safe zone) and a `1600x1600` WebP, each declaring its own `sizes` / `type` / `purpose`. That is the spec-shaped approach: **a set of sizes** so browsers pick the best match, instead of one oversized image (which gets rescaled everywhere and has no maskable safe zone);
   - **single image (when `icon` is set)**: only that file is used, and `sizes` / `type` / `purpose` / `iconUrl` apply.
2. registers the icon routes: one per bundled icon (`/pwa/icon-192.png`, `/pwa/icon-512.png`, `/pwa/icon-maskable-512.png`, `/pwa/icon-1600.webp`), or `/pwa/icon.<ext>` in single-image mode (configurable via `iconUrl`); each reads its file per request with the right `content-type`, returns 404 when missing and touches nothing on disk;
3. injects `<link rel="apple-touch-icon">` through `webserver/index-inject` (disable with `appleTouchIcon: false`): the bundled set uses `apple-touch-icon-180.png` (PNG on an opaque `#FBFBFB` background, so transparent areas do not turn into black corners on iOS); and rewrites the page's original `<link rel="manifest">` to the plugin route with `webServer.tapIndex` — so a future DSH manifest rename cannot silently disable the plugin;
4. only `enabled: false` turns the plugin off entirely; a missing bundled asset is only a warning (its route answers 404); a configured `icon` whose file does not exist yet is also only a warning (routes still register, so the file appearing later is picked up); a `manifestUrl` / `iconUrl` that is not an absolute `/`-prefixed path, or that equals the other one, warns and stays inactive (named routes match the pathname exactly, so a malformed path would silently never match).

**Mount prefix (important)**: `manifestUrl` / `iconUrl` are **backend** paths (what DSH sees after a reverse proxy strips its prefix). Public URLs are emitted **relative** by default — the injected link is `./manifest.webmanifest`, the `apple-touch-icon` is `./pwa/apple-touch-icon.png`, the manifest's `start_url` / `scope` are `./`, and `icons[].src` is `pwa/icon-192.png` resolved against the manifest URL — the same convention as DSH's own dist manifest. That works both at the origin root and behind a prefix-stripping reverse proxy (e.g. DSH mounted at `/dsh`).

> Hard-coded root-absolute URLs (`/manifest.webmanifest`, `start_url: "/"`) 404 under a `/dsh`-style mount: the browser gets no manifest and no icon, so it falls back to a **generated icon** (site badge + app name tile) — hit for real on 2026-10-15. Use `publicBase` only when the page is not served at the mount root.

Chromium's install check requires PNG / SVG / **WebP** at least 144px and **an explicit `sizes` attribute** (`Manifest does not contain a suitable icon - PNG, SVG or WebP format of at least 144px is required, the sizes attribute must be set, and the purpose attribute, if set, must include "any" or "maskable".`). The bundled set declares its real sizes; for a custom single image, get it right yourself.

## Install

```bash
dsh plugin --profile web add dsh-pwa-icon        # install from npm
```

**No configuration is needed**: the icon set ships inside the package, one line is appended to the profile's `dsh.profile.bundles`, and the icon works.

> Installing from a local checkout (development): `pnpm --filter dsh-pwa-icon build` first, then `dsh plugin --profile web add ./packages/dsh-pwa-icon`; link installs do not run `prepare`.

**How it takes effect**: DSH ships `dsh-hmr` (`dsh-base`'s `hmr` row, enabled by default in compositions that carry a profile context) and watches the profile's `cordis.patch.yml` and `package.json`, so installing the plugin or editing its config **hot-reloads the composition without restarting `dsh web`** (config edits were observed to apply within seconds).

Note, however: a hot reload is **not guaranteed to re-import an already-loaded plugin module** — config edits always applied within seconds in practice, while swapping the module inside `node_modules` applied immediately in one case and did not in another (observed 2026-10-15 and 2026-10-16). So **after upgrading the package version, check the actual output** (e.g. `curl <prefix>/manifest.webmanifest`); if nothing changed, **restart `dsh web`**. Compositions that explicitly disable HMR apply changes on the next restart.

## Configuration

By default **nothing needs configuring**. To use your own image:

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    icon: /path/to/icon.webp
    sizes: 512x512
```

To change only the name (the iOS "Add to Home Screen" label comes from the manifest's `short_name`, which defaults to `DSH`):

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    manifest:
      short_name: DeepSeek Harness
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `icon` | none (the **bundled icon set** is used) | image path (absolute recommended; relative resolves against the dsh process cwd). Once set, only that file is used and `sizes` / `type` / `purpose` / `iconUrl` apply |
| `sizes` | in single-image mode `any` + warning (SVG: `any`) | manifest icon `sizes`; use the real pixel size for raster images (a wrong or missing value may make Chromium ignore the icon) |
| `type` | from extension | `image/*` only (anything else warns and falls back to the extension); `.webp` / `.png` / `.jpg` / `.jpeg` / `.svg` / `.gif` / `.avif` / `.ico` |
| `purpose` | `any` | manifest icon `purpose` (use `maskable` for Android adaptive icons that respect the safe zone) |
| `iconUrl` | `/pwa/icon<ext>` | **backend** route path of the image in single-image mode (must start with `/` and differ from `manifestUrl`); the public URL is emitted relative by default |
| `manifestUrl` | `/manifest.webmanifest` | **backend** route path of the manifest (must start with `/`); the public URL is emitted relative by default |
| `publicBase` | none (relative URLs) | the mount prefix the browser sees (e.g. `/dsh`); needed only when the page is not served at the mount root, in which case public URLs become `<publicBase><route>` |
| `manifest` | none | extra manifest fields (override defaults, e.g. `short_name` / `name`); an explicit `icons` array wins |
| `appleTouchIcon` | `true` | inject `<link rel="apple-touch-icon">` |

## Caveats

- **An already installed PWA does not pick up a new icon automatically**: both the icon and the name are captured at install time. Uninstall it (or delete the desktop shortcut / home-screen icon) and install / add it again.
- **The bundled icon set is distributed publicly on npm**: those images are the maintainer's, and anyone can `npm pack` them; use `icon` with your own file if you want a private image.
- **Do not keep a configured `icon` in a volatile directory**: cleaning `~/Downloads` makes the icon route answer 404 immediately (hit for real on 2026-10-15) — use the bundled set, or put the image somewhere stable.
- **PNG is the safe bet for iOS**: Apple documents the Web Clip icon as PNG (`apple-touch-icon`, commonly 180×180 with an opaque background); the bundled set ships `apple-touch-icon-180.png`. With a custom `icon` in WebP, iOS is not guaranteed (iOS 26 was observed reading the manifest's WebP icon, but Apple only documents PNG).
- **All icon routes are public static routes**: browsers fetch manifest icons without credentials, so gating them would break icon loading; the images are therefore visible to anything that can reach the port (same nature as the existing favicon and dist manifest).
- **Check that the browser really got the manifest and the icons**: an installed icon that looks like a generated tile (site badge + app name) means the browser found no usable manifest — usually a mount-prefix problem (see "Mount prefix" above). Use DevTools → Application → Manifest, or curl `<prefix>/manifest.webmanifest` and then each `icons[].src` (all should be 200).
- Swapping the image needs no restart: the icon routes re-read per request.

## Version compatibility

This package declares no `@deepseek-ai/dsh-*` peerDependencies, so the DSH version gate does not constrain it (the gate only looks at those peers); it relies solely on the stable `webServer.register`, `webServer.tapIndex`, and `webserver/index-inject` interfaces.
