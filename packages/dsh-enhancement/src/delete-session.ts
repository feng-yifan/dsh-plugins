/**
 * dsh-enhancement · 删除会话（物理删除持久化目录）。
 *
 * DSH 的持久化层只提供 stat / 读取，没有删除 API，所以这里自己定位会话目录并
 * `rmSync` 整个目录。安全约束：
 *  - sessionId 必须匹配白名单字符集，杜绝路径穿越；
 *  - 真正要删的目录必须恰好是 `<sessionsRoot>/<projectDir>/<sessionDir>`，
 *    且目录内确实存在 `session.v*.jsonl*` 日志文件，避免误删别的东西；
 *  - 运行中的会话会先自动停止（停止超时则报错，不再直接拒绝）。
 * 注册表（workspaceRegistry）只是尽力清理，失败不影响主删除结果。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DSH_HOME } from './state.js'

/** 会话 ID 白名单：首字符必须是字母/数字，其余允许字母数字与 `._-`。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** 会话日志文件名：`session.v*.jsonl*`（例如 session.v4.jsonl.zstd）。 */
const SESSION_LOG_PATTERN = /^session\.v.*\.jsonl/

/** 等待运行中会话停下来的默认超时（毫秒）。 */
const DEFAULT_STOP_TIMEOUT_MS = 10_000

export type DeleteErrorCode = 'request.invalid' | 'session.stop-timeout' | 'delete.unsafe-path'

export interface SessionDeleteContextLike {
  get(name: string): unknown
  parallel?(event: string, data: unknown): Promise<unknown> | unknown
}

export interface DeleteSessionResult {
  deleted: boolean
  reason?: string
  stopped?: boolean
  warnings?: string[]
}

export interface DeleteSessionOptions {
  /** 等待运行中会话停止的超时，默认 10000ms；主要供测试注入更短的值。 */
  stopTimeoutMs?: number
}

function codedError(code: DeleteErrorCode, message: string): Error {
  const error = new Error(message) as Error & { code?: DeleteErrorCode }
  error.code = code
  return error
}

export function isSafeSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id)
}

/**
 * 把会话持久化文件路径解析成可安全删除的会话目录。
 *
 * `locationPath` 通常是 `.../sessions/<projectDir>/<sessionId>/session.v4.jsonl.zstd`；
 * 也允许直接传入会话目录本身。返回值一定是 `<sessionsRoot>/<projectDir>/<sessionDir>`，
 * 否则抛 `code: 'delete.unsafe-path'`。
 */
export function resolveSessionDir(locationPath: string, sessionsRoot: string): string {
  if (typeof locationPath !== 'string' || !locationPath.trim()) {
    throw codedError('delete.unsafe-path', '会话路径为空')
  }
  const root = resolve(sessionsRoot)
  let dir = resolve(locationPath)
  // 传的是文件时取其父目录；传的是目录则原样使用。
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) dir = dirname(dir)
  } catch {
    dir = dirname(dir)
  }

  // 必须是 <root>/<projectDir>/<sessionDir>：向上两级正好落在 root。
  const parent = dirname(dir)
  if (dirname(parent) !== root) {
    throw codedError('delete.unsafe-path', `会话目录不在允许的根目录下: ${dir}`)
  }

  const sessionDir = basename(dir)
  if (!SESSION_ID_PATTERN.test(sessionDir)) {
    throw codedError('delete.unsafe-path', `非法会话目录名: ${sessionDir}`)
  }

  const projectDir = basename(parent)
  if (!projectDir || projectDir === '.' || projectDir === '..') {
    throw codedError('delete.unsafe-path', `非法项目目录: ${projectDir}`)
  }

  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    throw codedError('delete.unsafe-path', `会话目录不可读: ${dir}`)
  }
  if (!entries.some((name) => SESSION_LOG_PATTERN.test(name))) {
    throw codedError('delete.unsafe-path', `会话目录内没有会话日志: ${dir}`)
  }
  return dir
}

/** 尽力清理工作区注册表里的会话痕迹，失败只记 warning。 */
async function cleanupRegistry(
  ctx: SessionDeleteContextLike,
  sessionId: string,
  warnings: string[],
): Promise<void> {
  try {
    const wr = ctx.get('workspaceRegistry') as
      | {
          unarchiveSession?(id: string): Promise<void> | void
          unpinSession?(id: string): Promise<void> | void
          list?(): Array<{ sessionIds?: string[]; detachSession?(id: string): Promise<void> | void }>
        }
      | undefined
    await wr?.unarchiveSession?.(sessionId)
    await wr?.unpinSession?.(sessionId)
    for (const workspace of wr?.list?.() ?? []) {
      if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) {
        await workspace.detachSession?.(sessionId)
      }
    }
  } catch (error) {
    warnings.push(String(error))
  }
}

/** 等待运行中的 agent 进入 idle；超时返回 false。 */
async function waitForAgentIdle(agent: { whenIdle?(): Promise<void> }, timeoutMs: number): Promise<boolean> {
  const whenIdle = agent.whenIdle
  if (typeof whenIdle !== 'function') return true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(whenIdle.call(agent)).then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 物理删除一个会话的持久化目录，并尽力清理注册表。
 *
 * 运行中的会话会先通过 `workspace/session-stop` 停止；若在超时内仍在运行，
 * 抛 `session.stop-timeout`。不再因为“会话已打开”而直接拒绝。
 *
 * @throws `code: 'request.invalid'` sessionId 非法
 * @throws `code: 'session.stop-timeout'` 会话在超时内没有停下来
 * @throws `code: 'delete.unsafe-path'` 解析出的目录不安全
 */
export async function deleteSessionStorage(
  ctx: SessionDeleteContextLike,
  sessionId: unknown,
  options: DeleteSessionOptions = {},
): Promise<DeleteSessionResult> {
  if (!isSafeSessionId(sessionId)) {
    throw codedError('request.invalid', '会话 ID 不合法')
  }

  const agents = ctx.get('agents') as
    | { get?(id: string): { status?: string; whenIdle?(): Promise<void> } | undefined }
    | undefined
  const agent = agents?.get?.(sessionId)
  // 在停止前记录：返回体的 stopped 表示删除前它是否在运行。
  const stopped = agent?.status === 'running'

  // 无论有没有 agent 都走一遍停止链路，取消回合/子代理/jobs/计划。
  await ctx.parallel?.('workspace/session-stop', { sessionId })

  if (stopped) {
    const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
    const ok = await waitForAgentIdle(agent as { whenIdle?(): Promise<void> }, stopTimeoutMs)
    if (!ok) throw codedError('session.stop-timeout', '会话仍在停止中，请稍后重试')
  }

  const warnings: string[] = []
  const sp = ctx.get('sessionPersistence') as { stat?(id: string): Promise<{ location?: { path?: unknown } }> } | undefined
  const snap = sp?.stat ? await sp.stat(sessionId) : undefined
  if (!snap?.location?.path) {
    await cleanupRegistry(ctx, sessionId, warnings)
    return { deleted: false, reason: 'not-found' }
  }

  const hp = ctx.get('dshHomePath') as ((sub?: string) => string) | string | undefined
  const root = typeof hp === 'function' ? hp('sessions') : join(DSH_HOME, 'sessions')
  const dir = resolveSessionDir(String(snap.location.path), root)
  rmSync(dir, { recursive: true, force: true })
  await cleanupRegistry(ctx, sessionId, warnings)

  const result: DeleteSessionResult = { deleted: true, stopped }
  if (warnings.length > 0) result.warnings = warnings
  return result
}
