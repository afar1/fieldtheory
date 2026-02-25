import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
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

import { DiagnosticsCollector } from './diagnosticsCollector';

describe('DiagnosticsCollector audio diagnostics', () => {
  it('drops malformed audio devices instead of throwing', () => {
    const collector = Object.create(DiagnosticsCollector.prototype) as any;
    collector.audioManager = {
      getState: () => ({
        devices: [
          undefined,
          null,
          { id: 'mic-1', name: 'Built-in Mic', isInput: true, isOutput: false },
          { id: 'bad-1', isInput: true, isOutput: false },
          { id: 'bad-2', name: 123, isInput: true, isOutput: false },
        ],
        defaultInputId: 'mic-1',
        priorityMode: true,
        priorityDeviceId: 'mic-1',
        userOverrideId: null,
      }),
    };

    const audio = collector.collectAudioInfo();

    expect(audio.priorityDeviceName).toBe('Built-in Mic');
    expect(audio.currentDefaultInput).toBe('Built-in Mic');
    expect(audio.devices).toEqual([
      {
        id: 'mic-1',
        name: 'Built-in Mic',
        isInput: true,
      },
    ]);
  });
});
