/**
 * dsh-alertmanager 浏览器半侧入口。
 *
 * 注册两个槽位：
 * - `sidebar.panellist`：左侧栏「AlertManager」入口（PANEL_ID 与主面板 key 相同）；
 *   标签由 `counts` 快照拼出「名称 + 分级数量胶囊」，计数变化时重新注册该入口，
 *   让 DSH 侧栏重新读取标签；
 * - `main`：告警主面板，注入 `workspaces` / `uiWorkspace` / `t` / `locale`。
 *
 * 所有可见文案都走 DSH locale；`zh` 是键集真源，`en` 在编译期约束为同键集。
 */
import React from 'react'
import { LOCALE_NS, en, zh } from '../locales'
import { countsSnapshot, subscribeCounts } from './counts'
import type { AlertCounts } from './counts'
import { AlertmanagerPage } from './panel'
import { store } from './store'
import { smaller, tokens } from './pieces'
import type { AlertmanagerPageProps, ClientContextLike } from './types'

/** 侧栏入口与主面板共用的 panel key。 */
export const PANEL_ID = 'alertmanager'

export const inject = ['slots', 'uiWorkspace', 'workspaces', 'locale']

interface IconProps {
  size?: number
  active?: boolean
}

/** 侧栏图标：铃铛 + 感叹号，颜色跟随 currentColor。 */
function PanelIcon({ size = 18, active = false }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path
        d="M12 3.25c-3.04 0-5.5 2.46-5.5 5.5v3.1c0 .86-.3 1.7-.85 2.36l-1.05 1.27c-.5.6-.07 1.52.71 1.52h13.38c.78 0 1.21-.92.71-1.52l-1.05-1.27a3.7 3.7 0 0 1-.85-2.36v-3.1c0-3.04-2.46-5.5-5.5-5.5Z"
        stroke="currentColor"
        strokeWidth={active ? 1.9 : 1.7}
        strokeLinejoin="round"
      />
      <path
        d="M9.75 19.1a2.4 2.4 0 0 0 4.5 0"
        stroke="currentColor"
        strokeWidth={active ? 1.9 : 1.7}
        strokeLinecap="round"
      />
      <path d="M12 7.5v4.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="14.6" r="1.05" fill="currentColor" />
    </svg>
  )
}

/** 侧栏标签里的一个分级数量胶囊（与面板里 Tag 同一配方）。 */
function CountPill({ count, color }: { count: number; color: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        marginLeft: 4,
        boxSizing: 'border-box',
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontSize: smaller(3.5),
        fontWeight: 700,
        lineHeight: '16px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {count > 99 ? '99+' : String(count)}
    </span>
  )
}

/** 由计数快照生成侧栏标签：「AlertManager」+ 各严重度数量胶囊。 */
function sidebarLabel(counts: AlertCounts): React.ReactNode {
  if (!counts.configured || counts.total === 0) return 'AlertManager'
  const pills: React.ReactElement[] = []
  if (counts.critical > 0) pills.push(<CountPill key="c" count={counts.critical} color={tokens.error} />)
  if (counts.warning > 0) pills.push(<CountPill key="w" count={counts.warning} color={tokens.warnText} />)
  if (counts.info > 0) pills.push(<CountPill key="i" count={counts.info} color={tokens.info} />)
  if (pills.length === 0) pills.push(<CountPill key="o" count={counts.other} color={tokens.labelTertiary} />)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
      AlertManager
      {pills}
    </span>
  )
}

export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-alertmanager: locales')

  // 插件卸载/热更时停掉请求与自动刷新计时器
  ctx.effect(() => () => store.dispose(), 'dsh-alertmanager: dispose store')
  const t = ctx.locale.bind(LOCALE_NS)

  // 计数变化时重新注册侧栏入口，让 DSH 侧栏重新解析标签（其快照只在槽位/语言变化时同步）。
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const mount = (): void => {
      dispose?.()
      dispose = ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 10,
            locale: LOCALE_NS,
            label: () => sidebarLabel(countsSnapshot()),
          },
          PanelIcon as unknown as React.ComponentType<Record<string, unknown>>,
        ),
      )
    }
    mount()
    // 进入页面即尝试加载一次：侧栏数字无需打开面板就能出现
    void store.bootstrap()
    const off = subscribeCounts(mount)
    return () => {
      off()
      dispose?.()
    }
  }, 'dsh-alertmanager: sidebar entry')

  ctx.effect(
    () =>
      ctx.slots.inject('main', function* () {
        yield ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: (): AlertmanagerPageProps => ({
              workspaces: ctx.workspaces,
              uiWorkspace: ctx.uiWorkspace,
              t,
              locale: ctx.locale,
            }),
          },
          AlertmanagerPage as unknown as React.ComponentType<Record<string, unknown>>,
        )
      }),
    'dsh-alertmanager: main panel',
  )
}
