/**
 * 浏览器插件契约：优先采用 @deepseek-ai 真实发布的类型（type-only 导入，
 * 编译期擦除，不影响客户端 bundle 纯净性），不足处按运行版代码形状声明。
 * 注意：0.1.7-rc.1 无 `settingsScope` 服务，客户端设置读写走 configForms。
 *
 * 说明：本包 tsconfig.client 用 Node(10) 解析，无法用 exports 子路径
 * `@deepseek-ai/dsh-client-ui-settings/client` 取 ConfigForm 类型，因此基于
 * primitives 的 SettingsFormScope（运行时同构）自行声明；运行版
 * ConfigFormController 满足该形状（getSnapshot/subscribe/mutate）。
 */

import type {
  SettingsFieldState,
  SettingsFormActions,
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
  SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type {
  SettingsFieldState,
  SettingsFormActions,
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
  SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
export type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** 一个设置命名空间的同步镜像（ConfigFormController.getSnapshot 形状）。 */
export interface ConfigFormSnapshot<T> extends SettingsFormScopeSnapshot<T> {
  /** `host` 与宿主文档同步；`memory` 把偏好留在远程浏览器进程内。 */
  mode: 'host' | 'memory'
}

/** 一个命名空间的响应式写读句柄（ConfigFormController 消费者视图）。 */
export interface ConfigForm<T> extends SettingsFormScope<T> {
  /** 排队一个字段写入。 */
  set(field: string, value: unknown): Promise<boolean>
  /** 排队一个字段清除（字段回落到组合层）。 */
  unset(field: string): Promise<boolean>
}

/** 插槽注册选项（SlotRegistry.register 的类型擦除视图）。 */
export interface SlotsRegisterOptions {
  name: string
  children?: Record<string, unknown>
  store?: unknown
  inject?: (...args: never[]) => object
  key?: string
  id?: string
  order?: number
  label?: string
  priority?: number
  locale?: string
  registrant?: string
}

/** 浏览器插件上下文（只声明本插件用到的成员）。 */
export interface ClientContext {
  effect<T>(callback: () => T | (() => void), name?: string): void
  on<K extends string>(event: K, listener: (...args: never[]) => void, options?: { prepend?: boolean }): void
  get<T>(service: string): T
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): void
  }
  slots: {
    register(options: SlotsRegisterOptions, component: unknown): () => void
    inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
  }
  configForms: {
    get<T>(namespace: string): ConfigForm<T>
  }
  connection: unknown
  remote: unknown
}

/** 配置卡快照：表单壳状态（SettingsFormModel.shell）+ 两个字段。 */
export interface FontCardSnapshot extends SettingsFormShell {
  uiFont: SettingsFieldState
  monoFont: SettingsFieldState
}
