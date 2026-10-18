# dsh-enhancement

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

A standalone password gateway for DSH Web, plus everything needed to use DSH like an app on your phone: PWA installation, desktop notifications, and mobile push.

Set a password, open the gateway URL, and log in to DSH without carrying around the `?token=` URL printed by `dsh web`. Add DSH to your phone's home screen and get notified when a task finishes or needs your approval—tap the notification to return to the right session.

## Features

| Feature | What it does |
| --- | --- |
| Password gateway | Access DSH through a dedicated port and password instead of `?token=`, suitable for LAN or remote use |
| HTTPS | Upload a certificate, sign with your own CA, or let the plugin create a local CA |
| PWA | Install DSH on the desktop or phone home screen, with custom app name, theme color, and icons |
| Desktop notifications | System notifications for task completion, questions, approvals, and background jobs |
| Mobile push | PWA Web Push notifications on your phone; tap to return to the matching session |

## Password gateway

- Off by default; listens on port `3088` by default, configurable to another free port.
- A password must be set before the gateway can be enabled. Only a hash of the password is stored.
- After login, the gateway keeps its own session; DSH's `?token=` is not needed.
- Choose which network interface to listen on.
- Works with normal DSH chat, files, terminal, WebSocket, and live streams.
- Configurable login session lifetime; changing the password invalidates all gateway sessions.

## HTTPS

PWA installation, Service Workers, and mobile push require HTTPS (localhost is exempt). Three options are available:

| Option | When to use it |
| --- | --- |
| Off (HTTP) | Temporary local/trusted-network use; PWA and push are unavailable |
| Use an existing certificate | You already have a domain certificate; upload the chain and private key |
| Sign with a CA | Upload your own CA, or let the plugin generate a local CA and issue a certificate for the current address |

For a self-signed/private CA, install and trust the CA certificate on each device:

- iOS: Settings → General → VPN & Device Management to install the profile, then General → About → Certificate Trust Settings and enable full trust.
- Android: Settings → Security → Encryption & credentials → Install a certificate.

The certificate must cover the hostname or IP you actually use (SAN), otherwise browsers will still show a certificate error.

## PWA

- Takes over DSH's manifest, icons, `apple-touch-icon`, Service Worker, and install prompt.
- Customize the app name, short name, theme color, and replace desktop/Android/iOS icons separately.
- Chromium / Edge show an install prompt; iPhone / iPad use Safari's “Share → Add to Home Screen”.
- Installed apps open without browser chrome; HTTPS is required for installation, Service Worker, and push.

## Notifications

Supported events, all enabled by default and individually selectable:

- Task completed
- Waiting for your answer
- Waiting for approval
- Approval denied
- Subagent finished
- Goal completed or blocked
- Background job finished (not every command)

Desktop notifications and mobile push share the event selection but can be enabled independently.

Clicking a desktop notification opens the matching session. On Linux and Windows, if DSH is already open, it focuses the existing page and switches to that session; on macOS the system notification opens the link. On Linux, the system notification service must support actions (common desktop environments do); if notifications appear but clicks do nothing, check that `notify-send` and an action-capable notification service are available.

## Mobile push

- Standard Web Push with one subscription per device.
- Click “Subscribe this device” in settings; the browser asks for notification permission, which must be triggered by your click.
- iOS / iPadOS 16.4+ is required, and DSH must be added to the Home Screen; regular Safari tabs cannot receive push.
- Unsubscribe at any time, or send a test push to verify the setup.

## Install

```bash
dsh plugin --profile web add dsh-enhancement
```

Restart DSH Web after installation. The plugin brings in the mobile and portrait-layout dependencies automatically; do not install or enable them separately.

## Getting started

1. Open DSH → Settings → Plugins → `dsh-enhancement`.
2. Under “Access control”, set a password and save. The gateway enable switch becomes available after a password is set.
3. Under “Gateway”, choose the listen address and port (default `3088`), enable the gateway, and save.
4. If you need HTTPS, choose a certificate option in the same section and save. For a self-signed CA, install and trust the CA certificate on your devices.
5. Open the gateway URL on your phone or another computer and log in with the password; DSH's `?token=` is not required.
6. To use it as an app, install the PWA in your browser; on iOS use “Share → Add to Home Screen”.
7. Under “Notifications”, select the events you want and click “Test desktop notification”. For mobile push, enable push and click “Subscribe this device”.

## Tips

- Use HTTPS and a strong password before exposing the gateway to the internet.
- Do not reuse DSH's own port (default `3080`) for the gateway; choose another free port if needed.
- Self-signed certificates are best for devices you control; use a proper certificate when sharing with others.
- If you only use DSH locally, leave the gateway off; the normal DSH access path is unaffected.

## Limitations

- The gateway, PWA, and push are off by default and require setup; the gateway cannot be enabled before a password is set.
- PWA installation, Service Worker, and Web Push all require HTTPS.
- iOS push requires 16.4+ and installation on the Home Screen.
- A self-signed/private CA must be installed and trusted on every device.
- Linux notification click support depends on the notification service implementing actions.
- Changing the password invalidates all gateway sessions, so you will need to log in again.

## License

MIT
