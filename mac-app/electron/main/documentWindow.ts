import { app, BrowserWindow, BrowserWindowConstructorOptions, Menu, screen } from 'electron';
import path from 'path';
import { createLogger } from './logger';
import { isDevServerConnectionRefused, loadDevServerURLWithRetry } from './devServerLoadRetry';
import type { ClipboardHistoryBounds } from './preferences';

const log = createLogger('LibraryDocumentWindow');

export type LibraryDocumentWindowTarget = {
  kind: 'wiki' | 'artifact' | 'external';
  path: string;
  contentMode?: 'rendered' | 'markdown' | 'typedown';
  sidebarCollapsed?: boolean;
};

type Bounds = { x: number; y: number; width: number; height: number };

export function libraryDocumentWindowKey(target: LibraryDocumentWindowTarget): string {
  return `${target.kind}:${target.path}`;
}

export function defaultLibraryDocumentWindowBounds(): Bounds {
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.min(820, work.width);
  const height = Math.min(920, work.height);
  return {
    x: Math.round(work.x + (work.width - width) / 2),
    y: Math.round(work.y + Math.min(80, Math.max(0, work.height - height))),
    width,
    height,
  };
}

export function restoreLibraryDocumentWindowBounds(saved?: ClipboardHistoryBounds): Bounds {
  const fallback = defaultLibraryDocumentWindowBounds();
  if (!saved) return fallback;

  const source = typeof saved.x === 'number' && typeof saved.y === 'number'
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : fallback;
  const display = screen.getDisplayMatching(source);
  const work = display.workArea;
  const width = Math.min(Math.max(source.width, 640), work.width);
  const height = Math.min(Math.max(source.height, 560), work.height);
  return {
    x: Math.round(Math.min(Math.max(source.x, work.x), work.x + Math.max(0, work.width - width))),
    y: Math.round(Math.min(Math.max(source.y, work.y), work.y + Math.max(0, work.height - height))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function persistableLibraryDocumentWindowBounds(bounds: Bounds): ClipboardHistoryBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    displayConfig: `${screen.getAllDisplays().length}`,
  };
}

export class LibraryDocumentWindowManager {
  private windowsByKey = new Map<string, Set<BrowserWindow>>();

  constructor(
    private readonly getSavedBounds: () => ClipboardHistoryBounds | undefined,
    private readonly onBoundsChanged: (bounds: Bounds) => void,
  ) {}

  open(target: LibraryDocumentWindowTarget): void {
    const key = libraryDocumentWindowKey(target);
    const existingWindows = this.windowsByKey.get(key) ?? new Set<BrowserWindow>();
    for (const existing of Array.from(existingWindows)) {
      if (existing.isDestroyed()) existingWindows.delete(existing);
    }

    const restoredBounds = restoreLibraryDocumentWindowBounds(this.getSavedBounds());
    const bounds = offsetLibraryDocumentWindowBounds(restoredBounds, existingWindows.size);
    const options: BrowserWindowConstructorOptions = {
      ...bounds,
      title: path.basename(target.path),
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
      resizable: true,
      minWidth: 640,
      minHeight: 560,
      movable: true,
      focusable: true,
      acceptFirstMouse: true,
      fullscreenable: true,
      show: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    };

    const win = new BrowserWindow(options);
    existingWindows.add(win);
    this.windowsByKey.set(key, existingWindows);

    win.on('closed', () => {
      existingWindows.delete(win);
      if (existingWindows.size === 0) this.windowsByKey.delete(key);
    });
    win.on('moved', () => this.onBoundsChanged(win.getBounds()));
    win.on('resized', () => this.onBoundsChanged(win.getBounds()));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (process.env.ELECTRON_START_URL && isDevServerConnectionRefused(errorCode)) {
        log.warn('Dev server load failed; retry handler will reload:', errorCode, errorDescription, validatedURL);
        return;
      }
      log.error('Load failed:', errorCode, errorDescription, validatedURL);
    });

    win.webContents.on('context-menu', () => {
      Menu.buildFromTemplate([
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ]).popup({ window: win });
    });

    const query = new URLSearchParams({
      documentWindow: '1',
      kind: target.kind,
      path: target.path,
      focusChrome: '1',
    });
    if (target.contentMode) query.set('contentMode', target.contentMode);
    if (target.sidebarCollapsed) query.set('sidebarCollapsed', '1');

    const page = `clipboard-history.html?${query.toString()}`;
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      loadDevServerURLWithRetry(win, startUrl, page, {
        label: 'LibraryDocumentWindow',
        logger: log,
      });
    } else {
      win.loadFile(path.join(app.getAppPath(), 'dist', 'clipboard-history.html'), {
        query: Object.fromEntries(query.entries()),
      });
    }
  }

  destroy(): void {
    for (const windows of this.windowsByKey.values()) {
      for (const win of windows) {
        if (!win.isDestroyed()) win.destroy();
      }
    }
    this.windowsByKey.clear();
  }
}

function offsetLibraryDocumentWindowBounds(bounds: Bounds, index: number): Bounds {
  if (index <= 0) return bounds;
  const offset = Math.min(index, 6) * 28;
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  const x = Math.min(Math.max(bounds.x + offset, work.x), work.x + Math.max(0, work.width - bounds.width));
  const y = Math.min(Math.max(bounds.y + offset, work.y), work.y + Math.max(0, work.height - bounds.height));
  return {
    ...bounds,
    x: Math.round(x),
    y: Math.round(y),
  };
}
