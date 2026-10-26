#!/usr/bin/env node
/**
 * 用 DSH 自己的判定函数预检本仓库全部插件对某个 DSH 版本的兼容性。
 *
 *   node scripts/check-compat.mjs                        # 用本机 dsh 的版本
 *   node scripts/check-compat.mjs --runtime 0.2.1-alpha.2
 *   node scripts/check-compat.mjs --dsh /usr/local/bin/dsh --json
 *
 * 判定规则与 DSH 组合前的兼容性预检一致（直接调用 DSH 自己的
 * `evaluatePluginCompatibility`，所以判定 = 被测运行时）：
 *
 *   1. 清单声明了 `engines.dsh` 时，**只由该范围决定，忽略 peerDependencies**；
 *   2. 否则 `@deepseek-ai/dsh` 与每个 `@deepseek-ai/dsh-*` 的 peer 范围都必须匹配；
 *   3. 两者都没声明时不受版本约束。
 *
 * 注意 `engines.dsh` 与 peers 的后果一样硬：不满足时 DSH 在**安装阶段**就拒绝，
 * 插件根本装不上（不是"装上但不生效"）。所以本脚本对两者一视同仁。
 *
 * 已废弃的包（包目录含 DEPRECATED.md）不参与适配，输出为 deprecated 并跳过。
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

/** 已废弃的包：包目录里有 DEPRECATED.md 就不再参与版本适配。 */
function isDeprecated(packageDir) {
  return existsSync(join(packageDir, 'DEPRECATED.md'))
}

/** 发现 packages/* 下的工作区包（按路径排序，输出可复现）。 */
function discoverPackages() {
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

/**
 * 声明了 DSH 版本要求的插件里，实际参与判定的那一层是什么。
 *
 * DSH 的优先级是 `engines.dsh` 压倒一切：一旦声明，peerDependencies 就被完全
 * 忽略。CI 的自动放宽步骤必须知道是哪一层在管事，否则会去改一个没人读的字段。
 *
 * @param {Record<string, unknown>} manifest 插件清单。
 * @returns {'engines.dsh' | 'peerDependencies' | 'none'}
 */
function requirementSource(manifest) {
  const engines = manifest.engines
  if (engines !== null && typeof engines === 'object' && Object.hasOwn(engines, 'dsh')) return 'engines.dsh'
  const dshPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
  )
  return dshPeers.length > 0 ? 'peerDependencies' : 'none'
}

const results = []
for (const { packageDir, manifestPath } of discoverPackages()) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dshPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
  )
  const source = requirementSource(manifest)
  if (isDeprecated(packageDir)) {
    results.push({
      package: manifest.name,
      version: manifest.version,
      dshPeers: dshPeers.length,
      requirementSource: source,
      deprecated: true,
      compatible: true,
      unsatisfied: {},
    })
    continue
  }
  let issue
  try {
    issue = oracle.evaluatePluginCompatibility(manifest, {}, runtime)
  } catch (error) {
    // 清单本身格式错误（例如 engines 不是对象、engines.dsh 不是字符串）。
    // 这类错误 DSH 会直接抛，无法给出结构化 requirements。
    issue = {
      name: manifest.name,
      version: manifest.version,
      runtimeVersion: runtime,
      requirements: { '': String(error) },
      exempted: false,
    }
  }
  results.push({
    package: manifest.name,
    version: manifest.version,
    dshPeers: dshPeers.length,
    requirementSource: source,
    compatible: issue === undefined,
    // 字段名是 `requirements`（key 为 `engines.dsh` 或 peer 包名），
    // 早先这里误读成 `issue.peers`，导致不兼容时 unsatisfied 恒为空对象。
    unsatisfied: issue?.requirements ?? {},
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
    const mark = result.deprecated ? 'deprecated ' : result.compatible ? 'compatible ' : 'INCOMPATIBLE'
    // 说清楚判定依据是哪一层：engines.dsh 会压倒 peers，两者都没有才是"无约束"。
    const basis = result.deprecated
      ? '  (DEPRECATED.md — skipped)'
      : result.requirementSource === 'engines.dsh'
        ? '  (gated by engines.dsh — peerDependencies ignored)'
        : result.requirementSource === 'peerDependencies'
          ? `  (gated by ${result.dshPeers} DSH peer(s))`
          : '  (no DSH version requirement — ungated)'
    process.stdout.write(`${mark}  ${result.package}@${result.version}${basis}\n`)
    for (const [name, range] of Object.entries(result.unsatisfied)) {
      process.stdout.write(`               unsatisfied: ${name} "${range}"\n`)
    }
  }
  if (failed.length > 0) {
    process.stdout.write(
      `\n${failed.length} plugin(s) would be denied by DSH at ${runtime}.\n` +
        'Fix by widening the declared range (scripts/update-peer-ranges.mjs) or, as a\n' +
        'last resort, an exact-version exemption on the profile\n' +
        '(`dsh plugin allow-version <pkg@ver> --dsh-version <exact> --accept-risk`).\n',
    )
  }
}

process.exit(failed.length === 0 ? 0 : 1)
