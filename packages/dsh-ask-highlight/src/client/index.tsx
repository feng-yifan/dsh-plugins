/**
 * dsh-ask-highlight 浏览器半侧：插件管理页（设置 → 插件 → dsh-ask-highlight）配置卡。
 *
 * 只有两个开关，所以不复用 dsh-enhancement 那套分块卡片，一张卡直接给：
 *   - 高亮已答复的提问块（enabled）
 *   - 提问块默认展开（defaultExpanded）
 *
 * 数据通路与控制 API 一致：
 *   GET  /_dsh/ask-highlight/status  → 读取当前值
 *   POST /_dsh/ask-highlight/config  → 保存
 * 保存后刷新页面生效（注入在 index 渲染时按最新配置决定）。
 */
import React, { useCallback, useEffect, useState } from 'react'

const API = '/_dsh/ask-highlight'

/** 宿主返回的状态。 */
interface Status {
  enabled: boolean
  defaultExpanded: boolean
  statePath: string
  stateDir: string
}

/** 客户端 cordis 上下文切片（结构化声明，不 import 宿主包）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: React.ComponentType<Record<string, unknown>>): () => void
  }
}

export const inject = ['slots']

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
  if (!response.ok) {
    let detail = `HTTP ${String(response.status)}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') detail = body.error
    } catch {
      /* 非 JSON 错误体：保留状态码 */
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' as const },
  title: { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' },
  muted: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary, #667085)' },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '10px 0',
    borderTop: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.08))',
  },
  rowText: { minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column' as const, gap: 2 },
  rowLabel: { fontSize: 13, color: 'var(--dsw-alias-label-primary, inherit)' },
  rowHint: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary, #667085)' },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, paddingTop: 4 },
  button: {
    height: 32,
    padding: '0 14px',
    borderRadius: 'var(--dsw-radius-md, 12px)',
    border: '.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.16))',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary, inherit)',
    cursor: 'pointer',
    fontSize: 13,
  },
  primary: {
    background: 'var(--dsw-alias-state-business-primary, #4d8dff)',
    borderColor: 'transparent',
    color: '#fff',
    fontWeight: 600,
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    wordBreak: 'break-all' as const,
    background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04))',
    color: 'var(--dsw-alias-label-secondary, #475467)',
    padding: '6px 8px',
    borderRadius: 8,
  },
  error: { color: 'var(--dsw-alias-state-danger-primary, #d92d20)', fontSize: 12, lineHeight: 1.5 },
  success: { color: 'var(--dsw-alias-state-success-primary, #079455)', fontSize: 12, lineHeight: 1.5 },
}

/** 与 DSH 其它设置项一致的开关外观。 */
const SWITCH_CSS = `
.askhl-root input[type="checkbox"] { appearance:none; flex:none; width:36px; height:20px; border-radius:999px;
  background:var(--dsw-alias-border-l2, #d0d5dd); position:relative; cursor:pointer; transition:background .15s; margin:0; }
.askhl-root input[type="checkbox"]::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px;
  border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2); transition:transform .15s; }
.askhl-root input[type="checkbox"]:checked { background:var(--dsw-alias-state-business-primary, #4d8dff); }
.askhl-root input[type="checkbox"]:checked::after { transform:translateX(16px); }
.askhl-root input[type="checkbox"]:disabled { opacity:.45; cursor:not-allowed; }
.askhl-root input[type="checkbox"]:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #4d8dff); outline-offset:2px; }
.askhl-root button:disabled { opacity:.42; cursor:not-allowed; }
`

function Switch(props: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
}): React.ReactElement {
  return (
    <label style={styles.row}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.label}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span style={styles.rowText}>
        <span style={styles.rowLabel}>{props.label}</span>
        <span style={styles.rowHint}>{props.hint}</span>
      </span>
    </label>
  )
}

function Card(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null)
  const [draft, setDraft] = useState<{ enabled: boolean; defaultExpanded: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const adopt = useCallback((next: Status) => {
    setStatus(next)
    setDraft({ enabled: next.enabled, defaultExpanded: next.defaultExpanded })
  }, [])

  useEffect(() => {
    let alive = true
    api<Status>('/status')
      .then((next) => {
        if (alive) adopt(next)
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      alive = false
    }
  }, [adopt])

  const dirty =
    draft !== null && status !== null && (draft.enabled !== status.enabled || draft.defaultExpanded !== status.defaultExpanded)

  const save = useCallback(async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      adopt(await api<Status>('/config', { method: 'POST', body: JSON.stringify(draft) }))
      setNotice('已保存。刷新页面后生效。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [adopt, draft])

  return (
    <div className="askhl-root" style={styles.wrap}>
      <style>{SWITCH_CSS}</style>
      <div style={styles.head}>
        <div>
          <h3 style={styles.title}>提问块高亮</h3>
          <div style={styles.muted}>把已答复的「提问 n/n 已回答」工具块显示为柔和卡片，并可让提问块默认展开。</div>
        </div>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}
      {notice ? <div style={styles.success}>{notice}</div> : null}

      {draft === null ? (
        <div style={styles.muted}>正在读取配置…</div>
      ) : (
        <>
          <Switch
            label="高亮已答复的提问块"
            hint="关闭后既不注入高亮样式，也不注入展开脚本。等待中的提问块始终不受影响。"
            checked={draft.enabled}
            disabled={busy}
            onChange={(next) => setDraft({ ...draft, enabled: next })}
          />
          <Switch
            label="提问块默认展开"
            hint="打开后，线程里每个提问块（等待回答 / 已答复 / 已取消）首次出现时自动展开；你手动收起后不会被再次展开。"
            checked={draft.defaultExpanded}
            disabled={busy || !draft.enabled}
            onChange={(next) => setDraft({ ...draft, defaultExpanded: next })}
          />
          <div style={styles.actions}>
            <button style={{ ...styles.button, ...styles.primary }} disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? '保存中…' : '保存'}
            </button>
            {status ? <span style={styles.muted}>配置存于 <code style={styles.code}>{status.statePath}</code></span> : null}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * 客户端插件入口：把配置卡注册到插件管理页的 bundle 配置槽位。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    return ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: 'dsh-ask-highlight',
        },
        Card,
      ),
    )
  }, 'dsh-ask-highlight: plugin config card')
}
