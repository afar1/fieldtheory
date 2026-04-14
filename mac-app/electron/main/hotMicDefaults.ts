/**
 * Shared Hot Mic default phrases.
 * These defaults are used when the user has not customized phrase settings.
 */

export const HOT_MIC_DEFAULTS = {
  submitPhrases: 'go ahead, send it, submit, do it',
  pastePhrases: 'paste, paste it, transcribe',
  cancelPhrases: 'stop, abort',
  scrapPhrases: 'scrap, scrap that',
  newWindowPhrases: 'new window',
  closeWindowPhrases: 'close window, close the window, close this window',
  minimizePhrases: 'minimize, minimize window, minimize the window',
  hidePhrases: 'hide, hide app, hide this app, hide the app',
  quitPhrases: 'quit app, quit this app',
  switchWindowPhrases: 'next window, switch',
  prevWindowPhrases: 'previous window',
  runClaudePhrases: 'start claude, start cloud, run claude, start clod',
  runCodexPhrases: 'start codex, run codex',
  restartServerPhrases: 'restart server, restart dev, restart dev server',
  appOpenPrefixes: 'open, switch to, go to',
  appQuitPrefixes: 'quit, close, kill',
} as const;

export const HOT_MIC_DEFAULT_SYSTEM_COMMANDS = {
  'play-pause': 'play, pause, play pause, play music, pause music',
  'next-track': 'next track, next song, skip song',
  'previous-track': 'previous track, previous song, go back a song, last song',
  'volume-up': 'louder, volume up, turn it up',
  'volume-down': 'softer, quieter, volume down, turn it down',
  'mute': 'mute audio, mute sound',
  'unmute': 'unmute, unmute audio',
  'sleep': 'go to sleep, sleep computer',
  'lock': 'lock screen, lock computer',
} as const;

/**
 * Squares/Windows voice command defaults.
 * Values are comma-separated phrases and are user-editable via settings.
 */
export const HOT_MIC_DEFAULT_WINDOW_COMMANDS: Record<string, string> = {
  grid: 'grid, tile, tile all, grid all',
  showAll: 'show all, show all windows, show windows',
  focus: 'focus, focus mode, center focus, hide others, hide other windows',
  horizontalSpread: 'horizontal, spread horizontal, side by side',
  verticalSpread: 'vertical, spread vertical, stack windows',
  cascade: 'cascade, cascade windows',
  leftHalf: 'snap left',
  rightHalf: 'snap right',
  // Corners are opt-in: empty phrases are filtered out by the voice matcher,
  // so snap-to-corner actions only fire once the user types their own wording.
  topLeft: '',
  topRight: '',
  bottomLeft: '',
  bottomRight: '',
  maximize: 'maximize',
  fullScreen: 'full screen, fullscreen, enter full screen',
  exitFullScreen: 'exit full screen, leave full screen',
  center: 'center, center window',
  restore: 'restore',
};
