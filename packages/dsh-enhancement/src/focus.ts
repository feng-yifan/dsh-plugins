/**
 * dsh-enhancement · 聚焦已有 DSH 页面
 *
 * 原生通知（尤其是 Linux notify-send）没有 PWA Service Worker 的 clients.matchAll，
 * 直接 xdg-open 会在浏览器里新开标签。这里用 SSE 维护已打开的 DSH 页面：
 * 点击原生通知时先广播 sessionId；有页面连接则由页面 window.focus() + openSession()，
 * 没有页面连接才回退到打开 URL。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

class FocusHub {
  private readonly clients = new Set<ServerResponse>()
  private heartbeat: NodeJS.Timeout | undefined

  subscribe(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    this.clients.add(res)
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const client of this.clients) {
          try {
            client.write(': ping\n\n')
          } catch {
            this.clients.delete(client)
          }
        }
      }, 20_000)
      this.heartbeat.unref?.()
    }
    const cleanup = (): void => {
      this.clients.delete(res)
      if (this.clients.size === 0 && this.heartbeat) {
        clearInterval(this.heartbeat)
        this.heartbeat = undefined
      }
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }

  get size(): number {
    return this.clients.size
  }

  /** @returns true when at least one open page received the event. */
  broadcast(sessionId?: string): boolean {
    const payload = JSON.stringify({ sessionId: sessionId ?? null })
    let delivered = 0
    for (const client of this.clients) {
      try {
        client.write(`event: focus\ndata: ${payload}\n\n`)
        delivered += 1
      } catch {
        this.clients.delete(client)
      }
    }
    return delivered > 0
  }

  stop(): void {
    for (const client of this.clients) {
      try {
        client.end()
      } catch {
        /* ignore */
      }
    }
    this.clients.clear()
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
  }
}

export const focusHub = new FocusHub()
