import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE,
  PARAKEET_VISIBLE_ENGINE_OPTIONS,
  getVisibleParakeetEngineStatus,
  hasVisibleParakeetRuntime,
  isVisibleParakeetEngineVerified,
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

  it('reads visible Parakeet engine status from runtime status payloads', () => {
    const status = {
      runtimeInstalled: true,
      engines: [
        {
          engine: 'parakeet' as const,
          verified: true,
          needsReinstall: false,
          lastError: null,
        },
        {
          engine: 'parakeet-multilingual' as const,
          verified: false,
          needsReinstall: true,
          lastError: 'startup timed out',
        },
      ],
    };

    expect(hasVisibleParakeetRuntime(status)).toBe(true);
    expect(isVisibleParakeetEngineVerified(status, 'parakeet')).toBe(true);
    expect(isVisibleParakeetEngineVerified(status, 'parakeet-multilingual')).toBe(false);
    expect(getVisibleParakeetEngineStatus(status, 'parakeet-multilingual')).toEqual(
      expect.objectContaining({
        needsReinstall: true,
        lastError: 'startup timed out',
      })
    );
  });
});
