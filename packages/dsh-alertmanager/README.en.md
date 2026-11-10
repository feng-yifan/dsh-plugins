# dsh-alertmanager

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Adds an **AlertManager** panel to the DSH Web sidebar: it reads several AlertManager HTTP API v2 instances in parallel and aggregates their alerts into multi-column cards. Select any number of alerts, pick a DSH workspace, click “Handle” — the plugin then creates a session in that workspace, sets its title, and sends the instance-grouped alert context as the first user message so the agent starts working immediately; the UI jumps to that session.

## Features

- **Sidebar entry**: icon + “AlertManager” + severity count pills (critical / warning / info / other). It loads once on mount, so counts are visible without opening the panel.
- **Multiple instances**: any number of instances, each with its own name, URL, auth and TLS options; fetched in parallel with per-instance failure isolation (failed instances are listed above the grid and never block the others).
- **Filters**: search (name / labels / annotations / instance) + state + severity + instance, merged into one row of pill controls, with the current result count on the right.
- **Cards**: severity bar, instance tag, name, severity/state tags, a 2-line summary and a single-line label row. “Expand” appears only when content actually overflows; expanded content shows the generator link, all labels, annotations, fingerprint and silence/inhibition sources.
- **Selection**: clicking a card toggles selection (ignored while selecting text); the checkbox is keyboard-reachable; no limit on how many alerts you select.
- **Refresh**: Grafana-style two states, “Refresh” / “Cancel”. Idle: refresh manually and pick an auto-refresh interval (off / 5s / 10s / 30s / 1m / 5m, default 5s). Refreshing: cancel the in-flight request and keep the last successful data. A countdown is shown in the status line and manual refresh resets it. Automatic refresh is silent — it never flips the button into the cancel state.
- **Controllable dispatch prompt**: pick a style in settings — **Brief** (default: one intro line plus the alert names, e.g. “Resolve the following AlertManager alerts:” + a name list) or **Detailed** (full alert context and handling instructions). The brief intro line is editable (≤500 chars).
- **Status message**: when there are no alerts and every instance is reachable, an “all clear” success state is shown.
- **Theming**: colors, radii, font sizes and shadows follow DSH's light/dark theme and the user's font size.
- Chinese / English UI.

## Install

```bash
dsh plugin --profile web add dsh-alertmanager
```

Restart `dsh web` afterwards (a new plugin row requires recomposing the profile; upgrading the same version only needs a page refresh).

## Configuration

Open the **AlertManager** panel and click “AlertManager settings” in the top-right corner:

| Field | Notes |
| --- | --- |
| Name | Required; defaults to the URL host for new instances (server also falls back) |
| URL | Required, absolute `http://` or `https://`; URLs must be unique across instances |
| Auth mode | none / Basic / Bearer |
| Username | Basic only |
| Password or token | Basic / Bearer only; leave empty to keep the stored value |
| Ignore TLS verification | Default off; for self-signed certificates on https |
| Prompt style | Brief (default) / Detailed, see “Dispatch prompt” below |
| Intro line | Brief mode only: the first line; the plugin appends alert names automatically (≤500 chars) |

Settings are stored in the DSH credentials service, never in the profile's `cordis.patch.yml`; reading settings never returns the password/token to the browser, only `hasSecret`.

## Dispatch prompt

The first message sent to the agent is controlled by the “Prompt style” setting:

- **Brief (default)**: intro line + deduplicated alert names, nothing else. For example:

  ```
  Resolve the following AlertManager alerts:
  - MemoryRequestTooLow
  - GitLabBackupStale
  ```

  If some alerts had recovered or an instance was unreachable, one short note per case is appended.
- **Detailed**: the full structured context (workspace path, per-instance alert fields, labels, annotations, fingerprint, and the “handling requirements”), capped at 20,000 characters.

Both styles obey the 20,000-character cap; the intro line is capped at 500 characters.

## Behaviour

Clicking “Handle” creates a session in the chosen workspace, sets its title, and sends the instance-grouped alerts as the first user message so the agent starts working; the UI then jumps to that session. The prompt tells the agent to investigate read-only first, explain any change before applying it, and report root cause / actions / verification / follow-ups.

**Clicking “Handle” creates a session immediately and consumes one model turn** — double-check the workspace and alerts first.

## Limitations

- AlertManager HTTP API **v2** only (`/api/v2/alerts`); v1 is not supported.
- No reverse-proxy cookie login; use Basic / Bearer or anonymous read access.
- No silence management — read and dispatch only; no cap on alerts per dispatch.
- Disabling TLS verification only affects this plugin's AlertManager requests, not DSH itself.
- The sidebar label is also used as that row's `aria-label`; to show count pills the label is a React node, so that button's `aria-label` degrades to `[object Object]` (visually fine, worse for screen readers; use a plain-text label if that matters).
