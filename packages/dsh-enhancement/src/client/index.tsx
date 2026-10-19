/**
 * dsh-enhancement 浏览器半侧：插件管理页（设置 → 插件 → dsh-enhancement）配置卡。
 *
 * Phase 1 只提供网关基础配置：启用、监听网卡/端口、访问密码、会话天数、登录节流。
 * HTTPS / PWA / 通知 / 推送在后续阶段追加到同一张卡。
 */
import React, { useCallback, useEffect, useState } from 'react'

const API = '/_dsh/enhancement'

interface InterfaceInfo {
  name: string
  address: string
  family: string
  internal: boolean
}

interface TlsCertInfo {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  fingerprint256: string
  subjectAltName: string
}

interface TlsStatus {
  mode: 'off' | 'uploaded' | 'ca' | 'selfsigned'
  hostnames: string[]
  cert: TlsCertInfo | null
  caAvailable: boolean
  caInfo: TlsCertInfo | null
  uploadedCaAvailable: boolean
  uploadedCaInfo: TlsCertInfo | null
}

interface SessionHeaderStatus {
  enabled: boolean
  headerName: string
  patched: number
  adapterCount: number
  reason: 'ok' | 'no-adapters' | 'no-pi-ai-adapter' | 'llm-unavailable'
  lastError: string | null
}

interface PushStatus {
  enabled: boolean
  publicKey: string | null
  subscriptions: number
  subject: string
}

interface NotifyStatus {
  enabled: boolean
  task: boolean
  ask: boolean
  approval: boolean
  denied: boolean
  subagent: boolean
  goal: boolean
  jobs: boolean
}

interface PwaStatus {
  enabled: boolean
  name: string
  shortName: string
  display: 'standalone' | 'fullscreen' | 'minimal-ui'
  themeColor: string
  backgroundColor: string
  customIcons: string[]
  error: string | null
}

interface Status {
  enabled: boolean
  running: boolean
  bindHost: string
  port: number
  url: string | null
  httpsMode: string
  passwordSet: boolean
  sessionDays: number
  loginThrottle: boolean
  dshSecretReady: boolean
  dshHost: string
  dshOrigin: string
  dshAccessUrl: string
  interfaces: InterfaceInfo[]
  stateDir: string
  statePath: string
  error: string | null
  https: TlsStatus
  pwa: PwaStatus
  notify: NotifyStatus
  push: PushStatus
  sessionHeader: SessionHeaderStatus
}

interface ClientContext {
  uiWorkspace?: { openSession(sessionId: string): void }
  effect(callback: () => void | (() => void), label?: string): void
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: React.ComponentType<Record<string, unknown>>): () => void
  }
}

export const inject = ['slots', 'uiWorkspace']

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T)
  if (!response.ok) throw new Error((data as { error?: string }).error || `HTTP ${response.status}`)
  return data as T
}

async function readBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function readText(file: File | null): Promise<string> {
  if (!file) return ''
  return await file.text()
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

function isVirtualInterface(name: string): boolean {
  return /^(veth|cni|flannel|docker|br-|virbr|podman|Mihomo|tun|tap)/i.test(name)
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 13 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 15, fontWeight: 600, margin: 0 },
  muted: { color: 'var(--dsw-alias-label-secondary, #667085)', fontSize: 12, lineHeight: 1.6 },
  card: { borderTop: '1px solid var(--dsw-alias-border-l4, rgba(0,0,0,.08))', padding: '16px 0 8px', display: 'flex', flexDirection: 'column', gap: 6, background: 'transparent' },
  blockHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  dirty: { flex: 'none', fontSize: 11, lineHeight: '18px', padding: '1px 8px', borderRadius: 999, color: 'var(--dsw-alias-state-warning-primary, #b54708)', background: 'var(--dsw-alias-state-warning-bg, rgba(247,144,9,.12))', border: '.5px solid var(--dsw-alias-state-warning-primary-a30, rgba(181,71,8,.3))' },
  subhead: { margin: '14px 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' },
  row: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' },
  label: { color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 13, fontWeight: 500 },
  blockTitle: { color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 16, fontWeight: 600, lineHeight: '24px' },
  iconButton: { width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 8, border: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16))', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #475467)', cursor: 'pointer', flex: 'none' },
  input: { width: '100%', height: 34, borderRadius: 'var(--dsw-radius-md, 12px)', border: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16))', background: 'var(--dsw-alias-bg-layer-3, #fff)', color: 'var(--dsw-alias-label-primary, inherit)', padding: '0 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', height: 34, borderRadius: 'var(--dsw-radius-md, 12px)', border: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16))', backgroundColor: 'var(--dsw-alias-bg-layer-3, #fff)', color: 'var(--dsw-alias-label-primary, inherit)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 4 },
  button: { height: 32, padding: '0 14px', borderRadius: 'var(--dsw-radius-md, 12px)', border: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16))', background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)', cursor: 'pointer', fontSize: 13 },
  primary: { background: 'var(--dsw-alias-state-business-primary, #4d8dff)', borderColor: 'transparent', color: '#fff', fontWeight: 600 },
  danger: { color: 'var(--dsw-alias-state-danger-primary, #d92d20)' },
  pill: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, border: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16))', fontSize: 11, color: 'var(--dsw-alias-label-secondary, #667085)' },
  dot: { width: 7, height: 7, borderRadius: 999, background: '#54d18a', display: 'inline-block' },
  dotOff: { width: 7, height: 7, borderRadius: 999, background: '#98a2b3', display: 'inline-block' },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, wordBreak: 'break-all', background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04))', color: 'var(--dsw-alias-label-secondary, #475467)', padding: '6px 8px', borderRadius: 8 },
  error: { color: 'var(--dsw-alias-state-danger-primary, #d92d20)', fontSize: 12, lineHeight: 1.5 },
  success: { color: 'var(--dsw-alias-state-success-primary, #079455)', fontSize: 12, lineHeight: 1.5 },
  divider: { height: 1, background: 'var(--dsw-alias-border-l4, rgba(0,0,0,.08))', margin: '6px 0' },
}

function Row(props: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={styles.row}>
      <div style={styles.label}>{props.label}</div>
      <div style={{ minWidth: 0 }}>{props.children}</div>
    </div>
  )
}


