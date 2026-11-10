/**
 * dsh-at-enhancement · 工作区外绝对路径枚举 + `fileReferences.list` 包装（宿主半侧）
 *
 * 背景：DSH 自带 `@` 文件补全只索引会话工作区（cwd），宿主 provider 是
 * `@deepseek-ai/dsh-file-reference-local`（`LocalFileReferenceService`），对
 * 绝对路径查询返回 `[]`。本模块**不改动**它，只是在宿主侧把它的 `list` 包一层：
 *
 *   - 非外部查询（相对路径 / 普通关键词）→ 纯透传，行为与原生完全一致；
 *   - 外部查询（`/…`、`~`、`~/…`）→ 先透传原 provider 结果（通常为空），再追加
 *     本地按目录逐级列出的候选；按 `path` 去重合并。
 *
 * `read` 工具读绝对路径不受沙箱限制（`dsh-fs-sandbox` 只限制写/删/移），因此
 * 引用外部绝对路径后，模型可用 `read` 按路径读到内容。
 *
 * 版本漂移防御：宿主 `fileReferences` 缺失 / 形态不符时一律旁路，绝不阻断原生
 * 补全；重复包装用 `Symbol.for` 标记防双包。
 *
 * 本模块只用 `node:fs` / `node:path` / `node:os`，不 import 任何 `@deepseek-ai/*`。
 */
import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type {
  FileReferenceCandidateLike,
  FileReferenceServiceLike,
  HostContextLike,
  ProviderStatus,
} from './types.js'

/** 默认最多返回多少条外部候选（与设置页展示保持一致）。 */
const DEFAULT_MAX_RESULTS = 20

/** 已包装实例的标记；用全局 Symbol 防同进程内多份包重复包装。 */
const WRAPPED = Symbol.for('dsh-at-enhancement.external-refs')

/**
 * 展开 `~`（家目录）并把反斜杠统一成 `/`。
 *
 * - `~` → `os.homedir()`
 * - `~/x` → `<home>/x`
 * - 其它 → 仅做反斜杠归一
 */
export function expandSpecial(input: string): string {
  const normalized = input.replace(/\\/g, '/')
  if (normalized === '~') return homedir()
  if (normalized.startsWith('~/')) return homedir() + normalized.slice(1)
  return normalized
}

/** 判断一次补全查询是否是「工作区外绝对路径」查询。 */
export function isExternalQuery(query: string): boolean {
  return query === '~' || query.startsWith('~/') || query.startsWith('/')
}

/** 候选内部形态：额外带 name 用于排序，对外只暴露 path/kind。 */
interface ScoredCandidate extends FileReferenceCandidateLike {
  name: string
}

/**
 * 把 fragment 命中强度换算成排序优先级：
 * 0 = 以 fragment 开头，1 = 包含 fragment，2 = 仅名称排序（fragment 为空或都不命中）。
 */
function rankOf(name: string, fragment: string): number {
  if (fragment === '') return 2
  const loweredName = name.toLowerCase()
  const loweredFragment = fragment.toLowerCase()
  if (loweredName.startsWith(loweredFragment)) return 0
  if (loweredName.includes(loweredFragment)) return 1
  return 2
}

/**
 * 逐级列出工作区外某个目录下的文件/目录候选。
 *
 * 语义：
 * - `''` → `[]`；
 * - `~` 或展开后正好是家目录且无 fragment → 列出家目录子项；
 * - 展开后以 `/` 结尾（含 `@/`、`@~/`）→ 目录 = 展开值，fragment = `''`；
 * - 否则目录 = `dirname(展开值)`，fragment = `basename(展开值)`。
 *
 * 隐藏项只有在 fragment 也以 `.` 开头时才列出；目录不存在 / 无权限返回 `[]`。
 * 符号链接用 `stat` 判定类型（目录算 directory，但不递归）。
 */
export async function listExternal(
  query: string,
  signal: AbortSignal,
  maxResults = DEFAULT_MAX_RESULTS,
): Promise<FileReferenceCandidateLike[]> {
  if (signal.aborted) return []
  signal.throwIfAborted()
  if (query === '') return []

  const expanded = expandSpecial(query)
  let dir: string
  let fragment: string
  if (query === '~' || expanded === homedir()) {
    dir = homedir()
    fragment = ''
  } else if (expanded.endsWith('/')) {
    dir = expanded
    fragment = ''
  } else {
    dir = dirname(expanded)
    fragment = basename(expanded)
  }

  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // 目录不存在 / 无权限：静默返回空，不打断补全
    return []
  }

  const wantsHidden = fragment.startsWith('.')
  const needle = fragment.toLowerCase()
  const scored: ScoredCandidate[] = []

  for (const dirent of entries) {
    if (signal.aborted) return []
    const name = dirent.name
    if (name.startsWith('.') && !wantsHidden) continue
    if (needle !== '' && !name.toLowerCase().includes(needle)) continue

    let kind: FileReferenceCandidateLike['kind'] | null = null
    if (dirent.isDirectory()) {
      kind = 'directory'
    } else if (dirent.isFile()) {
      kind = 'file'
    } else if (dirent.isSymbolicLink()) {
      try {
        const stat = await fs.stat(join(dir, name))
        kind = stat.isDirectory() ? 'directory' : 'file'
      } catch {
        // 断链 / 无权限：跳过
        kind = null
      }
    }
    if (kind === null) continue

    scored.push({ path: join(dir, name), kind, name })
  }

  scored.sort((a, b) => {
    const rankDiff = rankOf(a.name, fragment) - rankOf(b.name, fragment)
    if (rankDiff !== 0) return rankDiff
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  })

  return scored.slice(0, maxResults).map(({ path, kind }) => ({ path, kind }))
}

