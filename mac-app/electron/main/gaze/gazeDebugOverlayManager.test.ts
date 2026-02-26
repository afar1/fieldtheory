import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GazeDebugOverlayManager } from './gazeDebugOverlayManager';
import { GazeSample } from '../types/gaze';

const testState = vi.hoisted(() => {
  class MockWebContents {
    sent: Array<{ channel: string; args: unknown[] }> = [];

    once(event: string, callback: () => void): void {
      if (event === 'did-finish-load') {
        callback();
      }
    }

    on(_event: string, _callback: (...args: unknown[]) => void): void {}

    send(channel: string, ...args: unknown[]): void {
      this.sent.push({ channel, args });
    }
  }

  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];
    webContents = new MockWebContents();
    private visible = false;
    private destroyed = false;
    private bounds: { x: number; y: number; width: number; height: number };
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor(
      options: {
        x: number;
        y: number;
        width: number;
        height: number;
      }
    ) {
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      MockBrowserWindow.instances.push(this);
    }
    setAlwaysOnTop(): void {}
    setVisibleOnAllWorkspaces(): void {}
    loadURL(): void {}
    loadFile(): void {}
    showInactive(): void {
      this.visible = true;
    }
    isVisible(): boolean {
      return this.visible;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    on(event: string, callback: (...args: unknown[]) => void): void {
      const existing = this.handlers.get(event) ?? [];
      existing.push(callback);
      this.handlers.set(event, existing);
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.bounds = { ...bounds };
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.bounds };
    }
    close(): void {
      const closeHandlers = this.handlers.get('close') ?? [];
      for (const handler of closeHandlers) {
        handler();
      }
      this.destroyed = true;
      this.visible = false;
      const closedHandlers = this.handlers.get('closed') ?? [];
      for (const handler of closedHandlers) {
        handler();
      }
    }
  }

  const screenMock = {
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1600, height: 1000 },
    })),
  };

  const appMock = {
    getAppPath: vi.fn(() => '/mock-app'),
  };

  const reset = () => {
    MockBrowserWindow.instances = [];
  };

  return {
    MockBrowserWindow,
    screenMock,
    appMock,
    reset,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: testState.MockBrowserWindow,
  screen: testState.screenMock,
  app: testState.appMock,
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

class FakePreferencesManager {
  private prefs: Record<string, unknown>;
  constructor(initial?: Record<string, unknown>) {
    this.prefs = {
      gazeDebugOverlayEnabled: false,
      gazeDebugOverlayBounds: null,
      ...initial,
    };
  }
  getPreference(key: string): unknown {
    return this.prefs[key];
  }
  async save(next: Record<string, unknown>): Promise<void> {
    this.prefs = { ...this.prefs, ...next };
  }
}

describe('GazeDebugOverlayManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.reset();
  });

  it('creates and shows the overlay window when enabled', async () => {
    const prefs = new FakePreferencesManager();
    const saveSpy = vi.spyOn(prefs, 'save');
    const manager = new GazeDebugOverlayManager(prefs as any);

    const state = await manager.setEnabled(true);

    expect(state.enabled).toBe(true);
    expect(testState.MockBrowserWindow.instances.length).toBe(1);
    expect(testState.MockBrowserWindow.instances[0].isVisible()).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ gazeDebugOverlayEnabled: true }));
  });

  it('persists disabled state when the user closes the overlay window', async () => {
    const prefs = new FakePreferencesManager();
    const saveSpy = vi.spyOn(prefs, 'save');
    const manager = new GazeDebugOverlayManager(prefs as any);

    await manager.setEnabled(true);
    const window = testState.MockBrowserWindow.instances[0];
    window.close();

    expect(manager.getState().enabled).toBe(false);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ gazeDebugOverlayEnabled: false }));
  });

  it('sends snapshot payloads to overlay renderer when sample updates', async () => {
    const prefs = new FakePreferencesManager();
    const manager = new GazeDebugOverlayManager(prefs as any);
    await manager.setEnabled(true);

    const sample: GazeSample = {
      timestampMs: 1234,
      confidence: 0.88,
      leftEye: { x: 0.4, y: 0.5 },
      rightEye: { x: 0.45, y: 0.5 },
      combinedEye: { x: 0.425, y: 0.5 },
      calibratedCombinedEye: { x: 0.43, y: 0.49 },
      calibrationApplied: true,
      headPose: { yaw: 0.1, pitch: -0.04, roll: 0.02 },
      gazeVector: { x: 0.1, y: 0.1, z: 0.98 },
      faceBounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      faceSize: 0.3,
      distanceScale: 1.1,
      activeDisplayId: 1,
    };

    manager.updateSample(sample);
    await new Promise((resolve) => setTimeout(resolve, 90));

    const window = testState.MockBrowserWindow.instances[0];
    const sent = window.webContents.sent.filter((entry) => entry.channel === 'gaze-debug-overlay:snapshot');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[sent.length - 1].args[0]).toEqual(
      expect.objectContaining({
        sample: expect.objectContaining({
          timestampMs: 1234,
          activeDisplayId: 1,
        }),
      })
    );
  });
});
