/**
 * dsh-plan-tab-autoclose · 浏览器半侧
 *
 * 监听当前屏幕会话的 plan 投影：计划模式 active 由真转假（例如计划评审点「同意执行」）
 * 时，关闭该会话右侧边栏里全部 kind==='plan' 的计划标签页（含多轮修订产生的多个）。
 * 这样做不触碰上游 @deepseek-ai 包，也不依赖 DOM。
 */
import { installPlanTabAutoclose, type ClientContext } from './autoclose.js'

export const inject = ['sessions', 'sidebarRight']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installPlanTabAutoclose(ctx), 'dsh-plan-tab-autoclose: watch plan tabs')
}
