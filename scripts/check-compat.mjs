#!/usr/bin/env node
/**
 * 用 DSH 自己的判定函数预检本仓库全部插件对某个 DSH 版本的兼容性。
 *
 *   node scripts/check-compat.mjs                        # 用本机 dsh 的版本
 *   node scripts/check-compat.mjs --runtime 0.2.1-alpha.2
 *   node scripts/check-compat.mjs --dsh /usr/local/bin/dsh --json
 *
 * 判定规则与 DSH 组合前的兼容性预检一致：只看 package.json 的 peerDependencies 中
 * 名为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项，与给定运行时版本比较；
 * 未声明这类 peer 的插件不受版本约束（engines 不参与判定）。
 *
 * 退出码：0 = 全部兼容；1 = 至少一个插件会被 DSH 拒绝加载（行被置为 disabled）；2 = 用法/环境错误。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OracleNotFoundError, loadDshCompatOracle } from './dsh-compat-oracle.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(exitCode) {
  process.stdout.write(
    'usage: node scripts/check-compat.mjs [--runtime <semver>] [--dsh <bin>] [--json]\n' +
      '  --runtime <semver>  DSH 运行时版本；缺省用 --dsh 指向的 dsh 自带版本\n' +
      '  --dsh <bin>         dsh 可执行文件；缺省 PATH 中的 dsh（或 $DSH_BIN）\n' +
      '  --json              以 JSON 输出结果（CI 消费）\n',
  )
  process.exit(exitCode)
}

const args = process.argv.slice(2)
let runtime
let dshBin
let asJson = false
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
  else if (arg === '--json') asJson = true
  else if (arg === '-h' || arg === '--help') usage(0)
  else usage(2)
}

let oracle
try {
  oracle = await loadDshCompatOracle({ dsh: dshBin })
} catch (error) {
  if (error instanceof OracleNotFoundError) {
    process.stderr.write(`check-compat: ${error.message}\n`)
    process.exit(2)
  }
  throw error
}

try {
  runtime ??= oracle.getDshRuntimeVersion()
} catch (error) {
  process.stderr.write(`check-compat: cannot determine runtime version: ${String(error)}\n`)
  process.exit(2)
}

/** 发现 packages/* 下的工作区包（按路径排序，输出可复现）。 */
function discoverPackages() {
  const packagesDir = join(repoRoot, 'packages')
  if (!existsSync(packagesDir)) return []
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, 'package.json'))
    .filter((manifestPath) => existsSync(manifestPath))
    .sort()
}

const results = []
for (const manifestPath of discoverPackages()) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dshPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
  )
  let issue
  try {
    issue = oracle.evaluatePluginCompatibility(manifest, {}, runtime)
  } catch (error) {
    issue = {
      name: manifest.name,
      version: manifest.version,
      runtimeVersion: runtime,
      peers: { '': String(error) },
      exempted: false,
    }
  }
  results.push({
    package: manifest.name,
    version: manifest.version,
    dshPeers: dshPeers.length,
    compatible: issue === undefined,
    unsatisfied: issue?.peers ?? {},
    warning: issue === undefined ? undefined : oracle.pluginCompatibilityWarning(issue),
  })
}

const failed = results.filter((result) => !result.compatible)

if (asJson) {
  process.stdout.write(
    JSON.stringify({ runtime, oracle: oracle.source, ok: failed.length === 0, results }, null, 2) + '\n',
  )
} else {
  process.stdout.write(`DSH runtime: ${runtime}\n`)
  process.stdout.write(`oracle:      ${oracle.source}\n\n`)
  for (const result of results) {
    const mark = result.compatible ? 'compatible  ' : 'INCOMPATIBLE'
    process.stdout.write(
      `${mark}  ${result.package}@${result.version}` +
        (result.dshPeers === 0
          ? '  (no DSH peers declared)'
          : `  (${result.dshPeers} DSH peers)`) +
        '\n',
    )
    for (const [name, range] of Object.entries(result.unsatisfied)) {
      process.stdout.write(`               unsatisfied: ${name} "${range}"\n`)
    }
  }
  if (failed.length > 0) {
    process.stdout.write(
      `\n${failed.length} plugin(s) would be denied by DSH at ${runtime}.\n` +
        'Fix by widening the peer range (scripts/update-peer-ranges.mjs) or, as a\n' +
        'last resort, an exact-version exemption on the profile\n' +
        '(`dsh plugin allow-version <pkg@ver> --dsh-version <exact> --accept-risk`).\n',
    )
  }
}

process.exit(failed.length === 0 ? 0 : 1)
