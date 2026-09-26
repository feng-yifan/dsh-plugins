/**
 * 可搜索字体下拉字段：label + 已设置徽标 + 恢复默认 + 下拉输入 + 预览。
 *
 * 复用 @deepseek-ai/dsh-client-ui-primitives 的 Input（输入框）、Menu
 * （锚定下拉：方向键行走、Enter/Tab 选定、Escape 关闭、外部点击关闭）与
 * Tag（已设置徽标），不手写下拉逻辑。字段视觉对齐 primitives 的
 * SettingsValueField（fields.module.css 的 token 配方：--dsw-alias-* 变量）。
 * 预览块固定位于字段下方，label 为「预览」。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Input, Menu, Tag, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { filterFonts, loadFonts } from './fontCatalog'

export interface FontComboboxProps {
  id: string
  label: string
  placeholder: string
  /** 当前文本（受控于表单暂存值；也是下拉的过滤词）。 */
  text: string
  overridden: boolean
  invalid: boolean
  disabled: boolean
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  loadingLabel: string
  loadFailedLabel: string
  noMatchLabel: string
  /** 预览块文案。 */
  previewLabel: string
  previewSample: string
  /** 预览样例字体栈；空 = 沿用 DSH 默认栈。 */
  previewFontFamily?: string
  /** 是否在字段顶部画分隔线（多字段表单中非首个字段）。 */
  separated?: boolean
  onReset: () => void
  onEdit: (text: string) => void
}

const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0' }
const fieldSpacedStyle: CSSProperties = {
  ...fieldStyle,
  borderTop: '0.5px solid var(--dsw-alias-border-l2)',
}
const headStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' }
const labelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
}
const badgesStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px' }
const resetStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}
const invalidStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-state-error-primary)',
}
const previewBoxStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border)',
  background: 'var(--dsw-alias-surface-raised)',
}
const previewLabelStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }
const previewSampleStyle: CSSProperties = { fontSize: 14 }

/** 一个可搜索字体下拉字段 + 下方预览块。 */
export function FontCombobox(props: FontComboboxProps): JSX.Element {
  const { id, label, text, onReset, onEdit } = props
  const [open, setOpen] = useState(false)
  // null = 加载中；否则为已就绪的列表（空数组 = 枚举失败/无字体）。
  const [fonts, setFonts] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    loadFonts().then((list) => {
      if (alive) setFonts(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const entries: MenuEntry[] = []
  if (fonts === null) {
    entries.push({ type: 'label', id: 'loading', text: props.loadingLabel })
  } else if (fonts.length === 0) {
    entries.push({ type: 'label', id: 'failed', text: props.loadFailedLabel })
  } else {
    const matches = filterFonts(fonts, text)
    if (matches.length === 0) {
      entries.push({ type: 'label', id: 'nomatch', text: props.noMatchLabel })
    } else {
      for (const family of matches) entries.push({ id: family, label: family })
    }
  }

  return (
    <div style={props.separated ? fieldSpacedStyle : fieldStyle}>
      <div style={headStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
          <label style={labelStyle} htmlFor={id}>
            {label}
          </label>
        </div>
        {props.overridden ? (
          <span style={badgesStyle}>
            <Tag tone="neutral">{props.overriddenLabel}</Tag>
            <button type="button" style={resetStyle} disabled={props.disabled} onClick={onReset}>
              {props.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      <Menu
        open={open}
        anchor={
          <Input
            id={id}
            value={text}
            placeholder={props.placeholder}
            disabled={props.disabled}
            aria-invalid={props.invalid || undefined}
            onFocus={() => setOpen(true)}
            onChange={(event) => onEdit(event.target.value)}
          />
        }
        items={entries}
        selectedId={text.trim() || undefined}
        onSelect={(family) => {
          onEdit(family)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
      {props.invalid ? <p style={invalidStyle}>{props.invalidLabel}</p> : null}
      <div style={previewBoxStyle}>
        <span style={previewLabelStyle}>{props.previewLabel}</span>
        <div style={{ ...previewSampleStyle, fontFamily: props.previewFontFamily }}>{props.previewSample}</div>
      </div>
    </div>
  )
}
