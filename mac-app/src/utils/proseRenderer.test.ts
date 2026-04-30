import { describe, expect, it, vi } from 'vitest';
import {
  PROSE_RENDERER_STORAGE_KEY,
  persistProseRenderer,
  restoreProseRenderer,
} from './proseRenderer';

describe('proseRenderer', () => {
  it('restores Prose UI only from the explicit saved value', () => {
    expect(restoreProseRenderer({ getItem: () => 'prose-ui' })).toBe('prose-ui');
    expect(restoreProseRenderer({ getItem: () => 'field-theory' })).toBe('field-theory');
    expect(restoreProseRenderer({ getItem: () => 'unexpected' })).toBe('field-theory');
    expect(restoreProseRenderer({ getItem: () => null })).toBe('field-theory');
  });

  it('persists the renderer under the shared storage key', () => {
    const setItem = vi.fn();

    persistProseRenderer({ setItem }, 'prose-ui');

    expect(setItem).toHaveBeenCalledWith(PROSE_RENDERER_STORAGE_KEY, 'prose-ui');
  });
});
