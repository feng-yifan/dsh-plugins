/**
 * dsh-alertmanager · 自绘控件（纯 React + 内联样式）
 *
 * 设计原则：
 * 1. 颜色/圆角/字号/阴影全部直接使用 DSH 自己的 CSS 变量（`--dsw-*`、`--dsh-*`），
 *    这样浅/暗主题与用户字号设置自动跟随；
 * 2. **复合令牌（elevation 等）已展开核对**：DSH 的 elevation 系列含一项
 *    `0 0 0 .5px <border-l3>` 描边阴影，容器自己画了边框时不能再叠，因此统一用
 *    去描边的 `shadowSoft` / `shadowPanel`；
 * 3. 所有可点控件统一 `controlHeight`（30px）与 `box-sizing: border-box`，
 *    间距一律取自 `space` 刻度，分隔线一律用 `rule`（= border-l1），不再混用。
 */
import React from 'react'

/** 主题令牌（值均已在 DSH 主题源码中核对过）。 */
export const tokens = {
  bgBase: 'var(--dsw-alias-bg-base, #ffffff)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2, #ffffff)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3, #ffffff)',
  /** 次级面（DSH 的 tag/分段控件底色），浅色主题下是浅灰 #f5f6f7。 */
  bgModule: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
  bgMask: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24))',
  bgHover: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
  bgHoverDanger: 'var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05))',
  menuSurface: 'var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1, #ffffff))',
  borderL1: 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))',
  borderL2: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
  borderL3: 'var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12))',
  borderL4: 'var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16))',
  hairline: 'var(--dsh-hairline-width, 0.5px)',
  /** 只含投影项，不含 DSH elevation 的 0.5px 描边项（数值同 --dsw-elevation-soft）。 */
  shadowSoft: '0 4px 16px 0 #00000008, 0 0 24px 0 #00000008',
  /** 浮层投影，数值同 --dsw-elevation-prominent。 */
  shadowPanel: '0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d',
  /** 菜单材质模糊（DSH 菜单用 blur+saturate 的半透明底）。 */
  menuBlur: 'var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))',
  /** 键盘焦点色（DSH 的 focus-ring-color 实际为 transparent，故直接用业务蓝）。 */
  focus: 'var(--dsw-alias-state-business-primary, #4176e6)',
  labelPrimary: 'var(--dsw-alias-label-primary, #0f1115)',
  labelSecondary: 'var(--dsw-alias-label-secondary, #61666b)',
  labelTertiary: 'var(--dsw-alias-label-tertiary, #81858c)',
  labelDimmed: 'var(--dsw-alias-label-dimmed, #e1e5ee)',
  labelOnFill: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
  /** DSH 的「墨色」（浅色近黑/暗色近白），用于主按钮与正文强调。 */
  brand: 'var(--dsw-alias-brand-primary, #0f1115)',
  /**
   * 选中/强调色：用 DSH 的 business-primary（也是 DSH 默认焦点环色），
   * 浅色 #4176e6、暗色 #7aaaff，随主题自动切换。
   * 注意不要用 --dsw-static-deepseek-*：静态色板两主题同值、不切换。
   */
  accent: 'var(--dsw-alias-state-business-primary, #4176e6)',
  success: 'var(--dsw-alias-state-success-primary, #22c55e)',
  error: 'var(--dsw-alias-state-error-primary, #ec1313)',
  /** 图形/色条用的琥珀；作文字色对比不足（浅色 ~2:1），文字请用 warnText。 */
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  /** 文字/标签用的琥珀文字色（amber-600），浅暗两主题一致。 */
  warnText: 'var(--dsw-alias-state-warn-label, #dd8629)',
  /** 琥珀浅底（浅色 #fef5e7 / 暗色 #27241f）。 */
  warnSoft: 'var(--dsw-alias-state-warn-tertiary, #fef5e7)',
  /** 成功浅底（浅色 #e6faed / 暗色 #233c2c）。 */
  successSoft: 'var(--dsw-alias-state-success-tertiary, #e6faed)',
  info: 'var(--dsw-alias-state-business-primary, #4176e6)',
  idle: 'var(--dsw-alias-state-idle-primary, #d4d4d4)',
  fontBase: 'var(--dsh-content-font-size, 14px)',
  fontSecondary: 'var(--dsh-content-font-size-secondary, 13px)',
} as const

