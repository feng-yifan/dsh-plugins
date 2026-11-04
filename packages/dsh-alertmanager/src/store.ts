/**
 * dsh-alertmanager · 告警数据核心（与运行环境无关，可在 Node 里直接测试）
 *
 * 唯一的告警数据来源：侧栏入口与主面板都只读这同一个 store，因此数据一到，
 * 两侧同时更新；拉取、定时刷新、并发去重、取消、计数统计都只在这里发生。
 *
 * 所有副作用（网络、存储、计时器、可见性）通过 {@link StoreDeps} 注入，
 * 浏览器半侧（`src/client/store.ts`）负责把它们接到真实环境上。
 */
/**
 * 这里刻意不复用 `src/client/types.ts`：核心 store 属于 host 侧编译单元，
 * 只描述它真正用到的字段，保持与运行环境、与 UI 类型解耦（结构兼容即可）。
 */
export interface AlertItemLike {
  fingerprint: string
  severity: string
  state: string
}
export interface InstanceResultLike {
  id: string
  name: string
}
export interface AlertsPayloadLike {
  fetchedAt: string
  instances: readonly InstanceResultLike[]
  alerts: readonly AlertItemLike[]
}
export interface PublicSettingsLike {
  instances: readonly { id: string }[]
}

export type RefreshInterval = 'off' | '5s' | '10s' | '30s' | '1m' | '5m'

export const REFRESH_OPTIONS: ReadonlyArray<{ key: RefreshInterval; ms: number | null }> = [
  { key: 'off', ms: null },
  { key: '5s', ms: 5_000 },
  { key: '10s', ms: 10_000 },
  { key: '30s', ms: 30_000 },
  { key: '1m', ms: 60_000 },
  { key: '5m', ms: 300_000 },
]

export const DEFAULT_INTERVAL: RefreshInterval = '5s'

export type Phase = 'idle' | 'loading' | 'unconfigured' | 'ready' | 'error'

export type SeverityKey = 'critical' | 'warning' | 'info' | 'other'

/** 计数统计（侧栏胶囊与面板标题都用它）。 */
export interface AlertCounts {
  total: number
  active: number
  suppressed: number
  unprocessed: number
  critical: number
  warning: number
  info: number
  other: number
  configured: boolean
}

export interface AlertsSnapshot {
  phase: Phase
  settings: PublicSettingsLike | null
  payload: AlertsPayloadLike | null
  error: unknown
  /** 最近一次成功拉取时间（ISO 字符串）。 */
  fetchedAt: string
  /** 有请求在途。 */
  loading: boolean
  /** 用户手动触发且仍在途（驱动「取消」按钮）。 */
  manualLoading: boolean
  /** 本次刷新被用户取消。 */
  cancelled: boolean
  /** 最近一次失败的错误码（ApiError.code），用于区分“未配置/鉴权”等终态错误。 */
  errorCode: string
  intervalKey: RefreshInterval
  /** 下一次自动刷新的时间戳；0 = 未排程。 */
  nextAt: number
  counts: AlertCounts
  selected: ReadonlySet<string>
}

/** 环境依赖（浏览器/测试各自提供）。 */
export interface StoreDeps {
  /** 发起一次插件内同源请求。 */
  request<T>(path: string, init?: { method?: string; body?: string }, signal?: AbortSignal): Promise<T>
  /** 读取本地持久化的刷新间隔原始值。 */
  readInterval(): string | null
  /** 持久化刷新间隔。 */
  writeInterval(value: string): void
  /** 识别「请求被取消」的错误。 */
  isAbort(error: unknown): boolean
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  isHidden(): boolean
}

const EMPTY_COUNTS: AlertCounts = {
  total: 0,
  active: 0,
  suppressed: 0,
  unprocessed: 0,
  critical: 0,
  warning: 0,
  info: 0,
  other: 0,
  configured: false,
}

/** 取 ApiError 的 code（无 code 时返回空串）。 */
function codeOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

/** 该错误是否属于「重试也不会好」的终态（鉴权 / 未配置）。 */
export function isTerminalError(code: string): boolean {
  return code === 'alerts.not-configured' || code === 'auth.gateway' || code === 'auth.dsh'
}

