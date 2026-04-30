import { fonts } from '../design/tokens';

export const LIBRARIAN_TYPOGRAPHY_STORAGE_KEY = 'librarian-typography-preset';
export const LIBRARIAN_LINE_HEIGHT_STORAGE_KEY = 'librarian-line-height';

export type LibrarianTypographyPresetId = 'book' | 'note' | 'draft';
export type LibrarianLineHeightId = 'tight' | 'normal' | 'loose';

export type LibrarianTypographyPreset = {
  id: LibrarianTypographyPresetId;
  label: string;
  title: string;
  fontFamily: string;
  headingFontFamily: string;
  lineHeight: number;
  maxWidth: string;
};

export const DEFAULT_LIBRARIAN_TYPOGRAPHY_PRESET: LibrarianTypographyPresetId = 'book';
export const DEFAULT_LIBRARIAN_LINE_HEIGHT: LibrarianLineHeightId = 'normal';

export const LIBRARIAN_TYPOGRAPHY_PRESETS: LibrarianTypographyPreset[] = [
  {
    id: 'book',
    label: 'Book',
    title: 'Serif, wider leading, best for longer reading',
    fontFamily: `"New York", "Iowan Old Style", ${fonts.serif}`,
    headingFontFamily: `"New York", "Iowan Old Style", ${fonts.serif}`,
    lineHeight: 1.66,
    maxWidth: 'min(720px, 68ch)',
  },
  {
    id: 'note',
    label: 'Note',
    title: 'System text, compact and clear for mixed reading and editing',
    fontFamily: fonts.sans,
    headingFontFamily: fonts.sans,
    lineHeight: 1.58,
    maxWidth: 'min(700px, 66ch)',
  },
  {
    id: 'draft',
    label: 'Draft',
    title: 'Monospace focus mode for raw markdown writing',
    fontFamily: `"iA Writer Mono S", "SF Mono", ${fonts.mono}`,
    headingFontFamily: `"iA Writer Mono S", "SF Mono", ${fonts.mono}`,
    lineHeight: 1.7,
    maxWidth: 'min(680px, 64ch)',
  },
];

export const LIBRARIAN_LINE_HEIGHT_OPTIONS: Array<{
  id: LibrarianLineHeightId;
  label: string;
  title: string;
  value: number | null;
}> = [
  { id: 'tight', label: 'Tight', title: 'Tighter line spacing', value: 1.45 },
  { id: 'normal', label: 'Normal', title: 'Font default line spacing', value: null },
  { id: 'loose', label: 'Loose', title: 'Looser line spacing', value: 1.82 },
];

export function isLibrarianTypographyPresetId(value: unknown): value is LibrarianTypographyPresetId {
  return value === 'book' || value === 'note' || value === 'draft';
}

export function isLibrarianLineHeightId(value: unknown): value is LibrarianLineHeightId {
  return value === 'tight' || value === 'normal' || value === 'loose';
}

export function resolveLibrarianLineHeight(
  lineHeight: LibrarianLineHeightId,
  preset: LibrarianTypographyPreset,
): number {
  const option = LIBRARIAN_LINE_HEIGHT_OPTIONS.find((item) => item.id === lineHeight);
  return option?.value ?? preset.lineHeight;
}

export function resolveLibrarianParagraphSpacing(lineHeight: LibrarianLineHeightId): string {
  if (lineHeight === 'tight') return '0.52em';
  if (lineHeight === 'loose') return '1.08em';
  return '0.78em';
}

export function restoreLibrarianTypographyPreset(
  storage: Pick<Storage, 'getItem'>,
): LibrarianTypographyPresetId {
  const saved = storage.getItem(LIBRARIAN_TYPOGRAPHY_STORAGE_KEY);
  return isLibrarianTypographyPresetId(saved) ? saved : DEFAULT_LIBRARIAN_TYPOGRAPHY_PRESET;
}

export function persistLibrarianTypographyPreset(
  storage: Pick<Storage, 'setItem'>,
  preset: LibrarianTypographyPresetId,
): void {
  storage.setItem(LIBRARIAN_TYPOGRAPHY_STORAGE_KEY, preset);
}

export function restoreLibrarianLineHeight(
  storage: Pick<Storage, 'getItem'>,
): LibrarianLineHeightId {
  const saved = storage.getItem(LIBRARIAN_LINE_HEIGHT_STORAGE_KEY);
  return isLibrarianLineHeightId(saved) ? saved : DEFAULT_LIBRARIAN_LINE_HEIGHT;
}

export function persistLibrarianLineHeight(
  storage: Pick<Storage, 'setItem'>,
  lineHeight: LibrarianLineHeightId,
): void {
  storage.setItem(LIBRARIAN_LINE_HEIGHT_STORAGE_KEY, lineHeight);
}
