// 删除会话的行为测试：sessionId 白名单、会话目录解析的安全边界、配置默认值。
//
// 运行：node --test test/delete-session.test.mjs（pretest 会先 build 到 lib/）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSafeSessionId, resolveSessionDir, deleteSessionStorage } from '../lib/delete-session.js'
import { normalizeConfig } from '../lib/state.js'

const HOST = '127.0.0.1'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-delete-session-'))
}

test('isSafeSessionId 接受合法 ID、拒绝路径穿越与非法字符', () => {
  assert.equal(isSafeSessionId('abc123'), true)
  assert.equal(isSafeSessionId('session-2026.11_11'), true)
  assert.equal(isSafeSessionId('a'), true)
  assert.equal(isSafeSessionId('A'.repeat(128)), true)

  assert.equal(isSafeSessionId(''), false)
  assert.equal(isSafeSessionId('.'), false)
  assert.equal(isSafeSessionId('..'), false)
  assert.equal(isSafeSessionId('-starts-with-dash'), false)
  assert.equal(isSafeSessionId('.hidden'), false)
  assert.equal(isSafeSessionId('a/b'), false)
  assert.equal(isSafeSessionId('a\\b'), false)
  assert.equal(isSafeSessionId('../escape'), false)
  assert.equal(isSafeSessionId('a'.repeat(129)), false)
  assert.equal(isSafeSessionId('has space'), false)
  assert.equal(isSafeSessionId(undefined), false)
  assert.equal(isSafeSessionId(123), false)
  assert.equal(isSafeSessionId(null), false)
})

