// =============================================================================
// Squares - Window Management Types
// Rectangle-inspired window management with instant snap.
// Named "Squares" as Field Theory's take on Rectangle-style window snapping.
// =============================================================================

/**
 * A rectangle on screen: position + size.
 * All values in screen coordinates (pixels).
 */
export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Info about a single macOS window.
 * Includes enough to identify it and move it around.
 */
export interface WindowInfo {
  windowId: number;           // macOS CGWindowID
  ownerName: string;          // App name (e.g., "Safari")
  ownerPID: number;           // Process ID
  ownerBundleId: string;      // Bundle ID (e.g., "com.apple.Safari")
  title: string;              // Window title
  frame: WindowFrame;         // Current position and size
  isOnScreen: boolean;        // Whether window is visible on any screen
  layer: number;              // Window layer (0 = normal)
}

/**
 * Screen (display) info, including the usable area.
 * visibleFrame excludes the menu bar and dock.
 */
export interface ScreenInfo {
  id: number;
  frame: WindowFrame;          // Full screen bounds
  visibleFrame: WindowFrame;   // Usable area (no menu bar, no dock)
  isPrimary: boolean;
}

/**
 * Saved position for undo/history.
 * We save both the window identity and its frame so we can restore it.
 */
export interface WindowSnapshot {
  windowId: number;
  ownerPID: number;
  ownerBundleId: string;
  title: string;
  frame: WindowFrame;
  timestamp: number;
  actionType?: 'move' | 'focus' | 'minimize' | 'hide' | 'fullScreen';
}

/**
 * All the layout actions Squares supports.
 * Organized from basic (halves) to advanced (grid, focus).
 *
 * Rectangle-compatible defaults:
 * - leftHalf, rightHalf, topHalf, bottomHalf
 * - topLeft, topRight, bottomLeft, bottomRight (quarters)
 * - firstThird, centerThird, lastThird (thirds)
 * - firstTwoThirds, lastTwoThirds
 * - maximize, almostMaximize, center
 * - restore (undo last action)
 *
 * Squares-exclusive actions (the fun stuff):
 * - grid: tile ALL visible windows into a grid
 * - focus: hide all windows except the frontmost, center it
 * - horizontalSpread: arrange current app's windows side-by-side horizontally
 * - verticalSpread: arrange current app's windows stacked vertically
 * - cascade: cascade windows diagonally
 */
export type SquaresAction =
  // Halves
  | 'leftHalf'
  | 'rightHalf'
  | 'topHalf'
  | 'bottomHalf'
  // Quarters
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  // Thirds
  | 'firstThird'
  | 'centerThird'
  | 'lastThird'
  | 'firstTwoThirds'
  | 'lastTwoThirds'
  // Standard
  | 'maximize'
  | 'almostMaximize'
  | 'center'
  | 'restore'
  // Squares-exclusive multi-window actions
  | 'grid'
  | 'focus'
  | 'minimize'
  | 'hide'
  | 'showAll'
  | 'fullScreen'
  | 'exitFullScreen'
  | 'horizontalSpread'
  | 'verticalSpread'
  | 'cascade';

export type SquaresActionSource = 'default' | 'command-launcher';

/**
 * Squares configuration.
 * Stored in preferences. Sensible defaults out of the box.
 */
export interface SquaresConfig {
  enabled: boolean;
  showInCommandLauncher: boolean;   // If true, expose/allow Squares actions in portable commands launcher
  gapSize: number;                  // Gap between windows in grid/spread layouts (px)
  maxHistorySize: number;           // How many undo states to keep (default: 50)
  focusHeightPercent: number;       // % of screen height for focus action (default: 80)
  focusKeepHeight: boolean;         // If true, focus preserves current window height
  focusWidthPercent: number;        // % of screen width for focus action (default: 60)
  horizontalHeightPercent: number;  // % of screen height for horizontal spread (default: 80)
  horizontalKeepHeight: boolean;    // If true, horizontal preserves current window height
  horizontalHideOthers: boolean;    // If true, hide other apps when spreading horizontally (default: true)
}

/**
 * Default configuration - works great out of the box.
 */
export const DEFAULT_SQUARES_CONFIG: SquaresConfig = {
  enabled: true,
  showInCommandLauncher: true,
  gapSize: 8,
  maxHistorySize: 50,
  focusHeightPercent: 80,
  focusKeepHeight: false,
  focusWidthPercent: 60,
  horizontalHeightPercent: 80,
  horizontalKeepHeight: true,
  horizontalHideOthers: true,
};

/**
 * Keyboard shortcut definitions for Squares actions.
 * Uses Control+Option as the modifier to avoid conflicts with
 * Field Theory's existing hotkeys (which use Command+Shift and Alt/Option).
 *
 * These mirror Rectangle's defaults but use Control+Option instead of
 * Control+Command to avoid system conflicts.
 */
