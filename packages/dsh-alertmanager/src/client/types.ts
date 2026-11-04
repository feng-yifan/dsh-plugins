/**
 * dsh-alertmanager · 浏览器半侧结构化类型
 *
 * 与宿主半侧一致：不 import 任何 `@deepseek-ai/*` 运行时导出，只用结构化类型
 * 描述 DSH 客户端提供的槽位、locale 与工作区服务切片。
 */
import type React from 'react'
import type { Translate } from '../locales.js'

export type AuthMode = 'none' | 'basic' | 'bearer'
export type AlertState = 'active' | 'suppressed' | 'unprocessed'
export type StateFilter = 'all' | AlertState

export interface PublicInstance {
  id: string
  name: string
  url: string
  authMode: AuthMode
  username: string
  hasSecret: boolean
  insecureTls: boolean
}

export interface PublicSettings {
  instances: PublicInstance[]
}

export interface AlertItem {
  fingerprint: string
  name: string
  severity: string
  state: AlertState
  startsAt: string
  endsAt: string
  updatedAt: string
  generatorURL: string
  summary: string
  description: string
  labels: Record<string, string>
  annotations: Record<string, string>
  receivers: string[]
  silencedBy: string[]
  inhibitedBy: string[]
}

export interface MergedAlert extends AlertItem {
  instanceId: string
  instanceName: string
  instanceUrl: string
}

export interface AlertStats {
  total: number
  active: number
  suppressed: number
}

export interface InstanceAlertsResult {
  id: string
  name: string
  url: string
  ok: boolean
  error?: string
  code?: string
  alerts: AlertItem[]
  stats: AlertStats
}

export interface AlertsPayload {
  fetchedAt: string
  instances: InstanceAlertsResult[]
  alerts: MergedAlert[]
}

/** 工作区列表快照中本面板用到的字段。 */
export interface AlertmanagerWorkspace {
  workspaceId: string
  path: string
  title: string
}

/** `ctx.workspaces.list` 中本面板用到的读视图。 */
export interface WorkspaceListSource {
  getSnapshot(): { items: readonly AlertmanagerWorkspace[] }
  subscribe(listener: () => void): () => void
}

/** 主面板从 `inject` 拿到的 props。 */
export interface AlertmanagerPageProps {
  workspaces: { list: WorkspaceListSource }
  uiWorkspace: { openSession(sessionId: string): void }
  t: Translate
  locale?: LocaleRuntimeLike
}

/** DSH locale 快照中本面板用到的切片。 */
export interface LocaleSnapshotLike {
  active: string
  revision: number
}

/** DSH `ctx.locale` 中本面板用到的切片。 */
export interface LocaleRuntimeLike {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): Translate
  getSnapshot(): LocaleSnapshotLike
  subscribe(listener: () => void): () => void
}

/** 浏览器半侧 cordis Context 中本插件用到的切片。 */
export interface ClientContextLike {
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(
      options: Record<string, unknown>,
      component: React.ComponentType<Record<string, unknown>>,
    ): () => void
  }
  locale: LocaleRuntimeLike
  workspaces: { list: WorkspaceListSource }
  uiWorkspace: { openSession(sessionId: string): void }
  effect(callback: () => void | (() => void), label?: string): unknown
}
