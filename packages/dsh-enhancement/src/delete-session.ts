/**
 * dsh-enhancement · 删除会话（物理删除持久化目录 + 卸载内存 live 会话）。
 *
 * DSH 的持久化层只提供 stat / 读取，没有删除 API，所以这里自己定位会话目录并
 * `rmSync` 整个目录。安全约束：
 *  - sessionId 必须匹配白名单字符集，杜绝路径穿越；
 *  - 真正要删的目录必须恰好是 `<sessionsRoot>/<projectDir>/<sessionDir>`，
 *    且目录内确实存在 `session.v*.jsonl*` 日志文件，避免误删别的东西；
 *  - 运行中的会话会先自动停止（停止超时则报错，不再直接拒绝）。
 *
 * 关键：`sessionQuery.listSessions()` 会把内存里 live 的 `ctx.sessions.list()`
 * 并入列表（live 优先）。只删磁盘 + `workspace.detachSession` 而不卸载内存
 * live 会话，会让它在列表里掉进「未分组」且看起来没被删掉。因此这里在删目录
 * 之前先卸载 agent 与 live session（cancel / scope.dispose / store.delete /
 * flush / store entry.detach / emit session/disposed）。
 *
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

/** 卸载 agent/session 时等待其异步收尾的兜底时长（毫秒）。 */
const TEARDOWN_RACE_MS = 3_000

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

export type DeleteErrorCode = 'request.invalid' | 'session.stop-timeout' | 'delete.unsafe-path'

/** agent 的最小可用形态（只依赖真正会调到的成员）。 */
interface AgentLike {
  status?: string
  busy?: boolean
  whenIdle?(): Promise<void>
  cancel?(options?: { kind?: string }): void
  scope?: { dispose?(): Promise<void> | void }
}

/** agents 服务的最小形态。 */
interface AgentsLike {
  get?(id: string): AgentLike | undefined
  store?: { delete?(id: string): unknown }
}

/** sessions.store 里的单条会话记录。 */
interface SessionStoreEntryLike {
  detach?(): void
}

/** sessions 服务的最小形态。 */
interface SessionsLike {
  get?(id: string): unknown
  flush?(session: unknown): Promise<unknown> | unknown
  store?: { get?(id: string): SessionStoreEntryLike | undefined }
}

/** 一个工作区实体的最小形态（record.sessionIds 为耐久记录）。 */
interface WorkspaceEntityLike {
  sessionIds?: string[]
  record?: { sessionIds?: string[] }
  detachSession?(id: string): Promise<unknown> | unknown
}

/** workspaceRegistry 的最小形态。 */
interface RegistryLike {
  list?(): WorkspaceEntityLike[]
  stopSessionActivity?(id: string): Promise<unknown> | unknown
  unarchiveSession?(id: string): Promise<unknown> | unknown
  unpinSession?(id: string): Promise<unknown> | unknown
}

export interface SessionDeleteContextLike {
  get(name: string): unknown
  parallel?(event: string, data: unknown): Promise<unknown> | unknown
  waterfall?(event: string, data: unknown, next: () => Promise<unknown>): Promise<unknown> | unknown
  emit?(event: string, data: unknown): unknown
}

