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

export interface HotMicBackgroundFilterMeter {
  enabled: boolean;
  strength: number;
  rawLevel: number;
  acceptedLevel: number;
  threshold: number;
  speechRatio: number;
  chunkSuppressed: boolean;
}

export interface DynamicIslandGeometryTuning {
  notchWidthOverride: number; // 0 means "use profile/auto notch width"
  pillWidth: number;
  pillHeight: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING: DynamicIslandGeometryTuning = {
  notchWidthOverride: 0,
  pillWidth: 48,
  pillHeight: 38,
  offsetX: 0,
  offsetY: 0,
};

type IslandWindowLabel = 'left' | 'right' | 'filler' | 'drawer';

interface NotchDisplayProfile {
  modeWidth: number;
  notchWidth: number;
  pillY: number;
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

  private readonly ISLAND_WIDTH = 460;
  private readonly ISLAND_WIDTH_IDLE = 48;
  private readonly ISLAND_HEIGHT = 52;
  private readonly ISLAND_HEIGHT_IDLE = 38;
  private readonly ISLAND_HEIGHT_WITH_TRANSCRIPT = 64;
  private readonly ISLAND_HEIGHT_WITH_HISTORY = 380;
  private readonly HISTORY_LIMIT = 25;
  private readonly NOTCH_WIDTH = 200;
  // Standard macOS notch-display "looks like" widths.
  // We snap to the nearest profile so pills stay parked against notch edges.
  private readonly NOTCH_DISPLAY_PROFILES: NotchDisplayProfile[] = [
    { modeWidth: 1147, notchWidth: 93, pillY: 0 },
    { modeWidth: 1168, notchWidth: 95, pillY: 0 },
    { modeWidth: 1312, notchWidth: 106, pillY: 0 },
    { modeWidth: 1496, notchWidth: 121, pillY: 0 },
    { modeWidth: 1512, notchWidth: 122, pillY: 0 },
    { modeWidth: 1728, notchWidth: 140, pillY: 0 },
    { modeWidth: 1800, notchWidth: 146, pillY: 0 },
    { modeWidth: 2056, notchWidth: 167, pillY: 0 },
  ];
  private readonly CENTER_JOIN_OVERLAP_PX = 1;
  private readonly RIGHT_PILL_WIDTH = 48;
  private readonly RIGHT_PILL_HEIGHT = 38;
  private readonly DRAWER_WIDTH = 360;
  private readonly DRAWER_HEIGHT = 82;   // 38px backdrop + 44px text
  private readonly DRAWER_Y = 0;
  // Default backing for non-corner windows.
  private readonly USE_TRANSPARENT_WINDOWS = false;
  // Keep side pills transparent so their rounded outside corners are visible.
  private readonly KEEP_SIDE_PILLS_TRANSPARENT = true;
  // When windows are opaque, let the OS apply corner rounding to avoid
  // the hard rectangular slab look.
  private readonly USE_SYSTEM_ROUNDED_CORNERS = false;
  // Debug corner backing is disabled in production behavior: keep window backing
  // transparent so only intentional black UI surfaces are visible.
  private readonly DEBUG_CORNER_BACKING_ENABLED = false;
  private readonly DEBUG_CORNER_START_TRANSPARENT = true;
  private readonly DEBUG_CORNER_BACKING_COLOR = '#ff0000';
  private readonly DEBUG_WINDOW_EVENT_LOGGING = process.env.DYNAMIC_ISLAND_DEBUG_WINDOW_EVENTS === 'true';

  private windowBackingColor = new WeakMap<BrowserWindow, string>();
  private debugCornerBackingActivated = false;

  private drawerWindow: BrowserWindow | null = null;
  private drawerRendererReady: boolean = false;
  private drawerSpeaking: boolean = false;
  private drawerTranscriptText: string = '';

  private clipboardManager: any = null;

  private dismissTimer: NodeJS.Timeout | null = null;
  private readonly TRANSCRIPT_DISPLAY_MS = 4000;

  // Hot-mic state tracked for the right pill.
  private hotMicActive: boolean = false;
  private hotMicWordCount: number = 0;
  private hotMicLastWord: string = '';
  private geometryTuning: DynamicIslandGeometryTuning = { ...DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING };

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

