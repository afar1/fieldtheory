// =============================================================================
// SquaresManager - Window Management Engine
// Window management with instant snap for Field Theory.
// Uses native Swift helper (AX API) for sub-millisecond window manipulation.
// =============================================================================

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { screen, globalShortcut } from 'electron';
import { PreferencesManager } from './preferences';
import { NativeHelper } from './nativeHelper';
import { createLogger } from './logger';
import { HOT_MIC_DEFAULT_WINDOW_COMMANDS } from './hotMicDefaults';
import {
  WindowFrame,
  WindowInfo,
  ScreenInfo,
  WindowSnapshot,
  SquaresAction,
  SquaresConfig,
  SquaresHotkeys,
  DEFAULT_SQUARES_CONFIG,
  DEFAULT_SQUARES_HOTKEYS,
} from './types/squares';

const log = createLogger('Squares');
const execAsync = promisify(exec);

// Maximum time we'll wait for an AppleScript to complete.
const APPLESCRIPT_TIMEOUT_MS = 5000;

// Field Theory bundle IDs - we skip these when listing/managing windows.
const FIELD_THEORY_BUNDLE_IDS = [
  'com.fieldtheory.app',
  'com.fieldtheory.experimental',
  'com.github.Electron',
];

const VALID_SQUARES_VOICE_ACTIONS = new Set<SquaresAction>([
  'leftHalf',
  'rightHalf',
  'topHalf',
  'bottomHalf',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'firstThird',
  'centerThird',
  'lastThird',
  'firstTwoThirds',
  'lastTwoThirds',
  'maximize',
  'almostMaximize',
  'center',
  'restore',
  'grid',
  'focus',
  'minimize',
  'hide',
  'showAll',
  'fullScreen',
  'exitFullScreen',
  'horizontalSpread',
  'verticalSpread',
  'cascade',
]);

const LEGACY_WINDOW_COMMAND_ACTIONS: Record<string, SquaresAction> = {
  'tile-all': 'grid',
  'show-all': 'showAll',
  'focus-mode': 'focus',
  'cascade-active-app': 'cascade',
  'left-half': 'leftHalf',
  'right-half': 'rightHalf',
  'top-left': 'topLeft',
  'top-right': 'topRight',
  'bottom-left': 'bottomLeft',
  'bottom-right': 'bottomRight',
  fullscreen: 'fullScreen',
  'exit-fullscreen': 'exitFullScreen',
  'horizontal-spread': 'horizontalSpread',
  'vertical-spread': 'verticalSpread',
};

/**
 * Run an AppleScript command with a timeout.
 * Only used for non-animation operations (hide/show apps).
 */
async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execAsync(
    `osascript -e '${script.replace(/'/g, "'\\''")}'`,
    { timeout: APPLESCRIPT_TIMEOUT_MS }
  );
  return stdout.trim();
}

// ============================================================================
// SquaresManager class
// ============================================================================

export class SquaresManager extends EventEmitter {
  private preferences: PreferencesManager;
  private nativeHelper: NativeHelper;
  private config: SquaresConfig;
  private hotkeys: SquaresHotkeys;
  private registeredHotkeys: Map<string, string> = new Map(); // action -> accelerator
  private history: WindowSnapshot[][] = [];  // Stack of undo states (groups of snapshots)
  private animating = false;  // Prevent concurrent operations

  constructor(preferences: PreferencesManager, nativeHelper: NativeHelper) {
    super();
    this.preferences = preferences;
    this.nativeHelper = nativeHelper;

    // Load config from preferences, falling back to defaults.
    const savedConfig = this.preferences.getPreference('squaresConfig' as any);
    this.config = savedConfig
      ? { ...DEFAULT_SQUARES_CONFIG, ...savedConfig }
      : { ...DEFAULT_SQUARES_CONFIG };

    const savedHotkeys = this.preferences.getPreference('squaresHotkeys' as any);
    this.hotkeys = savedHotkeys
      ? { ...DEFAULT_SQUARES_HOTKEYS, ...savedHotkeys }
      : { ...DEFAULT_SQUARES_HOTKEYS };
  }

  // --------------------------------------------------------------------------
  // Initialization and cleanup
  // --------------------------------------------------------------------------

  /**
   * Register all Squares hotkeys with the OS.
   * Called after onboarding is complete.
   */
  registerHotkeys(): void {
    this.unregisterHotkeys();
    log.info('Squares keyboard shortcut registration disabled (voice commands only)');
  }

  /**
   * Unregister all Squares hotkeys.
   * Called on app quit or when disabling Squares.
   */
  unregisterHotkeys(): void {
    for (const [action, accelerator] of this.registeredHotkeys) {
      try {
        globalShortcut.unregister(accelerator);
      } catch (err) {
        log.error(`Error unregistering hotkey for ${action}:`, err);
      }
    }
    this.registeredHotkeys.clear();
  }

