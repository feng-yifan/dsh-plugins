/**
 * dsh-alertmanager · 浏览器半侧「告警」主面板
 *
 * 纯 React + 内联样式，不写 DOM、不引第三方 UI 库；颜色/边框/圆角只用 DSH
 * 的 `--dsw-alias-*` / `--dsw-radius-*` 主题令牌。
 */
import React from 'react'

const API = '/_dsh/alertmanager'
const MAX_SELECTED = 20
const LAST_WORKSPACE_KEY = 'dsh-alertmanager/last-workspace'

type AlertState = 'active' | 'suppressed' | 'unprocessed'
type Phase = 'loading' | 'unconfigured' | 'error' | 'ready'

interface AlertItem {
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

interface AlertsPayload {
  fetchedAt: string
  alerts: AlertItem[]
  stats: { total: number; active: number; suppressed: number }
}

interface PublicSettings {
  url: string
  authMode: 'none' | 'basic' | 'bearer'
  username: string
  hasSecret: boolean
  insecureTls: boolean
  refreshSeconds: number
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
}

class ApiError extends Error {
  readonly sessionId?: string

  constructor(message: string, sessionId?: string) {
    super(message)
    this.name = 'ApiError'
    this.sessionId = sessionId
  }
}

const colors = {
  primary: 'var(--dsw-alias-label-primary, #101828)',
  secondary: 'var(--dsw-alias-label-secondary, #667085)',
  tertiary: 'var(--dsw-alias-label-tertiary, #98a2b3)',
  border: 'var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.08))',
  radius: 'var(--dsw-radius-md, 8px)',
  error: 'var(--dsw-alias-state-error-primary, #b42318)',
} as const

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    color: colors.primary,
    fontSize: 13,
    background: 'transparent',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    padding: '16px 16px 12px',
    borderBottom: `1px solid ${colors.border}`,
    flex: 'none',
  },
  title: { fontSize: 16, fontWeight: 600, margin: 0, lineHeight: 1.4 },
  muted: { color: colors.secondary, fontSize: 12, lineHeight: 1.6 },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none' },
  button: {
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.4,
    color: colors.primary,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: colors.radius,
    padding: '5px 10px',
    cursor: 'pointer',
  },
  primaryButton: {
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.4,
    color: colors.primary,
    background: 'transparent',
    border: `1px solid ${colors.primary}`,
    borderRadius: colors.radius,
    padding: '5px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  input: {
    font: 'inherit',
    fontSize: 13,
    color: colors.primary,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: colors.radius,
    padding: '6px 9px',
    width: '100%',
    boxSizing: 'border-box',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderBottom: `1px solid ${colors.border}`,
    flex: 'none',
  },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 12px' },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 4px',
    borderBottom: `1px solid ${colors.border}`,
    cursor: 'pointer',
  },
  checkbox: { marginTop: 3, flex: 'none' },
  dot: { width: 8, height: 8, borderRadius: 999, marginTop: 6, flex: 'none' },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  rowTitle: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { fontWeight: 600, overflowWrap: 'anywhere' },
  severity: { color: colors.tertiary, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' },
  summary: { color: colors.secondary, fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  chip: {
    fontSize: 11,
    color: colors.tertiary,
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    padding: '0 6px',
    lineHeight: '17px',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: { color: colors.tertiary, fontSize: 11, flex: 'none', marginTop: 3, whiteSpace: 'nowrap' },
  details: {
    padding: '2px 4px 12px 32px',
    borderBottom: `1px solid ${colors.border}`,
    color: colors.secondary,
    fontSize: 12,
    lineHeight: 1.7,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    overflowWrap: 'anywhere',
  },
  detailsTitle: { color: colors.primary, fontWeight: 600 },
  link: { color: 'var(--dsw-alias-link, #175cd3)' },
  footer: {
    flex: 'none',
    borderTop: `1px solid ${colors.border}`,
    padding: '10px 16px 12px',
    background: 'transparent',
  },
  footerRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  footerCount: { color: colors.secondary, fontSize: 12, flex: 'none' },
  workspaceSelect: {
    font: 'inherit',
    fontSize: 12,
    color: colors.primary,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: colors.radius,
    padding: '5px 8px',
    maxWidth: 280,
    minWidth: 140,
    flex: '0 1 280px',
  },
  error: { color: colors.error, fontSize: 12, lineHeight: 1.6, marginBottom: 6, overflowWrap: 'anywhere' },
  notice: { color: colors.secondary, fontSize: 12, marginLeft: 'auto' },
  empty: { color: colors.tertiary, fontSize: 12, padding: '32px 0', textAlign: 'center' },
  form: {
    margin: '12px 16px 16px',
    border: `1px solid ${colors.border}`,
    borderRadius: colors.radius,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { color: colors.secondary, fontSize: 12 },
  formRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 6, color: colors.secondary, fontSize: 12 },
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const requestHeaders: Record<string, string> =
    init?.body === undefined ? {} : { 'content-type': 'application/json' }
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { ...requestHeaders, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  if (text !== '') {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = {}
    }
  }
  if (!response.ok) {
    const message = typeof data.error === 'string' && data.error !== '' ? data.error : `HTTP ${response.status}`
    throw new ApiError(message, typeof data.sessionId === 'string' ? data.sessionId : undefined)
  }
  return data as T
}

function formatTime(value: string): string {
  if (value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'var(--dsw-alias-state-error-primary, #d92d20)'
    case 'warning':
      return 'var(--dsw-alias-state-warn-primary, #dc6803)'
    case 'info':
      return 'var(--dsw-alias-state-business-primary, #1570ef)'
    default:
      return 'var(--dsw-alias-label-tertiary, #98a2b3)'
  }
}

function stateLabel(state: AlertState): string {
  if (state === 'active') return '活跃'
  if (state === 'suppressed') return '抑制'
  return '未处理'
}

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
    /* 隐私模式等场景下 localStorage 可能不可写，忽略即可。 */
  }
}

