/**
 * dsh-alertmanager · 告警数据单例（浏览器半侧）
 *
 * 把核心 store（`../store.ts`，与运行环境无关、可在 Node 里测试）接到真实环境：
 * 同源 fetch、localStorage、window 计时器、document 可见性，并在每次状态变化时
 * 把计数广播给侧栏入口。
 *
 * 单一事实来源：侧栏入口与主面板都只 `useSyncExternalStore` 订阅它，
 * 因此数据一到两侧同时更新，且全局只有一个自动刷新计时器。
 */
import { api, isAbortError } from './api'
import { publishCounts } from './counts'
import { createAlertsStore, REFRESH_OPTIONS } from '../store'
import type { AlertsSnapshot, RefreshInterval } from '../store'

const INTERVAL_KEY = 'dsh-alertmanager:refresh'

export { REFRESH_OPTIONS }
export type { RefreshInterval, AlertsSnapshot }

export const store = createAlertsStore({
  request: async <T,>(path: string, init?: { method?: string; body?: string }, signal?: AbortSignal): Promise<T> =>
    api<T>(path, init, signal),
  readInterval: () => {
    try {
      return window.localStorage.getItem(INTERVAL_KEY)
    } catch {
      return null
    }
  },
  writeInterval: (value: string) => {
    try {
      window.localStorage.setItem(INTERVAL_KEY, value)
    } catch {
      /* localStorage 不可写时忽略 */
    }
  },
  isAbort: isAbortError,
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number)
  },
  isHidden: () => document.hidden,
})

// 计数变化 → 侧栏入口重新解析标签。
let lastCounts = ''
store.subscribe(() => {
  const counts = store.snapshot().counts
  const key = `${counts.total}:${counts.critical}:${counts.warning}:${counts.info}:${counts.other}:${counts.configured}`
  if (key === lastCounts) return
  lastCounts = key
  publishCounts(counts)
})

export function snapshotState(): AlertsSnapshot {
  return store.snapshot()
}
