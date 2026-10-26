#!/usr/bin/env node
/**
 * 把某个 DSH 版本所需的预发布「波带」追加到各插件 `@deepseek-ai/dsh-*` peer 范围里。
 *
 *   node scripts/update-peer-ranges.mjs --runtime 0.3.0-rc.1          # 只打印计划（dry-run）
 *   node scripts/update-peer-ranges.mjs --runtime 0.3.0-rc.1 --write  # 落盘
 *
 * 做法：先用 DSH 自己的 `evaluatePluginCompatibility` 判断现有范围是否已覆盖目标
 * 版本；不覆盖才追加 `|| >=M.N.0-0 <M.(N+1).0-0`。语义与社区插件（如
 * dsh-web-mobile 的 `... || >=0.2.0-rc.1 <0.3.0-0`）一致，只是下界更宽一点。
 *
 * 处理哪一层与 DSH 的判定优先级严格对齐：
 *   - 清单声明了 `engines.dsh` → **只放宽 engines.dsh**，peerDependencies 被 DSH
 *     完全忽略，改它等于空转（门禁不读，CI 的 diff 会为空而让放宽步骤失败）；
 *   - 否则逐个放宽 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer。
 *
 * 只在目标版本**确实通过** verify + smoke 之后才应由 CI 落盘——放宽范围等于声明支持，
 * 不能凭空放宽。
 *
 * 已废弃的包（包目录含 DEPRECATED.md）不参与适配，直接跳过。
 *
 * 退出码：0 = 无待办或已成功落盘；1 = 出错（参数/解析/落盘后复检仍不通过）；2 = 用法/环境错误。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OracleNotFoundError, loadDshCompatOracle } from './dsh-compat-oracle.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(exitCode) {
  process.stdout.write(
    'usage: node scripts/update-peer-ranges.mjs --runtime <semver> [--dsh <bin>] [--write]\n' +
      '  --runtime <semver>  目标 DSH 版本（必填）\n' +
      '  --dsh <bin>         dsh 可执行文件；缺省 PATH 中的 dsh（或 $DSH_BIN）\n' +
      '  --write             落盘；缺省只打印计划\n',
  )
  process.exit(exitCode)
}

const args = process.argv.slice(2)
let runtime
let dshBin
let write = false
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--runtime') {
    runtime = args[i + 1]
    if (runtime === undefined) usage(2)
    i += 1
  } else if (arg.startsWith('--runtime=')) runtime = arg.slice('--runtime='.length)
  else if (arg === '--dsh') {
    dshBin = args[i + 1]
    if (dshBin === undefined) usage(2)
    i += 1
  } else if (arg.startsWith('--dsh=')) dshBin = arg.slice('--dsh='.length)
  else if (arg === '--write') write = true
  else if (arg === '-h' || arg === '--help') usage(0)
  else usage(2)
}
if (runtime === undefined) usage(2)

let oracle
try {
  oracle = await loadDshCompatOracle({ dsh: dshBin })
} catch (error) {
  if (error instanceof OracleNotFoundError) {
    process.stderr.write(`update-peer-ranges: ${error.message}\n`)
    process.exit(2)
  }
  throw error
}

/** 目标版本所属的预发布波带：>=M.N.0-0 <M.(N+1).0-0。 */
function bandFor(version) {
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(version.trim())
  if (match === null) {
    process.stderr.write(`update-peer-ranges: not a semantic version: ${version}\n`)
    process.exit(1)
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  return `>=${major}.${minor}.0-0 <${major}.${minor + 1}.0-0`
}

/** 用 DSH 的判定函数问：这个范围覆盖目标运行时吗？ */
function covers(range, version) {
  const probe = {
    name: 'peer-range-probe',
    version: '0.0.0',
    peerDependencies: { '@deepseek-ai/dsh-compat-probe': range },
  }
  return oracle.evaluatePluginCompatibility(probe, {}, version) === undefined
}

/**
 * 用 DSH 的判定函数问：这个 `engines.dsh` 范围覆盖目标运行时吗？
 *
 * 必须单独造探针：DSH 的优先级是 `engines.dsh` 压倒 `peerDependencies`，所以
 * 想测 engines 范围就只能在一个**没有** peer 的清单上测，否则测的是 peers。
 */
function coversEngines(range, version) {
  const probe = { name: 'engines-range-probe', version: '0.0.0', engines: { dsh: range } }
  return oracle.evaluatePluginCompatibility(probe, {}, version) === undefined
}

const band = bandFor(runtime)
const changes = []

function discoverManifests() {
  const packagesDir = join(repoRoot, 'packages')
  if (!existsSync(packagesDir)) return []
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageDir = join(packagesDir, entry.name)
      return { packageDir, manifestPath: join(packageDir, 'package.json') }
    })
    .filter((entry) => existsSync(entry.manifestPath))
    .sort((a, b) => a.manifestPath.localeCompare(b.manifestPath))
}