interface SettingsFormProps {
  initial: PublicSettings
  submitLabel: string
  onSaved: (settings: PublicSettings) => void
  onCancel?: () => void
}

function SettingsForm({ initial, submitLabel, onSaved, onCancel }: SettingsFormProps): React.ReactElement {
  const [url, setUrl] = React.useState(initial.url)
  const [authMode, setAuthMode] = React.useState<PublicSettings['authMode']>(initial.authMode)
  const [username, setUsername] = React.useState(initial.username)
  const [secret, setSecret] = React.useState('')
  const [insecureTls, setInsecureTls] = React.useState(initial.insecureTls)
  const [refreshSeconds, setRefreshSeconds] = React.useState(String(initial.refreshSeconds))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const saved = await api<PublicSettings>('/settings', {
        method: 'POST',
        body: JSON.stringify({
          url,
          authMode,
          username,
          secret,
          insecureTls,
          refreshSeconds: Number(refreshSeconds),
        }),
      })
      setSecret('')
      onSaved(saved)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.form}>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="dsh-alertmanager-url">
          AlertManager 地址
        </label>
        <input
          id="dsh-alertmanager-url"
          style={styles.input}
          value={url}
          placeholder="https://alertmanager.example.com"
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label} htmlFor="dsh-alertmanager-auth">
          鉴权方式
        </label>
        <select
          id="dsh-alertmanager-auth"
          style={styles.input}
          value={authMode}
          onChange={(event) => setAuthMode(event.target.value as PublicSettings['authMode'])}
        >
          <option value="none">无</option>
          <option value="basic">Basic</option>
          <option value="bearer">Bearer</option>
        </select>
      </div>
      {authMode === 'basic' ? (
        <div style={styles.field}>
          <label style={styles.label} htmlFor="dsh-alertmanager-username">
            用户名
          </label>
          <input
            id="dsh-alertmanager-username"
            style={styles.input}
            value={username}
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
      ) : null}
      {authMode === 'none' ? null : (
        <div style={styles.field}>
          <label style={styles.label} htmlFor="dsh-alertmanager-secret">
            {authMode === 'basic' ? '口令' : 'Token'}
          </label>
          <input
            id="dsh-alertmanager-secret"
            style={styles.input}
            type="password"
            value={secret}
            autoComplete="off"
            placeholder="留空表示保留已保存的值"
            onChange={(event) => setSecret(event.target.value)}
          />
        </div>
      )}
      <div style={styles.formRow}>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={insecureTls}
            onChange={(event) => setInsecureTls(event.target.checked)}
          />
          忽略 TLS 证书校验
        </label>
        <label style={styles.checkboxLabel} htmlFor="dsh-alertmanager-refresh">
          刷新间隔（秒）
          <input
            id="dsh-alertmanager-refresh"
            style={{ ...styles.input, width: 72 }}
            type="number"
            min={5}
            max={300}
            value={refreshSeconds}
            onChange={(event) => setRefreshSeconds(event.target.value)}
          />
        </label>
      </div>
      {error !== '' ? <div style={styles.error}>{error}</div> : null}
      <div style={styles.formRow}>
        <button style={styles.primaryButton} type="button" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : submitLabel}
        </button>
        {onCancel !== undefined ? (
          <button style={styles.button} type="button" disabled={saving} onClick={onCancel}>
            取消
          </button>
        ) : null}
      </div>
    </div>
  )
}

