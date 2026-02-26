import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GazeScreenOverlayManager } from './gazeScreenOverlayManager';
import { GazeSample } from '../types/gaze';

const testState = vi.hoisted(() => {
  class MockWebContents {
    sent: Array<{ channel: string; args: unknown[] }> = [];
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    once(event: string, callback: () => void): void {
      if (event === 'did-finish-load') {
        callback();
      }
    }

    on(event: string, callback: (...args: unknown[]) => void): void {
      const current = this.handlers.get(event) ?? [];
      current.push(callback);
      this.handlers.set(event, current);
    }

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

    constructor(options: { x: number; y: number; width: number; height: number }) {
      this.bounds = { ...options };
      MockBrowserWindow.instances.push(this);
    }

    setAlwaysOnTop(): void {}
    setVisibleOnAllWorkspaces(): void {}
    setIgnoreMouseEvents(): void {}
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
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.bounds };
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.bounds = { ...bounds };
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
    getAllDisplays: vi.fn(() => [{
      id: 1,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
    }]),
    getPrimaryDisplay: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
    })),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  const appMock = {
    getAppPath: vi.fn(() => '/mock-app'),
  };

  const reset = () => {
    MockBrowserWindow.instances = [];
    screenMock.on.mockClear();
    screenMock.removeListener.mockClear();
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
      gazeScreenOverlayEnabled: false,
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

describe('GazeScreenOverlayManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.reset();
  });

  it('creates a screen overlay window when enabled', async () => {
    const prefs = new FakePreferencesManager();
    const saveSpy = vi.spyOn(prefs, 'save');
    const manager = new GazeScreenOverlayManager(prefs as any);

    const state = await manager.setEnabled(true);

    expect(state.enabled).toBe(true);
    expect(testState.MockBrowserWindow.instances.length).toBe(1);
    expect(testState.MockBrowserWindow.instances[0].isVisible()).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ gazeScreenOverlayEnabled: true }));
  });

  it('sends mapped gaze points to overlay renderer', async () => {
    const prefs = new FakePreferencesManager({ gazeScreenOverlayEnabled: true });
    const manager = new GazeScreenOverlayManager(prefs as any);
    await manager.initFromPreferences();

    const sample: GazeSample = {
      timestampMs: 1200,
      confidence: 0.81,
      leftEye: { x: 0.4, y: 0.5 },
      rightEye: { x: 0.45, y: 0.5 },
      combinedEye: { x: 0.425, y: 0.5 },
      calibratedCombinedEye: { x: 0.43, y: 0.49 },
      calibrationApplied: true,
      headPose: { yaw: 0, pitch: 0, roll: 0 },
      gazeVector: { x: 0, y: 0, z: 1 },
      faceBounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      faceSize: 0.3,
      distanceScale: 1,
      mappedScreenPoint: { x: 720, y: 420 },
      activeDisplayId: 1,
    };

    manager.updateStatus({
      enabled: true,
      running: true,
      cameraAuthorized: true,
      targetFps: 15,
      reason: null,
      lastSampleAtMs: Date.now(),
    });
    manager.updateSample(sample);
    await new Promise((resolve) => setTimeout(resolve, 45));

    const window = testState.MockBrowserWindow.instances[0];
    const sent = window.webContents.sent.filter((entry) => entry.channel === 'gaze-screen-overlay:snapshot');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[sent.length - 1].args[0]).toEqual(
      expect.objectContaining({
        point: expect.objectContaining({
          x: 720,
          y: 420,
        }),
      })
    );
  });
});
