import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadGeneratedPublicRuntimeConfig,
  normalizePublicRuntimeConfig,
} from './publicRuntimeConfig';

describe('publicRuntimeConfig', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempFile(contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-public-runtime-config-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'public-runtime-config.json');
    fs.writeFileSync(filePath, contents);
    return filePath;
  }

  it('normalizes public Supabase config values', () => {
    expect(normalizePublicRuntimeConfig({
      supabaseUrl: ' https://example.supabase.co ',
      supabasePublishableKey: ' key ',
    })).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'key',
    });
  });

  it('loads generated config from the first usable file', () => {
    const malformed = tempFile('{');
    const usable = tempFile(JSON.stringify({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'publishable',
    }));

    expect(loadGeneratedPublicRuntimeConfig([malformed, usable])).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'publishable',
    });
  });
});
