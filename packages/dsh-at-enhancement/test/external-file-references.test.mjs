// dsh-at-enhancement · 外部文件引用核心逻辑行为测试
//
// 运行：node --test test/external-file-references.test.mjs
// 覆盖：路径展开 / 外部查询判定 / 逐级目录枚举 / 包装透传与合并 / 开关 / 还原 / 挂载。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expandSpecial,
  isExternalQuery,
  listExternal,
  mountExternalFileReferences,
  wrapFileReferences,
} from '../lib/external-file-references.js'

const SIGNAL = new AbortController().signal

/** 建一棵临时树：sub/ 目录、a.md、.hidden，返回根目录。 */
async function makeTree() {
  const root = await fs.mkdtemp(join(tmpdir(), 'dsh-at-enh-'))
  await fs.mkdir(join(root, 'sub'))
  await fs.writeFile(join(root, 'a.md'), 'hello')
  await fs.writeFile(join(root, '.hidden'), 'secret')
  return root
}

test('expandSpecial：~ / ~/x / 绝对路径 / 空串', () => {
  assert.equal(expandSpecial('~'), homedir())
  assert.equal(expandSpecial('~/x'), join(homedir(), 'x'))
  assert.equal(expandSpecial('/a/b'), '/a/b')
  assert.equal(expandSpecial(''), '')
})

test('expandSpecial：反斜杠统一成 /', () => {
  assert.equal(expandSpecial('/a\\b\\c'), '/a/b/c')
})

test('isExternalQuery：相对路径与关键词不算外部，绝对/家目录算外部', () => {
  assert.equal(isExternalQuery('foo'), false)
  assert.equal(isExternalQuery('src/a'), false)
  assert.equal(isExternalQuery('/x'), true)
  assert.equal(isExternalQuery('~'), true)
  assert.equal(isExternalQuery('~/x'), true)
})

