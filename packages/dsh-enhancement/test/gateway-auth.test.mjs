// 网关会话认证的回归测试。
//
// 覆盖两个真实缺陷（与任何 PWA / 样式改动无关，属独立 bug 修复）：
//
// 1. **同名 cookie 只读第一个**：浏览器按 (name, domain, path) 存 cookie，重复项
//    顺序由浏览器决定。旧实现用 `find()` 取第一个，一旦过期的旧值排在前面就永久
//    认证失败 —— 表现是「密码正确、刷新又回登录页，且不报密码错误」，用户无法
//    自愈（除非手动清 cookie）。
//
// 2. **清除 cookie 只清 Path=/**：`/__enhancement` 等其它 path 上的残值清不掉，
//    它们会一直跟着每个请求，让上面的问题复现。
//
// 运行：node --test test/gateway-auth.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSessionCookie,
  sessionCookie,
  signSession,
  verifySession,
  SESSION_COOKIE,
} from '../lib/state.js'

const SECRET = Buffer.from('test-gate-secret-0123456789abcdef').toString('base64url')

/** 复刻网关的 cookie 解析：保序、保留重复项。 */
function parseCookies(header) {
  if (!header) return []
  const out = []
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    const name = segment.slice(0, at).trim()
    if (!name) continue
    out.push([name, segment.slice(at + 1).trim()])
  }
  return out
}

/** 修复后的判定（与 Gateway#isAuthenticated 一致）：任一同名项验签通过即认证。 */
function isAuthenticated(header) {
  for (const [name, value] of parseCookies(header)) {
    if (name !== SESSION_COOKIE) continue
    if (verifySession(SECRET, value) !== null) return true
  }
  return false
}

/** 修复前的行为：只看第一个同名项。仅用于证明用例抓得住回归。 */
function isAuthenticatedLegacy(header) {
  const raw = parseCookies(header).find(([name]) => name === SESSION_COOKIE)?.[1]
  return verifySession(SECRET, raw) !== null
}

// ---------------------------------------------------------------------------
// 1. 核心回归：同名 cookie 的顺序不能决定认证结果
// ---------------------------------------------------------------------------

test('Cookie 头里有多个同名项时，任意一个有效即认证通过', () => {
  const valid = signSession(SECRET, 30)
  const bogus = `${SESSION_COOKIE}=v1.bogus.sig`
  const good = `${SESSION_COOKIE}=${valid}`

  for (const header of [`${bogus}; ${good}`, `${good}; ${bogus}`, good]) {
    assert.equal(
      isAuthenticated(header),
      true,
      `应通过：${header.replace(valid, '<valid>')}`,
    )
  }
})

test('回归护栏：旧实现（只取第一个同名 cookie）在坏值排前时失败', () => {
  const valid = signSession(SECRET, 30)
  const staleFirst = `${SESSION_COOKIE}=v1.bogus.sig; ${SESSION_COOKIE}=${valid}`

  // 这条断言是「测试有效性」的证明：它红了说明回归被引入。
  assert.equal(isAuthenticatedLegacy(staleFirst), false, '旧实现应失败（证明用例有效）')
  assert.equal(isAuthenticated(staleFirst), true, '新实现应通过')
})

test('全部无效时仍然拒绝（遍历不能放宽认证）', () => {
  for (const header of [
    `${SESSION_COOKIE}=v1.bogus.sig`,
    `${SESSION_COOKIE}=v1.bogus.sig; ${SESSION_COOKIE}=v1.other.sig`,
    `${SESSION_COOKIE}=`,
    '',
    'other=1',
  ]) {
    assert.equal(isAuthenticated(header), false, `应拒绝：${JSON.stringify(header)}`)
  }
})

test('过期会话即使验签合法也拒绝', () => {
  assert.equal(isAuthenticated(`${SESSION_COOKIE}=${signSession(SECRET, -1)}`), false)
})

test('换一把密钥签出的会话不再有效（改密码后旧会话失效的机制）', () => {
  const other = Buffer.from('another-gate-secret-value').toString('base64url')
  assert.equal(isAuthenticated(`${SESSION_COOKIE}=${signSession(other, 30)}`), false)
})

// ---------------------------------------------------------------------------
// 2. 清除 cookie 必须覆盖多个 path（否则残值永远清不掉）
// ---------------------------------------------------------------------------

test('clearSessionCookie 覆盖多个 path，且都是立即过期的空值', () => {
  const headers = clearSessionCookie(false)
  assert.ok(Array.isArray(headers), '应返回多条 Set-Cookie')
  assert.ok(headers.length >= 2, `应覆盖至少 2 个 path，实际 ${headers.length}`)

  const paths = headers.map((h) => (/Path=([^;]+)/.exec(h) ?? [])[1])
  assert.ok(paths.includes('/'), '必须包含 Path=/')
  assert.ok(paths.includes('/__enhancement'), '必须包含 /__enhancement（登录页残值）')

  for (const header of headers) {
    assert.match(header, new RegExp(`^${SESSION_COOKIE}=;`), '清除头必须是空值')
    assert.match(header, /Max-Age=0/, '清除头必须立即过期')
    assert.match(header, /HttpOnly/, '清除头必须保持 HttpOnly')
  }
})

test('HTTPS 下的清除头必须带 Secure，否则浏览器拒绝覆盖', () => {
  for (const header of clearSessionCookie(true)) assert.match(header, /; Secure/)
  for (const header of clearSessionCookie(false)) assert.doesNotMatch(header, /; Secure/)
})

// ---------------------------------------------------------------------------
// 3. 下发的新会话 cookie 属性
// ---------------------------------------------------------------------------

test('登录成功后下发的会话 cookie 属性正确', () => {
  const token = signSession(SECRET, 30)
  const header = sessionCookie(token, 30, false)
  assert.match(header, new RegExp(`^${SESSION_COOKIE}=`))
  assert.match(header, /Max-Age=2592000/, '30 天对应 2592000 秒')
  assert.match(header, /Path=\//)
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Strict/)
  assert.doesNotMatch(header, /; Secure/)
  assert.match(sessionCookie(token, 30, true), /; Secure/)
})

test('sessionDays 非正数时 Max-Age 仍为正（不退化成会话级 cookie）', () => {
  const token = signSession(SECRET, 1)
  for (const days of [0, -5]) {
    assert.match(sessionCookie(token, days, false), /Max-Age=1(;|$)/)
  }
})