    ipcMain.on('dynamic-island-delete-history-item', (_event, id: number) => {
      if (!this.clipboardManager || !Number.isInteger(id) || id <= 0) return;
      try {
        this.clipboardManager.deleteItem(id);
      } catch (error) {
        log.error('Failed to delete dynamic island history item:', error);
        return;
      }
      this.sendHistory();
    });

    // Mute toggle from right pill.
    ipcMain.on('dynamic-island-toggle-mute', () => {
      this.emit('toggleMute');
    });

    // Dismiss current live transcript buffer from right pill.
    ipcMain.on('dynamic-island-dismiss-transcript', () => {
      this.emit('dismiss-transcript');
    });

    ipcMain.on('dynamic-island-open-field-theory', () => {
      // Collapse history immediately before opening the main window to avoid
      // transient expanded transparent surfaces during focus transfer.
      this.collapseHistoryPanel('open-field-theory');
      this.emit('open-field-theory');
    });

    ipcMain.on('dynamic-island-history-visible', (_event, visible: boolean) => {
      if (!visible) {
        this.collapseHistoryPanel('renderer-history-toggle-close');
        return;
      }

      // Legacy compatibility: older renderer builds may still request the
      // in-island history panel. Redirect those requests to the main history
      // window so the left pill geometry never expands/couples again.
      this.collapseHistoryPanel('renderer-history-toggle-open-redirect');
      this.emit('open-field-theory');
    });
  }

  setClipboardManager(manager: any): void {
    this.clipboardManager = manager;
    this.show();
    this.createRightWindow();
    this.syncGapFillWindow();
    this.createDrawerWindow();
  }

  setGeometryTuning(tuning: Partial<DynamicIslandGeometryTuning>): DynamicIslandGeometryTuning {
    const next: DynamicIslandGeometryTuning = {
      notchWidthOverride: this.clampInt(
        tuning.notchWidthOverride,
        0,
        320,
        this.geometryTuning.notchWidthOverride
      ),
      pillWidth: this.clampInt(tuning.pillWidth, 32, 120, this.geometryTuning.pillWidth),
      pillHeight: this.clampInt(tuning.pillHeight, 24, 120, this.geometryTuning.pillHeight),
      offsetX: this.clampInt(tuning.offsetX, -240, 240, this.geometryTuning.offsetX),
      offsetY: this.clampInt(tuning.offsetY, -160, 160, this.geometryTuning.offsetY),
    };

    const changed =
      next.notchWidthOverride !== this.geometryTuning.notchWidthOverride ||
      next.pillWidth !== this.geometryTuning.pillWidth ||
      next.pillHeight !== this.geometryTuning.pillHeight ||
      next.offsetX !== this.geometryTuning.offsetX ||
      next.offsetY !== this.geometryTuning.offsetY;

    this.geometryTuning = next;
    if (changed) {
      this.updateWindowSize();
    }
    return { ...this.geometryTuning };
  }

