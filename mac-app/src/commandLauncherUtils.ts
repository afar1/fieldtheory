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
// Library Markdown Flattening
// =============================================================================

export type LauncherLibraryNode =
  | { kind: 'file'; relPath: string; absPath: string; name: string; title: string; lastUpdated: number }
  | { kind: 'dir'; name: string; relPath: string; children: LauncherLibraryNode[] };

export interface LauncherLibraryRoot {
  path: string;
  label: string;
  builtin: boolean;
  tree: LauncherLibraryNode[];
}

export interface LauncherLibraryMarkdownItem {
  id: string;
  type: 'wiki-page' | 'markdown-file';
  name: string;
  displayName: string;
  keywords: string[];
  filePath: string;
  relPath?: string;
}

export interface LauncherSearchableItem {
  name: string;
  displayName: string;
  keywords: string[];
}

export interface LauncherBookmarkAuthorItem extends LauncherSearchableItem {
  id: string;
  type: 'bookmark-author';
  authorHandle: string;
  bookmarkCount: number;
  hotkeyDisplay: string;
}

export interface LauncherBookmarkPostSource {
  id: string;
  text: string;
  url: string;
  authorHandle: string;
  authorName: string;
  postedAt: string;
}

export interface LauncherBookmarkPostItem extends LauncherSearchableItem {
  id: string;
  type: 'bookmark';
  bookmarkId: string;
  authorHandle: string;
  postedAt: string;
  hotkeyDisplay: string;
}

export interface LauncherVisibleItem {
  id: string;
  type?: string;
  name: string;
  displayName: string;
}

export interface LauncherAuthorNamespaceCandidate extends LauncherVisibleItem {
  authorHandle?: string;
  keywords?: string[];
}

export function isLauncherPreviewToggleKey(event: { key?: string; code?: string }): boolean {
  return event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.code === 'Space';
}

function formatLauncherBookmarkDate(postedAt: string): string {
  const time = new Date(postedAt).getTime();
  if (!time) return 'undated';
  return new Date(time).toISOString().slice(0, 10);
}

function truncateLauncherBookmarkText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '(empty bookmark)';
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function cleanLauncherHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '');
}

export function handleFromLauncherLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!/^@[A-Za-z0-9_]{1,30}$/.test(trimmed)) return null;
  return cleanLauncherHandle(trimmed);
}

function handleFromLauncherItem(item: LauncherAuthorNamespaceCandidate | undefined): string | null {
  if (!item) return null;
  if (item.authorHandle) return cleanLauncherHandle(item.authorHandle);
  return handleFromLauncherLabel(item.displayName) ?? handleFromLauncherLabel(item.name);
}

function itemMatchesQuery(item: LauncherAuthorNamespaceCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return item.name.toLowerCase().includes(q) ||
    item.displayName.toLowerCase().includes(q) ||
    item.authorHandle?.toLowerCase().includes(q) ||
    item.keywords?.some(keyword => keyword.toLowerCase().includes(q)) ||
    false;
}

export function filterLauncherNamespaceItems<T extends LauncherSearchableItem>(items: T[], search: string): T[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return items;
  return items.filter(item =>
    item.name.toLowerCase().includes(normalizedSearch) ||
    item.displayName.toLowerCase().includes(normalizedSearch) ||
    item.keywords.some(k => k.toLowerCase().includes(normalizedSearch))
  );
}

export function flattenLibraryRootsForLauncher(roots: LauncherLibraryRoot[]): LauncherLibraryMarkdownItem[] {
  const items: LauncherLibraryMarkdownItem[] = [];

  const visit = (root: LauncherLibraryRoot, node: LauncherLibraryNode) => {
    if (node.kind === 'dir') {
      for (const child of node.children) visit(root, child);
      return;
    }

    const type = root.builtin ? 'wiki-page' : 'markdown-file';
    const rootLabel = root.builtin ? 'wiki' : root.label;
    items.push({
      id: `${type}-${root.path}-${node.relPath}`,
      type,
      name: node.name,
      displayName: root.builtin ? node.title : `${node.title} — ${root.label}`,
      keywords: [
        node.name,
        node.title,
        node.relPath,
        rootLabel,
        ...node.name.split('-'),
        ...node.title.split(/\s+/),
      ].filter(Boolean),
      filePath: node.absPath,
      relPath: root.builtin ? node.relPath : undefined,
    });
  };

  for (const root of roots) {
    for (const node of root.tree) visit(root, node);
  }

  return items;
}