/** 间距刻度（4 的倍数），所有 gap/padding 从这里取。 */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 } as const

/** 所有可点控件统一高度。 */
export const controlHeight = 30

/** 胶囊/小按钮高度（比控件矮一档，用于 chip 与卡片内联按钮）。 */
export const chipHeight = controlHeight - 4

/** 结构性分隔线（= DSH 的 border-l1）。 */
export const rule = 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))'

/** 圆角（DSH：xs 4 / sm 8 / md 12 / lg 16 / xl 20；面板级 28 太大，弹窗用 xl）。 */
export const radius = {
  xs: 'var(--dsw-radius-xs, 4px)',
  sm: 'var(--dsw-radius-sm, 8px)',
  md: 'var(--dsw-radius-md, 12px)',
  lg: 'var(--dsw-radius-lg, 16px)',
  panel: 'var(--dsw-radius-xl, 20px)',
  pill: '999px',
} as const

/** 在默认正文字号上加 N 像素（跟随用户字号设置）。 */
export function bigger(px: number): string {
  return `calc(var(--dsh-content-font-size, 14px) + ${px}px)`
}

/** 在默认正文字号上减 N 像素（跟随用户字号设置）。 */
export function smaller(px: number): string {
  return `calc(var(--dsh-content-font-size, 14px) - ${px}px)`
}

/** 极简 hover 状态（内联样式写不了 :hover）。 */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hovered, setHovered] = React.useState(false)
  return [
    hovered,
    { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
  ]
}

/** 次级按钮（DSH outline 按钮）。 */
export const secondaryButtonStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: tokens.fontBase,
  lineHeight: '20px',
  color: tokens.labelPrimary,
  background: 'transparent',
  border: `1px solid ${tokens.borderL3}`,
  borderRadius: radius.md,
  padding: `0 ${space.md}px`,
  height: controlHeight,
  boxSizing: 'border-box',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space.xs + 2,
  whiteSpace: 'nowrap',
}

/** 主按钮（DSH primary 按钮：墨色填充 + 前景色）。 */
export function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    font: 'inherit',
    fontSize: tokens.fontBase,
    fontWeight: 500,
    lineHeight: '20px',
    color: disabled ? tokens.labelTertiary : tokens.labelOnFill,
    background: disabled ? tokens.bgModule : tokens.brand,
    border: 'none',
    borderRadius: radius.md,
    padding: `0 ${space.lg - 2}px`,
    height: controlHeight,
    boxSizing: 'border-box',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    whiteSpace: 'nowrap',
  }
}

/** 图标文字按钮（刷新/设置用）：与次按钮同高同圆角，hover 出底色。 */
export function ghostButtonStyle(hovered: boolean, disabled = false): React.CSSProperties {
  return {
    font: 'inherit',
    fontSize: tokens.fontBase,
    lineHeight: '20px',
    color: disabled ? tokens.labelTertiary : tokens.labelPrimary,
    background: hovered && !disabled ? tokens.bgHover : 'transparent',
    border: 'none',
    borderRadius: radius.md,
    padding: `0 ${space.md}px`,
    height: controlHeight,
    boxSizing: 'border-box',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs + 2,
    whiteSpace: 'nowrap',
    transition: 'background 120ms ease',
  }
}

