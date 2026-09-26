/**
 * 系统字体目录：宿主经 Typert Gateway 暴露 `dshFonts/list`
 * （HTTP: POST /api/dshFonts/list，底层 font-list 跨平台枚举：
 * macOS 预编译 CoreText 二进制 / Windows PowerShell / Linux fc-list）。
 *
 * 页面会话内拉取一次并缓存；失败返回空数组（下拉降级为自由输入）。
 */

let rpcSeq = 0
let cached: string[] | null = null
let inflight: Promise<string[]> | null = null

/** 拉取系统字体族名列表（已去重排序，由宿主完成）。 */
export function loadFonts(): Promise<string[]> {
  if (cached) return Promise.resolve(cached)
  inflight ??= (async (): Promise<string[]> => {
    try {
      const res = await fetch('/api/dshFonts/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: `dsh-font-settings-fonts-${++rpcSeq}`,
          method: 'dshFonts/list',
          payload: { args: {} },
        }),
      })
      const json = (await res.json()) as { result?: { ok?: boolean; value?: unknown } }
      const value = json?.result?.ok === false ? [] : json?.result?.value
      cached = Array.isArray(value) ? (value as string[]) : []
    } catch {
      cached = []
    }
    return cached
  })()
  return inflight
}

/** 按输入过滤：完全命中 → 前缀 → 子串，大小写不敏感，上限 limit 条。 */
export function filterFonts(list: string[], query: string, limit = 12): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return list.slice(0, limit)
  const exact: string[] = []
  const prefix: string[] = []
  const rest: string[] = []
  for (const family of list) {
    const low = family.toLowerCase()
    if (low === q) exact.push(family)
    else if (low.startsWith(q)) prefix.push(family)
    else if (low.includes(q)) rest.push(family)
  }
  return [...exact, ...prefix, ...rest].slice(0, limit)
}
