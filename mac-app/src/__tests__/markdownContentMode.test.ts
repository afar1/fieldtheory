import { describe, expect, it } from 'vitest';
import {
  coerceMarkdownContentMode,
  getAvailableMarkdownContentModes,
  getNextMarkdownContentMode,
  isMarkdownContentMode,
} from '../utils/markdownContentMode';

describe('markdown content mode helpers', () => {
  it('keeps Typedown unavailable unless the app enables it', () => {
    expect(getAvailableMarkdownContentModes()).toEqual(['rendered', 'markdown']);
    expect(getAvailableMarkdownContentModes({ typedownEnabled: true })).toEqual(['rendered', 'markdown', 'typedown']);
    expect(coerceMarkdownContentMode('typedown')).toBe('rendered');
    expect(coerceMarkdownContentMode('typedown', { typedownEnabled: true })).toBe('typedown');
  });

  it('cycles rendered, markdown, and Typedown only when enabled', () => {
    expect(getNextMarkdownContentMode('rendered')).toBe('markdown');
    expect(getNextMarkdownContentMode('markdown')).toBe('rendered');
    expect(getNextMarkdownContentMode('rendered', { typedownEnabled: true })).toBe('markdown');
    expect(getNextMarkdownContentMode('markdown', { typedownEnabled: true })).toBe('typedown');
    expect(getNextMarkdownContentMode('typedown', { typedownEnabled: true })).toBe('rendered');
  });

  it('recognizes the persisted Typedown mode string', () => {
    expect(isMarkdownContentMode('typedown')).toBe(true);
    expect(isMarkdownContentMode('source')).toBe(false);
  });
});
