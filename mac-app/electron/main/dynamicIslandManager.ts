import { BrowserWindow, screen, app, ipcMain, clipboard } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('DynamicIsland');

// =============================================================================
// DynamicIslandManager - Fixed-position overlay near the macOS notch.
// Two symmetric pills: left (hamburger + expanded states) and right (hot-mic dot).
// =============================================================================

export type DynamicIslandState = 'idle' | 'recording' | 'transcribing' | 'showing-transcript' | 'improving';

interface TranscriptHistoryItem {
  id: number;
  text: string;
  createdAt: number;
  wordCount: number;
}

export class DynamicIslandManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private rightWindow: BrowserWindow | null = null;
  private state: DynamicIslandState = 'idle';
  private rendererReady: boolean = false;
  private rightRendererReady: boolean = false;
  private pendingShow: boolean = false;
  private historyVisible: boolean = false;

  private readonly ISLAND_WIDTH = 420;
  private readonly ISLAND_WIDTH_IDLE = 48;
  private readonly ISLAND_HEIGHT = 52;
  private readonly ISLAND_HEIGHT_IDLE = 38;
  private readonly ISLAND_HEIGHT_WITH_TRANSCRIPT = 88;
  private readonly ISLAND_HEIGHT_WITH_HISTORY = 380;
  private readonly NOTCH_WIDTH = 200;
  private readonly RIGHT_PILL_WIDTH = 48;
  private readonly RIGHT_PILL_HEIGHT = 38;

  private clipboardManager: any = null;

  private dismissTimer: NodeJS.Timeout | null = null;
  private readonly TRANSCRIPT_DISPLAY_MS = 4000;

  // Hot-mic state tracked for the right pill.
  private hotMicActive: boolean = false;
  private hotMicWordCount: number = 0;
  private hotMicLastWord: string = '';

  constructor() {
    super();

    ipcMain.on('dynamic-island-request-history', () => {
      this.sendHistory();
    });

    ipcMain.on('dynamic-island-copy-paste', async (_event, text: string) => {
      clipboard.writeText(text);
      this.clipboardManager?.syncClipboardHash?.();
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
      } catch (err) {
        log.error('Paste failed:', err);
      }
    });

    ipcMain.on('dynamic-island-copy', (_event, text: string) => {
      clipboard.writeText(text);
      this.clipboardManager?.syncClipboardHash?.();
    });

    // Mute toggle from right pill.
    ipcMain.on('dynamic-island-toggle-mute', () => {
      this.emit('toggleMute');
    });

    ipcMain.on('dynamic-island-history-visible', (_event, visible: boolean) => {
      this.historyVisible = visible;
      // Hide right pill before expanding left pill to avoid overlap.
      if (visible) {
        this.hideRightPill();
      }
      this.updateWindowSize();
      if (!visible && this.state === 'idle') {
        this.showRightPill();
      }
      if (visible && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('dynamic-island-show-history');
      }
    });
  }

  setClipboardManager(manager: any): void {
    this.clipboardManager = manager;
    this.show();
    this.createRightWindow();
  }

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  setState(state: DynamicIslandState): void {
    this.state = state;

    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (state === 'idle') {
      this.historyVisible = false;
      this.sendStateToRenderer(state);
      this.updateWindowSize();
      this.showRightPill();
      return;
    }

    // Hide right pill during expanded states.
    this.hideRightPill();

    this.show();
    this.sendStateToRenderer(state);
    this.updateWindowSize();
  }

  getState(): DynamicIslandState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Hot-mic state (forwarded to right pill)
  // -------------------------------------------------------------------------

  updateHotMic(active: boolean, wordCount: number, lastWord: string): void {
    this.hotMicActive = active;
    this.hotMicWordCount = active ? wordCount : 0;
    this.hotMicLastWord = active ? lastWord : '';
    this.sendHotMicToRight();
  }

  blinkThenHideHotMic(): void {
    this.hotMicActive = false;
    this.hotMicWordCount = 0;
    this.hotMicLastWord = '';
    if (this.rightWindow && !this.rightWindow.isDestroyed()) {
      this.rightWindow.webContents.send('dynamic-island-hotmic-warn-discard');
      setTimeout(() => {
        if (this.rightWindow && !this.rightWindow.isDestroyed()) {
          this.rightWindow.webContents.send('dynamic-island-hotmic-slide-out');
        }
      }, 600);
    }
  }

  sendMuteState(muted: boolean): void {
    if (this.rightWindow && !this.rightWindow.isDestroyed() && this.rightRendererReady) {
      this.rightWindow.webContents.send('dynamic-island-hotmic-mute', muted);
    }
  }

  private sendHotMicToRight(): void {
    if (this.rightWindow && !this.rightWindow.isDestroyed() && this.rightRendererReady) {
      this.rightWindow.webContents.send('dynamic-island-hotmic', {
        active: this.hotMicActive,
        wordCount: this.hotMicWordCount,
        lastWord: this.hotMicLastWord,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Transcript data
  // -------------------------------------------------------------------------

  sendTranscript(text: string, isFinal: boolean): void {
    if (this.state === 'idle') {
      this.setState('showing-transcript');
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-transcript', { text, isFinal });
    }
    this.updateWindowSize();

    if (isFinal) {
      setTimeout(() => this.sendHistory(), 300);

      this.dismissTimer = setTimeout(() => {
        this.dismissTimer = null;
        if (this.state === 'showing-transcript' && !this.historyVisible) {
          this.setState('idle');
        }
      }, this.TRANSCRIPT_DISPLAY_MS);
    }
  }

  sendCommandDetected(phrase: string, startIndex: number, endIndex: number): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-command', { phrase, startIndex, endIndex });
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  private sendHistory(): void {
    if (!this.clipboardManager || !this.window || this.window.isDestroyed()) return;

    const items = this.clipboardManager.queryItems({
      type: 'transcript',
      limit: 7,
      offset: 0,
    });

    const history: TranscriptHistoryItem[] = items.map((item: any) => ({
      id: item.id,
      text: item.content || '',
      createdAt: item.createdAt,
      wordCount: item.wordCount || 0,
    }));

    this.window.webContents.send('dynamic-island-history', history);
  }

  // -------------------------------------------------------------------------
  // Window management — left pill
  // -------------------------------------------------------------------------

  private show(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
    }

    if (this.window) {
      if (!this.rendererReady) {
        this.pendingShow = true;
        return;
      }
      this.window.setOpacity(1);
      this.window.showInactive();
    }
  }

  private hide(): void {
    this.pendingShow = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  private createWindow(): void {
    this.rendererReady = false;
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const initialWidth = this.state === 'idle' ? this.ISLAND_WIDTH_IDLE : this.ISLAND_WIDTH;
    const isIdle = this.state === 'idle';
    const x = isIdle
      ? Math.floor((screenWidth - this.NOTCH_WIDTH) / 2 - initialWidth)
      : Math.floor((screenWidth - initialWidth) / 2);
    const y = 0;

    const initialHeight = isIdle ? this.ISLAND_HEIGHT_IDLE : this.ISLAND_HEIGHT;

    this.window = new BrowserWindow({
      width: initialWidth,
      height: initialHeight,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../dynamic-island-preload.js'),
      },
    });

    this.window.setOpacity(0);
    this.window.setBackgroundColor('#00000000');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setAlwaysOnTop(true, 'screen-saver', 2);

    this.window.setIgnoreMouseEvents(false);

    this.loadWindowUrl(this.window, 'dynamic-island.html?side=left');

    this.window.on('closed', () => {
      this.window = null;
    });

    // Close history panel when window loses focus.
    this.window.on('blur', () => {
      if (this.historyVisible) {
        this.historyVisible = false;
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send('dynamic-island-hide-history');
        }
        this.updateWindowSize();
        if (this.state === 'idle') {
          this.showRightPill();
        }
      }
    });

    this.window.webContents.once('did-finish-load', () => {
      this.rendererReady = true;
      if (this.window && !this.window.isDestroyed()) {
        this.sendStateToRenderer(this.state);
        this.sendHistory();

        if (this.pendingShow) {
          this.pendingShow = false;
          this.window.setOpacity(1);
          this.window.showInactive();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Window management — right pill
  // -------------------------------------------------------------------------

  private createRightWindow(): void {
    if (this.rightWindow && !this.rightWindow.isDestroyed()) return;

    this.rightRendererReady = false;
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.floor((screenWidth + this.NOTCH_WIDTH) / 2);
    const y = 0;

    this.rightWindow = new BrowserWindow({
      width: this.RIGHT_PILL_WIDTH,
      height: this.RIGHT_PILL_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../dynamic-island-preload.js'),
      },
    });

    this.rightWindow.setOpacity(0);
    this.rightWindow.setBackgroundColor('#00000000');
    this.rightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.rightWindow.setAlwaysOnTop(true, 'screen-saver', 2);

    // Right pill is clickable for mute toggle.
    this.rightWindow.setIgnoreMouseEvents(false);

    this.loadWindowUrl(this.rightWindow, 'dynamic-island.html?side=right');

    this.rightWindow.on('closed', () => {
      this.rightWindow = null;
      this.rightRendererReady = false;
    });

    this.rightWindow.webContents.once('did-finish-load', () => {
      this.rightRendererReady = true;
      if (this.rightWindow && !this.rightWindow.isDestroyed()) {
        this.rightWindow.setOpacity(1);
        this.rightWindow.showInactive();
        this.sendHotMicToRight();
      }
    });
  }

  private showRightPill(): void {
    // No-op: right pill stays visible at all times so the black background
    // never disappears. The expanded left pill paints over it when active.
  }

  private hideRightPill(): void {
    // No-op: right pill stays visible at all times so the black background
    // never disappears. The expanded left pill paints over it when active.
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private loadWindowUrl(win: BrowserWindow, htmlFile: string): void {
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const baseUrl = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      win.loadURL(`${baseUrl}${htmlFile}`);
    } else {
      const [fileName, query] = htmlFile.split('?');
      const filePath = path.join(app.getAppPath(), 'dist', fileName);
      win.loadFile(filePath, query ? { search: `?${query}` } : undefined);
    }
  }

  private sendStateToRenderer(state: DynamicIslandState): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-state', state);
    }
  }

  private updateWindowSize(): void {
    if (!this.window || this.window.isDestroyed()) return;

    const isIdle = this.state === 'idle' && !this.historyVisible;
    let targetHeight = isIdle ? this.ISLAND_HEIGHT_IDLE : this.ISLAND_HEIGHT;
    const targetWidth = isIdle ? this.ISLAND_WIDTH_IDLE : this.ISLAND_WIDTH;

    if (this.historyVisible) {
      targetHeight = this.ISLAND_HEIGHT_WITH_HISTORY;
    } else if (this.state === 'showing-transcript' || this.state === 'transcribing') {
      targetHeight = this.ISLAND_HEIGHT_WITH_TRANSCRIPT;
    }

    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const x = isIdle
      ? Math.floor((screenWidth - this.NOTCH_WIDTH) / 2 - targetWidth)
      : Math.floor((screenWidth - targetWidth) / 2);
    const y = 0;

    const [currentWidth, currentHeight] = this.window.getSize();
    const [currentX, currentY] = this.window.getPosition();
    if (currentHeight !== targetHeight || currentWidth !== targetWidth || currentX !== x || currentY !== y) {
      this.window.setBounds({
        x,
        y,
        width: targetWidth,
        height: targetHeight,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  destroy(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
    if (this.rightWindow && !this.rightWindow.isDestroyed()) {
      this.rightWindow.close();
    }
    this.rightWindow = null;
    ipcMain.removeAllListeners('dynamic-island-request-history');
    ipcMain.removeAllListeners('dynamic-island-copy-paste');
    ipcMain.removeAllListeners('dynamic-island-copy');
    ipcMain.removeAllListeners('dynamic-island-history-visible');
    ipcMain.removeAllListeners('dynamic-island-toggle-mute');
  }
}