/** 输入框（带 hover/focus 反馈，焦点环用业务蓝）。 */
export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  type = 'text',
  id,
  ariaLabel,
  autoComplete,
  describedBy,
  invalid = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'password'
  id?: string
  ariaLabel?: string
  autoComplete?: string
  describedBy?: string
  invalid?: boolean
}): React.ReactElement {
  const [hovered, hoverEvents] = useHover()
  const [focused, setFocused] = React.useState(false)
  const borderColor = invalid ? tokens.error : focused ? tokens.accent : hovered ? tokens.borderL3 : tokens.borderL2
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...hoverEvents}
      style={{
        font: 'inherit',
        fontSize: tokens.fontBase,
        lineHeight: '20px',
        color: tokens.labelPrimary,
        background: disabled ? tokens.bgModule : tokens.bgBase,
        border: `1px solid ${borderColor}`,
        borderRadius: radius.md,
        padding: `0 ${space.sm + 2}px`,
        height: controlHeight,
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
        boxShadow: focused ? `0 0 0 2px color-mix(in srgb, ${tokens.focus} 14%, transparent)` : 'none',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    />
  )
}

export function Spinner({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.85s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  )
}

export function RefreshIcon({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CheckIcon({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path d="m5 12.5 4.2 4.2L19 6.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronIcon({ size = 12 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 选中圆标（纯视觉，真正的控件是它外面的 button）。 */
export function CheckCircle({ selected, size = 20 }: { selected: boolean; size?: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: selected ? tokens.labelOnFill : 'transparent',
        background: selected ? tokens.accent : 'transparent',
        border: `1.5px solid ${selected ? tokens.accent : tokens.borderL3}`,
        boxSizing: 'border-box',
      }}
    >
      <CheckIcon size={size - 8} />
    </span>
  )
}

/** 弹窗：遮罩 + 居中面板；Esc / 遮罩关闭由调用方决定是否二次确认。 */
export interface ModalProps {
  title: string
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}

export function Modal({ title, closeLabel, onClose, children, footer, width = 720 }: ModalProps): React.ReactElement {
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusables = (): HTMLElement[] => {
      const root = dialogRef.current
      if (root === null) return []
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)
    }

    dialogRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: tokens.bgMask,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.lg,
        boxSizing: 'border-box',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: tokens.bgLayer1,
          border: `1px solid ${tokens.borderL2}`,
          borderRadius: radius.panel,
          boxShadow: tokens.shadowPanel,
          overflow: 'hidden',
          outline: 'none',
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.md,
            padding: `${space.md}px ${space.lg}px`,
            borderBottom: `1px solid ${rule}`,
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: bigger(2), fontWeight: 600, color: tokens.labelPrimary }}>
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
            style={{
              ...ghostButtonStyle(false),
              width: controlHeight,
              padding: 0,
              justifyContent: 'center',
              fontSize: bigger(3),
              color: tokens.labelSecondary,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: space.lg,
            overflowY: 'auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: space.md,
          }}
        >
          {children}
        </div>
        {footer === undefined ? null : (
          <div
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: space.sm,
              padding: `${space.md}px ${space.lg}px`,
              borderTop: `1px solid ${rule}`,
              background: tokens.bgLayer1,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** 表单字段：标签 + 控件 + 就地错误 / 提示。 */
export interface FieldProps {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  children: React.ReactNode
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 }}>
      <label htmlFor={htmlFor} style={{ color: tokens.labelSecondary, fontSize: tokens.fontSecondary, lineHeight: '18px' }}>
        {label}
      </label>
      {children}
      {error === undefined || error === '' ? null : (
        <div
          id={htmlFor === undefined ? undefined : `${htmlFor}-error`}
          role="alert"
          style={{ color: tokens.error, fontSize: tokens.fontSecondary, lineHeight: '18px' }}
        >
          {error}
        </div>
      )}
      {hint === undefined || hint === '' ? null : (
        <div style={{ color: tokens.labelTertiary, fontSize: tokens.fontSecondary, lineHeight: '18px' }}>{hint}</div>
      )}
    </div>
  )
}

