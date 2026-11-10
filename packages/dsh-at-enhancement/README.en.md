# dsh-at-enhancement

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](README.md) | **English**

An enhancement for DSH external `@` file references: the `@` completion in the Web GUI input can **browse and reference any absolute-path file / directory outside the workspace, level by level**. Selecting a candidate inserts its absolute path (quoted as `@"..."` when it contains spaces), and the model then reads it with the `read` tool by absolute path.

DSH's built-in `@` completion only lists files inside the current session workspace and returns nothing for absolute-path queries; with this plugin enabled you can browse absolute paths outside the workspace level by level.

## Install

```bash
dsh plugin --profile <name> add dsh-at-enhancement
```

Replace `<name>` with your profile (commonly `web`). Refresh the browser after installing; if nothing changes, restart `dsh web`.

## Usage

1. Type `@` in the input to open completion.
2. Type `/` or `~/` to start browsing outside the workspace:
   - `@/` → start from the filesystem root;
   - `@~/` → start from your home directory;
   - `@/home/user/Documents/` → keep drilling down.
3. Keep typing a directory / file name to filter (case-insensitive substring match).
4. Selecting a candidate inserts its **absolute path**, e.g. `@/home/user/Documents/a.md`; paths with spaces become `@"..."`.
5. The model reads it with the `read` tool by absolute path (reads are not sandbox-restricted).

## Config

Once installed, configure it under **Settings → Plugins → dsh-at-enhancement**:

| Switch | Default | Meaning |
| --- | --- | --- |
| Enable external file references (@) | On | Master switch. Off makes `@` list only workspace files, matching native behaviour |

The card also shows the host `fileReferences` mount status: `已挂载到宿主 fileReferences` means the wrapper is active; `宿主 fileReferences 不可用，已旁路` means the host service is missing or shaped differently, so the plugin is bypassed without affecting native completion.

The configuration lives inside the active profile:

```
$DSH_HOME/profiles/<profile>/fengyifan-dsh-at-enhancement/state.json
```

The settings card shows the actual path. Each profile keeps its own copy.

`enabled` may also appear in `cordis.patch.yml`, but that file only **seeds the initial state.json**: once the settings page has written a value, state.json wins.

## Known limitations

- **Absolute-path browsing only**: no recursive fuzzy search, and no relative `../` escaping the workspace.
- Windows drive paths (e.g. `C:\`) are not supported; this plugin targets POSIX-style absolute paths.
- If the host `fileReferences` service is missing or shaped differently, the plugin bypasses automatically (provider shows missing) and native completion is unaffected.
- At most 20 candidates are returned per query.
- Symbolic-link directories are shown as directories but are **not** expanded recursively.
