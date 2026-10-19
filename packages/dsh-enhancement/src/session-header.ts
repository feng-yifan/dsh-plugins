/**
 * dsh-enhancement · 会话请求头注入（宿主半侧）。
 *
 * 背景：DSH 只在直连官方 DeepSeek API（`dsh-llm-deepseek`）时发送
 * `x-deepseek-harness-session-id`；走 `dsh-llm-pi-ai` 的第三方 OpenAI 兼容网关
 * 不会携带任何会话标识。本模块把 DSH 的 sessionId 补成 HTTP 请求头，
 * 让上游网关也能按会话关联请求。
 *
 * 注入点为什么是 `streamWithSnapshot`：
 * - `llm/stream` waterfall 的 `options` 是深冻结的，且 `dsh-llm-pi-ai` 在
 *   `streamWithSnapshot` 内用白名单（`profileOptions()` + `headers:
 *   requestHeaders(profile.headers)`）重新构造 pi-ai 的 options，所以 dsh 层的
 *   任何字段都到不了 HTTP 层；
 * - `snapshot.models.streamSimple(model, context, options)` 是该 adapter 唯一
 *   把 options 交给 pi-ai 的调用点，`options.headers` 会被 pi-ai 直接用作请求头。
 *
 * 目标 adapter 的识别用结构特征而非硬编码包名/路由名：只有 pi-ai adapter
 * 的原型上有 `streamWithSnapshot`；官方 DeepSeek adapter 没有该方法，因此天然
 * 不会被补丁，官方路由的既有行为完全不受影响。
 *
 * 版本漂移防御：宿主内部形态不符（`llm.adapters` 不是 Map、原型上没有
 * `streamWithSnapshot`、`snapshot.models.streamSimple` 缺失）时一律旁路，
 * 绝不阻断原始请求。
 */
import type { HostContextLike, LoggerLike } from './types.js'

/** 与官方 DeepSeek adapter 一致的头名，便于上游网关统一识别。 */
export const DEFAULT_SESSION_HEADER_NAME = 'x-deepseek-harness-session-id'

/** 头名合法性：RFC 9110 token。 */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export interface SessionHeaderSettings {
  /** 总开关；关闭时纯透传，不触碰任何请求。 */
  enabled: boolean
  /** 注入的头名。 */
  headerName: string
}

/**
 * 未挂载的具体原因，供设置页给出可操作的提示。
 *
 * - `ok`：已挂载到至少一个第三方 adapter。
 * - `no-adapters`：宿主没有任何已注册 adapter。`dsh-base` 以休眠态挂载
 *   `llm-pi-ai`，只有配置了 provider 路由它才会 `registerAdapter`；所以这通常
 *   是「还没添加第三方模型」，不是故障。
 * - `no-pi-ai-adapter`：有 adapter 但没有一个是 pi-ai 形态（结构漂移或只有官方路由）。
 * - `llm-unavailable`：宿主 `llm` 服务不可用或形态变化。
 */
export type SessionHeaderReason = 'ok' | 'no-adapters' | 'no-pi-ai-adapter' | 'llm-unavailable'

export interface SessionHeaderStatus {
  enabled: boolean
  headerName: string
  /** 已完成注入补丁的 adapter 数。 */
  patched: number
  /** 宿主已注册的 adapter 总数，用于区分「没配路由」与「结构漂移」。 */
  adapterCount: number
  reason: SessionHeaderReason
  /** 最近一次旁路/失败原因（仅异常时非 null），便于排障。 */
  lastError: string | null
}

/** 读取当前设置的入口；由插件在每次请求时调用，因此设置改动即时生效。 */
export type SettingsReader = () => SessionHeaderSettings

/** 出现在 pi-ai adapter 上的 snapshot 形态（只声明本模块用到的部分）。 */
interface SnapshotLike {
  models?: unknown
}

/** pi-ai 的 GenerateOptions 形态（只声明本模块用到的部分）。 */
interface GenerateOptionsLike {
  sessionId?: unknown
  headers?: Record<string, string>
}

interface AdapterLike {
  constructor?: unknown
}

/** `ctx.llm` 服务中本模块依赖的内部形态。 */
interface LlmLike {
  adapters?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function loggerOf(ctx: HostContextLike): LoggerLike | undefined {
  return ctx.logger
}

/** 校验并规范化头名；非法时回退默认值，避免写入无法发送的请求头。 */
export function normalizeHeaderName(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed !== '' && HEADER_NAME.test(trimmed)) return trimmed
  }
  return DEFAULT_SESSION_HEADER_NAME
}

/** 大小写不敏感地判断 headers 里是否已有同名头。 */
function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  if (headers === undefined) return false
  const expected = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === expected) return true
  }
  return false
}