/** 读取当前设置的入口；由插件在每次补全请求时调用。 */
export type SettingsReader = () => { enabled: boolean }

/** 包装结果：`restore()` 还原原始行为。 */
export interface FileReferencesWrapper {
  restore(): void
}

/**
 * 包装宿主 `fileReferences` 服务的 `list`。
 *
 * @param base - 宿主 provider（`LocalFileReferenceService` 等）。
 * @param readSettings - 设置读取器；每次调用 `list` 时求值。
 * @param warn - 可选告警回调（同一消息由调用方去重）。
 * @returns `restore()`；若该实例已被包装过则返回空实现（防双包）。
 */
export function wrapFileReferences(
  base: FileReferenceServiceLike,
  readSettings: SettingsReader,
  warn?: (message: string) => void,
): FileReferencesWrapper {
  const target = base as unknown as Record<PropertyKey, unknown>
  if (target[WRAPPED] === true) {
    // 同进程内多份插件包：不重复包装，也不在 restore 时拆掉别人的包装
    return { restore: () => undefined }
  }

  const originalMethod = base.list
  const original = originalMethod.bind(base)
  const hadOwnList = Object.prototype.hasOwnProperty.call(base, 'list')

  const wrapped = async (
    agent: unknown,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidateLike[]> => {
    if (!readSettings().enabled) return original(agent, query, signal)
    if (!isExternalQuery(query)) return original(agent, query, signal)

    let baseResults: FileReferenceCandidateLike[] = []
    try {
      baseResults = await original(agent, query, signal)
    } catch (error) {
      warn?.(
        `host fileReferences.list failed for external query ${JSON.stringify(query)}: ${String(error)}`,
      )
    }

    const external = await listExternal(query, signal)
    const merged: FileReferenceCandidateLike[] = []
    const seen = new Set<string>()
    for (const candidate of [...baseResults, ...external]) {
      if (seen.has(candidate.path)) continue
      seen.add(candidate.path)
      merged.push(candidate)
    }
    return merged
  }

  target.list = wrapped
  Object.defineProperty(base, WRAPPED, { value: true, configurable: true })

  return {
    restore(): void {
      try {
        if (hadOwnList) {
          // 原本就是自有属性：赋回原方法
          target.list = originalMethod
        } else {
          // 原本来自原型：删除自有覆盖，回落到原型方法
          delete target.list
        }
      } catch {
        /* 只读对象：留给进程生命周期结束 */
      }
      try {
        delete target[WRAPPED]
      } catch {
        /* ignore */
      }
    },
  }
}

/** 校验对象是否具备 `fileReferences.list` 形态。 */
function isServiceLike(value: unknown): value is FileReferenceServiceLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { list?: unknown }).list === 'function'
  )
}

/** 挂载结果：读取 provider 状态。 */
export interface ExternalFileReferencesMount {
  status(): { enabled: boolean; provider: ProviderStatus }
}

/**
 * 挂载外部文件引用增强。
 *
 * 用 `ctx.inject(['fileReferences'], cb)` 等宿主 provider 就绪后再包装；服务变化
 * 时 Cordis 会先执行清理（还原）再重跑。宿主缺 `inject` / provider 形态不符时
 * 一律旁路，只记录一次告警。
 *
 * @param ctx - 宿主插件上下文。
 * @param readSettings - 当前设置读取器。
 * @returns 状态读取器。
 */
export function mountExternalFileReferences(
  ctx: HostContextLike,
  readSettings: SettingsReader,
): ExternalFileReferencesMount {
  let provider: ProviderStatus = 'missing'
  const warned = new Set<string>()
  const warnOnce = (message: string): void => {
    if (warned.has(message)) return
    warned.add(message)
    ctx.logger?.warn?.(`[dsh-at-enhancement] ${message}`)
  }

  if (typeof ctx.inject !== 'function') {
    warnOnce('host ctx.inject is unavailable; external file reference browsing is bypassed')
    return { status: () => ({ enabled: readSettings().enabled, provider }) }
  }

  try {
    ctx.inject(['fileReferences'], (scope: unknown) => {
      const base = (scope as { fileReferences?: unknown } | undefined)?.fileReferences
      if (!isServiceLike(base)) {
        provider = 'missing'
        warnOnce('host fileReferences service is unavailable; external file reference browsing is bypassed')
        return
      }
      const wrapper = wrapFileReferences(base, readSettings, warnOnce)
      provider = 'active'
      return () => {
        provider = 'missing'
        wrapper.restore()
      }
    })
  } catch (error) {
    // inject 形态漂移 / 依赖解析异常：旁路，不阻断插件加载
    provider = 'missing'
    warnOnce(`host ctx.inject failed (${String(error)}); external file reference browsing is bypassed`)
  }

  return { status: () => ({ enabled: readSettings().enabled, provider }) }
}
