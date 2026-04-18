import { BrowserWindow, screen, app, ipcMain, clipboard } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import { createLogger } from './logger';
import type { WaitingAgent } from './types/agentAttention';

const log = createLogger('DynamicIsland');

// =============================================================================
// DynamicIslandManager - Fixed-position overlay near the macOS notch.
// Two symmetric pills: left (hamburger + expanded states) and right (hot-mic dot).
// =============================================================================

export type DynamicIslandState = 'idle' | 'silentStacking' | 'recording' | 'transcribing' | 'showing-transcript' | 'improving';
export type DynamicIslandInputMode = 'hot-mic' | 'standard';

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

export interface DynamicIslandHotMicRuntimeStatus {
  state: string;
  condition: string | null;
  engineReady: boolean;
  whisperFallbackActive: boolean;
  queueDepth: number;
  lastChunkAgeMs: number | null;
  chunksReceived: number;
  micHealthy: boolean;
  engine: {
    selectedEngine: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual';
    readiness:
      | 'ready'
      | 'warming'
      | 'cold'
      | 'not-installed'
      | 'not-downloaded'
      | 'corrupt'
      | 'unsupported-arch'
      | 'disabled';
    detail: string | null;
  } | null;
  timing: {
    chunkIntervalMs: number | null;
    queueWaitMs: number | null;
    transcribeMs: number | null;
    postProcessMs: number | null;
    totalPipelineMs: number | null;
    avgTranscribeMs: number | null;
    avgTotalPipelineMs: number | null;
  };
}

export interface DynamicIslandGeometryTuning {
  notchWidthOverride: number; // 0 = auto (use profile/detected notch width)
  pillWidth: number;          // 0 = auto (use ISLAND_WIDTH_IDLE default)
  pillHeight: number;         // 0 = auto (use menu bar height)
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING: DynamicIslandGeometryTuning = {
  notchWidthOverride: 207,
  pillWidth: 60,
  pillHeight: 39,
  offsetX: 0,
  offsetY: -1,
};

type IslandWindowLabel = 'left' | 'drawer';

interface NotchDisplayProfile {
  modeWidth: number;
  notchWidth: number;
  pillY: number;
}

export class DynamicIslandManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private enabled: boolean = true;
  private state: DynamicIslandState = 'idle';
  private rendererReady: boolean = false;
  private pendingShow: boolean = false;
  private historyVisible: boolean = false;
  private leftWindowFocusable: boolean = true;

  private readonly ISLAND_WIDTH = 460;
  private readonly ISLAND_WIDTH_IDLE = 72;
  private readonly ISLAND_HEIGHT = 52;
  private readonly ISLAND_HEIGHT_IDLE = 38;
  private readonly ISLAND_HEIGHT_WITH_TRANSCRIPT = 64;
  private readonly ISLAND_HEIGHT_WITH_HISTORY = 380;
  private readonly HISTORY_LIMIT = 25;
  private readonly NOTCH_WIDTH = 200;
  // Notch display profiles: "looks like" mode widths → notch widths in logical pt.
  // Calibrated from 170pt at 1728pt (16" MBP), others scaled proportionally.
  private readonly NOTCH_DISPLAY_PROFILES: NotchDisplayProfile[] = [
    { modeWidth: 1147, notchWidth: 113, pillY: 0 },
    { modeWidth: 1168, notchWidth: 115, pillY: 0 },
    { modeWidth: 1312, notchWidth: 129, pillY: 0 },
    { modeWidth: 1496, notchWidth: 147, pillY: 0 },
    { modeWidth: 1512, notchWidth: 149, pillY: 0 },
    { modeWidth: 1728, notchWidth: 170, pillY: 0 },
    { modeWidth: 1800, notchWidth: 177, pillY: 0 },
    { modeWidth: 2056, notchWidth: 202, pillY: 0 },
  ];
  private readonly CENTER_JOIN_OVERLAP_PX = 1;
  private readonly RIGHT_PILL_WIDTH = 48;
  private readonly RIGHT_PILL_HEIGHT = 38;
  private readonly DRAWER_WIDTH = 360;
  private readonly DRAWER_HEIGHT = 82;   // 38px backdrop + 44px text
  private readonly DRAWER_Y = 0;
  private readonly DRAWER_TEXT_SIZE_DEFAULT = 14;
  private readonly DRAWER_TEXT_SIZE_MIN = 11;
  private readonly DRAWER_TEXT_SIZE_MAX = 22;
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
  private drawerTextSize: number = this.DRAWER_TEXT_SIZE_DEFAULT;

