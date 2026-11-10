# dsh-vertical-layout

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Portrait layout for DSH: **on desktop screens only (never phones / tablets)**, when the browser window is in portrait orientation, the three columns are rearranged into "navigation on the left + file / terminal top-right + conversation bottom-right", giving the conversation its full width.

## Layout behaviour

| Environment | Result |
| --- | --- |
| Desktop · landscape | nothing changes (native three columns) |
| Desktop · portrait · right panel closed | three columns are still rearranged for portrait, but the docked track height is 0 (only the open-button icon rotates, indicating the panel is on top) |
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
    topMin: 220        # minimum docked height in px, default 220 (minimum 120)
```

The initial height comes from `topRatio`; it can then be dragged within the session (0.15–0.7 of the window height, never below `topMin`; values below 120 are treated as 120). Restart `dsh web` after changing the config.

## Known limitations

- With a very narrow window (roughly < 700px, depending on sidebar state), the right panel cannot be opened.
- When the right panel is fullscreen the plugin stays out of the way; the panel covers the window as usual.
- In portrait the right-column width handle is hidden (the width comes from "fill the top-right area"), and it returns in landscape; dragging the left navigation proportionally narrows the docked area.
- The docked height only lasts for the session; after a refresh it returns to `topRatio`.
- Phones / tablets skip this plugin entirely; use another solution for mobile portrait (e.g. dsh-web-mobile).

## License

MIT