export function severityKey(severity: string): SeverityKey {
  const value = severity.trim().toLowerCase()
  if (value === 'critical') return 'critical'
  if (value === 'warning') return 'warning'
  if (value === 'info') return 'info'
  return 'other'
}

export function countsOf(payload: AlertsPayloadLike | null): AlertCounts {
  if (payload === null) return EMPTY_COUNTS
  const counts: AlertCounts = { ...EMPTY_COUNTS, configured: payload.instances.length > 0 }
  for (const alert of payload.alerts as readonly AlertItemLike[]) {
    counts.total += 1
    counts[severityKey(alert.severity)] += 1
    if (alert.state === 'active') counts.active += 1
    else if (alert.state === 'suppressed') counts.suppressed += 1
    else counts.unprocessed += 1
  }
  return counts
}

function sameCounts(left: AlertCounts, right: AlertCounts): boolean {
  return (
    left.total === right.total &&
    left.active === right.active &&
    left.suppressed === right.suppressed &&
    left.unprocessed === right.unprocessed &&
    left.critical === right.critical &&
    left.warning === right.warning &&
    left.info === right.info &&
    left.other === right.other &&
    left.configured === right.configured
  )
}

export interface AlertsStore {
  snapshot(): AlertsSnapshot
  subscribe(listener: () => void): () => void
  bootstrap(): Promise<void>
  load(options?: { manual?: boolean }): Promise<void>
  cancel(): void
  setIntervalKey(key: RefreshInterval): void
  handleVisibility(): void
  saveSettings(input: unknown): Promise<PublicSettingsLike>
  /** 无条件重读服务端设置（配置可能在别处被改）。 */
  refreshSettings(): Promise<void>
  updateSelected(updater: (current: ReadonlySet<string>) => ReadonlySet<string>): void
  /** 释放计时器（插件卸载时）。 */
  dispose(): void
}

export function readIntervalFrom(raw: string | null): RefreshInterval {
  return raw !== null && REFRESH_OPTIONS.some((option) => option.key === raw)
    ? (raw as RefreshInterval)
    : DEFAULT_INTERVAL
}

