/**
 * dsh-alertmanager · 浏览器半侧「AlertManager 告警」主面板
 *
 * 多实例聚合、单列卡片、Grafana 式两态刷新、自绘设置弹窗与吸底派发栏。
 * 纯 React + 内联样式，不写 DOM、不引第三方 UI 库；所有可见文案走 `t`。
 */
import React from 'react'
import { api, ApiError, isAbortError, isAuthError, localizeApiError } from './api'
import { severityKey } from '../store'
import type { SeverityKey } from '../store'
import { REFRESH_OPTIONS, store } from './store'
import type { RefreshInterval } from './store'
import {
  CheckCircle,
  CheckIcon,
  chipHeight,
  bigger,
  ChevronIcon,
  Dropdown,
  Field,
  FilterChip,
  formatClock,
  ghostButtonStyle,
  Modal,
  primaryButtonStyle,
  RefreshIcon,
  radius,
  rule,
  secondaryButtonStyle,
  Segmented,
  Spinner,
  space,
  controlHeight,
  Switch,
  Tag,
  TextInput,
  tokens,
  useHover,
} from './pieces'
import type { TagTone } from './pieces'
import type {
  AlertItem,
  AlertsPayload,
  AlertState,
  AuthMode,
  InstanceAlertsResult,
  AlertmanagerPageProps,
  MergedAlert,
  PublicInstance,
  PublicSettings,
  StateFilter,
} from './types'
import type { Translate } from '../locales'

const LAST_WORKSPACE_KEY = 'dsh-alertmanager/last-workspace'
const SEVERITY_KEYS: readonly SeverityKey[] = ['critical', 'warning', 'info', 'other']

type Phase = 'loading' | 'unconfigured' | 'error' | 'ready'

function readLastWorkspace(): string {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeLastWorkspace(workspaceId: string): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId)
  } catch {
    /* 忽略。 */
  }
}

function selectionKey(alert: Pick<MergedAlert, 'instanceId' | 'fingerprint'>): string {
  return JSON.stringify([alert.instanceId, alert.fingerprint])
}

function parseSelectionKey(key: string): { instanceId: string; fingerprint: string } | null {
  try {
    const value = JSON.parse(key) as unknown
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string'
    ) {
      return { instanceId: value[0], fingerprint: value[1] }
    }
  } catch {
    /* 忽略损坏的 key。 */
  }
  return null
}

function stateLabel(t: Translate, state: AlertState): string {
  return t(`filter.state.${state}`)
}

function severityLabel(t: Translate, severity: string): string {
  return severity.trim() === '' ? t('card.severityUnknown') : severity
}

const INSTANCE_ERROR_KEYS: Record<string, string> = {
  'alerts.tls-untrusted': 'error.instance.tls',
  'alerts.timeout': 'error.instance.timeout',
  'alerts.network': 'error.instance.network',
  'alerts.http': 'error.instance.http',
  'alerts.invalid-response': 'error.instance.invalid',
  'alerts.not-configured': 'error.instance.notConfigured',
}

/** 实例失败原因：已知 code 走本地化，未知显示服务端原文。 */
function localizeInstanceError(t: Translate, instance: InstanceAlertsResult): string {
  const key = instance.code === undefined ? undefined : INSTANCE_ERROR_KEYS[instance.code]
  if (key !== undefined) return t(key)
  return instance.error ?? ''
}

function severityTone(severity: string): TagTone {
  const value = severity.trim().toLowerCase()
  if (value === 'critical') return 'error'
  if (value === 'warning') return 'warning'
  if (value === 'info') return 'info'
  return 'outline'
}

function severityColor(severity: string): string {
  switch (severity.trim().toLowerCase()) {
    case 'critical':
      return tokens.error
    case 'warning':
      return tokens.warn
    case 'info':
      return tokens.info
    default:
      // 未知严重度用三级文字色（idle #d4d4d4/#545557 在卡底几乎看不见）
      return tokens.labelTertiary
  }
}

function parseHttpUrl(value: string): URL | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

function defaultNameForUrl(value: string): string {
  return parseHttpUrl(value)?.host ?? ''
}