test('resolveSessionDir：合法目录（传日志文件路径或目录本身都可）', () => {
  const root = tempRoot()
  try {
    const sessionDir = join(root, 'proj-a', 'session-abc')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), 'x')
    const viaFile = resolveSessionDir(join(sessionDir, 'session.v4.jsonl.zstd'), root)
    const viaDir = resolveSessionDir(sessionDir, root)
    assert.equal(viaFile, viaDir)
    assert.equal(viaFile, sessionDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveSessionDir：越界目录抛 delete.unsafe-path', () => {
  const root = tempRoot()
  const outside = tempRoot()
  try {
    // 直接位于 root 下一级（缺少 projectDir 这一层）
    const flatDir = join(root, 'session-abc')
    mkdirSync(flatDir, { recursive: true })
    writeFileSync(join(flatDir, 'session.v4.jsonl.zstd'), 'x')
    assert.throws(
      () => resolveSessionDir(join(flatDir, 'session.v4.jsonl.zstd'), root),
      (error) => error.code === 'delete.unsafe-path',
    )

    // 完全在 root 之外
    const outsideDir = join(outside, 'proj-a', 'session-abc')
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'session.v4.jsonl.zstd'), 'x')
    assert.throws(
      () => resolveSessionDir(join(outsideDir, 'session.v4.jsonl.zstd'), root),
      (error) => error.code === 'delete.unsafe-path',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('resolveSessionDir：目录内没有会话日志时抛 delete.unsafe-path', () => {
  const root = tempRoot()
  try {
    const sessionDir = join(root, 'proj-a', 'session-abc')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'notes.txt'), 'not a session log')
    assert.throws(
      () => resolveSessionDir(sessionDir, root),
      (error) => error.code === 'delete.unsafe-path',
    )
    assert.equal(existsSync(sessionDir), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('normalizeConfig：sessionDeleteConfirm 默认开、可显式关闭', () => {
  assert.equal(normalizeConfig({}, HOST).sessionDeleteConfirm, true)
  assert.equal(normalizeConfig({ sessionDeleteConfirm: false }, HOST).sessionDeleteConfirm, false)
  assert.equal(normalizeConfig({ sessionDeleteConfirm: true }, HOST).sessionDeleteConfirm, true)
})

// ---- deleteSessionStorage 行为测试（假 ctx） ----

const SESSION_ID = 'sessX'

/** 构造 <root>/sessions/proj/sessX/session.v4.jsonl.zstd 并返回相关路径。 */
function makeSessionsFixture() {
  const base = tempRoot()
  const root = join(base, 'sessions')
  const sessionDir = join(root, 'proj', SESSION_ID)
  mkdirSync(sessionDir, { recursive: true })
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd')
  writeFileSync(logPath, 'x')
  return { base, root, sessionDir, logPath }
}

/** 假 ctx：服务由 get(name) 返回，parallel 与注册表调用都被记录。 */
function makeFakeCtx({ root, agent, stat, onParallel, registryCalls }) {
  const services = {
    agents: { get: () => agent },
    sessionPersistence: { stat: async () => stat },
    workspaceRegistry: {
      unarchiveSession: async (id) => registryCalls.push(['unarchive', id]),
      unpinSession: async (id) => registryCalls.push(['unpin', id]),
      list: () => [],
    },
    // deleteSessionStorage 只调用 hp('sessions')，这里直接返回 sessions 根目录。
    dshHomePath: () => root,
  }
  return {
    get: (name) => services[name],
    parallel: async (event, data) => onParallel.push({ event, data }),
  }
}

test('deleteSessionStorage：运行中 agent 会被停止，随后删除目录', async () => {
  const { base, root, sessionDir, logPath } = makeSessionsFixture()
  const onParallel = []
  const registryCalls = []
  try {
    let idleCalled = false
    const agent = {
      status: 'running',
      whenIdle: async () => {
        idleCalled = true
      },
    }
    const ctx = makeFakeCtx({
      root,
      agent,
      stat: { location: { kind: 'jsonl', path: logPath } },
      onParallel,
      registryCalls,
    })
    const result = await deleteSessionStorage(ctx, SESSION_ID)
    assert.equal(idleCalled, true)
    assert.deepEqual(onParallel, [{ event: 'workspace/session-stop', data: { sessionId: SESSION_ID } }])
    assert.equal(existsSync(sessionDir), false)
    assert.deepEqual(result, { deleted: true, stopped: true })
    assert.deepEqual(registryCalls, [['unarchive', SESSION_ID], ['unpin', SESSION_ID]])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('deleteSessionStorage：无 agent 或 idle 时不等待，直接删除', async () => {
  const { base, root, sessionDir, logPath } = makeSessionsFixture()
  const onParallel = []
  const registryCalls = []
  try {
    // 无 agent
    const ctxNoAgent = makeFakeCtx({
      root,
      agent: undefined,
      stat: { location: { kind: 'jsonl', path: logPath } },
      onParallel,
      registryCalls,
    })
    const resultNoAgent = await deleteSessionStorage(ctxNoAgent, SESSION_ID)
    assert.deepEqual(resultNoAgent, { deleted: true, stopped: false })
    assert.equal(onParallel.length, 1)
    assert.equal(existsSync(sessionDir), false)

    // idle agent：不应调用 whenIdle，也不等待
    const { base: base2, root: root2, sessionDir: sessionDir2, logPath: logPath2 } = makeSessionsFixture()
    let idleCalled = false
    const idleAgent = {
      status: 'idle',
      whenIdle: async () => {
        idleCalled = true
      },
    }
    const ctxIdle = makeFakeCtx({
      root: root2,
      agent: idleAgent,
      stat: { location: { kind: 'jsonl', path: logPath2 } },
      onParallel: [],
      registryCalls: [],
    })
    const resultIdle = await deleteSessionStorage(ctxIdle, SESSION_ID)
    assert.equal(idleCalled, false)
    assert.deepEqual(resultIdle, { deleted: true, stopped: false })
    assert.equal(existsSync(sessionDir2), false)
    rmSync(base2, { recursive: true, force: true })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('deleteSessionStorage：stat 取不到时返回 not-found，且目录不存在也不报错', async () => {
  const base = tempRoot()
  const root = join(base, 'sessions')
  const registryCalls = []
  const onParallel = []
  try {
    const ctx = makeFakeCtx({
      root,
      agent: undefined,
      stat: undefined,
      onParallel,
      registryCalls,
    })
    const result = await deleteSessionStorage(ctx, SESSION_ID)
    assert.deepEqual(result, { deleted: false, reason: 'not-found' })
    assert.deepEqual(registryCalls, [['unarchive', SESSION_ID], ['unpin', SESSION_ID]])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('deleteSessionStorage：路径越界抛 delete.unsafe-path，目录未被删', async () => {
  const outside = tempRoot()
  const base = tempRoot()
  const root = join(base, 'sessions')
  try {
    const outsideDir = join(outside, 'proj', SESSION_ID)
    mkdirSync(outsideDir, { recursive: true })
    const outsideLog = join(outsideDir, 'session.v4.jsonl.zstd')
    writeFileSync(outsideLog, 'x')
    const ctx = makeFakeCtx({
      root,
      agent: undefined,
      stat: { location: { kind: 'jsonl', path: outsideLog } },
      onParallel: [],
      registryCalls: [],
    })
    await assert.rejects(
      () => deleteSessionStorage(ctx, SESSION_ID),
      (error) => error.code === 'delete.unsafe-path',
    )
    assert.equal(existsSync(outsideDir), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('deleteSessionStorage：运行中且 whenIdle 超时抛 session.stop-timeout', async () => {
  const { base, root, sessionDir, logPath } = makeSessionsFixture()
  try {
    const agent = {
      status: 'running',
      // 永不 resolve，触发注入的短超时
      whenIdle: () => new Promise(() => {}),
    }
    const ctx = makeFakeCtx({
      root,
      agent,
      stat: { location: { kind: 'jsonl', path: logPath } },
      onParallel: [],
      registryCalls: [],
    })
    await assert.rejects(
      () => deleteSessionStorage(ctx, SESSION_ID, { stopTimeoutMs: 20 }),
      (error) => error.code === 'session.stop-timeout',
    )
    // 停止超时时不应删除目录
    assert.equal(existsSync(sessionDir), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
