/**
 * dsh-enhancement · 通知引擎（Phase 3）。
 *
 * 原生通知：
 * - Linux：调用系统 notify-send --action（node-notifier 11.0.0 的 Linux 后端
 *   不透传 actions/click，所以这里用一个小 shim 实现点击回调）。
 * - macOS / Windows：node-notifier。
 *
 * 点击时优先通过 SSE 广播给已打开的 DSH 页面（window.focus + openSession），
 * 没有页面连接才回退到 `<base>/?dsh-session=<id>` 深链。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { HostContextLike } from './types.js'
import type { Gateway } from './gateway.js'
import type { PushService } from './push.js'
import { StateStore } from './state.js'
import { focusHub } from './focus.js'

const require = createRequire(import.meta.url)

interface NotifierLike {
  notify(options: Record<string, unknown>, callback?: (error: Error | null, response?: string, metadata?: Record<string, unknown>) => void): unknown
}

interface SessionLike {
  id: string
  header?: { parentSession?: unknown }
}

interface AgentLike {
  session: SessionLike
}

interface SessionTitleSnapshotLike {
  title?: string
}

interface SessionTitleServiceLike {
  get(session: SessionLike): SessionTitleSnapshotLike | undefined
}

interface JobEventLike {
  type: string
  awaited?: boolean
  job?: { kind?: string; label?: string; owner?: string; status?: string }
}

interface JobsServiceLike {
  events: { subscribe(filter: { owners: 'all' }, listener: (event: JobEventLike) => void): () => void }
}

interface NotificationRequest {
  title: string
  body: string
  sessionId?: string
  tag?: string
}

const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n').trim()
}

function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export class NativeNotifier {
  private readonly icon: string
  private readonly notifier: NotifierLike
  private readonly children = new Set<ReturnType<typeof spawn>>()
  private readonly logger: HostContextLike['logger']

  constructor(ctx: HostContextLike) {
    this.icon = fileURLToPath(new URL('../assets/icon-192.png', import.meta.url))
    this.logger = ctx.logger
    this.notifier = require('node-notifier') as NotifierLike
  }

  private open(url: string): void {
    if (!url) return
    try {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
      const child = spawn(command, args, { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (error) {
      this.logger?.warn?.('[dsh-enhancement] failed to open notification target', error)
    }
  }

  private focusOrOpen(sessionId: string | undefined, url: string): void {
    if (focusHub.broadcast(sessionId)) return
    this.open(url)
  }

  show(request: NotificationRequest, url: string): void {
    const title = request.title
    const body = request.body
    const sessionId = request.sessionId
    try {
      if (process.platform === 'linux') {
        this.showLinux(title, body, url, sessionId)
        return
      }
      if (process.platform === 'darwin') {
        this.notifier.notify({ title, message: body, icon: this.icon, open: url, timeout: 10 })
        return
      }
      if (process.platform === 'win32') {
        this.notifier.notify(
          { title, message: body, icon: this.icon, actions: ['打开会话'], wait: true, timeout: 10 },
          (error, _response, metadata) => {
            if (error) return
            const activation = String(metadata?.activationValue ?? '')
            if (activation !== '' || String(metadata?.activationType ?? '').includes('action')) this.focusOrOpen(sessionId, url)
          },
        )
        return
      }
      this.notifier.notify({ title, message: body, icon: this.icon })
    } catch (error) {
      this.logger?.warn?.('[dsh-enhancement] native notification failed', error)
    }
  }

  private showLinux(title: string, body: string, url: string, sessionId: string | undefined): void {
    if (this.children.size >= 24) {
      this.logger?.warn?.('[dsh-enhancement] too many pending native notifications; skipping one')
      return
    }
    const args = [
      '-a', 'dsh-enhancement',
      '-i', this.icon,
      '-t', '15000',
      '-u', 'normal',
      '-A', 'default=打开会话',
      '--',
      truncate(title, 120),
      truncate(body, 400),
    ]
    const child = spawn('notify-send', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.children.add(child)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      this.children.delete(child)
      this.logger?.warn?.('[dsh-enhancement] notify-send failed', error)
    })
    child.on('close', () => {
      this.children.delete(child)
      const selected = stdout.trim()
      if (selected === 'default' || selected === '0' || selected === '1') this.focusOrOpen(sessionId, url)
      else if (stderr.trim() && !/Wait timeout expired/i.test(stderr)) this.logger?.debug?.('[dsh-enhancement] notify-send stderr', stderr.trim())
    })
  }

  stop(): void {
    for (const child of this.children) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    this.children.clear()
  }
}

export class NotificationEngine {
  private disposers: Array<() => void> = []
  private timers = new Map<string, NodeJS.Timeout>()
  private lastAssistant = new Map<string, string>()
  private pendingApprovals = new Map<string, { sessionId: string; toolName: string }>()
  private native: NativeNotifier
  private started = false

  constructor(
    private readonly ctx: HostContextLike,
    private readonly store: StateStore,
    private readonly gateway: Gateway,
    private readonly push: PushService,
  ) {
    this.native = new NativeNotifier(ctx)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.on('agent/status', (payload) => this.onAgentStatus(payload))
    this.on('session/event', (session, event) => this.onSessionEvent(session, event))
    this.on('subagent/end', (payload) => this.onSubagentEnd(payload))
    this.on('goal/changed', (payload) => this.onGoalChanged(payload))
    const jobs = this.ctx.get('jobs') as JobsServiceLike | undefined
    if (jobs?.events && typeof jobs.events.subscribe === 'function') {
      try {
        this.disposers.push(jobs.events.subscribe({ owners: 'all' }, (event) => this.onJobEvent(event)))
      } catch (error) {
        this.ctx.logger?.warn?.('[dsh-enhancement] jobs subscription failed', error)
      }
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    this.native.stop()
    this.started = false
  }

  test(): void {
    this.deliver({ title: 'DSH 通知测试', body: '如果你能看到这条通知，原生通知通道正常。点击会打开 DSH。' }, 'task')
  }

  private on(event: string, listener: (...args: unknown[]) => void): void {
    if (typeof this.ctx.on !== 'function') return
    try {
      const dispose = this.ctx.on(event, listener)
      if (typeof dispose === 'function') this.disposers.push(dispose as () => void)
    } catch {
      /* optional event families may be absent */
    }
  }

  private baseUrl(): string {
    try {
      const status = this.gateway.status([])
      if (status.running && status.url) return status.url
    } catch {
      /* ignore */
    }
    return this.ctx.webServer.getOrigin()
  }

  private sessionTitle(session: SessionLike | undefined): string {
    if (!session) return 'DSH'
    try {
      const service = this.ctx.get('sessionTitle') as SessionTitleServiceLike | undefined
      const title = service?.get(session)?.title
      if (typeof title === 'string' && title.trim()) return title.trim()
    } catch {
      /* ignore */
    }
    return 'DSH 会话'
  }

  private deliver(request: NotificationRequest, kind: 'task' | 'ask' | 'approval' | 'denied' | 'subagent' | 'goal' | 'jobs'): void {
    const config = this.store.config
    if (!config.notifyEnabled && !config.pushEnabled) return
    if (!config[`notify${kind[0].toUpperCase()}${kind.slice(1)}` as keyof typeof config]) return
    const sessionId = request.sessionId && SESSION_ID.test(request.sessionId) ? request.sessionId : undefined
    const base = this.baseUrl().replace(/\/$/, '')
    const url = sessionId ? `${base}/?dsh-session=${encodeURIComponent(sessionId)}` : `${base}/`
    if (config.notifyEnabled) this.native.show(request, url)
    if (config.pushEnabled) void this.push.send({ title: request.title, body: request.body, sessionId, tag: request.tag })
  }

  private onAgentStatus(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const { agent, status } = payload as { agent?: AgentLike; status?: string }
    const session = agent?.session
    if (!session || typeof session.id !== 'string') return
    if (status !== 'idle') {
      const timer = this.timers.get(session.id)
      if (timer) clearTimeout(timer)
      this.timers.delete(session.id)
      return
    }
    if (session.header?.parentSession) return
    const existing = this.timers.get(session.id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(session.id)
      const last = this.lastAssistant.get(session.id)
      this.deliver({
        title: this.sessionTitle(session),
        body: last ? truncate(last, 220) : '任务已完成',
        sessionId: session.id,
      }, 'task')
    }, 3000)
    this.timers.set(session.id, timer)
  }

  private onSessionEvent(session: unknown, event: unknown): void {
    if (!session || typeof session !== 'object' || !event || typeof event !== 'object') return
    const sessionLike = session as SessionLike
    if (typeof sessionLike.id !== 'string') return
    const record = event as { type?: string; data?: unknown }
    const type = record.type
    if (!type) return
    if (type === 'assistant/message') {
      const data = record.data as { message?: { content?: unknown } } | undefined
      const text = textOfContent(data?.message?.content)
      if (text) this.lastAssistant.set(sessionLike.id, text)
      return
    }
    if (type === 'tool/call') {
      const data = record.data as { name?: string; arguments?: string } | undefined
      if (data?.name !== 'ask_user_question') return
      let detail = '等待你的回答'
      try {
        const parsed = JSON.parse(data.arguments ?? '{}') as { questions?: Array<{ header?: string; question?: string }> }
        const first = parsed.questions?.[0]
        if (first) detail = [first.header, first.question].filter(Boolean).join('：') || detail
      } catch {
        /* keep generic */
      }
      this.deliver({ title: this.sessionTitle(sessionLike), body: truncate(detail, 220), sessionId: sessionLike.id }, 'ask')
      return
    }
    if (type === 'approval/asked') {
      const data = record.data as { id?: string; toolName?: string; reason?: string } | undefined
      const tool = data?.toolName ?? '工具'
      if (data?.id) this.pendingApprovals.set(data.id, { sessionId: sessionLike.id, toolName: tool })
      this.deliver({
        title: this.sessionTitle(sessionLike),
        body: truncate(`等待审批：${tool}${data?.reason ? `（${data.reason}）` : ''}`, 220),
        sessionId: sessionLike.id,
      }, 'approval')
      return
    }
    if (type === 'approval/decided') {
      const data = record.data as { id?: string; outcome?: string } | undefined
      if (data?.outcome !== 'rejected') return
      const pending = data.id ? this.pendingApprovals.get(data.id) : undefined
      if (data.id) this.pendingApprovals.delete(data.id)
      this.deliver({
        title: this.sessionTitle(sessionLike),
        body: truncate(`审批被拒绝：${pending?.toolName ?? '工具'}`, 220),
        sessionId: pending?.sessionId ?? sessionLike.id,
      }, 'denied')
    }
  }

  private onSubagentEnd(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const record = payload as { id?: string; provider?: string; stopReason?: string; lastAssistantMessage?: unknown }
    if (typeof record.id !== 'string') return
    const text = textOfContent(record.lastAssistantMessage)
    this.deliver({
      title: 'DSH 子任务',
      body: truncate(text || `子任务${record.stopReason === 'completed' ? '已完成' : `结束（${record.stopReason ?? 'unknown'}）`}`, 220),
      sessionId: record.id,
    }, 'subagent')
  }

  private onGoalChanged(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const record = payload as {
      agent?: AgentLike
      change?: { operation?: string; goal?: { objective?: string; blockedReason?: { message?: string } } }
    }
    const operation = record.change?.operation
    if (operation !== 'complete' && operation !== 'block') return
    const sessionId = record.agent?.session?.id
    const objective = record.change?.goal?.objective ?? ''
    const blocked = record.change?.goal?.blockedReason?.message
    this.deliver({
      title: operation === 'complete' ? 'DSH 目标完成' : 'DSH 目标受阻',
      body: truncate(operation === 'complete' ? objective || '目标已完成' : blocked || objective || '目标被阻塞', 220),
      sessionId,
    }, 'goal')
  }

  private onJobEvent(event: JobEventLike): void {
    if (event.type !== 'settled' || !event.job) return
    if (event.awaited === true) return
    const job = event.job
    if (job.kind === 'subagent') return
    const status = job.status === 'completed' ? '已完成' : job.status === 'killed' ? '被终止' : '失败'
    this.deliver({
      title: 'DSH 后台任务',
      body: truncate(`${job.label ?? '任务'} ${status}`, 220),
      sessionId: job.owner,
    }, 'jobs')
  }
}