for (const { packageDir, manifestPath } of discoverManifests()) {
  // 已废弃的包不再参与适配（包目录里的 DEPRECATED.md 即标记）。
  if (existsSync(join(packageDir, 'DEPRECATED.md'))) {
    process.stdout.write(`  skip ${manifestPath.replace(`${repoRoot}/`, '')} (DEPRECATED.md)\n`)
    continue
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  // 优先级与 DSH 的 unmetRequirements() 一致：清单一旦声明 engines.dsh，
  // 判定就只看它，peerDependencies 被完全忽略。此时去放宽 peer 是空转——
  // 门禁读的不是那个字段，CI 的 git diff 会为空并让整个放宽步骤失败。
  const enginesDsh = manifest.engines?.dsh
  if (enginesDsh !== undefined) {
    if (typeof enginesDsh !== 'string') {
      process.stderr.write(
        `update-peer-ranges: ${manifest.name}: engines.dsh must be a string, got ${typeof enginesDsh}\n`,
      )
      process.exit(1)
    }
    if (coversEngines(enginesDsh, runtime)) continue
    const updated = `${enginesDsh} || ${band}`
    if (!coversEngines(updated, runtime)) {
      process.stderr.write(
        `update-peer-ranges: ${manifest.name}: appending "${band}" still does not cover ${runtime} for engines.dsh\n`,
      )
      process.exit(1)
    }
    changes.push({ package: manifest.name, field: 'engines.dsh', from: enginesDsh, to: updated })
    if (write) {
      manifest.engines.dsh = updated
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    }
    // engines.dsh 压倒 peers，peers 不再参与判定，无需处理。
    continue
  }

  const peers = manifest.peerDependencies ?? {}
  let touched = false
  for (const [name, range] of Object.entries(peers)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    if (covers(range, runtime)) continue
    const updated = `${range} || ${band}`
    if (!covers(updated, runtime)) {
      process.stderr.write(
        `update-peer-ranges: ${manifest.name}: appending "${band}" still does not cover ${runtime} for ${name}\n`,
      )
      process.exit(1)
    }
    peers[name] = updated
    changes.push({ package: manifest.name, field: name, from: range, to: updated })
    touched = true
  }
  if (touched && write) {
    manifest.peerDependencies = peers
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
}

if (changes.length === 0) {
  process.stdout.write(
    `All declared DSH version requirements already cover ${runtime} — nothing to do.\n` +
      `oracle: ${oracle.source}\n`,
  )
  process.exit(0)
}

process.stdout.write(
  `${write ? 'Updated' : 'Would update'} ${changes.length} DSH version requirement(s) for ${runtime} (band ${band}):\n\n`,
)
for (const change of changes) {
  process.stdout.write(`  ${change.package} ${change.field}\n`)
  process.stdout.write(`    - ${change.from}\n    + ${change.to}\n`)
}
if (!write) process.stdout.write('\n(dry-run; pass --write to apply)\n')
process.exit(0)
