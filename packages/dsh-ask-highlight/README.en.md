# dsh-ask-highlight

[简体中文](README.md) | **English**

Highlight **answered** ask blocks ("question n/n answered") in the conversation thread as a soft card (light brand-color tint + rounded corners, theme-aware). Pending ask blocks ("waiting for answer") and other tool rows keep their normal look.

## Install

```bash
dsh plugin --profile web add dsh-ask-highlight
```

Refresh the browser after installing; if nothing changes, restart `dsh web`.

## Config

Enabled by default. Turn it off in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-ask-highlight
  name: dsh-ask-highlight
  config:
    enabled: false
```

## Known trade-offs

- Cancelled ask blocks (also in the finished state, labelled "cancelled") are highlighted as well; telling them apart would require reading the text, which this plugin does not do.
- Colors come from the DSH theme token `--dsw-alias-state-business-primary`, so light and dark themes adapt automatically.

## Version compatibility

This plugin declares no `@deepseek-ai/dsh-*` peerDependencies, so the DSH version gate does not constrain it.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
