// dsh-vertical-layout 布局验证脚本（Playwright）。
// 用法：node scripts/verify-layout.mjs <baseUrl>
//   baseUrl 例如 http://127.0.0.1:3090/?token=...
// 环境变量：PLAYWRIGHT_MODULE / PLAYWRIGHT_EXECUTABLE 可指向 playwright 包与
// chromium 可执行文件的绝对路径（仓库本地未安装时使用）。
// 覆盖三个场景：
//   1. 电脑竖屏：右侧栏移到顶部、铺满整行、对话区获得完整宽度；
//   2. 电脑横屏：保持原生三列布局（右栏在右侧）；
//   3. 手机（触屏）竖屏：完全不做改动。
const playwrightSpecifier = process.env.PLAYWRIGHT_MODULE ?? 'playwright'
const { chromium } = await import(playwrightSpecifier)

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/verify-layout.mjs <baseUrl>')
  process.exit(2)
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const launchOptions = process.env.PLAYWRIGHT_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
  : {}
const browser = await chromium.launch(launchOptions)

/** 打开页面，等待框架，点掉欢迎对话框，打开右侧面板，返回几何信息。 */
async function probe(viewport, touchOptions = {}, { requireOpen = true } = {}) {
  const context = await browser.newContext({ viewport, ...touchOptions })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 200)))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-rightbar-col]', { state: 'attached', timeout: 60000 })

  for (let i = 0; i < 6; i++) {
    const dialog = page.locator('[role="dialog"]')
    if ((await dialog.count()) === 0) break
    const dismissBtn = dialog.locator('button', { hasText: /继续|确定|开始|关闭|next|continue|got it|dismiss|close/i })
    if (await dismissBtn.count()) await dismissBtn.first().click()
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
  }

  const expand = page.locator('[data-sidebar-right-expand]').first()
  await expand.waitFor({ timeout: 30000 })
  await expand.click()
  if (requireOpen) {
    await page.waitForFunction(() => {
      const frame = document.querySelector('[data-rightbar-col]')?.parentElement
      return frame && !frame.hasAttribute('data-rightbar-collapsed')
    }, { timeout: 15000 })
  }
  await page.waitForTimeout(700)

  const geo = await page.evaluate(() => {
    const rightbar = document.querySelector('[data-rightbar-col]')
    const frame = rightbar.parentElement
    const panel = rightbar.querySelector('[data-sidebar-right-panel]')
    const children = [...frame.children]
    const idx = children.findIndex((el) => el.hasAttribute('data-rightbar-col'))
    const sidebar = children[idx - 2]
    const center = children[idx - 1]
    const fb = frame.getBoundingClientRect()
    const rb = rightbar.getBoundingClientRect()
    const cs = getComputedStyle(rightbar)
    const sbs = getComputedStyle(sidebar)
    const heightHandle = document.querySelector('[data-dsh-vertical-layout-height-handle]')
    const collapseSvg = document.querySelector('[data-sidebar-right-toggle] svg')
    return {
      frame: { top: fb.top, left: fb.left, height: fb.height, width: fb.width },
      rightbar: { top: rb.top, height: rb.height, width: rb.width, left: rb.left },
      panel: panel ? panel.getBoundingClientRect().toJSON() : null,
      center: center ? center.getBoundingClientRect().toJSON() : null,
      sidebar: sidebar ? sidebar.getBoundingClientRect().toJSON() : null,
      gridTemplateRows: getComputedStyle(frame).gridTemplateRows,
      borderBottomWidth: cs.borderBottomWidth,
      borderBottomStyle: cs.borderBottomStyle,
      borderBottomColor: cs.borderBottomColor,
      dockPaneBorderLeft: (() => {
        const pane = rightbar.querySelector('[data-dockkit-pane]')
        if (!pane) return null
        const pcs = getComputedStyle(pane)
        return `${pcs.borderLeftWidth} ${pcs.borderLeftStyle}`
      })(),
      navBorderRight: `${sbs.borderRightWidth} ${sbs.borderRightStyle}`,
      heightHandle: heightHandle
        ? { exists: true, top: getComputedStyle(heightHandle).top, left: getComputedStyle(heightHandle).left }
        : { exists: false },
      collapseTransform: collapseSvg ? getComputedStyle(collapseSvg).transform : null,
      verticalAttr: frame.hasAttribute('data-dsh-vertical-layout'),
      collapsed: frame.hasAttribute('data-rightbar-collapsed'),
      fullscreen: frame.hasAttribute('data-rightbar-fullscreen'),
      desktop: matchMedia('(hover: hover) and (pointer: fine)').matches,
      portrait: matchMedia('(orientation: portrait)').matches,
      pluginRan: !!window.__dshVerticalLayout,
    }
  })
  await context.close()
  return geo
}