const CARD_CSS = `
.enh-root input:not([type="checkbox"]):not([type="file"]), .enh-root select { transition:border-color .15s, box-shadow .15s; }
.enh-root input:not([type="checkbox"]):not([type="file"]):focus, .enh-root input:not([type="checkbox"]):not([type="file"]):focus-visible, .enh-root select:focus, .enh-root select:focus-visible { outline:none !important; border-color:var(--dsw-alias-state-business-primary, #4d8dff) !important; box-shadow:0 0 0 3px var(--dsw-alias-state-business-primary-a10, rgba(77,141,255,.18)) !important; }
.enh-root select { appearance:none; background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%23667085' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 12px center; padding-right:32px !important; }
.enh-root input[type="file"] { font-size:12px; color:var(--dsw-alias-label-secondary, #475467); max-width:100%; }
.enh-root input[type="file"]::file-selector-button { appearance:none; height:32px; margin-right:10px; padding:0 14px; border-radius:var(--dsw-radius-md, 12px); border:.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16)); background:var(--dsw-alias-bg-layer-3, #fff); color:var(--dsw-alias-label-primary, inherit); font:inherit; font-size:13px; cursor:pointer; }
.enh-root input[type="file"]::file-selector-button:hover { background:var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04)); }
.enh-root input[type="checkbox"] { appearance:none; flex:none; width:36px; height:20px; border-radius:999px; background:var(--dsw-alias-border-l2, #d0d5dd); position:relative; cursor:pointer; transition:background .15s; margin:0; }
.enh-root input[type="checkbox"]::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2); transition:transform .15s; }
.enh-root input[type="checkbox"]:checked { background:var(--dsw-alias-state-business-primary, #4d8dff); }

.enh-root input[type="checkbox"]:checked::after { transform:translateX(16px); }
.enh-root input[type="checkbox"]:disabled { opacity:.45; cursor:not-allowed; }
.enh-root input[type="checkbox"]:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #4d8dff); outline-offset:2px; }

.enh-root .enh-block-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.enh-root .enh-dirty { flex:none; font-size:11px; line-height:18px; padding:1px 8px; border-radius:999px; color:var(--dsw-alias-state-warning-primary, #b54708); background:var(--dsw-alias-state-warning-bg, rgba(247,144,9,.12)); border:.5px solid var(--dsw-alias-state-warning-primary-a30, rgba(181,71,8,.3)); }
.enh-root .enh-subhead { margin:14px 0 2px; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary, inherit); }
.enh-root .enh-grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 16px; }
.enh-root .enh-grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px 16px; }
.enh-root .enh-icon-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:6px; }
.enh-root .enh-icon-card { display:flex; gap:10px; align-items:flex-start; padding:10px; border:.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.12)); border-radius:var(--dsw-radius-md, 12px); background:var(--dsw-alias-bg-layer-2, transparent); min-width:0; }
.enh-root .enh-icon-card img { width:56px; height:56px; border-radius:10px; object-fit:cover; flex:none; background:var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04)); }
.enh-root .enh-icon-body { min-width:0; flex:1; display:flex; flex-direction:column; gap:4px; }
.enh-root .enh-icon-card input[type="file"] { max-width:100%; }
.enh-root input[type="radio"] { accent-color: var(--dsw-alias-state-business-primary, #4d8dff); width:16px; height:16px; margin:0; }
.enh-root details.enh-advanced { margin-top:8px; }
.enh-root details.enh-advanced summary { cursor:pointer; color:var(--dsw-alias-label-secondary, #475467); font-size:12px; }
@media (max-width: 720px) { .enh-root .enh-grid2, .enh-root .enh-grid3, .enh-root .enh-icon-grid { grid-template-columns:1fr; } }

.enh-root button:disabled { opacity:.42; cursor:not-allowed; }
.enh-root input.enh-event-check { appearance:auto; width:16px; height:16px; border-radius:3px; background:initial; margin:0; accent-color:var(--dsw-alias-state-business-primary, #4d8dff); }
.enh-root input.enh-event-check::after { display:none; }
.enh-root code { background:var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04)); color:var(--dsw-alias-label-secondary, #475467); padding:1px 5px; border-radius:5px; font-size:12px; }
.enh-root .enh-help { color:var(--dsw-alias-label-tertiary, #667085); font-size:12px; line-height:1.6; }
`

function InlineRow(props: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', flexWrap: 'wrap' }}>
      <div style={{ ...styles.label, flex: '0 0 74px' }}>{props.label}</div>
      <div style={{ minWidth: 0, flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{props.children}</div>
    </div>
  )
}

function CopyIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  )
}

function OpenIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function EyeIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

function EyeOffIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 3 18 18" />
      <path d="M10.6 6.2A10.5 10.5 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8" />
      <path d="M6.6 6.6C3.6 8.4 2 12 2 12s3.5 6 10 6c1.7 0 3.2-.4 4.5-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

