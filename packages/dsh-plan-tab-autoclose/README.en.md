# dsh-plan-tab-autoclose

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

After you approve a plan (plan mode exits), automatically close **every** plan tab of that session in the right sidebar, including tabs left by earlier revision rounds.

DSH's built-in `@deepseek-ai/dsh-plan-mode` gives each round's `exit_plan_mode` plan its own tab in the right sidebar (`kind === 'plan'`). Repeated revision rounds pile up several plan tabs. This plugin closes all of that session's plan tabs at once when plan mode exits (the `plan` projection flips `active` from true to false).

## Install

```bash
dsh plugin --profile web add dsh-plan-tab-autoclose
```

Restart `dsh web` afterwards (a new plugin row needs the profile recomposed; a same-version upgrade only needs a page refresh).

## Behavior

- Watches the `plan` projection of the current on-screen session.
- When `active` flips from **true** to **false** (for example when you approve a plan), it closes every `kind === 'plan'` tab of that session in the right sidebar.
- All at once: several plan tabs accumulated across revision rounds are closed together on that single exit.

## Boundaries

- **Same session only.** Tabs of other sessions are untouched.
- **Non-plan tabs are untouched.** Tabs of other `kind`s (`files`, terminal, …) are unaffected.
- **Manual `/plan off` triggers too.** The trigger is "plan mode exits", not only the approve button.
- **Reopen from the plan card.** Closing only collapses the sidebar tab; it does not delete the plan. You can reopen it from the plan artifact card in the conversation.

## Known limitations

- **The trigger is plan-mode exit, usually right after approval.** It is not a per-round close, but a single final close.
- **No settings page.** There is nothing to configure.

## Implementation notes

- The host half (`src/index.ts`) is a no-op; it only provides the plugin row so `dsh.client` can mount the client module.
- The browser half (`src/client/*`) uses only public `ctx.sessions` / `ctx.sidebarRight` capabilities; it imports no `@deepseek-ai/*` runtime and depends on no DOM.
- The core plain logic lives in `src/client/autoclose.ts` and is unit-tested in node (`node --test test/autoclose.test.mjs`).
