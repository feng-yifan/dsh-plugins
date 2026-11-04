# dsh-alertmanager

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Adds an **AlertManager** panel to the DSH Web sidebar: it reads several AlertManager
HTTP API v2 instances in parallel and aggregates their alerts into multi-column cards.
Select any number of alerts, pick a DSH workspace, click “Handle” — the plugin then
**creates a session in that workspace, sets its title, and sends the instance-grouped
alert context as the first user message** so the agent starts working immediately;
the UI jumps to that session.

## Features

- **Sidebar entry**: icon + “AlertManager” + severity count pills (critical / warning / info / other).
  It loads once on mount, so **counts are visible without opening the panel**.
- **Multiple instances**: any number of instances, each with its own name, URL, auth and TLS
  options; fetched in parallel with per-instance failure isolation (failed instances are listed
  above the grid and never block the others).
- **Filters**: search (name / labels / annotations / instance) + state + severity + instance,
  merged into **one row** of pill controls, with the current result count on the right.
- **Cards**: the severity bar is a regular layout child (it never covers the border), followed by
  the instance tag, name, severity/state tags, a 2-line summary and a single-line label row.
  “Expand” appears **only when content actually overflows**; expanded content shows the generator
  link, all labels, annotations, fingerprint and silence/inhibition sources.
- **Selection**: clicking a card toggles selection (ignored while selecting text); the checkbox is a
  keyboard-reachable `role="checkbox"` control; **no limit on how many alerts you select**.
- **Refresh**: Grafana-style two states. Idle: “⟳ Refresh” + “5s ▾”. Refreshing: “◌ Cancel”, which
  calls `AbortController.abort()` and keeps the last successful data. Intervals:
  `off / 5s / 10s / 30s / 1m / 5m` (default 5s, persisted in `localStorage` under
  `dsh-alertmanager:refresh`). A countdown is shown in the status line and manual refresh resets it.
  Automatic refresh is **silent** — it never flips the button into the cancel state.
- **Controllable dispatch prompt**: pick a style in settings — **Brief** (default: one intro line plus
  the alert names, e.g. “Resolve the following AlertManager alerts:” + a name list) or **Detailed**
  (full alert context and handling instructions). The brief intro line is editable (≤500 chars).
- **State-driven**: the panel and the sidebar entry subscribe to the same store snapshot, so both
  update the moment data arrives; there is exactly one auto-refresh timer. When there are no alerts
  and every instance is reachable, an “all clear” success state is shown.
- **Settings**: instance list with add/remove; name, URL, auth mode (none / Basic / Bearer),
  username, password or token, and “ignore TLS certificate verification”; inline validation for
  invalid/duplicate URLs and empty names. Removal is **one click with an inline Undo** (nothing is
  persisted until Save). All dropdowns and segmented controls are hand-drawn — no native `<select>`.
- **Theming**: colors, radii, font sizes and shadows all come from DSH CSS variables
  (`--dsw-*` / `--dsh-*`), so the panel follows the light/dark theme and the user's font size.
  The accent uses `--dsw-alias-state-business-primary` (light `#4176e6` / dark `#7aaaff`).
- Chinese / English UI; every visible string goes through DSH locale; no third-party UI library.

## Install

```bash
dsh plugin --profile web add dsh-alertmanager
```

For local development you can also install from the directory:

```bash
dsh plugin --profile web add /home/viktor/dev/projects/github/fengyifan/dsh-plugins/packages/dsh-alertmanager
```

Restart `dsh web` afterwards (a new plugin row requires recomposing the profile; upgrading the same
version only needs a page refresh).

## Configuration

Open the **AlertManager** panel and click “AlertManager settings” in the top-right corner:

| Field | Notes |
| --- | --- |
| Name | Required; defaults to the URL host for new instances (server also falls back) |
| URL | Required, absolute `http://` or `https://`; URLs must be unique across instances |
| Auth mode | none / Basic / Bearer (hand-drawn segmented control) |
| Username | Basic only |
| Password or token | Basic / Bearer only; leave empty to keep the stored value |
| Ignore TLS verification | Default off; for self-signed certificates on https |
| Prompt style | Brief (default) / Detailed, see “Dispatch prompt” below |
| Intro line | Brief mode only: the first line; the plugin appends alert names automatically (≤500 chars) |

Settings are stored in the DSH credentials service (record key `dsh-alertmanager/settings`,
payload v2) — never in the profile's `cordis.patch.yml`. Reading settings **never** returns the
password/token to the browser, only `hasSecret`. A legacy v1 single-instance record is migrated on
first read to an instance with `id=default`; v1's `refreshSeconds` is dropped and the refresh
interval now lives in browser `localStorage`.

Saving is a **full replacement**: the posted instance list is the final list. `secret` omitted or
empty keeps the previous value by `id`; `authMode: 'none'` clears it. **The store updates
immediately**: removing every instance switches the panel to the “unconfigured” state, clears the
cards and the selection, zeroes the sidebar counts and stops auto-refresh.

## Dispatch prompt

The first message sent to the agent is controlled by the “Prompt style” setting:

- **Brief (default)**: intro line + deduplicated alert names, nothing else. For example:

  ```
  Resolve the following AlertManager alerts:
  - MemoryRequestTooLow
  - GitLabBackupStale
  ```

  If some alerts had recovered or an instance was unreachable, one short note per case is appended.
- **Detailed**: the full structured context (workspace path, per-instance alert fields, labels,
  annotations, fingerprint, and the “handling requirements”), capped at 20,000 characters.

Both styles obey the 20,000-character cap; the intro line is capped at 500 characters.

## Behaviour

Clicking “Handle” makes the plugin:

1. validate the workspace (404 when unknown);
2. group the selected alerts by instance and **re-fetch fresh** data in parallel (`?fresh=1`
   bypasses the 5s cache), matching by `(instanceId, fingerprint)`;
3. call `sessionController.create({ workspaceId })` in the chosen workspace;
4. rename the session to `告警处理：<first alertname> 等 N 条` (≤60 chars, non-fatal on failure);
5. send the instance-grouped Chinese prompt as the first user message with `mode: 'queue'`;
6. clear the selection, refresh alerts and navigate to the new session.

**Clicking “Handle” creates a session immediately and consumes one model turn** — double-check the
workspace and alerts first. The prompt tells the agent to investigate read-only first, explain any
change before applying it, and report root cause / actions / verification / follow-ups. Total prompt
length is capped at 20,000 characters: descriptions are dropped first, then alerts are trimmed from
the tail with a note about how many were omitted.

If a selected alert has recovered and is missing from the fresh list, the prompt notes
“not in the alert list at dispatch time, may have recovered”. If an instance was unreachable, the
prompt lists “instance X was unreachable; its selected alerts are excluded” while other instances
proceed normally. If none of the selected alerts can be resolved, the API returns 502 and no session
is created.

## HTTP API

Three same-origin exact paths on the DSH web server (`GET`/`POST` split inside one handler), all
guarded by `ctx.connection.requestRejection`, all responding with `cache-control: no-store`:

| Method and path | Description |
| --- | --- |
| `GET /_dsh/alertmanager/settings` | Read settings (no secrets) |
| `POST /_dsh/alertmanager/settings` | Replace all settings |
| `GET /_dsh/alertmanager/alerts` | Fetch all instances in parallel; `?fresh=1` bypasses the 5s cache |
| `POST /_dsh/alertmanager/dispatch` | Create a session in a workspace and dispatch selected alerts |

Errors carry a stable `code`: `settings.invalid`, `alerts.not-configured`, `alerts.fetch-failed`,
`dispatch.invalid`, `dispatch.workspace-not-found`, `dispatch.alerts-unavailable`,
`dispatch.prompt-failed`, `credentials.unavailable`, `session.unavailable`, plus `auth.required` /
`auth.gateway` / `auth.dsh` (the latter two are recognised and localized by the client). The client
treats `alerts.not-configured` as authoritative: it clears data and enters the unconfigured state
rather than keeping stale cards.

## Code layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Host plugin: registers `/settings`, `/alerts`, `/dispatch` and settings IO |
| `src/settings.ts` | Settings model, v1→v2 migration, credential record, strict JSON payload |
| `src/alertmanager.ts` | Multi-instance fetch, 5s per-instance cache, normalization/sorting, error classes, TLS |
| `src/prompt.ts` / `src/dispatch.ts` | Grouped prompt generation and dispatch orchestration (create→rename→prompt) |
| `src/store.ts` | Environment-agnostic core state machine (side effects injected; unit-testable in Node) |
| `src/client/store.ts` | Browser adapter (same-origin fetch / localStorage / timers / visibility) + count broadcast |
| `src/client/pieces.tsx` | Hand-drawn controls: Dropdown / Modal / Segmented / Switch / TextInput / Tag / FilterChip |
| `src/client/panel.tsx` | Main panel and settings dialog |
| `src/client/index.tsx` | Slot registration (`sidebar.panellist` + `main`) and sidebar pills |
| `src/locales.ts` | Bilingual strings; `zh` is the key-set source of truth, `en` is compile-time constrained |

## Limitations

- AlertManager HTTP API **v2** only (`/api/v2/alerts`); v1 is not supported.
- No reverse-proxy cookie login; use Basic / Bearer or anonymous read access.
- No silence management — read and dispatch only; no cap on alerts per dispatch.
- Disabling TLS verification only affects this plugin's AlertManager requests, not DSH itself.
- The sidebar label is rendered by the DSH shell, which also uses the same value as that row's
  `aria-label`. To show count pills the label is a React node, so that button's `aria-label`
  degrades to `[object Object]` (visually fine, worse for screen readers; use a plain-text label if
  that matters).

## Development

```bash
pnpm --filter dsh-alertmanager run build    # host tsc + client tsc + client bundle
pnpm --filter dsh-alertmanager run verify   # type-check only
pnpm --filter dsh-alertmanager test         # node --test (runs against build output)
```

Test coverage (76 tests): v1→v2 migration, secret keep/clear, strict JSON payload, multi-instance
aggregation and sorting, per-instance failure isolation, per-instance cache and `fresh`, grouped
prompt, over-length trimming, zero `endsAt`, cross-instance dispatch, workspace 404, prompt failure
with sessionId, zh/en key-set parity, route-handler API tests with a fake ctx, plus the core store
(counts, bootstrap, single scheduler, manual vs automatic, trailing refetch, `not-configured`
clearing, stopping schedule after clearing settings, dispose, keeping old data on failure, cancel,
selection semantics).

> Note: `src/locales.ts` is compiled by both host and client; client output stays under
> `src/client/**`; `src/store.ts` is shared by both. `lib/` and `.client-build/` are build output
> and are not committed.

## Version compatibility

This plugin **intentionally declares no DSH version requirement** (no `engines.dsh`, no
`@deepseek-ai/dsh-*` peer), so it is not subject to version gating. It depends on interface shapes,
not version numbers: `webServer.register()`, `ctx.get('credentials')`,
`sessionController.create/rename/prompt`, `workspaceRegistry.get()`, and the client slot / locale
APIs. If those change, it fails loudly (readable 503/502 or a panel error state) rather than
silently.
