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

The same two fields may appear in `cordis.patch.yml`, but that file only **seeds the initial state.json**: once the settings page has written a value, state.json wins and the profile file no longer overrides it.

### Why a separate state file

`cordis.patch.yml` is a composition-layer declaration; a plugin editing it at runtime triggers a Loader reload of the whole plugin chain. These two switches only change *what gets injected*, so keeping them in the plugin's own state file — read fresh on every `webserver/index-inject` — is far cheaper. This mirrors how `dsh-enhancement` stores its config.

## Known trade-offs

- Cancelled ask blocks (also in the finished state, labelled "cancelled") are highlighted as well; telling them apart would require reading the text, which this plugin does not do.
- Colors come from the DSH theme token `--dsw-alias-state-business-primary`, so light and dark themes adapt automatically.
- The expanded card uses one 8px padding on all four sides: the content card's own `margin: 4px 0 4px 4px` is neutralized and the normally hidden "inspect" button becomes an absolutely positioned overlay, so it no longer pads the card's bottom with a blank strip.
- "Expand by default" relies on DSH's `data-*` contract (`data-tool`, `data-disclosure-row`, `data-disclosure-header`, `data-open`, `aria-expanded`, `data-chat-call-id`). If DSH renames those, expansion fails silently; the highlight style is unaffected.
- A collapsed ask block keeps its details out of the DOM entirely, so expanding reuses DSH's own disclosure action (the script clicks the row once) instead of forcing it with CSS. Bookkeeping is per **DOM node** (a `WeakSet` held in page memory only — nothing is persisted, and a refresh clears it), so: a block expands when it appears; **a block you collapse by hand stays collapsed** (otherwise streaming output and scrolling, which mutate the DOM, would keep re-opening it); and **a page refresh or a session switch expands it again** — switching sessions unmounts and rebuilds the subtree, so those are new nodes and therefore new blocks.

## Version compatibility

This plugin declares no `@deepseek-ai/dsh-*` peerDependencies, so the DSH version gate does not constrain it.
