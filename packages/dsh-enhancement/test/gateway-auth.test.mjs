// 网关会话 cookie 的回归测试。
//
// 覆盖 2026-10-24 真机报障：「密码正确、点进入 DSH 后停在登录页，且不提示密码错误」。
//
// 两代根因，都在这里钉住：
// 1. 认证只看**第一个**同名 cookie。浏览器按 (name, domain, path) 存 cookie，重复项
//    顺序由浏览器决定，坏值排前面就永久认证失败。
// 2. 会话 cookie 名是**固定**的。HTTP cookie 身份不含端口，于是同一 IP 上的不同
//    端口（DSH 主服务 / 本网关 / 另一个 profile 的网关）共用一份存储：
//    - 换端口后旧会话仍被带上（本该重新登录却没有）；
//    - 混用协议时更糟：https 端口留下的 Secure cookie 在 http 端口既不发送、也无法
//      被非 Secure 的 Set-Cookie 覆盖 → 新会话永远存不住 → 反复退回登录页。
//    现在名字带「协议 + 端口」后缀，每实例独立槽位。
//
// 运行：node --test test/gateway-auth.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSessionCookie,
  sessionCookie,
  sessionCookieName,
  signSession,
  verifySession,
  SESSION_COOKIE_ALT,
  SESSION_COOKIE_LEGACY,
  SESSION_COOKIE_PREFIX,
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

/** 复刻修复后的判定：接受实例名与两个历史名，任一同名项验签通过即认证。 */
function isAuthenticated(header, cookieName) {
  const accepted = new Set([cookieName, SESSION_COOKIE_LEGACY, SESSION_COOKIE_ALT])
  for (const [name, value] of parseCookies(header)) {
    if (!accepted.has(name)) continue
    if (verifySession(SECRET, value) !== null) return true
  }
  return false
}

/** 修复前：固定名 + 只看第一个。仅用于证明用例抓得住回归。 */
function isAuthenticatedLegacy(header) {
  const raw = parseCookies(header).find(([name]) => name === SESSION_COOKIE_PREFIX)?.[1]
  return verifySession(SECRET, raw) !== null
}

const NAME = sessionCookieName('http:', 3089)

// ---------------------------------------------------------------------------
// 1. 实例专属名：协议 + 端口进入名字
// ---------------------------------------------------------------------------

test('cookie 名带协议与端口后缀，不同实例互不冲突', () => {
  const a = sessionCookieName('http:', 3089)
  const b = sessionCookieName('http:', 3090)
  const c = sessionCookieName('https:', 3089)

  assert.notEqual(a, b, '不同端口必须是不同 cookie 名')
  assert.notEqual(a, c, '不同协议必须是不同 cookie 名')
  assert.ok(a.startsWith(SESSION_COOKIE_PREFIX), '必须保留可识别的前缀')
  assert.ok(a.includes('3089'), '名字里要能看出端口')
})

test('cookie 名只用 RFC 6265 token 允许的字符（Safari 比 Chromium 严格）', () => {
  for (const [proto, port] of [
    ['http:', 80], ['http:', 3089], ['https:', 443], ['https:', 3088],
  ]) {
    const name = sessionCookieName(proto, port)
    // token = 1*<any CHAR except CTLs or separators>；这里收紧到最常见的安全子集。
    assert.match(name, /^[A-Za-z0-9_-]+$/, `${name} 含 RFC 6265 separator 字符`)
  }
})

test('非法端口退回占位值而不是生成坏名字', () => {
  for (const port of [0, -1, 70000, Number.NaN, 3.14]) {
    const name = sessionCookieName('http:', port)
    assert.match(name, /^[A-Za-z0-9_-]+$/, `${port} 生成了非法名 ${name}`)
  }
})

// ---------------------------------------------------------------------------
// 2. 端口隔离语义：换端口即换槽位（登录态自然失效）
// ---------------------------------------------------------------------------

test('在 3089 登录后，3089 的请求带着它，3090 不认', () => {
  const token = signSession(SECRET, 30)
  const name3089 = sessionCookieName('http:', 3089)
  const cookieHeader = `${name3089}=${token}`

  assert.equal(isAuthenticated(cookieHeader, name3089), true, '3089 自己的会话应通过')
  assert.equal(
    isAuthenticated(cookieHeader, sessionCookieName('http:', 3090)),
    false,
    '3090 不应接受 3089 的会话（换端口必须重新登录）',
  )
})

test('同端口不同协议也不互通（http 的会话在 https 上无效）', () => {
  const token = signSession(SECRET, 30)
  const httpCookie = `${sessionCookieName('http:', 3089)}=${token}`
  assert.equal(isAuthenticated(httpCookie, sessionCookieName('https:', 3089)), false)
})

