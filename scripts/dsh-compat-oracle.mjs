#!/usr/bin/env node
/**
 * 兼容性判定「神谕」：优先使用**真实安装的 dsh** 自带的
 * `@deepseek-ai/dsh-app-boot`，而不是 npm 上单独安装的那份。
 *
 * 理由：
 *   - 单独安装的 app-boot 把同级包声明为 peer，workspace/CI 里
 *     `autoInstallPeers: false` 不会自动装，import 时会因缺
 *     `@deepseek-ai/cordis-plugin-group` 等而失败；
 *   - 从目标 dsh 安装里取，判定函数与被测运行时同版本，结果才可信。
 *
 * 解析顺序：
 *   1. 环境变量 `DSH_COMPAT_MODULE`（指向 app-boot 的 index.js，调试用）；
 *   2. `<dsh 包根>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`；
 *   3. 裸说明符 `@deepseek-ai/dsh-app-boot`（其 peer 齐全时可用）。
 *
 * dsh 可执行文件解析：显式 `--dsh`/`DSH_BIN` → PATH 中的 `dsh`。
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export class OracleNotFoundError extends Error {}

/** 在 PATH 中查找可执行文件（不依赖 shell 的 `which`）。 */
function which(bin) {
  if (bin.includes(sep)) return existsSync(bin) ? bin : undefined
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, bin)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // 继续找
    }
  }
  return undefined
}

/** 从 dsh 可执行文件推出其包根目录（沿父目录找 name === @deepseek-ai/dsh）。 */
function dshPackageRoot(bin) {
  const located = which(bin)
  if (located === undefined) return undefined
  let real
  try {
    real = realpathSync(located)
  } catch {
    return undefined
  }
  let dir = dirname(real)
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        if (JSON.parse(readFileSync(manifestPath, 'utf8')).name === '@deepseek-ai/dsh') return dir
      } catch {
        // 继续向上
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * 加载判定函数集合。
 * @param {{dsh?: string}} [options] dsh 可执行文件名或路径，默认 PATH 中的 `dsh`。
 */
export async function loadDshCompatOracle(options = {}) {
  const tried = []

  const modulePath = process.env.DSH_COMPAT_MODULE
  if (modulePath !== undefined && modulePath !== '') {
    const spec = pathToFileURL(resolve(modulePath)).href
    tried.push(spec)
    const loaded = await tryImport(spec)
    if (loaded !== undefined) return { ...loaded, source: spec }
  }

  const root = dshPackageRoot(options.dsh ?? process.env.DSH_BIN ?? 'dsh')
  if (root !== undefined) {
    const candidate = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
    if (existsSync(candidate)) {
      const spec = pathToFileURL(candidate).href
      tried.push(spec)
      const loaded = await tryImport(spec)
      if (loaded !== undefined) return { ...loaded, source: spec }
    }
  }

  tried.push('@deepseek-ai/dsh-app-boot')
  const bare = await tryImport('@deepseek-ai/dsh-app-boot')
  if (bare !== undefined) return { ...bare, source: '@deepseek-ai/dsh-app-boot (workspace)' }

  throw new OracleNotFoundError(
    'cannot load the DSH compatibility oracle. Install dsh (npm i -g @deepseek-ai/dsh@<version>) ' +
      'or point DSH_COMPAT_MODULE at @deepseek-ai/dsh-app-boot/lib/index.js. Tried:\n  ' +
      tried.join('\n  '),
  )
}

async function tryImport(spec) {
  try {
    const loaded = await import(spec)
    return typeof loaded.evaluatePluginCompatibility === 'function' ? loaded : undefined
  } catch {
    return undefined
  }
}
