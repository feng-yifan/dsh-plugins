/**
 * dsh-enhancement · 删除会话（物理删除持久化目录）。
 *
 * DSH 的持久化层只提供 stat / 读取，没有删除 API，所以这里自己定位会话目录并
 * `rmSync` 整个目录。安全约束：
 *  - sessionId 必须匹配白名单字符集，杜绝路径穿越；
 *  - 真正要删的目录必须恰好是 `<sessionsRoot>/<projectDir>/<sessionDir>`，
 *    且目录内确实存在 `session.v*.jsonl*` 日志文件，避免误删别的东西；
 *  - 运行中 / 已打开的会话一律拒绝。
 * 注册表（workspaceRegistry）只是尽力清理，失败不影响主删除结果。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DSH_HOME } from './state.js'

/** 会话 ID 白名单：首字符必须是字母/数字，其余允许字母数字与 `._-`。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** 会话日志文件名：`session.v*.jsonl*`（例如 session.v4.jsonl.zstd）。 */
const SESSION_LOG_PATTERN = /^session\.v.*\.jsonl/

export type DeleteErrorCode = 'request.invalid' | 'session.active' | 'delete.unsafe-path'

export interface SessionDeleteContextLike {
  get(name: string): unknown
}

export interface DeleteSessionResult {
  deleted: boolean
  reason?: string
  warnings?: string[]
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

/**
 * 物理删除一个会话的持久化目录，并尽力清理注册表。
 *
 * @throws `code: 'request.invalid'` sessionId 非法
 * @throws `code: 'session.active'` 会话运行中或已打开
 * @throws `code: 'delete.unsafe-path'` 解析出的目录不安全
 */
export async function deleteSessionStorage(
  ctx: SessionDeleteContextLike,
  sessionId: unknown,
): Promise<DeleteSessionResult> {
  if (!isSafeSessionId(sessionId)) {
    throw codedError('request.invalid', '会话 ID 不合法')
  }

  const agents = ctx.get('agents') as { get?(id: string): unknown } | undefined
  const sessions = ctx.get('sessions') as { get?(id: string): unknown } | undefined
  if (agents?.get?.(sessionId) || sessions?.get?.(sessionId)) {
    throw codedError('session.active', '会话正在运行或已打开，无法删除')
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

  const result: DeleteSessionResult = { deleted: true }
  if (warnings.length > 0) result.warnings = warnings
  return result
}