  getGeometryTuning(): DynamicIslandGeometryTuning {
    return { ...this.geometryTuning };
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

  updateHotMicBackgroundFilterMeter(data: HotMicBackgroundFilterMeter): void {
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-hotmic-filter-meter', data);
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
      limit: this.HISTORY_LIMIT,
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
      this.reinforceWindowBacking('left', 'left-show');
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
    const useTransparentWindow = this.shouldUseTransparentWindow('left');
    const backingColor = this.getOverlayBackingColor(useTransparentWindow);
    const idleWidth = this.getIdlePillWidth();
    const idleHeight = this.getIdlePillHeight();
    const initialWidth = this.historyVisible ? this.ISLAND_WIDTH : idleWidth;
    const x = this.getLeftWindowX(idleWidth, true);
    const y = this.getTopWindowY();

    const initialHeight = this.historyVisible ? this.ISLAND_HEIGHT_WITH_HISTORY : idleHeight;

    this.window = new BrowserWindow({
      width: initialWidth,
      height: initialHeight,
      x,
      y,
      frame: false,
      transparent: useTransparentWindow,
      backgroundColor: backingColor,
      hasShadow: false,
      roundedCorners: this.USE_SYSTEM_ROUNDED_CORNERS,
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
    this.applyWindowBackingColor(this.window, 'left', useTransparentWindow, { force: true, reason: 'left-create' });
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setAlwaysOnTop(true, 'screen-saver', 2);

    this.window.setIgnoreMouseEvents(false);

    this.loadWindowUrl(this.window, 'dynamic-island.html?side=left');

    this.window.on('closed', () => {
      this.window = null;
    });
    this.attachWindowDebugLogging(this.window, 'left');

    // Close history panel when window loses focus.
    this.window.on('blur', () => {
      this.collapseHistoryPanel('left-window-blur');
    });

    this.window.webContents.once('did-finish-load', () => {
      this.rendererReady = true;
      if (this.window && !this.window.isDestroyed()) {
        this.sendStateToRenderer(this.state);
        this.sendHistory();

        if (this.pendingShow) {
          this.pendingShow = false;
          this.reinforceWindowBacking('left', 'left-pending-show');
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
    const useTransparentWindow = this.shouldUseTransparentWindow('right');
    const backingColor = this.getOverlayBackingColor(useTransparentWindow);
    const rightWidth = this.getRightPillWidth();
    const rightHeight = this.getRightPillHeight();
    const x = this.getRightWindowX();
    const y = this.getTopWindowY();

    this.rightWindow = new BrowserWindow({
      width: rightWidth,
      height: rightHeight,
      x,
      y,
      frame: false,
      transparent: useTransparentWindow,
      backgroundColor: backingColor,
      hasShadow: false,
      roundedCorners: this.USE_SYSTEM_ROUNDED_CORNERS,
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
    this.applyWindowBackingColor(this.rightWindow, 'right', useTransparentWindow, { force: true, reason: 'right-create' });
    this.rightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.rightWindow.setAlwaysOnTop(true, 'screen-saver', 2);

    // Right pill is clickable for mute toggle.
    this.rightWindow.setIgnoreMouseEvents(false);

    this.loadWindowUrl(this.rightWindow, 'dynamic-island.html?side=right');

    this.rightWindow.on('closed', () => {
      this.rightWindow = null;
      this.rightRendererReady = false;
    });
    this.attachWindowDebugLogging(this.rightWindow, 'right');

    this.rightWindow.webContents.once('did-finish-load', () => {
      this.rightRendererReady = true;
      if (this.rightWindow && !this.rightWindow.isDestroyed()) {
        this.updateRightWindowPosition();
        this.reinforceWindowBacking('right', 'right-ready-show');
        this.rightWindow.setOpacity(1);
        this.rightWindow.showInactive();
        this.rightWindow.webContents.send('dynamic-island-drawer-transcript', this.drawerTranscriptText);
        this.sendHotMicToRight();
        this.rightWindow.webContents.send('dynamic-island-state', this.state);
      }
    });
  }

  private createGapFillWindow(): void {
    if (this.gapFillWindow && !this.gapFillWindow.isDestroyed()) return;

    this.gapFillRendererReady = false;
    const useTransparentWindow = this.shouldUseTransparentWindow('filler');
    const backingColor = this.getOverlayBackingColor(useTransparentWindow);
    const rightHeight = this.getRightPillHeight();
    const x = this.getGapFillX();
    const y = this.getTopWindowY();

    this.gapFillWindow = new BrowserWindow({
      width: this.getGapFillWidth(),
      height: rightHeight,
      x,
      y,
      frame: false,
      transparent: useTransparentWindow,
      backgroundColor: backingColor,
      hasShadow: false,
      roundedCorners: this.USE_SYSTEM_ROUNDED_CORNERS,
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
    this.applyWindowBackingColor(this.gapFillWindow, 'filler', useTransparentWindow, { force: true, reason: 'filler-create' });
    this.gapFillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Keep center fill below the side pills.
    this.gapFillWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    this.gapFillWindow.setIgnoreMouseEvents(true);

    this.loadWindowUrl(this.gapFillWindow, 'dynamic-island.html?side=filler');

    this.gapFillWindow.on('closed', () => {
      this.gapFillWindow = null;
      this.gapFillRendererReady = false;
    });
    this.attachWindowDebugLogging(this.gapFillWindow, 'filler');

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
    const useTransparentWindow = this.shouldUseTransparentWindow('drawer');
    const backingColor = this.getOverlayBackingColor(useTransparentWindow);
    const x = this.getDrawerWindowX();

    this.drawerWindow = new BrowserWindow({
      width: this.DRAWER_WIDTH,
      height: this.DRAWER_HEIGHT,
      x,
      y: this.getTopWindowY() + this.DRAWER_Y,
      frame: false,
      transparent: useTransparentWindow,
      backgroundColor: backingColor,
      hasShadow: false,
      roundedCorners: this.USE_SYSTEM_ROUNDED_CORNERS,
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

    this.applyWindowBackingColor(this.drawerWindow, 'drawer', useTransparentWindow, { force: true, reason: 'drawer-create' });
    this.drawerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.drawerWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    this.drawerWindow.setIgnoreMouseEvents(true);

    this.loadWindowUrl(this.drawerWindow, 'dynamic-island.html?side=drawer');

    this.drawerWindow.on('closed', () => {
      this.drawerWindow = null;
      this.drawerRendererReady = false;
    });
    this.attachWindowDebugLogging(this.drawerWindow, 'drawer');

    this.drawerWindow.webContents.once('did-finish-load', () => {
      this.drawerRendererReady = true;
      this.updateDrawerWindowPosition();
      this.reinforceWindowBacking('drawer', 'drawer-ready');
      if (this.drawerWindow && !this.drawerWindow.isDestroyed()) {
        this.drawerWindow.webContents.send('dynamic-island-drawer-transcript', this.drawerTranscriptText);
        this.drawerWindow.webContents.send('dynamic-island-drawer-speaking', this.drawerSpeaking);
      }
    });
  }

  updateDrawerTranscript(text: string): void {
    this.drawerTranscriptText = text;

    if (this.rightWindow && !this.rightWindow.isDestroyed() && this.rightRendererReady) {
      this.rightWindow.webContents.send('dynamic-island-drawer-transcript', text);
    }
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
    if (this.rightWindow && !this.rightWindow.isDestroyed()) {
      this.rightWindow.webContents.send('dynamic-island-state', state);
    }
  }

  private collapseHistoryPanel(reason: string): void {
    if (!this.historyVisible) return;

    this.historyVisible = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-hide-history');
    }
    // Emit hide first so renderer can collapse panel state before the compact
    // bounds snap. This reduces transient mismatches during rapid hotkey toggles.
    this.updateWindowSize();
    this.syncLeftWindowBackingForMode('history-close');
    if (this.state === 'idle') {
      this.showRightPill();
    }
    if (this.DEBUG_WINDOW_EVENT_LOGGING) {
      log.info('Dynamic Island history collapsed (%s)', reason);
    }
  }

  /**
   * Refresh window properties to recover from occasional macOS compositor
   * transparency corruption when other windows are shown/hidden.
   */
  refreshWindowProperties(reason = 'unspecified'): void {
    this.activateDebugCornerBacking(reason);
    this.refreshSingleWindowProperties(this.window, 2, 'left');
    this.refreshSingleWindowProperties(this.rightWindow, 2, 'right');
    this.refreshSingleWindowProperties(this.gapFillWindow, 1, 'filler');
    this.refreshSingleWindowProperties(this.drawerWindow, 1, 'drawer');
  }

  private refreshSingleWindowProperties(win: BrowserWindow | null, zLevel: number, label: IslandWindowLabel): void {
    if (!win || win.isDestroyed()) return;

    this.applyWindowBackingColor(
      win,
      label,
      this.shouldUseTransparentWindow(label),
      { force: true, reason: `refresh:${label}` }
    );
    win.setAlwaysOnTop(true, 'screen-saver', zLevel);

    if (win.isVisible()) {
      win.setOpacity(1);
    }
  }

  private shouldUseTransparentWindow(label: IslandWindowLabel): boolean {
    if (label === 'left' && this.KEEP_SIDE_PILLS_TRANSPARENT) {
      return true;
    }
    if (label === 'right' && this.KEEP_SIDE_PILLS_TRANSPARENT) {
      return true;
    }
    if (label === 'drawer') {
      return true;
    }
    return this.USE_TRANSPARENT_WINDOWS;
  }

  private syncLeftWindowBackingForMode(reason: string): void {
    if (!this.window || this.window.isDestroyed()) return;
    const useTransparentWindow = this.shouldUseTransparentWindow('left');
    this.applyWindowBackingColor(
      this.window,
      'left',
      useTransparentWindow,
      { force: true, reason: `left-mode:${reason}` }
    );
    if (this.DEBUG_WINDOW_EVENT_LOGGING) {
      log.info(
        'Dynamic Island left backing sync (%s): transparent=%s',
        reason,
        useTransparentWindow
      );
    }
  }

  private getOverlayBackingColor(useTransparentWindow: boolean): string {
    if (!useTransparentWindow) return '#000000';
    if (!this.DEBUG_CORNER_BACKING_ENABLED) return '#00000000';
    if (this.DEBUG_CORNER_START_TRANSPARENT && !this.debugCornerBackingActivated) {
      return '#00000000';
    }
    return this.DEBUG_CORNER_BACKING_COLOR;
  }

  private applyWindowBackingColor(
    win: BrowserWindow,
    label: IslandWindowLabel,
    useTransparentWindow: boolean,
    options?: { force?: boolean; reason?: string }
  ): void {
    if (useTransparentWindow) {
      // Transparent side windows should keep the constructor-level transparent
      // backing. Repeated runtime setBackgroundColor calls on transparent
      // windows are a known source of compositor instability on macOS.
      const transparentColor = '#00000000';
      const previousColor = this.windowBackingColor.get(win);
      this.windowBackingColor.set(win, transparentColor);
      if (this.DEBUG_WINDOW_EVENT_LOGGING && options?.force && previousColor !== transparentColor) {
        log.info(
          'Dynamic Island transparent backing tracked (%s): %s -> %s (reason=%s)',
          label,
          previousColor ?? '(unset)',
          transparentColor,
          options.reason ?? 'unspecified'
        );
      }
      return;
    }

    const color = this.getOverlayBackingColor(useTransparentWindow);
    const previousColor = this.windowBackingColor.get(win);
    if (!options?.force && previousColor === color) return;

    win.setBackgroundColor(color);
    this.windowBackingColor.set(win, color);
    if (previousColor !== color) {
      log.info(
        'Dynamic Island backing color transition (%s): %s -> %s',
        label,
        previousColor ?? '(unset)',
        color
      );
      return;
    }

    if (this.DEBUG_WINDOW_EVENT_LOGGING && options?.force) {
      log.info(
        'Dynamic Island backing color reaffirmed (%s): %s (reason=%s)',
        label,
        color,
        options.reason ?? 'unspecified'
      );
    }
  }

  private getWindowByLabel(label: IslandWindowLabel): BrowserWindow | null {
    if (label === 'left') return this.window;
    if (label === 'right') return this.rightWindow;
    if (label === 'filler') return this.gapFillWindow;
    return this.drawerWindow;
  }

  private reinforceWindowBacking(label: IslandWindowLabel, reason: string): void {
    const win = this.getWindowByLabel(label);
    if (!win || win.isDestroyed()) return;
    this.applyWindowBackingColor(
      win,
      label,
      this.shouldUseTransparentWindow(label),
      { force: true, reason }
    );
  }

  private activateDebugCornerBacking(reason: string): void {
    if (!this.DEBUG_CORNER_BACKING_ENABLED) return;
    if (!this.DEBUG_CORNER_START_TRANSPARENT) return;
    if (this.debugCornerBackingActivated) return;

    this.debugCornerBackingActivated = true;
    log.info(
      'Dynamic Island debug backing activated: transparent -> %s (reason=%s)',
      this.DEBUG_CORNER_BACKING_COLOR,
      reason
    );
  }

  private attachWindowDebugLogging(win: BrowserWindow, label: string): void {
    const emit = (eventName: string) => {
      if (win.isDestroyed()) return;
      this.reinforceWindowBacking(label as IslandWindowLabel, `${label}:${eventName}`);
      if (!this.DEBUG_WINDOW_EVENT_LOGGING) {
        return;
      }
      const [x, y] = win.getPosition();
      const [width, height] = win.getSize();
      const reportedBg = win.getBackgroundColor?.() ?? '(unknown)';
      const configuredTransparent = this.shouldUseTransparentWindow(label as IslandWindowLabel);
      const configuredBacking = this.getOverlayBackingColor(configuredTransparent);
      log.info(
        'Dynamic Island window event (%s): %s | visible=%s focused=%s opacity=%s cfgTransparent=%s cfgBg=%s bg=%s bounds=%d,%d %dx%d',
        label,
        eventName,
        win.isVisible(),
        win.isFocused(),
        win.getOpacity().toFixed(2),
        configuredTransparent,
        configuredBacking,
        reportedBg,
        x,
        y,
        width,
        height
      );
    };
    win.on('show', () => emit('show'));
    win.on('hide', () => emit('hide'));
    win.on('focus', () => emit('focus'));
    win.on('blur', () => emit('blur'));
    win.on('move', () => emit('move'));
    win.on('moved', () => emit('moved'));
    win.on('resize', () => emit('resize'));
    win.on('resized', () => emit('resized'));
    win.on('ready-to-show', () => emit('ready-to-show'));
  }

  private handleDisplayConfigurationChanged = (): void => {
    if (this.DEBUG_WINDOW_EVENT_LOGGING) {
      const primary = screen.getPrimaryDisplay();
      log.info(
        'Dynamic Island display-metrics-changed: id=%s internal=%s bounds=%j workArea=%j scale=%s',
        primary.id,
        primary.internal,
        primary.bounds,
        primary.workArea,
        primary.scaleFactor
      );
    }
    this.updateWindowSize();
  };

  private clampInt(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const rounded = Math.round(value);
    return Math.max(min, Math.min(max, rounded));
  }

  private getPrimaryDisplayGeometry(): { x: number; y: number; width: number } {
    const primaryDisplay = screen.getPrimaryDisplay();
    const widthFromBounds = primaryDisplay.bounds?.width;
    const width =
      typeof widthFromBounds === 'number' && Number.isFinite(widthFromBounds) && widthFromBounds > 0
        ? widthFromBounds
        : primaryDisplay.workAreaSize.width;
    return {
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width,
    };
  }

  private isPrimaryInternalDisplay(): boolean {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.internal !== false;
  }

  private getPrimaryDisplayModeWidth(): number {
    const primaryDisplay = screen.getPrimaryDisplay();
    const modeWidth = primaryDisplay.bounds?.width;
    if (typeof modeWidth === 'number' && Number.isFinite(modeWidth) && modeWidth > 0) {
      return modeWidth;
    }
    return primaryDisplay.workAreaSize.width;
  }

  private getActiveNotchProfile(): NotchDisplayProfile | null {
    if (!this.isPrimaryInternalDisplay()) return null;

    const modeWidth = this.getPrimaryDisplayModeWidth();
    let nearest: NotchDisplayProfile | null = null;
    let nearestDelta = Number.POSITIVE_INFINITY;

    for (const profile of this.NOTCH_DISPLAY_PROFILES) {
      const delta = Math.abs(modeWidth - profile.modeWidth);
      if (delta < nearestDelta) {
        nearest = profile;
        nearestDelta = delta;
      }
    }

    // Only snap when we're close to a known notch mode width.
    return nearestDelta <= 96 ? nearest : null;
  }

  private getNotchAnchorWidth(): number {
    if (this.geometryTuning.notchWidthOverride > 0) {
      return this.geometryTuning.notchWidthOverride;
    }
    const profile = this.getActiveNotchProfile();
    return profile?.notchWidth ?? this.NOTCH_WIDTH;
  }

  private getTopWindowY(): number {
    const { y } = this.getPrimaryDisplayGeometry();
    const profile = this.getActiveNotchProfile();
    return y + (profile?.pillY ?? 0) + this.geometryTuning.offsetY;
  }

  private getIdlePillWidth(): number {
    return this.geometryTuning.pillWidth;
  }

  private getIdlePillHeight(): number {
    return this.geometryTuning.pillHeight;
  }

  private getRightPillWidth(): number {
    return this.geometryTuning.pillWidth;
  }

  private getRightPillHeight(): number {
    return this.geometryTuning.pillHeight;
  }

  private getLeftWindowX(width: number, isIdle: boolean): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    const notchWidth = this.getNotchAnchorWidth();
    if (isIdle) {
      return primaryX + Math.floor((screenWidth - notchWidth) / 2 - width) + this.geometryTuning.offsetX;
    }
    return primaryX + Math.floor((screenWidth - width) / 2) + this.geometryTuning.offsetX;
  }

  private getRightWindowX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    const notchWidth = this.getNotchAnchorWidth();
    return primaryX + Math.floor((screenWidth + notchWidth) / 2) + this.geometryTuning.offsetX;
  }

  private getGapFillX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    const notchWidth = this.getNotchAnchorWidth();
    return (
      primaryX +
      Math.floor((screenWidth - notchWidth) / 2) -
      this.CENTER_JOIN_OVERLAP_PX +
      this.geometryTuning.offsetX
    );
  }

  private getGapFillWidth(): number {
    return this.getNotchAnchorWidth() + (this.CENTER_JOIN_OVERLAP_PX * 2);
  }

  private getDrawerWindowX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    return primaryX + Math.floor((screenWidth - this.DRAWER_WIDTH) / 2) + this.geometryTuning.offsetX;
  }

  private shouldShowGapFill(): boolean {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.internal === false;
  }

  private updateRightWindowPosition(): void {
    if (!this.rightWindow || this.rightWindow.isDestroyed()) return;

    const rightWidth = this.getRightPillWidth();
    const rightHeight = this.getRightPillHeight();
    const x = this.getRightWindowX();
    const y = this.getTopWindowY();
    const [currentWidth, currentHeight] = this.rightWindow.getSize();
    const [currentX, currentY] = this.rightWindow.getPosition();
    if (
      currentWidth !== rightWidth ||
      currentHeight !== rightHeight ||
      currentX !== x ||
      currentY !== y
    ) {
      this.rightWindow.setBounds({
        x,
        y,
        width: rightWidth,
        height: rightHeight,
      });
      this.reinforceWindowBacking('right', 'right-set-bounds');
    }
  }

  private updateDrawerWindowPosition(): void {
    if (!this.drawerWindow || this.drawerWindow.isDestroyed()) return;

    const x = this.getDrawerWindowX();
    const y = this.getTopWindowY() + this.DRAWER_Y;
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
      this.reinforceWindowBacking('drawer', 'drawer-set-bounds');
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
    const y = this.getTopWindowY();
    const rightHeight = this.getRightPillHeight();
    const [currentWidth, currentHeight] = this.gapFillWindow.getSize();
    const [currentX, currentY] = this.gapFillWindow.getPosition();
    if (
      currentWidth !== this.getGapFillWidth() ||
      currentHeight !== rightHeight ||
      currentX !== x ||
      currentY !== y
    ) {
      this.gapFillWindow.setBounds({
        x,
        y,
        width: this.getGapFillWidth(),
        height: rightHeight,
      });
      this.reinforceWindowBacking('filler', 'filler-set-bounds');
    }

    if (this.gapFillRendererReady) {
      this.reinforceWindowBacking('filler', 'filler-show');
      this.gapFillWindow.setOpacity(1);
      this.gapFillWindow.showInactive();
    }
  }

  private updateWindowSize(): void {
    this.updateRightWindowPosition();
    this.updateDrawerWindowPosition();
    this.syncGapFillWindow();

    if (!this.window || this.window.isDestroyed()) return;

    const showingHistory = this.historyVisible;
    const idleWidth = this.getIdlePillWidth();
    const idleHeight = this.getIdlePillHeight();
    const targetHeight = showingHistory ? this.ISLAND_HEIGHT_WITH_HISTORY : idleHeight;
    const targetWidth = showingHistory ? this.ISLAND_WIDTH : idleWidth;

    // Center the expanded history panel under the island/notch region.
    // In idle mode, keep the compact pill at the left-notch anchor.
    const x = showingHistory
      ? this.getLeftWindowX(this.ISLAND_WIDTH, false)
      : this.getLeftWindowX(idleWidth, true);
    const y = this.getTopWindowY();

    const [currentWidth, currentHeight] = this.window.getSize();
    const [currentX, currentY] = this.window.getPosition();
    if (currentHeight !== targetHeight || currentWidth !== targetWidth || currentX !== x || currentY !== y) {
      this.window.setBounds({
        x,
        y,
        width: targetWidth,
        height: targetHeight,
      });
      this.reinforceWindowBacking('left', 'left-set-bounds');
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
    ipcMain.removeAllListeners('dynamic-island-delete-history-item');
    ipcMain.removeAllListeners('dynamic-island-history-visible');
    ipcMain.removeAllListeners('dynamic-island-toggle-mute');
    ipcMain.removeAllListeners('dynamic-island-dismiss-transcript');
    ipcMain.removeAllListeners('dynamic-island-open-field-theory');
  }
}
