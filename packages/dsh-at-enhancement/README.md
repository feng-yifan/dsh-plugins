# dsh-at-enhancement

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

**简体中文** | [English](README.en.md)

DSH 外部 `@` 文件引用增强：让 Web GUI 输入框里的 `@` 文件补全可以**逐级浏览并引用工作区外**的任意绝对路径文件 / 目录。选中后插入绝对路径（含空格时插入 `@"..."`），模型随后用 `read` 工具按绝对路径读取。

DSH 原生的 `@` 补全只列当前会话工作区（cwd）内的文件，对绝对路径查询返回空。本插件不改动 DSH 自带的 provider，只在宿主侧把 `fileReferences.list` 包一层：普通查询原样透传，外部绝对路径查询追加逐级目录列举的候选。

## 安装

```bash
dsh plugin --profile <name> add dsh-at-enhancement
```

把 `<name>` 换成你的 profile（常见是 `web`）。安装后刷新浏览器即可使用；界面没变化就重启 `dsh web`。

## 用法

1. 在输入框里输入 `@` 打开补全。
2. 输入 `/` 或 `~/` 开始逐级浏览工作区外的文件系统：
   - `@/` → 从根目录开始；
   - `@~/` → 从家目录开始；
   - `@/home/viktor/Documents/` → 继续逐级深入。
3. 继续输入目录名 / 文件名做过滤（大小写不敏感的包含匹配）。
4. 选择候选后插入其**绝对路径**，例如 `@/home/viktor/Documents/a.md`；路径含空格时自动写成 `@"..."`。
5. 模型用 `read` 工具按绝对路径读取内容（读取不受沙箱限制）。

## 配置

装好后在 **设置 → 插件 → dsh-at-enhancement** 里配置：

| 开关 | 默认值 | 说明 |
| --- | --- | --- |
| 启用外部文件引用（@） | 开 | 总开关。关掉后 `@` 补全只列工作区内文件，与原生行为一致 |

卡片同时显示宿主 `fileReferences` 的挂载状态：`已挂载到宿主 fileReferences` 表示包装生效；`宿主 fileReferences 不可用，已旁路` 表示宿主服务缺失或形态不符，插件不生效但不影响原生补全。

配置存在当前 profile 目录里：

```
$DSH_HOME/profiles/<profile>/fengyifan-dsh-at-enhancement/state.json
```

设置页底部会显示实际路径。不同 profile 各有一套配置。

`cordis.patch.yml` 里也可以写 `enabled`，但**它只是首次建立 state.json 的种子**：一旦设置页写过配置，就以 state.json 为准。

## 已知限制

- 只支持**绝对路径逐级浏览**：不做递归模糊搜索，也不支持用相对 `../` 越出工作区。
- Windows 盘符路径（如 `C:\`）不支持；本插件面向 POSIX 风格绝对路径。
- 宿主 `fileReferences` 服务缺失或形态不符时自动旁路（provider 显示 missing），原生补全不受影响。
- 每次最多返回 20 条候选。
- 符号链接目录按目录显示，但**不递归**展开。

## 版本适配

本插件不声明任何 `@deepseek-ai/dsh-*` peerDependencies，也不声明 `engines.dsh`，因此不受 DSH 版本门禁约束。
