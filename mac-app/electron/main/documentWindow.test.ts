import { beforeEach, describe, expect, it, vi } from 'vitest';
const testState = vi.hoisted(() => {
  const browserWindowInstances: any[] = [];

  class MockBrowserWindow {
    static getFocusedWindow = vi.fn(() => null);

    readonly webContents = {
      on: vi.fn(),
      once: vi.fn(),
    };
    private readonly listeners = new Map<string, Array<() => void>>();
    private destroyed = false;

    constructor(public readonly options: Record<string, unknown>) {
      browserWindowInstances.push(this);
    }

    on(event: string, callback: () => void): void {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.push(callback);
      this.listeners.set(event, callbacks);
    }

    once(event: string, callback: () => void): void {
      this.on(event, callback);
    }

    emit(event: string): void {
      for (const callback of this.listeners.get(event) ?? []) callback();
    }

    getBounds(): Electron.Rectangle {
      return {
        x: Number(this.options.x),
        y: Number(this.options.y),
        width: Number(this.options.width),
        height: Number(this.options.height),
      };
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      this.destroyed = true;
      this.emit('closed');
    }

    loadFile = vi.fn();
    show = vi.fn();
    focus = vi.fn();
  }

  return { browserWindowInstances, MockBrowserWindow };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/fieldtheory'),
  },
  BrowserWindow: testState.MockBrowserWindow,
  screen: {
    getAllDisplays: vi.fn(() => [{
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }]),
    getPrimaryDisplay: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
    getDisplayMatching: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { LibraryDocumentWindowManager } from './documentWindow';

describe('LibraryDocumentWindowManager', () => {
  beforeEach(() => {
    testState.browserWindowInstances.length = 0;
    vi.clearAllMocks();
  });

  it('opens the same document as separate viewports', () => {
    const manager = new LibraryDocumentWindowManager(
      () => undefined,
      vi.fn(),
    );

    manager.open({ kind: 'wiki', path: 'scratchpad/diagram-notes', contentMode: 'rendered' });
    manager.open({ kind: 'wiki', path: 'scratchpad/diagram-notes', contentMode: 'rendered' });

    expect(testState.browserWindowInstances).toHaveLength(2);
    expect(testState.browserWindowInstances[0].loadFile).toHaveBeenCalledWith(
      '/tmp/fieldtheory/dist/clipboard-history.html',
      expect.objectContaining({
        query: expect.objectContaining({ focusChrome: '1' }),
      }),
    );
    expect(testState.browserWindowInstances[1].getBounds().x).toBeGreaterThan(testState.browserWindowInstances[0].getBounds().x);
    expect(testState.browserWindowInstances[1].getBounds().y).toBeGreaterThan(testState.browserWindowInstances[0].getBounds().y);
  });

  it('restores saved bounds and reports document window bounds changes', () => {
    const onBoundsChanged = vi.fn();
    const manager = new LibraryDocumentWindowManager(
      () => ({ x: 120, y: 140, width: 900, height: 700, displayConfig: 'test' }),
      onBoundsChanged,
    );

    manager.open({ kind: 'wiki', path: 'scratchpad/window-state', contentMode: 'rendered' });
    const opened = testState.browserWindowInstances[0];

    expect(opened.getBounds()).toEqual({
      x: 120,
      y: 140,
      width: 900,
      height: 700,
    });

    opened.emit('moved');
    opened.emit('resized');

    expect(onBoundsChanged).toHaveBeenCalledTimes(2);
    expect(onBoundsChanged).toHaveBeenLastCalledWith({
      x: 120,
      y: 140,
      width: 900,
      height: 700,
    });
  });

  it('destroys and forgets all tracked document windows', () => {
    const manager = new LibraryDocumentWindowManager(
      () => undefined,
      vi.fn(),
    );

    manager.open({ kind: 'artifact', path: '/tmp/notes.md' });
    manager.open({ kind: 'external', path: '/tmp/other.md' });
    manager.destroy();

    expect(testState.browserWindowInstances.every((win) => win.isDestroyed())).toBe(true);
  });
});
