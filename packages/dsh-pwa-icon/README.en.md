# dsh-pwa-icon

[简体中文](README.md) | **English**

Use the picture you want as the app icon when the DSH Web GUI is **installed / added to the desktop** as a PWA (desktop browsers and the iOS Home Screen).

- **Works out of the box**: the package ships its own icon set (192 / 512 / maskable 512 / 1600, plus a 180 PNG for iOS), so no configuration is needed.
- **Bring your own image**: point `icon` at your own picture.
- **Rename the app**: the manifest `short_name` defaults to `DSH` (shown as the desktop shortcut / home-screen label); override it with `manifest.short_name`.

## Install

```bash
dsh plugin --profile web add dsh-pwa-icon
```

## Configuration (optional)

```yaml
- id: pwa-icon
  name: dsh-pwa-icon
  config:
    icon: /path/to/icon.webp          # your own image; omit to use the bundled set
    sizes: 512x512                    # only needed with icon: the image's real pixel size
    manifest:
      short_name: DeepSeek Harness    # desktop / home-screen label
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `icon` | the bundled icon set | path to your own image; once set, only that file is used and `sizes` / `type` / `purpose` / `iconUrl` apply |
| `sizes` | — | with `icon`, the image's real pixel size (e.g. `512x512`); a wrong value may make the browser ignore the icon |
| `type` | from the extension | `image/*` only |
| `purpose` | `any` | use `maskable` for Android adaptive icons |
| `manifest` | — | extra / overriding manifest fields, e.g. `short_name`, `name` |
| `appleTouchIcon` | `true` | inject the `apple-touch-icon` used by iOS |
| `iconUrl` / `manifestUrl` / `publicBase` | — | advanced: custom route paths for the icon or manifest, reverse-proxy mount prefix; normally untouched |

## Taking effect and updating

- **Config changes**: saving the profile's `cordis.patch.yml` hot-reloads within seconds.
- **Upgrading the package version**: a hot reload does not guarantee re-importing the module — check the actual output first (`curl <your entry>/manifest.webmanifest`), and restart `dsh web` if nothing changed.
- **Swapping the image file**: icons are re-read per request, no restart needed.
- **An already installed PWA does not pick up a new icon or name**: both are captured at install time; uninstall it (or delete the desktop shortcut / home-screen icon) and install / add it again.

## Troubleshooting

- **The installed icon is a "site badge + app name" tile** → the browser got no usable manifest. Check that `manifest.webmanifest` is reachable under your entry point and that every `icons` URL in it returns 200.
- **The icon 404s after configuring `icon`** → that image file was moved or deleted (anything in `~/Downloads` gets cleaned up easily). Move it somewhere stable, or go back to the bundled set.
- **The icon routes are public** → browsers fetch icons without credentials (same nature as the favicon), so configuring `icon` exposes that image to anything that can reach the port.
- **iOS** → the home-screen label comes from the manifest `short_name`; the icon prefers `apple-touch-icon` (the package ships a 180×180 opaque PNG); iOS 26 was also observed reading the WebP icon from the manifest.
- **The bundled icons come from this repository's maintainer** and are distributed publicly on npm; configure `icon` if you want your own.

## Version compatibility

This package declares no `@deepseek-ai/dsh-*` peerDependencies, so the DSH version gate does not constrain it.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