/** 开关（视觉复刻 DSH 的 switch）。 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space.sm,
        height: controlHeight,
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? tokens.labelTertiary : tokens.labelSecondary,
        font: 'inherit',
        fontSize: tokens.fontBase,
        lineHeight: '20px',
        textAlign: 'left',
        whiteSpace: 'normal',
        minWidth: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 18,
          borderRadius: 999,
          boxSizing: 'border-box',
          padding: 2,
          flex: 'none',
          background: checked ? tokens.brand : tokens.bgModule,
          boxShadow: `inset 0 0 0 1px ${checked ? tokens.brand : tokens.borderL3}`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: checked ? 'flex-end' : 'flex-start',
          transition: 'background 120ms ease',
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: checked ? tokens.labelOnFill : tokens.labelSecondary,
            display: 'block',
          }}
        />
      </span>
      <span>{label}</span>
    </button>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/** 分段控件：容器浅灰底，选中项白底 + 细边，与 DSH 分段一致。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}): React.ReactElement {
  const move = (delta: number): void => {
    const index = options.findIndex((option) => option.value === value)
    if (index < 0) return
    const next = options[(index + delta + options.length) % options.length]
    onChange(next.value)
  }
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        gap: 2,
        padding: 2,
        border: `1px solid ${tokens.borderL2}`,
        borderRadius: radius.md,
        background: tokens.bgModule,
        height: controlHeight,
        boxSizing: 'border-box',
      }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            style={{
              font: 'inherit',
              fontSize: tokens.fontBase,
              lineHeight: '20px',
              padding: `0 ${space.md}px`,
              border: selected ? `1px solid ${tokens.borderL3}` : '1px solid transparent',
              borderRadius: radius.sm,
              background: selected ? tokens.bgLayer1 : 'transparent',
              boxShadow: selected ? tokens.shadowSoft : 'none',
              color: selected ? tokens.labelPrimary : tokens.labelSecondary,
              fontWeight: selected ? 600 : 400,
              cursor: disabled ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export type TagTone = 'outline' | 'neutral' | 'solid' | 'quiet' | 'success' | 'info' | 'warning' | 'error'

/** 逐条复刻 DSH `_tag` 的八个 tone。 */
const TAG_TONE_STYLES: Record<TagTone, React.CSSProperties> = {
  outline: { border: `1px solid ${tokens.borderL3}`, color: tokens.labelSecondary },
  neutral: { background: tokens.bgModule, color: tokens.labelSecondary },
  solid: { background: tokens.brand, color: tokens.labelOnFill },
  quiet: { color: tokens.labelTertiary },
  success: { background: tokens.successSoft, color: tokens.labelPrimary },
  info: {
    background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 10%, transparent)',
    color: tokens.info,
  },
  // 琥珀 #f59e0b 作文字在浅色底只有 ~2:1，改用 DSH 的 warn-label（amber-600）+ 浅底。
  warning: { background: tokens.warnSoft, color: tokens.warnText },
  error: {
    background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #f25a5a) 10%, transparent)',
    color: tokens.error,
  },
}

export function Tag({
  children,
  tone = 'outline',
  title,
}: {
  children: React.ReactNode
  tone?: TagTone
  title?: string
}): React.ReactElement {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: radius.pill,
        padding: '1px 8px',
        fontSize: smaller(3),
        lineHeight: '17px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        flex: 'none',
        boxSizing: 'border-box',
        ...TAG_TONE_STYLES[tone],
      }}
    >
      {children}
    </span>
  )
}