function PasswordInput(props: {
  value: string
  onChange: (value: string) => void
  autoComplete: string
  show: boolean
  onToggle: () => void
}): React.ReactElement {
  return (
    <div style={{ position: 'relative' }}>
      <input
        style={{ ...styles.input, paddingRight: 38 }}
        type={props.show ? 'text' : 'password'}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        style={{ position: 'absolute', right: 5, top: 3, width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #667085)', cursor: 'pointer' }}
        title={props.show ? '隐藏密码' : '显示密码'}
        aria-label={props.show ? '隐藏密码' : '显示密码'}
        onClick={props.onToggle}
      >
        {props.show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

interface BlockResult {
  kind: 'ok' | 'error'
  text: string
}

function Block(props: {
  order: number
  title: string
  hint?: string
  dirty: boolean
  busy: boolean
  saveLabel: string
  onSave: () => void
  status?: BlockResult
  extra?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div style={{ ...styles.card, order: props.order }}>
      <div style={styles.blockHead}>
        <div>
          <div style={styles.blockTitle}>{props.title}</div>
          {props.hint ? <div style={styles.muted}>{props.hint}</div> : null}
        </div>
        {props.dirty ? <span style={styles.dirty}>未保存</span> : null}
      </div>
      {props.children}
      <div style={styles.actions}>
        <button style={{ ...styles.button, ...styles.primary }} disabled={props.busy || !props.dirty} onClick={props.onSave}>
          {props.busy ? '保存中…' : props.saveLabel}
        </button>
        {props.extra}
      </div>
      {props.status ? (
        <div aria-live="polite" style={props.status.kind === 'ok' ? styles.success : styles.error}>
          {props.status.text}
        </div>
      ) : null}
    </div>
  )
}

function Card(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [bindHost, setBindHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3088')
  const [sessionDays, setSessionDays] = useState('30')
  const [loginThrottle, setLoginThrottle] = useState(true)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [httpsChoice, setHttpsChoice] = useState<'off' | 'selfsigned' | 'uploaded'>('off')
  const [httpsHostnames, setHttpsHostnames] = useState('')
  const [certFile, setCertFile] = useState<File | null>(null)
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [caSource, setCaSource] = useState<'generated' | 'uploaded'>('generated')
  const [caCertFile, setCaCertFile] = useState<File | null>(null)
  const [caKeyFile, setCaKeyFile] = useState<File | null>(null)
  const [iconVersion, setIconVersion] = useState(0)
  const [blockStatus, setBlockStatus] = useState<Record<string, { kind: 'ok' | 'error'; text: string } | undefined>>({})
  const [pwaEnabled, setPwaEnabled] = useState(false)
  const [pwaName, setPwaName] = useState('DeepSeek Harness')
  const [pwaShortName, setPwaShortName] = useState('DSH')
  const [pwaDisplay, setPwaDisplay] = useState<'standalone' | 'fullscreen' | 'minimal-ui'>('fullscreen')
  const [pwaThemeColor, setPwaThemeColor] = useState('#0f1115')
  const [pwaBackgroundColor, setPwaBackgroundColor] = useState('#0f1115')
  const [notifyEnabled, setNotifyEnabled] = useState(true)
  const [notifyTask, setNotifyTask] = useState(true)
  const [notifyAsk, setNotifyAsk] = useState(true)
  const [notifyApproval, setNotifyApproval] = useState(true)
  const [notifyDenied, setNotifyDenied] = useState(true)
  const [notifySubagent, setNotifySubagent] = useState(true)
  const [notifyGoal, setNotifyGoal] = useState(true)
  const [notifyJobs, setNotifyJobs] = useState(true)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushSubject, setPushSubject] = useState('mailto:admin@example.com')
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null)
  const [pushCount, setPushCount] = useState(0)
  const [deviceSubscribed, setDeviceSubscribed] = useState(false)
  const [customIcons, setCustomIcons] = useState<string[]>([])
  const [sessionHeaderEnabled, setSessionHeaderEnabled] = useState(false)
  const [sessionHeaderName, setSessionHeaderName] = useState('x-deepseek-harness-session-id')

  const applyStatus = useCallback((next: Status) => {
    setStatus(next)
    setEnabled(next.enabled)
    setBindHost(next.bindHost)
    setPort(String(next.port))
    setSessionDays(String(next.sessionDays))
    setLoginThrottle(next.loginThrottle)
    setHttpsHostnames((next.https?.hostnames ?? [])
      .filter((host) => ![next.bindHost, next.dshHost, 'localhost', '127.0.0.1', '::1'].includes(host))
      .join(', '))
    setPwaEnabled(next.pwa?.enabled ?? false)
    setPwaName(next.pwa?.name ?? 'DeepSeek Harness')
    setPwaShortName(next.pwa?.shortName ?? 'DSH')
    setPwaDisplay(next.pwa?.display ?? 'fullscreen')
    setPwaThemeColor(next.pwa?.themeColor ?? '#0f1115')
    setPwaBackgroundColor(next.pwa?.backgroundColor ?? '#0f1115')
    setNotifyEnabled(next.notify?.enabled ?? true)
    setNotifyTask(next.notify?.task ?? true)
    setNotifyAsk(next.notify?.ask ?? true)
    setNotifyApproval(next.notify?.approval ?? true)
    setNotifyDenied(next.notify?.denied ?? true)
    setNotifySubagent(next.notify?.subagent ?? true)
    setNotifyGoal(next.notify?.goal ?? true)
    setNotifyJobs(next.notify?.jobs ?? true)
    setPushEnabled(next.push?.enabled ?? false)
    setPushSubject(next.push?.subject ?? 'mailto:admin@example.com')
    setPushPublicKey(next.push?.publicKey ?? null)
    setPushCount(next.push?.subscriptions ?? 0)
    setCustomIcons(next.pwa?.customIcons ?? [])
    setSessionHeaderEnabled(next.sessionHeader?.enabled ?? false)
    setSessionHeaderName(next.sessionHeader?.headerName ?? 'x-deepseek-harness-session-id')
    setHttpsChoice(next.https?.mode === 'uploaded' ? 'uploaded' : next.https?.mode === 'off' ? 'off' : 'selfsigned')
    setCaSource(next.https?.mode === 'ca' ? 'uploaded' : 'generated')
  }, [])

  const extraHosts = (): string[] => httpsHostnames.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
  const reload = useCallback(async () => {
    try {
      setError(null)
      applyStatus(await api<Status>('/status'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [applyStatus])

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const refreshAfterRestart = async (): Promise<void> => {
    await sleep(900)
    let last: unknown
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        applyStatus(await api<Status>('/status'))
        return
      } catch (err) {
        last = err
        await sleep(700)
      }
    }
    throw last instanceof Error ? last : new Error('网关重启后状态刷新失败，请刷新页面')
  }
  const restartGateway = async (): Promise<void> => {
    await api('/restart', { method: 'POST', body: '{}' })
    await refreshAfterRestart()
  }

  useEffect(() => {
    void reload()
  }, [reload])


  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (success) setNotice(success)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runBlock = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(true)
    setBlockStatus((prev) => ({ ...prev, [key]: undefined }))
    try {
      await action()
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      setBlockStatus((prev) => ({ ...prev, [key]: { kind: 'ok', text: `${success} · ${time}` } }))
    } catch (err) {
      setBlockStatus((prev) => ({ ...prev, [key]: { kind: 'error', text: err instanceof Error ? err.message : String(err) } }))
    } finally {
      setBusy(false)
    }
  }

  const saveFields = (block: string, fields: Record<string, unknown>, success: string) => runBlock(block, async () => {
    const next = await api<Status>('/config', { method: 'POST', body: JSON.stringify(fields) })
    applyStatus(next)
  }, success)

  const saveSessionHeader = () => runBlock('sessionHeader', async () => {
    const next = await api<Status>('/config', {
      method: 'POST',
      body: JSON.stringify({ sessionHeaderEnabled, sessionHeaderName }),
    })
    applyStatus(next)
  }, '会话请求头配置已保存，下一次模型请求即生效。')

  const saveGateway = () => runBlock('gateway', async () => {
    let next = await api<Status>('/config', {
      method: 'POST',
      body: JSON.stringify({
        enabled,
        bindHost,
        port: Number(port),
        sessionDays: Number(sessionDays),
        loginThrottle,
        httpsHostnames: extraHosts(),
        restart: false,
      }),
    })
    const currentMode = next.https.mode
    const nextExtras = extraHosts().map((item) => item.toLowerCase()).sort()
    const currentExtras = (next.https.hostnames ?? [])
      .filter((host) => ![next.bindHost, next.dshHost, 'localhost', '127.0.0.1', '::1'].includes(host))
      .map((item) => item.toLowerCase())
      .sort()
    const hostnamesChanged = JSON.stringify(nextExtras) !== JSON.stringify(currentExtras)

    if (httpsChoice === 'off') {
      if (currentMode !== 'off') next = await api<Status>('/tls/off', { method: 'POST', body: JSON.stringify({ restart: false }) })
    } else if (httpsChoice === 'uploaded') {
      if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('证书和私钥需要同时选择')
      if (certFile && keyFile) {
        const certPem = await readText(certFile)
        const keyPem = await readText(keyFile)
        next = await api<Status>('/tls/upload', { method: 'POST', body: JSON.stringify({ certPem, keyPem, restart: false }) })
        setCertFile(null)
        setKeyFile(null)
      } else if (currentMode !== 'uploaded') {
        throw new Error('选择“使用已有证书”后，需要上传证书文件和私钥文件')
      }
    } else if (caSource === 'uploaded') {
      if (Boolean(caCertFile) !== Boolean(caKeyFile)) {
        throw new Error('CA 证书和 CA 私钥需要同时选择')
      }
      if (caCertFile && caKeyFile) {
        const caCertPem = await readText(caCertFile)
        const caKeyPem = await readText(caKeyFile)
        next = await api<Status>('/tls/upload-ca', { method: 'POST', body: JSON.stringify({ caCertPem, caKeyPem, restart: false }) })
        setCaCertFile(null)
        setCaKeyFile(null)
      } else if (currentMode !== 'ca') {
        if (status?.https.uploadedCaAvailable) {
          next = await api<Status>('/tls/use-ca', { method: 'POST', body: JSON.stringify({ restart: false }) })
        } else {
          throw new Error('还没有保存过 CA；请选择 CA 证书和 CA 私钥')
        }
      }
    } else if (currentMode !== 'selfsigned' || hostnamesChanged) {
      next = await api<Status>('/tls/selfsigned', { method: 'POST', body: JSON.stringify({ httpsHostnames: extraHosts(), restart: false }) })
    }
    await restartGateway()
  }, '网关配置已保存，网关已重启')

  const savePwa = () => saveFields('pwa', {
    pwaEnabled,
    pwaName,
    pwaShortName,
    pwaDisplay,
    pwaThemeColor,
    pwaBackgroundColor,
  }, 'PWA 配置已保存')

  const saveNotify = () => saveFields('notify', {
    notifyEnabled,
    notifyTask,
    notifyAsk,
    notifyApproval,
    notifyDenied,
    notifySubagent,
    notifyGoal,
    notifyJobs,
    pushEnabled: pushUsable ? pushEnabled : false,
    pushSubject,
  }, '通知配置已保存')

  const savePassword = () => runBlock('access', async () => {
    if (newPassword.length < 6) throw new Error('新密码至少 6 个字符')
    if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致')
    const next = await api<Status>('/password', {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    })
    applyStatus(next)
    setNewPassword('')
    setConfirmPassword('')
  }, '访问密码已更新，现有网关会话已全部失效')

  const restart = () => run(async () => {
    await restartGateway()
  }, '网关已重启')

  const copyToClipboard = (text: string) => {
    setError(null)
    const fallback = () => {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        document.body.removeChild(area)
      }
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(fallback)
    } else {
      fallback()
    }
  }

  const enablePush = () => run(async () => {
    if (!window.isSecureContext) throw new Error('Web Push 需要 HTTPS（或 localhost）；请先启用 HTTPS')
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('当前浏览器不支持 Web Push')
    if (!pushPublicKey) throw new Error('VAPID 公钥尚未生成，请刷新状态后重试')
    let permission = Notification.permission
    if (permission === 'default') permission = await Notification.requestPermission()
    if (permission !== 'granted') throw new Error('通知权限未授予；请在浏览器/系统设置中允许通知')
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushPublicKey) })
    }
    const json = subscription.toJSON()
    const next = await api<Status>('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys, origin: location.origin }),
    })
    applyStatus(next)
    setDeviceSubscribed(true)
  }, '本设备已订阅 PWA 推送')

  const disablePush = () => run(async () => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) })
        await subscription.unsubscribe()
      }
    }
    setDeviceSubscribed(false)
    await reload()
  }, '本设备已取消推送订阅')

  const testPush = () => run(async () => {
    const result = await api<{ sent: number; removed: number; failed: number }>('/push/test', { method: 'POST', body: '{}' })
    setNotice(`推送已发送：成功 ${result.sent}，移除失效 ${result.removed}，失败 ${result.failed}`)
    await reload()
  })

  const uploadIcon = (kind: string, file: File) => run(async () => {
    const data = await readBase64(file)
    applyStatus(await api<Status>('/icons/upload', { method: 'POST', body: JSON.stringify({ kind, data }) }))
    setIconVersion((value) => value + 1)
  }, '图标已更新')

  const resetIcon = (kind?: string) => run(async () => {
    applyStatus(await api<Status>('/icons/reset', { method: 'POST', body: JSON.stringify(kind ? { kind } : {}) }))
  }, kind ? '已恢复默认图标' : '已恢复全部默认图标')

  const testNotify = () => run(async () => {
    await api('/notify/test', { method: 'POST', body: '{}' })
  }, '已发送测试通知')

  const logoutAll = () => run(async () => {
    await api('/logout-all', { method: 'POST', body: '{}' })
    setNotice('已吊销全部网关会话；当前浏览器需重新登录')
  }, '已吊销全部网关会话')

  const currentInterface = status?.interfaces.find((item) => item.address === bindHost)
  const interfaceOptions = React.useMemo(() => {
    const list = (status?.interfaces ?? []).filter((item) => (item.family === 'IPv4' || item.address === '::1') && !isVirtualInterface(item.name))
    const seen = new Set<string>()
    const options: Array<{ value: string; label: string }> = []
    for (const item of list) {
      if (seen.has(item.address)) continue
      seen.add(item.address)
      options.push({
        value: item.address,
        label: `${item.address} · ${item.name}${item.internal ? ' (内部)' : ''}`,
      })
    }
    if (!seen.has('0.0.0.0')) options.push({ value: '0.0.0.0', label: '0.0.0.0 · 所有网卡（不推荐）' })
    if (bindHost && !seen.has(bindHost)) options.push({ value: bindHost, label: bindHost })
    return options
  }, [status, bindHost])


  const pushUsable = window.isSecureContext
  useEffect(() => {
    let cancelled = false
    const detect = async (): Promise<void> => {
      if (!pushUsable || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setDeviceSubscribed(false)
        return
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration('/')
        const subscription = await registration?.pushManager.getSubscription()
        if (!cancelled) setDeviceSubscribed(Boolean(subscription))
      } catch {
        if (!cancelled) setDeviceSubscribed(false)
      }
    }
    void detect()
    return () => { cancelled = true }
  }, [pushEnabled, pushUsable, status?.push.subscriptions])

  if (!status) {
    return (
      <div style={styles.wrap}>
        <div style={styles.header}><h3 style={styles.title}>插件状态</h3></div>
        {error ? <div style={styles.error}>{error}</div> : <div style={styles.muted}>正在读取网关状态…</div>}
      </div>
    )
  }

  const currentModeChoice: 'off' | 'selfsigned' | 'uploaded' =
    status.https.mode === 'uploaded' ? 'uploaded' : status.https.mode === 'off' ? 'off' : 'selfsigned'
  const savedExtras = (status.https.hostnames ?? [])
    .filter((host) => ![status.bindHost, status.dshHost, 'localhost', '127.0.0.1', '::1'].includes(host))
    .map((host) => host.toLowerCase())
    .sort()
  const typedExtras = extraHosts().map((host) => host.toLowerCase()).sort()
  const hostnamesDirty = JSON.stringify(savedExtras) !== JSON.stringify(typedExtras)
  const savedCaSource: 'generated' | 'uploaded' = status.https.mode === 'ca' ? 'uploaded' : 'generated'
  const gatewayDirty =
    enabled !== status.enabled ||
    bindHost !== status.bindHost ||
    Number(port) !== status.port ||
    Number(sessionDays) !== status.sessionDays ||
    loginThrottle !== status.loginThrottle ||
    httpsChoice !== currentModeChoice ||
    hostnamesDirty ||
    (httpsChoice === 'selfsigned' && caSource !== savedCaSource) ||
    (httpsChoice === 'selfsigned' && caSource === 'uploaded' && Boolean(caCertFile || caKeyFile)) ||
    (httpsChoice === 'uploaded' && Boolean(certFile || keyFile))
  const pwaDirty =
    pwaEnabled !== status.pwa.enabled ||
    pwaName !== status.pwa.name ||
    pwaShortName !== status.pwa.shortName ||
    pwaDisplay !== status.pwa.display ||
    pwaThemeColor !== status.pwa.themeColor ||
    pwaBackgroundColor !== status.pwa.backgroundColor
  const notifyDirty =
    notifyEnabled !== status.notify.enabled ||
    notifyTask !== status.notify.task ||
    notifyAsk !== status.notify.ask ||
    notifyApproval !== status.notify.approval ||
    notifyDenied !== status.notify.denied ||
    notifySubagent !== status.notify.subagent ||
    notifyGoal !== status.notify.goal ||
    notifyJobs !== status.notify.jobs ||
    pushEnabled !== status.push.enabled ||
    pushSubject !== status.push.subject
  const sessionHeaderDirty =
    sessionHeaderEnabled !== status.sessionHeader.enabled ||
    sessionHeaderName !== status.sessionHeader.headerName
  const accessDirty = newPassword.length > 0 || confirmPassword.length > 0

  const iconUrl = (kind: string): string => `/pwa/enhancement/${kind}?v=${iconVersion}`

  /**
   * 会话请求头的挂载说明。
   * 「没配第三方模型」是正常状态而非故障，必须与真正的结构异常区分开。
   */
  const sessionHeaderSummary = (errorStyle = false): string => {
    const header = status.sessionHeader
    if (header.patched > 0) {
      return `已挂载到 ${header.patched} 个第三方 API adapter；改动即时生效，无需重启。`
    }
    if (header.reason === 'no-adapters') {
      return '当前没有已注册的第三方模型路由，因此暂时无处注入。在「设置 → 模型」添加一个 OpenAI 兼容 provider（或在本 profile 的 cordis.patch.yml 配置 llm-pi-ai 路由）后会自动挂载；官方 DeepSeek 路由本来就自带该头，不需要它。'
    }
    if (header.reason === 'no-pi-ai-adapter') {
      return `已注册 ${header.adapterCount} 个 adapter，但没有一个是第三方 API adapter（llm-pi-ai），因此未挂载。`
    }
    if (errorStyle) return '宿主 llm 服务不可用或结构已变化，注入已旁路，不会影响正常请求。'
    return '宿主 llm 服务不可用或结构已变化，注入暂时旁路。'
  }

  return (
    <div className="enh-root" style={styles.wrap}>
      <style>{CARD_CSS}</style>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>插件状态</h3>
          <div style={styles.muted}>DSH 增强的网关、PWA、通知与推送配置。</div>
        </div>
        <span style={styles.pill}>
          <span style={styles.dot} />
          运行中
        </span>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}
      {notice ? <div style={styles.success}>{notice}</div> : null}

      <Block
        order={2}
        title="网关配置"
        hint="密码网关的监听、访问与会话设置；HTTPS 配置也在本块内，保存时按顺序应用。"
        dirty={gatewayDirty}
        busy={busy}
        saveLabel="保存并应用"
        onSave={saveGateway}
        status={blockStatus.gateway}
        extra={<button style={styles.button} disabled={busy || !status.passwordSet} onClick={restart}>重启网关</button>}
      >
        <InlineRow label="DSH 上游">
          <code style={{ ...styles.code, flex: '1 1 260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status.dshAccessUrl || status.dshOrigin}</code>
          <button style={styles.iconButton} title="复制" aria-label="复制 DSH 上游地址（含 token）" onClick={() => copyToClipboard(status.dshAccessUrl || status.dshOrigin)}><CopyIcon /></button>
          <a style={styles.iconButton} title="打开" aria-label="打开 DSH 上游（含 token）" href={status.dshAccessUrl || status.dshOrigin} target="_blank" rel="noreferrer"><OpenIcon /></a>
        </InlineRow>
        <InlineRow label="网关地址">
          {status.url ? (
            <>
              <code style={{ ...styles.code, flex: '1 1 260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status.url}</code>
              <button style={styles.iconButton} title="复制" aria-label="复制网关地址" onClick={() => copyToClipboard(status.url!)}><CopyIcon /></button>
              <a style={styles.iconButton} title="打开" aria-label="打开网关" href={status.url} target="_blank" rel="noreferrer"><OpenIcon /></a>
            </>
          ) : <span style={styles.muted}>未运行；设置密码并启用后生成</span>}
        </InlineRow>
        {!status.dshSecretReady ? <div style={styles.error}>网关会话注入不可用：无法读取 DSH 浏览器签名密钥，网关代理会返回 401。</div> : null}
        {status.error ? <div style={styles.error}>最近错误：{status.error}</div> : null}

        <Row label="启用网关">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={enabled} disabled={!status.passwordSet} onChange={(event) => setEnabled(event.target.checked)} />
            <span>{!status.passwordSet ? '请先设置密码' : enabled ? '启用' : '停用'}</span>
          </label>
        </Row>

        {enabled ? (
          <>
            <div className="enh-grid3">
              <Row label="监听地址">
                <select style={styles.select} value={bindHost} onChange={(event) => setBindHost(event.target.value)}>
                  {interfaceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {currentInterface ? <div style={styles.muted}>当前：{currentInterface.address}（{currentInterface.name}）</div> : null}
              </Row>
              <Row label="端口">
                <input style={styles.input} value={port} inputMode="numeric" onChange={(event) => setPort(event.target.value)} />
              </Row>
              <Row label="会话有效期">
                <input style={styles.input} value={sessionDays} inputMode="numeric" onChange={(event) => setSessionDays(event.target.value)} />
                <div style={styles.muted}>天；密码修改后全部会话失效。</div>
              </Row>
            </div>
            <Row label="登录失败节流">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={loginThrottle} onChange={(event) => setLoginThrottle(event.target.checked)} />
                <span>{loginThrottle ? '开启（5 次 / 10 分钟 → 锁 1 分钟）' : '关闭（不推荐）'}</span>
              </label>
            </Row>

            <Row label="HTTPS 模式">
              <select style={styles.select} value={httpsChoice} onChange={(event) => setHttpsChoice(event.target.value as 'off' | 'selfsigned' | 'uploaded')}>
                <option value="off">关闭 HTTPS</option>
                <option value="selfsigned">使用 CA 证书自签发</option>
                <option value="uploaded">使用已有证书</option>
              </select>
            </Row>

            {httpsChoice === 'off' ? (
              <div style={styles.muted}>关闭后浏览器会提示不安全，PWA 安装、Service Worker 与 Web Push 都不可用。保存后生效。</div>
            ) : null}

            {httpsChoice === 'selfsigned' ? (
              <div>
                <Row label="CA 来源">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="radio" name="ca-source" checked={caSource === 'generated'} onChange={() => setCaSource('generated')} />
                      <span>自动生成 CA</span>
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="radio" name="ca-source" checked={caSource === 'uploaded'} onChange={() => setCaSource('uploaded')} />
                      <span>使用已有 CA</span>
                    </label>
                  </div>
                </Row>
                {caSource === 'uploaded' ? (
                  <>
                    <Row label="当前 CA">
                      {status.https.uploadedCaInfo ? (
                        <div style={styles.muted}>{status.https.uploadedCaInfo.subject}，有效期至 {status.https.uploadedCaInfo.validTo}；文件已保存，可直接使用，无需重新上传。</div>
                      ) : status.https.caInfo ? (
                        <div style={styles.muted}>{status.https.caInfo.subject}，有效期至 {status.https.caInfo.validTo}；文件保存在本机 TLS 目录，可继续签发 leaf。</div>
                      ) : <div style={styles.muted}>尚未上传 CA。</div>}
                      <input id="enh-ca-cert-file" type="file" accept=".pem,.crt,.cer" style={{ display: 'none' }} onChange={(event) => setCaCertFile(event.target.files?.[0] ?? null)} />
                      <input id="enh-ca-key-file" type="file" accept=".pem,.key" style={{ display: 'none' }} onChange={(event) => setCaKeyFile(event.target.files?.[0] ?? null)} />
                      <div style={styles.actions}>
                        <label htmlFor="enh-ca-cert-file" style={{ ...styles.button, display: 'inline-flex', alignItems: 'center' }}>{caCertFile ? `已选择：${caCertFile.name}` : status.https.uploadedCaInfo ? '更换 CA 证书' : '选择 CA 证书'}</label>
                        <label htmlFor="enh-ca-key-file" style={{ ...styles.button, display: 'inline-flex', alignItems: 'center' }}>{caKeyFile ? `已选择：${caKeyFile.name}` : status.https.uploadedCaInfo ? '更换 CA 私钥' : '选择 CA 私钥'}</label>
                      </div>
                      {caCertFile || caKeyFile ? <div style={styles.muted}>保存时才会应用；只保留最新一份文件。</div> : null}
                    </Row>
                  </>
                ) : (
                  <div style={styles.muted}>保存时会在插件 TLS 目录生成本地 CA，并用它签发当前监听地址 + 额外主机名的证书。</div>
                )}
                <Row label="额外主机名">
                  <input style={styles.input} placeholder="例如 dsh.lan, myhost.local（逗号分隔）" value={httpsHostnames} onChange={(event) => setHttpsHostnames(event.target.value)} />
                  <div style={styles.muted}>监听 IP、localhost 会自动包含；这里补充 DNS 主机名。</div>
                </Row>
                {status.https.caAvailable ? (
                  <div style={styles.actions}>
                    <a style={{ ...styles.button, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href={`${API}/tls/ca`} download="dsh-enhancement-ca.crt">下载 CA 证书</a>
                  </div>
                ) : null}
                {status.https.mode !== 'off' && status.https.cert ? (
                  <div style={styles.muted}>当前证书：{status.https.cert.subject}，有效期至 {status.https.cert.validTo}</div>
                ) : null}
                <div style={styles.muted}>iOS 安装 CA：Safari 打开下载文件 → 设置 → 通用 → VPN 与设备管理 → 安装描述文件 → 设置 → 通用 → 关于本机 → 证书信任设置 → 对 “DSH Enhancement Local CA” 开启完全信任。</div>
              </div>
            ) : null}

            {httpsChoice === 'uploaded' ? (
              <div>
                <Row label="当前证书">
                  {status.https.cert && status.https.mode === 'uploaded' ? (
                    <div style={styles.muted}>{status.https.cert.subject}，有效期至 {status.https.cert.validTo}；SAN：{status.https.cert.subjectAltName || '未提供'}。证书和私钥保存在本机 TLS 目录。</div>
                  ) : <div style={styles.muted}>尚未上传证书。</div>}
                  <input id="enh-cert-file" type="file" accept=".pem,.crt,.cer" style={{ display: 'none' }} onChange={(event) => setCertFile(event.target.files?.[0] ?? null)} />
                  <input id="enh-key-file" type="file" accept=".pem,.key" style={{ display: 'none' }} onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)} />
                  <div style={styles.actions}>
                    <label htmlFor="enh-cert-file" style={{ ...styles.button, display: 'inline-flex', alignItems: 'center' }}>{certFile ? `已选择：${certFile.name}` : status.https.mode === 'uploaded' ? '更换证书' : '选择证书'}</label>
                    <label htmlFor="enh-key-file" style={{ ...styles.button, display: 'inline-flex', alignItems: 'center' }}>{keyFile ? `已选择：${keyFile.name}` : status.https.mode === 'uploaded' ? '更换私钥' : '选择私钥'}</label>
                  </div>
                  {certFile || keyFile ? <div style={styles.muted}>保存时才会应用；证书 SAN 必须覆盖访问地址/IP，只保留最新一份文件。</div> : null}
                </Row>
              </div>
            ) : null}
          </>
        ) : <div style={styles.muted}>启用网关后显示监听地址、端口、会话和 HTTPS 设置。</div>}
      </Block>

      <Block
        order={1}
        title="访问控制"
        hint={status.passwordSet ? '已设置访问密码；修改后全部网关会话失效。' : '尚未设置密码；设置后才能启用网关。'}
        dirty={accessDirty}
        busy={busy}
        saveLabel="设置密码"
        onSave={savePassword}
        status={blockStatus.access}
        extra={<button style={{ ...styles.button, ...styles.danger }} disabled={busy || !status.passwordSet} onClick={logoutAll}>退出全部网关会话</button>}
      >
        <div className="enh-grid2">
          <Row label="新密码">
            <PasswordInput value={newPassword} onChange={setNewPassword} autoComplete="new-password" show={showNewPassword} onToggle={() => setShowNewPassword((value) => !value)} />
          </Row>
          <Row label="确认新密码">
            <PasswordInput value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" show={showConfirmPassword} onToggle={() => setShowConfirmPassword((value) => !value)} />
          </Row>
        </div>
        {newPassword.length > 0 ? (
          <div style={{ ...styles.error, marginTop: -4 }}>
            {newPassword.length < 6 ? '新密码至少 6 个字符' : confirmPassword.length > 0 && newPassword !== confirmPassword ? '两次输入的新密码不一致' : ''}
          </div>
        ) : null}
        <div style={styles.muted}>至少 6 个字符；密码等价于本机 DSH 的访问权限，请使用强密码。</div>
      </Block>

      <Block
        order={3}
        title="PWA（添加到桌面 / 主屏）"
        hint="启用后接管 /manifest.webmanifest、图标、/sw.js 与安装提示；HTTP 下安装入口和 Service Worker 不生效。"
        dirty={pwaDirty}
        busy={busy}
        saveLabel="保存 PWA 配置"
        onSave={savePwa}
        status={blockStatus.pwa}
        extra={
          <>
            <a style={{ ...styles.button, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href="/manifest.webmanifest" target="_blank" rel="noreferrer">查看 manifest</a>
            <a style={{ ...styles.button, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href="/sw.js" target="_blank" rel="noreferrer">查看 Service Worker</a>
          </>
        }
      >
        <Row label="启用 PWA">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={pwaEnabled} onChange={(event) => setPwaEnabled(event.target.checked)} />
            <span>{pwaEnabled ? '启用' : '停用'}</span>
          </label>
        </Row>
        {status.https.mode === 'off' ? <div style={styles.error}>当前是 HTTP：安装提示、Service Worker、Web Push 都不会生效。请先在网关配置启用 HTTPS。</div> : null}
        {status.pwa.error ? <div style={styles.error}>PWA 注册失败：{status.pwa.error}</div> : null}
        {pwaEnabled ? (
          <div>
            <div className="enh-grid2">
              <Row label="应用名"><input style={styles.input} value={pwaName} onChange={(event) => setPwaName(event.target.value)} /></Row>
              <Row label="短名称"><input style={styles.input} value={pwaShortName} onChange={(event) => setPwaShortName(event.target.value)} /></Row>
            </div>
            <div className="enh-grid3">
              <Row label="显示模式">
                <select style={styles.select} value={pwaDisplay} onChange={(event) => setPwaDisplay(event.target.value as 'standalone' | 'fullscreen' | 'minimal-ui')}>
                  <option value="standalone">standalone</option>
                  <option value="fullscreen">fullscreen</option>
                  <option value="minimal-ui">minimal-ui</option>
                </select>
              </Row>
              <Row label="主题色"><input style={styles.input} value={pwaThemeColor} onChange={(event) => setPwaThemeColor(event.target.value)} /></Row>
              <Row label="背景色"><input style={styles.input} value={pwaBackgroundColor} onChange={(event) => setPwaBackgroundColor(event.target.value)} /></Row>
            </div>

            <div style={{ ...styles.label, marginTop: 8 }}>分平台图标</div>
            <div style={styles.muted}>上传后立即生效；Android 自适应图标请单独上传 maskable 图。建议 512 图标内容留在中心 80% 安全区。</div>
            <div className="enh-icon-grid">
              {([
                ['icon-192.png', '通用 192 × 192', 'any'],
                ['icon-512.png', '通用 512 × 512', 'any'],
                ['icon-maskable-512.png', 'Android 自适应 512 × 512', 'maskable'],
                ['apple-touch-icon-180.png', 'iOS 主屏 180 × 180', 'apple-touch-icon'],
              ] as const).map(([kind, title, hint]) => (
                <div key={kind} className="enh-icon-card">
                  <img src={iconUrl(kind)} alt={title} />
                  <div className="enh-icon-body">
                    <div style={styles.label}>{title}</div>
                    <div style={styles.muted}>{hint} · {customIcons.includes(kind) ? '已自定义' : '默认'}</div>
                    <div style={styles.actions}>
                      <input
                        type="file"
                        accept="image/png"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null
                          event.target.value = ''
                          if (file) void uploadIcon(kind, file)
                        }}
                      />
                      {customIcons.includes(kind) ? <button style={styles.button} disabled={busy} onClick={() => resetIcon(kind)}>恢复默认</button> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={styles.actions}>
              <button style={styles.button} disabled={busy || customIcons.length === 0} onClick={() => resetIcon()}>全部恢复默认</button>
            </div>
          </div>
        ) : <div style={styles.muted}>启用 PWA 后才显示应用名、颜色与图标设置。</div>}
      </Block>

      <Block
        order={4}
        title="通知"
        hint="事件勾选同时控制桌面通知和 PWA 推送；两个渠道可以独立开关，关闭某个渠道不会丢事件选择。"
        dirty={notifyDirty}
        busy={busy}
        saveLabel="保存通知配置"
        onSave={saveNotify}
        status={blockStatus.notify}
        extra={
          <>
            <button style={styles.button} disabled={busy} onClick={testNotify}>测试桌面通知</button>
            {pushUsable ? <button style={styles.button} disabled={busy || pushCount === 0} onClick={testPush}>测试 PWA 推送</button> : null}
          </>
        }
      >
        <Row label="通知事件">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
            {([['notifyTask', '任务完成', notifyTask, setNotifyTask], ['notifyAsk', '等待回答', notifyAsk, setNotifyAsk], ['notifyApproval', '等待审批', notifyApproval, setNotifyApproval], ['notifyDenied', '审批被拒绝', notifyDenied, setNotifyDenied], ['notifySubagent', '子任务结束', notifySubagent, setNotifySubagent], ['notifyGoal', '目标完成/受阻', notifyGoal, setNotifyGoal], ['notifyJobs', '后台任务结束', notifyJobs, setNotifyJobs]] as const).map(([key, label, value, setter]) => (
              <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <input className="enh-event-check" type="checkbox" checked={value} onChange={(event) => setter(event.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </Row>

        <Row label="桌面通知">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={notifyEnabled} onChange={(event) => setNotifyEnabled(event.target.checked)} />
            <span>{notifyEnabled ? '启用' : '停用'}</span>
          </label>
        </Row>

        <Row label="PWA 推送">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: pushUsable ? 1 : 0.5 }}>
            <input type="checkbox" checked={pushUsable && pushEnabled} disabled={!pushUsable} onChange={(event) => setPushEnabled(event.target.checked)} />
            <span>{pushUsable ? (pushEnabled ? '启用' : '停用') : '需要 HTTPS'}</span>
          </label>
          {!pushUsable ? <div style={styles.muted}>当前页面不是 HTTPS/安全上下文，PWA 推送开关置灰；请先启用 HTTPS。</div> : null}
        </Row>

        {pushUsable && pushEnabled ? (
          <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--dsw-alias-border-l4, rgba(0,0,0,.08))' }}>
            <div style={styles.muted}>通知权限：{typeof Notification !== 'undefined' ? Notification.permission : '不可用'}；已订阅设备：{pushCount}。</div>
            <div style={styles.actions}>
              <button style={styles.button} disabled={busy} onClick={deviceSubscribed ? disablePush : enablePush}>
                {deviceSubscribed ? '取消本设备订阅' : '订阅本设备'}
              </button>
            </div>
            <details className="enh-advanced">
              <summary>高级：VAPID 联系地址</summary>
              <Row label="VAPID subject">
                <input style={styles.input} value={pushSubject} onChange={(event) => setPushSubject(event.target.value)} placeholder="mailto:dsh-enhancement@localhost" />
                <div style={styles.muted}>Web Push 协议要求的联系方式，不是登录邮箱，也不需要验证；个人使用保留默认即可。</div>
              </Row>
            </details>
          </div>
        ) : pushUsable ? <div style={styles.muted}>开启 PWA 推送后显示订阅、测试和 VAPID 设置。</div> : null}
      </Block>

      <div style={{ ...styles.card, order: 5 }}>
        <div style={styles.label}>状态文件</div>
        <div style={styles.code}>{status.statePath}</div>
        <div style={styles.muted}>密码只存 scrypt 哈希，DSH 签名密钥不会写入这里。</div>
      </div>
      <Block
        order={5}
        title="会话请求头"
        hint="让非官方 API 路由（如 OpenAI 兼容网关）也携带 DSH 的 session id。官方 DeepSeek API 本来就带，不受影响。"
        dirty={sessionHeaderDirty}
        busy={busy}
        saveLabel="保存会话请求头"
        onSave={saveSessionHeader}
        status={blockStatus.sessionHeader}
      >
        <Row label="启用注入">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sessionHeaderEnabled} onChange={(event) => setSessionHeaderEnabled(event.target.checked)} />
            <span>{sessionHeaderEnabled ? '启用' : '停用'}</span>
          </label>
        </Row>
        <Row label="请求头名称">
          <input
            value={sessionHeaderName}
            onChange={(event) => setSessionHeaderName(event.target.value)}
            placeholder="x-deepseek-harness-session-id"
            style={{ ...styles.input, width: '100%', maxWidth: 360 }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </Row>
        <div style={styles.muted}>
          默认值与 DeepSeek 官方发送的头名一致（<code>x-deepseek-harness-session-id</code>），也可改成上游网关约定的其它名称。
        </div>
        {status.sessionHeader.reason === 'llm-unavailable' ? (
          <div style={styles.error}>{sessionHeaderSummary(true)}</div>
        ) : (
          <div style={styles.muted}>{sessionHeaderSummary()}</div>
        )}
      </Block>

    </div>
  )
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/

function openSession(ctx: ClientContext, sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) return
  let tries = 0
  const tick = () => {
    try {
      if (ctx.uiWorkspace) {
        ctx.uiWorkspace.openSession(sessionId)
        return
      }
    } catch {
      /* service not ready */
    }
    if (tries++ < 30) setTimeout(tick, 500)
  }
  tick()
}

function connectFocusEvents(ctx: ClientContext): (() => void) | undefined {
  if (typeof EventSource === 'undefined') return undefined
  try {
    const source = new EventSource('/_dsh/enhancement/focus')
    const onFocus = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as { sessionId?: unknown }
        if (data.sessionId !== null && typeof data.sessionId !== 'string') return
        try { window.focus() } catch { /* focus may be blocked by the browser */ }
        if (typeof data.sessionId === 'string' && SESSION_ID_PATTERN.test(data.sessionId)) openSession(ctx, data.sessionId)
      } catch {
        /* ignore malformed event */
      }
    }
    source.addEventListener('focus', onFocus as EventListener)
    return () => {
      source.removeEventListener('focus', onFocus as EventListener)
      source.close()
    }
  } catch {
    return undefined
  }
}

function openSessionFromQuery(ctx: ClientContext): void {
  const read = () => {
    try {
      const url = new URL(location.href)
      const sessionId = url.searchParams.get('dsh-session')
      if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return
      url.searchParams.delete('dsh-session')
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      openSession(ctx, sessionId)
    } catch {
      /* ignore */
    }
  }
  read()
  window.addEventListener('popstate', read)
  try {
    navigator.serviceWorker?.addEventListener('message', (event) => {
      const data = event.data as { type?: string; sessionId?: string } | undefined
      if (data?.type === 'dsh-enhancement-open-session' && data.sessionId && SESSION_ID_PATTERN.test(data.sessionId)) openSession(ctx, data.sessionId)
    })
  } catch {
    /* service worker unavailable on HTTP */
  }
}

export function apply(ctx: ClientContext): void {
  openSessionFromQuery(ctx)
  ctx.effect(() => connectFocusEvents(ctx), 'dsh-enhancement: focus existing page')
  ctx.effect(() => {
    return ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: 'dsh-enhancement',
        },
        Card,
      ),
    )
  }, 'dsh-enhancement: plugin config card')
}
