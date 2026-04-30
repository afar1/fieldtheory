export type ProseRenderer = 'field-theory' | 'prose-ui';

export const PROSE_RENDERER_STORAGE_KEY = 'fieldtheory-prose-renderer';

export const PROSE_RENDERER_OPTIONS: Array<{
  id: ProseRenderer;
  label: string;
  title: string;
}> = [
  { id: 'field-theory', label: 'Field', title: 'Field Theory prose styling' },
  { id: 'prose-ui', label: 'Prose', title: 'Prose UI package styling' },
];

export function restoreProseRenderer(storage: Pick<Storage, 'getItem'>): ProseRenderer {
  const saved = storage.getItem(PROSE_RENDERER_STORAGE_KEY);
  return saved === 'prose-ui' ? 'prose-ui' : 'field-theory';
}

export function persistProseRenderer(storage: Pick<Storage, 'setItem'>, renderer: ProseRenderer): void {
  storage.setItem(PROSE_RENDERER_STORAGE_KEY, renderer);
}
