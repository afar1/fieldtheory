import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE,
  PARAKEET_VISIBLE_ENGINE_OPTIONS,
  normalizeVisibleTranscriptionEngine,
} from './transcriptionEngines';

describe('transcriptionEngines utils', () => {
  it('normalizes unsupported engines to whisper', () => {
    expect(normalizeVisibleTranscriptionEngine('qwen')).toBe(DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE);
    expect(normalizeVisibleTranscriptionEngine('mlx-whisper')).toBe(DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE);
    expect(normalizeVisibleTranscriptionEngine(undefined)).toBe(DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE);
  });

  it('preserves visible engines', () => {
    expect(normalizeVisibleTranscriptionEngine('whisper')).toBe('whisper');
    expect(normalizeVisibleTranscriptionEngine('parakeet')).toBe('parakeet');
    expect(normalizeVisibleTranscriptionEngine('parakeet-multilingual')).toBe('parakeet-multilingual');
  });

  it('marks only the English parakeet option as recommended', () => {
    expect(PARAKEET_VISIBLE_ENGINE_OPTIONS.map((option) => ({
      id: option.id,
      recommended: option.recommended ?? false,
    }))).toEqual([
      { id: 'parakeet', recommended: true },
      { id: 'parakeet-multilingual', recommended: false },
    ]);
  });
});
