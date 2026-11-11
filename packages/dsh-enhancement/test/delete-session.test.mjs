// 删除会话的行为测试：sessionId 白名单、会话目录解析的安全边界、配置默认值。
//
// 运行：node --test test/delete-session.test.mjs（pretest 会先 build 到 lib/）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSafeSessionId, resolveSessionDir } from '../lib/delete-session.js'
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
