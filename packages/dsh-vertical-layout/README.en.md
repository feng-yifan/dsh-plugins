# dsh-vertical-layout

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Portrait layout for DSH: **on desktop screens only (never phones / tablets)**, when the browser window is in portrait orientation, the three columns are rearranged into "navigation on the left + file / terminal top-right + conversation bottom-right", giving the conversation its full width.

## The problem

The DSH Web UI has three columns: navigation on the left, the conversation in the middle, and a docked file / terminal panel on the right. In portrait orientation (window narrower than tall — a rotated monitor, a narrow window) opening the right panel squeezes the conversation into a very narrow strip.

When the plugin detects "desktop + portrait + right panel open" it rearranges:

- **left column**: navigation, full column height;
- **top right**: the file / terminal panel (initially ~40% of the window height, configurable and draggable);
- **bottom right**: the conversation, spanning the full width outside the navigation column;
- between them runs a divider matching DSH's native column border, with a drag handle on it; the open / collapse button icon rotates 90° to say the panel is on top;
- **phones and tablets are completely unaffected**: touch devices get no injected styles and keep the native portrait layout.

## Behaviour

| Environment | Result |
| --- | --- |
| Desktop · landscape | nothing changes (native three columns) |
| Desktop · portrait · right panel closed | layout unchanged (only the open-button icon rotates) |
| Desktop · portrait · right panel open | navigation fills the left column; file / terminal top-right, conversation bottom-right, with a draggable divider between them |

## Install

```bash
dsh plugin --profile web add dsh-vertical-layout
```

Restart `dsh web` after installing.

## Config

Override the plugin row in the profile's `cordis.patch.yml`:

```yaml
- id: vertical-layout
  name: dsh-vertical-layout
  config:
    enabled: true      # master switch, default true
    topRatio: 0.4      # initial docked height / window height, default 0.4 (clamped to 0.2–0.6)
    topMin: 220        # minimum docked height in px, default 220
```

The initial height comes from `topRatio`; it can then be dragged within the session (0.15–0.7 of the window height, never below `topMin`). Restart `dsh web` after changing the config.

## Known limitations

- With a very narrow window (roughly < 700px, depending on sidebar state) DSH's own layout logic decides there is no room and the right panel cannot be opened — that comes from the framework's column solver and this plugin does not interfere.
- When the right panel is fullscreen the plugin stays out of the way; the panel covers the window as usual.
- In portrait the right-column width handle is hidden (the width comes from "fill the top-right area"), and it returns in landscape; dragging the left navigation proportionally narrows the docked area.
- The docked height only lasts for the session; after a refresh it returns to `topRatio`.
- Phones / tablets skip this plugin entirely; use another solution for mobile portrait (e.g. dsh-web-mobile).

## Version compatibility

This plugin declares no `@deepseek-ai/dsh-*` peerDependencies (it only relies on stable DOM data attributes and design-token CSS variables), so the DSH version gate does not constrain it; after upgrading DSH, glance at the UI once to confirm.

## License

MIT
