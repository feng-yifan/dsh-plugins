/**
 * dsh-alertmanager · 侧栏计数广播（进程内单例）
 *
 * store 每次状态变化后把权威计数 publish 到这里，侧栏入口标签读取当前快照，
 * 因此「AlertManager」后面能显示分级数量胶囊。计数实现只有 store 一份，
 * 本模块只负责“变化通知”。
 */
import type { AlertCounts } from '../store'

export type { AlertCounts } from '../store'

const EMPTY: AlertCounts = {
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

let current: AlertCounts = EMPTY
const listeners = new Set<() => void>()

function same(left: AlertCounts, right: AlertCounts): boolean {
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

export function publishCounts(next: AlertCounts): void {
  if (same(current, next)) return
  current = next
  for (const listener of listeners) listener()
}

export function countsSnapshot(): AlertCounts {
  return current
}

export function subscribeCounts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
