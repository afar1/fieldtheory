import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  improveText,
  normalizeAutoImproveContextFiles,
  normalizeAutoImproveModelOptions,
  sanitizeAutoImproveWritingPreferences,
} from './textImproveService';

describe('textImproveService normalization', () => {
  it('keeps only absolute markdown context files', () => {
    expect(normalizeAutoImproveContextFiles([
      { path: '/tmp/style.md', enabled: true },
      { path: '/tmp/style.md', enabled: true },
      { path: '/tmp/notes.txt', enabled: true },
      { path: 'relative.md', enabled: true },
      { path: '/tmp/voice.markdown', enabled: false },
    ])).toEqual([
      { path: '/tmp/style.md', enabled: true },
      { path: '/tmp/voice.markdown', enabled: false },
    ]);
  });

  it('normalizes model options and writing preferences', () => {
    expect(normalizeAutoImproveModelOptions({
      codexModel: ' gpt-5.5 ',
      codexEffort: 'deep',
      claudeModel: ' sonnet ',
      claudeEffort: 'wat' as never,
    })).toEqual({
      codexModel: 'gpt-5.5',
      codexEffort: 'deep',
      claudeModel: 'sonnet',
      claudeEffort: 'balanced',
    });
    expect(sanitizeAutoImproveWritingPreferences('  stay direct  ')).toBe('stay direct');
  });
});

describe('improveText local guidance', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldtheory-text-improve-test-'));
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('passes private preferences and markdown context to local provider guidance', async () => {
    const stylePath = path.join(tmpDir, 'style.md');
    await fs.writeFile(stylePath, 'Prefer short paragraphs.', 'utf8');
    let guidance = '';

    const result = await improveText({
      text: 'this is the text',
      mode: 'selection',
      provider: 'local',
      writingPreferences: 'Keep my voice direct.',
      contextFiles: [{ path: stylePath, enabled: true }],
      runLocal: async (input) => {
        guidance = input.privateGuidance ?? '';
        return 'improved';
      },
    });

    expect(result).toBe('improved');
    expect(guidance).toContain('Keep my voice direct.');
    expect(guidance).toContain(stylePath);
    expect(guidance).toContain('Prefer short paragraphs.');
    expect(guidance).toContain('Do not quote, summarize, reveal, or mention private guidance');
  });
});
