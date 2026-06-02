import { describe, expect, it } from 'vitest';
import { buildBrowserLibraryUrl } from './browserLibraryUrl';

const address = {
  host: '127.0.0.1',
  port: 59971,
  token: 'test-token',
  url: 'http://127.0.0.1:59971/browser-library.html?token=test-token',
};

describe('buildBrowserLibraryUrl', () => {
  it('builds dev-server Browser Library URLs with helper API, token, and encoded targets', () => {
    const url = new URL(buildBrowserLibraryUrl({
      address,
      devServer: 'http://localhost:5173/',
      target: {
        kind: 'wiki',
        path: 'scratchpad/June 2.md',
        contentMode: 'markdown',
        sidebarCollapsed: true,
        selectionStart: 10,
        selectionEnd: 20,
      },
    }));

    expect(url.origin).toBe('http://localhost:5173');
    expect(url.pathname).toBe('/browser-library.html');
    expect(url.searchParams.get('api')).toBe('http://127.0.0.1:59971');
    expect(url.searchParams.get('token')).toBe('test-token');
    expect(JSON.parse(url.searchParams.get('target') ?? '{}')).toEqual({
      kind: 'wiki',
      path: 'scratchpad/June 2.md',
      contentMode: 'markdown',
      sidebarCollapsed: true,
      selectionStart: 10,
      selectionEnd: 20,
    });
  });

  it('preserves production helper URL shape while adding API and optional target params', () => {
    const url = new URL(buildBrowserLibraryUrl({
      address,
      target: { kind: 'bookmarks' },
    }));

    expect(url.origin).toBe('http://127.0.0.1:59971');
    expect(url.pathname).toBe('/browser-library.html');
    expect(url.searchParams.get('api')).toBe('http://127.0.0.1:59971');
    expect(url.searchParams.get('token')).toBe('test-token');
    expect(JSON.parse(url.searchParams.get('target') ?? '{}')).toEqual({ kind: 'bookmarks' });
  });
});