  private clipboardManager: any = null;

  private dismissTimer: NodeJS.Timeout | null = null;
  private backingHealthTimer: NodeJS.Timeout | null = null;
  private readonly TRANSCRIPT_DISPLAY_MS = 4000;

  // Stack count for screenshots captured during standard recording.
  private stackCount: number = 0;

  // Agents currently waiting for user attention (hook-driven).
  private waitingAgents: WaitingAgent[] = [];

  // Hot-mic state tracked for the right pill.
  private hotMicActive: boolean = false;
  private hotMicWordCount: number = 0;
  private hotMicLastWord: string = '';
  private hotMicMuted: boolean = false;
  private hotMicRuntimeStatus: DynamicIslandHotMicRuntimeStatus = {
    state: 'idle',
    condition: null,
    engineReady: false,
    whisperFallbackActive: false,
    queueDepth: 0,
    lastChunkAgeMs: null,
    chunksReceived: 0,
    micHealthy: true,
    engine: null,
    timing: {
      chunkIntervalMs: null,
      queueWaitMs: null,
      transcribeMs: null,
      postProcessMs: null,
      totalPipelineMs: null,
      avgTranscribeMs: null,
      avgTotalPipelineMs: null,
    },
  };
  private inputMode: DynamicIslandInputMode = 'standard';
  private geometryTuning: DynamicIslandGeometryTuning = { ...DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING };
  private stayOnLaptop: boolean = false;

  // Auto-hide: when enabled, pill visibility tracks cursor proximity. Each
  // tick we compute a *target* progress from cursor distance (0 = fully
  // hidden, 1 = fully revealed) and ease the *rendered* progress toward it
  // with exponential smoothing so jittery cursor input doesn't cause visible
  // jitter on the pills. Non-idle states (recording, hot-mic active) force
  // target = 1 regardless of cursor position.
  private autoHideEnabled: boolean = false;
  private autoHideRenderedProgress: number = 1;
  private autoHidePollTimer: NodeJS.Timeout | null = null;
  private readonly AUTO_HIDE_POLL_INTERVAL_MS = 16;     // ~60 Hz cursor sampling
  private readonly AUTO_HIDE_SMOOTHING = 0.25;          // exp-smoothing factor per tick (~150ms settle)
  private readonly AUTO_HIDE_SNAP_EPSILON = 0.002;      // snap to target when close enough
  private readonly AUTO_HIDE_INNER_PX = 12;             // full reveal at/below this distance
  private readonly AUTO_HIDE_OUTER_PX = 54;             // full conceal at/beyond this distance