export function buildBookmarkAuthorLauncherItems(authors: BookmarkAuthorSummary[]): LauncherBookmarkAuthorItem[] {
  return authors.map((author): LauncherBookmarkAuthorItem => {
    const handle = author.handle.trim().replace(/^@+/, '');
    const displayName = handle ? `@${handle}` : author.name;
    return {
      id: `bookmark-author-${handle.toLowerCase()}`,
      type: 'bookmark-author',
      name: displayName,
      displayName,
      keywords: [
        handle,
        displayName,
        author.name,
        'bookmarks',
        'author',
        'person',
        'posts',
      ].filter(Boolean),
      authorHandle: handle,
      bookmarkCount: author.count,
      hotkeyDisplay: `${author.count} ${author.count === 1 ? 'bookmark' : 'bookmarks'}`,
    };
  }).filter((item) => item.authorHandle || item.displayName);
}

export function buildBookmarkPostLauncherItems(bookmarks: LauncherBookmarkPostSource[]): LauncherBookmarkPostItem[] {
  return bookmarks.map((bookmark) => {
    const date = formatLauncherBookmarkDate(bookmark.postedAt);
    const handle = bookmark.authorHandle.trim().replace(/^@+/, '');
    const displayName = truncateLauncherBookmarkText(bookmark.text);
    return {
      id: `bookmark-${bookmark.id}`,
      type: 'bookmark',
      name: displayName,
      displayName,
      keywords: [
        bookmark.text,
        bookmark.url,
        bookmark.authorName,
        handle,
        `@${handle}`,
        date,
      ].filter(Boolean),
      bookmarkId: bookmark.id,
      authorHandle: handle,
      postedAt: bookmark.postedAt,
      hotkeyDisplay: date,
    };
  });
}

export function dedupeLauncherPersonItems<T extends LauncherVisibleItem>(items: T[]): T[] {
  const seenHandles = new Map<string, number>();
  const deduped: T[] = [];

  for (const item of items) {
    const label = (item.type === 'command' ? item.name : item.displayName).trim();
    const handle = handleFromLauncherLabel(label);
    if (!handle) {
      deduped.push(item);
      continue;
    }

    const key = handle.toLowerCase();
    const existingIndex = seenHandles.get(key);
    if (existingIndex === undefined) {
      seenHandles.set(key, deduped.length);
      deduped.push(item);
      continue;
    }

    const existing = deduped[existingIndex];
    if (item.type === 'bookmark-author' && existing.type !== 'bookmark-author') {
      deduped[existingIndex] = item;
    }
  }

  return deduped;
}

export function resolveLauncherAuthorNamespaceHandle<T extends LauncherAuthorNamespaceCandidate>(
  filteredItems: T[],
  authorItems: T[],
  selectedIndex: number,
  query: string,
): string | null {
  const selectedHandle = handleFromLauncherItem(filteredItems[selectedIndex]);
  if (selectedHandle) return selectedHandle;

  const rawQuery = query.trim();
  const rawHandle = handleFromLauncherLabel(rawQuery);
  if (rawHandle) {
    const exactAuthor = authorItems.find((item) => item.authorHandle?.toLowerCase() === rawHandle.toLowerCase());
    return cleanLauncherHandle(exactAuthor?.authorHandle ?? rawHandle);
  }

  const filteredAuthor = filteredItems.find((item) => item.type === 'bookmark-author' && item.authorHandle);
  if (filteredAuthor?.authorHandle) return cleanLauncherHandle(filteredAuthor.authorHandle);

  const matchingAuthor = authorItems.find((item) => itemMatchesQuery(item, rawQuery));
  if (matchingAuthor?.authorHandle) return cleanLauncherHandle(matchingAuthor.authorHandle);

  return null;
}

// =============================================================================
// Command Launcher Built-in Actions
// =============================================================================

