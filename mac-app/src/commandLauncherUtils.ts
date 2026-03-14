// =============================================================================
// Hotkey Formatting
// =============================================================================

export function formatHotkeyDisplay(hotkey: string): string {
  if (!hotkey) return '';
  return hotkey
    .replace(/Command/g, '⌘')
    .replace(/Cmd/g, '⌘')
    .replace(/Shift/g, '⇧')
    .replace(/Option/g, '⌥')
    .replace(/Alt/g, '⌥')
    .replace(/Control/g, '⌃')
    .replace(/Ctrl/g, '⌃')
    .replace(/\+/g, ' ')
    .replace(/\\/g, '\\');
}

// =============================================================================
// Time Formatting
// =============================================================================

export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// =============================================================================
// Squares Action Definitions
// =============================================================================

export const SQUARES_ACTION_DEFS = [
  { actionId: 'grid', name: 'grid windows', displayName: 'Grid Windows', keywords: ['grid', 'tile', 'arrange'] },
  { actionId: 'focus', name: 'focus mode', displayName: 'Focus Mode', keywords: ['focus', 'hide others', 'distraction'] },
  { actionId: 'horizontalSpread', name: 'horizontal', displayName: 'Horizontal', keywords: ['horizontal', 'side by side', 'split'] },
  { actionId: 'verticalSpread', name: 'stack windows', displayName: 'Stack Windows', keywords: ['vertical', 'stack', 'top bottom'] },
  { actionId: 'cascade', name: 'cascade windows', displayName: 'Cascade Windows', keywords: ['cascade', 'overlap', 'stagger'] },
  { actionId: 'leftHalf', name: 'snap left', displayName: 'Snap Left', keywords: ['snap left', 'half', 'split'] },
  { actionId: 'rightHalf', name: 'snap right', displayName: 'Snap Right', keywords: ['snap right', 'half', 'split'] },
  { actionId: 'maximize', name: 'maximize window', displayName: 'Maximize Window', keywords: ['maximize', 'full', 'fill'] },
  { actionId: 'center', name: 'center window', displayName: 'Center Window', keywords: ['center', 'middle'] },
  { actionId: 'restore', name: 'restore window', displayName: 'Restore Window', keywords: ['restore', 'undo', 'previous'] },
] as const;

export const SQUARES_ACTION_IDS: Set<string> = new Set(SQUARES_ACTION_DEFS.map(d => d.actionId));

export const DEFAULT_SQUARES_HOTKEYS: Record<string, string> = {
  grid: 'Control+Alt+Shift+G',
  focus: 'Control+Alt+Shift+F',
  horizontalSpread: 'Control+Alt+Shift+H',
  verticalSpread: 'Control+Alt+Shift+V',
  cascade: 'Control+Alt+Shift+C',
  leftHalf: 'Control+Alt+Left',
  rightHalf: 'Control+Alt+Right',
  maximize: 'Control+Alt+Return',
  center: 'Control+Alt+C',
  restore: 'Control+Alt+Backspace',
};
