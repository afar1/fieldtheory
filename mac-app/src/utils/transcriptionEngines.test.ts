import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE,
  PARAKEET_VISIBLE_ENGINE_OPTIONS,
  getVisibleParakeetActionLabel,
  getVisibleParakeetEngineStatus,
  getVisibleParakeetPendingActionLabel,
  getVisibleParakeetRecoveryMessage,
  hasVisibleParakeetRuntime,
  isVisibleParakeetEngineVerified,
  isVisibleParakeetRepairableCacheError,
  isVisibleParakeetTimeoutError,
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

  it('recommends retry for timeout failures, repair for broken model caches, and reinstall for runtime failures', () => {
    expect(getVisibleParakeetActionLabel({
      engine: 'parakeet',
      verified: false,
      needsReinstall: true,
      lastError: 'server startup timed out (60s)',
    }, true)).toBe('Retry');

    expect(getVisibleParakeetActionLabel({
      engine: 'parakeet',
      verified: false,
      needsReinstall: true,
      lastError: 'filesystem error: in file_size: No such file or directory ["/tmp/models--istupakov--parakeet-tdt-0.6b-v2-onnx/snapshots/abc/encoder-model.onnx.data"]',
    }, true)).toBe('Repair model');

    expect(getVisibleParakeetActionLabel({
      engine: 'parakeet',
      verified: false,
      needsReinstall: true,
      lastError: 'onnx-asr is not installed',
    }, true)).toBe('Reinstall');

    expect(getVisibleParakeetPendingActionLabel('Retry')).toBe('Retrying...');
    expect(getVisibleParakeetPendingActionLabel('Repair model')).toBe('Repairing model...');
  });

  it('classifies timeout failures and produces actionable recovery guidance', () => {
    expect(isVisibleParakeetTimeoutError('Parakeet Multilingual server startup timed out (60s)')).toBe(true);
    expect(getVisibleParakeetRecoveryMessage('Parakeet Multilingual server startup timed out (60s)')).toContain(
      'model did not finish downloading or loading in time'
    );
    expect(isVisibleParakeetRepairableCacheError(
      'filesystem error: in file_size: No such file or directory ["/tmp/models--istupakov--parakeet-tdt-0.6b-v2-onnx/snapshots/abc/encoder-model.onnx.data"]'
    )).toBe(true);
    expect(getVisibleParakeetRecoveryMessage(
      'filesystem error: in file_size: No such file or directory ["/tmp/models--istupakov--parakeet-tdt-0.6b-v2-onnx/snapshots/abc/encoder-model.onnx.data"]'
    )).toContain('Repair the model');
    expect(getVisibleParakeetRecoveryMessage('onnx-asr is not installed')).toContain(
      'Remove Parakeet and install it again'
    );
    expect(getVisibleParakeetRecoveryMessage('Python 3.10 or newer is required for Parakeet setup.')).toContain(
      'Install a supported Python'
    );
    expect(getVisibleParakeetRecoveryMessage('Python was found, but it cannot create a virtual environment.')).toContain(
      'Homebrew Python 3.12'
    );
  });
});
