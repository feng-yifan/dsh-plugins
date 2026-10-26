# dsh-enter-plan-mode

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

Gives DSH a **model-callable** "enter plan mode" tool, `dsh_enter_plan_mode_enter_plan_mode`.

DSH's built-in plan mode (`@deepseek-ai/dsh-plan-mode`) ships a tool for leaving it (`exit_plan_mode`), but the way *in* is only the `/plan` slash command — that is for the human, and the model cannot call it. This plugin supplies the other half: when a task calls for thinking before acting, the model can switch the current session into plan mode itself, explore, then hand the finished plan back through the built-in `exit_plan_mode` for your review.

## Install

```bash
dsh plugin --profile web add dsh-enter-plan-mode
```

Restart `dsh web` afterwards (a new plugin row needs the profile recomposed; a same-version upgrade only needs a page refresh).

Prerequisite: `@deepseek-ai/dsh-plan-mode` must be in the profile. `dsh-base` includes it, so usually nothing to do. Without it the plugin still loads and the tool reports exactly what is missing when called.

## Tool

| Tool | Arguments | Effect |
| --- | --- | --- |
| `dsh_enter_plan_mode_enter_plan_mode` | none | Switches the current session into plan mode |

After a call the model receives one of three status lines:

| Situation | What the model sees |
| --- | --- |
| Already in force | Plan mode is active for this session. … |
| Switched mid-turn, applies next step | Plan mode is switched on for this session and applies from your next step. … |
| Not switched | Plan mode was not switched on for this session. … |

"Applies from your next step" is normal, not an error. Plan-mode state is logged at an accepted in-turn pre-step; when a tool runs mid-turn the host's `set()` only records a pending selection, while the plan-mode prompt section already reflects that pending state — so the model can start planning right away. The plugin translates `set()`'s `committed` / `queued` / `cancelled` / `noop` faithfully instead of pretending it is active.

The tool stays registered while plan mode is **inactive**, matching upstream `exit_plan_mode`. The point is that the request's tool catalog stays stable across mode changes — otherwise every enter/exit would invalidate the prompt cache. Entering plan mode changes the `plan:policy` system-prompt section, not the catalog.

## How the tool name is derived: `<package prefix>_<capability>`

The natural name is `enter_plan_mode`: symmetric with `exit_plan_mode`, instantly understandable. **This plugin deliberately does not use it.**

1. **A collision is a hard error, and first-come wins.** The tool registry (`@deepseek-ai/dsh-tools`) routes `register()` through `NamedEntries.insert()`, where a duplicate name in the same layer throws synchronously: `tool "<name>" is already registered`. There is no last-one-wins and no auto-rename: **whoever registers first wins, the later one throws.** Two plugins racing for one name reliably produce `A: REGISTERED` / `B: THREW tool "my_new_tool" is already registered`.
2. **The blast radius can hit the *other* plugin.** That throw happens inside `apply()`, and plugin rows inserted into a profile are **optional** entries by default. Per app-boot's startup-failure table, a synchronous `apply()` throw on an optional entry is a warn-and-continue — the process starts fine, exit code 0, with only one `dsh: warning: 1 entry did not activate` line.
   The counter-intuitive part is that **who falls over depends on load order**: in a measured run where a custom plugin registered the already-taken `exit_plan_mode`, the custom plugin registered successfully and the **built-in `plan-mode` row failed to activate entirely** (`plan-mode (@deepseek-ai/dsh-plan-mode): Error: tool "exit_plan_mode" is already registered`). So a collision can do worse than making this plugin's tool vanish — it can knock out **upstream plan mode** while the UI still looks fine: no `exit_plan_mode`, no working enter semantics, just one easily-missed warning line.
3. **The collision is not hypothetical.** `enter_plan_mode` is exactly the name DSH would most plausibly pick when it adds the symmetric tool — its constant today is `EXIT_PLAN_MODE = "exit_plan_mode"`. Following the official naming habit is what walks straight into it. When that day comes, the worst case is **this plugin grabbing the name and squeezing upstream plan mode out of the profile**.

Probing with `ctx.tools.get()` at load time to pick a name is **not** a reliable fix: the registry is layered and the catalog changes with `tools/change`, so the answer depends on the relative order of plugin rows — that treats a startup race as a solution. The probe is also structurally doomed here: tool registries are scoped, and `dsh-web-app` mounts `plan-mode` inside each agent preset's **isolated group**, so neither the service nor its tools are visible from the root context at load time — a load-time probe cannot even see the rival it needs to avoid.

