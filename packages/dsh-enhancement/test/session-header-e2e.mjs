// 端到端验证：真实的 pi-ai adapter 形态 + 真实 HTTP 上游，断言会话头真的到达了
// 网络层（而不只是在内存里的 options 上）。
//
// 运行：node test/session-header-e2e.mjs
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { patchAdapterPrototype, restorePrototypes, DEFAULT_SESSION_HEADER_NAME } from '../lib/session-header.js'

const seen = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      `data: ${JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
      })}\n\n`,
    )
    res.write(
      `data: ${JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    )
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

// 引用宿主同源版本的 pi-ai，保证测的是真实传输实现。
const piAiBase = process.env.DSH_PI_AI_PATH ?? null
let streamSimple
if (piAiBase !== null) {
  ;({ streamSimple } = await import(`${piAiBase}/dist/api/openai-completions.js`))
} else {
  console.log('skip: set DSH_PI_AI_PATH to the pi-ai package dir to run this e2e test')
  server.close()
  process.exit(0)
}

const model = {
  id: 'group/deepseek-flash',
  name: 'deepseek-flash',
  api: 'openai-completions',
  provider: 'magpie-blocgo-tech',
  baseUrl: `http://127.0.0.1:${port}/v1`,
  input: ['text'],
  contextWindow: 1000000,
  maxTokens: 1024,
}

// 复刻 dsh-llm-pi-ai 的调用形态：profileOptions/headers 由 adapter 构造后交给 pi-ai。
const models = {
  streamSimple: (m, context, options) => streamSimple(m, context, options),
}
class PiAiAdapterLike {
  async *streamWithSnapshot(options, snapshot) {
    const iterator = snapshot.models.streamSimple(model, { messages: [{ role: 'user', content: 'hi' }] }, {
      apiKey: 'test-key',
      maxRetries: 0,
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      // 宿主用 requestHeaders(profile.headers) 重建 headers，这里模拟已有部署头。
      headers: { 'x-deployment': 'unit-test' },
    })
    for await (const chunk of iterator) yield chunk
  }
  stream(options) {
    return this.streamWithSnapshot(options, { models })
  }
}

async function drive(adapter, options) {
  const stream = adapter.stream(options)
  for await (const _chunk of stream) {
    /* drain */
  }
  return seen.at(-1)
}

// 1) 开启：头到达 HTTP 层
restorePrototypes()
const adapter = new PiAiAdapterLike()
let switchSettings = { enabled: true, headerName: DEFAULT_SESSION_HEADER_NAME }
assert.equal(patchAdapterPrototype(adapter, () => switchSettings, () => true), true)
let last = await drive(adapter, { sessionId: 'session-e2e-abc' })
assert.equal(last.headers[DEFAULT_SESSION_HEADER_NAME], 'session-e2e-abc')
assert.equal(last.headers['x-deployment'], 'unit-test', '部署头必须保留')
console.log('PASS 开启：上游收到', DEFAULT_SESSION_HEADER_NAME, '=', last.headers[DEFAULT_SESSION_HEADER_NAME])

// 2) 关闭：头不出现
switchSettings = { enabled: false, headerName: DEFAULT_SESSION_HEADER_NAME }
last = await drive(adapter, { sessionId: 'session-e2e-abc' })
assert.equal(last.headers[DEFAULT_SESSION_HEADER_NAME], undefined)
console.log('PASS 关闭：上游未收到会话头')
switchSettings = { enabled: true, headerName: DEFAULT_SESSION_HEADER_NAME }

// 3) 关闭状态下重新打开（设置热更新）
const hotAdapter = new PiAiAdapterLike()
let settings = { enabled: false, headerName: DEFAULT_SESSION_HEADER_NAME }
assert.equal(patchAdapterPrototype(hotAdapter, () => settings, () => true), true)
last = await drive(hotAdapter, { sessionId: 'session-hot' })
assert.equal(last.headers[DEFAULT_SESSION_HEADER_NAME], undefined)
settings = { enabled: true, headerName: 'x-custom-session' }
last = await drive(hotAdapter, { sessionId: 'session-hot' })
assert.equal(last.headers['x-custom-session'], 'session-hot')
console.log('PASS 热更新：切换到自定义头名后上游收到 x-custom-session')

// 4) 缺 sessionId：不注入
last = await drive(adapter, {})
assert.equal(last.headers[DEFAULT_SESSION_HEADER_NAME], undefined)
console.log('PASS 缺 sessionId：不注入空头')

restorePrototypes()
server.close()
console.log('\nAll e2e assertions passed.')
