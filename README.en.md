# dsh-plugins

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (pnpm monorepo).

## Plugins

| Plugin | What it does |
| --- | --- |
| [`dsh-vertical-layout`](packages/dsh-vertical-layout) | Portrait layout: on a portrait desktop window, moves the file / terminal panel above the conversation; its height is draggable |
| [`dsh-ask-highlight`](packages/dsh-ask-highlight) | Ask-block highlight: answered "question n/n answered" tool rows get a soft card look; optional expand-by-default, configurable in Settings |
| [`dsh-pwa-icon`](packages/dsh-pwa-icon) | PWA icon: sets the icon (and manifest app name) used when the Web GUI is installed or added to the desktop, on both desktop browsers and the iOS home screen; ships a default icon set that works with no configuration |
| [`dsh-enhancement`](packages/dsh-enhancement) | Remote-access password gateway (HTTPS/password) + PWA install/icons + desktop notifications + PWA Web Push; coexists with the 3081 entry |
| [`dsh-enter-plan-mode`](packages/dsh-enter-plan-mode) | Enter-plan-mode tool: gives the model a callable `dsh_enter_plan_mode_enter_plan_mode` that pairs with the built-in `exit_plan_mode` to close the plan-then-review loop |
| [`dsh-font-settings`](packages/dsh-font-settings) | **Deprecated**: DSH 0.2.x has built-in font settings; the source is kept as a reference implementation |

See each plugin's README for usage (Chinese and English).

## Install

```bash
dsh plugin --profile web add dsh-vertical-layout
dsh plugin --profile web add dsh-ask-highlight
dsh plugin --profile web add dsh-pwa-icon
dsh plugin --profile web add dsh-enhancement
dsh plugin --profile web add dsh-enter-plan-mode
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

Before composing a profile, DSH runs a compatibility preflight with three rules — **get the precedence right**:

1. The manifest declares `engines.dsh` → **that range alone decides**, and `peerDependencies` are ignored entirely;
2. Otherwise every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer range must match;
3. Neither declared → no version constraint.

The consequence is **hard**: an unsatisfied range means DSH **rejects the plugin at install time** (`installation rejected`). The plugin never gets installed — this is not "installed but inactive".

### This repo's choice: declare nothing

Every maintained plugin here deliberately declares no DSH version requirement. The reasoning is not convenience:

- **The coupling is to interfaces, not versions.** These plugins rely on documented stable surface — `webserver/index-inject` (a public event of `dsh-host-webserver`), `webServer.register` / `tapIndex`, `ctx.tools`, `ctx.get('planMode')` — plus a few DOM data-attribute conventions (`data-tool`, `data-disclosure-*`). Writing a version range for them would claim "verified only on these versions", which is **false precision**.
- **Declaring ties the plugin to DSH's release cadence.** Every new DSH minor release would require a release of ours too, or existing users installing the new plugin version get rejected outright. `dsh-font-settings` is both the only counter-example and the cautionary tale: it declared peers, its range got pinned, and it was eventually retired once DSH shipped the capability itself.
- **When an interface breaks, we fail loudly.** A missing service makes the plugin throw a readable error (for example `plan mode is not available to this call: …`) rather than crash or misbehave silently. The version gate, by contrast, refuses before install and asks the user to accept a risk statement about "crashes or data loss" through `allow-version --accept-risk` — far more alarming than the reality.
- **CI catches API breaks; the version gate cannot.** A stale range ≠ a changed interface, and a covering range doesn't prove the interface is intact either. That is why the workflow below runs `verify` (tsc) plus a real smoke test.

If you do want a range on some package, **use `engines.dsh`, not peers**: it is a single source of truth (once declared, peers are ignored, so no dual tracking), and `scripts/update-peer-ranges.mjs` widens the correct layer automatically.

### Automation

Every week (and on demand, or via a DSH release `repository_dispatch`) [`.github/workflows/dsh-compat.yml`](.github/workflows/dsh-compat.yml) does the following on the `latest` / `alpha` channels:

1. Installs the **target-version** dsh CLI so the verdict function matches the runtime under test;
2. `pnpm install` + `build` + `verify` (type checks, catching API breaks);
3. Runs the `check-compat` preflight; if a range is stale, `update-peer-ranges --write` widens it (honouring the precedence above — `engines.dsh` or peers);
4. Runs a real smoke test of every maintained plugin, asserting its `index.html` marker;
5. If ranges changed, opens a PR touching only `packages/*/package.json`; any hard failure opens or updates an issue. It **never changes plugin code automatically**.

Both helper scripts are usable directly:

```bash
node scripts/check-compat.mjs                    # preflight against the local dsh
node scripts/check-compat.mjs --runtime 0.3.0 --json
node scripts/update-peer-ranges.mjs --runtime 0.3.0          # plan only
node scripts/update-peer-ranges.mjs --runtime 0.3.0 --write  # apply
```

`dsh-font-settings` is deprecated and excluded from adaptation (its `DEPRECATED.md` marks it; both scripts skip it).