Hence a fixed naming scheme:

```
tool name = <normalized package name> _ <capability name>
          = dsh-enter-plan-mode  →  dsh_enter_plan_mode   +   _   +   enter_plan_mode
          = dsh_enter_plan_mode_enter_plan_mode
```

- **Prefix = the package name.** `dsh-enter-plan-mode` normalized (`-` → `_`) gives `dsh_enter_plan_mode`: it reads as "which plugin provides this tool" and lands in a third-party namespace by construction.
- **Suffix = the capability.** `enter_plan_mode`, symmetric with upstream `exit_plan_mode`, self-explanatory.
- **Consistent naming.** The whole name is snake_case, matching every other named tool in the host (`exit_plan_mode`, `ask_user_question`, `todo_write`, `run_code`).
- **It sits exactly in the gap.** Upstream tools carry no such prefix. If upstream does add one, it will add the bare `enter_plan_mode`, and the two coexist rather than displacing each other.
- **Length-safe.** 35 characters, well under the host MCP bridge's 64-character cap (`MAX_PUBLIC_NAME_LENGTH`), and a legal XID identifier, so PTC can emit it as a bare identifier.
- **Same idea as the host's own namespacing.** The MCP bridge registers foreign tools as `mcp__<serverName>__<rawName>` — "external sources get their own namespace". A package-name prefix is the same idea.
- **Room for siblings.** When this plugin later adds tools, they share the prefix (e.g. `dsh_enter_plan_mode_<another-capability>`) without fighting each other.

The name is **derived, not hard-coded** (`TOOL_NAME = TOOL_PREFIX + '_' + TOOL_SUFFIX`), so renaming the package or the capability cannot desynchronize the two, and the scheme itself is locked by tests.

**The tool name is deliberately not configurable.** Allowing a deployment to opt into the bare name would hand the collision risk back to the user through config, and the failure is silent and can displace upstream functionality — the cost far outweighs the convenience. If you truly need the bare name, a two-line wrapper plugin that delegates works, and the collision responsibility then clearly sits with that plugin.

For completeness: if a collision does happen, this plugin does not fail the profile. It logs a warning naming the plugin and steps aside quietly — it can no longer provide the tool, so turning the whole row into a startup fault buys nothing.

## Known trade-offs

- **Guidance, not enforcement.** Plan mode is enforced by prompt text only; it restricts no tool. Use sandbox mode and approval policy for hard limits (that is upstream's design, unchanged here).
- **Current session only.** The tool acts on the calling agent's session. Subagents each have their own plan-mode state.
- **No exit tool.** Upstream's `exit_plan_mode` owns the present-plan → user-approval loop; reimplementing it would fork the review path. Use it to leave.
- **No settings page.** Nothing to configure, so there is no `state.json`.

## Development

```bash
pnpm --filter dsh-enter-plan-mode run build    # tsc → lib/
pnpm --filter dsh-enter-plan-mode run verify   # type check only
pnpm --filter dsh-enter-plan-mode test         # node --test (tests the build output)
```

Tests cover the naming constraint, the status wording (every `committed`/`queued`/`cancelled`/`noop` × `active`/`pending` combination), the missing-service error, the duplicate-name fallback, and "the tool definition uses only the JSON Schema subset DSH supports" — one extra keyword like `maximum` makes `register()` throw `JsonSchemaError` and the plugin fails to load.

## Version compatibility

This plugin **deliberately declares no DSH version requirement** (neither `engines.dsh` nor any `@deepseek-ai/dsh-*` peer), so it is not subject to the version gate.

The reasoning matches the rest of the repo (see the [root README](https://github.com/feng-yifan/dsh-plugins#dsh-version-compatibility)): it depends on interface shapes, not version numbers — only `ctx.tools.register()` / `get()`, and `get()` / `set()` on the `planMode` service obtained via `ctx.get('planMode')`. Writing a version range for that is false precision, and it would tie the plugin to DSH's release cadence (an unsatisfied range rejects the plugin at **install time**).

If an interface does break, the failure is loud: when `planMode` cannot be resolved the tool returns an actionable error rather than failing silently or crashing. API breaks are caught by CI's `verify` plus the real smoke test.
