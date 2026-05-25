import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { nativeGhosttyHostCandidatePaths, loadNativeGhosttyHost } from './nativeGhosttyHost';

describe('nativeGhosttyHostCandidatePaths', () => {
  it('checks the development native build path first', () => {
    const paths = nativeGhosttyHostCandidatePaths('/app', '/app/electron-dist/main');

    expect(paths[0]).toBe('/app/electron/native/build/ghostty-host.node');
  });
});

describe('loadNativeGhosttyHost', () => {
  it('reports a missing native host bridge without throwing', () => {
    const root = join(tmpdir(), `missing-ghostty-host-${Date.now()}`);

    const result = loadNativeGhosttyHost(root, join(root, 'electron-dist', 'main'));

    expect(result).toMatchObject({
      ok: false,
      modulePath: null,
      host: null,
      error: 'Ghostty native host bridge is not built.',
    });
  });

  it('reports load errors from an invalid native host bridge', () => {
    const root = join(tmpdir(), `invalid-ghostty-host-${Date.now()}`);
    const modulePath = join(root, 'electron', 'native', 'build', 'ghostty-host.node');
    mkdirSync(join(root, 'electron', 'native', 'build'), { recursive: true });
    writeFileSync(modulePath, 'not a native module', 'utf8');

    try {
      const result = loadNativeGhosttyHost(root, join(root, 'electron-dist', 'main'));

      expect(result.ok).toBe(false);
      expect(result.modulePath).toBe(modulePath);
      expect(result.host).toBeNull();
      expect(result.error).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