/**
 * 给一份 pi-ai GenerateOptions 补上会话请求头。
 *
 * 不可变构造：入参可能是深冻结对象，直接赋值会抛。已存在同名头时保持原值，
 * 不覆盖用户的静态配置。
 *
 * @param options - pi-ai 的 GenerateOptions。
 * @param settings - 当前设置快照。
 * @returns 补过头的新 options；无需注入时原样返回。
 */
export function injectSessionHeader<T extends GenerateOptionsLike>(
  options: T,
  settings: SessionHeaderSettings,
): T {
  if (!settings.enabled) return options
  const sessionId = options.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return options
  const name = settings.headerName
  if (hasHeader(options.headers, name)) return options
  return { ...options, headers: { ...options.headers, [name]: sessionId } }
}

/** 已打补丁的原型 → 该原型的补丁记录。 */
interface PatchOwner {
  adapter: unknown
  isActive: () => boolean
  read: SettingsReader
}

interface PrototypePatch {
  owners: PatchOwner[]
  wrapper: unknown
  original: unknown
}

const prototypePatches = new WeakMap<object, PrototypePatch>()

/** 已 patch 的原型集合，用于 dispose 时还原。 */
const appliedPrototypes = new Set<object>()

/**
 * 包装 snapshot.models 的 `streamSimple`，在 options 进入 pi-ai 前注入会话头。
 *
 * `snapshot.models` 是 pi-ai `ModelsImpl` 的**类实例**（`createModels()` 返回），
 * 因此不能浅拷贝：`{...models}` 只复制自有字段、丢掉整个原型，
 * 后续 `models.getModel()` 之类的原型方法会变成 undefined（线上实测报
 * `snapshot.models.getModel is not a function`）。
 *
 * 也不能用 Proxy：冻结对象上 `get` 陷阱必须返回原值，改写 `streamSimple`
 * 会触发 TypeError 不变量检查。
 *
 * 做法：以原实例为原型新建一个极薄对象，只覆盖 `streamSimple`。原型链完整保留，
 * 原实例不被修改。
 *
 * @param models - `snapshot.models`。
 * @param alive - 当前 adapter 是否仍被授权注入。
 * @param read - 设置读取器。
 * @returns 包装后的 models；无需注入时原样返回。
 */
function decorateModels(models: unknown, alive: () => boolean, read: SettingsReader): unknown {
  if (!isRecord(models)) return models
  const streamSimple = Reflect.get(models, 'streamSimple')
  if (typeof streamSimple !== 'function') return models
  const facade = Object.create(models as object) as Record<PropertyKey, unknown>
  Object.defineProperty(facade, 'streamSimple', {
    value: (model: unknown, context: unknown, options: unknown) => {
      const settings = read()
      const next =
        alive() && isRecord(options)
          ? injectSessionHeader(options as GenerateOptionsLike, settings)
          : options
      return (streamSimple as (m: unknown, c: unknown, o: unknown) => unknown).call(models, model, context, next)
    },
    configurable: true,
    writable: true,
  })
  return facade
}

/**
 * 在一个 adapter 的类原型上打 `streamWithSnapshot` 补丁。
 *
 * 同一个原型只包装一次；多个 adapter 实例共享原型时按 owner 隔离，只有被
 * 登记授权的实例会注入。
 *
 * @returns 补丁是否就绪（原型方法存在且可写）。
 */
export function patchAdapterPrototype(
  adapter: AdapterLike,
  read: SettingsReader,
  isActive: () => boolean,
): boolean {
  if (!isRecord(adapter)) return false
  const proto: unknown = Object.getPrototypeOf(adapter)
  if (!isRecord(proto)) return false
  const original = Reflect.get(proto, 'streamWithSnapshot')
  if (typeof original !== 'function') return false

  const known = prototypePatches.get(proto)
  if (known !== undefined) {
    known.owners = known.owners.filter((owner) => owner.isActive())
    const existing = known.owners.find((owner) => owner.adapter === adapter)
    // 同一实例重复登记时以最新读取器为准（HMR 会重新 apply）。
    if (existing === undefined) known.owners.push({ adapter, isActive, read })
    else Object.assign(existing, { isActive, read })
    return true
  }

  const patch: PrototypePatch = { owners: [{ adapter, isActive, read }], wrapper: undefined, original }
  // 补丁在原型上，被该类所有实例共享；按 `this`（真实调用实例）判断授权，
  // 未经本插件登记的实例保持透传。这同时覆盖了同进程内多份 pi-ai adapter。
  const wrapper = function (this: unknown, options: unknown, snapshot: SnapshotLike) {
    const instance = this
    // 同一原型可能被多个实例共享，各实例用自己的设置读取器。
    const owner = patch.owners.find((entry) => entry.adapter === instance && entry.isActive())
    if (owner === undefined || !isRecord(snapshot)) {
      return (original as (o: unknown, s: unknown) => unknown).call(this, options, snapshot)
    }
    const alive = (): boolean =>
      patch.owners.some((entry) => entry.adapter === instance && entry.isActive())
    const decorated = { ...snapshot, models: decorateModels(snapshot.models, alive, owner.read) }
    return (original as (o: unknown, s: unknown) => unknown).call(this, options, decorated)
  }
  patch.wrapper = wrapper

  try {
    Reflect.set(proto, 'streamWithSnapshot', wrapper)
    if (Reflect.get(proto, 'streamWithSnapshot') !== wrapper) return false
  } catch {
    return false
  }
  prototypePatches.set(proto, patch)
  appliedPrototypes.add(proto)
  return true
}

