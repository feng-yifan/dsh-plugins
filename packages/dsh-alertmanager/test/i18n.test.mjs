import assert from 'node:assert/strict'
import test from 'node:test'
import { en, LOCALE_NS, zh } from '../lib/locales.js'

/** 递归收集键（当前字典是扁平的，递归写法对嵌套字典同样成立）。 */
function collectKeys(value, prefix = '', output = []) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectKeys(child, prefix === '' ? key : `${prefix}.${key}`, output)
    }
  } else {
    output.push(prefix)
  }
  return output
}

/** 提取 DSH locale 的 `{name}` 占位符。 */
function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

test('locale 命名空间与包名一致', () => {
  assert.equal(LOCALE_NS, 'dsh-alertmanager')
})

test('zh 与 en 键集完全一致', () => {
  const zhKeys = collectKeys(zh).sort()
  const enKeys = collectKeys(en).sort()
  assert.deepEqual(enKeys, zhKeys)
  assert.ok(zhKeys.length > 50, `键数量异常：${zhKeys.length}`)
})

test('en 每个值非空，且占位符与 zh 对齐', () => {
  for (const key of collectKeys(zh)) {
    const zhValue = zh[key]
    const enValue = en[key]
    assert.equal(typeof enValue, 'string', `${key} 缺失或不是字符串`)
    assert.notEqual(enValue.trim(), '', `${key} 的英文文案为空`)
    assert.deepEqual(placeholders(enValue), placeholders(zhValue), `${key} 的占位符不一致`)
  }
})

test('所有 UI 文案键都有值', () => {
  const keys = new Set(collectKeys(zh))
  for (const required of [
    'sidebar.label',
    'refresh.idle',
    'refresh.cancel',
    'refresh.cancelTitle',
    'refresh.status',
    'filter.search',
    'filter.instance.all',
    'empty.addInstance',
    'error.auth.gateway',
    'error.auth.dsh',
    'error.auth.reload',
    'dispatch.button',
    'dispatch.dispatching',
    'card.expand',
    'card.collapse',
    'card.details.labels',
    'settings.title',
    'settings.add',
    'settings.insecureTls',
  ]) {
    assert.ok(keys.has(required), `缺少文案键 ${required}`)
  }
})