  constructor() {
    super();

    screen.on('display-added', this.handleDisplayConfigurationChanged);
    screen.on('display-removed', this.handleDisplayConfigurationChanged);
    screen.on('display-metrics-changed', this.handleDisplayConfigurationChanged);

    // Periodic backing health check — detects corruption between refresh calls
    this.backingHealthTimer = setInterval(() => {
      this.checkBackingHealth();
    }, 2000);

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

    // Cancel the active recording session (standard or hot-mic).
    ipcMain.on('dynamic-island-cancel-session', () => {
      this.emit('cancel-session');
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
    if (!this.enabled) return;
    this.show();
    this.createDrawerWindow();
    this.tickAutoHide();
  }

  setEnabled(enabled: boolean): void {
    const next = !!enabled;
    if (this.enabled === next) return;

    this.enabled = next;
    if (!this.enabled) {
      this.historyVisible = false;
      this.hideAllWindows();
      return;
    }

    if (!this.clipboardManager) return;
    this.show();
    if (!this.drawerWindow || this.drawerWindow.isDestroyed()) {
      this.createDrawerWindow();
    } else {
      this.updateDrawerWindowPosition();
    }
    this.updateDrawerTranscript(this.drawerTranscriptText);
    this.updateWindowSize();
    this.sendStateToRenderer(this.state);
    this.sendHotMicToRight();
    this.sendInputModeToRenderers();
    this.sendHotMicRuntimeStatusToLeft();
    this.tickAutoHide();
  }

  setGeometryTuning(tuning: Partial<DynamicIslandGeometryTuning>): DynamicIslandGeometryTuning {
    const next: DynamicIslandGeometryTuning = {
      notchWidthOverride: this.clampInt(
        tuning.notchWidthOverride,
        0,
        320,
        this.geometryTuning.notchWidthOverride
      ),
      pillWidth: this.clampInt(tuning.pillWidth, 0, 120, this.geometryTuning.pillWidth),
      pillHeight: this.clampInt(tuning.pillHeight, 0, 120, this.geometryTuning.pillHeight),
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

  getResolvedGeometry(): DynamicIslandGeometryTuning & {
    _detected?: { modeWidth: number; scaleFactor: number; menuBarHeight: number; isInternal: boolean };
  } {
    const profile = this.getActiveNotchProfile();
    const display = this.getTargetDisplay();
    return {
      notchWidthOverride: profile?.notchWidth ?? this.NOTCH_WIDTH,
      pillWidth: this.ISLAND_WIDTH_IDLE,
      pillHeight: this.getMenuBarHeight(),
      offsetX: 0,
      offsetY: 0,
      _detected: {
        modeWidth: this.getPrimaryDisplayModeWidth(),
        scaleFactor: display.scaleFactor,
        menuBarHeight: display.workArea.y - display.bounds.y,
        isInternal: this.isPrimaryInternalDisplay(),
      },
    };
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

    if (!this.enabled) {
      this.hideAllWindows();
      return;
    }

    if (state === 'idle') {
      this.historyVisible = false;
      this.sendStateToRenderer(state);
      this.updateWindowSize();
      this.tickAutoHide();
      return;
    }

    this.show();
    this.sendStateToRenderer(state);
    this.updateWindowSize();
    this.tickAutoHide();
  }

  getState(): DynamicIslandState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Stack count (screenshots during recording, forwarded to right pill)
  // -------------------------------------------------------------------------

  updateStackCount(count: number): void {
    this.stackCount = count;
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-stack-changed', count);
    }
  }

  setWaitingAgents(agents: WaitingAgent[]): void {
    this.waitingAgents = agents;
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-agents', agents);
    }
  }

  getWaitingAgents(): WaitingAgent[] {
    return this.waitingAgents;
  }

  // -------------------------------------------------------------------------
  // Hot-mic state (forwarded to right pill)
  // -------------------------------------------------------------------------

  updateHotMic(active: boolean, wordCount: number, lastWord: string): void {
    this.hotMicActive = active;
    this.hotMicWordCount = active ? wordCount : 0;
    this.hotMicLastWord = active ? lastWord : '';
    if (!this.enabled) return;
    this.sendHotMicToRight();
    this.updateWindowSize();
    this.tickAutoHide();
  }

  blinkThenHideHotMic(): void {
    this.hotMicActive = false;
    this.hotMicWordCount = 0;
    this.hotMicLastWord = '';
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('dynamic-island-hotmic-warn-discard');
      setTimeout(() => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send('dynamic-island-hotmic-slide-out');
        }
      }, 600);
    }
  }

  sendMuteState(muted: boolean): void {
    this.hotMicMuted = muted;
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-hotmic-mute', muted);
    }
    this.sendHotMicToRight();
  }

  setInputMode(mode: DynamicIslandInputMode): DynamicIslandInputMode {
    const normalized: DynamicIslandInputMode = mode === 'hot-mic' ? 'hot-mic' : 'standard';
    this.inputMode = normalized;
    this.updateWindowSize();
    this.sendInputModeToRenderers();
    return normalized;
  }

  getInputMode(): DynamicIslandInputMode {
    return this.inputMode;
  }

  updateStandardAudioLevel(level: number): void {
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-standard-audio-level', level);
    }
  }

  updateHotMicBackgroundFilterMeter(data: HotMicBackgroundFilterMeter): void {
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-hotmic-filter-meter', data);
    }
  }

  updateHotMicRuntimeStatus(status: DynamicIslandHotMicRuntimeStatus): void {
    this.hotMicRuntimeStatus = status;
    if (!this.enabled) return;
    this.sendHotMicRuntimeStatusToLeft();
  }

  private sendHotMicToRight(): void {
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-hotmic', {
        active: this.hotMicActive,
        wordCount: this.hotMicWordCount,
        lastWord: this.hotMicLastWord,
        muted: this.hotMicMuted,
      });
    }
  }

  private sendHotMicRuntimeStatusToLeft(): void {
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-hotmic-runtime', this.hotMicRuntimeStatus);
    }
  }

  private sendInputModeToRenderers(): void {
    if (!this.enabled) return;
    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      this.window.webContents.send('dynamic-island-input-mode', this.inputMode);
    }
  }

  // -------------------------------------------------------------------------
  // Transcript data
  // -------------------------------------------------------------------------

  sendTranscript(text: string, isFinal: boolean): void {
    if (!this.enabled) return;
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
    if (!this.enabled) return;
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
    if (!this.enabled) return;
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
    }

    if (this.window) {
      if (!this.rendererReady) {
        this.pendingShow = true;
        return;
      }
      this.reinforceWindowBacking('left', 'left-show');
      if (this.isAutoHidden()) return;
      this.window.setOpacity(1);
      this.window.showInactive();
    }
  }

  setLeftWindowFocusable(focusable: boolean): void {
    this.leftWindowFocusable = focusable;
    if (this.window && !this.window.isDestroyed()) {
      this.window.setFocusable(focusable);
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
    const initialWidth = this.historyVisible
      ? this.getUnifiedWindowWidth(this.ISLAND_WIDTH)
      : this.getUnifiedWindowWidth(idleWidth);
    const x = this.getLeftWindowX(idleWidth, true);
    const y = this.getTopWindowY();

    const initialHeight = this.historyVisible ? this.ISLAND_HEIGHT_WITH_HISTORY : idleHeight;

    this.window = new BrowserWindow({
      type: 'panel',
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
      hiddenInMissionControl: true,
      resizable: false,
      movable: false,
      focusable: this.leftWindowFocusable,
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

    this.loadWindowUrl(this.window, `dynamic-island.html?side=unified&rightWidth=${this.getRightPillWidth()}`);

    // Intercept Cmd+W at the keyboard level so it never reaches the window
    // close handler. Using preventDefault on 'close' causes macOS to
    // re-composite the window, flashing white corners on transparent windows
    // and making the app appear in Cmd+Tab.
    this.window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'w' && input.meta) {
        _event.preventDefault();
      }
    });

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
        if (!this.enabled) {
          this.window.hide();
          return;
        }
        this.sendStateToRenderer(this.state);
        this.sendInputModeToRenderers();
        const leftWidth = this.historyVisible ? this.ISLAND_WIDTH : this.getIdlePillWidth();
        this.window.webContents.send('dynamic-island-resize', { leftWidth, rightWidth: this.getRightPillWidth() });
        this.window.webContents.send('dynamic-island-stack-changed', this.stackCount);
        this.window.webContents.send('dynamic-island-agents', this.waitingAgents);
        this.sendHistory();
        this.sendHotMicRuntimeStatusToLeft();

        if (this.pendingShow) {
          this.pendingShow = false;
          this.reinforceWindowBacking('left', 'left-pending-show');
          if (!this.isAutoHidden()) {
            this.window.setOpacity(1);
            this.window.showInactive();
          }
        }
      }
    });
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
      hiddenInMissionControl: true,
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
        // Re-apply transcript state through the shared updater so visibility
        // and speaking indicators stay consistent when renderer readiness races.
        this.updateDrawerTranscript(this.drawerTranscriptText);
        this.drawerWindow.webContents.send('dynamic-island-drawer-speaking', this.drawerSpeaking);
        this.sendDrawerTextSize();
      }
    });
  }

  updateDrawerTranscript(text: string): void {
    this.drawerTranscriptText = text;

    if ((!this.drawerWindow || this.drawerWindow.isDestroyed()) && text && this.enabled) {
      this.createDrawerWindow();
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

  setDrawerTextSize(size: number): number {
    const normalized = this.clampInt(
      size,
      this.DRAWER_TEXT_SIZE_MIN,
      this.DRAWER_TEXT_SIZE_MAX,
      this.DRAWER_TEXT_SIZE_DEFAULT
    );
    this.drawerTextSize = normalized;
    this.sendDrawerTextSize();
    return this.drawerTextSize;
  }

  getDrawerTextSize(): number {
    return this.drawerTextSize;
  }

  private sendDrawerTextSize(): void {
    if (this.drawerWindow && !this.drawerWindow.isDestroyed() && this.drawerRendererReady) {
      this.drawerWindow.webContents.send('dynamic-island-drawer-text-size', this.drawerTextSize);
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
    const snapshot = this.snapshotBackingState();
    this.refreshSingleWindowProperties(this.window, 2, 'left');
    this.refreshSingleWindowProperties(this.drawerWindow, 1, 'drawer');
    const after = this.snapshotBackingState();
    const corrupted = snapshot.some(s => s.reportedBg !== '#00000000' && s.reportedBg !== '#000000');
    log.info(
      '[DI-Trace] refreshWindowProperties reason=%s corrupted=%s before=[%s] after=[%s]',
      reason,
      corrupted,
      snapshot.map(s => `${s.label}:${s.reportedBg}`).join(' '),
      after.map(s => `${s.label}:${s.reportedBg}`).join(' '),
    );
  }

  private snapshotBackingState(): Array<{ label: string; reportedBg: string; visible: boolean; opacity: number }> {
    const results: Array<{ label: string; reportedBg: string; visible: boolean; opacity: number }> = [];
    const windows: Array<[BrowserWindow | null, string]> = [
      [this.window, 'left'],
      [this.drawerWindow, 'drawer'],
    ];
    for (const [win, label] of windows) {
      if (!win || win.isDestroyed()) continue;
      results.push({
        label,
        reportedBg: win.getBackgroundColor?.() ?? '(unknown)',
        visible: win.isVisible(),
        opacity: win.getOpacity(),
      });
    }
    return results;
  }

  private checkBackingHealth(): void {
    const snapshot = this.snapshotBackingState();
    if (snapshot.length === 0) return;
    const corrupted = snapshot.filter(s => {
      if (!s.visible) return false;
      // Transparent windows should report #00000000, opaque ones #000000
      return s.reportedBg !== '#00000000' && s.reportedBg !== '#000000';
    });
    if (corrupted.length > 0) {
      log.warn(
        '[DI-Trace] BACKING CORRUPTED detected by health check: [%s] — auto-refreshing',
        corrupted.map(c => `${c.label}:bg=${c.reportedBg} vis=${c.visible} op=${c.opacity.toFixed(2)}`).join(', '),
      );
      this.refreshWindowProperties('auto-health-check');
    }
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

    if (win.isVisible() && !this.isAutoHidden()) {
      win.setOpacity(1);
    }
  }

  private shouldUseTransparentWindow(label: IslandWindowLabel): boolean {
    if (label === 'left' && this.KEEP_SIDE_PILLS_TRANSPARENT) {
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
      // backing. Avoid frequent setBackgroundColor calls which can cause
      // compositor instability on macOS — but DO re-apply on forced reinforce
      // (e.g. after focus/show events) to recover from white backing corruption.
      const transparentColor = '#00000000';
      const previousColor = this.windowBackingColor.get(win);
      this.windowBackingColor.set(win, transparentColor);
      if (options?.force) {
        win.setBackgroundColor(transparentColor);
      }
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
    this.refreshWindowProperties('display-metrics-changed');
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

  setStayOnLaptop(value: boolean): void {
    if (this.stayOnLaptop === value) return;
    this.stayOnLaptop = value;
    this.updateWindowSize();
    this.refreshWindowProperties('stay-on-laptop-changed');
  }

  setAutoHide(enabled: boolean): void {
    const next = !!enabled;
    if (this.autoHideEnabled === next) return;
    this.autoHideEnabled = next;
    if (this.autoHideEnabled) {
      this.startAutoHidePolling();
      this.tickAutoHide();
    } else {
      this.stopAutoHidePolling();
      this.autoHideRenderedProgress = 1;
      // Recompute natural bounds so any pill that was mid-slide into the
      // notch (or fully hidden) snaps back to its correct position for the
      // current state before we show it. Without this, pills would reappear
      // at whatever slid-in position the last animation tick set them to.
      this.updateWindowSize();
      this.applyAutoHideProgress(1);
    }
  }

  private startAutoHidePolling(): void {
    if (this.autoHidePollTimer) return;
    this.autoHidePollTimer = setInterval(() => {
      this.tickAutoHide();
    }, this.AUTO_HIDE_POLL_INTERVAL_MS);
  }

  private stopAutoHidePolling(): void {
    if (this.autoHidePollTimer) {
      clearInterval(this.autoHidePollTimer);
      this.autoHidePollTimer = null;
    }
  }

  // Final authority over whether external show() paths should be allowed to
  // run. True when auto-hide is in control of the windows and progress is
  // below 1 — external code that calls setOpacity(1) / showInactive() would
  // undo the cursor-driven intermediate state.
  private isAutoHidden(): boolean {
    return this.autoHideEnabled && this.autoHideRenderedProgress < 1;
  }

  // Maps cursor distance from the island's idle bounding box to a progress
  // value in [0, 1]: 1 at the island (inside INNER_PX), 0 far from it (at or
  // beyond OUTER_PX), linear in between. Returns 0 when the cursor is on a
  // different display than the island.
  private computeAutoHideProgressFromCursor(): number {
    const display = this.getTargetDisplay();
    if (!display) return 0;
    const cursor = screen.getCursorScreenPoint();
    const bounds = display.bounds;
    if (
      cursor.x < bounds.x ||
      cursor.x > bounds.x + bounds.width ||
      cursor.y < bounds.y ||
      cursor.y > bounds.y + bounds.height
    ) {
      return 0;
    }

    const idleWidth = this.getIdlePillWidth();
    const idleHeight = this.getIdlePillHeight();
    const leftX = this.getLeftWindowX(idleWidth, true);
    const rightX = leftX + this.getUnifiedWindowWidth(idleWidth);
    const topY = this.getTopWindowY();
    const bottomY = topY + idleHeight;

    // Distance from cursor to the island's axis-aligned bounding box.
    const dx = Math.max(leftX - cursor.x, 0, cursor.x - rightX);
    const dy = Math.max(topY - cursor.y, 0, cursor.y - bottomY);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= this.AUTO_HIDE_INNER_PX) return 1;
    if (distance >= this.AUTO_HIDE_OUTER_PX) return 0;
    return 1 - (distance - this.AUTO_HIDE_INNER_PX) / (this.AUTO_HIDE_OUTER_PX - this.AUTO_HIDE_INNER_PX);
  }

  private tickAutoHide(): void {
    if (!this.autoHideEnabled || !this.enabled) return;

    const forceVisible = this.isActiveState();
    const target = forceVisible ? 1 : this.computeAutoHideProgressFromCursor();

    // Active states (recording, hot-mic, etc.) snap instantly to fully visible
    // so the animation doesn't fight the window resize from updateWindowSize().
    if (forceVisible && this.autoHideRenderedProgress < 1) {
      this.autoHideRenderedProgress = 1;
      this.applyAutoHideProgress(1);
      return;
    }

    // If already settled at target, nothing to do. This is the hot path
    // when the cursor is stationary — we tick at 60 Hz but early-out.
    const delta = target - this.autoHideRenderedProgress;
    if (Math.abs(delta) < this.AUTO_HIDE_SNAP_EPSILON) {
      if (this.autoHideRenderedProgress !== target) {
        this.autoHideRenderedProgress = target;
        this.applyAutoHideProgress(target);
      }
      return;
    }

    // Exponential smoothing: move a fraction of the remaining distance each
    // tick. Jittery targets are filtered out because the rendered value only
    // integrates ~25% of each new target per 16ms frame.
    this.autoHideRenderedProgress += delta * this.AUTO_HIDE_SMOOTHING;
    this.applyAutoHideProgress(this.autoHideRenderedProgress);
  }

  // Maps a progress value (0 = fully concealed, 1 = fully revealed) to
  // concrete window positions and opacities. Called from the poll tick every
  // 16ms whenever the cursor-derived progress changes. The method is also
  // safe to call standalone from transitions (setEnabled, disable, etc.).
  private applyAutoHideProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    const hasNotch = this.getActiveNotchProfile() !== null;

    if (clamped <= 0) {
      if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
        this.window.hide();
      }
      return;
    }

    if (clamped >= 1) {
      if (this.window && !this.window.isDestroyed() && this.rendererReady) {
        this.window.setOpacity(1);
        this.window.showInactive();
      }
      return;
    }

    if (this.window && !this.window.isDestroyed() && this.rendererReady) {
      if (!this.window.isVisible()) {
        this.window.setOpacity(1);
        this.window.showInactive();
      }
      if (hasNotch) {
        // Slide only — opacity stays 1 throughout. The window hides (clamped <= 0)
        // only after pills are fully retracted behind the notch gap.
        const leftWidth = this.getIdlePillWidth();
        const rightWidth = this.getRightPillWidth();
        const naturalX = this.getLeftWindowX(leftWidth, true);
        const x = Math.round(naturalX + leftWidth * (1 - clamped));
        const width = Math.round(this.getGapFillWidth() + (leftWidth + rightWidth) * clamped);
        const height = this.window.getSize()[1];
        const y = this.getTopWindowY();
        this.window.setBounds({ x, y, width, height });
        this.window.setOpacity(1);
      } else {
        this.window.setOpacity(clamped);
      }
    }
  }

  private getTargetDisplay(): Electron.Display {
    if (this.stayOnLaptop) {
      const internal = screen.getAllDisplays().find(d => d.internal === true);
      if (internal) return internal;
    }
    return screen.getPrimaryDisplay();
  }

  private getPrimaryDisplayGeometry(): { x: number; y: number; width: number } {
    const display = this.getTargetDisplay();
    const widthFromBounds = display.bounds?.width;
    const width =
      typeof widthFromBounds === 'number' && Number.isFinite(widthFromBounds) && widthFromBounds > 0
        ? widthFromBounds
        : display.workAreaSize.width;
    return {
      x: display.bounds.x,
      y: display.bounds.y,
      width,
    };
  }

  private getMenuBarHeight(): number {
    const display = this.getTargetDisplay();
    const menuBarHeight = display.workArea.y - display.bounds.y;
    if (menuBarHeight <= 0 || menuBarHeight >= 80) return this.ISLAND_HEIGHT_IDLE;
    return Math.max(menuBarHeight, 32);
  }

  private isPrimaryInternalDisplay(): boolean {
    const display = this.getTargetDisplay();
    return display.internal !== false;
  }

  private getPrimaryDisplayModeWidth(): number {
    const display = this.getTargetDisplay();
    const modeWidth = display.bounds?.width;
    if (typeof modeWidth === 'number' && Number.isFinite(modeWidth) && modeWidth > 0) {
      return modeWidth;
    }
    return display.workAreaSize.width;
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

  private isActiveState(): boolean {
    return this.hotMicActive || this.state !== 'idle';
  }

  private getIdlePillWidth(): number {
    if (this.geometryTuning.pillWidth === 0) return this.ISLAND_WIDTH_IDLE;
    return this.geometryTuning.pillWidth;
  }

  private getExpandedPillWidth(): number {
    const idle = this.getIdlePillWidth();
    return Math.max(Math.round(idle * 1.5), this.ISLAND_WIDTH_IDLE);
  }

  private getPillWidth(): number {
    return this.isActiveState() ? this.getExpandedPillWidth() : this.getIdlePillWidth();
  }

  private getIdlePillHeight(): number {
    // 0 = auto: use menu bar height so the pill fits across 13"/14"/16" MacBook Pros.
    if (this.geometryTuning.pillHeight === 0) {
      return this.getMenuBarHeight();
    }
    return this.geometryTuning.pillHeight;
  }

  private getRightPillWidth(): number {
    return this.getPillWidth();
  }

  private getLeftWindowX(width: number, isIdle: boolean): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    const notchWidth = this.getNotchAnchorWidth();
    if (isIdle) {
      return primaryX + Math.floor((screenWidth - notchWidth) / 2 - width) + this.geometryTuning.offsetX;
    }
    return primaryX + Math.floor((screenWidth - width) / 2) + this.geometryTuning.offsetX;
  }

  private getGapFillWidth(): number {
    return this.getNotchAnchorWidth() + (this.CENTER_JOIN_OVERLAP_PX * 2);
  }

  private getUnifiedWindowWidth(leftWidth: number): number {
    return leftWidth + this.getGapFillWidth() + this.getRightPillWidth();
  }

  private getUnifiedWindowX(leftWidth: number, isIdle: boolean): number {
    return this.getLeftWindowX(leftWidth, isIdle);
  }

  private getDrawerWindowX(): number {
    const { x: primaryX, width: screenWidth } = this.getPrimaryDisplayGeometry();
    return primaryX + Math.floor((screenWidth - this.DRAWER_WIDTH) / 2) + this.geometryTuning.offsetX;
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

  private updateWindowSize(): void {
    if (!this.enabled) {
      this.hideAllWindows();
      return;
    }

    this.updateDrawerWindowPosition();

    if (!this.window || this.window.isDestroyed()) return;

    const showingHistory = this.historyVisible;
    const idleWidth = this.getIdlePillWidth();
    const idleHeight = this.getIdlePillHeight();
    const targetLeftWidth = showingHistory ? this.ISLAND_WIDTH : this.getPillWidth();
    const targetHeight = showingHistory ? this.ISLAND_HEIGHT_WITH_HISTORY : idleHeight;
    const targetWidth = this.getUnifiedWindowWidth(targetLeftWidth);

    const x = showingHistory
      ? this.getUnifiedWindowX(this.ISLAND_WIDTH, false)
      : this.getUnifiedWindowX(targetLeftWidth, true);
    const y = this.getTopWindowY();

    const [currentWidth, currentHeight] = this.window.getSize();
    const [currentX, currentY] = this.window.getPosition();
    if (currentHeight !== targetHeight || currentWidth !== targetWidth || currentX !== x || currentY !== y) {
      this.window.setBounds({ x, y, width: targetWidth, height: targetHeight });
      this.reinforceWindowBacking('left', 'left-set-bounds');
    }

    if (this.rendererReady) {
      this.window.webContents.send('dynamic-island-resize', { leftWidth: targetLeftWidth, rightWidth: this.getRightPillWidth() });
    }
  }

  private hideAllWindows(): void {
    this.pendingShow = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
    if (this.drawerWindow && !this.drawerWindow.isDestroyed()) {
      this.drawerWindow.hide();
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  destroy(): void {
    if (this.backingHealthTimer) {
      clearInterval(this.backingHealthTimer);
      this.backingHealthTimer = null;
    }
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.stopAutoHidePolling();
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
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
    ipcMain.removeAllListeners('dynamic-island-cancel-session');
    ipcMain.removeAllListeners('dynamic-island-open-field-theory');
    this.stackCount = 0;
  }
}