export interface SquaresHotkeys {
  leftHalf: string;
  rightHalf: string;
  topHalf: string;
  bottomHalf: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  firstThird: string;
  centerThird: string;
  lastThird: string;
  firstTwoThirds: string;
  lastTwoThirds: string;
  maximize: string;
  almostMaximize: string;
  center: string;
  restore: string;
  // Multi-window actions (Squares-exclusive)
  grid: string;
  focus: string;
  horizontalSpread: string;
  verticalSpread: string;
  cascade: string;
}

/**
 * Default hotkeys - Control+Option modifier to stay out of Field Theory's way.
 * Rectangle uses Control+Option for many of these, so muscle memory transfers.
 */
export const DEFAULT_SQUARES_HOTKEYS: SquaresHotkeys = {
  // Halves: Control+Option + arrow keys
  leftHalf: 'Control+Alt+Left',
  rightHalf: 'Control+Alt+Right',
  topHalf: 'Control+Alt+Up',
  bottomHalf: 'Control+Alt+Down',
  // Quarters: Control+Option+Shift + keys
  topLeft: 'Control+Alt+U',
  topRight: 'Control+Alt+I',
  bottomLeft: 'Control+Alt+J',
  bottomRight: 'Control+Alt+K',
  // Thirds: Control+Option + D/F/G
  firstThird: 'Control+Alt+D',
  centerThird: 'Control+Alt+F',
  lastThird: 'Control+Alt+G',
  firstTwoThirds: 'Control+Alt+E',
  lastTwoThirds: 'Control+Alt+T',
  // Standard
  maximize: 'Control+Alt+Return',
  almostMaximize: 'Control+Alt+Shift+Return',
  center: 'Control+Alt+C',
  restore: 'Control+Alt+Backspace',
  // Multi-window (Squares-exclusive)
  grid: 'Control+Alt+Shift+G',
  focus: 'Control+Alt+Shift+F',
  horizontalSpread: 'Control+Alt+Shift+H',
  verticalSpread: 'Control+Alt+Shift+V',
  cascade: 'Control+Alt+Shift+C',
};

/**
 * IPC channel names for Squares.
 * Follows the existing domain:action convention.
 */
export const SquaresIPCChannels = {
  // Actions
  EXECUTE_ACTION: 'squares:executeAction',
  GET_WINDOWS: 'squares:getWindows',
  GET_SCREENS: 'squares:getScreens',

  // Configuration
  GET_CONFIG: 'squares:getConfig',
  SET_CONFIG: 'squares:setConfig',
  GET_HOTKEYS: 'squares:getHotkeys',
  SET_HOTKEYS: 'squares:setHotkeys',
  RESET_HOTKEYS: 'squares:resetHotkeys',

  // State
  GET_HISTORY_COUNT: 'squares:getHistoryCount',
  CLEAR_HISTORY: 'squares:clearHistory',

  // Events (sent from main to renderer)
  ACTION_EXECUTED: 'squares:actionExecuted',
  CONFIG_CHANGED: 'squares:configChanged',
} as const;

/**
 * Voice command triggers for hot mic integration.
 * Maps spoken phrases to Squares actions.
 * Deterministic parsing - exact phrase matching.
 */
export const VOICE_COMMAND_TRIGGERS: Record<string, SquaresAction> = {
  // Grid/Tile
  'grid': 'grid',
  'tile': 'grid',
  'tile all': 'grid',
  'grid all': 'grid',
  'show all': 'showAll',
  'show all windows': 'showAll',
  'show windows': 'showAll',

  // Focus
  'focus': 'focus',
  'focus mode': 'focus',
  'center focus': 'focus',
  'hide others': 'focus',
  'hide other windows': 'focus',

  // Horizontal
  'horizontal': 'horizontalSpread',
  'spread horizontal': 'horizontalSpread',
  'side by side': 'horizontalSpread',

  // Vertical
  'vertical': 'verticalSpread',
  'spread vertical': 'verticalSpread',
  'stack windows': 'verticalSpread',

  // Cascade
  'cascade': 'cascade',
  'cascade windows': 'cascade',

  // Halves
  'snap left': 'leftHalf',
  'snap right': 'rightHalf',

  // Quarters
  'top left corner': 'topLeft',
  'top right corner': 'topRight',
  'bottom left corner': 'bottomLeft',
  'bottom right corner': 'bottomRight',

  // Standard
  'maximize': 'maximize',
  'full screen': 'fullScreen',
  'fullscreen': 'fullScreen',
  'enter full screen': 'fullScreen',
  'exit full screen': 'exitFullScreen',
  'leave full screen': 'exitFullScreen',
  'center': 'center',
  'center window': 'center',
  'restore': 'restore',
};
