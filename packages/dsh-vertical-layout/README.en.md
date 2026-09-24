# dsh-vertical-layout

[简体中文](README.md) | **English**

A portrait-orientation layout plugin for DSH: **only on desktop (non-mobile) screens**, when the browser window is taller than wide, it rearranges the three-column layout into "left navigation + top-right files / terminal + bottom-right chat" so the chat area gets the full width in portrait.

[![DSH 0.1.7-alpha.2](https://img.shields.io/badge/DSH-0.1.7--alpha.2-4f7cff)](https://github.com/feng-yifan/dsh-vertical-layout)

## Problem it solves

DSH's Web UI consists of three columns: left navigation, center chat, and a right dock panel hosting files and the terminal.

- In **portrait** orientation (window height > width — e.g. a rotated monitor or a narrow window), opening the right panel squeezes the center chat into a narrow strip.
- When this plugin detects "desktop + portrait + right panel open", it rearranges the three columns into:
  - **Left column**: navigation, spanning the full column height;
  - **Top-right**: the files / terminal dock panel (height ≈ 40% of the window by default; configurable and drag-adjustable);
  - **Bottom-right**: the chat area, spanning the full width beyond the navigation;
  - A divider between chat and the dock, using the same design token as DSH's panel boundaries (`--dsw-alias-border-l4`, renders identically to native column edges), with a **drag handle** on it to resize the dock height like a native width handle;
  - The vertical line on the dock's left edge is removed (the leftover "left border" look from the right-side layout) — both the navigation's `border-right` and the dock's dockkit pane `border-left` are removed; the boundary is conveyed by background difference plus the bottom divider;
  - The open / collapse button icons rotate 90°, turning "panel on the right" into "panel on top".
- **Touch devices (phones / tablets) are completely unaffected**: when the primary pointer is `coarse`, no styles are injected and the portrait behavior stays identical to native DSH.

## Behavior

| Environment | Behavior |
| --- | --- |
| Desktop · landscape | No changes (native three-column layout) |
| Desktop · portrait · right panel closed | Layout untouched (only the open-button icon rotates to signal the panel is on top) |
| Desktop · portrait · right panel open | Navigation spans the full left column; files / terminal top-right, chat bottom-right with a divider between them; drag the divider to adjust the dock height |

## Installation

### Option 1: package install (recommended)

Build the artifacts at the repo root (this repo already commits `lib/`, so it can be installed directly):

```sh
dsh plugin --profile web add ./dsh-vertical-layout
```

> On first install pnpm links this directory; when installing from git, the `prepare` script runs the build automatically (pnpm ≥ 10 requires authorizing `allowBuilds` for git dependencies — see the [DSH plugin publishing docs](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)).

Restart `dsh web` after installing.

### Option 2: `--patch` local debugging

No build needed (requires Node ≥ 22.18's native TypeScript type-stripping to load the source directly):

```sh
# at the repo root
dsh web --patch ./cordis.dev.patch.yml
```

On older Node, run `npm run build` first, then change the plugin's `name` in `cordis.dev.patch.yml` to `./lib/index.js`.

## Configuration

Override the plugin row in the profile's `cordis.patch.yml` (or any overlay):

```yaml
- id: vertical-layout
  name: dsh-vertical-layout
  config:
    enabled: true      # master switch, default true
    topRatio: 0.4      # initial dock height / window height, default 0.4 (clamped to 0.2–0.6)
    topMin: 220        # minimum dock height px, default 220
```

> The initial height is set by `topRatio`; afterwards you can drag the handle on the divider, within 0.15–0.7 of the window height (and never below `topMin`) for the current session.

> When overriding config, `name` must exactly match the plugin row (packaged install: `dsh-vertical-layout`; `--patch` local debug: the resolved `file://...src/index.ts`), otherwise the patch skips the row because of the name mismatch.

Config changes require restarting `dsh web` (the index.html injection happens at server render time).

## How it works

- This is a **host-side plugin**: it builds no client bundle and depends on no CSS Modules hashed class names.
- The plugin listens to the `webserver/index-inject` event (the same pattern as DSH's built-in `ui-theme` boot injection) and injects a `<script>` on every `index.html` render.
- In the browser, the injected script:
  1. Uses `matchMedia('(hover: hover) and (pointer: fine)')` to detect a desktop screen; phones / tablets exit immediately;
  2. Uses a `MutationObserver` to wait for the three-column frame to appear (the parent of `[data-rightbar-col]`);
  3. When "portrait + right panel open (no `data-rightbar-collapsed`) + not fullscreen", rearranges the grid:
     - The frame becomes two rows: top-right dock + bottom-right chat; column tracks (widths) stay React-managed, while the rightbar and chat span to the last track via `grid-column: 2 / -1`, covering the whole right region;
     - The navigation (formerly the left column) uses `grid-row: 1 / -1` to span the full left-column height, and its native `border-right` is removed; the dock's dockkit pane `border-left` (`--dsw-alias-border-l4`) is removed by the stylesheet as well — both lines sit on x=280 and are exactly the "left border" leftover; removing both makes the whole vertical line disappear;
     - The dock panel fills the top-right region via an injected stylesheet rule `[data-dsh-vertical-layout] [data-sidebar-right-panel] { width: 100% !important }` — React rewrites the panel's inline `width` on every render, so an inline `!important` would be dropped wholesale; only a stylesheet rule keeps winning (and toggles automatically with the `data-dsh-vertical-layout` attribute);
     - A divider is drawn at the bottom of the rightbar (`0.5px solid var(--dsw-alias-border-l4)` — the same token as DSH's native column boundaries: it's the level dockkit uses for the left border of the leftmost column's tabHost, rendering as 1px rgb(214,214,214) in the light theme);
     - An absolutely-positioned drag handle sits on the divider: pointer capture + `pointermove` turns the pointer offset into a dock height ratio (clamped to 0.15–0.7), written to `grid-template-rows`, and the handle position is synced; a `ResizeObserver` follows navigation width changes (when dragging the left nav) and window resizes;
     - The rightbar's width handle is hidden (its width is replaced by "fills the top-right"), and the navigation handle grows to full height;
  4. When the conditions don't hold (landscape / panel closed / fullscreen / touch), all inline styles are cleared and the drag handle is removed, restoring the native layout;
  5. On desktop portrait (regardless of the panel state), the open / collapse button icons rotate 90° — from "panel on the right" (vertical divider) to "panel on top" (horizontal divider below).
- All changes happen inline at runtime in the browser; uninstalling the plugin (and reloading the page) fully restores the original UI.

## DSH version compatibility

The DSH plugin ecosystem has **no dedicated "supported DSH version" field**: the `dsh.bundle` manifest only declares a `patch` file, and there is no `requiresVersion` / `minDshVersion` key. In practice, compatibility is expressed three ways:

- **Official bundles pin their internal packages through `peerDependencies`** with exact DSH versions (e.g. `"@deepseek-ai/dsh-llm": "0.1.7-alpha.2"`, `"@deepseek-ai/cordis": "~4.0.4"`). Because the profile's node_modules resolves those against the DSH installation, the peer range acts as a de-facto "compatible with DSH version X" declaration — pnpm warns or fails if the installed DSH's internals don't match.
- **`engines` is reserved for the runtime**, not the DSH version: this plugin declares `"node": ">=22.18.0"` because the `--patch` dev mode loads the TypeScript source via Node's native type-stripping.
- **The README badge documents the tested DSH version**: this plugin is built and verified against **DSH `0.1.7-alpha.2`**.

**How this plugin declares it**: it deliberately pins nothing and stays version-agnostic. As a host-side plugin it has no runtime imports of `@deepseek-ai/*` (so a `peerDependencies` pin would be meaningless — the profile's node_modules contains no `@deepseek-ai/dsh` to resolve against; the CLI is global). It relies only on stable DOM data attributes (`data-rightbar-col`, `data-sidebar-right-panel`, `data-sidebar-right-expand`, …) and design-token CSS variables (`--dsw-alias-border-l4`, `--dsw-alias-interactive-bg-hover`). It therefore tracks the DSH version loosely: it breaks only if DSH renames those stable attributes or tokens. If you upgrade DSH, just check the UI once after startup.

## Known limitations

- When the window is too narrow (roughly < 700px, depending on sidebar state), DSH's native logic decides there is "no space" and refuses to open the right panel; this plugin cannot help there (it's decided by the frame's column-width resolution; no regression is introduced).
- When the right panel is fullscreen (`data-rightbar-fullscreen`), the plugin does not intervene and the panel covers the window as usual.
- In portrait, the rightbar's width drag handle is hidden (width is replaced by "fills the top-right"); it comes back in landscape. Dragging the left navigation narrows the dock proportionally (right region width = window width − nav width) and the panel always fills that region.
- The divider drag handle only appears when the vertical layout is active; dock height adjustments are session-only and reset to `topRatio` after a reload.
- The open / collapse button icon rotation uses an inline `transform` that overrides DSH's built-in mirror transform — appearance only, the click area is untouched.
- Phones / tablets skip this plugin entirely; portrait optimization on them is the job of other mobile solutions (e.g. dsh-web-mobile).

## Verification

The repo ships a Playwright verification script covering five scenarios (desktop portrait active / desktop landscape untouched / mobile touch not executed / tablet touch untouched / drag interactions — panel still fills after nav drag, height drag and clamping, height preserved after collapse & reopen):

```sh
pnpm add -D playwright        # first run only
node scripts/verify-layout.mjs "http://127.0.0.1:3090/?token=<TOKEN>"
```

## Development

```sh
npm run build    # compile src/ to lib/ (tsc)
npm run verify   # type-check only
```

## License

MIT