test('listExternal：目录列表包含子目录与文件、不含隐藏项', async () => {
  const root = await makeTree()
  try {
    const results = await listExternal(`${root}/`, SIGNAL)
    const names = results.map((item) => item.path.slice(root.length + 1))
    assert.ok(names.includes('sub'))
    assert.ok(names.includes('a.md'))
    assert.ok(!names.includes('.hidden'))
    const sub = results.find((item) => item.path === join(root, 'sub'))
    assert.equal(sub?.kind, 'directory')
    const file = results.find((item) => item.path === join(root, 'a.md'))
    assert.equal(file?.kind, 'file')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('listExternal：fragment 过滤返回 sub 目录候选', async () => {
  const root = await makeTree()
  try {
    const results = await listExternal(`${root}/su`, SIGNAL)
    assert.equal(results.length, 1)
    assert.equal(results[0].path, join(root, 'sub'))
    assert.equal(results[0].kind, 'directory')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('listExternal：fragment 过滤返回 a.md 文件候选', async () => {
  const root = await makeTree()
  try {
    const results = await listExternal(`${root}/a`, SIGNAL)
    assert.equal(results.length, 1)
    assert.equal(results[0].path, join(root, 'a.md'))
    assert.equal(results[0].kind, 'file')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('listExternal：fragment 以 . 开头时隐藏项可出现', async () => {
  const root = await makeTree()
  try {
    const results = await listExternal(`${root}/.`, SIGNAL)
    assert.ok(results.some((item) => item.path === join(root, '.hidden')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('listExternal：不存在的目录返回空数组', async () => {
  const root = await makeTree()
  try {
    const results = await listExternal(`${root}/nope/`, SIGNAL)
    assert.deepEqual(results, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('listExternal：maxResults 截断', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'dsh-at-enh-max-'))
  try {
    for (let i = 0; i < 6; i += 1) {
      await fs.writeFile(join(root, `f${i}.txt`), 'x')
    }
    const results = await listExternal(`${root}/`, SIGNAL, 2)
    assert.ok(results.length <= 2)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('listExternal：已 abort 的 signal 返回空数组', async () => {
  const root = await makeTree()
  try {
    const controller = new AbortController()
    controller.abort()
    const results = await listExternal(`${root}/`, controller.signal)
    assert.deepEqual(results, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('wrapFileReferences：非外部查询原样透传', async () => {
  const base = { list: async () => [{ path: 'ws.md', kind: 'file' }] }
  const wrapper = wrapFileReferences(base, () => ({ enabled: true }))
  try {
    const results = await base.list(null, 'foo', SIGNAL)
    assert.deepEqual(results, [{ path: 'ws.md', kind: 'file' }])
  } finally {
    wrapper.restore()
  }
})

test('wrapFileReferences：外部查询合并原生与外部绝对路径', async () => {
  const root = await makeTree()
  const base = { list: async () => [{ path: 'ws.md', kind: 'file' }] }
  const wrapper = wrapFileReferences(base, () => ({ enabled: true }))
  try {
    const results = await base.list(null, `${root}/`, SIGNAL)
    const paths = results.map((item) => item.path)
    assert.ok(paths.includes('ws.md'))
    assert.ok(paths.includes(join(root, 'a.md')))
    assert.ok(paths.includes(join(root, 'sub')))
  } finally {
    wrapper.restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('wrapFileReferences：enabled=false 时只返回原样结果', async () => {
  const root = await makeTree()
  const base = { list: async () => [{ path: 'ws.md', kind: 'file' }] }
  const wrapper = wrapFileReferences(base, () => ({ enabled: false }))
  try {
    const results = await base.list(null, `${root}/`, SIGNAL)
    assert.deepEqual(results, [{ path: 'ws.md', kind: 'file' }])
  } finally {
    wrapper.restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('wrapFileReferences：base 抛错时外部查询仍返回外部结果', async () => {
  const root = await makeTree()
  const warnings = []
  const base = {
    list: async () => {
      throw new Error('boom')
    },
  }
  const wrapper = wrapFileReferences(base, () => ({ enabled: true }), (message) => warnings.push(message))
  try {
    const results = await base.list(null, `${root}/`, SIGNAL)
    assert.ok(results.some((item) => item.path === join(root, 'a.md')))
    assert.equal(warnings.length, 1)
  } finally {
    wrapper.restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('wrapFileReferences：重复包装守卫且 restore 恢复原行为', async () => {
  const root = await makeTree()
  const base = { list: async () => [{ path: 'ws.md', kind: 'file' }] }
  const first = wrapFileReferences(base, () => ({ enabled: true }))
  const wrappedOnce = base.list
  const second = wrapFileReferences(base, () => ({ enabled: true }))
  try {
    // 第二次包装直接返回空 restore，且不重复替换 list
    assert.equal(base.list, wrappedOnce)
    second.restore()
    assert.equal(base.list, wrappedOnce)
    const merged = await base.list(null, `${root}/`, SIGNAL)
    assert.ok(merged.some((item) => item.path === join(root, 'a.md')))
  } finally {
    first.restore()
    await fs.rm(root, { recursive: true, force: true })
  }
  // restore 后回到原行为：外部查询只返回原生结果
  const restored = await base.list(null, `${root}/`, SIGNAL)
  assert.deepEqual(restored, [{ path: 'ws.md', kind: 'file' }])
})

test('mountExternalFileReferences：provider 就绪后标记 active 并替换 list', async () => {
  const fakeBase = { list: async () => [] }
  const originalList = fakeBase.list
  const ctx = {
    inject(_deps, callback) {
      callback({ fileReferences: fakeBase })
    },
    logger: { warn() {} },
  }
  const mount = mountExternalFileReferences(ctx, () => ({ enabled: true }))
  assert.equal(mount.status().provider, 'active')
  assert.equal(mount.status().enabled, true)
  assert.notEqual(fakeBase.list, originalList)
})

test('mountExternalFileReferences：缺 inject 时旁路为 missing', () => {
  const ctx = { logger: { warn() {} } }
  const mount = mountExternalFileReferences(ctx, () => ({ enabled: true }))
  assert.equal(mount.status().provider, 'missing')
})
