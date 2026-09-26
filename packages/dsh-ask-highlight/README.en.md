# dsh-ask-highlight

[简体中文](README.md) | **English**

Highlight **answered** ask blocks (“question n/n answered”) in the conversation thread as a soft card (light brand-color tint + rounded corners, theme-aware). Pending ask blocks (“waiting for answer”) and other tool rows keep their normal look.

## How it works

The ask block is rendered by `dsh-client-ui-tool`; its root node carries stable attributes `data-tool="ask_user_question"` and `data-state` (`ok` = answered/cancelled, `running` = waiting). This plugin injects a `<style>` via `webserver/index-inject`, targeting `[data-tool="ask_user_question"][data-state="ok"]` — no CSS Modules hashed class names needed. Colors use the `--dsw-alias-state-business-primary` theme token with `color-mix`, so it adapts to light and dark themes automatically. Host-side only, no client bundle.

## Install

```bash
# run from the dsh-plugins repo root (profile name: web)
dsh plugin --profile web add ./packages/dsh-ask-highlight
```

Local paths install as link dependencies; the profile's `dsh.profile.bundles` gets one more row. The style is injected when index.html is rendered, so a browser refresh is enough; if it does not show up, restart dsh web.

## Config

Enabled by default. Turn it off via config in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-ask-highlight
  name: dsh-ask-highlight
  config:
    enabled: false
```

## Known trade-offs

- Cancelled ask blocks (`data-state` is also `ok`, text “cancelled”) are highlighted too; excluding them would require JS to inspect the text, which this plugin does not do.
