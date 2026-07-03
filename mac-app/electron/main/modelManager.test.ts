import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/fieldtheory-tests'),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  DEFAULT_MODEL_SIZE,
  isModelSize,
  MEETING_DIARIZATION_MODEL_SIZE,
  ModelManager,
  SUPPORTED_MODEL_SIZES,
} from './modelManager';

describe('ModelManager model size helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes supported model sizes and rejects invalid values', () => {
    expect(isModelSize('small')).toBe(true);
    expect(isModelSize('small-tdrz')).toBe(true);
    expect(isModelSize('medium')).toBe(false);
    expect(isModelSize('tiny')).toBe(false);
    expect(isModelSize(null)).toBe(false);
    expect(isModelSize(undefined)).toBe(false);
  });

  it('exports shared defaults used by transcriber and ipc layers', () => {
    expect(DEFAULT_MODEL_SIZE).toBe('small');
    expect(MEETING_DIARIZATION_MODEL_SIZE).toBe('small-tdrz');
    expect(SUPPORTED_MODEL_SIZES).toEqual(['small', 'small-tdrz']);
  });

  it('checks download status for every supported model size', async () => {
    const manager = new ModelManager();
    const availabilitySpy = vi
      .spyOn(manager, 'isModelAvailableForSize')
      .mockResolvedValue(false);

    await manager.getDownloadStatus();

    for (const size of SUPPORTED_MODEL_SIZES) {
      expect(availabilitySpy).toHaveBeenCalledWith(size);
    }
  });

  it('exposes the standard and meeting diarization whisper models in available model metadata', () => {
    const manager = new ModelManager();

    expect(Object.keys(manager.getAvailableModels())).toEqual(['small', 'small-tdrz']);
    expect(manager.getAvailableModels().small.name).toContain('small');
    expect(manager.getAvailableModels()['small-tdrz']).toEqual(expect.objectContaining({
      name: 'ggml-small.en-tdrz.bin',
      url: expect.stringContaining('akashmjn/tinydiarize-whisper.cpp'),
      supportsSpeakerDiarization: true,
    }));
  });
});
