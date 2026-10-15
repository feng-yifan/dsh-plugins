# dsh-pwa-icon

DSH PWA icon: use a picture of your choice as the app icon when the Web GUI is **installed / added to the desktop** as a PWA.

Chromium takes the installed app icon only from the Web App Manifest `icons` (the shipped DSH dist manifest declares its own `favicon.svg`, so the default install icon is the DSH logo); touching the favicon or `apple-touch-icon` does not affect it. This plugin takes over the manifest route, replaces `icons` with the configured image, and additionally injects the `apple-touch-icon` used by iOS "Add to Home Screen".

## How it works

A host-side plugin with no client bundle and no `@deepseek-ai/*` runtime dependency:

1. registers the exact route `/manifest.webmanifest` (configurable via `manifestUrl`) and serves a manifest built from config: the default fields mirror the shipped release (`name` / `short_name` / `start_url` / `scope` / `display`), while `icons` is **replaced** by the configured image (appending would let the browser pick the SVG back, hence replacement);
2. registers the exact route `/pwa/icon.<ext>` (configurable via `iconUrl`) and reads the configured image file per request with the right `content-type`; a missing file returns 404 and nothing on disk is touched;
3. injects `<link rel="apple-touch-icon">` through `webserver/index-inject` (disable with `appleTouchIcon: false`) and rewrites the page's original `<link rel="manifest">` to the plugin route with `webServer.tapIndex` — so a future DSH manifest rename cannot silently disable the plugin;
4. with no `icon` configured it only logs a warning and registers nothing, leaving startup untouched; a configured `icon` whose file does not exist yet is also only a warning (the routes still register, so the file appearing later is picked up); a `manifestUrl` / `iconUrl` that is not an absolute `/`-prefixed path, or that equals the other one, warns and stays inactive (named routes match the pathname exactly, so a malformed path would silently never match).

Chromium's install check requires PNG / SVG / **WebP** at least 144px and **an explicit `sizes` attribute** (`Manifest does not contain a suitable icon - PNG, SVG or WebP format of at least 144px is required, the sizes attribute must be set, and the purpose attribute, if set, must include "any" or "maskable".`). Raster images should therefore declare their real pixel size.

## Install

```bash
# from the dsh-plugins repository root (profile named web):
pnpm --filter dsh-pwa-icon build          # link installs do not run prepare, so build first
dsh plugin --profile web add ./packages/dsh-pwa-icon
```

A local path installs as a link dependency and appends one line to the profile's `dsh.profile.bundles`.

**How it takes effect**: DSH ships `dsh-hmr` (`dsh-base`'s `hmr` row, enabled by default in compositions that carry a profile context) and watches the profile's `cordis.patch.yml` and `package.json`, so installing the plugin or editing its config **hot-reloads the composition without restarting `dsh web`**; `root: []` only disables the "plugin source directory" watch, so **changing this plugin's own source needs a `pnpm build` plus one reload or a restart**. Compositions that explicitly disable HMR apply changes on the next restart.

## Configuration

Point the profile's `cordis.patch.yml` at the image (the plugin is inactive without it):

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    icon: /home/viktor/Downloads/400x400bb-75.webp
    sizes: 400x400
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `icon` | none | image path (absolute recommended; relative resolves against the dsh process cwd). **Without it the plugin stays inactive** |
| `sizes` | `any` for SVG, `any` + warning otherwise | manifest icon `sizes`; use the real pixel size for raster images |
| `type` | from extension | `image/*` only (anything else warns and falls back to the extension); `.webp` / `.png` / `.jpg` / `.jpeg` / `.svg` / `.gif` / `.avif` / `.ico` |
| `purpose` | `any` | manifest icon `purpose` |
| `iconUrl` | `/pwa/icon<ext>` | public URL path of the image (must start with `/` and differ from `manifestUrl`) |
| `manifestUrl` | `/manifest.webmanifest` | public URL path of the manifest (must start with `/`) |
| `manifest` | none | extra manifest fields (override defaults); an explicit `icons` array wins |
| `appleTouchIcon` | `true` | inject `<link rel="apple-touch-icon">` |

## Caveats

- **An already installed PWA does not pick up a new icon automatically**: the icon is captured at install time. Uninstall it (or delete the desktop shortcut) and install / add to desktop again.
- **For iOS, pair the `apple-touch-icon` with a PNG**: Safari's support for WebP behind that link is limited and it usually expects a 180×180 PNG; this plugin serves the configured image as-is and never rescales or transcodes (Chromium uses the manifest, where WebP is fine).
- **Both routes are public static routes**: browsers fetch manifest icons without credentials, so gating them would break icon loading; the image is therefore visible to anything that can reach the port (same nature as the existing favicon and dist manifest). To narrow that, give `iconUrl` a random token path.
- **Sub-path deployments need explicit config**: the default `iconUrl` / `manifestUrl` and the manifest `start_url` / `scope` are absolute paths assuming the GUI is served from the origin root; behind a `/dsh/`-style prefix they must be configured, while the dist itself uses `./` links plus `<base href="./">`.
- Swapping the image needs no restart: the icon route re-reads per request.

## Version compatibility

This package declares no `@deepseek-ai/dsh-*` peerDependencies, so the DSH version gate does not constrain it (the gate only looks at those peers); it relies solely on the stable `webServer.register`, `webServer.tapIndex`, and `webserver/index-inject` interfaces.
