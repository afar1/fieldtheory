import { describe, expect, it } from 'vitest';

import {
  EMPTY_TRANSCRIPTION_TEXT,
  createCapturedTranscriptEntry,
  normalizeTranscriptText,
  patchTranscriptEntryText,
} from '../../../services/transcriptCapture';
import type { TranscriptEntry } from '../../../types';

const transcript = (id: string, text = id): TranscriptEntry => ({
  id,
  text,
  createdAt: 1000,
  updatedAt: 1000,
});

describe('mobile transcript capture helpers', () => {
  it('trims real transcript text', () => {
    expect(normalizeTranscriptText('  use the review command  ')).toBe('use the review command');
  });

  it('uses a stable empty-recording fallback', () => {
    expect(normalizeTranscriptText(' \n\t ')).toBe(EMPTY_TRANSCRIPTION_TEXT);
  });

  it('creates a raw transcript entry and capture pointer for later command expansion', () => {
    const result = createCapturedTranscriptEntry('  hello world  ', 1234, 'abc123');

    expect(result.entry).toEqual({
      id: '1234-abc123',
      text: 'hello world',
      createdAt: 1234,
      updatedAt: 1234,
    });
    expect(result.capture).toEqual({
      sourceText: 'hello world',
      entryId: '1234-abc123',
    });
  });

  it('patches only the captured transcript entry by id', () => {
    const original = [
      transcript('target', 'use the review command'),
      transcript('other', 'use the review command'),
    ];

    const result = patchTranscriptEntryText(original, 'target', 'expanded command text', 2000);

    expect(result.didPatch).toBe(true);
    expect(result.transcripts).toEqual([
      { ...original[0], text: 'expanded command text', updatedAt: 2000 },
      original[1],
    ]);
  });

  it('returns the same list when the captured transcript is gone', () => {
    const original = [transcript('other')];

    const result = patchTranscriptEntryText(original, 'missing', 'expanded command text', 2000);

    expect(result.didPatch).toBe(false);
    expect(result.transcripts).toBe(original);
  });
});