function LabelChips({ labels, limit }: { labels: Record<string, string>; limit?: number }): React.ReactElement {
  const entries = Object.entries(labels)
  const shown = limit === undefined ? entries : entries.slice(0, limit)
  if (shown.length === 0) return <span style={styles.muted}>（无标签）</span>
  return (
    <span style={styles.chips}>
      {shown.map(([key, value]) => (
        <span key={key} style={styles.chip} title={`${key}=${value}`}>
          {key}={value}
        </span>
      ))}
      {limit !== undefined && entries.length > shown.length ? (
        <span style={styles.chip}>+{entries.length - shown.length}</span>
      ) : null}
    </span>
  )
}

export function AlertmanagerPage(props: AlertmanagerPageProps): React.ReactElement {
  const [settings, setSettings] = React.useState<PublicSettings | null>(null)
  const [alerts, setAlerts] = React.useState<AlertsPayload | null>(null)
  const [phase, setPhase] = React.useState<Phase>('loading')
  const [error, setError] = React.useState('')
  const [actionError, setActionError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [stateFilter, setStateFilter] = React.useState<'all' | AlertState>('all')
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [dispatching, setDispatching] = React.useState(false)
  const [workspaceId, setWorkspaceId] = React.useState<string>(() => readLastWorkspace())
  const inFlight = React.useRef(false)

  const source = props.workspaces.list
  const subscribe = React.useCallback((listener: () => void) => source.subscribe(listener), [source])
  const getSnapshot = React.useCallback(() => source.getSnapshot(), [source])
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const workspaces = snapshot.items

  const loadAlerts = React.useCallback(async (options?: { quiet?: boolean }): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const payload = await api<AlertsPayload>('/alerts')
      setAlerts(payload)
      setError('')
      setPhase('ready')
    } catch (failure) {
      if (options?.quiet === true) setActionError(errorMessage(failure))
      else {
        setError(errorMessage(failure))
        setPhase('error')
      }
    } finally {
      inFlight.current = false
    }
  }, [])

  const bootstrap = React.useCallback(async (): Promise<void> => {
    setPhase('loading')
    setError('')
    setActionError('')
    try {
      const current = await api<PublicSettings>('/settings')
      setSettings(current)
      if (current.url === '') {
        setAlerts(null)
        setSettingsOpen(true)
        setPhase('unconfigured')
        return
      }
      await loadAlerts()
    } catch (failure) {
      setError(errorMessage(failure))
      setPhase('error')
    }
  }, [loadAlerts])

  React.useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // 按 refreshSeconds 自动刷新；请求进行中由 loadAlerts 内部去重，卸载时清计时器。
  React.useEffect(() => {
    if (phase !== 'ready' || settings === null) return
    const seconds = Math.min(300, Math.max(5, settings.refreshSeconds || 30))
    const timer = window.setInterval(() => {
      void loadAlerts({ quiet: true })
    }, seconds * 1000)
    return () => window.clearInterval(timer)
  }, [phase, settings, loadAlerts])

  // 工作区列表变化时，保证下拉框指向一个真实存在的 id；默认沿用 localStorage 里的上次选择。
  React.useEffect(() => {
    setWorkspaceId((current) => {
      if (workspaces.length === 0) return ''
      if (workspaces.some((workspace) => workspace.workspaceId === current)) return current
      const saved = readLastWorkspace()
      const match = workspaces.find((workspace) => workspace.workspaceId === saved)
      return match?.workspaceId ?? workspaces[0].workspaceId
    })
  }, [workspaces])

  // 刷新后把已消失的告警从选择里剔除，避免吸底栏计数与实际列表脱节。
  React.useEffect(() => {
    if (alerts === null) {
      setSelected(new Set())
      return
    }
    const present = new Set(alerts.alerts.map((alert) => alert.fingerprint))
    setSelected((current) => {
      const next = new Set([...current].filter((fingerprint) => present.has(fingerprint)))
      return next.size === current.size ? current : next
    })
  }, [alerts])

  const chooseWorkspace = (id: string): void => {
    setWorkspaceId(id)
    writeLastWorkspace(id)
  }

  const toggleSelected = (fingerprint: string): void => {
    setNotice('')
    if (!selected.has(fingerprint) && selected.size >= MAX_SELECTED) {
      setNotice(`最多同时处理 ${MAX_SELECTED} 条告警`)
      return
    }
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(fingerprint)) next.delete(fingerprint)
      else next.add(fingerprint)
      return next
    })
  }

  const toggleExpanded = (fingerprint: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(fingerprint)) next.delete(fingerprint)
      else next.add(fingerprint)
      return next
    })
  }

  const saveSettings = async (saved: PublicSettings): Promise<void> => {
    setSettings(saved)
    setSettingsOpen(false)
    setActionError('')
    if (saved.url === '') {
      setAlerts(null)
      setPhase('unconfigured')
      return
    }
    setPhase('loading')
    await loadAlerts()
  }

  const dispatch = async (): Promise<void> => {
    if (selected.size === 0 || workspaceId === '') return
    setDispatching(true)
    setActionError('')
    setNotice('')
    try {
      const result = await api<{ sessionId: string }>('/dispatch', {
        method: 'POST',
        body: JSON.stringify({ fingerprints: [...selected], workspaceId }),
      })
      setSelected(new Set())
      await loadAlerts({ quiet: true })
      props.uiWorkspace.openSession(result.sessionId)
    } catch (failure) {
      const suffix =
        failure instanceof ApiError && failure.sessionId !== undefined
          ? `（会话 ${failure.sessionId}）`
          : ''
      setActionError(`${errorMessage(failure)}${suffix}`)
    } finally {
      setDispatching(false)
    }
  }

  const query = search.trim().toLowerCase()
  const filtered =
    alerts === null
      ? []
      : alerts.alerts.filter((alert) => {
          if (stateFilter !== 'all' && alert.state !== stateFilter) return false
          if (query === '') return true
          if (alert.name.toLowerCase().includes(query)) return true
          if (alert.fingerprint.toLowerCase().includes(query)) return true
          for (const [key, value] of Object.entries(alert.labels)) {
            if (`${key}=${value}`.toLowerCase().includes(query)) return true
          }
          for (const [key, value] of Object.entries(alert.annotations)) {
            if (`${key}=${value}`.toLowerCase().includes(query)) return true
          }
          return false
        })

  const atLimit = selected.size >= MAX_SELECTED
  const canDispatch = selected.size > 0 && workspaceId !== '' && !dispatching && workspaces.length > 0

  const header = (
    <header style={styles.header}>
      <div>
        <h2 style={styles.title}>AlertManager</h2>
        <div style={styles.muted}>
          {alerts === null
            ? '尚未拉取告警'
            : `上次刷新：${formatTime(alerts.fetchedAt)} · 共 ${alerts.stats.total} 条，活跃 ${alerts.stats.active} 条`}
        </div>
      </div>
      <div style={styles.actions}>
        <button
          type="button"
          style={styles.button}
          disabled={phase === 'loading' || settings === null || settings.url === ''}
          onClick={() => void loadAlerts()}
        >
          刷新
        </button>
        <button
          type="button"
          style={styles.button}
          onClick={() => setSettingsOpen((open) => !open)}
          disabled={settings === null && phase !== 'unconfigured'}
        >
          设置
        </button>
      </div>
    </header>
  )

  if (phase === 'loading') {
    return (
      <div style={styles.root}>
        {header}
        <div style={styles.empty}>正在读取 AlertManager…</div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={styles.root}>
        {header}
        <div style={{ ...styles.empty, color: colors.error }}>{error}</div>
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 24 }}>
          <button type="button" style={styles.button} onClick={() => void bootstrap()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'unconfigured' || settings === null) {
    return (
      <div style={styles.root}>
        {header}
        <div style={{ ...styles.muted, padding: '16px 16px 0' }}>
          填写 AlertManager 地址后，这里会列出实时告警。设置保存在 DSH 凭据服务里，口令/token 不会回传给浏览器。
        </div>
        <SettingsForm
          initial={settings ?? {
            url: '',
            authMode: 'none',
            username: '',
            hasSecret: false,
            insecureTls: false,
            refreshSeconds: 30,
          }}
          submitLabel="保存并连接"
          onSaved={(saved) => void saveSettings(saved)}
        />
      </div>
    )
  }

  return (
    <div style={styles.root}>
      {header}
      {settingsOpen ? (
        <SettingsForm
          initial={settings}
          submitLabel="保存"
          onSaved={(saved) => void saveSettings(saved)}
          onCancel={() => setSettingsOpen(false)}
        />
      ) : null}
      <div style={styles.toolbar}>
        <input
          style={{ ...styles.input, flex: 1, minWidth: 120 }}
          value={search}
          placeholder="搜索告警名、标签或注解"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          style={{ ...styles.workspaceSelect, flex: 'none', minWidth: 92, maxWidth: 120 }}
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value as 'all' | AlertState)}
        >
          <option value="all">全部</option>
          <option value="active">活跃</option>
          <option value="suppressed">抑制</option>
          <option value="unprocessed">未处理</option>
        </select>
        <span style={{ ...styles.muted, flex: 'none' }}>{filtered.length} 条</span>
      </div>
      <div style={styles.list}>
        {filtered.length === 0 ? (
          <div style={styles.empty}>{alerts !== null && alerts.alerts.length === 0 ? '当前没有告警' : '没有匹配的告警'}</div>
        ) : (
          filtered.map((alert, index) => {
            const isSelected = selected.has(alert.fingerprint)
            const isExpanded = expanded.has(alert.fingerprint)
            const key = `${alert.fingerprint}-${index}`
            return (
              <React.Fragment key={key}>
                <div style={styles.row} onClick={() => toggleExpanded(alert.fingerprint)}>
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    aria-label={`选择告警 ${alert.name || alert.fingerprint}`}
                    checked={isSelected}
                    disabled={!isSelected && atLimit}
                    onChange={() => toggleSelected(alert.fingerprint)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <span
                    style={{ ...styles.dot, background: severityColor(alert.severity) }}
                    aria-hidden="true"
                    title={alert.severity || '未知严重度'}
                  />
                  <div style={styles.rowMain}>
                    <div style={styles.rowTitle}>
                      <span style={styles.name}>{alert.name || alert.fingerprint || '未命名告警'}</span>
                      {alert.severity !== '' ? <span style={styles.severity}>{alert.severity}</span> : null}
                      <span style={{ ...styles.severity, textTransform: 'none' }}>{stateLabel(alert.state)}</span>
                    </div>
                    <div style={styles.summary}>{alert.summary || alert.description || '（无摘要）'}</div>
                    <LabelChips labels={alert.labels} limit={4} />
                  </div>
                  <span style={styles.time}>{formatTime(alert.startsAt)}</span>
                </div>
                {isExpanded ? (
                  <div style={styles.details}>
                    <div>
                      <span style={styles.detailsTitle}>全部标签：</span>
                      <LabelChips labels={alert.labels} />
                    </div>
                    <div>
                      <span style={styles.detailsTitle}>全部注解：</span>
                      {Object.keys(alert.annotations).length === 0 ? (
                        '（无）'
                      ) : (
                        Object.entries(alert.annotations)
                          .sort(([left], [right]) => left.localeCompare(right))
                          .map(([key, value]) => (
                            <div key={key}>
                              {key}：{value}
                            </div>
                          ))
                      )}
                    </div>
                    {alert.generatorURL !== '' ? (
                      <div>
                        <span style={styles.detailsTitle}>来源：</span>
                        <a
                          href={alert.generatorURL}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.link}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {alert.generatorURL}
                        </a>
                      </div>
                    ) : null}
                    <div>
                      <span style={styles.detailsTitle}>指纹：</span>
                      <code>{alert.fingerprint || '（无）'}</code>
                    </div>
                    {alert.silencedBy.length > 0 ? (
                      <div>
                        <span style={styles.detailsTitle}>静默：</span>
                        {alert.silencedBy.join(', ')}
                      </div>
                    ) : null}
                    {alert.inhibitedBy.length > 0 ? (
                      <div>
                        <span style={styles.detailsTitle}>被抑制：</span>
                        {alert.inhibitedBy.join(', ')}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </React.Fragment>
            )
          })
        )}
      </div>
      <footer style={styles.footer}>
        {actionError !== '' ? <div style={styles.error}>{actionError}</div> : null}
        <div style={styles.footerRow}>
          <span style={styles.footerCount}>已选 {selected.size}/{MAX_SELECTED}</span>
          <select
            style={styles.workspaceSelect}
            value={workspaceId}
            disabled={dispatching || workspaces.length === 0}
            aria-label="选择工作区"
            onChange={(event) => chooseWorkspace(event.target.value)}
          >
            {workspaces.length === 0 ? (
              <option value="">无可用工作区</option>
            ) : (
              workspaces.map((workspace) => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.title || workspace.path || workspace.workspaceId}
                </option>
              ))
            )}
          </select>
          {notice !== '' ? <span style={styles.notice}>{notice}</span> : null}
          <button
            type="button"
            style={{ ...styles.primaryButton, marginLeft: notice === '' ? 'auto' : 0 }}
            disabled={!canDispatch}
            onClick={() => void dispatch()}
          >
            {dispatching ? '处理中…' : '在所选工作区处理'}
          </button>
        </div>
      </footer>
    </div>
  )
}
