/**
 * dsh-plan-tab-autoclose · 纯逻辑（可在 node 里直接测，不依赖 cordis/React/DOM）
 */

/** 一个只读可观察快照（DSH client-store 的 ObservableSnapshot 切片）。 */
export interface Snapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 右侧栏一个打开标签的元数据（ctx.sidebarRight.openTabs 的元素）。 */
export interface OpenTab {
  readonly sessionId: string
  readonly tabId: string
  readonly kind: string
  readonly contentId: string
}

/** plan 投影值。 */
export interface PlanProjection {
  active: boolean
  pending?: boolean
}

interface SessionBindingLike {
  session: { projections: { faceOf(key: string): Snapshot<unknown> } }
}

/** ctx.sessions 中本插件用到的切片。 */
export interface SessionsLike {
  binding(id: string): SessionBindingLike | undefined
  list: Snapshot<{ ids?: readonly string[] }>
}

/** ctx.sidebarRight 中本插件用到的切片。 */
export interface SidebarRightLike {
  mounted: Snapshot<string | undefined>
  openTabs: Snapshot<readonly OpenTab[]>
  closeIn(sessionId: string, tabId: string): void
}

/** 宿主注入的客户端上下文切片。 */
export interface ClientContext {
  sessions: SessionsLike
  sidebarRight: SidebarRightLike
  effect(callback: () => void | (() => void), label?: string): unknown
  logger?: { warn?(...args: unknown[]): void; info?(...args: unknown[]): void }
}

const PLAN_KEY = 'plan'
const PLAN_KIND = 'plan'

/** 投影值是否处于计划模式开启（含待生效）状态。 */
export function isPlanActive(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as PlanProjection).active === true
}

/** 从打开标签里挑出属于某会话的全部计划标签 id。 */
export function collectPlanTabIds(openTabs: readonly OpenTab[], sessionId: string): string[] {
  return openTabs
    .filter((tab) => tab.sessionId === sessionId && tab.kind === PLAN_KIND)
    .map((tab) => tab.tabId)
}

/** 关闭某会话当前打开的全部计划标签，返回成功调用次数。逐项容错。 */
export function closePlanTabs(ctx: ClientContext, sessionId: string): number {
  const tabIds = collectPlanTabIds(ctx.sidebarRight.openTabs.getSnapshot(), sessionId)
  let closed = 0
  for (const tabId of tabIds) {
    try {
      ctx.sidebarRight.closeIn(sessionId, tabId)
      closed += 1
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-plan-tab-autoclose] closeIn(${sessionId}, ${tabId}) failed: ${String(error)}`)
    }
  }
  return closed
}

interface Watched {
  unsubscribePlan: () => void
  wasActive: boolean
}

/**
 * 安装自动关闭：对屏幕会话（以及曾进入过计划模式的会话）订阅 plan 投影，
 * 在 active 由真转假时关闭该会话全部计划标签。
 * @returns 卸载函数（退订全部订阅）。
 */
export function installPlanTabAutoclose(ctx: ClientContext): () => void {
  const watched = new Map<string, Watched>()
  let disposed = false

  const ensureWatched = (sessionId: string): void => {
    if (disposed || watched.has(sessionId)) return
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return // 尚未物化：等下一次 sessions.list 变化重试
    const planSnapshot = binding.session.projections.faceOf(PLAN_KEY)
    const entry: Watched = { unsubscribePlan: () => {}, wasActive: isPlanActive(planSnapshot.getSnapshot()) }
    entry.unsubscribePlan = planSnapshot.subscribe(() => {
      if (disposed) return
      if (isPlanActive(planSnapshot.getSnapshot())) {
        entry.wasActive = true
        return
      }
      if (entry.wasActive) {
        entry.wasActive = false
        closePlanTabs(ctx, sessionId)
      }
    })
    watched.set(sessionId, entry)
  }

  // 会话列表变化：重试物化当前屏幕会话；顺带清理已消失的会话订阅。
  const onList = (): void => {
    const mounted = ctx.sidebarRight.mounted.getSnapshot()
    if (mounted !== undefined) ensureWatched(mounted)
    const ids = ctx.sessions.list.getSnapshot()?.ids
    if (Array.isArray(ids)) {
      const alive = new Set(ids)
      for (const [sessionId, entry] of watched) {
        if (!alive.has(sessionId)) {
          entry.unsubscribePlan()
          watched.delete(sessionId)
        }
      }
    }
  }

  const unsubscribeMounted = ctx.sidebarRight.mounted.subscribe(() => {
    const mounted = ctx.sidebarRight.mounted.getSnapshot()
    if (mounted === undefined) return
    // 不再屏幕上、且从未进入过计划模式的旧会话可释放订阅（减少占用）。
    for (const [sessionId, entry] of [...watched]) {
      if (sessionId !== mounted && !entry.wasActive) {
        entry.unsubscribePlan()
        watched.delete(sessionId)
      }
    }
    ensureWatched(mounted)
  })
  const unsubscribeList = ctx.sessions.list.subscribe(onList)

  const initial = ctx.sidebarRight.mounted.getSnapshot()
  if (initial !== undefined) ensureWatched(initial)

  return () => {
    disposed = true
    unsubscribeMounted()
    unsubscribeList()
    for (const entry of watched.values()) entry.unsubscribePlan()
    watched.clear()
  }
}
