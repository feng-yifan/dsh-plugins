#!/usr/bin/env node
/**
 * 运行时冒烟测试：在一个一次性 DSH_HOME 里用真实 dsh 启动 web profile，
 * 确认目标插件能被安装、被组合、并真正生效，而不是被兼容性预检拒绝。
 *
 *   node scripts/smoke-plugin.mjs --package dsh-font-settings
 *   node scripts/smoke-plugin.mjs --package dsh-ask-highlight --expect-html dsh-ask-highlight
 *   node scripts/smoke-plugin.mjs --package dsh-font-settings --keep   # 保留临时 DSH_HOME 便于排查
 *   node scripts/smoke-plugin.mjs --package dsh-pwa-icon --patch /tmp/pwa-icon.yml --expect-html apple-touch-icon
 *   node scripts/smoke-plugin.mjs --package dsh-pwa-icon --check-manifest-icons
 *
 * 断言（全部通过才退出 0）：
 *   1. `dsh plugin add` 成功——不兼容的插件在 pnpm 运行前就被 dsh 拒绝，这是最硬的信号；
 *   2. web 启动输出里没有兼容性拒绝/风险提示；
 *   3. 若插件声明了 `dsh.client`：它出现在首页启动图里（`"id":"<包名>"`）且 client bundle 返回 200；
 *      被预检拒绝的插件不会出现在启动图中；
 *   4. 若给了 `--expect-html <substring>`：首页 HTML 必须包含该标记
 *      （用于只有宿主半侧的插件，如 index-inject 注入的脚本/样式）；
 *   5. 若给了 `--patch <file>`：该 YAML 会追加到一次性 profile 的 patch 层，
 *      供需要 config 才生效的插件（如 dsh-pwa-icon）在真实 boot 里启用；
 *   6. 若给了 `--check-manifest-icons`：取 `/manifest.webmanifest` 的每条 `icons`，
 *      逐个请求并校验 HTTP 200、响应 content-type 与声明的 `type` 一致、
 *      图片实际像素（PNG / WebP / GIF 文件头）与声明的 `sizes` 一致。
 *
 * 不碰用户真实 ~/.dsh：全程用临时 DSH_HOME。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(exitCode) {
  process.stdout.write(
    'usage: node scripts/smoke-plugin.mjs --package <workspace-package-name> [--dsh <bin>] ' +
      '[--profile web] [--expect-html <substring>] [--patch <file>] [--check-manifest-icons] [--keep]\n',
  )
  process.exit(exitCode)
}

/**
 * 从文件头读出像素尺寸（PNG / WebP / GIF；其它格式返回 undefined）。
 * @param bytes - 图片字节。
 * @returns `"<宽>x<高>"` 或 undefined。
 */
function imageSize(bytes) {
  if (bytes.length >= 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
  }
  if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const fourcc = bytes.toString('ascii', 12, 16)
    if (fourcc === 'VP8X') return `${bytes.readUIntLE(24, 3) + 1}x${bytes.readUIntLE(27, 3) + 1}`
    if (fourcc === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return `${(bits & 0x3fff) + 1}x${((bits >> 14) & 0x3fff) + 1}`
    }
    if (fourcc === 'VP8 ') return `${bytes.readUInt16LE(26)}x${bytes.readUInt16LE(28)}`
  }
  if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'GIF') {
    return `${bytes.readUInt16LE(6)}x${bytes.readUInt16LE(8)}`
  }
  return undefined
}

const args = process.argv.slice(2)
let packageName
let dshBin = 'dsh'
let profile = 'web'
let expectHtml
let patchFile
let checkManifestIcons = false
let keep = false
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--package') packageName = args[++i]
  else if (arg.startsWith('--package=')) packageName = arg.slice('--package='.length)
  else if (arg === '--dsh') dshBin = args[++i]
  else if (arg.startsWith('--dsh=')) dshBin = arg.slice('--dsh='.length)
  else if (arg === '--profile') profile = args[++i]
  else if (arg === '--expect-html') expectHtml = args[++i]
  else if (arg.startsWith('--expect-html=')) expectHtml = arg.slice('--expect-html='.length)
  else if (arg === '--patch') {
    patchFile = args[++i]
    if (patchFile === undefined || patchFile.startsWith('--')) usage(2)
  }
  else if (arg.startsWith('--patch=')) {
    patchFile = arg.slice('--patch='.length)
    if (patchFile === '') usage(2)
  }
  else if (arg === '--check-manifest-icons') checkManifestIcons = true
  else if (arg === '--keep') keep = true
  else if (arg === '-h' || arg === '--help') usage(0)
  else usage(2)
}
if (packageName === undefined) usage(2)

