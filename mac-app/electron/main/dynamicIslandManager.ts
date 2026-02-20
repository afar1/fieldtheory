import { BrowserWindow, screen, app, ipcMain, clipboard } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('DynamicIsland');

// =============================================================================
// DynamicIslandManager - Fixed-position overlay near the macOS notch.
// Shows streaming transcript text during recording, and a hamburger menu
// for accessing transcript history with copy/paste-to-field behavior.
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
  private state: DynamicIslandState = 'idle';
  private rendererReady: boolean = false;
  private pendingShow: boolean = false;
  private historyVisible: boolean = false;

  // The island sits centered horizontally, just below the macOS notch area.
  // Wider than the old recording overlay to show transcript text.
  private readonly ISLAND_WIDTH = 420;
  private readonly ISLAND_HEIGHT = 52;
  private readonly ISLAND_HEIGHT_WITH_TRANSCRIPT = 88;
  private readonly ISLAND_HEIGHT_WITH_HISTORY = 380;
  private readonly NOTCH_Y_OFFSET = 6;

  // Clipboard manager reference for querying transcript history.
  private clipboardManager: any = null;

  // Auto-dismiss timer for the transcript display after recording.
  private dismissTimer: NodeJS.Timeout | null = null;
  private readonly TRANSCRIPT_DISPLAY_MS = 4000;

  constructor() {
    super();

    // Listen for history requests from the renderer.
    ipcMain.on('dynamic-island-request-history', () => {
      this.sendHistory();
    });

    // Copy text and paste into the last focused input field.
    ipcMain.on('dynamic-island-copy-paste', async (_event, text: string) => {
      clipboard.writeText(text);
      // Sync clipboard hash so the clipboard manager doesn't re-capture this.
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

    // Copy text to clipboard without pasting.
    ipcMain.on('dynamic-island-copy', (_event, text: string) => {
      clipboard.writeText(text);
      this.clipboardManager?.syncClipboardHash?.();
    });

    // History panel visibility toggle from renderer.
    ipcMain.on('dynamic-island-history-visible', (_event, visible: boolean) => {
      this.historyVisible = visible;
      this.updateWindowSize();
    });
  }

  setClipboardManager(manager: any): void {
    this.clipboardManager = manager;
  }

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  setState(state: DynamicIslandState): void {
    const previous = this.state;
    this.state = state;

    // Clear any pending dismiss timer when state changes.
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (state === 'idle') {
      this.historyVisible = false;
      this.hide();
      return;
    }

    // Show the island for active states.
    this.show();
    this.sendStateToRenderer(state);
    this.updateWindowSize();
  }

  getState(): DynamicIslandState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Transcript data
  // -------------------------------------------------------------------------

  // Send transcript text to the island (progressive or final).
  sendTranscript(text: string, isFinal: boolean): void {
    if (this.state === 'idle') {
      this.setState('showing-transcript');
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-transcript', { text, isFinal });
    }
    this.updateWindowSize();

    // Auto-dismiss after showing the final transcript for a few seconds.
    if (isFinal) {
      this.dismissTimer = setTimeout(() => {
        this.dismissTimer = null;
        if (this.state === 'showing-transcript' && !this.historyVisible) {
          this.setState('idle');
        }
      }, this.TRANSCRIPT_DISPLAY_MS);
    }
  }

  // Notify the island that a command phrase was detected.
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

    // Query recent transcripts from clipboard history.
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
  // Window management
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
    const x = Math.floor((screenWidth - this.ISLAND_WIDTH) / 2);

    this.window = new BrowserWindow({
      width: this.ISLAND_WIDTH,
      height: this.ISLAND_HEIGHT,
      x,
      y: this.NOTCH_Y_OFFSET,
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

    // Allow mouse events for the hamburger and history interactions.
    // But ignore mouse on the transparent regions so clicks pass through.
    this.window.setIgnoreMouseEvents(false);

    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const baseUrl = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${baseUrl}dynamic-island.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'dynamic-island.html');
      this.window.loadFile(htmlPath);
    }

    this.window.on('closed', () => {
      this.window = null;
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

  private sendStateToRenderer(state: DynamicIslandState): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-state', state);
    }
  }

  private updateWindowSize(): void {
    if (!this.window || this.window.isDestroyed()) return;

    let targetHeight = this.ISLAND_HEIGHT;

    if (this.historyVisible) {
      targetHeight = this.ISLAND_HEIGHT_WITH_HISTORY;
    } else if (this.state === 'showing-transcript' || this.state === 'transcribing') {
      targetHeight = this.ISLAND_HEIGHT_WITH_TRANSCRIPT;
    }

    const [currentWidth, currentHeight] = this.window.getSize();
    if (currentHeight !== targetHeight || currentWidth !== this.ISLAND_WIDTH) {
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      const x = Math.floor((screenWidth - this.ISLAND_WIDTH) / 2);
      this.window.setBounds({
        x,
        y: this.NOTCH_Y_OFFSET,
        width: this.ISLAND_WIDTH,
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
    ipcMain.removeAllListeners('dynamic-island-request-history');
    ipcMain.removeAllListeners('dynamic-island-copy-paste');
    ipcMain.removeAllListeners('dynamic-island-copy');
    ipcMain.removeAllListeners('dynamic-island-history-visible');
  }
}