export function createAlertsStore(deps: StoreDeps): AlertsStore {
  let state: AlertsSnapshot = {
    phase: 'idle',
    settings: null,
    payload: null,
    error: null,
    fetchedAt: '',
    loading: false,
    manualLoading: false,
    cancelled: false,
    errorCode: '',
    intervalKey: readIntervalFrom(deps.readInterval()),
    nextAt: 0,
    counts: EMPTY_COUNTS,
    selected: new Set(),
  }
  const listeners = new Set<() => void>()
  let controller: AbortController | null = null
  let timer: unknown = null
  /** 卸载后不再发起请求/排程，避免热更后旧模块继续轮询。 */
  let disposed = false
  /** 在途请求期间被丢弃的刷新意图（手动优先），结束时补发一次。 */
  let trailing: { manual: boolean } | null = null

  function set(patch: Partial<AlertsSnapshot>): void {
    let changed = false
    for (const key of Object.keys(patch) as Array<keyof AlertsSnapshot>) {
      if (state[key] !== patch[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function intervalMs(key: RefreshInterval): number | null {
    const option = REFRESH_OPTIONS.find((item) => item.key === key)
    return option === undefined ? null : option.ms
  }

  /** 重新排程自动刷新；任何一次请求结束、切换间隔、可见性变化都走这里。 */
  function schedule(): void {
    if (timer !== null) {
      deps.clearTimeout(timer)
      timer = null
    }
    const ms = intervalMs(state.intervalKey)
    const terminal =
      state.phase === 'idle' ||
      state.phase === 'unconfigured' ||
      // error 为终态（鉴权/配置类）时不自动重试，交给用户点「重试」；
      // 有旧数据时 phase 仍是 ready，会自动重试。
      state.phase === 'error'
    if (disposed || ms === null || terminal || deps.isHidden()) {
      set({ nextAt: 0 })
      return
    }
    set({ nextAt: deps.now() + ms })
    timer = deps.setTimeout(() => {
      timer = null
      void load({ manual: false })
    }, ms)
  }

  async function load(options: { manual?: boolean } = {}): Promise<void> {
    if (disposed) return
    // 并发去重：在途期间记录一次“待补发”，避免用户手动刷新/派发后被静默丢弃。
    if (controller !== null) {
      trailing = { manual: trailing?.manual === true || options.manual === true }
      return
    }
    const local = new AbortController()
    controller = local
    set({ loading: true, manualLoading: options.manual === true, cancelled: false })
    try {
      const payload = await deps.request<AlertsPayloadLike>('/alerts', undefined, local.signal)
      set({
        phase: 'ready',
        payload,
        counts: countsOf(payload),
        fetchedAt: payload.fetchedAt,
        error: null,
        errorCode: '',
        loading: false,
        manualLoading: false,
      })
    } catch (error) {
      const code = codeOf(error)
      if (deps.isAbort(error)) {
        set({ loading: false, manualLoading: false, cancelled: true })
      } else if (code === 'alerts.not-configured') {
        // 服务端权威地告诉我们“没有实例了”：清空数据并进入未配置态，
        // 绝不能保留旧 payload（否则卡片与侧栏计数永久冻结）。
        set({
          loading: false,
          manualLoading: false,
          error,
          errorCode: code,
          phase: 'unconfigured',
          payload: null,
          counts: EMPTY_COUNTS,
          selected: new Set(),
        })
      } else {
        set({
          loading: false,
          manualLoading: false,
          error,
          errorCode: code,
          // 已有数据时只在状态栏提示错误，不把界面打回错误页。
          phase: state.payload === null ? 'error' : 'ready',
        })
      }
    } finally {
      if (controller === local) controller = null
      schedule()
      // 补发在途期间被丢弃的刷新意图（只补一次，避免死循环）。
      if (!disposed && trailing !== null) {
        const next = trailing
        trailing = null
        void load(next)
      }
    }
  }

  /** 无条件重新读取服务端设置并按实例数分派（重同步用）。 */
  async function refreshSettings(): Promise<void> {
    if (disposed) return
    if (state.phase !== 'ready') set({ phase: 'loading', error: null })
    try {
      const settings = await deps.request<PublicSettingsLike>('/settings')
      set({ settings })
      if (settings.instances.length === 0) {
        set({ phase: 'unconfigured', payload: null, counts: EMPTY_COUNTS, selected: new Set(), nextAt: 0 })
        if (timer !== null) {
          deps.clearTimeout(timer)
          timer = null
        }
        return
      }
      await load({ manual: false })
    } catch (error) {
      set({ phase: state.payload === null ? 'error' : 'ready', error, errorCode: codeOf(error) })
    }
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async bootstrap() {
      if (state.phase !== 'idle' && state.phase !== 'error') return
      await refreshSettings()
    },
    refreshSettings,
    load,
    cancel() {
      controller?.abort()
    },
    setIntervalKey(key) {
      deps.writeInterval(key)
      set({ intervalKey: key })
      schedule()
    },
    handleVisibility() {
      if (deps.isHidden()) {
        if (timer !== null) {
          deps.clearTimeout(timer)
          timer = null
        }
        controller?.abort()
        set({ nextAt: 0 })
        return
      }
      void load({ manual: false })
    },
    async saveSettings(input) {
      const saved = await deps.request<PublicSettingsLike>('/settings', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      set({ settings: saved })
      if (saved.instances.length === 0) {
        set({ payload: null, phase: 'unconfigured', counts: EMPTY_COUNTS, selected: new Set(), error: null, errorCode: '' })
        schedule()
      } else {
        await load({ manual: false })
      }
      return saved
    },
    updateSelected(updater) {
      const next = updater(state.selected)
      if (next === state.selected) return
      if (next.size === state.selected.size && [...next].every((key) => state.selected.has(key))) return
      set({ selected: next })
    },
    dispose() {
      disposed = true
      trailing = null
      if (timer !== null) {
        deps.clearTimeout(timer)
        timer = null
      }
      controller?.abort()
      listeners.clear()
    },
  }
}
