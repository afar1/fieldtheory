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
  private gapFillWindow: BrowserWindow | null = null;
  private state: DynamicIslandState = 'idle';
  private rendererReady: boolean = false;
  private rightRendererReady: boolean = false;
  private gapFillRendererReady: boolean = false;
  private pendingShow: boolean = false;
  private historyVisible: boolean = false;

  private readonly ISLAND_WIDTH = 420;
  private readonly ISLAND_WIDTH_IDLE = 48;
  private readonly ISLAND_HEIGHT = 52;
  private readonly ISLAND_HEIGHT_IDLE = 38;
  private readonly ISLAND_HEIGHT_WITH_TRANSCRIPT = 64;
  private readonly ISLAND_HEIGHT_WITH_HISTORY = 380;
  private readonly NOTCH_WIDTH = 200;
  private readonly RIGHT_PILL_WIDTH = 48;
  private readonly RIGHT_PILL_HEIGHT = 38;
  private readonly DRAWER_WIDTH = 360;
  private readonly DRAWER_HEIGHT = 82;   // 38px backdrop + 44px text
  private readonly DRAWER_Y = 0;

  private drawerWindow: BrowserWindow | null = null;
  private drawerRendererReady: boolean = false;
  private drawerSpeaking: boolean = false;

  private clipboardManager: any = null;

  private dismissTimer: NodeJS.Timeout | null = null;
  private readonly TRANSCRIPT_DISPLAY_MS = 4000;

  // Hot-mic state tracked for the right pill.
  private hotMicActive: boolean = false;
  private hotMicWordCount: number = 0;
  private hotMicLastWord: string = '';

  constructor() {
    super();

    screen.on('display-added', this.handleDisplayConfigurationChanged);
    screen.on('display-removed', this.handleDisplayConfigurationChanged);
    screen.on('display-metrics-changed', this.handleDisplayConfigurationChanged);

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

    ipcMain.on('dynamic-island-open-field-theory', () => {
      this.emit('open-field-theory');
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
    this.syncGapFillWindow();
    this.createDrawerWindow();
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
    const initialWidth = this.state === 'idle' ? this.ISLAND_WIDTH_IDLE : this.ISLAND_WIDTH;
    const isIdle = this.state === 'idle';
    const x = this.getLeftWindowX(initialWidth, isIdle);
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
    const x = this.getRightWindowX();
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
        this.updateRightWindowPosition();
        this.rightWindow.setOpacity(1);
        this.rightWindow.showInactive();
        this.sendHotMicToRight();
      }
    });
  }

  private createGapFillWindow(): void {
    if (this.gapFillWindow && !this.gapFillWindow.isDestroyed()) return;

    this.gapFillRendererReady = false;
    const x = this.getGapFillX();
    const y = 0;

    this.gapFillWindow = new BrowserWindow({
      width: this.NOTCH_WIDTH,
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

    this.gapFillWindow.setOpacity(0);
    this.gapFillWindow.setBackgroundColor('#00000000');
    this.gapFillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Keep center fill below the side pills.
    this.gapFillWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    this.gapFillWindow.setIgnoreMouseEvents(true);

    this.loadWindowUrl(this.gapFillWindow, 'dynamic-island.html?side=filler');

    this.gapFillWindow.on('closed', () => {
      this.gapFillWindow = null;
      this.gapFillRendererReady = false;
    });

    this.gapFillWindow.webContents.once('did-finish-load', () => {
      this.gapFillRendererReady = true;
      this.syncGapFillWindow();
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
  // Window management — drawer (transcript text below notch)
  // -------------------------------------------------------------------------

  private createDrawerWindow(): void {
    if (this.drawerWindow && !this.drawerWindow.isDestroyed()) return;

    this.drawerRendererReady = false;
    const x = this.getDrawerWindowX();

    this.drawerWindow = new BrowserWindow({
      width: this.DRAWER_WIDTH,
      height: this.DRAWER_HEIGHT,
      x,
      y: this.DRAWER_Y,
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

    this.drawerWindow.setBackgroundColor('#00000000');
    this.drawerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.drawerWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    this.drawerWindow.setIgnoreMouseEvents(true);

    this.loadWindowUrl(this.drawerWindow, 'dynamic-island.html?side=drawer');

    this.drawerWindow.on('closed', () => {
      this.drawerWindow = null;
      this.drawerRendererReady = false;
    });

    this.drawerWindow.webContents.once('did-finish-load', () => {
      this.drawerRendererReady = true;
      this.updateDrawerWindowPosition();
      if (this.drawerWindow && !this.drawerWindow.isDestroyed()) {
        this.drawerWindow.webContents.send('dynamic-island-drawer-speaking', this.drawerSpeaking);
      }
    });
  }

  updateDrawerTranscript(text: string): void {
    if (!this.drawerWindow || this.drawerWindow.isDestroyed()) return;

    if (text) {
      if (this.drawerRendererReady) {
        this.drawerWindow.webContents.send('dynamic-island-drawer-transcript', text);
        this.drawerWindow.webContents.send('dynamic-island-drawer-speaking', this.drawerSpeaking);
        this.drawerWindow.showInactive();
      }
    } else {
      this.drawerSpeaking = false;
      this.drawerWindow.webContents.send('dynamic-island-drawer-transcript', '');
      this.drawerWindow.webContents.send('dynamic-island-drawer-speaking', false);
      this.drawerWindow.hide();
    }
  }

  updateDrawerSpeaking(speaking: boolean): void {
    this.drawerSpeaking = speaking;
    if (this.drawerWindow && !this.drawerWindow.isDestroyed() && this.drawerRendererReady) {
      this.drawerWindow.webContents.send('dynamic-island-drawer-speaking', speaking);
    }
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

  private handleDisplayConfigurationChanged = (): void => {
    this.updateWindowSize();
  };

  private getPrimaryDisplayGeometry(): { x: number; width: number } {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      x: primaryDisplay.bounds.x,
      width: primaryDisplay.workAreaSize.width,
    };
  }

  private getLeftWindowX(width: number, isIdle: boolean): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    if (isIdle) {
      return primaryX + Math.floor((screenWidth - this.NOTCH_WIDTH) / 2 - width);
    }
    return primaryX + Math.floor((screenWidth - width) / 2);
  }

  private getRightWindowX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    return primaryX + Math.floor((screenWidth + this.NOTCH_WIDTH) / 2);
  }

  private getGapFillX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    return primaryX + Math.floor((screenWidth - this.NOTCH_WIDTH) / 2);
  }

  private getDrawerWindowX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    return primaryX + Math.floor((screenWidth - this.DRAWER_WIDTH) / 2);
  }

  private shouldShowGapFill(): boolean {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.internal === false;
  }

  private updateRightWindowPosition(): void {
    if (!this.rightWindow || this.rightWindow.isDestroyed()) return;

    const x = this.getRightWindowX();
    const y = 0;
    const [currentWidth, currentHeight] = this.rightWindow.getSize();
    const [currentX, currentY] = this.rightWindow.getPosition();
    if (
      currentWidth !== this.RIGHT_PILL_WIDTH ||
      currentHeight !== this.RIGHT_PILL_HEIGHT ||
      currentX !== x ||
      currentY !== y
    ) {
      this.rightWindow.setBounds({
        x,
        y,
        width: this.RIGHT_PILL_WIDTH,
        height: this.RIGHT_PILL_HEIGHT,
      });
    }
  }

  private updateDrawerWindowPosition(): void {
    if (!this.drawerWindow || this.drawerWindow.isDestroyed()) return;

    const x = this.getDrawerWindowX();
    const y = this.DRAWER_Y;
    const [currentWidth, currentHeight] = this.drawerWindow.getSize();
    const [currentX, currentY] = this.drawerWindow.getPosition();
    if (
      currentWidth !== this.DRAWER_WIDTH ||
      currentHeight !== this.DRAWER_HEIGHT ||
      currentX !== x ||
      currentY !== y
    ) {
      this.drawerWindow.setBounds({
        x,
        y,
        width: this.DRAWER_WIDTH,
        height: this.DRAWER_HEIGHT,
      });
    }
  }

  private syncGapFillWindow(): void {
    if (!this.shouldShowGapFill()) {
      if (this.gapFillWindow && !this.gapFillWindow.isDestroyed()) {
        this.gapFillWindow.hide();
      }
      return;
    }

    if (!this.gapFillWindow || this.gapFillWindow.isDestroyed()) {
      this.createGapFillWindow();
      return;
    }

    const x = this.getGapFillX();
    const y = 0;
    const [currentWidth, currentHeight] = this.gapFillWindow.getSize();
    const [currentX, currentY] = this.gapFillWindow.getPosition();
    if (
      currentWidth !== this.NOTCH_WIDTH ||
      currentHeight !== this.RIGHT_PILL_HEIGHT ||
      currentX !== x ||
      currentY !== y
    ) {
      this.gapFillWindow.setBounds({
        x,
        y,
        width: this.NOTCH_WIDTH,
        height: this.RIGHT_PILL_HEIGHT,
      });
    }

    if (this.gapFillRendererReady) {
      this.gapFillWindow.setOpacity(1);
      this.gapFillWindow.showInactive();
    }
  }

  private updateWindowSize(): void {
    this.updateRightWindowPosition();
    this.updateDrawerWindowPosition();
    this.syncGapFillWindow();

    if (!this.window || this.window.isDestroyed()) return;

    const isIdle = this.state === 'idle' && !this.historyVisible;
    let targetHeight = isIdle ? this.ISLAND_HEIGHT_IDLE : this.ISLAND_HEIGHT;
    const targetWidth = isIdle ? this.ISLAND_WIDTH_IDLE : this.ISLAND_WIDTH;

    if (this.historyVisible) {
      targetHeight = this.ISLAND_HEIGHT_WITH_HISTORY;
    } else if (this.state === 'showing-transcript' || this.state === 'transcribing') {
      targetHeight = this.ISLAND_HEIGHT_WITH_TRANSCRIPT;
    }

    const x = this.getLeftWindowX(targetWidth, isIdle);
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
    if (this.gapFillWindow && !this.gapFillWindow.isDestroyed()) {
      this.gapFillWindow.close();
    }
    this.gapFillWindow = null;
    if (this.drawerWindow && !this.drawerWindow.isDestroyed()) {
      this.drawerWindow.close();
    }
    this.drawerWindow = null;
    screen.removeListener('display-added', this.handleDisplayConfigurationChanged);
    screen.removeListener('display-removed', this.handleDisplayConfigurationChanged);
    screen.removeListener('display-metrics-changed', this.handleDisplayConfigurationChanged);
    ipcMain.removeAllListeners('dynamic-island-request-history');
    ipcMain.removeAllListeners('dynamic-island-copy-paste');
    ipcMain.removeAllListeners('dynamic-island-copy');
    ipcMain.removeAllListeners('dynamic-island-history-visible');
    ipcMain.removeAllListeners('dynamic-island-toggle-mute');
    ipcMain.removeAllListeners('dynamic-island-open-field-theory');
  }
}