// ---------------- 场景 1：电脑竖屏（1080×1920，主指针 fine） ----------------
console.log('\n== 场景 1：电脑竖屏 ==')
const portrait = await probe({ width: 1080, height: 1920 })
check('脚本在桌面端执行', portrait.pluginRan === true, `pluginRan=${portrait.pluginRan}`)
check('指针检测为电脑', portrait.desktop === true)
check('方向检测为竖屏', portrait.portrait === true)
check('框架标记 data-dsh-vertical-layout', portrait.verticalAttr === true)
// 新布局：左列导航整高 + 右上文件/终端 + 右下对话
check('右栏位于右侧区域顶部', Math.abs(portrait.rightbar.top - portrait.frame.top) < 2, `top=${portrait.rightbar.top.toFixed(1)}`)
check('右栏在导航区右侧', Math.abs(portrait.rightbar.left - portrait.sidebar.width) < 2, `left=${portrait.rightbar.left.toFixed(1)} sidebar.w=${portrait.sidebar.width.toFixed(1)}`)
const rightAreaW = portrait.frame.width - portrait.sidebar.width
check('右栏宽度 = 导航区外的整宽', Math.abs(portrait.rightbar.width - rightAreaW) < 2, `w=${portrait.rightbar.width.toFixed(1)}/${rightAreaW.toFixed(1)}`)
const ratio = portrait.rightbar.height / portrait.frame.height
check('右栏高度约为窗口 40%', ratio > 0.33 && ratio < 0.47, `ratio=${ratio.toFixed(3)}`)
if (portrait.panel) {
  check('停靠面板铺满右栏', Math.abs(portrait.panel.width - portrait.rightbar.width) < 2, `panel.w=${portrait.panel.width.toFixed(1)}`)
} else {
  check('停靠面板存在', false, 'panel not found')
}
if (portrait.center) {
  const centerW = portrait.frame.width - portrait.sidebar.width
  const centerWOk = Math.abs(portrait.center.width - centerW) < 2
  const centerTopOk = Math.abs(portrait.center.top - (portrait.frame.top + portrait.rightbar.height)) < 2
  const centerHOk = Math.abs(portrait.center.height - (portrait.frame.height - portrait.rightbar.height)) < 2
  check('对话区位于右下', centerTopOk && centerWOk && centerHOk, `center={top:${portrait.center.top.toFixed(0)},w:${portrait.center.width.toFixed(0)},h:${portrait.center.height.toFixed(0)}}`)
}
if (portrait.sidebar) {
  const navFullH = Math.abs(portrait.sidebar.height - portrait.frame.height) < 2
  const navLeft = Math.abs(portrait.sidebar.left - portrait.frame.left) < 2
  check('导航区占满左列整高', navFullH && navLeft, `sidebar.h=${portrait.sidebar.height.toFixed(0)}`)
}
const rows = portrait.gridTemplateRows.split(' ').filter(Boolean)
check('grid 变为两行', rows.length === 2, portrait.gridTemplateRows)
check('对话与停靠区之间有分隔线', ['0.5px', '1px'].includes(portrait.borderBottomWidth) && portrait.borderBottomStyle === 'solid', `${portrait.borderBottomWidth} ${portrait.borderBottomStyle}`)
// 分隔线必须与 DSH 面板边界同款（--dsw-alias-border-l4：浅色 #00000029 / 深色 #fff3）
check('分隔线颜色与 DSH 面板边界一致（l4）', portrait.borderBottomColor === 'rgba(0, 0, 0, 0.16)' || portrait.borderBottomColor === 'rgba(255, 255, 255, 0.2)', portrait.borderBottomColor)
check('左侧导航竖线已移除（无残留左边框）', portrait.navBorderRight === '0px none', portrait.navBorderRight)
check('停靠区 dockkit pane 左边框已移除', portrait.dockPaneBorderLeft === '0px none' || portrait.dockPaneBorderLeft === null, String(portrait.dockPaneBorderLeft))
if (portrait.heightHandle.exists) {
  const hTop = parseFloat(portrait.heightHandle.top)
  const hLeft = parseFloat(portrait.heightHandle.left)
  check('高度拖拽条位于分隔线上', Math.abs(hTop - (portrait.rightbar.height - 4)) < 2, `top=${portrait.heightHandle.top}`)
  check('高度拖拽条从导航右缘开始', Math.abs(hLeft - portrait.sidebar.width) < 2, `left=${portrait.heightHandle.left}`)
} else {
  check('高度拖拽条存在', false, 'height handle not found')
}
check('收起按钮图标已旋转', /matrix\(0,\s*1,\s*-1,\s*0/.test(portrait.collapseTransform || ''), `transform=${portrait.collapseTransform}`)

// ---------------- 场景 2：电脑横屏（1920×1080） ----------------
console.log('\n== 场景 2：电脑横屏（应保持原生三列） ==')
const landscape = await probe({ width: 1920, height: 1080 })
check('脚本在桌面端执行', landscape.pluginRan === true)
check('方向检测为横屏', landscape.portrait === false)
check('不设置 data-dsh-vertical-layout', landscape.verticalAttr === false)
check('右栏仍在右侧', Math.abs(landscape.rightbar.left + landscape.rightbar.width - landscape.frame.width) < 3, `right edge gap=${Math.abs(landscape.rightbar.left + landscape.rightbar.width - landscape.frame.width).toFixed(1)}px`)
check('右栏高度等于框架高度', Math.abs(landscape.rightbar.height - landscape.frame.height) < 2, `h=${landscape.rightbar.height.toFixed(1)}/${landscape.frame.height.toFixed(1)}`)
check('右栏未铺满宽度', landscape.rightbar.width < landscape.frame.width * 0.8, `w=${landscape.rightbar.width.toFixed(1)}`)
check('横屏下导航竖线恢复原生边框', landscape.navBorderRight === '1px solid', landscape.navBorderRight)
check('横屏下无高度拖拽条', landscape.heightHandle.exists === false)
check('横屏下收起按钮图标不旋转', !/matrix\(0,\s*1,\s*-1/.test(landscape.collapseTransform || ''), `transform=${landscape.collapseTransform}`)

// ---------------- 场景 3：手机触屏竖屏（应完全不动） ----------------
console.log('\n== 场景 3：手机触屏竖屏（应完全不动） ==')
// 手机宽度（390px）：DSH 原生判定无空间，右侧面板打不开，插件也不应干预。
const phone = await probe(
  { width: 390, height: 844 },
  { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { requireOpen: false },
)
check('脚本在手机端不执行', phone.pluginRan === false, `pluginRan=${phone.pluginRan}`)
check('指针检测为触屏', phone.desktop === false)
check('方向检测为竖屏', phone.portrait === true)
check('不设置 data-dsh-vertical-layout', phone.verticalAttr === false)

// 平板触屏宽度（800px）：右侧面板可以打开，但插件必须保持不动（右栏仍在右侧）。
console.log('\n== 场景 4：平板触屏竖屏（面板可开，但插件不干预） ==')
const tablet = await probe(
  { width: 800, height: 1280 },
  { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
)
check('脚本在平板端不执行', tablet.pluginRan === false, `pluginRan=${tablet.pluginRan}`)
check('指针检测为触屏', tablet.desktop === false)
check('方向检测为竖屏', tablet.portrait === true)
check('不设置 data-dsh-vertical-layout', tablet.verticalAttr === false)
check('右栏仍在右侧', Math.abs(tablet.rightbar.left + tablet.rightbar.width - tablet.frame.width) < 3, `right edge gap=${Math.abs(tablet.rightbar.left + tablet.rightbar.width - tablet.frame.width).toFixed(1)}px`)
check('右栏未铺满宽度', tablet.rightbar.width < tablet.frame.width * 0.8, `w=${tablet.rightbar.width.toFixed(1)}`)

// ---------------- 场景 5：交互——拖拽导航宽度与停靠区高度 ----------------
console.log('\n== 场景 5：拖拽交互 ==')
{
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 } })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 200)))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-rightbar-col]', { state: 'attached', timeout: 60000 })
  for (let i = 0; i < 6; i++) {
    const dialog = page.locator('[role="dialog"]')
    if ((await dialog.count()) === 0) break
    const dismissBtn = dialog.locator('button', { hasText: /继续|确定|开始|关闭|next|continue|got it|dismiss|close/i })
    if (await dismissBtn.count()) await dismissBtn.first().click({ timeout: 3000 }).catch(() => {})
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
  }
  await page.locator('[data-sidebar-right-expand]').first().click()
  await page.waitForFunction(() => {
    const frame = document.querySelector('[data-rightbar-col]')?.parentElement
    return frame && !frame.hasAttribute('data-rightbar-collapsed')
  }, { timeout: 15000 })
  await page.waitForTimeout(800)

  const snap = () =>
    page.evaluate(() => {
      const rightbar = document.querySelector('[data-rightbar-col]')
      const frame = rightbar.parentElement
      const panel = rightbar.querySelector('[data-sidebar-right-panel]')
      const children = [...frame.children]
      const idx = children.findIndex((el) => el.hasAttribute('data-rightbar-col'))
      const sidebar = children[idx - 2]
      const handle = document.querySelector('[data-dsh-vertical-layout-height-handle]')
      return {
        rows: getComputedStyle(frame).gridTemplateRows,
        dock: { w: rightbar.getBoundingClientRect().width, h: rightbar.getBoundingClientRect().height },
        panelW: panel.getBoundingClientRect().width,
        panelH: panel.getBoundingClientRect().height,
        centerTop: children[idx - 1].getBoundingClientRect().top,
        sidebarW: sidebar.getBoundingClientRect().width,
        handleTop: handle ? getComputedStyle(handle).top : null,
      }
    })

  // 拖拽左侧导航 +100px：停靠面板必须跟随停靠区（不再被 React 重写回旧宽度）。
  const navHandle = page.locator('[data-side="sidebar"]')
  const nhb = await navHandle.boundingBox()
  await page.mouse.move(nhb.x + 4, 900)
  await page.mouse.down()
  await page.mouse.move(nhb.x + 4 + 100, 900, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  let s = await snap()
  check('导航拖拽后停靠区收窄', s.dock.w < 800, `dock.w=${s.dock.w.toFixed(0)}`)
  check('导航拖拽后面板仍铺满停靠区', Math.abs(s.dock.w - s.panelW) < 2, `dock.w=${s.dock.w.toFixed(0)} panel.w=${s.panelW.toFixed(0)}`)
  check('导航拖拽后高度拖拽条跟随导航右缘', Math.abs(parseFloat(s.handleTop) - (s.dock.h - 4)) < 2 && s.sidebarW > 280, `sidebar.w=${s.sidebarW.toFixed(0)}`)

  // 高度拖拽 -260px：停靠区变矮、对话区下移、面板高度同步。
  const hh = page.locator('[data-dsh-vertical-layout-height-handle]')
  const hhb = await hh.boundingBox()
  const beforeH = s.dock.h
  await page.mouse.move(hhb.x + 300, hhb.y + 4)
  await page.mouse.down()
  await page.mouse.move(hhb.x + 300, hhb.y + 4 - 260, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  s = await snap()
  check('高度拖拽后停靠区变矮', s.dock.h < beforeH - 150, `h=${s.dock.h.toFixed(0)} (before ${beforeH.toFixed(0)})`)
  check('高度拖拽后面板高度同步', Math.abs(s.dock.h - s.panelH) < 2 && Math.abs(s.centerTop - s.dock.h) < 2, `center.top=${s.centerTop.toFixed(0)} dock.h=${s.dock.h.toFixed(0)} panel.h=${s.panelH.toFixed(0)}`)

  // 往下拖到底：应被 0.7 比例钳制（1080 视口宽高 1920 → 1344px）。
  const hhb2 = await hh.boundingBox()
  await page.mouse.move(hhb2.x + 300, hhb2.y + 4)
  await page.mouse.down()
  await page.mouse.move(hhb2.x + 300, 1900, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  s = await snap()
  check('高度拖拽钳制在最大比例（0.7）', Math.abs(s.dock.h - 1344) < 3, `dock.h=${s.dock.h.toFixed(0)}`)

  // 收面板再打开：高度比例在会话内保留。
  await page.evaluate(() => document.querySelector('[data-sidebar-right-toggle]').click())
  await page.waitForFunction(() => {
    const frame = document.querySelector('[data-rightbar-col]')?.parentElement
    return frame && frame.hasAttribute('data-rightbar-collapsed')
  }, { timeout: 15000 })
  await page.waitForTimeout(500)
  await page.evaluate(() => document.querySelector('[data-sidebar-right-expand]').click())
  await page.waitForFunction(() => {
    const frame = document.querySelector('[data-rightbar-col]')?.parentElement
    return frame && !frame.hasAttribute('data-rightbar-collapsed')
  }, { timeout: 15000 })
  await page.waitForTimeout(800)
  s = await snap()
  check('收起再打开后保留调整后的高度', Math.abs(s.dock.h - 1344) < 3, `dock.h=${s.dock.h.toFixed(0)}`)

  await context.close()
}

console.log()
const ok = results.every((r) => r.ok)
console.log(ok ? 'ALL CHECKS PASSED' : `${results.filter((r) => !r.ok).length} CHECK(S) FAILED`)
await browser.close()
process.exit(ok ? 0 : 1)
