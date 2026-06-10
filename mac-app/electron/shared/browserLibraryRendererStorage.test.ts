import { describe, expect, it, vi } from 'vitest';

import {
  hydrateMissingBrowserLibraryRendererStorage,
  readBrowserLibraryRendererStorageValues,
} from './browserLibraryRendererStorage';

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

describe('browser library renderer storage helpers', () => {
  it('hydrates missing values without clobbering newer renderer state', () => {
    const storage = makeStorage({
      'librarian-last-selection': '{"type":"wiki","relPath":"scratchpad/Renderer"}',
      'librarian-editor-session': '{"path":"scratchpad/Renderer"}',
      'fieldtheory-text-cursor-blink': 'true',
    });

    hydrateMissingBrowserLibraryRendererStorage(storage, {
      available: true,
      values: {
        'librarian-last-selection': '{"type":"wiki","relPath":"scratchpad/StaleBridge"}',
        'librarian-editor-session': '{"path":"scratchpad/StaleBridge"}',
        'fieldtheory-text-cursor-blink': 'false',
        'bookmarks-view-mode': 'list',
      },
    });

    expect(storage.getItem('librarian-last-selection')).toBe('{"type":"wiki","relPath":"scratchpad/Renderer"}');
    expect(storage.getItem('librarian-editor-session')).toBe('{"path":"scratchpad/Renderer"}');
    expect(storage.getItem('fieldtheory-text-cursor-blink')).toBe('true');
    expect(storage.getItem('bookmarks-view-mode')).toBe('list');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('reads current renderer values for durable bridge repair', () => {
    const storage = makeStorage({
      'librarian-last-selection': '{"type":"wiki","relPath":"scratchpad/Renderer"}',
      'librarian-editor-session': '{"path":"scratchpad/Renderer"}',
      'fieldtheory-text-cursor-blink': 'false',
    });

    const values = readBrowserLibraryRendererStorageValues(storage);

    expect(values['librarian-last-selection']).toBe('{"type":"wiki","relPath":"scratchpad/Renderer"}');
    expect(values['librarian-editor-session']).toBe('{"path":"scratchpad/Renderer"}');
    expect(values['fieldtheory-text-cursor-blink']).toBe('false');
    expect(values['bookmarks-view-mode']).toBeNull();
  });
});
