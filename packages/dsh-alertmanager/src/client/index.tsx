/**
 * dsh-alertmanager 浏览器半侧入口。
 *
 * 注册两个槽位：
 * - `sidebar.panellist`：左侧栏「告警」入口（PANEL_ID 与主面板 key 相同）；
 * - `main`：告警主面板，注入 `workspaces` 与 `uiWorkspace` 服务。
 */
import React from 'react'
import { AlertmanagerPage } from './panel'

/** 侧栏入口与主面板共用的 panel key。 */
export const PANEL_ID = 'alertmanager'

export const inject = ['slots', 'uiWorkspace', 'workspaces']

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

interface ClientSlots {
  inject(key: string, callback: () => unknown): () => void
  register(
    options: Record<string, unknown>,
    component: React.ComponentType<Record<string, unknown>>,
  ): () => void
}

interface ClientContext {
  slots: ClientSlots
  workspaces: unknown
  uiWorkspace: unknown
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 10,
        label: () => '告警',
      },
      PanelIcon as unknown as React.ComponentType<Record<string, unknown>>,
    ),
  )

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        inject: () => ({
          workspaces: ctx.workspaces,
          uiWorkspace: ctx.uiWorkspace,
        }),
      },
      AlertmanagerPage as unknown as React.ComponentType<Record<string, unknown>>,
    )
  })
}
