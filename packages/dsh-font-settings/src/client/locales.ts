/** settings.font 文案（zh/en 双语；t 座椅的键集）。 */
export type FontKey =
  | 'uiFontLabel'
  | 'monoFontLabel'
  | 'uiFontHint'
  | 'monoFontHint'
  | 'preview'
  | 'previewBody'
  | 'previewCode'
  | 'fontsLoading'
  | 'fontsLoadFailed'
  | 'noFontMatch'
  | 'overridden'
  | 'reset'
  | 'invalid'
  | 'save'
  | 'saving'
  | 'saveFailed'
  | 'unavailable'
  | 'readonly'

export const zh: Record<FontKey, string> = {
  uiFontLabel: '正文字体',
  monoFontLabel: '等宽字体',
  uiFontHint: '正文/界面文字；留空恢复 DSH 默认',
  monoFontHint: '代码/等宽场景字体；留空恢复 DSH 默认',
  preview: '预览',
  previewBody: 'Aa 中文 123 “引号”',
  previewCode: 'const foo = () => “代码”',
  fontsLoading: '正在加载字体列表…',
  fontsLoadFailed: '无法加载字体列表，可直接输入字体名',
  noFontMatch: '没有匹配的字体',
  overridden: '已设置',
  reset: '恢复默认',
  invalid: '输入无效',
  save: '保存',
  saving: '保存中…',
  saveFailed: '保存失败，请重试。',
  unavailable: '该设置当前不可用。',
  readonly: '当前连接为只读，无法保存更改。',
}

export const en: Record<FontKey, string> = {
  uiFontLabel: 'Body font',
  monoFontLabel: 'Monospace font',
  uiFontHint: 'Body/interface text; empty restores the DSH default',
  monoFontHint: 'Code/monospace text; empty restores the DSH default',
  preview: 'Preview',
  previewBody: 'Aa 中文 123 “quotes”',
  previewCode: 'const foo = () => “code”',
  fontsLoading: 'Loading fonts…',
  fontsLoadFailed: 'Font list unavailable; you can type a font name directly',
  noFontMatch: 'No matching font',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Invalid input',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'Failed to save. Please retry.',
  unavailable: 'This setting is currently unavailable.',
  readonly: 'This connection is read-only; changes cannot be saved.',
}
