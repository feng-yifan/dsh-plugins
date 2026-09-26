import { useEffect } from 'react'
import { SettingsForm, type SettingsFormActions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { FontCombobox } from './FontCombobox'
import { DEFAULT_MONO_STACK, DEFAULT_UI_STACK, applyFonts, buildStack } from './fonts'
import type { FontKey } from './locales'
import type { FontCardSnapshot } from './types'

/** SettingsForm 需要的表单文案（rewind 同款结构）。 */
export function formLabels(t: (key: FontKey) => string): {
  unavailable: string
  readOnly: string
  saveFailed: string
  save: string
  saving: string
} {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readonly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/** 注册时 inject 工厂返回的注入面：快照 store + 表单动作。 */
export interface FontCardInjected extends SettingsFormActions {
  hooks: {
    fontCard: SnapshotStore<FontCardSnapshot>
  }
}

/** 框架合成 props：locale 座椅 t + owner 的 view + useFontCard + 表单动作。 */
export interface FontCardComponentProps extends SettingsFormActions {
  t: (key: FontKey) => string
  view?: 'summary' | 'page'
  useFontCard: <S>(selector: (snapshot: FontCardSnapshot) => S) => S
}

/**
 * 插件管理页（设置 → 插件 → 字体设置）的配置卡。
 *
 * 表单思路：dsh 的 SettingsFormModel 负责「暂存 → 保存」语义（编辑只改草稿，
 * 保存按钮是草稿落库的唯一入口），SettingsForm 提供外观与状态（只读/保存失败）。
 * 每个字段是 FontCombobox：可搜索的系统字体下拉 + 已设置徽标 + 恢复默认；
 * 各自字段下方一个带「预览」label 的样例块（正文 / 代码），跟随暂存文本
 * 实时刷新；整界面的字体变量也随暂存文本实时应用。
 */
export function FontCard({ t, view, useFontCard, edit, resetField, save, discard }: FontCardComponentProps): JSX.Element | null {
  const state = useFontCard((s) => s)
  if (view === 'summary') return null

  // 实时预览：暂存文本（含尚未保存的输入）即时应用到整界面。
  useEffect(() => {
    applyFonts(state.uiFont.text, state.monoFont.text)
  }, [state.uiFont.text, state.monoFont.text])

  const uiFont = state.uiFont.text.trim()
  const monoFont = state.monoFont.text.trim()

  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={save} onDiscard={discard}>
      <FontCombobox
        id="font-ui"
        label={t('uiFontLabel')}
        placeholder={t('uiFontHint')}
        text={state.uiFont.text}
        overridden={state.uiFont.overridden}
        invalid={state.uiFont.invalid}
        disabled={!state.writable}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        loadingLabel={t('fontsLoading')}
        loadFailedLabel={t('fontsLoadFailed')}
        noMatchLabel={t('noFontMatch')}
        previewLabel={t('preview')}
        previewSample={t('previewBody')}
        previewFontFamily={uiFont ? buildStack(uiFont, DEFAULT_UI_STACK) : undefined}
        onReset={() => resetField('uiFont')}
        onEdit={(text) => edit('uiFont', text)}
      />
      <FontCombobox
        id="font-mono"
        separated
        label={t('monoFontLabel')}
        placeholder={t('monoFontHint')}
        text={state.monoFont.text}
        overridden={state.monoFont.overridden}
        invalid={state.monoFont.invalid}
        disabled={!state.writable}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        loadingLabel={t('fontsLoading')}
        loadFailedLabel={t('fontsLoadFailed')}
        noMatchLabel={t('noFontMatch')}
        previewLabel={t('preview')}
        previewSample={t('previewCode')}
        previewFontFamily={monoFont ? buildStack(monoFont, DEFAULT_MONO_STACK) : undefined}
        onReset={() => resetField('monoFont')}
        onEdit={(text) => edit('monoFont', text)}
      />
    </SettingsForm>
  )
}
