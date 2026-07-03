import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockElectronState = vi.hoisted(() => ({
  userDataPath: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name !== 'userData') {
        throw new Error(`Unexpected getPath request: ${name}`);
      }
      return mockElectronState.userDataPath;
    }),
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

import { MetricsManager } from './metricsManager';

function createAuthManagerMock() {
  return {
    on: vi.fn(),
    removeListener: vi.fn(),
    isAuthenticated: vi.fn(() => false),
    getSupabaseClient: vi.fn(() => null),
    getSession: vi.fn(() => null),
  };
}

describe('MetricsManager transcription metrics', () => {
  let manager: MetricsManager | null = null;

  beforeEach(() => {
    mockElectronState.userDataPath = path.join(os.tmpdir(), `fieldtheory-metrics-test-${Date.now()}-${Math.random()}`);
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
    fs.removeSync(mockElectronState.userDataPath);
  });

  it('records standard transcription count and transcribed words together', () => {
    manager = new MetricsManager(createAuthManagerMock() as any);

    manager.recordTranscription(7);

    expect(manager.getMetrics()).toMatchObject({
      transcriptions: 1,
      words_transcribed: 7,
    });
  });

  it('records Hot Mic transcribed words into the shared words total', () => {
    manager = new MetricsManager(createAuthManagerMock() as any);

    manager.recordHotMicTranscribedWords(3.8);
    manager.recordHotMicTranscribedWords(0);
    manager.recordHotMicTranscribedWords(Number.NaN);

    expect(manager.getMetrics().words_transcribed).toBe(3);
  });
});
