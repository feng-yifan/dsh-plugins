/**
 * dsh-at-enhancement 浏览器半侧：插件管理页（设置 → 插件 → dsh-at-enhancement）配置卡。
 *
 * 只有一张卡：外部文件引用（@）总开关 + provider 挂载状态展示。
 *
 * 数据通路与控制 API 一致：
 *   GET  /_dsh/at-enhancement/status  → 读取当前值
 *   POST /_dsh/at-enhancement/config  → 保存
 * 保存后 `list` 下一次调用即按最新配置求值，通常无需刷新；为与其它插件一致，
 * 卡片仍提示刷新。
 */
import React, { useCallback, useEffect, useState } from 'react'

const API = '/_dsh/at-enhancement'

/** 宿主返回的状态。 */
interface Status {
  enabled: boolean
  provider: 'active' | 'missing'
  maxResults: number
  statePath: string
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
  metaRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, paddingTop: 4 },
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
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04))',
    color: 'var(--dsw-alias-label-secondary, #475467)',
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
  error: { color: 'var(--dsw-alias-state-error-primary, #d92d20)', fontSize: 12, lineHeight: 1.5 },
  success: { color: 'var(--dsw-alias-state-success-primary, #079455)', fontSize: 12, lineHeight: 1.5 },
}

/** 与 DSH 其它设置项一致的开关外观。 */
const SWITCH_CSS = `
.atenh-root input[type="checkbox"] { appearance:none; flex:none; width:36px; height:20px; border-radius:999px;
  background:var(--dsw-alias-border-l2, #d0d5dd); position:relative; cursor:pointer; transition:background .15s; margin:0; }
.atenh-root input[type="checkbox"]::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px;
  border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2); transition:transform .15s; }
.atenh-root input[type="checkbox"]:checked { background:var(--dsw-alias-state-business-primary, #4d8dff); }
.atenh-root input[type="checkbox"]:checked::after { transform:translateX(16px); }
.atenh-root input[type="checkbox"]:disabled { opacity:.45; cursor:not-allowed; }
.atenh-root input[type="checkbox"]:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #4d8dff); outline-offset:2px; }
.atenh-root button:disabled { opacity:.42; cursor:not-allowed; }
`

const PROVIDER_TEXT: Record<Status['provider'], string> = {
  active: '已挂载到宿主 fileReferences',
  missing: '宿主 fileReferences 不可用，已旁路',
}

function Card(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null)
  const [draft, setDraft] = useState<{ enabled: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const adopt = useCallback((next: Status) => {
    setStatus(next)
    setDraft({ enabled: next.enabled })
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

  const dirty = draft !== null && status !== null && draft.enabled !== status.enabled

  const save = useCallback(async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      adopt(await api<Status>('/config', { method: 'POST', body: JSON.stringify(draft) }))
      setNotice('已保存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [adopt, draft])

  return (
    <div className="atenh-root" style={styles.wrap}>
      <style>{SWITCH_CSS}</style>
      <div style={styles.head}>
        <div>
          <h3 style={styles.title}>外部文件引用（@）</h3>
          <div style={styles.muted}>
            输入 @/ 或 @~/ 可逐级浏览并引用工作区外文件；选中后插入绝对路径；实际读取由 read 工具按当前会话权限执行。
          </div>
        </div>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}
      {notice ? <div style={styles.success}>{notice}</div> : null}

      {draft === null ? (
        <div style={styles.muted}>正在读取配置…</div>
      ) : (
        <>
          <label style={styles.row}>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              aria-label="启用外部文件引用（@）"
              onChange={(event) => setDraft({ enabled: event.target.checked })}
            />
            <span style={styles.rowText}>
              <span style={styles.rowLabel}>启用外部文件引用（@）</span>
              <span style={styles.rowHint}>
                关闭后 @ 补全只列当前会话工作区内的文件，与 DSH 原生行为一致。
              </span>
            </span>
          </label>

          <div style={styles.metaRow}>
            <span style={styles.badge}>provider：{status ? PROVIDER_TEXT[status.provider] : '未知'}</span>
            {status ? <span style={styles.muted}>最多 {status.maxResults} 条候选</span> : null}
          </div>

          <div style={styles.actions}>
            <button style={{ ...styles.button, ...styles.primary }} disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? '保存中…' : '保存'}
            </button>
            {status ? (
              <span style={styles.muted}>
                配置存于 <code style={styles.code}>{status.statePath}</code>
              </span>
            ) : null}
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
          key: 'dsh-at-enhancement',
        },
        Card,
      ),
    )
  }, 'dsh-at-enhancement: plugin config card')
}
