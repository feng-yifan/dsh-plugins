/**
 * dsh-at-enhancement · 配置持久化
 *
 * 设计（与 dsh-ask-highlight 同款）：配置存在当前 profile 目录里的 JSON 文件
 * `$DSH_HOME/profiles/<profile>/fengyifan-dsh-at-enhancement/state.json`，
 * 由插件自己的 HTTP 控制 API 读写，不依赖 cordis.patch.yml。
 *
 * 目录归属放在 profile 内，因此不同 profile 各有一套配置；profile 目录由
 * DSH 的 `profileContext.dir` 权威给出（见 index.ts），不靠猜 argv。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 状态目录名；放在 profile 目录内。 */
const STATE_SUBDIR = 'fengyifan-dsh-at-enhancement'

/** 配置形状：只有一个总开关。缺字段时按 DEFAULT_CONFIG 补。 */
export interface StoredConfig {
  /** 总开关；false 时 `list` 纯透传，不追加大外部候选。 */
  enabled: boolean
}

export const DEFAULT_CONFIG: StoredConfig = {
  enabled: true,
}

/** 磁盘上的文档形状（带版本号，方便以后迁移）。 */
interface PersistedState {
  version: 1
  config: StoredConfig
  updatedAt: string
}

export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

/** 从 CLI 参数解析当前 profile，用于 state 目录兜底定位（systemd 下默认 web）。 */
function activeProfileName(): string {
  const argv = process.argv
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' || arg === '-p') {
      const value = argv[i + 1]
      if (value && !value.startsWith('-')) return value.replace(/[\\/]/g, '')
    }
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      if (value) return value.replace(/[\\/]/g, '')
    }
  }
  const env = process.env.DSH_PROFILE?.trim()
  return env && !env.includes('/') && !env.includes('\\') ? env : 'web'
}

export const PROFILE_NAME = activeProfileName()
export const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE_NAME)

/** 状态放在当前 profile 目录内；显式覆盖只用于隔离测试。 */
const STATE_DIR_OVERRIDE = process.env.DSH_AT_ENHANCEMENT_STATE_DIR?.trim()
const initialDir = STATE_DIR_OVERRIDE ? resolve(STATE_DIR_OVERRIDE) : join(PROFILE_DIR, STATE_SUBDIR)
export let STATE_DIR = initialDir
export let STATE_PATH = join(initialDir, 'state.json')

/**
 * 使用 DSH 提供的 profileContext.dir 作为权威目录。
 * 这样 Windows / macOS 以及自定义 DSH_HOME 下都不依赖猜测 argv 或 home 布局。
 */
export function configureStateDir(profileDir: string): void {
  STATE_DIR = resolve(profileDir, STATE_SUBDIR)
  STATE_PATH = join(STATE_DIR, 'state.json')
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** 原子写：先写同目录临时文件再 rename，避免半截文件。 */
export function atomicWrite(path: string, content: string, mode = 0o600): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, { mode })
  try {
    chmodSync(tmp, mode)
  } catch {
    /* best effort */
  }
  renameSync(tmp, path)
}

/** 把任意输入收敛成合法配置：只认布尔值，其余回落种子。 */
export function normalizeConfig(input: unknown, seed: StoredConfig = DEFAULT_CONFIG): StoredConfig {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : seed.enabled,
  }
}

/**
 * 配置存储。构造时读盘，写入即落盘；读失败不抛错，回落到默认配置
 * （一个纯增强性插件不该因为坏掉的 JSON 拖垮宿主启动）。
 */
export class ConfigStore {
  private state: PersistedState

  constructor(seed?: Partial<StoredConfig>) {
    const seeded = normalizeConfig(seed, DEFAULT_CONFIG)
    this.state = this.load(seeded)
  }

  /** 状态文件路径（读模块变量，configureStateDir 之后仍是最新值）。 */
  get statePath(): string {
    return STATE_PATH
  }

  private load(seed: StoredConfig): PersistedState {
    if (existsSync(this.statePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<PersistedState>
        return {
          version: 1,
          config: normalizeConfig(raw.config, seed),
          updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
        }
      } catch {
        // 坏文件：先备份改名（best effort），再回落种子配置，保留可用性
        try {
          renameSync(this.statePath, `${this.statePath}.bak-${Date.now()}`)
        } catch {
          /* 备份失败不影响回落 */
        }
      }
    }
    return { version: 1, config: seed, updatedAt: nowIso() }
  }

  get config(): StoredConfig {
    return this.state.config
  }

  save(): void {
    this.state.updatedAt = nowIso()
    atomicWrite(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`)
  }

  /** 合并写入；返回收敛后的完整配置。 */
  updateConfig(patch: Partial<StoredConfig>): StoredConfig {
    this.state.config = normalizeConfig({ ...this.state.config, ...patch }, this.state.config)
    this.save()
    return this.state.config
  }
}