function newDraftId(): string {
  const cryptoObject = globalThis.crypto
  if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === 'function') {
    return `instance-${cryptoObject.randomUUID()}`
  }
  return `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 订阅 locale revision，保证切换语言后所有 `t(...)` 重新求值。 */
function useLocaleRevision(locale: AlertmanagerPageProps['locale']): number {
  const subscribe = React.useCallback(
    (listener: () => void) => (locale === undefined ? () => undefined : locale.subscribe(listener)),
    [locale],
  )
  const getSnapshot = React.useCallback(
    () => (locale === undefined ? 0 : locale.getSnapshot().revision),
    [locale],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 刷新控件：分段式「刷新 / 取消 + 间隔」，按 DSH 的按钮尺寸（30px 高、radius-md、
 * hairline 描边、hover 底色）重做；刷新中切到取消态并可中止在途请求。
 */
function RefreshControl({
  refreshing,
  intervalKey,
  t,
  onRefresh,
  onCancel,
  onIntervalChange,
}: {
  refreshing: boolean
  intervalKey: RefreshInterval
  t: Translate
  onRefresh: () => void
  onCancel: () => void
  onIntervalChange: (value: RefreshInterval) => void
}): React.ReactElement {
  const current = REFRESH_OPTIONS.find((option) => option.key === intervalKey) ?? REFRESH_OPTIONS[1]
  const intervalLabel = t(`refresh.${current.key}`)
  const [actionHover, actionHoverEvents] = useHover()
  const [intervalHover, intervalHoverEvents] = useHover()
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        height: controlHeight,
        boxSizing: 'border-box',
        border: `1px solid ${tokens.borderL2}`,
        borderRadius: radius.md,
        background: tokens.bgLayer1,
        flex: 'none',
      }}
    >
      <button
        type="button"
        aria-label={refreshing ? t('refresh.aria.cancel') : t('refresh.aria.refresh')}
        title={refreshing ? t('refresh.cancelTitle') : t('refresh.idle')}
        onClick={refreshing ? onCancel : onRefresh}
        {...actionHoverEvents}
        style={{
          font: 'inherit',
          fontSize: tokens.fontBase,
          lineHeight: '20px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: `0 ${space.md}px`,
          border: 'none',
          background: actionHover ? tokens.bgHover : 'transparent',
          color: refreshing ? tokens.brand : tokens.labelPrimary,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 120ms ease',
        }}
      >
        {refreshing ? <Spinner size={13} /> : <RefreshIcon size={13} />}
        <span>{refreshing ? t('refresh.cancel') : t('refresh.idle')}</span>
      </button>
      <span aria-hidden="true" style={{ width: 1, background: rule, flex: 'none' }} />
      <Dropdown
        ariaLabel={t('refresh.aria.interval')}
        align="right"
        menuWidth={132}
        items={REFRESH_OPTIONS.map((option) => ({
          key: option.key,
          label: t(`refresh.${option.key}`),
          selected: option.key === intervalKey,
          onSelect: () => onIntervalChange(option.key),
        }))}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            aria-label={`${t('refresh.aria.interval')}: ${intervalLabel}`}
            aria-haspopup="menu"
            aria-expanded={open}
            title={t('refresh.aria.interval')}
            onClick={toggle}
            {...intervalHoverEvents}
            style={{
              font: 'inherit',
              fontSize: tokens.fontBase,
              lineHeight: '20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: `0 ${space.sm + 2}px`,
              border: 'none',
              background: intervalHover ? tokens.bgHover : 'transparent',
              color: tokens.labelSecondary,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 120ms ease',
            }}
          >
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{intervalLabel}</span>
            <ChevronIcon size={11} />
          </button>
        )}
      />
    </div>
  )
}

function AnnotationList({ annotations, t }: { annotations: Record<string, string>; t: Translate }): React.ReactElement {
  const entries = Object.entries(annotations).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return <span>{t('card.details.none')}</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ overflowWrap: 'anywhere' }}>
          <span style={{ color: tokens.labelSecondary }}>{key}: </span>
          <span style={{ color: tokens.labelPrimary }}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function LabelChips({
  labels,
  wrap,
  t,
  measureRef,
}: {
  labels: Record<string, string>
  wrap: boolean
  t: Translate
  measureRef?: React.Ref<HTMLDivElement>
}): React.ReactElement {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) {
    return <span style={{ color: tokens.labelSecondary, fontSize: tokens.fontSecondary }}>{t('card.noLabels')}</span>
  }
  return (
    <div
      ref={measureRef}
      style={{
        display: 'flex',
        gap: 4,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        overflow: wrap ? 'visible' : 'hidden',
        minWidth: 0,
      }}
    >
      {entries.map(([key, value]) => (
        <Tag key={key} tone="neutral" title={`${key}=${value}`}>
          <span
            style={{
              maxWidth: wrap ? '100%' : 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {key}={value}
          </span>
        </Tag>
      ))}
    </div>
  )
}

interface AlertCardProps {
  alert: MergedAlert
  t: Translate
  selected: boolean
  expanded: boolean
  onToggle: () => void
  onToggleExpand: () => void
}

/**
 * 单条告警卡片。
 *
 * 结构：`Card`（外框，负责边框/圆角/裁剪）→ 横向两栏：
 *   1. `SeverityBar`：严重度色条，作为**普通 flex 子项**参与布局，不再绝对定位，
 *      因此永远不会盖住外框边框（此前正是绝对定位的色块压在边框上）。
 *   2. `CardBody`：纵向内容（头部行 / 摘要 / 标签 / 展开详情）。
 */
export function AlertCard({
  alert,
  t,
  selected,
  expanded,
  onToggle,
  onToggleExpand,
}: AlertCardProps): React.ReactElement {
  const [hovered, setHovered] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const summaryRef = React.useRef<HTMLDivElement | null>(null)
  const labelsRef = React.useRef<HTMLDivElement | null>(null)

  const measure = React.useCallback(() => {
    const summary = summaryRef.current
    const labels = labelsRef.current
    const summaryOverflow = summary !== null && summary.scrollHeight > summary.clientHeight + 1
    const labelsOverflow = labels !== null && labels.scrollWidth > labels.clientWidth + 1
    setOverflowing(summaryOverflow || labelsOverflow)
  }, [])

  React.useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && cardRef.current !== null) {
      observer = new ResizeObserver(measure)
      observer.observe(cardRef.current)
    }
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [measure, alert.summary, alert.labels, expanded])

  const name = alert.name.trim() === '' ? alert.fingerprint : alert.name
  const displayName = name.trim() === '' ? alert.fingerprint : name
  const accent = severityColor(alert.severity)

  return (
    <div
      ref={cardRef}
      data-alert-key={selectionKey(alert)}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => {
        // 正文拖选文字时不切换选中态
        const selection = window.getSelection()
        if (selection !== null && selection.type === 'Range') return
        onToggle()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        boxSizing: 'border-box',
        borderRadius: radius.lg,
        background: tokens.bgLayer1,
        // 选中只改颜色：始终 1px，不叠加第二道描边，几何完全不变。
        border: `1px solid ${selected ? tokens.accent : hovered ? tokens.borderL3 : tokens.borderL2}`,
        boxShadow: tokens.shadowSoft,
        cursor: 'pointer',
        transition: 'border-color 120ms ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{ flex: 'none', width: 4, background: accent }}
      />

      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: space.sm,
          padding: space.md,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, minWidth: 0 }}>
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={t('card.aria.toggle', { name: displayName })}
            title={t('card.aria.toggle', { name: displayName })}
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            style={{
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              margin: 0,
              width: chipHeight,
              height: chipHeight,
              border: 'none',
              background: 'transparent',
              borderRadius: radius.pill,
              cursor: 'pointer',
            }}
          >
            <CheckCircle selected={selected} size={18} />
          </button>
          <Tag tone="outline" title={t('card.instance.title', { name: alert.instanceName })}>
            <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {alert.instanceName}
            </span>
          </Tag>
          <span
            style={{
              fontSize: bigger(2),
              fontWeight: 600,
              lineHeight: 1.4,
              color: tokens.labelPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {displayName || '—'}
          </span>
          <Tag tone={severityTone(alert.severity)} title={alert.severity}>
            {severityLabel(t, alert.severity)}
          </Tag>
          <Tag tone="neutral">{stateLabel(t, alert.state)}</Tag>
          {overflowing || expanded ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? t('card.aria.collapse', { name: displayName })
                  : t('card.aria.expand', { name: displayName })
              }
              onClick={(event) => {
                event.stopPropagation()
                onToggleExpand()
              }}
              style={{
                flex: 'none',
                marginLeft: 'auto',
                font: 'inherit',
                fontSize: tokens.fontSecondary,
                lineHeight: '18px',
                height: chipHeight,
                padding: `0 ${space.sm}px`,
                borderRadius: radius.sm,
                background: 'transparent',
                border: 'none',
                color: tokens.labelTertiary,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
              }}
            >
              {expanded ? t('card.collapse') : t('card.expand')}
            </button>
          ) : null}
        </div>

        <div
          ref={summaryRef}
          style={{
            fontSize: tokens.fontBase,
            lineHeight: 1.55,
            color: tokens.labelSecondary,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: expanded ? 'unset' : 2,
            WebkitBoxOrient: 'vertical',
            overflowWrap: 'anywhere',
          }}
        >
          {alert.summary || alert.description || t('card.summaryEmpty')}
        </div>

        <div style={{ minWidth: 0 }}>
          <LabelChips labels={alert.labels} wrap={false} t={t} measureRef={labelsRef} />
        </div>

        {expanded ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: space.sm,
              paddingTop: space.sm,
              borderTop: `1px solid ${rule}`,
              fontSize: tokens.fontSecondary,
              lineHeight: 1.7,
              color: tokens.labelSecondary,
            }}
          >
            {alert.generatorURL === '' ? null : (
              <div style={{ overflowWrap: 'anywhere' }}>
                <span style={{ color: tokens.labelPrimary, fontWeight: 600 }}>
                  {t('card.details.generator')}:{' '}
                </span>
                <a
                  href={alert.generatorURL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  style={{ color: tokens.accent }}
                >
                  {alert.generatorURL}
                </a>
              </div>
            )}
            <div>
              <div style={{ color: tokens.labelPrimary, fontWeight: 600, marginBottom: 3 }}>
                {t('card.details.labels')}
              </div>
              <LabelChips labels={alert.labels} wrap t={t} />
            </div>
            <div>
              <div style={{ color: tokens.labelPrimary, fontWeight: 600, marginBottom: 3 }}>
                {t('card.details.annotations')}
              </div>
              <AnnotationList annotations={alert.annotations} t={t} />
            </div>
            <div style={{ overflowWrap: 'anywhere' }}>
              <span style={{ color: tokens.labelPrimary, fontWeight: 600 }}>
                {t('card.details.fingerprint')}:{' '}
              </span>
              <code>{alert.fingerprint || t('card.details.none')}</code>
            </div>
            {alert.silencedBy.length === 0 ? null : (
              <div style={{ overflowWrap: 'anywhere' }}>
                <span style={{ color: tokens.labelPrimary, fontWeight: 600 }}>
                  {t('card.details.silenced')}:{' '}
                </span>
                <span>{alert.silencedBy.join(', ')}</span>
              </div>
            )}
            {alert.inhibitedBy.length === 0 ? null : (
              <div style={{ overflowWrap: 'anywhere' }}>
                <span style={{ color: tokens.labelPrimary, fontWeight: 600 }}>
                  {t('card.details.inhibited')}:{' '}
                </span>
                <span>{alert.inhibitedBy.join(', ')}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface DraftInstance {
  id: string
  name: string
  url: string
  authMode: AuthMode
  username: string
  secret: string
  insecureTls: boolean
  hasSecret: boolean
}

interface DraftErrors {
  name?: string
  url?: string
}

function toDrafts(settings: PublicSettings): DraftInstance[] {
  return settings.instances.map((instance) => ({
    id: instance.id,
    name: instance.name,
    url: instance.url,
    authMode: instance.authMode,
    username: instance.username,
    secret: '',
    insecureTls: instance.insecureTls,
    hasSecret: instance.hasSecret,
  }))
}

function validateDrafts(drafts: readonly DraftInstance[], t: Translate): Record<string, DraftErrors> {
  const errors: Record<string, DraftErrors> = {}
  const urlCounts = new Map<string, number>()
  for (const draft of drafts) {
    const url = draft.url.trim()
    if (url !== '') urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1)
  }
  for (const draft of drafts) {
    const next: DraftErrors = {}
    if (draft.name.trim() === '') next.name = t('settings.error.nameRequired')
    const url = draft.url.trim()
    if (url === '') next.url = t('settings.error.urlRequired')
    else if (parseHttpUrl(url) === null) next.url = t('settings.error.urlInvalid')
    else if ((urlCounts.get(url) ?? 0) > 1) next.url = t('settings.error.urlDuplicate')
    if (next.name !== undefined || next.url !== undefined) errors[draft.id] = next
  }
  return errors
}

function InstanceEditor({
  draft,
  index,
  t,
  errors,
  disabled,
  onChange,
  onRemove,
}: {
  draft: DraftInstance
  index: number
  t: Translate
  errors: DraftErrors | undefined
  disabled: boolean
  onChange: (patch: Partial<DraftInstance>) => void
  onRemove: () => void
}): React.ReactElement {
  const prefix = `dsh-alertmanager-instance-${index}`
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space.md,
        padding: space.md,
        border: `1px solid ${tokens.borderL2}`,
        borderRadius: radius.md,
        background: tokens.bgBase,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: tokens.fontBase, fontWeight: 600, color: tokens.labelPrimary }}>
            {t('settings.instanceIndex', { index: index + 1 })}
          </div>
          <div
            style={{
              fontSize: tokens.fontSecondary,
              lineHeight: '18px',
              color: tokens.labelTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {draft.url.trim() || t('settings.urlPlaceholder')}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={t('settings.deleteNamed', { name: draft.name.trim() || draft.url.trim() || t('settings.instanceIndex', { index: index + 1 }) })}
          title={t('settings.delete')}
          style={{
            ...secondaryButtonStyle,
            flex: 'none',
            color: tokens.error,
            boxShadow: `inset 0 0 0 ${tokens.hairline} ${tokens.error}`,
            border: 'none',
            background: 'transparent',
          }}
        >
          {t('settings.delete')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: space.md }}>
        <Field label={t('settings.name')} htmlFor={`${prefix}-name`} error={errors?.name}>
          <TextInput
            id={`${prefix}-name`}
            value={draft.name}
            disabled={disabled}
            placeholder={t('settings.namePlaceholder')}
            describedBy={errors?.name === undefined ? undefined : `${prefix}-name-error`}
            invalid={errors?.name !== undefined}
            onChange={(value) => onChange({ name: value })}
          />
        </Field>
        <Field label={t('settings.url')} htmlFor={`${prefix}-url`} error={errors?.url}>
          <TextInput
            id={`${prefix}-url`}
            value={draft.url}
            disabled={disabled}
            placeholder={t('settings.urlPlaceholder')}
            describedBy={errors?.url === undefined ? undefined : `${prefix}-url-error`}
            invalid={errors?.url !== undefined}
            onChange={(value) => onChange({ url: value })}
          />
        </Field>
      </div>

      <Field label={t('settings.auth')}>
        <Segmented
          ariaLabel={t('settings.auth')}
          value={draft.authMode}
          disabled={disabled}
          options={[
            { value: 'none', label: t('settings.authNone') },
            { value: 'basic', label: t('settings.authBasic') },
            { value: 'bearer', label: t('settings.authBearer') },
          ]}
          onChange={(value) => onChange({ authMode: value })}
        />
      </Field>

      {draft.authMode === 'basic' ? (
        <Field label={t('settings.username')} htmlFor={`${prefix}-username`}>
          <TextInput
            id={`${prefix}-username`}
            value={draft.username}
            disabled={disabled}
            autoComplete="username"
            onChange={(value) => onChange({ username: value })}
          />
        </Field>
      ) : null}

      {draft.authMode === 'none' ? null : (
        <Field
          label={draft.authMode === 'basic' ? t('settings.secretBasic') : t('settings.secretBearer')}
          htmlFor={`${prefix}-secret`}
        >
          <TextInput
            id={`${prefix}-secret`}
            value={draft.secret}
            type="password"
            disabled={disabled}
            autoComplete="off"
            placeholder={draft.hasSecret ? t('settings.secretKeep') : t('settings.secretNew')}
            onChange={(value) => onChange({ secret: value })}
          />
        </Field>
      )}

      <Switch
        checked={draft.insecureTls}
        disabled={disabled}
        label={t('settings.insecureTls')}
        onChange={(checked) => onChange({ insecureTls: checked })}
      />
    </div>
  )
}

export function SettingsDialog({
  settings,
  t,
  onClose,
  onSaved,
}: {
  settings: PublicSettings
  t: Translate
  onClose: () => void
  onSaved: (settings: PublicSettings) => void
}): React.ReactElement {
  const [drafts, setDrafts] = React.useState<DraftInstance[]>(() => toDrafts(settings))
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, DraftErrors>>({})
  const [error, setError] = React.useState('')
  /** 最近一次删除，可撤销（删除只是草稿级操作，保存前都能反悔）。 */
  const [undo, setUndo] = React.useState<{ draft: DraftInstance; index: number } | null>(null)

  // 弹窗打开期间 store 里的设置被别处更新时，若本地没有未保存改动则重建草稿。
  React.useEffect(() => {
    if (dirty) return
    setDrafts(toDrafts(settings))
  }, [settings, dirty])

  const update = (id: string, patch: Partial<DraftInstance>): void => {
    setDirty(true)
    // 改值后立即清掉该字段的就地错误，避免“改对了红字还在”
    setErrors((current) => {
      const forInstance = current[id]
      if (forInstance === undefined) return current
      const nextErrors: DraftErrors = { ...forInstance }
      let changed = false
      for (const key of Object.keys(patch) as Array<keyof DraftErrors>) {
        if (nextErrors[key] !== undefined) {
          delete nextErrors[key]
          changed = true
        }
      }
      if (!changed) return current
      return { ...current, [id]: nextErrors }
    })
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== id) return draft
        const next = { ...draft, ...patch }
        // 新建实例名称为空时，前端默认用 URL host 兜底。
        if (patch.url !== undefined && draft.name.trim() === '') {
          const host = defaultNameForUrl(patch.url)
          if (host !== '') next.name = host
        }
        return next
      }),
    )
  }

  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const confirmTimer = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current)
    },
    [],
  )

  const requestClose = (): void => {
    if (saving) return
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmDiscard(false), 4000)
      return
    }
    onClose()
  }

  const addInstance = (): void => {
    setDirty(true)
    setDrafts((current) => [
      ...current,
      {
        id: newDraftId(),
        name: '',
        url: '',
        authMode: 'none',
        username: '',
        secret: '',
        insecureTls: false,
        hasSecret: false,
      },
    ])
  }

  const removeInstance = (draft: DraftInstance): void => {
    setDirty(true)
    setDrafts((current) => {
      const index = current.findIndex((item) => item.id === draft.id)
      if (index < 0) return current
      setUndo({ draft, index })
      return current.filter((item) => item.id !== draft.id)
    })
  }

  const undoRemove = (): void => {
    if (undo === null) return
    setDirty(true)
    setDrafts((current) => {
      const next = [...current]
      next.splice(Math.min(undo.index, next.length), 0, undo.draft)
      return next
    })
    setUndo(null)
  }

  const save = async (): Promise<void> => {
    const nextErrors = validateDrafts(drafts, t)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSaving(true)
    setError('')
    try {
      const body = {
        instances: drafts.map((draft) => ({
          id: draft.id,
          name: draft.name.trim(),
          url: draft.url.trim(),
          authMode: draft.authMode,
          insecureTls: draft.insecureTls,
          ...(draft.authMode === 'basic' ? { username: draft.username.trim() } : {}),
          ...(draft.authMode !== 'none' ? { secret: draft.secret } : {}),
        })),
      }
      // 必须走 store：由 store 统一更新 settings/payload/计数，
      // 否则侧栏入口与面板都感知不到配置变化（删光实例后仍显示旧数据）。
      const saved = (await store.saveSettings(body)) as PublicSettings
      onSaved(saved)
    } catch (failure) {
      setError(localizeApiError(failure, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('settings.title')}
      closeLabel={t('settings.close')}
      onClose={requestClose}
      footer={
        <>
          <button type="button" style={secondaryButtonStyle} disabled={saving} onClick={requestClose}>
            {confirmDiscard ? t('settings.discardShort') : t('settings.cancel')}
          </button>
          <button
            type="button"
            style={primaryButtonStyle(saving)}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner size={13} /> : null}
            <span>{saving ? t('settings.saving') : t('settings.save')}</span>
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <span style={{ fontSize: tokens.fontSecondary, fontWeight: 600, color: tokens.labelSecondary }}>{t('settings.instances')}</span>
          <button type="button" style={secondaryButtonStyle} disabled={saving} onClick={addInstance}>
            {t('settings.add')}
          </button>
        </div>
        {undo === null ? null : (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              padding: `${space.sm}px ${space.md}px`,
              borderRadius: radius.sm,
              background: tokens.bgModule,
              color: tokens.labelSecondary,
              fontSize: tokens.fontSecondary,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              {t('settings.removed', { name: undo.draft.name.trim() || undo.draft.url.trim() || '—' })}
            </span>
            <button
              type="button"
              onClick={undoRemove}
              style={{
                ...secondaryButtonStyle,
                height: chipHeight,
                fontSize: tokens.fontSecondary,
              }}
            >
              {t('settings.undo')}
            </button>
          </div>
        )}
        {drafts.length === 0 ? (
          <div
            style={{
              padding: `${space.lg}px ${space.md}px`,
              border: `1px dashed ${tokens.borderL2}`,
              borderRadius: radius.md,
              textAlign: 'center',
              color: tokens.labelSecondary,
              fontSize: tokens.fontSecondary,
              lineHeight: 1.7,
            }}
          >
            {t('settings.empty')}
          </div>
        ) : (
          drafts.map((draft, index) => (
            <InstanceEditor
              key={draft.id}
              draft={draft}
              index={index}
              t={t}
              errors={errors[draft.id]}
              disabled={saving}
              onChange={(patch) => update(draft.id, patch)}
              onRemove={() => removeInstance(draft)}
            />
          ))
        )}
        {error === '' ? null : (
          <div
            role="alert"
            style={{
              color: tokens.error,
              background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #f25a5a) 10%, transparent)',
              borderRadius: radius.sm,
              padding: `${space.sm}px ${space.md}px`,
              fontSize: tokens.fontSecondary,
              lineHeight: '18px',
              overflowWrap: 'anywhere',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 页面级错误/空状态卡片。 */
function EmptyCard({
  title,
  body,
  action,
}: {
  title?: string
  body: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: `${space.xl + space.lg}px auto`,
        padding: space.xl,
        border: `1px solid ${tokens.borderL2}`,
        borderRadius: radius.lg,
        background: tokens.bgLayer1,
        display: 'flex',
        flexDirection: 'column',
        gap: space.md,
        textAlign: 'center',
        alignItems: 'center',
      }}
    >
      {title === undefined ? null : (
        <div style={{ fontSize: bigger(2), fontWeight: 600, color: tokens.labelPrimary }}>{title}</div>
      )}
      <div style={{ fontSize: tokens.fontBase, lineHeight: 1.7, color: tokens.labelSecondary }}>{body}</div>
      {action}
    </div>
  )
}

export function AlertmanagerPage(props: AlertmanagerPageProps): React.ReactElement {
  const { t } = props
  useLocaleRevision(props.locale)

  // 单一数据来源：store（侧栏入口与面板共享同一份状态）。
  const storeState = React.useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const settings = storeState.settings as PublicSettings | null
  const payload = storeState.payload as AlertsPayload | null
  const phase = storeState.phase
  const error = storeState.error
  const refreshing = storeState.manualLoading
  const cancelled = storeState.cancelled
  const lastRefreshAt = storeState.fetchedAt
  const intervalKey = storeState.intervalKey
  const nextRefreshAt = storeState.nextAt
  const selected = storeState.selected

  const [actionError, setActionError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [stateFilter, setStateFilter] = React.useState<StateFilter>('all')
  const [severityFilter, setSeverityFilter] = React.useState<'all' | SeverityKey>('all')
  const [instanceFilter, setInstanceFilter] = React.useState<string>('all')
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [dispatching, setDispatching] = React.useState(false)
  const [workspaceId, setWorkspaceId] = React.useState<string>(() => readLastWorkspace())
  const [, setClockTick] = React.useState(0)

  const source = props.workspaces.list
  const subscribe = React.useCallback((listener: () => void) => source.subscribe(listener), [source])
  const getSnapshot = React.useCallback(() => source.getSnapshot(), [source])
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const workspaces = snapshot.items

  // 面板挂载即确保有一次加载（若入口已经加载过则直接复用，不重复请求）。
  React.useEffect(() => {
    void store.bootstrap()
  }, [])

  // 页面重新可见时补一次刷新，并让 store 重新排程。
  React.useEffect(() => {
    const onVisibility = (): void => store.handleVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 倒计时显示需要按秒重渲染。
  React.useEffect(() => {
    if (nextRefreshAt === 0) return undefined
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 500)
    return () => window.clearInterval(timer)
  }, [nextRefreshAt])

  const countdown = nextRefreshAt === 0 ? 0 : Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000))

  // 工作区列表变化时保证下拉指向真实 id；默认沿用上次选择。
  React.useEffect(() => {
    setWorkspaceId((current) => {
      if (workspaces.length === 0) return ''
      if (workspaces.some((workspace) => workspace.workspaceId === current)) return current
      const saved = readLastWorkspace()
      const match = workspaces.find((workspace) => workspace.workspaceId === saved)
      return match?.workspaceId ?? workspaces[0].workspaceId
    })
  }, [workspaces])

  // 刷新后剔除已消失的选中项。
  React.useEffect(() => {
    if (payload === null) return
    const present = new Set(payload.alerts.map((alert) => selectionKey(alert)))
    store.updateSelected((current) => {
      const next = new Set([...current].filter((key) => present.has(key)))
      return next.size === current.size ? current : next
    })
  }, [payload])

  // 实例被删除后，实例筛选回到「全部」。
  React.useEffect(() => {
    if (payload === null) return
    if (instanceFilter !== 'all' && !payload.instances.some((instance) => instance.id === instanceFilter)) {
      setInstanceFilter('all')
    }
  }, [payload, instanceFilter])

  const cancelRefresh = (): void => {
    store.cancel()
  }

  const chooseInterval = (value: RefreshInterval): void => {
    store.setIntervalKey(value)
  }

  const chooseWorkspace = (id: string): void => {
    setWorkspaceId(id)
    writeLastWorkspace(id)
  }

  const toggleSelected = (alert: MergedAlert): void => {
    const key = selectionKey(alert)
    setNotice('')
    store.updateSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleExpanded = (alert: MergedAlert): void => {
    const key = selectionKey(alert)
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const saveSettings = (_saved: PublicSettings): void => {
    setSettingsOpen(false)
    setActionError('')
  }

  const dispatch = async (): Promise<void> => {
    if (selected.size === 0 || workspaceId === '') return
    const selections = [...selected]
      .map(parseSelectionKey)
      .filter((item): item is { instanceId: string; fingerprint: string } => item !== null)
    if (selections.length === 0) return
    setDispatching(true)
    setActionError('')
    setNotice('')
    try {
      const result = await api<{ sessionId: string }>('/dispatch', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, selections }),
      })
      store.updateSelected(() => new Set())
      void store.load({ manual: false })
      props.uiWorkspace.openSession(result.sessionId)
    } catch (failure) {
      if (isAuthError(failure)) {
        window.location.reload()
      } else {
        setActionError(localizeApiError(failure, t))
      }
    } finally {
      setDispatching(false)
    }
  }

  const query = search.trim().toLowerCase()
  const scoped =
    payload === null
      ? []
      : payload.alerts.filter((alert) => {
          if (stateFilter !== 'all' && alert.state !== stateFilter) return false
          if (instanceFilter !== 'all' && alert.instanceId !== instanceFilter) return false
          return true
        })
  const severityCounts: Record<SeverityKey, number> = { critical: 0, warning: 0, info: 0, other: 0 }
  for (const alert of scoped) severityCounts[severityKey(alert.severity)] += 1
  const filtered = scoped.filter((alert) => {
          if (severityFilter !== 'all' && severityKey(alert.severity) !== severityFilter) return false
          if (query === '') return true
          if (alert.name.toLowerCase().includes(query)) return true
          if (alert.instanceName.toLowerCase().includes(query)) return true
          for (const [key, value] of Object.entries(alert.labels)) {
            if (`${key}=${value}`.toLowerCase().includes(query)) return true
          }
          for (const [key, value] of Object.entries(alert.annotations)) {
            if (`${key}=${value}`.toLowerCase().includes(query)) return true
          }
          return false
        })

  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === workspaceId)
  const workspaceLabel =
    selectedWorkspace === undefined
      ? workspaces.length === 0
        ? t('workspace.empty')
        : t('workspace.placeholder')
      : selectedWorkspace.title || selectedWorkspace.path || selectedWorkspace.workspaceId
  const canDispatch = selected.size > 0 && workspaceId !== '' && !dispatching && workspaces.length > 0
  const statusText =
    payload === null
      ? phase === 'loading' || refreshing
        ? t('refresh.waiting')
        : t('refresh.never')
      : t('refresh.status', {
          time: formatClock(lastRefreshAt || payload.fetchedAt),
          instances: payload.instances.length,
          alerts: payload.alerts.length,
        }) + (countdown > 0 ? ` · ${t('refresh.countdown', { seconds: countdown })}` : '')

  const failedInstances: InstanceAlertsResult[] = payload?.instances.filter((instance) => !instance.ok) ?? []
  const instanceChips: Array<{ id: string; name: string; count: number }> =
    payload?.instances.map((instance) => ({ id: instance.id, name: instance.name, count: instance.alerts.length })) ??
    settings?.instances.map((instance: PublicInstance) => ({
      id: instance.id,
      name: instance.name,
      count: 0,
    })) ??
    []

  const openSettings = (): void => {
    if (settings !== null) setSettingsOpen(true)
  }

  const reloadPage = (): void => {
    window.location.reload()
  }

  const [settingsHover, settingsHoverEvents] = useHover()

  const header = (
    <header
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: space.md,
        padding: `${space.md}px ${space.lg}px`,
        borderBottom: `1px solid ${rule}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          role="group"
          aria-label={t('filter.aria.severity')}
          style={{ display: 'flex', alignItems: 'center', columnGap: space.sm, rowGap: space.xs + 2, flexWrap: 'wrap' }}
        >
          <h1 style={{ margin: 0, fontSize: bigger(4), fontWeight: 600, lineHeight: 1.4, color: tokens.labelPrimary }}>
            {t('panel.title')}
          </h1>
          {severityFilter === 'all' ? null : (
            <button
              type="button"
              onClick={() => setSeverityFilter('all')}
              style={{
                font: 'inherit',
                fontSize: tokens.fontSecondary,
                lineHeight: '18px',
                height: controlHeight - 4,
                padding: `0 ${space.sm + 2}px`,
                boxSizing: 'border-box',
                borderRadius: radius.pill,
                border: `1px solid ${rule}`,
                background: tokens.bgModule,
                color: tokens.labelSecondary,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('filter.state.all')}
            </button>
          )}
          {SEVERITY_KEYS.filter((key) => severityCounts[key] > 0 || severityFilter === key).map((key) => (
            <FilterChip
              key={key}
              label={t(`severity.${key}`)}
              count={severityCounts[key]}
              color={severityColor(key)}
              selected={severityFilter === key}
              onClick={() => setSeverityFilter(severityFilter === key ? 'all' : key)}
            />
          ))}
        </div>
        <div
          role="status"
          aria-live="polite"
          style={{ marginTop: space.xs, fontSize: tokens.fontBase, lineHeight: 1.6, color: tokens.labelSecondary }}
        >
          {statusText}
          {cancelled ? ` · ${t('refresh.cancelled')}` : ''}
          {phase === 'ready' && storeState.errorCode !== '' ? ` · ${t('refresh.errorHint')}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flex: 'none' }}>
        <RefreshControl
          refreshing={refreshing}
          intervalKey={intervalKey}
          t={t}
          onRefresh={() => void store.load({ manual: true })}
          onCancel={cancelRefresh}
          onIntervalChange={chooseInterval}
        />
        <button
          type="button"
          disabled={settings === null}
          onClick={openSettings}
          title={t('settings.title')}
          {...settingsHoverEvents}
          style={{
            ...secondaryButtonStyle,
            background: settingsHover && settings !== null ? tokens.bgHover : tokens.bgBase,
            color: settings === null ? tokens.labelTertiary : tokens.labelPrimary,
            cursor: settings === null ? 'not-allowed' : 'pointer',
          }}
        >
          <span>{t('settings.title')}</span>
        </button>
      </div>
    </header>
  )

  const footer = (
    <footer
      style={{
        flex: 'none',
        borderTop: `1px solid ${rule}`,
        background: tokens.bgLayer1,
        padding: `${space.md}px ${space.lg}px`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
        {actionError === '' ? null : (
          <div
            role="alert"
            aria-live="assertive"
            style={{ color: tokens.error, fontSize: tokens.fontBase, lineHeight: 1.6, overflowWrap: 'anywhere' }}
          >
            {actionError}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--dsh-content-font-size, 14px)', color: tokens.labelSecondary, flex: 'none' }}>
            {t('dispatch.selected', { count: selected.size })}
          </span>
          <Dropdown
            ariaLabel={t('dispatch.aria.workspace')}
            align="left"
            side="up"
            menuWidth={280}
            disabled={dispatching || workspaces.length === 0}
            items={workspaces.map((workspace) => ({
              key: workspace.workspaceId,
              label: workspace.title || workspace.path || workspace.workspaceId,
              selected: workspace.workspaceId === workspaceId,
              onSelect: () => chooseWorkspace(workspace.workspaceId),
            }))}
            trigger={({ open, toggle }) => (
              <button
                type="button"
                aria-label={t('dispatch.aria.workspace')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                disabled={dispatching || workspaces.length === 0}
                style={{
                  ...secondaryButtonStyle,
                  maxWidth: 280,
                  color: workspaces.length === 0 ? tokens.labelSecondary : tokens.labelPrimary,
                  cursor: dispatching || workspaces.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {workspaceLabel}
                </span>
                <ChevronIcon size={11} />
              </button>
            )}
          />
          {notice === '' ? null : (
            <span role="status" aria-live="polite" style={{ fontSize: tokens.fontSecondary, color: tokens.labelSecondary }}>
              {notice}
            </span>
          )}
          <button
            type="button"
            aria-label={t('dispatch.aria.submit')}
            style={{ ...primaryButtonStyle(!canDispatch || dispatching), marginLeft: 'auto' }}
            disabled={!canDispatch || dispatching}
            onClick={() => void dispatch()}
          >
            {dispatching ? <Spinner size={13} /> : null}
            <span>{dispatching ? t('dispatch.dispatching') : t('dispatch.button')}</span>
          </button>
        </div>
      </div>
    </footer>
  )

  let body: React.ReactNode
  if (phase === 'loading' && payload === null) {
    body = (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          padding: space.xl * 2,
          color: tokens.labelSecondary,
          fontSize: tokens.fontBase,
        }}
      >
        <Spinner size={16} />
        <span>{t('empty.loading')}</span>
      </div>
    )
  } else if (phase === 'unconfigured') {
    body = (
      <EmptyCard
        title={t('empty.unconfiguredTitle')}
        body={t('empty.unconfiguredBody')}
        action={
          <button type="button" style={primaryButtonStyle(false)} onClick={openSettings}>
            {t('empty.addInstance')}
          </button>
        }
      />
    )
  } else if (phase === 'error') {
    const auth = isAuthError(error)
    const message =
      error instanceof ApiError && error.code === 'aborted' ? t('refresh.cancelled') : localizeApiError(error, t)
    body = (
      <EmptyCard
        body={message}
        action={
          auth ? (
            <button type="button" style={primaryButtonStyle(false)} onClick={reloadPage}>
              {t('error.auth.reload')}
            </button>
          ) : (
            <button type="button" style={secondaryButtonStyle} onClick={() => void store.bootstrap()}>
              {t('common.retry')}
            </button>
          )
        }
      />
    )
  } else {
    body = (
      <>
        <div
          style={{
            flex: 'none',
            padding: `${space.md}px ${space.lg}px`,
            borderBottom: `1px solid ${rule}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: 140 }}>
                <TextInput
                  value={search}
                  ariaLabel={t('filter.searchAria')}
                  placeholder={t('filter.search')}
                  onChange={setSearch}
                />
              </div>
              <div role="group" aria-label={t('filter.aria.state')} style={{ display: 'flex', gap: space.xs + 2, flexWrap: 'wrap' }}>
                {(['all', 'active', 'suppressed', 'unprocessed'] as const).map((value) => (
                  <FilterChip
                    key={value}
                    label={t(`filter.state.${value}`)}
                    selected={stateFilter === value}
                    onClick={() => setStateFilter(value)}
                  />
                ))}
              </div>
              <span
                aria-hidden="true"
                style={{ width: 1, height: 18, background: rule, flex: 'none' }}
              />
              <div role="group" aria-label={t('filter.aria.instance')} style={{ display: 'flex', gap: space.xs + 2, flexWrap: 'wrap' }}>
                <FilterChip
                  label={t('filter.instance.all')}
                  selected={instanceFilter === 'all'}
                  onClick={() => setInstanceFilter('all')}
                />
                {instanceChips.map((instance) => (
                  <FilterChip
                    key={instance.id}
                    label={instance.name}
                    count={instance.count}
                    selected={instanceFilter === instance.id}
                    onClick={() => setInstanceFilter(instance.id)}
                  />
                ))}
              </div>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: tokens.fontSecondary,
                  color: tokens.labelTertiary,
                  flex: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {t('filter.count', { count: filtered.length })}
              </span>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ padding: space.lg, boxSizing: 'border-box' }}>
            {failedInstances.length === 0 ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, marginBottom: space.md }}>
                {failedInstances.map((instance) => (
                  <div
                    key={instance.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: space.sm,
                      padding: `${space.sm}px ${space.md}px`,
                      border: `1px solid ${rule}`,
                      borderRadius: radius.sm,
                      background: tokens.bgModule,
                      fontSize: tokens.fontSecondary,
                      lineHeight: 1.5,
                      color: tokens.labelSecondary,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {t('error.instance', { name: instance.name })}
                    </span>
                    {instance.error === undefined ? null : (
                      <span
                        title={instance.error}
                        style={{
                          flex: '0 1 320px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: tokens.labelSecondary,
                        }}
                      >
                        {localizeInstanceError(t, instance)}
                      </span>
                    )}
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, fontSize: tokens.fontSecondary }}
                      onClick={() => void store.load({ manual: true })}
                    >
                      {t('error.instanceRetry')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              payload !== null && payload.alerts.length === 0 && failedInstances.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: space.sm,
                    padding: `${space.xl * 2}px 0`,
                    color: tokens.labelPrimary,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: tokens.successSoft,
                      color: tokens.success,
                    }}
                  >
                    <CheckIcon size={20} />
                  </span>
                  <div style={{ fontSize: bigger(1), fontWeight: 600 }}>{t('empty.allClear')}</div>
                  <div style={{ fontSize: tokens.fontSecondary, color: tokens.labelTertiary }}>
                    {t('empty.allClearHint')}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: `${space.xl * 2}px 0`,
                    textAlign: 'center',
                    fontSize: tokens.fontBase,
                    color: tokens.labelSecondary,
                  }}
                >
                  {payload !== null && payload.alerts.length === 0 ? t('empty.noAlerts') : t('empty.noMatch')}
                </div>
              )
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))',
                  alignItems: 'start',
                  gap: 12,
                }}
              >
                {filtered.map((alert) => {
                  const key = selectionKey(alert)
                  return (
                    <AlertCard
                      key={key}
                      alert={alert}
                      t={t}
                      selected={selected.has(key)}
                      expanded={expanded.has(key)}
                      onToggle={() => toggleSelected(alert)}
                      onToggleExpand={() => toggleExpanded(alert)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        color: tokens.labelPrimary,
        fontSize: 'var(--dsh-content-font-size, 14px)',
        background: 'transparent',
      }}
    >
      {header}
      {body}
      {footer}
      {settingsOpen && settings !== null ? (
        <SettingsDialog settings={settings} t={t} onClose={() => setSettingsOpen(false)} onSaved={saveSettings} />
      ) : null}
    </div>
  )
}