const packageDir = join(repoRoot, 'packages', packageName)
const manifestPath = join(packageDir, 'package.json')
if (!existsSync(manifestPath)) {
  process.stderr.write(`smoke-plugin: no such workspace package: ${packageName}\n`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const declaresClient = manifest.dsh?.client !== undefined

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
const env = { ...process.env, DSH_HOME: home }
let server
let failed = false

function fail(message) {
  failed = true
  process.stderr.write(`smoke-plugin: FAIL: ${message}\n`)
}

try {
  process.stdout.write(`smoke-plugin: DSH_HOME=${home}\n`)

  // 1. 装进一次性 profile（本地目录 → link 依赖，并追加到 bundles）。
  //    不兼容的插件在这里就会被 dsh 拒绝（pnpm 之前）。
  const add = spawnSync(dshBin, ['plugin', '--profile', profile, 'add', packageDir], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 300_000,
  })
  if (add.status !== 0) {
    fail(
      `dsh plugin add exited with ${add.status ?? add.signal} — the plugin was not accepted by dsh\n` +
        `${(add.stdout ?? '') + (add.stderr ?? '')}`.trim(),
    )
    throw new Error('install failed')
  }
  process.stdout.write('smoke-plugin: plugin installed into throwaway profile\n')

  // 1b. --patch：把给定 YAML 追加进一次性 profile 的 patch 层。需要 config 才生效的
  //     插件（宿主侧、无客户端半侧）靠它拿到配置，从而在真实 boot 里被断言。
  //     新建 profile 的 patch 层是空文档 `[]`，直接追加会变成两个 YAML 文档而解析失败，
  //     因此先把裸 `[]` 占位行替换掉，再拼接。
  if (patchFile !== undefined) {
    const profilePatch = join(home, 'profiles', profile, 'cordis.patch.yml')
    if (!existsSync(profilePatch)) {
      fail(`--patch was given but the throwaway profile has no ${profilePatch}`)
      throw new Error('no profile patch')
    }
    if (!existsSync(patchFile)) {
      fail(`--patch file does not exist: ${patchFile}`)
      throw new Error('no patch file')
    }
    const placeholder = /^\s*\[\s*\]\s*$/m
    const existing = readFileSync(profilePatch, 'utf8').replace(
      placeholder,
      '# (empty-list placeholder superseded by smoke-plugin --patch)',
    )
    writeFileSync(profilePatch, `${existing.trimEnd()}\n\n${readFileSync(patchFile, 'utf8').trimEnd()}\n`)
    process.stdout.write(`smoke-plugin: appended ${patchFile} to the profile patch layer\n`)
  }

  // 2. 启动 web，等它打印带 token 的 URL。
  server = spawn(dshBin, ['web', '--port', '0', '--no-open'], { cwd: repoRoot, env })
  const output = []
  server.stdout.on('data', (chunk) => output.push(String(chunk)))
  server.stderr.on('data', (chunk) => output.push(String(chunk)))

  const deadline = Date.now() + 120_000
  let url
  while (Date.now() < deadline) {
    const match = /(https?:\/\/[^\s]+)/.exec(output.join(''))
    if (match !== null) {
      url = match[1]
      break
    }
    if (server.exitCode !== null) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  if (url === undefined) {
    fail(`web server did not print a URL within 120s\n${output.join('').slice(-2000)}`)
    throw new Error('no url')
  }
  process.stdout.write(`smoke-plugin: server at ${url}\n`)

  // 3. 兼容性拒绝检查：被拒绝的插件在启动时会打印 incompatible/豁免提示。
  const bootText = output.join('')
  if (/incompatible|to accept the risk/i.test(bootText)) {
    fail(`startup reported an incompatibility:\n${bootText.slice(-2000)}`)
  }

  // 4. 取首页（token URL 会 303 到 / 并下发 cookie，手工带上）。
  const tokenResponse = await fetch(url, { redirect: 'manual' })
  const cookie = (tokenResponse.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ')
  const origin = new URL(url).origin
  let html
  if (tokenResponse.ok) {
    html = await tokenResponse.text()
  } else {
    const rootResponse = await fetch(`${origin}/`, { headers: cookie === '' ? {} : { cookie } })
    if (!rootResponse.ok) {
      fail(`GET / returned ${rootResponse.status}`)
      throw new Error('root failed')
    }
    html = await rootResponse.text()
  }

  // 5a. 客户端半侧：出现在启动图里 + bundle 可取。
  if (declaresClient) {
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const row = new RegExp(`"id":"${escaped}"[^}]*?"url":"([^"]+)"`).exec(html)
    if (row === null) {
      fail(
        `plugin "${packageName}" is absent from the web boot graph ` +
          '(it was likely denied by the compatibility preflight)',
      )
    } else {
      const bundleUrl = `${origin}/${row[1].replaceAll('&amp;', '&')}`
      const bundleResponse = await fetch(bundleUrl, { headers: cookie === '' ? {} : { cookie } })
      const body = await bundleResponse.text()
      if (!bundleResponse.ok || body.length < 500) {
        fail(`client bundle ${bundleUrl} returned ${bundleResponse.status} (${body.length} bytes)`)
      } else {
        process.stdout.write(`smoke-plugin: client bundle OK (${body.length} bytes)\n`)
      }
    }
  }

  // 5b. 宿主半侧：index-inject 的标记必须出现在首页 HTML 里。
  if (expectHtml !== undefined) {
    if (!html.includes(expectHtml)) {
      fail(`served HTML does not contain the expected marker ${JSON.stringify(expectHtml)}`)
    } else {
      process.stdout.write(`smoke-plugin: host-side marker present in served HTML\n`)
    }
  }

  if (!declaresClient && expectHtml === undefined) {
    process.stdout.write(
      'smoke-plugin: note — plugin declares no client half and no --expect-html was given; ' +
        'only install acceptance + clean boot were asserted\n',
    )
  }

  // 5c. manifest 图标：逐个取回，校验 HTTP 200、content-type 与声明 type 一致、实际像素与声明 sizes 一致。
  if (checkManifestIcons) {
    const manifestUrl = `${origin}/manifest.webmanifest`
    const manifestResponse = await fetch(manifestUrl)
    if (!manifestResponse.ok) {
      fail(`GET /manifest.webmanifest returned ${manifestResponse.status}`)
    } else {
      const parsed = await manifestResponse.json()
      const icons = Array.isArray(parsed.icons) ? parsed.icons : []
      if (icons.length === 0) fail('manifest declares no icons')
      for (const icon of icons) {
        const iconUrl = new URL(String(icon.src), manifestUrl)
        const response = await fetch(iconUrl)
        const bytes = Buffer.from(await response.arrayBuffer())
        const declaredType = String(icon.type ?? '')
        const actualType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
        const actualSize = imageSize(bytes)
        const declaredSizes = String(icon.sizes ?? '')
        const problems = []
        if (!response.ok) problems.push(`HTTP ${response.status}`)
        if (declaredType !== '' && actualType !== declaredType) {
          problems.push(`served type ${actualType} != declared type ${declaredType}`)
        }
        if (declaredSizes !== '' && declaredSizes !== 'any' && actualSize !== undefined) {
          const first = declaredSizes.split(/\s+/)[0]
          if (first !== actualSize) problems.push(`actual size ${actualSize} != declared size ${first}`)
        }
        const line =
          `${icon.src} → ${response.status} ${actualType} ${bytes.byteLength}B ` +
          `sizes=${declaredSizes} actual=${actualSize ?? '?'} purpose=${icon.purpose ?? 'any'}`
        if (problems.length > 0) fail(`manifest icon problem — ${line} (${problems.join('; ')})`)
        else process.stdout.write(`smoke-plugin: manifest icon OK — ${line}\n`)
      }
    }
  }
} catch (error) {
  if (!failed) fail(String(error))
} finally {
  if (server !== undefined && server.exitCode === null) server.kill('SIGTERM')
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  if (server !== undefined && server.exitCode === null) server.kill('SIGKILL')
  if (keep) process.stdout.write(`smoke-plugin: kept ${home}\n`)
  else rmSync(home, { recursive: true, force: true })
}

if (failed) {
  process.stderr.write(`smoke-plugin: package ${packageName} did NOT pass the runtime smoke test\n`)
  process.exit(1)
}
process.stdout.write(`smoke-plugin: PASS — ${packageName} loads in a real dsh web profile\n`)