/**
 * 扫描已注册 adapter，给 pi-ai 型 adapter 打补丁。
 *
 * @param llm - 宿主 `llm` 服务。
 * @returns 本轮确保覆盖的 adapter 数。
 */
export function sweepAdapters(llm: LlmLike, read: SettingsReader, isActive: () => boolean): number {
  const adapters = llm.adapters
  if (!(adapters instanceof Map)) return 0
  let patched = 0
  for (const registration of adapters.values()) {
    if (!isRecord(registration)) continue
    const adapter = registration.adapter
    if (!isRecord(adapter)) continue
    if (patchAdapterPrototype(adapter, read, isActive)) patched += 1
  }
  return patched
}

/** 还原全部已打补丁的原型（插件 dispose 时调用）。 */
export function restorePrototypes(): void {
  for (const proto of appliedPrototypes) {
    const patch = prototypePatches.get(proto)
    if (patch === undefined) continue
    patch.owners = []
    try {
      if (Reflect.get(proto, 'streamWithSnapshot') === patch.wrapper) {
        Reflect.set(proto, 'streamWithSnapshot', patch.original)
      }
    } catch {
      /* 只读原型：留给进程生命周期结束 */
    }
  }
  appliedPrototypes.clear()
}

/**
 * 挂载会话请求头注入。
 *
 * @param ctx - 宿主插件上下文。
 * @param read - 当前设置读取器（每次请求求值，设置改动即时生效）。
 * @returns 挂载结果与状态读取器。
 */
export interface SessionHeaderMount {
  status: () => SessionHeaderStatus
  dispose: () => void
}

export function mountSessionHeader(ctx: HostContextLike, read: SettingsReader): SessionHeaderMount {
  let active = true
  let patched = 0
  let adapterCount = 0
  let reason: SessionHeaderReason = 'no-adapters'
  let lastError: string | null = null
  const logger = loggerOf(ctx)
  const warnOnce = (() => {
    const warned = new Set<string>()
    return (message: string) => {
      if (warned.has(message)) return
      warned.add(message)
      logger?.warn?.(`[dsh-enhancement] ${message}`)
    }
  })()

  const isActive = (): boolean => active
  const sweep = (): void => {
    const llm = ctx.get('llm') as LlmLike | undefined
    if (llm === undefined || llm === null) {
      adapterCount = 0
      reason = 'llm-unavailable'
      lastError = 'llm service unavailable'
      return
    }
    if (!(llm.adapters instanceof Map)) {
      adapterCount = 0
      reason = 'llm-unavailable'
      lastError = 'host llm service shape changed (adapters is not a Map)'
      warnOnce(`${lastError}; session header injection bypassed`)
      return
    }
    adapterCount = llm.adapters.size
    patched = sweepAdapters(llm, read, isActive)
    if (patched > 0) {
      reason = 'ok'
      lastError = null
      return
    }
    // 没有可挂载的 adapter 不是故障：宿主 llm-pi-ai 以休眠态挂载，
    // 只有在设置里配置了 provider 路由它才注册 adapter。
    reason = adapterCount === 0 ? 'no-adapters' : 'no-pi-ai-adapter'
    lastError = null
  }

  sweep()
  // adapter 注册可能晚于本插件 apply（装载序无保证），用事件补齐。
  const offUpdate: unknown = ctx.on?.('llm/adapters-updated', () => {
    if (!active) return
    sweep()
  })

  logger?.info?.(
    `[dsh-enhancement] session header injection mounted (patched=${patched}, adapters=${adapterCount}, reason=${reason})`,
  )

  return {
    status: () => ({ ...read(), patched, adapterCount, reason, lastError }),
    dispose: () => {
      active = false
      try {
        if (typeof offUpdate === 'function') (offUpdate as () => void)()
      } catch {
        /* listener already disposed with the fiber */
      }
      restorePrototypes()
    },
  }
}
