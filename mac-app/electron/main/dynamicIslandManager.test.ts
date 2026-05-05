import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  type ScreenEvent = 'display-added' | 'display-removed' | 'display-metrics-changed';
  type Listener = (...args: unknown[]) => void;

  let primaryDisplay = {
    bounds: { x: 0, y: 0, width: 1728, height: 1117 },
    workArea: { x: 0, y: 38, width: 1728, height: 1079 },
    workAreaSize: { width: 1728, height: 1079 },
    internal: true,
  };
  let cursorPoint = { x: 0, y: 0 };

  const screenListeners = new Map<ScreenEvent, Set<Listener>>();

  class MockWebContents {
    sent: Array<{ channel: string; args: unknown[] }> = [];

    once(event: string, callback: () => void): void {
      if (event === 'did-finish-load') callback();
    }

    on(_event: string, _callback: (...args: unknown[]) => void): void {}

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
    backgroundColorCalls: string[] = [];
    setBoundsCalls: Array<{
      bounds: { x: number; y: number; width: number; height: number };
      animate?: boolean;
    }> = [];
    constructorOptions: Record<string, unknown>;
    loadTarget: { url?: string; file?: string; search?: string } = {};
    private bounds: { x: number; y: number; width: number; height: number };
    private eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options: Record<string, unknown> & { x: number; y: number; width: number; height: number }) {
      this.constructorOptions = options;
      this.bounds = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
      MockBrowserWindow.instances.push(this);
    }

    private opacity = 0;
    setOpacity(value: number): void { this.opacity = value; }
    getOpacity(): number { return this.opacity; }
    setBackgroundColor(color: string): void {
      this.backgroundColorCalls.push(color);
    }
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

    setBounds(bounds: { x: number; y: number; width: number; height: number }, animate?: boolean): void {
      this.setBoundsCalls.push({ bounds, animate });
      this.bounds = { ...bounds };
    }

    setFocusable(_focusable: boolean): void {}

    emitEvent(event: string, ...args: unknown[]): void {
      this.emit(event, ...args);
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
    getAllDisplays: vi.fn(() => [primaryDisplay]),
    getCursorScreenPoint: vi.fn(() => cursorPoint),
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

  const getWindowBySide = (side: 'unified' | 'left' | 'right' | 'drawer' | 'filler' | 'floating'): MockBrowserWindow | undefined => {
    return MockBrowserWindow.instances.find((win) => {
      const search = win.loadTarget.search;
      const url = win.loadTarget.url;
      return search?.includes(`side=${side}`) === true || url?.includes(`side=${side}`) === true;
    });
  };

  const reset = (): void => {
    primaryDisplay = {
      bounds: { x: 0, y: 0, width: 1728, height: 1117 },
      workArea: { x: 0, y: 38, width: 1728, height: 1079 },
      workAreaSize: { width: 1728, height: 1079 },
      internal: true,
    };
    cursorPoint = { x: 0, y: 0 };
    screenListeners.clear();
    MockBrowserWindow.instances = [];
  };

  const setCursorPoint = (point: { x: number; y: number }): void => {
    cursorPoint = point;
  };

  const setPrimaryInternal = (internal: boolean): void => {
    primaryDisplay = { ...primaryDisplay, internal };
  };

  const setPrimaryDisplay = (overrides: {
    x?: number;
    y?: number;
    workAreaY?: number;
    boundsWidth?: number;
    workAreaWidth?: number;
    internal?: boolean;
  }): void => {
    primaryDisplay = {
      ...primaryDisplay,
      bounds: {
        ...primaryDisplay.bounds,
        x: overrides.x ?? primaryDisplay.bounds.x,
        y: overrides.y ?? primaryDisplay.bounds.y,
        width: overrides.boundsWidth ?? primaryDisplay.bounds.width,
      },
      workArea: {
        ...primaryDisplay.workArea,
        x: overrides.x ?? primaryDisplay.workArea.x,
        y: overrides.workAreaY ?? overrides.y ?? primaryDisplay.workArea.y,
        width: overrides.workAreaWidth ?? primaryDisplay.workArea.width,
      },
      workAreaSize: {
        ...primaryDisplay.workAreaSize,
        width: overrides.workAreaWidth ?? primaryDisplay.workAreaSize.width,
      },
      internal: overrides.internal ?? primaryDisplay.internal,
    };
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
    setPrimaryDisplay,
    setCursorPoint,
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

  it('creates a single unified island window spanning left pill, notch gap, and right pill', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();
    expect(unified?.isVisible()).toBe(true);
    expect(testState.getWindowBySide('drawer')).toBeDefined();
    // No separate left, right, or filler windows.
    expect(testState.getWindowBySide('left')).toBeUndefined();
    expect(testState.getWindowBySide('right')).toBeUndefined();
    expect(testState.getWindowBySide('filler')).toBeUndefined();
  });

  it('uses a floating pill on external primary displays in auto mode', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    expect(manager.getResolvedRecordingIndicatorMode()).toBe('floating');
    expect(testState.getWindowBySide('unified')).toBeUndefined();

    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating).toBeDefined();
    expect(floating?.isVisible()).toBe(true);
  });

  it('sends the floating shell width separately from the middle content width', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getSize()).toEqual([94, 38]);
    const resizeMessages = floating?.webContents.sent.filter(
      (message) => message.channel === 'dynamic-island-resize'
    ) ?? [];
    const resizePayload = resizeMessages[resizeMessages.length - 1]?.args[0] as {
      leftWidth: number;
      rightWidth: number;
    };
    expect(resizePayload).toEqual({ leftWidth: 94, rightWidth: 30 });
  });

  it('expands the floating pill around a stable waveform center when screenshot pipes appear', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getSize()).toEqual([94, 38]);
    expect(floating?.getPosition()).toEqual([817, 1055]);
    const listener = vi.fn();
    manager.on('floating-position-changed', listener);

    manager.updateStackCount(2);

    expect(floating?.getSize()).toEqual([130, 38]);
    expect(floating?.getPosition()).toEqual([799, 1055]);
    const growBoundsCall = floating?.setBoundsCalls[(floating?.setBoundsCalls.length ?? 0) - 1];
    expect(growBoundsCall).toEqual({
      bounds: { x: 799, y: 1055, width: 130, height: 38 },
      animate: false,
    });
    expect((floating?.getPosition()[0] ?? 0) + ((floating?.getSize()[0] ?? 0) / 2)).toBe(864);
    floating?.emitEvent('moved');
    expect(listener).not.toHaveBeenCalled();
    expect(manager.getFloatingPosition()).toBeNull();
    let resizeMessages = floating?.webContents.sent.filter(
      (message) => message.channel === 'dynamic-island-resize'
    ) ?? [];
    expect(resizeMessages[resizeMessages.length - 1]?.args[0]).toEqual({
      leftWidth: 130,
      rightWidth: 66,
    });

    manager.updateStackCount(0);

    expect(floating?.getSize()).toEqual([94, 38]);
    expect(floating?.getPosition()).toEqual([817, 1055]);
    const shrinkBoundsCall = floating?.setBoundsCalls[(floating?.setBoundsCalls.length ?? 0) - 1];
    expect(shrinkBoundsCall).toEqual({
      bounds: { x: 817, y: 1055, width: 94, height: 38 },
      animate: false,
    });
    expect((floating?.getPosition()[0] ?? 0) + ((floating?.getSize()[0] ?? 0) / 2)).toBe(864);
    resizeMessages = floating?.webContents.sent.filter(
      (message) => message.channel === 'dynamic-island-resize'
    ) ?? [];
    expect(resizeMessages[resizeMessages.length - 1]?.args[0]).toEqual({
      leftWidth: 94,
      rightWidth: 30,
    });
  });

  it('keeps the notch island path when the user forces Notch on an external display', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('notch');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    expect(manager.getResolvedRecordingIndicatorMode()).toBe('notch');
    expect(testState.getWindowBySide('unified')).toBeDefined();
  });

  it('uses floating mode for non-notch internal displays in auto mode', () => {
    testState.setPrimaryDisplay({
      boundsWidth: 1024,
      workAreaWidth: 1024,
      internal: true,
    });

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    expect(manager.getResolvedRecordingIndicatorMode()).toBe('floating');
    expect(testState.getWindowBySide('floating')).toBeUndefined();

    manager.setState('recording');
    expect(testState.getWindowBySide('floating')).toBeDefined();
  });

  it('uses persisted floating position only in floating mode', () => {
    manager = new DynamicIslandManager();
    manager.setFloatingPosition({ x: 320, y: 180 });
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified?.getPosition()).not.toEqual([320, 180]);

    manager.setRecordingIndicatorMode('floating');
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getPosition()).toEqual([320, 180]);
  });

  it('uses the bottom-center fallback when a saved floating position is above the work area', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    expect(manager.setFloatingPosition({ x: 907, y: 0 })).toBeNull();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getPosition()).toEqual([817, 1055]);
  });

  it('uses the bottom-center fallback for saved floating positions at the top-edge clamp', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    expect(manager.setFloatingPosition({ x: 907, y: 63 })).toBeNull();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getPosition()).toEqual([817, 1055]);
  });

  it('uses the bottom-center fallback when a saved floating position is on a zero-y work area edge', () => {
    testState.setPrimaryDisplay({ workAreaY: 0 });

    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    expect(manager.setFloatingPosition({ x: 907, y: 0 })).toBeNull();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getPosition()).toEqual([817, 1017]);
  });

  it('does not create a unified island while startup waits to apply floating preferences', () => {
    manager = new DynamicIslandManager();
    manager.setEnabled(false);
    manager.setClipboardManager({
      queryItems: () => [],
    });
    manager.setRecordingIndicatorMode('floating');

    expect(testState.getWindowBySide('unified')).toBeUndefined();
    expect(testState.getWindowBySide('floating')).toBeUndefined();

    manager.setEnabled(true);
    manager.setState('recording');

    expect(testState.getWindowBySide('unified')).toBeUndefined();
    expect(testState.getWindowBySide('floating')).toBeDefined();
  });

  it('emits floating position changes after the floating pill is dragged', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const listener = vi.fn();
    manager.on('floating-position-changed', listener);
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating).toBeDefined();
    floating?.setBounds({ x: 410, y: 96, width: 72, height: 38 });
    floating?.emitEvent('moved');

    expect(listener).toHaveBeenCalledWith({ x: 410, y: 96 });
    expect(manager.getFloatingPosition()).toEqual({ x: 410, y: 96 });
  });

  it('emits floating position changes from in-progress move events', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const listener = vi.fn();
    manager.on('floating-position-changed', listener);
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating).toBeDefined();
    floating?.setBounds({ x: 512, y: 144, width: 94, height: 38 });
    floating?.emitEvent('move');

    expect(listener).toHaveBeenCalledWith({ x: 512, y: 144 });
    expect(manager.getFloatingPosition()).toEqual({ x: 512, y: 144 });
  });

  it('restores a dragged floating position on the next manager instance', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const listener = vi.fn();
    manager.on('floating-position-changed', listener);
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    floating?.setBounds({ x: 512, y: 144, width: 94, height: 38 });
    floating?.emitEvent('move');
    const saved = listener.mock.calls[listener.mock.calls.length - 1]?.[0];
    expect(saved).toEqual({ x: 512, y: 144 });

    manager.destroy();
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setFloatingPosition(saved);
    manager.setClipboardManager({
      queryItems: () => [],
    });
    manager.setState('recording');

    const restoredFloating = testState.MockBrowserWindow.instances.find((window) => (
      !window.isDestroyed() &&
      (window.loadTarget.search?.includes('side=floating') === true || window.loadTarget.url?.includes('side=floating') === true)
    ));
    expect(restoredFloating?.getPosition()).toEqual([512, 144]);
  });

  it('clamps dragged floating positions before saving them', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const listener = vi.fn();
    manager.on('floating-position-changed', listener);
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating).toBeDefined();
    floating?.setBounds({ x: 410, y: 0, width: 94, height: 38 });
    floating?.emitEvent('moved');

    expect(listener).toHaveBeenCalledWith({ x: 410, y: 62 });
    expect(manager.getFloatingPosition()).toEqual({ x: 410, y: 62 });
    expect(floating?.getPosition()).toEqual([410, 62]);
  });

  it('settles the floating waveform and hides before paste', () => {
    vi.useFakeTimers();
    try {
      manager = new DynamicIslandManager();
      manager.setRecordingIndicatorMode('floating');
      manager.setClipboardManager({
        queryItems: () => [],
      });
      manager.setState('recording');

      const floating = testState.getWindowBySide('floating');
      expect(floating?.isVisible()).toBe(true);

      const delayMs = manager.prepareForPaste();

      expect(delayMs).toBe(240);
      expect(manager.getState()).toBe('completing');
      const stateMessages = floating?.webContents.sent.filter(
        (entry) => entry.channel === 'dynamic-island-state'
      ) ?? [];
      expect(stateMessages[stateMessages.length - 1]?.args[0]).toBe('completing');

      vi.advanceTimersByTime(delayMs);

      expect(floating?.isVisible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps forced-floating auto-hide on the opacity path on notch displays', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setClipboardManager({
      queryItems: () => [],
    });
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating?.getPosition()).toEqual([817, 1055]);
    expect(floating?.getSize()).toEqual([94, 38]);

    (
      manager as unknown as { applyAutoHideProgress: (progress: number) => void }
    ).applyAutoHideProgress(0.5);

    expect(floating?.getPosition()).toEqual([817, 1055]);
    expect(floating?.getSize()).toEqual([94, 38]);
    expect(floating?.getOpacity()).toBe(0.5);
  });

  it('does not show the floating pill again for final transcript display', () => {
    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('floating');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('transcribing');
    const floating = testState.getWindowBySide('floating');
    expect(floating).toBeDefined();
    expect(floating?.isVisible()).toBe(true);

    manager.sendTranscript('hello world', true);

    expect(manager.getState()).toBe('idle');
    expect(floating?.isVisible()).toBe(false);
    expect(testState.getWindowBySide('unified')).toBeUndefined();
    const transcriptEvents = floating?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-transcript'
    ) ?? [];
    expect(transcriptEvents.length).toBe(0);
  });

  it('does not create island windows while disabled until re-enabled', () => {
    manager = new DynamicIslandManager();
    manager.setEnabled(false);
    manager.setClipboardManager({
      queryItems: () => [],
    });

    expect(testState.getWindowBySide('left')).toBeUndefined();
    expect(testState.getWindowBySide('right')).toBeUndefined();
    expect(testState.getWindowBySide('drawer')).toBeUndefined();

    manager.setEnabled(true);

    expect(testState.getWindowBySide('unified')).toBeDefined();
    expect(testState.getWindowBySide('drawer')).toBeDefined();
  });

  it('switches from floating back to the unified notch window when auto mode sees an internal notch display', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });
    manager.setState('recording');

    const floating = testState.getWindowBySide('floating');
    expect(floating).toBeDefined();

    testState.setPrimaryInternal(true);
    testState.emitScreenEvent('display-metrics-changed');

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();
    expect(unified?.isVisible()).toBe(true);
  });

  it('restores the unified island visibility when re-enabled', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();
    expect(unified?.isVisible()).toBe(true);
    const showCallsBeforeDisable = unified?.showInactiveCalls ?? 0;

    manager.setEnabled(false);
    expect(unified?.isVisible()).toBe(false);
    expect(unified?.hideCalls).toBeGreaterThan(0);

    manager.setEnabled(true);
    expect(unified?.isVisible()).toBe(true);
    expect((unified?.showInactiveCalls ?? 0)).toBeGreaterThan(showCallsBeforeDisable);
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

    // Unified window: left(60) + gapFill(notchOverride=207 + 2×overlap=2) + right(60) = 329
    const unified = testState.getWindowBySide('unified');
    expect(unified?.getSize()).toEqual([329, 39]);

    const listener = vi.fn();
    manager.on('open-field-theory', listener);
    openFieldTheoryHandler?.();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(unified?.getSize()).toEqual([329, 39]);
    expect(unified?.constructorOptions.transparent).toBe(true);
    expect(unified?.backgroundColorCalls.every((c: string) => c === '#00000000')).toBe(true);
  });

  it('documents that dynamic-island IPC can dismiss the live hot-mic transcript buffer', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const dismissCall = testState.ipcMainMock.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'dynamic-island-dismiss-transcript'
    );
    expect(dismissCall).toBeDefined();

    const dismissHandler = dismissCall?.[1] as (() => void) | undefined;
    expect(dismissHandler).toBeDefined();

    const listener = vi.fn();
    manager.on('dismiss-transcript', listener);
    dismissHandler?.();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('documents that transcript history requests fetch the latest 25 transcript items', () => {
    const queryItems = vi.fn(() => []);

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems,
    });

    const requestHistoryCall = testState.ipcMainMock.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'dynamic-island-request-history'
    );
    expect(requestHistoryCall).toBeDefined();

    const requestHistoryHandler = requestHistoryCall?.[1] as (() => void) | undefined;
    requestHistoryHandler?.();

    expect(queryItems).toHaveBeenCalledWith({
      type: 'transcript',
      limit: 25,
      offset: 0,
    });
  });

  it('documents that deleting from dynamic-island history removes the item and refreshes history', () => {
    const queryItems = vi.fn(() => []);
    const deleteItem = vi.fn();

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems,
      deleteItem,
    });

    queryItems.mockClear();

    const deleteCall = testState.ipcMainMock.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'dynamic-island-delete-history-item'
    );
    expect(deleteCall).toBeDefined();

    const deleteHandler = deleteCall?.[1] as ((_event: unknown, id: number) => void) | undefined;
    deleteHandler?.({}, 42);

    expect(deleteItem).toHaveBeenCalledWith(42);
    expect(queryItems).toHaveBeenCalledWith({
      type: 'transcript',
      limit: 25,
      offset: 0,
    });
  });

  it('forwards hot-mic background filter meter updates to the left island renderer', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.updateHotMicBackgroundFilterMeter({
      enabled: true,
      strength: 65,
      rawLevel: 0.21,
      acceptedLevel: 0.13,
      threshold: 0.08,
      speechRatio: 0.51,
      chunkSuppressed: false,
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    const meterEvent = unified?.webContents.sent.find(
      (entry) => entry.channel === 'dynamic-island-hotmic-filter-meter'
    );
    expect(meterEvent).toBeDefined();
    expect(meterEvent?.args[0]).toMatchObject({
      enabled: true,
      strength: 65,
      chunkSuppressed: false,
    });
  });

  it('forwards drawer transcript updates to the drawer window', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.updateDrawerTranscript('hello world again');

    const drawer = testState.getWindowBySide('drawer');
    expect(drawer).toBeDefined();

    const transcriptEvents = drawer?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-drawer-transcript'
    ) ?? [];
    expect(transcriptEvents.length).toBeGreaterThan(0);
    expect(transcriptEvents[transcriptEvents.length - 1]?.args[0]).toBe('hello world again');
  });

  it('recreates the drawer window when transcript updates arrive after drawer teardown', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const isDrawerWindow = (win: { loadTarget: { search?: string; url?: string } }) =>
      win.loadTarget.search === '?side=drawer' || win.loadTarget.url?.includes('side=drawer') === true;

    const drawerWindowsBefore = testState.MockBrowserWindow.instances.filter(isDrawerWindow);
    const originalDrawer = drawerWindowsBefore[drawerWindowsBefore.length - 1];
    expect(originalDrawer).toBeDefined();

    originalDrawer.close();
    manager.updateDrawerTranscript('drawer recovered');

    const drawerWindowsAfter = testState.MockBrowserWindow.instances.filter(isDrawerWindow);
    expect(drawerWindowsAfter.length).toBeGreaterThan(drawerWindowsBefore.length);

    const latestDrawer = drawerWindowsAfter[drawerWindowsAfter.length - 1];
    const transcriptEvents = latestDrawer.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-drawer-transcript'
    );
    expect(transcriptEvents[transcriptEvents.length - 1]?.args[0]).toBe('drawer recovered');
  });

  it('includes mute state in hot-mic payloads sent to the unified window', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.sendMuteState(true);
    manager.updateHotMic(true, 4, 'world');

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    const hotMicEvents = unified?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-hotmic'
    ) ?? [];
    expect(hotMicEvents.length).toBeGreaterThan(0);
    expect(hotMicEvents[hotMicEvents.length - 1]?.args[0]).toMatchObject({
      active: true,
      muted: true,
    });
  });

  it('broadcasts input mode updates to the unified island renderer', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setInputMode('hot-mic');

    const unified = testState.getWindowBySide('unified');
    const modeEvents = unified?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-input-mode'
    ) ?? [];

    expect(modeEvents[modeEvents.length - 1]?.args[0]).toBe('hot-mic');
  });

  it('keeps one-chip standard recording within idle outer width', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    // idle: left(60) + gapFill(notchOverride=207+2) + right(60) = 329
    // recording with one chip remains within idle tuning:
    // left/right outer widths = 60, window = 60 + 209 + 60 = 329.
    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();
    expect(unified?.getSize()).toEqual([329, 39]);

    manager.setInputMode('hot-mic');
    expect(unified?.getSize()).toEqual([329, 39]);

    manager.setState('recording');
    expect(unified?.getSize()).toEqual([329, 39]);

    manager.setState('transcribing');
    expect(unified?.getSize()).toEqual([329, 39]);

    manager.setState('idle');
    manager.setInputMode('standard');
    expect(unified?.getSize()).toEqual([329, 39]);
  });

  it('shows the final transcript when it arrives during transcribing', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.setState('transcribing');
    manager.sendTranscript('hello world', true);

    expect(manager.getState()).toBe('showing-transcript');

    const unified = testState.getWindowBySide('unified');
    const transcriptEvents = unified?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-transcript'
    ) ?? [];
    expect(transcriptEvents[transcriptEvents.length - 1]?.args[0]).toEqual({
      text: 'hello world',
      isFinal: true,
    });
  });

  it('keeps waiting-agent updates from changing pill width while the indicator is hidden', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    // Waiting agents are still tracked for future reuse, but they should not
    // affect layout while the visible attention indicator is disabled.
    manager.setWaitingAgents([
      { agentId: 'a', tool: 'claude', pid: 0, cwd: '/', ttyTitle: 't', terminalApp: 'x', waitingSince: 1 },
      { agentId: 'b', tool: 'codex', pid: 0, cwd: '/', ttyTitle: 't', terminalApp: 'x', waitingSince: 2 },
    ]);
    manager.setState('recording');
    expect(unified?.getSize()).toEqual([329, 39]);

    manager.setWaitingAgents(
      Array.from({ length: 5 }, (_, i) => ({
        agentId: `a${i}`,
        tool: 'claude' as const,
        pid: 0,
        cwd: '/',
        ttyTitle: 't',
        terminalApp: 'x',
        waitingSince: i,
      })),
    );
    expect(unified?.getSize()).toEqual([329, 39]);
  });

  it('applies runtime geometry tuning updates to pill size and notch alignment', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    const updated = manager.setGeometryTuning({
      notchWidthOverride: 100,
      pillWidth: 84,
      pillHeight: 42,
      offsetX: 10,
      offsetY: 6,
    });

    expect(updated).toEqual({
      notchWidthOverride: 100,
      pillWidth: 84,
      pillHeight: 42,
      offsetX: 10,
      offsetY: 6,
    });
    // pillWidth=84, notchOverride=100: unified = left(84) + gapFill(100+2) + right(84) = 270
    expect(unified?.getSize()).toEqual([270, 42]);
    // Unified X = leftWindowX(84, idle): floor((1728-100)/2 - 84) + 10 = 740
    expect(unified?.getPosition()).toEqual([740, 6]);
  });

  it('uses full display width for notch profile matching even when work area width is reduced', () => {
    testState.setPrimaryDisplay({
      boundsWidth: 1728,
      workAreaWidth: 1600,
      internal: true,
    });

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    // 1728 display, notchOverride=207 applied. unified = left(60) + gapFill(207+2) + right(60) = 329
    // Unified X = leftWindowX(60, idle): floor((1728 - 207) / 2 - 60) + offsetX=0 = 700, offsetY=-1
    expect(unified?.getPosition()).toEqual([700, -1]);
    expect(unified?.getSize()).toEqual([329, 39]);
  });

  it('only reveals auto-hide while the cursor is inside the menu bar', () => {
    testState.setPrimaryDisplay({
      boundsWidth: 1728,
      workAreaWidth: 1728,
      internal: true,
    });

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const getTarget = () => (
      manager as unknown as { computeAutoHideTargetFromCursor: () => number }
    ).computeAutoHideTargetFromCursor();

    testState.setCursorPoint({ x: 864, y: 12 });
    expect(getTarget()).toBe(1);

    // Left/right of the island still reveal when the cursor is in the same
    // menu-bar band.
    testState.setCursorPoint({ x: 682, y: 12 });
    expect(getTarget()).toBe(1);

    // Below the menu bar should not trigger or sustain the animation, even
    // directly under the island.
    testState.setCursorPoint({ x: 864, y: 48 });
    expect(getTarget()).toBe(0);
  });

  it('hides immediately when auto-hide starts with the cursor below the menu bar', () => {
    testState.setPrimaryDisplay({
      boundsWidth: 1728,
      workAreaWidth: 1728,
      internal: true,
    });
    testState.setCursorPoint({ x: 864, y: 48 });

    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified?.isVisible()).toBe(true);

    manager.setAutoHide(true);

    expect(unified?.isVisible()).toBe(false);
  });

  it('redirects legacy history-visible open requests to the main history window without expanding the left pill', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();
    // unified = left(60) + gapFill(notchOverride=207+2) + right(60) = 329
    expect(unified?.getSize()).toEqual([329, 39]);
    const initialPosition = unified?.getPosition();

    const historyVisibleCall = testState.ipcMainMock.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'dynamic-island-history-visible'
    );
    expect(historyVisibleCall).toBeDefined();

    const historyVisibleHandler = historyVisibleCall?.[1] as ((_event: unknown, visible: boolean) => void) | undefined;
    const openFieldTheoryListener = vi.fn();
    manager.on('open-field-theory', openFieldTheoryListener);

    historyVisibleHandler?.({}, true);
    expect(openFieldTheoryListener).toHaveBeenCalledTimes(1);
    expect(unified?.getSize()).toEqual([329, 39]);
    expect(unified?.getPosition()).toEqual(initialPosition);

    historyVisibleHandler?.({}, false);
    expect(unified?.getSize()).toEqual([329, 39]);
    expect(unified?.getPosition()).toEqual(initialPosition);
  });

  it('reasserts configured backing during refresh while avoiding transparent side rewrites', () => {
    testState.setPrimaryInternal(false);

    manager = new DynamicIslandManager();
    manager.setRecordingIndicatorMode('notch');
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.refreshWindowProperties('test-refresh');

    const unified = testState.getWindowBySide('unified');
    const drawer = testState.getWindowBySide('drawer');

    expect(unified).toBeDefined();
    expect(drawer).toBeDefined();

    expect(unified?.backgroundColorCalls).not.toContain('#ff0000');
    expect(drawer?.backgroundColorCalls).not.toContain('#ff0000');

    // Unified window stays transparent; forced refreshes re-apply transparent
    // backing to recover from macOS compositor corruption.
    expect(unified?.constructorOptions.transparent).toBe(true);
    expect(unified?.backgroundColorCalls.every((c: string) => c === '#00000000')).toBe(true);
    // Drawer stays transparent so transcript panel corner rounding is visible.
    expect(drawer?.constructorOptions.transparent).toBe(true);
    expect(drawer?.backgroundColorCalls.every((c: string) => c === '#00000000')).toBe(true);
  });

  it('forwards stack count updates to the unified island renderer', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.updateStackCount(2);

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    const stackEvents = unified?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-stack-changed'
    ) ?? [];
    expect(stackEvents.length).toBeGreaterThan(0);
    expect(stackEvents[stackEvents.length - 1]?.args[0]).toBe(2);
  });

  it('re-sends stack count to the unified window after it reconnects', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    manager.updateStackCount(5);

    // Simulate unified window teardown and recreation.
    const originalUnified = testState.getWindowBySide('unified');
    originalUnified?.close();

    manager.setEnabled(false);
    manager.setEnabled(true);

    const newUnified = testState.MockBrowserWindow.instances
      .filter(w => !w.isDestroyed())
      .find(w => w.loadTarget.search?.includes('side=unified') || w.loadTarget.url?.includes('side=unified'));
    expect(newUnified).toBeDefined();

    const stackEvents = newUnified?.webContents.sent.filter(
      (entry) => entry.channel === 'dynamic-island-stack-changed'
    ) ?? [];
    expect(stackEvents.length).toBeGreaterThan(0);
    expect(stackEvents[stackEvents.length - 1]?.args[0]).toBe(5);
  });

  it('re-applies transparent backing on forced refreshes to recover from compositor corruption', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    const initialCalls = unified?.backgroundColorCalls.length ?? 0;
    manager.refreshWindowProperties('refresh-1');
    manager.refreshWindowProperties('refresh-2');

    const afterCalls = unified?.backgroundColorCalls.length ?? 0;
    expect(afterCalls).toBeGreaterThan(initialCalls);
    expect(unified?.backgroundColorCalls.every((c: string) => c === '#00000000')).toBe(true);
  });

  it('re-applies island backing when display metrics change', () => {
    manager = new DynamicIslandManager();
    manager.setClipboardManager({
      queryItems: () => [],
    });

    const unified = testState.getWindowBySide('unified');
    expect(unified).toBeDefined();

    const callsBefore = unified?.backgroundColorCalls.length ?? 0;

    testState.emitScreenEvent('display-metrics-changed');

    expect((unified?.backgroundColorCalls.length ?? 0)).toBeGreaterThan(callsBefore);
    expect(unified?.isVisible()).toBe(true);
  });
});