/** 筛选胶囊（同 Tag 的 pill 形态，可点击、有选中态）。 */
export function FilterChip({
  label,
  count,
  selected,
  onClick,
  ariaLabel,
  color,
}: {
  label: string
  count?: number
  selected: boolean
  onClick: () => void
  ariaLabel?: string
  color?: string
}): React.ReactElement {
  const [hovered, hoverEvents] = useHover()
  const accent = color ?? tokens.accent
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      {...hoverEvents}
      style={{
        font: 'inherit',
        fontSize: tokens.fontSecondary,
        lineHeight: '18px',
        height: chipHeight,
        padding: `0 ${space.sm + 2}px`,
        borderRadius: radius.pill,
        border: `1px solid ${selected ? accent : 'transparent'}`,
        background: selected ? tokens.bgLayer1 : hovered ? tokens.bgHover : tokens.bgModule,
        boxShadow: selected ? `inset 0 0 0 ${tokens.hairline} ${accent}` : 'none',
        color: selected ? tokens.labelPrimary : tokens.labelSecondary,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: space.xs + 2,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {color === undefined ? null : (
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: accent, flex: 'none' }} />
      )}
      <span>{label}</span>
      {count === undefined ? null : (
        <span
          style={{
            color: selected ? tokens.labelPrimary : tokens.labelTertiary,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: selected ? 600 : 400,
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export interface DropdownItem {
  key: string
  label: string
  selected?: boolean
  onSelect: () => void
}

/** 自绘下拉菜单（间隔/工作区共用）。 */
export function Dropdown({
  trigger,
  items,
  ariaLabel,
  align = 'left',
  menuWidth = 160,
  side = 'down',
  disabled = false,
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode
  items: readonly DropdownItem[]
  ariaLabel: string
  align?: 'left' | 'right'
  menuWidth?: number
  side?: 'down' | 'up'
  disabled?: boolean
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [flipped, setFlipped] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  const close = (): void => setOpen(false)

  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 阻止冒泡，避免同时关掉外层 Modal
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  // 打开后聚焦菜单并测量是否需要向上翻转
  React.useLayoutEffect(() => {
    if (!open) return
    setActive(Math.max(0, items.findIndex((item) => item.selected === true)))
    const element = menuRef.current
    if (element !== null) {
      const rect = element.getBoundingClientRect()
      const overflowBottom = rect.bottom > window.innerHeight - space.sm
      setFlipped(side === 'down' ? overflowBottom : false)
    }
    element?.focus()
  }, [open, items, side])

  const choose = (index: number): void => {
    const item = items[index]
    if (item === undefined) return
    close()
    item.onSelect()
  }

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % Math.max(1, items.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index - 1 + items.length) % Math.max(1, items.length))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(Math.max(0, items.length - 1))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  const up = side === 'up' || flipped
  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
      {trigger({ open, toggle: () => (disabled ? undefined : setOpen((value) => !value)) })}
      {open && !disabled ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'absolute',
            ...(up ? { bottom: `calc(100% + ${space.xs}px)` } : { top: `calc(100% + ${space.xs}px)` }),
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
            minWidth: menuWidth,
            maxWidth: 320,
            maxHeight: 300,
            overflowY: 'auto',
            background: tokens.menuSurface,
            backdropFilter: tokens.menuBlur,
            WebkitBackdropFilter: tokens.menuBlur,
            border: `1px solid ${tokens.borderL2}`,
            borderRadius: radius.md,
            boxShadow: tokens.shadowPanel,
            padding: space.xs,
            zIndex: 60,
            boxSizing: 'border-box',
            outline: 'none',
          }}
        >
          {items.map((item, index) => {
            const highlighted = index === active
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={item.selected === true}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                style={{
                  width: '100%',
                  font: 'inherit',
                  fontSize: tokens.fontBase,
                  lineHeight: '20px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space.sm,
                  padding: `0 ${space.sm}px`,
                  height: controlHeight,
                  border: 'none',
                  borderRadius: radius.sm,
                  background: highlighted || item.selected === true ? tokens.bgHover : 'transparent',
                  color: item.selected === true ? tokens.labelPrimary : tokens.labelSecondary,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                {item.selected === true ? <CheckIcon size={13} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** 本地化时间：本地时区 HH:mm:ss。 */
export function formatClock(value: string): string {
  if (value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return date.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return date.toISOString().slice(11, 19)
  }
}
