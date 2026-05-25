import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { probeGhosttyIntegration } from './ghosttyIntegration';

function makeGhosttyFixture(input: { includeHeader?: boolean; library?: boolean; license?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ghostty-fixture-'));
  mkdirSync(join(dir, 'zig-out', 'include', 'ghostty'), { recursive: true });
  mkdirSync(join(dir, 'zig-out', 'lib'), { recursive: true });
  mkdirSync(join(dir, 'macos', 'GhosttyKit.xcframework', 'macos-arm64_x86_64', 'Headers'), { recursive: true });
  if (input.includeHeader !== false) {
    writeFileSync(
      join(dir, 'zig-out', 'include', 'ghostty', 'vt.h'),
      'WARNING: This is an incomplete, work-in-progress API. It is not yet stable.',
      'utf8',
    );
    writeFileSync(
      join(dir, 'macos', 'GhosttyKit.xcframework', 'macos-arm64_x86_64', 'Headers', 'ghostty.h'),
      "This isn't meant to be a general purpose embedding API",
      'utf8',
    );
  }
  if (input.library !== false) {
    writeFileSync(join(dir, 'zig-out', 'lib', 'libghostty-vt.0.1.0.dylib'), '', 'utf8');
  }
  if (input.license !== false) {
    writeFileSync(join(dir, 'LICENSE'), 'MIT License', 'utf8');
  }
  return dir;
}

describe('probeGhosttyIntegration', () => {
  it('reports a ready local Ghostty checkout when headers, library, and license are present', () => {
    const sourceDir = makeGhosttyFixture();

    try {
      const result = probeGhosttyIntegration({ env: { GHOSTTY_SOURCE_DIR: sourceDir }, homeDir: '/missing-home' });

      expect(result.status).toBe('ready');
      expect(result.sourceDir).toBe(sourceDir);
      expect(result.vtHeaderPath).toContain('ghostty/vt.h');
      expect(result.libraryPath).toContain('libghostty-vt.0.1.0.dylib');
      expect(result.kitFrameworkPath).toContain('GhosttyKit.xcframework');
      expect(result.kitMacosHeaderDir).toContain('macos-arm64_x86_64/Headers');
      expect(result.licensePath).toContain('LICENSE');
      expect(result.warnings).toContain('libghostty-vt API is not yet stable; expect breaking changes.');
      expect(result.warnings).toContain('Full libghostty embedding API is not documented as general-purpose yet.');
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('reports missing source when no checkout can be found', () => {
    const result = probeGhosttyIntegration({ env: {}, homeDir: '/missing-home' });

    expect(result.status).toBe('missing-source');
    expect(result.warnings).toContain('Set GHOSTTY_SOURCE_DIR to a local Ghostty checkout.');
  });

  it('reports missing library before treating the integration as ready', () => {
    const sourceDir = makeGhosttyFixture({ library: false });

    try {
      const result = probeGhosttyIntegration({ env: { GHOSTTY_SOURCE_DIR: sourceDir }, homeDir: '/missing-home' });

      expect(result.status).toBe('missing-library');
      expect(result.libraryPath).toBeNull();
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('can resolve a checkout through the default home/dev/ghostty convention', () => {
    const root = mkdtempSync(join(tmpdir(), 'ghostty-home-'));
    const sourceDir = makeGhosttyFixture();
    mkdirSync(join(root, 'dev'), { recursive: true });
    symlinkSync(sourceDir, join(root, 'dev', 'ghostty'));

    try {
      const result = probeGhosttyIntegration({ env: {}, homeDir: root });

      expect(result.status).toBe('ready');
      expect(result.sourceDir).toBe(join(root, 'dev', 'ghostty'));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});
