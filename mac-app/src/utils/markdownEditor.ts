export type MarkdownEditor = 'textarea' | 'codemirror';

export const MARKDOWN_EDITOR_STORAGE_KEY = 'fieldtheory-markdown-editor';

export const MARKDOWN_EDITOR_OPTIONS: Array<{
  id: MarkdownEditor;
  label: string;
  title: string;
}> = [
  { id: 'textarea', label: 'Plain', title: 'Native textarea (current)' },
  { id: 'codemirror', label: 'CodeMirror', title: 'CodeMirror 6 with markdown syntax highlighting' },
];

export function restoreMarkdownEditor(storage: Pick<Storage, 'getItem'>): MarkdownEditor {
  const saved = storage.getItem(MARKDOWN_EDITOR_STORAGE_KEY);
  return saved === 'codemirror' ? 'codemirror' : 'textarea';
}

export function persistMarkdownEditor(storage: Pick<Storage, 'setItem'>, editor: MarkdownEditor): void {
  storage.setItem(MARKDOWN_EDITOR_STORAGE_KEY, editor);
}
