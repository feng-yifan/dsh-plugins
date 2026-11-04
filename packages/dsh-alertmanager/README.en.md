# dsh-alertmanager

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Adds an **Alerts** main panel to the DSH Web sidebar. It reads live alerts from the AlertManager HTTP API v2; select 1–20 alerts, choose a DSH Workspace, and click **Process** to create a new Session in that Workspace, set its title, send the alert context as the first user message so the agent starts working immediately, and jump to that Session.

## Features

- A **Alerts** entry in the sidebar plus a dedicated main panel, without taking over the conversation area.
- Reads AlertManager v2 `/api/v2/alerts` with active, silenced, inhibited, and unprocessed alerts.
- Search (alert name / labels / annotations), state filter, severity dots, expandable rows with all labels, annotations, and a source link.
- None / Basic / Bearer authentication; optionally skip TLS certificate verification for self-signed certificates.
- Select 1–20 alerts, choose a Workspace in the sticky bar, and dispatch: create Session → rename it → write the alert context as the first message → the agent starts immediately.
- Auto-refresh at the configured interval, plus manual refresh.

## Install

This package is not published to npm yet; install it from a local directory:

```bash
dsh plugin --profile web add /home/viktor/dev/projects/github/fengyifan/dsh-plugins/packages/dsh-alertmanager
```

Restart `dsh web` after installing (a new plugin row requires recomposing the profile; for a same-version upgrade, a browser refresh is enough).

## Configure in the panel

Open the **Alerts** panel in the sidebar and fill in:

| Field | Description |
| --- | --- |
| AlertManager URL | Required; an absolute `http://` or `https://` URL such as `https://alertmanager.example.com` |
| Auth mode | None / Basic / Bearer |
| Username | Basic only |
| Password or token | Basic / Bearer only; leave blank to keep the saved value |
| Skip TLS certificate verification | Off by default; for self-signed certificates over https |
| Refresh interval (seconds) | 5–300, default 30 |

Settings live in the DSH credential service (record key `dsh-alertmanager/settings`), not in the profile's `cordis.patch.yml`. Reading settings **never** returns the password/token to the browser; it only reports `hasSecret`.

## Behavior

Clicking **Process in the selected Workspace** makes the plugin:

1. Fetch the latest alerts once more (bypassing the panel's 5-second cache) and match the selected fingerprints;
2. Call `sessionController.create({ workspaceId })` to create a Session in the selected Workspace;
3. Rename it to `告警处理：<first alertname> 等 N 条` (≤60 characters; a failure is logged but does not block);
4. Send the generated Chinese prompt as the first user message with `mode: 'queue'`;
5. Clear the selection, refresh alerts, and navigate to the new Session.

**Clicking Process creates a Session and consumes one model turn immediately.** Make sure the Workspace and alerts are what you intend. The prompt asks the agent to start with read-only investigation, explain any plan before changing things, and report root cause / actions / verification / follow-ups. A single prompt is capped at 20,000 characters: descriptions are dropped first, then trailing alerts are omitted with a note at the end.

If an alert recovered and is no longer in the latest list at dispatch time, the prompt notes that it "was no longer in the alert list and may have recovered"; the remaining alerts are still processed.

## Limitations

- Only AlertManager HTTP API **v2** (`/api/v2/alerts`); v1 is not supported.
- Does not support reverse-proxy Cookie login; use Basic / Bearer or allow anonymous reads.
- One AlertManager instance per profile; multiple instances are not supported.
- Up to 20 alerts per dispatch.
- No silence management; the plugin only reads and dispatches alerts.
- Disabling TLS verification applies only to this plugin's AlertManager requests, not to DSH itself.

## Development

```bash
pnpm --filter dsh-alertmanager run build    # host tsc + client tsc + client bundle
pnpm --filter dsh-alertmanager run verify   # type-check only
pnpm --filter dsh-alertmanager test         # node --test (tests the build output)
```

Tests use injected fake `fetch` / `sessionController` to cover auth headers, normalization, 401/timeout, settings never returning the secret, the full dispatch chain, and failure branches.

## Version compatibility

This plugin **deliberately declares no DSH version requirement** (neither `engines.dsh` nor `@deepseek-ai/dsh-*` peers), so it is not gated. It depends on interface shapes rather than version numbers: `webServer.register()`, `ctx.get('credentials')`, `sessionController.create/rename/prompt`, `workspaceRegistry.get()`, and the client slot API. If an interface changes, it fails loudly (a readable 503/502 or a panel error state) rather than silently.
