# dsh-plugins

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (pnpm monorepo).

## Plugins

| Plugin | What it does |
| --- | --- |
| [`dsh-vertical-layout`](packages/dsh-vertical-layout) | Portrait layout: on a portrait desktop window, moves the file / terminal panel above the conversation; its height is draggable |
| [`dsh-ask-highlight`](packages/dsh-ask-highlight) | Ask-block highlight: answered "question n/n answered" tool rows get a soft card look; optional expand-by-default, configurable in Settings |
| [`dsh-pwa-icon`](packages/dsh-pwa-icon) | **Superseded by `dsh-enhancement`**: PWA icon/install capability is now part of the enhancement suite; source kept for reference |
| [`dsh-enhancement`](packages/dsh-enhancement) | Remote-access password gateway (HTTPS/password) + PWA install/icons + desktop notifications + PWA Web Push; coexists with the 3081 entry |
| [`dsh-font-settings`](packages/dsh-font-settings) | **Deprecated**: DSH 0.2.x has built-in font settings; the source is kept as a reference implementation |

See each plugin's README for usage (Chinese and English).

## Install

```bash
dsh plugin --profile web add dsh-vertical-layout
dsh plugin --profile web add dsh-ask-highlight
# dsh-pwa-icon is superseded by dsh-enhancement; for local development link it first
# (see packages/dsh-enhancement/README.en.md)
dsh plugin --profile web add dsh-enhancement
```

Plugins install from npm. Plugins that need configuration (for example `dsh-pwa-icon` to use your own image or app name) take a `config` block in the profile's `cordis.patch.yml`; see the plugin README for the fields.

Config changes hot-reload automatically; if the UI does not change after upgrading a plugin, restart `dsh web`; client-style-only plugins just need a browser refresh.

## Development

```bash
pnpm install
pnpm run build      # build every package
pnpm run verify     # type-check
pnpm compat         # check plugin compatibility against the local dsh
# runtime smoke test in a throwaway profile with a real dsh (call node directly, not via pnpm)
node scripts/smoke-plugin.mjs --package dsh-ask-highlight --expect-html dsh-ask-highlight
```

## Publishing

Publishing runs in GitHub Actions (OIDC trusted publishing + provenance, see [`.github/workflows/npm-publish.yml`](.github/workflows/npm-publish.yml)):

```bash
pnpm --filter dsh-vertical-layout version x.y.z     # 1. bump the version
git commit -am "chore: bump versions" && git push   #    commit and push
git tag dsh-vertical-layout@x.y.z                   # 2. tag: <package>@<version>, must match package.json
git push origin dsh-vertical-layout@x.y.z           #    pushing the tag triggers the release
```

The workflow builds and publishes that package with `--provenance --access public`; `workflow_dispatch` in the Actions tab can re-publish manually. `dsh-font-settings` is deprecated and not in the publish list.

## DSH version compatibility

Before composing a profile, DSH reads each plugin's `peerDependencies` and compares any `@deepseek-ai/dsh*` entry against the running dsh version: **a plugin that declares no such peer is not constrained**. The three maintained plugins here declare none (they only rely on stable host interfaces and DOM data attributes), so they are loosely coupled to the DSH version; `dsh-font-settings` type-checks against the dsh version it was written for.

Every week (and on demand) [`.github/workflows/dsh-compat.yml`](.github/workflows/dsh-compat.yml) runs type checks and a real smoke test on the `latest` / `alpha` channels: it only opens a PR when a peer range is outdated and verification passes, and opens an issue (without changing code) when something fails.