  /**
   * Re-register hotkeys after a config change.
   */
  private reRegisterHotkeys(): void {
    this.unregisterHotkeys();
    this.registerHotkeys();
  }


  // --------------------------------------------------------------------------
  // Config management
  // --------------------------------------------------------------------------

  getConfig(): SquaresConfig {
    return { ...this.config };
  }

  async setConfig(updates: Partial<SquaresConfig>): Promise<void> {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...updates };
    await this.preferences.save({ squaresConfig: this.config } as any);

    // If enabled state changed, toggle hotkeys.
    if (updates.enabled !== undefined && updates.enabled !== wasEnabled) {
      if (updates.enabled) {
        this.registerHotkeys();
      } else {
        this.unregisterHotkeys();
      }
    }

    this.emit('configChanged', this.config);
  }

  getHotkeys(): SquaresHotkeys {
    return { ...this.hotkeys };
  }

  async setHotkeys(updates: Partial<SquaresHotkeys>): Promise<void> {
    this.hotkeys = { ...this.hotkeys, ...updates };
    await this.preferences.save({ squaresHotkeys: this.hotkeys } as any);
    this.reRegisterHotkeys();
  }

  async resetHotkeys(): Promise<void> {
    this.hotkeys = { ...DEFAULT_SQUARES_HOTKEYS };
    await this.preferences.save({ squaresHotkeys: this.hotkeys } as any);
    this.reRegisterHotkeys();
  }


  // --------------------------------------------------------------------------
  // Window discovery - get all visible windows on screen
  // --------------------------------------------------------------------------

  /**
   * Get all visible windows using the native Swift helper.
   * Filters out Field Theory windows and non-standard windows.
   */
  async getWindows(): Promise<WindowInfo[]> {
    if (process.platform !== 'darwin') return [];

    try {
      const nativeWindows = await this.nativeHelper.getWindowList();

      return nativeWindows
        .filter(w => !FIELD_THEORY_BUNDLE_IDS.includes(w.ownerBundleId))
        .map(w => ({
          windowId: w.windowId,
          ownerName: w.ownerName,
          ownerPID: w.ownerPID,
          ownerBundleId: w.ownerBundleId,
          title: w.title,
          frame: { x: w.x, y: w.y, width: w.width, height: w.height },
          isOnScreen: true,
          layer: w.layer,
        }));
    } catch (err) {
      log.error('Failed to get windows:', err);
      return [];
    }
  }

  /**
   * Get screen/display information using Electron's screen API.
   */
  getScreens(): ScreenInfo[] {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return displays.map(d => ({
      id: d.id,
      frame: {
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      },
      visibleFrame: {
        x: d.workArea.x,
        y: d.workArea.y,
        width: d.workArea.width,
        height: d.workArea.height,
      },
      isPrimary: d.id === primaryDisplay.id,
    }));
  }

  /**
   * Get the screen that contains a given window (by center point).
   */
  private getScreenForWindow(frame: WindowFrame): ScreenInfo {
    const screens = this.getScreens();
    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height / 2;

    // Find the screen that contains the window's center point.
    for (const s of screens) {
      if (
        centerX >= s.frame.x &&
        centerX < s.frame.x + s.frame.width &&
        centerY >= s.frame.y &&
        centerY < s.frame.y + s.frame.height
      ) {
        return s;
      }
    }

    // Fallback to primary screen.
    return screens.find(s => s.isPrimary) || screens[0];
  }

  /**
   * Resolve the target screen for multi-window layouts.
   * Prefer the frontmost window of the frontmost app, then fall back to primary.
   */
  private getTargetScreenForAppWindows(appWindows: WindowInfo[]): ScreenInfo {
    if (appWindows.length > 0) {
      // getFrontmostAppWindows preserves window ordering from CGWindowList
      // (front-to-back), so index 0 is the app's frontmost window.
      return this.getScreenForWindow(appWindows[0].frame);
    }

    const screens = this.getScreens();
    return screens.find(s => s.isPrimary) || screens[0];
  }


  // --------------------------------------------------------------------------
  // Window manipulation - move and resize windows
  // --------------------------------------------------------------------------

  /**
   * Move a window to a target frame (instant snap via AX API).
   */
  async moveWindow(pid: number, windowTitle: string, from: WindowFrame, to: WindowFrame): Promise<void> {
    const success = await this.nativeHelper.setWindowFrame(
      pid,
      windowTitle,
      to.x,
      to.y,
      to.width,
      to.height,
      from
    );
    if (!success) {
      log.warn(
        'Squares moveWindow failed: pid=%d title="%s" from=%o to=%o',
        pid,
        windowTitle,
        from,
        to
      );
    }
  }

  /**
   * Move multiple windows simultaneously for grid/spread layouts.
   * Sets each window frame instantly via AX API.
   */
  async moveWindowsBatch(
    moves: Array<{ pid: number; title: string; from: WindowFrame; to: WindowFrame }>
  ): Promise<void> {
    if (moves.length === 0) return;

    const results: Array<{
      move: { pid: number; title: string; from: WindowFrame; to: WindowFrame };
      success: boolean;
    }> = [];

    // Execute sequentially so disambiguation by source frame remains stable
    // even when multiple windows share the same title and overlapping bounds.
    for (const m of moves) {
      const success = await this.nativeHelper.setWindowFrame(
        m.pid,
        m.title,
        m.to.x,
        m.to.y,
        m.to.width,
        m.to.height,
        m.from
      );
      results.push({ move: m, success });
    }

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      log.warn(
        'Squares moveWindowsBatch partial failure: %d/%d failed',
        failed.length,
        moves.length
      );
      for (const entry of failed.slice(0, 5)) {
        log.warn(
          'Squares failed move: pid=%d title="%s" from=%o to=%o',
          entry.move.pid,
          entry.move.title,
          entry.move.from,
          entry.move.to
        );
      }
    }
  }

  /**
   * Hide all windows except those belonging to a specific app.
   * Used by the "focus" action.
   */
  private async hideOtherApps(keepPID: number): Promise<void> {
    try {
      const script = `
        tell application "System Events"
          set allProcs to every process whose visible is true and unix id is not ${keepPID}
          repeat with proc in allProcs
            try
              set visible of proc to false
            end try
          end repeat
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to hide other apps:', err);
    }
  }

  /**
   * Show all hidden apps. Used when undoing "focus".
   */
  private async showAllApps(): Promise<void> {
    try {
      const script = `
        tell application "System Events"
          set allProcs to every process whose background only is false
          repeat with proc in allProcs
            try
              set visible of proc to true
            end try
          end repeat
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to show all apps:', err);
    }
  }

  /**
   * Get the frontmost (active) window info.
   * Uses the cached frontmost app from nativeHelper (updated on app switch, no IPC).
   */
  private async getFrontmostWindow(): Promise<WindowInfo | null> {
    const windows = await this.getWindows();
    if (windows.length === 0) {
      log.info('getFrontmostWindow: getWindows() returned empty');
      return null;
    }

    // Use cached frontmost app info from native helper (instant, no AppleScript).
    // Match by bundleId (unique) rather than display name (could collide).
    const frontApp = this.nativeHelper.getFrontmostApp();
    if (frontApp?.bundleId) {
      const match = windows.find(w => w.ownerBundleId === frontApp.bundleId);
      if (match) return match;
      log.info('getFrontmostWindow: cached frontmost app "%s" (%s) not in window list, falling back', frontApp.name, frontApp.bundleId);
    }

    // Fallback: try AppleScript if cached info unavailable.
    try {
      const pid = await runAppleScript(
        'tell application "System Events" to return unix id of (first process whose frontmost is true)'
      );
      const frontPID = parseInt(pid, 10);
      const match = windows.find(w => w.ownerPID === frontPID);
      if (match) return match;
    } catch (err) {
      log.info('getFrontmostWindow: AppleScript fallback failed: %s', err);
    }

    return windows[0];
  }

  /**
   * Get all windows belonging to the frontmost app.
   */
  private async getFrontmostAppWindows(): Promise<WindowInfo[]> {
    const windows = await this.getWindows();
    if (windows.length === 0) return [];

    // Use cached frontmost app info (match by bundleId for uniqueness).
    const frontApp = this.nativeHelper.getFrontmostApp();
    if (frontApp?.bundleId) {
      const appWindows = windows.filter(w => w.ownerBundleId === frontApp.bundleId);
      if (appWindows.length > 0) return appWindows;
    }

    // Fallback to AppleScript.
    try {
      const pid = await runAppleScript(
        'tell application "System Events" to return unix id of (first process whose frontmost is true)'
      );
      const frontPID = parseInt(pid, 10);
      return windows.filter(w => w.ownerPID === frontPID);
    } catch {
      return [];
    }
  }


  // --------------------------------------------------------------------------
  // History / Undo
  // --------------------------------------------------------------------------

  /**
   * Save the current state of affected windows before performing an action.
   * This enables the "restore" / undo functionality.
   */
  private saveHistory(windows: WindowInfo[], actionType?: WindowSnapshot['actionType']): void {
    const snapshots: WindowSnapshot[] = windows.map(w => ({
      windowId: w.windowId,
      ownerPID: w.ownerPID,
      ownerBundleId: w.ownerBundleId,
      title: w.title,
      frame: { ...w.frame },
      timestamp: Date.now(),
      actionType,
    }));

    this.history.push(snapshots);

    // Trim history to max size.
    while (this.history.length > this.config.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Restore windows to their previous positions (undo last action).
   */
  private async restoreLastState(): Promise<boolean> {
    const lastState = this.history.pop();
    if (!lastState || lastState.length === 0) {
      log.info('No history to restore');
      return false;
    }

    const actionType = lastState[0]?.actionType;

    switch (actionType) {
      case 'minimize': {
        // Unminimize the window
        const snap = lastState[0];
        try {
          const script = `
            tell application "System Events"
              set targetProc to first process whose unix id is ${snap.ownerPID}
              set miniaturized of window 1 of targetProc to false
            end tell
          `;
          await runAppleScript(script);
        } catch (err) {
          log.error('Failed to unminimize window:', err);
        }
        return true;
      }

      case 'hide': {
        // Unhide the app
        const snap = lastState[0];
        try {
          const script = `
            tell application "System Events"
              set targetProc to first process whose unix id is ${snap.ownerPID}
              set visible of targetProc to true
            end tell
          `;
          await runAppleScript(script);
        } catch (err) {
          log.error('Failed to unhide app:', err);
        }
        return true;
      }

      case 'fullScreen': {
        // Exit full screen
        const snap = lastState[0];
        try {
          const script = `
            tell application "System Events"
              set targetProc to first process whose unix id is ${snap.ownerPID}
              set value of attribute "AXFullScreen" of window 1 of targetProc to false
            end tell
          `;
          await runAppleScript(script);
        } catch (err) {
          log.error('Failed to exit full screen:', err);
        }
        return true;
      }

      case 'focus': {
        // Show all apps
        await this.showAllApps();

        // Restore window positions directly from snapshots.
        // We use PID+title from the snapshot rather than cross-referencing getWindows(),
        // because off-screen windows (-30000,-30000) don't appear in CGWindowListCopyWindowInfo
        // with .optionOnScreenOnly.
        const moves = lastState.map(snapshot => ({
          pid: snapshot.ownerPID,
          title: snapshot.title,
          from: { x: 0, y: 0, width: 0, height: 0 } as WindowFrame,
          to: snapshot.frame,
        }));
        if (moves.length > 0) await this.moveWindowsBatch(moves);
        return true;
      }

      default: {
        // 'move' or undefined — original behavior: show all apps + restore positions
        await this.showAllApps();

        const currentWindows = await this.getWindows();
        const moves: Array<{ pid: number; title: string; from: WindowFrame; to: WindowFrame }> = [];
        for (const snapshot of lastState) {
          const current = currentWindows.find(
            w => w.ownerPID === snapshot.ownerPID && w.ownerBundleId === snapshot.ownerBundleId
          );
          if (current) {
            moves.push({ pid: current.ownerPID, title: current.title, from: current.frame, to: snapshot.frame });
          }
        }
        if (moves.length > 0) await this.moveWindowsBatch(moves);
        return true;
      }
    }
  }

  getHistoryCount(): number {
    return this.history.length;
  }

  clearHistory(): void {
    this.history = [];
  }


  // --------------------------------------------------------------------------
  // Layout calculations
  // --------------------------------------------------------------------------

  /**
   * Calculate the target frame for a single-window action.
   * The screen parameter is the screen the window is currently on.
   */
  private calculateSingleWindowFrame(action: SquaresAction, windowFrame: WindowFrame, screenInfo: ScreenInfo): WindowFrame {
    const s = screenInfo.visibleFrame;

    switch (action) {
      // Halves
      case 'leftHalf':
        return { x: s.x, y: s.y, width: Math.floor(s.width / 2), height: s.height };
      case 'rightHalf':
        return { x: s.x + Math.floor(s.width / 2), y: s.y, width: Math.ceil(s.width / 2), height: s.height };
      case 'topHalf':
        return { x: s.x, y: s.y, width: s.width, height: Math.floor(s.height / 2) };
      case 'bottomHalf':
        return { x: s.x, y: s.y + Math.floor(s.height / 2), width: s.width, height: Math.ceil(s.height / 2) };

      // Quarters
      case 'topLeft':
        return { x: s.x, y: s.y, width: Math.floor(s.width / 2), height: Math.floor(s.height / 2) };
      case 'topRight':
        return { x: s.x + Math.floor(s.width / 2), y: s.y, width: Math.ceil(s.width / 2), height: Math.floor(s.height / 2) };
      case 'bottomLeft':
        return { x: s.x, y: s.y + Math.floor(s.height / 2), width: Math.floor(s.width / 2), height: Math.ceil(s.height / 2) };
      case 'bottomRight':
        return { x: s.x + Math.floor(s.width / 2), y: s.y + Math.floor(s.height / 2), width: Math.ceil(s.width / 2), height: Math.ceil(s.height / 2) };

      // Thirds
      case 'firstThird':
        return { x: s.x, y: s.y, width: Math.floor(s.width / 3), height: s.height };
      case 'centerThird':
        return { x: s.x + Math.floor(s.width / 3), y: s.y, width: Math.floor(s.width / 3), height: s.height };
      case 'lastThird':
        return { x: s.x + Math.floor(s.width * 2 / 3), y: s.y, width: Math.ceil(s.width / 3), height: s.height };
      case 'firstTwoThirds':
        return { x: s.x, y: s.y, width: Math.floor(s.width * 2 / 3), height: s.height };
      case 'lastTwoThirds':
        return { x: s.x + Math.floor(s.width / 3), y: s.y, width: Math.ceil(s.width * 2 / 3), height: s.height };

      // Standard
      case 'maximize':
        return { x: s.x, y: s.y, width: s.width, height: s.height };
      case 'almostMaximize': {
        // 90% of screen, centered.
        const margin = Math.floor(s.width * 0.05);
        const marginY = Math.floor(s.height * 0.05);
        return {
          x: s.x + margin,
          y: s.y + marginY,
          width: s.width - margin * 2,
          height: s.height - marginY * 2,
        };
      }
      case 'center': {
        // Keep current size, center on screen.
        const cx = s.x + Math.floor((s.width - windowFrame.width) / 2);
        const cy = s.y + Math.floor((s.height - windowFrame.height) / 2);
        return { x: cx, y: cy, width: windowFrame.width, height: windowFrame.height };
      }

      default:
        return windowFrame;
    }
  }

  /**
   * Calculate grid layout for multiple windows.
   * Distributes windows into rows and columns with gaps.
   */
  private calculateGridLayout(windows: WindowInfo[], screenInfo: ScreenInfo): WindowFrame[] {
    const s = screenInfo.visibleFrame;
    const gap = this.config.gapSize;
    const count = windows.length;

    if (count === 0) return [];
    if (count === 1) return [{ x: s.x, y: s.y, width: s.width, height: s.height }];

    // Calculate optimal grid dimensions.
    // Prefer landscape-oriented grids (more columns than rows).
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const cellWidth = Math.floor((s.width - gap * (cols + 1)) / cols);
    const cellHeight = Math.floor((s.height - gap * (rows + 1)) / rows);

    const frames: WindowFrame[] = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      // For the last row, if it's not full, center the windows.
      const lastRowCount = count - (rows - 1) * cols;
      const isLastRow = row === rows - 1;
      const colsInRow = isLastRow ? lastRowCount : cols;
      const actualCol = isLastRow ? i - (rows - 1) * cols : col;

      // Center last row if it has fewer items.
      const rowOffset = isLastRow
        ? Math.floor((s.width - (colsInRow * (cellWidth + gap) - gap)) / 2)
        : gap;

      frames.push({
        x: s.x + rowOffset + actualCol * (cellWidth + gap),
        y: s.y + gap + row * (cellHeight + gap),
        width: cellWidth,
        height: cellHeight,
      });
    }

    return frames;
  }

  /**
   * Calculate horizontal spread layout for an app's windows.
   * Arranges windows side-by-side, preserving each window's current height
   * and vertically centering them on screen.
   */
  private calculateHorizontalSpread(windows: WindowInfo[], screenInfo: ScreenInfo): WindowFrame[] {
    const s = screenInfo.visibleFrame;
    const gap = this.config.gapSize;
    const count = windows.length;

    if (count === 0) return [];
    if (count === 1) {
      const w = windows[0];
      return [{ x: s.x, y: s.y + Math.round((s.height - w.frame.height) / 2), width: s.width, height: w.frame.height }];
    }

    const windowWidth = Math.floor((s.width - gap * (count + 1)) / count);

    return windows.map((w, i) => ({
      x: s.x + gap + i * (windowWidth + gap),
      y: s.y + Math.round((s.height - w.frame.height) / 2),
      width: windowWidth,
      height: w.frame.height,
    }));
  }

  /**
   * Calculate vertical spread layout for an app's windows.
   * Stacks windows vertically, keeping their current width.
   */
  private calculateVerticalSpread(windows: WindowInfo[], screenInfo: ScreenInfo): WindowFrame[] {
    const s = screenInfo.visibleFrame;
    const gap = this.config.gapSize;
    const count = windows.length;

    if (count === 0) return [];
    if (count === 1) return [{ x: s.x, y: s.y, width: s.width, height: s.height }];

    const windowHeight = Math.floor((s.height - gap * (count + 1)) / count);

    return windows.map((_, i) => ({
      x: s.x,
      y: s.y + gap + i * (windowHeight + gap),
      width: s.width,
      height: windowHeight,
    }));
  }

  /**
   * Calculate cascade layout - windows offset diagonally.
   */
  private calculateCascade(windows: WindowInfo[], screenInfo: ScreenInfo): WindowFrame[] {
    const s = screenInfo.visibleFrame;
    const count = windows.length;
    const cascadeOffset = 30;

    // Each window is ~70% of screen size, offset by cascadeOffset pixels.
    const winWidth = Math.floor(s.width * 0.7);
    const winHeight = Math.floor(s.height * 0.7);

    return windows.map((_, i) => ({
      x: s.x + i * cascadeOffset,
      y: s.y + i * cascadeOffset,
      width: winWidth,
      height: winHeight,
    }));
  }


  // --------------------------------------------------------------------------
  // Action execution - the main entry point
  // --------------------------------------------------------------------------

  /**
   * Execute a Squares action.
   * This is the main public API - called by hotkeys and voice commands.
   */
  async executeAction(action: SquaresAction): Promise<boolean> {
    if (!this.config.enabled) {
      log.info('Squares is disabled');
      return false;
    }

    // Prevent concurrent operations from interleaving.
    if (this.animating) {
      log.info('Operation already in progress, skipping');
      return false;
    }

    this.animating = true;
    try {
      let success = false;

      switch (action) {
        case 'restore':
          success = await this.restoreLastState();
          break;

        case 'grid':
          success = await this.executeGridAction();
          break;

        case 'focus':
          success = await this.executeFocusAction();
          break;

        case 'minimize':
          success = await this.executeMinimizeAction();
          break;

        case 'hide':
          success = await this.executeHideAction();
          break;

        case 'showAll':
          success = await this.executeShowAllAction();
          break;

        case 'fullScreen':
          success = await this.executeFullScreenAction();
          break;

        case 'exitFullScreen':
          success = await this.executeExitFullScreenAction();
          break;

        case 'horizontalSpread':
          success = await this.executeSpreadAction('horizontal');
          break;

        case 'verticalSpread':
          success = await this.executeSpreadAction('vertical');
          break;

        case 'cascade':
          success = await this.executeCascadeAction();
          break;

        default:
          success = await this.executeSingleWindowAction(action);
          break;
      }

      if (success) {
        this.emit('actionExecuted', action);
      }

      return success;
    } catch (err) {
      log.error(`Error executing action ${action}:`, err);
      return false;
    } finally {
      this.animating = false;
    }
  }

  /**
   * Execute a single-window action (halves, quarters, thirds, maximize, center).
   */
  private async executeSingleWindowAction(action: SquaresAction): Promise<boolean> {
    let frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) {
      // Retry once — JXA/AppleScript can transiently fail under load
      await new Promise(r => setTimeout(r, 100));
      frontWindow = await this.getFrontmostWindow();
    }
    if (!frontWindow) {
      log.info('No frontmost window found (after retry)');
      return false;
    }

    const targetScreen = this.getScreenForWindow(frontWindow.frame);
    const targetFrame = this.calculateSingleWindowFrame(action, frontWindow.frame, targetScreen);

    // Save state for undo.
    this.saveHistory([frontWindow]);

    // Move the window.
    await this.moveWindow(frontWindow.ownerPID, frontWindow.title, frontWindow.frame, targetFrame);
    return true;
  }

  /**
   * Execute grid action - tile the current app's windows into a grid.
   */
  private async executeGridAction(): Promise<boolean> {
    const windows = await this.getFrontmostAppWindows();
    if (windows.length === 0) return false;

    const targetScreen = this.getTargetScreenForAppWindows(windows);

    // Save state for undo.
    this.saveHistory(windows);

    // Calculate grid positions.
    const targetFrames = this.calculateGridLayout(windows, targetScreen);

    // Build move commands.
    const moves = windows.map((w, i) => ({
      pid: w.ownerPID,
      title: w.title,
      from: w.frame,
      to: targetFrames[i],
    }));

    await this.moveWindowsBatch(moves);
    return true;
  }

  /**
   * Execute focus action - hide all windows except frontmost, center it.
   */
  private async executeFocusAction(): Promise<boolean> {
    const allWindows = await this.getWindows();
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) return false;

    // Save ALL windows for undo (so we can unhide + unminimize them).
    this.saveHistory(allWindows, 'focus');

    // Hide all other apps.
    await this.hideOtherApps(frontWindow.ownerPID);

    // Hide other windows of the same app (keep only the frontmost).
    // Move them off-screen via AX API — works on all windows including terminals
    // that don't expose the miniaturized property. Undo restores their saved positions.
    const appWindows = await this.getFrontmostAppWindows();
    const otherWindows = appWindows.filter(w => w.windowId !== frontWindow.windowId);
    if (otherWindows.length > 0) {
      const offScreenMoves = otherWindows.map(w => ({
        pid: w.ownerPID,
        title: w.title,
        from: w.frame,
        to: { x: -30000, y: -30000, width: w.frame.width, height: w.frame.height },
      }));
      await this.moveWindowsBatch(offScreenMoves);
      log.info('Focus: moved %d same-app windows off-screen', otherWindows.length);
    }

    // Expand to 80% screen height, center both axes, keep current width.
    const targetScreen = this.getScreenForWindow(frontWindow.frame);
    const s = targetScreen.visibleFrame;
    const focusHeight = Math.floor(s.height * 0.8);
    const focusFrame: WindowFrame = {
      x: s.x + Math.floor((s.width - frontWindow.frame.width) / 2),
      y: s.y + Math.floor((s.height - focusHeight) / 2),
      width: frontWindow.frame.width,
      height: focusHeight,
    };

    await this.moveWindow(frontWindow.ownerPID, frontWindow.title, frontWindow.frame, focusFrame);
    return true;
  }

  /**
   * Minimize the frontmost window. Undoable via restore.
   */
  private async executeMinimizeAction(): Promise<boolean> {
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) return false;

    this.saveHistory([frontWindow], 'minimize');

    try {
      const script = `
        tell application "System Events"
          set targetProc to first process whose unix id is ${frontWindow.ownerPID}
          set miniaturized of window 1 of targetProc to true
        end tell
      `;
      await runAppleScript(script);
    } catch {
      // Some windows (e.g. terminals) don't expose the miniaturized property — fall back to Cmd+M
      try {
        await runAppleScript('tell application "System Events" to keystroke "m" using command down');
      } catch (err) {
        log.error('Failed to minimize window:', err);
        return false;
      }
    }

    return true;
  }

  /**
   * Hide the frontmost app. Undoable via restore.
   */
  private async executeHideAction(): Promise<boolean> {
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) return false;

    this.saveHistory([frontWindow], 'hide');

    try {
      const script = `
        tell application "System Events"
          set targetProc to first process whose unix id is ${frontWindow.ownerPID}
          set visible of targetProc to false
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to hide app:', err);
      return false;
    }

    return true;
  }

  /**
   * Execute horizontal or vertical spread for the current app's windows.
   */
  private async executeSpreadAction(direction: 'horizontal' | 'vertical'): Promise<boolean> {
    const appWindows = await this.getFrontmostAppWindows();
    if (appWindows.length === 0) return false;

    const targetScreen = this.getTargetScreenForAppWindows(appWindows);

    this.saveHistory(appWindows);

    const targetFrames = direction === 'horizontal'
      ? this.calculateHorizontalSpread(appWindows, targetScreen)
      : this.calculateVerticalSpread(appWindows, targetScreen);

    const moves = appWindows.map((w, i) => ({
      pid: w.ownerPID,
      title: w.title,
      from: w.frame,
      to: targetFrames[i],
    }));

    await this.moveWindowsBatch(moves);
    return true;
  }

  /**
   * Execute cascade layout for the current app's windows.
   */
  private async executeCascadeAction(): Promise<boolean> {
    const appWindows = await this.getFrontmostAppWindows();
    if (appWindows.length === 0) return false;

    const targetScreen = this.getTargetScreenForAppWindows(appWindows);

    this.saveHistory(appWindows);

    const targetFrames = this.calculateCascade(appWindows, targetScreen);
    const moves = appWindows.map((w, i) => ({
      pid: w.ownerPID,
      title: w.title,
      from: w.frame,
      to: targetFrames[i],
    }));

    await this.moveWindowsBatch(moves);
    return true;
  }


  /**
   * Show all windows of the frontmost app (unminimize) and arrange in grid.
   * Useful after "focus" or manual minimizing to get everything back.
   */
  private async executeShowAllAction(): Promise<boolean> {
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) return false;

    // Save current visible windows for undo before we unminimize
    const currentAppWindows = await this.getFrontmostAppWindows();
    this.saveHistory(currentAppWindows.length > 0 ? currentAppWindows : [frontWindow]);

    // Unminimize all windows of this app
    try {
      const script = `
        tell application "System Events"
          set targetProc to first process whose unix id is ${frontWindow.ownerPID}
          repeat with w in windows of targetProc
            try
              if miniaturized of w then set miniaturized of w to false
            end try
          end repeat
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to unminimize windows:', err);
    }

    // Brief wait for windows to appear
    await new Promise(r => setTimeout(r, 200));

    // Re-fetch windows and arrange in grid
    const allAppWindows = await this.getFrontmostAppWindows();
    if (allAppWindows.length === 0) return true;

    const targetScreen = this.getScreenForWindow(frontWindow.frame);
    const targetFrames = this.calculateGridLayout(allAppWindows, targetScreen);
    const moves = allAppWindows.map((w, i) => ({
      pid: w.ownerPID,
      title: w.title,
      from: w.frame,
      to: targetFrames[i],
    }));

    await this.moveWindowsBatch(moves);
    return true;
  }

  /**
   * Toggle native macOS full screen for the frontmost window.
   */
  private async executeFullScreenAction(): Promise<boolean> {
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) return false;

    this.saveHistory([frontWindow], 'fullScreen');

    try {
      const script = `
        tell application "System Events"
          set targetProc to first process whose unix id is ${frontWindow.ownerPID}
          set value of attribute "AXFullScreen" of window 1 of targetProc to true
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to enter full screen:', err);
      return false;
    }

    return true;
  }

  /**
   * Exit native macOS full screen for the frontmost window.
   * No history saved — this is a one-way exit, not undoable.
   */
  private async executeExitFullScreenAction(): Promise<boolean> {
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) return false;

    try {
      // Try AXFullScreen attribute first, then fall back to Ctrl+Cmd+F
      const script = `
        tell application "System Events"
          set targetProc to first process whose unix id is ${frontWindow.ownerPID}
          try
            set isFS to value of attribute "AXFullScreen" of window 1 of targetProc
            if isFS then
              set value of attribute "AXFullScreen" of window 1 of targetProc to false
              return
            end if
          end try
          -- AXFullScreen didn't work or wasn't true — use keyboard shortcut
          keystroke "f" using {control down, command down}
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to exit full screen:', err);
      return false;
    }

    return true;
  }


  // --------------------------------------------------------------------------
  // Voice command integration
  // --------------------------------------------------------------------------

  private resolveVoiceAction(actionName: string): SquaresAction | null {
    if (VALID_SQUARES_VOICE_ACTIONS.has(actionName as SquaresAction)) {
      return actionName as SquaresAction;
    }
    return LEGACY_WINDOW_COMMAND_ACTIONS[actionName] ?? null;
  }

  private getVoiceCommandTriggers(): Record<string, SquaresAction> {
    const saved = this.preferences.getPreference('hotMicRectangleCommands') ?? {};
    const merged: Record<string, string> = {
      ...HOT_MIC_DEFAULT_WINDOW_COMMANDS,
      ...saved,
    };

    const focusOverride = this.preferences.getPreference('hotMicFocusPhrases');
    if (typeof focusOverride === 'string' && focusOverride.trim()) {
      merged.focus = focusOverride;
    }
    const cascadeOverride = this.preferences.getPreference('hotMicCascadePhrases');
    if (typeof cascadeOverride === 'string' && cascadeOverride.trim()) {
      merged.cascade = cascadeOverride;
    }

    const triggers: Record<string, SquaresAction> = {};
    for (const [actionName, csv] of Object.entries(merged)) {
      const action = this.resolveVoiceAction(actionName);
      if (!action || typeof csv !== 'string') continue;
      const phrases = csv.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
      for (const phrase of phrases) {
        triggers[phrase] = action;
      }
    }

    return triggers;
  }

  /**
   * Parse transcribed text for Squares voice commands.
   * Returns the action if a command phrase is found, null otherwise.
   * Uses exact phrase matching for deterministic behavior.
   */
  parseVoiceCommand(text: string, exactOnly = false): SquaresAction | null {
    const normalized = text.toLowerCase().trim();
    const voiceTriggers = this.getVoiceCommandTriggers();

    // Check longest phrases first to avoid partial matches.
    // e.g., "tile all" should match before "tile".
    const sortedTriggers = Object.entries(voiceTriggers)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [phrase, action] of sortedTriggers) {
      if (exactOnly) {
        if (normalized === phrase) return action;
      } else {
        if (normalized === phrase || normalized.startsWith(phrase + ' ') || normalized.endsWith(' ' + phrase)) {
          return action;
        }
      }
    }

    return null;
  }

  /**
   * Check if text contains a Squares voice command and execute it.
   * Returns true if a command was found and executed.
   * This is the integration point for TranscriberManager.
   */
  async handleVoiceCommand(text: string): Promise<boolean> {
    const action = this.parseVoiceCommand(text);
    if (!action) return false;

    log.info(`Voice command detected: "${text}" -> ${action}`);
    return await this.executeAction(action);
  }

  /**
   * Exact-match voice command — only triggers if the text IS the command.
   * Used by Hot Mic where each chunk is a short utterance and partial
   * matching on multi-sentence chunks causes false triggers.
   */
  async handleExactVoiceCommand(text: string): Promise<boolean> {
    const action = this.parseVoiceCommand(text, true);
    if (!action) return false;

    log.info(`Exact voice command detected: "${text}" -> ${action}`);
    return await this.executeAction(action);
  }

  /**
   * Check if text **ends with** a Squares trigger phrase.
   * Returns the matched action and the remaining text (everything before the command).
   * Checks longest phrases first to avoid partial matches (e.g. "tile all" before "tile").
   */
  parseVoiceCommandFromTail(text: string): { action: SquaresAction; remainingText: string } | null {
    const normalized = text.toLowerCase().trim();
    const voiceTriggers = this.getVoiceCommandTriggers();

    // Sort by phrase length descending — longest first to avoid partial matches
    const sortedTriggers = Object.entries(voiceTriggers)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [phrase, action] of sortedTriggers) {
      if (normalized === phrase) {
        return { action, remainingText: '' };
      }
      if (normalized.endsWith(' ' + phrase)) {
        const remainingText = normalized.slice(0, -(phrase.length + 1)).trim();
        return { action, remainingText };
      }
    }

    return null;
  }
}