// ---------------------------------------------------------------------------
// 3. 同名重复项的顺序不能决定认证结果（第一代根因）
// ---------------------------------------------------------------------------

test('Cookie 头里有多个同名项时，任意一个有效即认证通过', () => {
  const valid = signSession(SECRET, 30)
  const bogus = `${NAME}=v1.bogus.sig`
  const good = `${NAME}=${valid}`
  for (const header of [`${bogus}; ${good}`, `${good}; ${bogus}`, good]) {
    assert.equal(isAuthenticated(header, NAME), true)
  }
})

test('回归护栏：旧实现（固定名 + 只取第一个）在坏值排前时失败', () => {
  const valid = signSession(SECRET, 30)
  const staleFirst = `${SESSION_COOKIE_PREFIX}=v1.bogus.sig; ${SESSION_COOKIE_PREFIX}=${valid}`
  assert.equal(isAuthenticatedLegacy(staleFirst), false, '旧实现应失败（证明用例有效）')
})

test('全部无效时仍然拒绝，且不认无关名字', () => {
  for (const header of [
    `${NAME}=v1.bogus.sig`,
    `${NAME}=v1.a.sig; ${NAME}=v1.b.sig`,
    `${NAME}=`,
    '',
    'other=1',
    `not_ours_3089=${signSession(SECRET, 30)}`,
  ]) {
    assert.equal(isAuthenticated(header, NAME), false, `应拒绝：${JSON.stringify(header)}`)
  }
})

test('过期会话即使验签合法也拒绝', () => {
  assert.equal(isAuthenticated(`${NAME}=${signSession(SECRET, -1)}`, NAME), false)
})

test('换一把密钥签出的会话不再有效（改密码后旧会话失效的机制）', () => {
  const other = Buffer.from('another-gate-secret-value').toString('base64url')
  assert.equal(isAuthenticated(`${NAME}=${signSession(other, 30)}`, NAME), false)
})

// ---------------------------------------------------------------------------
// 4. 升级兼容：旧固定名写入的会话仍被接受（不让老用户被迫重登）
// ---------------------------------------------------------------------------

test('升级前用旧固定名写入的会话仍然有效', () => {
  const token = signSession(SECRET, 30)
  assert.equal(isAuthenticated(`${SESSION_COOKIE_LEGACY}=${token}`, NAME), true)
  assert.equal(isAuthenticated(`${SESSION_COOKIE_ALT}=${token}`, NAME), true)
})

// ---------------------------------------------------------------------------
// 5. Set-Cookie 下发与清除
// ---------------------------------------------------------------------------

test('登录成功时只写实例专属名（不再写固定名）', () => {
  const token = signSession(SECRET, 30)
  const headers = sessionCookie(NAME, token, 30, false)

  assert.equal(headers.length, 1, '只下发一条，避免在别的端口留下可读槽位')
  const header = headers[0]
  assert.ok(header.startsWith(`${NAME}=`), `应写实例名，实际：${header}`)
  assert.ok(header.includes(token))
  assert.match(header, /Max-Age=2592000/)
  assert.match(header, /Path=\//)
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Strict/)
  assert.doesNotMatch(header, /; Secure/)
  assert.match(sessionCookie(NAME, token, 30, true)[0], /; Secure/)
})

test('清除时覆盖实例名 + 两个历史名 × 多个 path', () => {
  const headers = clearSessionCookie(NAME, false)
  assert.ok(Array.isArray(headers))

  const combos = headers.map((h) => ({
    name: h.slice(0, h.indexOf('=')),
    path: (/Path=([^;]+)/.exec(h) ?? [])[1],
  }))

  for (const name of [NAME, SESSION_COOKIE_LEGACY, SESSION_COOKIE_ALT]) {
    const paths = combos.filter((c) => c.name === name).map((c) => c.path)
    assert.ok(paths.includes('/'), `${name} 必须包含 Path=/`)
    assert.ok(paths.includes('/__enhancement'), `${name} 必须包含 /__enhancement（登录页残值）`)
  }
  for (const header of headers) {
    assert.match(header, /=\s*;/, '清除头必须是空值')
    assert.match(header, /Max-Age=0/)
    assert.match(header, /HttpOnly/)
  }
})

test('HTTPS 下的清除头必须带 Secure，否则浏览器拒绝覆盖', () => {
  for (const header of clearSessionCookie(NAME, true)) assert.match(header, /; Secure/)
  for (const header of clearSessionCookie(NAME, false)) assert.doesNotMatch(header, /; Secure/)
})

test('sessionDays 非正数时 Max-Age 仍为正', () => {
  const token = signSession(SECRET, 1)
  for (const days of [0, -5]) {
    assert.match(sessionCookie(NAME, token, days, false)[0], /Max-Age=1(;|$)/)
  }
})
