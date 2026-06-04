import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearImageCacheForTests, getCachedImageUrlSync } from './imageCache';

let storage = new Map<string, string>();

beforeEach(() => {
  storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearImageCacheForTests();
});

describe('imageCache', () => {
  it('parses persistent metadata once across sync cache lookups', () => {
    localStorage.setItem('fieldImageCache', JSON.stringify({
      one: { timestamp: 1, base64: 'AAA=' },
    }));
    const parseSpy = vi.spyOn(JSON, 'parse');

    expect(getCachedImageUrlSync('/image-one.png', 'one')).toBe('data:image/png;base64,AAA=');
    expect(getCachedImageUrlSync('/missing.png', 'missing')).toBe('');

    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('drops oversized persistent metadata instead of parsing it during render', () => {
    localStorage.setItem('fieldImageCache', 'x'.repeat(4 * 1024 * 1024 + 1));
    const parseSpy = vi.spyOn(JSON, 'parse');

    expect(getCachedImageUrlSync('/image-one.png', 'one')).toBe('');

    expect(parseSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('fieldImageCache')).toBeNull();
  });
});