export const DEFAULT_LAUNCHER_HOTKEYS = {
  screenshot: 'Alt+4',
  fullScreen: 'Alt+3',
  activeWindow: 'Shift+Alt+3',
  history: 'Option+Space',
  transcription: 'Option+/',
  superPaste: 'Shift+Command+V',
} as const;

export type LauncherHotkeyMap = { [K in keyof typeof DEFAULT_LAUNCHER_HOTKEYS]: string };

export interface BuiltInLauncherAction {
  id: string;
  type: 'action';
  name: string;
  displayName: string;
  keywords: string[];
  hotkey?: string;
  hotkeyDisplay?: string;
  actionId: string;
}

export function buildBuiltInLauncherActions(
  hotkeys: LauncherHotkeyMap,
  isDarkMode: boolean,
  squaresHotkeys: Record<string, string> = DEFAULT_SQUARES_HOTKEYS,
  showSquaresInCommandLauncher = true
): BuiltInLauncherAction[] {
  const baseActions: BuiltInLauncherAction[] = [
    {
      id: 'action-settings',
      type: 'action',
      name: 'settings',
      displayName: 'Open Settings',
      keywords: ['settings', 'preferences', 'config', 'configure', 'options'],
      actionId: 'settings',
    },
    {
      id: 'action-screenshot',
      type: 'action',
      name: 'screenshot',
      displayName: 'Take Screenshot',
      keywords: ['screenshot', 'capture', 'screen', 'region', 'selection', 'snap'],
      hotkey: hotkeys.screenshot,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.screenshot),
      actionId: 'take-screenshot',
    },
    {
      id: 'action-fullscreen',
      type: 'action',
      name: 'full screen',
      displayName: 'Full Screen Screenshot',
      keywords: ['full', 'screen', 'screenshot', 'entire', 'whole', 'desktop'],
      hotkey: hotkeys.fullScreen,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.fullScreen),
      actionId: 'full-screen-screenshot',
    },
    {
      id: 'action-window',
      type: 'action',
      name: 'active window',
      displayName: 'Active Window Screenshot',
      keywords: ['active', 'window', 'screenshot', 'focused', 'current'],
      hotkey: hotkeys.activeWindow,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.activeWindow),
      actionId: 'active-window-screenshot',
    },
    {
      id: 'action-recording',
      type: 'action',
      name: 'recording',
      displayName: 'Start Recording',
      keywords: ['record', 'recording', 'transcribe', 'transcription', 'voice', 'audio', 'dictate'],
      hotkey: hotkeys.transcription,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.transcription),
      actionId: 'start-recording',
    },
    {
      id: 'action-superpaste',
      type: 'action',
      name: 'terminal image paste',
      displayName: 'Terminal Image Paste',
      keywords: ['terminal', 'image', 'paste', 'base64', 'stack', 'quick'],
      hotkey: hotkeys.superPaste,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.superPaste),
      actionId: 'super-paste',
    },
    {
      id: 'action-history',
      type: 'action',
      name: 'history',
      displayName: 'Open Clipboard History',
      keywords: ['history', 'clipboard', 'clips', 'copied', 'recent'],
      hotkey: hotkeys.history,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.history),
      actionId: 'open-history',
    },
    {
      id: 'action-theme',
      type: 'action',
      name: 'theme',
      displayName: isDarkMode ? 'Toggle Light Mode (Field Theory)' : 'Toggle Dark Mode (Field Theory)',
      keywords: ['theme', 'dark', 'light', 'mode', 'appearance', 'color', 'field', 'theory'],
      hotkey: 'Shift+Command+L',
      hotkeyDisplay: '⇧ ⌘ L',
      actionId: 'toggle-theme',
    },
  ];

  if (!showSquaresInCommandLauncher) {
    return baseActions;
  }

  return [
    ...baseActions,
    ...SQUARES_ACTION_DEFS.map((def) => ({
      id: `action-${def.actionId.replace(/([A-Z])/g, '-$1').toLowerCase()}`,
      type: 'action' as const,
      name: def.name,
      displayName: def.displayName,
      keywords: [...def.keywords, 'windows'],
      hotkey: squaresHotkeys[def.actionId],
      hotkeyDisplay: formatHotkeyDisplay(squaresHotkeys[def.actionId]),
      actionId: def.actionId,
    })),
  ];
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
