import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  type ScreenEvent = 'display-added' | 'display-removed' | 'display-metrics-changed';
  type Listener = (...args: unknown[]) => void;

  let primaryDisplay = {
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    workAreaSize: { width: 2560, height: 1415 },
    internal: true,
  };

  const screenListeners = new Map<ScreenEvent, Set<Listener>>();

  class MockWebContents {
    sent: Array<{ channel: string; args: unknown[] }> = [];

    once(event: string, callback: () => void): void {
      if (event === 'did-finish-load') callback();
    }

    send(channel: string, ...args: unknown[]): void {
      this.sent.push({ channel, args });
    }
  }

  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];

    webContents: MockWebContents = new MockWebContents();
    destroyed = false;
    visible = false;
    hideCalls = 0;
    showInactiveCalls = 0;
    loadTarget: { url?: string; file?: string; search?: string } = {};
    private bounds: { x: number; y: number; width: number; height: number };
    private eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options: { x: number; y: number; width: number; height: number }) {
      this.bounds = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
      MockBrowserWindow.instances.push(this);
    }

    setOpacity(_value: number): void {}
    setBackgroundColor(_color: string): void {}
    setVisibleOnAllWorkspaces(_visible: boolean, _options?: unknown): void {}
    setAlwaysOnTop(_alwaysOnTop: boolean, _level?: string, _relativeLevel?: number): void {}
    setIgnoreMouseEvents(_ignore: boolean): void {}

    loadURL(url: string): void {
      this.loadTarget.url = url;
    }

    loadFile(file: string, options?: { search?: string }): void {
      this.loadTarget.file = file;
      this.loadTarget.search = options?.search;
    }

    on(event: string, callback: (...args: unknown[]) => void): void {
      const handlers = this.eventHandlers.get(event) || [];
      handlers.push(callback);
      this.eventHandlers.set(event, handlers);
    }

    close(): void {
      this.destroyed = true;
      this.emit('closed');
    }

    hide(): void {
      this.visible = false;
      this.hideCalls += 1;
    }

    showInactive(): void {
      this.visible = true;
      this.showInactiveCalls += 1;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isVisible(): boolean {
      return this.visible;
    }

    getSize(): [number, number] {
      return [this.bounds.width, this.bounds.height];
    }

    getPosition(): [number, number] {
      return [this.bounds.x, this.bounds.y];
    }

    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.bounds = { ...bounds };
    }

    private emit(event: string, ...args: unknown[]): void {
      const handlers = this.eventHandlers.get(event) || [];
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  const screenMock = {
    getPrimaryDisplay: vi.fn(() => primaryDisplay),
    on: vi.fn((event: ScreenEvent, listener: Listener) => {
      if (!screenListeners.has(event)) {
        screenListeners.set(event, new Set());
      }
      screenListeners.get(event)?.add(listener);
    }),
    removeListener: vi.fn((event: ScreenEvent, listener: Listener) => {
      screenListeners.get(event)?.delete(listener);
    }),
  };

  const appMock = {
    getAppPath: vi.fn(() => '/mock-app'),
  };

  const ipcMainMock = {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  const clipboardMock = {
    writeText: vi.fn(),
  };

  const emitScreenEvent = (event: ScreenEvent): void => {
    const listeners = screenListeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      listener({}, primaryDisplay);
    }
  };

  const getWindowBySide = (side: 'left' | 'right' | 'drawer' | 'filler'): MockBrowserWindow | undefined => {
    return MockBrowserWindow.instances.find((win) => {
      const search = win.loadTarget.search;
      const url = win.loadTarget.url;
      return search === `?side=${side}` || url?.includes(`side=${side}`) === true;
    });
  };

  const reset = (): void => {
    primaryDisplay = {
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workAreaSize: { width: 2560, height: 1415 },
      internal: true,
    };
    screenListeners.clear();
    MockBrowserWindow.instances = [];
  };

  const setPrimaryInternal = (internal: boolean): void => {
    primaryDisplay = { ...primaryDisplay, internal };
  };

  return {
    MockBrowserWindow,
    screenMock,
    appMock,
    ipcMainMock,
    clipboardMock,
    emitScreenEvent,
    getWindowBySide,
    reset,
    setPrimaryInternal,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: testState.MockBrowserWindow,
  screen: testState.screenMock,
  app: testState.appMock,
  ipcMain: testState.ipcMainMock,
  clipboard: testState.clipboardMock,
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { DynamicIslandManager } from './dynamicIslandManager';

describe('DynamicIslandManager notch-gap behavior', () => {
  let manager: DynamicIslandManager | null = null;

  beforeEach(() => {
    testState.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager?.destroy();
    manager = null;
  });

  it('documents that internal primary displays keep the center gap transparent (real notch is used)', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    expect(testState.getWindowBySide('left')).toBeDefined();
    expect(testState.getWindowBySide('right')).toBeDefined();
    expect(testState.getWindowBySide('drawer')).toBeDefined();
    expect(testState.getWindowBySide('filler')).toBeUndefined();
  });

  it('documents that external primary displays add a center filler to remove the fake-notch gap', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const filler = testState.getWindowBySide('filler');
    expect(filler).toBeDefined();
    expect(filler?.isVisible()).toBe(true);
  });

  it('documents that switching primary back to internal hides the center filler immediately', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const filler = testState.getWindowBySide('filler');
    expect(filler).toBeDefined();
    expect(filler?.isVisible()).toBe(true);

    testState.setPrimaryInternal(true);
    testState.emitScreenEvent('display-metrics-changed');

    expect(filler?.isVisible()).toBe(false);
    expect(filler?.hideCalls).toBeGreaterThan(0);
  });

  it('documents that dynamic-island IPC can request opening the main Field Theory window', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const openFieldTheoryCall = testState.ipcMainMock.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'dynamic-island-open-field-theory'
    );
    expect(openFieldTheoryCall).toBeDefined();

    const openFieldTheoryHandler = openFieldTheoryCall?.[1] as (() => void) | undefined;
    expect(openFieldTheoryHandler).toBeDefined();

    const listener = vi.fn();
    manager.on('open-field-theory', listener);
    openFieldTheoryHandler?.();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