export interface DeleteSessionResult {
  deleted: boolean
  reason?: string
  stopped?: boolean
  wasLive?: boolean
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

/** 取工作区实体的耐久成员 id：优先 record.sessionIds，不能用运行时过滤过的 getter。 */
function workspaceMemberIds(workspace: WorkspaceEntityLike): string[] {
  return (workspace as { record?: { sessionIds?: string[] } }).record?.sessionIds ?? workspace.sessionIds ?? []
}

/** 尽力清理工作区注册表里的会话痕迹，失败只记 warning。 */
async function cleanupRegistry(
  ctx: SessionDeleteContextLike,
  sessionId: string,
  warnings: string[],
): Promise<void> {
  const wr = ctx.get('workspaceRegistry') as RegistryLike | undefined
  // 先按耐久记录 detach 出每个工作区。
  for (const workspace of wr?.list?.() ?? []) {
    if (workspaceMemberIds(workspace).includes(sessionId)) {
      try {
        await workspace.detachSession?.(sessionId)
      } catch (error) {
        warnings.push(String(error))
      }
    }
  }
  // 再取消归档 / 取消置顶（best-effort）。
  try {
    await wr?.unarchiveSession?.(sessionId)
  } catch (error) {
    warnings.push(String(error))
  }
  try {
    await wr?.unpinSession?.(sessionId)
  } catch (error) {
    warnings.push(String(error))
  }
}

/** 等待运行中的 agent 进入 idle；超时返回 false。 */
async function waitForAgentIdle(agent: AgentLike, timeoutMs: number): Promise<boolean> {
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

/** 尽力卸载 agent（取消回合、收敛自身 fiber、从注册表删除）。 */
async function disposeAgent(
  agent: AgentLike,
  agents: AgentsLike | undefined,
  sessionId: string,
): Promise<void> {
  try {
    agent.cancel?.({ kind: 'disposed' })
  } catch {
    /* best-effort */
  }
  if (typeof agent.scope?.dispose === 'function') {
    try {
      await Promise.race([Promise.resolve(agent.scope.dispose()), sleep(TEARDOWN_RACE_MS)])
    } catch {
      /* best-effort */
    }
  }
  try {
    agents?.store?.delete?.(sessionId)
  } catch {
    /* best-effort */
  }
}

/**
 * 物理删除一个会话的持久化目录，并尽力清理注册表。
 *
 * 删除前会先卸载内存里的 live agent / session，避免它们在 `listSessions()`
 * 里以 live 优先的身份掉进「未分组」而看起来没删掉。
 *
 * 运行中的会话会先停止；若在超时内仍在运行，抛 `session.stop-timeout`。
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
  const id = sessionId
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
  const warnings: string[] = []

  const agents = ctx.get('agents') as AgentsLike | undefined
  const sessions = ctx.get('sessions') as SessionsLike | undefined
  const registry = ctx.get('workspaceRegistry') as RegistryLike | undefined

  const agent = agents?.get?.(id)
  const liveSession = sessions?.get?.(id)
  const wasRunning = agent?.status === 'running'

  // 活动判定：waterfall 不可用则视为无。
  let activities: unknown[] = []
  try {
    const value = await ctx.waterfall?.('workspace/session-activity', { sessionId: id }, () => Promise.resolve([]))
    if (Array.isArray(value)) activities = value
  } catch {
    /* 视为无活动 */
  }
  const active = wasRunning || activities.length > 0

  // 活动会话先停止：取消回合、收敛 fiber、停掉活动，再等待真正 idle。
  if (active) {
    try {
      agent?.cancel?.({ kind: 'disposed' })
    } catch {
      /* best-effort */
    }
    if (typeof agent?.scope?.dispose === 'function') {
      try {
        await Promise.race([Promise.resolve(agent.scope.dispose()), sleep(TEARDOWN_RACE_MS)])
      } catch {
        /* best-effort */
      }
    }
    try {
      if (typeof registry?.stopSessionActivity === 'function') {
        await registry.stopSessionActivity(id)
      } else {
        await ctx.parallel?.('workspace/session-stop', { sessionId: id })
      }
    } catch {
      /* best-effort */
    }
    if (wasRunning && typeof agent?.whenIdle === 'function') {
      const ok = await waitForAgentIdle(agent, stopTimeoutMs)
      if (!ok) throw codedError('session.stop-timeout', '会话仍在停止中，请稍后重试')
    }
  }

  // 卸载内存里的 live agent / session（对存在的对象无条件执行）。
  let detached = false
  if (agent) {
    await disposeAgent(agent, agents, id)
  }
  if (liveSession) {
    // 先把缓冲事件落盘，再让持久化写路径做一次最终 drain。
    try {
      await sessions?.flush?.(liveSession)
    } catch {
      /* best-effort */
    }
    try {
      const entry = sessions?.store?.get?.(id)
      if (entry && typeof entry.detach === 'function') {
        entry.detach()
        await sleep(200) // 等写后退休落定
        detached = true
      }
    } catch {
      /* best-effort */
    }
  }
  // 没有 live store 记录（或已无 live 会话）时，显式广播，让所有客户端丢弃该行。
  if (!detached) {
    try {
      ctx.emit?.('session/disposed', { id })
    } catch {
      /* best-effort */
    }
  }

  // 空白会话可能在 flush 后才落盘，所以卸载之后再取一次 stat。
  const sp = ctx.get('sessionPersistence') as
    | { stat?(id: string): Promise<{ location?: { path?: unknown } }> }
    | undefined
  const snap = sp?.stat ? await sp.stat(id) : undefined
  const locationPath = snap?.location?.path

  const hp = ctx.get('dshHomePath') as ((sub?: string) => string) | string | undefined
  const root = typeof hp === 'function' ? hp('sessions') : join(DSH_HOME, 'sessions')
  const dir = locationPath ? resolveSessionDir(String(locationPath), root) : undefined

  // 清账：detach 工作区 + 取消归档 / 置顶。
  await cleanupRegistry(ctx, id, warnings)

  // 物理删除目录（存在才删）。
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
  }

  const wasLive = Boolean(agent || liveSession)
  if (!dir && !wasLive) {
    const notFound: DeleteSessionResult = { deleted: false, reason: 'not-found' }
    if (warnings.length > 0) notFound.warnings = warnings
    return notFound
  }

  const result: DeleteSessionResult = { deleted: true, stopped: wasRunning, wasLive }
  if (warnings.length > 0) result.warnings = warnings
  return result
}
