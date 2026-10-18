class FocusHub {
    clients = new Set();
    heartbeat;
    subscribe(req, res) {
        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
        });
        res.write(': connected\n\n');
        this.clients.add(res);
        if (!this.heartbeat) {
            this.heartbeat = setInterval(() => {
                for (const client of this.clients) {
                    try {
                        client.write(': ping\n\n');
                    }
                    catch {
                        this.clients.delete(client);
                    }
                }
            }, 20_000);
            this.heartbeat.unref?.();
        }
        const cleanup = () => {
            this.clients.delete(res);
            if (this.clients.size === 0 && this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = undefined;
            }
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }
    get size() {
        return this.clients.size;
    }
    /** @returns true when at least one open page received the event. */
    broadcast(sessionId) {
        const payload = JSON.stringify({ sessionId: sessionId ?? null });
        let delivered = 0;
        for (const client of this.clients) {
            try {
                client.write(`event: focus\ndata: ${payload}\n\n`);
                delivered += 1;
            }
            catch {
                this.clients.delete(client);
            }
        }
        return delivered > 0;
    }
    stop() {
        for (const client of this.clients) {
            try {
                client.end();
            }
            catch {
                /* ignore */
            }
        }
        this.clients.clear();
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
    }
}
export const focusHub = new FocusHub();
//# sourceMappingURL=focus.js.map