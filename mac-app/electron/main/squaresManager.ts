// =============================================================================
// SquaresManager - Window Management Engine
// Rectangle-inspired window management with smooth animations for Field Theory.
// Uses AppleScript + JXA for window manipulation on macOS.
// =============================================================================

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { screen, globalShortcut, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { PreferencesManager } from './preferences';
import { createLogger } from './logger';
import {
  WindowFrame,
  WindowInfo,
  ScreenInfo,
  WindowSnapshot,
  SquaresAction,
  SquaresConfig,
  SquaresHotkeys,
  AnimationStyle,
  DEFAULT_SQUARES_CONFIG,
  DEFAULT_SQUARES_HOTKEYS,
  VOICE_COMMAND_TRIGGERS,
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


// ============================================================================
// AppleScript helpers for window manipulation
// ============================================================================

/**
 * Run an AppleScript command with a timeout.
 * Returns stdout trimmed. Throws on error or timeout.
 */
async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execAsync(
    `osascript -e '${script.replace(/'/g, "'\\''")}'`,
    { timeout: APPLESCRIPT_TIMEOUT_MS }
  );
  return stdout.trim();
}

/**
 * Run a JXA (JavaScript for Automation) script.
 * Uses a temp file to avoid shell quoting issues with complex JS.
 */
async function runJXA(script: string): Promise<string> {
  const tmpDir = app.getPath('temp');
  const tmpFile = path.join(tmpDir, `squares-jxa-${Date.now()}.js`);

  try {
    fs.writeFileSync(tmpFile, script, 'utf-8');
    const { stdout } = await execAsync(
      `osascript -l JavaScript "${tmpFile}"`,
      { timeout: APPLESCRIPT_TIMEOUT_MS }
    );
    return stdout.trim();
  } finally {
    // Clean up temp file.
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}


// ============================================================================
// Animation engine - interpolates window positions smoothly
// ============================================================================

/**
 * Easing functions for window animations.
 * easeOutCubic gives a snappy deceleration feel.
 * easeOutBack gives a slight overshoot then settle (Jarvis feel).
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Pick the easing function based on animation style.
 */
function getEasingFunction(style: AnimationStyle): (t: number) => number {
  switch (style) {
    case 'snappy': return easeOutBack;
    case 'smooth': return easeOutCubic;
    default: return (t: number) => t; // linear (shouldn't be used for 'none')
  }
}

/**
 * Interpolate between two frames using an easing function.
 * t ranges from 0 (start) to 1 (end).
 */
function interpolateFrame(from: WindowFrame, to: WindowFrame, t: number, easing: (t: number) => number): WindowFrame {
  const e = easing(t);
  return {
    x: Math.round(from.x + (to.x - from.x) * e),
    y: Math.round(from.y + (to.y - from.y) * e),
    width: Math.round(from.width + (to.width - from.width) * e),
    height: Math.round(from.height + (to.height - from.height) * e),
  };
}


// ============================================================================
// SquaresManager class
// ============================================================================

export class SquaresManager extends EventEmitter {
  private preferences: PreferencesManager;
  private config: SquaresConfig;
  private hotkeys: SquaresHotkeys;
  private registeredHotkeys: Map<string, string> = new Map(); // action -> accelerator
  private history: WindowSnapshot[][] = [];  // Stack of undo states (groups of snapshots)
  private animating = false;  // Prevent concurrent animations

  constructor(preferences: PreferencesManager) {
    super();
    this.preferences = preferences;

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
    if (!this.config.enabled) {
      log.info('Squares disabled, skipping hotkey registration');
      return;
    }

    const entries = Object.entries(this.hotkeys) as [keyof SquaresHotkeys, string][];

    for (const [action, accelerator] of entries) {
      if (!accelerator) continue;

      try {
        const success = globalShortcut.register(accelerator, () => {
          this.executeAction(action as SquaresAction);
        });

        if (success) {
          this.registeredHotkeys.set(action, accelerator);
        } else {
          log.error(`Failed to register hotkey for ${action}: "${accelerator}" - may be in use`);
        }
      } catch (err) {
        log.error(`Error registering hotkey for ${action}:`, err);
      }
    }

    log.info(`Registered ${this.registeredHotkeys.size} Squares hotkeys`);
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
   * Get all visible windows using JXA.
   * Filters out Field Theory windows and non-standard windows (menus, tooltips, etc).
   */
  async getWindows(): Promise<WindowInfo[]> {
    if (process.platform !== 'darwin') return [];

    try {
      // Use CGWindowListCopyWindowInfo via JXA for fast window enumeration.
      // This is much faster than AppleScript's "every window" approach.
      const script = `
        ObjC.import("CoreGraphics");
        ObjC.import("Foundation");
        var windows = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
        var count = $.CFArrayGetCount(windows);
        var result = [];
        for (var i = 0; i < count; i++) {
          var win = ObjC.unwrap($.CFArrayGetValueAtIndex(windows, i));
          var layer = win.kCGWindowLayer || 0;
          var owner = (win.kCGWindowOwnerName || "").toString();
          var pid = win.kCGWindowOwnerPID || 0;
          var wid = win.kCGWindowNumber || 0;
          var name = (win.kCGWindowName || "").toString();
          var bounds = win.kCGWindowBounds || {};
          if (layer === 0 && owner && bounds.Width > 50 && bounds.Height > 50) {
            result.push({
              windowId: wid,
              ownerName: owner,
              ownerPID: pid,
              title: name,
              x: bounds.X || 0,
              y: bounds.Y || 0,
              width: bounds.Width || 0,
              height: bounds.Height || 0,
              layer: layer
            });
          }
        }
        JSON.stringify(result);
      `;

      const output = await runJXA(script);
      if (!output) return [];

      const rawWindows = JSON.parse(output) as Array<{
        windowId: number;
        ownerName: string;
        ownerPID: number;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
        layer: number;
      }>;

      // Get bundle IDs for each unique PID so we can filter out Field Theory.
      const pids = [...new Set(rawWindows.map(w => w.ownerPID))];
      const pidToBundleId = await this.getPIDBundleIds(pids);

      return rawWindows
        .filter(w => {
          const bundleId = pidToBundleId.get(w.ownerPID) || '';
          return !FIELD_THEORY_BUNDLE_IDS.includes(bundleId);
        })
        .map(w => ({
          windowId: w.windowId,
          ownerName: w.ownerName,
          ownerPID: w.ownerPID,
          ownerBundleId: pidToBundleId.get(w.ownerPID) || '',
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
   * Get bundle IDs for a list of PIDs using a single JXA call.
   */
  private async getPIDBundleIds(pids: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (pids.length === 0) return result;

    try {
      const script = `
        var se = Application("System Events");
        var procs = se.processes.whose({_not: [{bundleIdentifier: ""}]})();
        var result = {};
        for (var i = 0; i < procs.length; i++) {
          try {
            var pid = procs[i].unixId();
            var bid = procs[i].bundleIdentifier();
            result[pid] = bid;
          } catch(e) {}
        }
        JSON.stringify(result);
      `;

      const output = await runJXA(script);
      if (output) {
        const parsed = JSON.parse(output) as Record<string, string>;
        for (const [pid, bundleId] of Object.entries(parsed)) {
          result.set(parseInt(pid, 10), bundleId);
        }
      }
    } catch (err) {
      log.error('Failed to get bundle IDs:', err);
    }

    return result;
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


  // --------------------------------------------------------------------------
  // Window manipulation - move and resize windows
  // --------------------------------------------------------------------------

  /**
   * Move a window to a target frame.
   * If animations are enabled, interpolates smoothly.
   * Uses System Events (AppleScript) to set window position and size.
   */
  async moveWindow(pid: number, windowTitle: string, from: WindowFrame, to: WindowFrame): Promise<void> {
    if (this.config.animationStyle === 'none') {
      await this.setWindowFrame(pid, windowTitle, to);
      return;
    }

    // Animated move: interpolate between from and to.
    const easing = getEasingFunction(this.config.animationStyle);
    const steps = this.config.animationSteps;
    const totalMs = this.config.animationDurationMs;
    const stepMs = totalMs / steps;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const frame = interpolateFrame(from, to, t, easing);
      await this.setWindowFrame(pid, windowTitle, frame);

      // Small delay between frames for visual smoothness.
      if (i < steps) {
        await new Promise(r => setTimeout(r, stepMs));
      }
    }
  }

  /**
   * Set a window's position and size in a single AppleScript call.
   * Uses System Events for reliability.
   */
  private async setWindowFrame(pid: number, windowTitle: string, frame: WindowFrame): Promise<void> {
    try {
      // Use System Events to set position and size by PID.
      // We target by PID rather than app name for reliability.
      const safeTitle = windowTitle.replace(/["\\]/g, '');
      const script = `
        tell application "System Events"
          set targetProcess to first process whose unix id is ${pid}
          repeat with w in windows of targetProcess
            try
              if name of w is "${safeTitle}" then
                set position of w to {${frame.x}, ${frame.y}}
                set size of w to {${frame.width}, ${frame.height}}
                return
              end if
            end try
          end repeat
          -- Fallback: set the first window if title didn't match
          try
            set frontWindow to window 1 of targetProcess
            set position of frontWindow to {${frame.x}, ${frame.y}}
            set size of frontWindow to {${frame.width}, ${frame.height}}
          end try
        end tell
      `;
      await runAppleScript(script);
    } catch (err) {
      // Silently fail individual frame sets during animation.
      // The next frame will correct it.
    }
  }

  /**
   * Move multiple windows simultaneously for grid/spread layouts.
   * Runs animation frames in parallel for all windows at each step.
   */
  async moveWindowsBatch(
    moves: Array<{ pid: number; title: string; from: WindowFrame; to: WindowFrame }>
  ): Promise<void> {
    if (this.config.animationStyle === 'none') {
      // No animation: set all windows at once using a single AppleScript call.
      await this.setWindowFramesBatch(moves.map(m => ({ pid: m.pid, title: m.title, frame: m.to })));
      return;
    }

    // Animated: step through frames for all windows simultaneously.
    const easing = getEasingFunction(this.config.animationStyle);
    const steps = this.config.animationSteps;
    const totalMs = this.config.animationDurationMs;
    const stepMs = totalMs / steps;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const frames = moves.map(m => ({
        pid: m.pid,
        title: m.title,
        frame: interpolateFrame(m.from, m.to, t, easing),
      }));

      await this.setWindowFramesBatch(frames);

      if (i < steps) {
        await new Promise(r => setTimeout(r, stepMs));
      }
    }
  }

  /**
   * Set frames for multiple windows in a single AppleScript call.
   * More efficient than calling setWindowFrame() for each window.
   */
  private async setWindowFramesBatch(
    windows: Array<{ pid: number; title: string; frame: WindowFrame }>
  ): Promise<void> {
    if (windows.length === 0) return;

    try {
      // Build a single AppleScript that sets all windows at once.
      const windowCommands = windows.map(w => {
        const safeTitle = w.title.replace(/["\\]/g, '');
        return `
          try
            set proc to first process whose unix id is ${w.pid}
            repeat with win in windows of proc
              try
                if name of win is "${safeTitle}" then
                  set position of win to {${w.frame.x}, ${w.frame.y}}
                  set size of win to {${w.frame.width}, ${w.frame.height}}
                  exit repeat
                end if
              end try
            end repeat
          end try
        `;
      }).join('\n');

      const script = `
        tell application "System Events"
          ${windowCommands}
        end tell
      `;

      await runAppleScript(script);
    } catch (err) {
      log.error('Failed to set window frames batch:', err);
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
   */
  private async getFrontmostWindow(): Promise<WindowInfo | null> {
    const windows = await this.getWindows();
    if (windows.length === 0) return null;

    try {
      // Get the frontmost app's PID.
      const pid = await runAppleScript(
        'tell application "System Events" to return unix id of (first process whose frontmost is true)'
      );
      const frontPID = parseInt(pid, 10);

      // Find the first window belonging to that app.
      return windows.find(w => w.ownerPID === frontPID) || windows[0];
    } catch {
      return windows[0];
    }
  }

  /**
   * Get all windows belonging to the frontmost app.
   */
  private async getFrontmostAppWindows(): Promise<WindowInfo[]> {
    const windows = await this.getWindows();
    if (windows.length === 0) return [];

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
  private saveHistory(windows: WindowInfo[]): void {
    const snapshots: WindowSnapshot[] = windows.map(w => ({
      windowId: w.windowId,
      ownerPID: w.ownerPID,
      ownerBundleId: w.ownerBundleId,
      frame: { ...w.frame },
      timestamp: Date.now(),
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

    // Show all apps first in case we're undoing a "focus" action.
    await this.showAllApps();

    // Build move commands from saved snapshots.
    const currentWindows = await this.getWindows();
    const moves: Array<{ pid: number; title: string; from: WindowFrame; to: WindowFrame }> = [];

    for (const snapshot of lastState) {
      // Find current position of this window.
      const current = currentWindows.find(
        w => w.ownerPID === snapshot.ownerPID && w.ownerBundleId === snapshot.ownerBundleId
      );
      if (current) {
        moves.push({
          pid: current.ownerPID,
          title: current.title,
          from: current.frame,
          to: snapshot.frame,
        });
      }
    }

    if (moves.length > 0) {
      await this.moveWindowsBatch(moves);
    }

    return true;
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
   * Arranges windows side-by-side, keeping their current height.
   */
  private calculateHorizontalSpread(windows: WindowInfo[], screenInfo: ScreenInfo): WindowFrame[] {
    const s = screenInfo.visibleFrame;
    const gap = this.config.gapSize;
    const count = windows.length;

    if (count === 0) return [];
    if (count === 1) return [{ x: s.x, y: s.y, width: s.width, height: s.height }];

    const windowWidth = Math.floor((s.width - gap * (count + 1)) / count);

    return windows.map((_, i) => ({
      x: s.x + gap + i * (windowWidth + gap),
      y: s.y,
      width: windowWidth,
      height: s.height,
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

    // Prevent concurrent animations from creating chaos.
    if (this.animating) {
      log.info('Animation already in progress, skipping');
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
    const frontWindow = await this.getFrontmostWindow();
    if (!frontWindow) {
      log.info('No frontmost window found');
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
   * Execute grid action - tile all visible windows.
   */
  private async executeGridAction(): Promise<boolean> {
    const windows = await this.getWindows();
    if (windows.length === 0) return false;

    // Use the primary screen for grid layout.
    const screens = this.getScreens();
    const primaryScreen = screens.find(s => s.isPrimary) || screens[0];

    // Save state for undo.
    this.saveHistory(windows);

    // Calculate grid positions.
    const targetFrames = this.calculateGridLayout(windows, primaryScreen);

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

    // Save ALL windows for undo (so we can unhide them).
    this.saveHistory(allWindows);

    // Hide all other apps.
    await this.hideOtherApps(frontWindow.ownerPID);

    // Center the focused window on its screen.
    const targetScreen = this.getScreenForWindow(frontWindow.frame);
    const centerFrame = this.calculateSingleWindowFrame('center', frontWindow.frame, targetScreen);

    await this.moveWindow(frontWindow.ownerPID, frontWindow.title, frontWindow.frame, centerFrame);
    return true;
  }

  /**
   * Execute horizontal or vertical spread for the current app's windows.
   */
  private async executeSpreadAction(direction: 'horizontal' | 'vertical'): Promise<boolean> {
    const appWindows = await this.getFrontmostAppWindows();
    if (appWindows.length === 0) return false;

    const primaryScreen = this.getScreens().find(s => s.isPrimary) || this.getScreens()[0];

    this.saveHistory(appWindows);

    const targetFrames = direction === 'horizontal'
      ? this.calculateHorizontalSpread(appWindows, primaryScreen)
      : this.calculateVerticalSpread(appWindows, primaryScreen);

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

    const primaryScreen = this.getScreens().find(s => s.isPrimary) || this.getScreens()[0];

    this.saveHistory(appWindows);

    const targetFrames = this.calculateCascade(appWindows, primaryScreen);
    const moves = appWindows.map((w, i) => ({
      pid: w.ownerPID,
      title: w.title,
      from: w.frame,
      to: targetFrames[i],
    }));

    await this.moveWindowsBatch(moves);
    return true;
  }


  // --------------------------------------------------------------------------
  // Voice command integration
  // --------------------------------------------------------------------------

  /**
   * Parse transcribed text for Squares voice commands.
   * Returns the action if a command phrase is found, null otherwise.
   * Uses exact phrase matching for deterministic behavior.
   */
  parseVoiceCommand(text: string): SquaresAction | null {
    const normalized = text.toLowerCase().trim();

    // Check longest phrases first to avoid partial matches.
    // e.g., "tile all" should match before "tile".
    const sortedTriggers = Object.entries(VOICE_COMMAND_TRIGGERS)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [phrase, action] of sortedTriggers) {
      if (normalized === phrase || normalized.startsWith(phrase + ' ') || normalized.endsWith(' ' + phrase)) {
        return action;
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
}
