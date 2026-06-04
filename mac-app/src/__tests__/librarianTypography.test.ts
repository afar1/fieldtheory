import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARIAN_TYPOGRAPHY_PRESET,
  LIBRARIAN_LINE_HEIGHT_STORAGE_KEY,
  LIBRARIAN_LINE_HEIGHT_OPTIONS,
  LIBRARIAN_TYPOGRAPHY_PRESETS,
  LIBRARIAN_TYPOGRAPHY_STORAGE_KEY,
  persistLibrarianLineHeight,
  persistLibrarianTypographyPreset,
  resolveLibrarianDocumentMaxWidth,
  resolveLibrarianLineHeight,
  resolveLibrarianParagraphSpacing,
  restoreLibrarianLineHeight,
  restoreLibrarianTypographyPreset,
} from '../utils/librarianTypography';

describe('librarian typography presets', () => {
  it('keeps the font choices curated', () => {
    expect(LIBRARIAN_TYPOGRAPHY_PRESETS.map((preset) => preset.id)).toEqual(['book', 'note', 'draft']);
  });

  it('uses Source families for Book and Note', () => {
    expect(LIBRARIAN_TYPOGRAPHY_PRESETS.find((preset) => preset.id === 'book')?.fontFamily).toContain('"Source Serif 4"');
    expect(LIBRARIAN_TYPOGRAPHY_PRESETS.find((preset) => preset.id === 'note')?.fontFamily).toContain('"Source Sans 3"');
  });

  it('restores a saved typography preset', () => {
    const storage = {
      getItem: (key: string) => key === LIBRARIAN_TYPOGRAPHY_STORAGE_KEY ? 'draft' : null,
    };

    expect(restoreLibrarianTypographyPreset(storage)).toBe('draft');
  });

  it('restores any selectable typography preset', () => {
    for (const preset of LIBRARIAN_TYPOGRAPHY_PRESETS) {
      const storage = {
        getItem: (key: string) => key === LIBRARIAN_TYPOGRAPHY_STORAGE_KEY ? preset.id : null,
      };

      expect(restoreLibrarianTypographyPreset(storage)).toBe(preset.id);
    }
  });

  it('falls back to the default preset for unknown values', () => {
    const storage = {
      getItem: () => 'papyrus',
    };

    expect(restoreLibrarianTypographyPreset(storage)).toBe(DEFAULT_LIBRARIAN_TYPOGRAPHY_PRESET);
  });

  it('falls back to the default preset for removed values', () => {
    for (const removedPreset of ['literata', 'atkinson', 'plex-mono']) {
      const storage = {
        getItem: () => removedPreset,
      };

      expect(restoreLibrarianTypographyPreset(storage)).toBe(DEFAULT_LIBRARIAN_TYPOGRAPHY_PRESET);
    }
  });

  it('persists the selected preset', () => {
    const state: Record<string, string> = {};
    const storage = {
      setItem(key: string, value: string) {
        state[key] = value;
      },
    };

    persistLibrarianTypographyPreset(storage, 'note');

    expect(state[LIBRARIAN_TYPOGRAPHY_STORAGE_KEY]).toBe('note');
  });

  it('keeps line-height choices curated and persistent', () => {
    expect(LIBRARIAN_LINE_HEIGHT_OPTIONS.map((option) => option.id)).toEqual(['tight', 'normal', 'loose']);

    const state: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => key === LIBRARIAN_LINE_HEIGHT_STORAGE_KEY ? 'loose' : null,
      setItem(key: string, value: string) {
        state[key] = value;
      },
    };

    expect(restoreLibrarianLineHeight(storage)).toBe('loose');
    persistLibrarianLineHeight(storage, 'tight');
    expect(state[LIBRARIAN_LINE_HEIGHT_STORAGE_KEY]).toBe('tight');
    expect(resolveLibrarianLineHeight('normal', LIBRARIAN_TYPOGRAPHY_PRESETS[0])).toBe(LIBRARIAN_TYPOGRAPHY_PRESETS[0].lineHeight);
    expect(resolveLibrarianLineHeight('tight', LIBRARIAN_TYPOGRAPHY_PRESETS[0])).toBe(1.45);
  });

  it('changes paragraph spacing with the line-height choice', () => {
    expect(resolveLibrarianParagraphSpacing('tight')).toBe('0.36em');
    expect(resolveLibrarianParagraphSpacing('normal')).toBe('0.52em');
    expect(resolveLibrarianParagraphSpacing('loose')).toBe('0.78em');
  });

  it('scales document width with text size shortcuts', () => {
    const maxWidth = LIBRARIAN_TYPOGRAPHY_PRESETS[0].maxWidth;

    expect(resolveLibrarianDocumentMaxWidth(maxWidth, 'small')).toBe(`calc(${maxWidth} - 72px)`);
    expect(resolveLibrarianDocumentMaxWidth(maxWidth, 'normal')).toBe(maxWidth);
    expect(resolveLibrarianDocumentMaxWidth(maxWidth, 'large')).toBe(`calc(${maxWidth} + 90px)`);
  });
});
