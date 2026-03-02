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
  ModelManager,
  SUPPORTED_MODEL_SIZES,
} from './modelManager';

describe('ModelManager model size helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes supported model sizes and rejects invalid values', () => {
    expect(isModelSize('small')).toBe(true);
    expect(isModelSize('medium')).toBe(false);
    expect(isModelSize('tiny')).toBe(false);
    expect(isModelSize(null)).toBe(false);
    expect(isModelSize(undefined)).toBe(false);
  });

  it('exports shared defaults used by transcriber and ipc layers', () => {
    expect(DEFAULT_MODEL_SIZE).toBe('small');
    expect(SUPPORTED_MODEL_SIZES).toEqual(['small']);
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

  it('only exposes the small whisper model in available model metadata', () => {
    const manager = new ModelManager();

    expect(Object.keys(manager.getAvailableModels())).toEqual(['small']);
    expect(manager.getAvailableModels().small.name).toContain('small');
  });
});
