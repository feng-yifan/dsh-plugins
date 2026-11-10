# dsh-ask-highlight

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Highlight **answered** ask blocks ("question n/n answered") in the conversation thread as a soft card (light brand-color tint + rounded corners, theme-aware), and optionally keep ask blocks expanded by default. Pending ask blocks ("waiting for answer") and other tool rows keep their normal look.

## Install

```bash
dsh plugin --profile web add dsh-ask-highlight
```

Refresh the browser after installing; if nothing changes, restart `dsh web`.

## Config

Once installed, configure it under **Settings → Plugins → 提问块高亮** (Ask Highlight). Two switches:

| Switch | Default | Meaning |
| --- | --- | --- |
| Highlight answered ask blocks | On | Master switch. Off injects neither the highlight style nor the expand script |
| Expand ask blocks by default | Off | When on, every ask block (pending / answered / cancelled) expands the first time it appears |

Press **Save**, then **refresh the page** — no `dsh web` restart needed.

The configuration lives inside the active profile:

```
$DSH_HOME/profiles/<profile>/fengyifan-dsh-ask-highlight/state.json
```

The settings card shows the actual path. Each profile keeps its own copy.

The same two fields may appear in `cordis.patch.yml`, but that file only seeds the initial state.json: once the settings page has written a value, state.json wins and the profile file no longer overrides it.

## Known limitations

- Cancelled ask blocks (also in the finished state, labelled "cancelled") are highlighted as well.
- Colors adapt automatically to the light / dark DSH theme.
- In the expanded state, padding is a uniform 8px on all four sides.
- "Expand by default" relies on DSH's DOM conventions; if DSH changes them, expansion fails silently, but the highlight style is unaffected.
- With expand-by-default on: a block expands when it appears; a block you collapse by hand stays collapsed; and a page refresh or a session switch expands it again.
