import type { MarkdownContentMode } from './utils/markdownContentMode';

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
// Local Instruction Fallback
// =============================================================================

export function shouldOfferLocalInstructionFallback(input: {
  query: string;
  resultCount: number;
  fieldTheoryActive: boolean;
  hasActiveLibraryFileContext: boolean;
  inScopedMode?: boolean;
}): boolean {
  return input.query.trim().length > 0
    && input.resultCount === 0
    && input.fieldTheoryActive
    && input.hasActiveLibraryFileContext
    && !input.inScopedMode;
}

// =============================================================================
// Empty State
// =============================================================================

export function getLauncherStatusText(input: {
  hasQuery: boolean;
  namespaceLabel?: string | null;
  resultCount: number;
  loading: boolean;
  hasLoadedItems: boolean;
}): string | null {
  if ((!input.hasQuery && !input.namespaceLabel) || input.resultCount > 0) return null;
  return input.loading && !input.hasLoadedItems ? 'Loading results...' : 'No matches found';
}

export function shouldPastePortableCommand(input: {
  itemType?: string | null;
  openFieldTheoryTarget?: boolean;
  insertWikiLink?: boolean;
}): boolean {
  return input.itemType === 'command'
    && input.openFieldTheoryTarget !== true
    && input.insertWikiLink !== true;
}

export function getLauncherInvocationVisibilityPolicy(input: {
  itemType?: string | null;
  openFieldTheoryTarget?: boolean;
  insertWikiLink?: boolean;
}): {
  suppressRevealDuringBlur: boolean;
  revealWhenReadyAfterSuccess: boolean;
  closeFromRendererAfterSuccess: boolean;
} {
  const isClipboardPaste = input.itemType === 'clipboard-item' || input.itemType === 'clipboard-stack';
  const isExternalPaste = shouldPastePortableCommand(input) || isClipboardPaste;

  return {
    suppressRevealDuringBlur: isExternalPaste,
    revealWhenReadyAfterSuccess: !isExternalPaste,
    closeFromRendererAfterSuccess: isClipboardPaste,
  };
}

function escapeLauncherBookmarkEmbedAlt(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export function formatLauncherBookmarkEmbedMarkdown(input: {
  itemType?: string | null;
  bookmarkId?: string | null;
  displayName?: string | null;
  name?: string | null;
}): string | null {
  if (input.itemType !== 'bookmark' || !input.bookmarkId) return null;
  const alt = escapeLauncherBookmarkEmbedAlt(input.displayName || input.name || 'Bookmark');
  return `![${alt}](bookmark://${encodeURIComponent(input.bookmarkId)})`;
}

export function getLauncherDefaultBookmarksTabAction(input: {
  itemType?: string | null;
  bookmarkId?: string | null;
}): { bookmarkTarget: LauncherFieldTheoryMarkdownTarget; bookmarkId: string } | null {
  if (input.itemType !== 'bookmark' || !input.bookmarkId) return null;
  return {
    bookmarkTarget: { kind: 'bookmarks', path: 'bookmarks' },
    bookmarkId: input.bookmarkId,
  };
}

export function getLauncherDefaultPanelSourceLabel(source: 'recents' | 'clipboard' | 'bookmarks'): string {
  if (source === 'clipboard') return 'Clipboard';
  if (source === 'bookmarks') return 'Bookmarks';
  return 'Recents';
}

export type LauncherDefaultBookmarkEnterAction =
  | { kind: 'insert-bookmark-embed'; markdown: string }
  | { kind: 'paste-bookmark-text' }
  | { kind: 'copy-bookmark-for-agent' }
  | { kind: 'invoke-bookmark' };

export function getLauncherDefaultBookmarkEnterAction(input: {
  itemType?: string | null;
  bookmarkId?: string | null;
  displayName?: string | null;
  name?: string | null;
  fieldTheoryActive: boolean;
  hasActiveLibraryFileContext: boolean;
  canInsertMarkdown: boolean;
  hasBookmarkPasteText: boolean;
  canPasteText: boolean;
  canCopyForAgent: boolean;
}): LauncherDefaultBookmarkEnterAction | null {
  if (input.itemType !== 'bookmark' || !input.bookmarkId) return null;
  if (input.fieldTheoryActive && input.hasActiveLibraryFileContext && input.canInsertMarkdown) {
    const markdown = formatLauncherBookmarkEmbedMarkdown(input);
    return markdown ? { kind: 'insert-bookmark-embed', markdown } : null;
  }
  if (input.hasBookmarkPasteText && input.canPasteText) return { kind: 'paste-bookmark-text' };
  if (input.canCopyForAgent) return { kind: 'copy-bookmark-for-agent' };
  return { kind: 'invoke-bookmark' };
}

// =============================================================================
// Library Markdown Flattening
// =============================================================================

export type LauncherLibraryNode =
  | { kind: 'file'; relPath: string; absPath: string; name: string; title: string; lastUpdated: number; documentKind?: 'markdown' | 'html' | 'css'; todoState?: 'open' | 'done'; sharedOriginalSourcePath?: string; sharedAuthorCallsign?: string }
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
  lastUpdated?: number;
  todoState?: 'open' | 'done';
  source?: 'private' | 'shared';
  sourceLabel?: string;
  sharedAuthorCallsign?: string;
}

export type LauncherRootSearchKind =
  | 'system-setting'
  | 'contact'
  | 'file'
  | 'recent-document'
  | 'url'
  | 'web-search'
  | 'calculator'
  | 'unit'
  | 'currency'
  | 'time-zone'
  | 'dictionary'
  | 'calendar'
  | 'system-command'
  | 'terminal-command';

export const LAUNCHER_ROOT_SEARCH_KIND_LABELS: Record<LauncherRootSearchKind, string> = {
  'system-setting': 'Setting',
  contact: 'Contact',
  file: 'File',
  'recent-document': 'Recent',
  url: 'URL',
  'web-search': 'Search',
  calculator: 'Calculator',
  unit: 'Unit',
  currency: 'Currency',
  'time-zone': 'Time Zone',
  dictionary: 'Dictionary',
  calendar: 'Calendar',
  'system-command': 'System',
  'terminal-command': 'Terminal',
};

export const DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS: Record<LauncherRootSearchKind, boolean> = {
  'system-setting': false,
  contact: false,
  file: true,
  'recent-document': false,
  url: false,
  'web-search': false,
  calculator: false,
  unit: false,
  currency: false,
  'time-zone': false,
  dictionary: false,
  calendar: false,
  'system-command': false,
  'terminal-command': false,
};

export type LauncherRootSearchEnabledKinds = Partial<Record<LauncherRootSearchKind, boolean>>;

export function normalizeLauncherRootSearchEnabledKinds(
  value: LauncherRootSearchEnabledKinds | null | undefined,
): Record<LauncherRootSearchKind, boolean> {
  const normalized = { ...DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS };
  if (!value || typeof value !== 'object') return normalized;
  for (const kind of Object.keys(LAUNCHER_ROOT_SEARCH_KIND_LABELS) as LauncherRootSearchKind[]) {
    if (typeof value[kind] === 'boolean') normalized[kind] = value[kind];
  }
  return normalized;
}

export function isLauncherRootSearchKindEnabled(
  settings: LauncherRootSearchEnabledKinds | null | undefined,
  kind: LauncherRootSearchKind,
): boolean {
  return normalizeLauncherRootSearchEnabledKinds(settings)[kind];
}

export function areLauncherRootSearchEnabledKindsEqual(
  a: LauncherRootSearchEnabledKinds | null | undefined,
  b: LauncherRootSearchEnabledKinds | null | undefined,
): boolean {
  const left = normalizeLauncherRootSearchEnabledKinds(a);
  const right = normalizeLauncherRootSearchEnabledKinds(b);
  return (Object.keys(LAUNCHER_ROOT_SEARCH_KIND_LABELS) as LauncherRootSearchKind[])
    .every(kind => left[kind] === right[kind]);
}

export interface LauncherNativeIconPathCandidate {
  filePath?: string;
  directoryPath?: string;
}

export interface LauncherFileSource {
  name: string;
  displayName: string;
  filePath: string;
  isDirectory: boolean;
  lastModified: number;
}

export interface LauncherFileItem extends LauncherSearchableItem, LauncherNormalModeItem {
  id: string;
  type: 'file';
  rootSearchKind: 'file';
  rootSearchLabel: string;
  filePath: string;
  isDirectory: boolean;
  lastUpdated?: number;
  hotkeyDisplay: string;
}

export interface LauncherDirectoryItem extends LauncherSearchableItem {
  id: string;
  type: 'directory';
  rootPath: string;
  rootBuiltin: boolean;
  directoryPath: string;
  directoryRelPath?: string;
  lastUpdated?: number;
  hotkeyDisplay: string;
}

export interface LauncherCommandDirectorySource {
  name: string;
  displayName: string;
  rootPath: string;
  directoryPath: string;
  directoryRelPath: string;
  lastModified: number;
}

export type LauncherBookmarkFacetKind = 'category' | 'domain' | 'entity';

export interface LauncherBookmarkTaxonomyInfo {
  kind: LauncherBookmarkFacetKind;
  value: string;
}

export interface LauncherBookmarkFacetItem extends LauncherSearchableItem {
  id: string;
  type: 'bookmark-facet';
  facetPaths: string[];
  facetKinds: LauncherBookmarkFacetKind[];
  hotkeyDisplay: string;
}

const BOOKMARK_TAXONOMY_SEGMENTS: Array<{ segment: string; kind: LauncherBookmarkFacetKind }> = [
  { segment: 'categories', kind: 'category' },
  { segment: 'domains', kind: 'domain' },
  { segment: 'entities', kind: 'entity' },
];

function stripMarkdownExtension(path: string): string {
  return path.replace(/\\/g, '/').replace(/\.md$/i, '');
}

function taxonomyValueFromPath(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const value = path.slice(prefix.length);
  if (!value || value.includes('/')) return null;
  return value;
}

export function getGeneratedBookmarkTaxonomyPathInfo(path: string | undefined | null): LauncherBookmarkTaxonomyInfo | null {
  if (!path) return null;
  const normalized = stripMarkdownExtension(path);

  for (const { segment, kind } of BOOKMARK_TAXONOMY_SEGMENTS) {
    const nestedValue = taxonomyValueFromPath(normalized, `bookmarks-from-x/${segment}/`);
    if (nestedValue) return { kind, value: nestedValue };

    const nestedMarker = `/bookmarks-from-x/${segment}/`;
    const nestedIndex = normalized.indexOf(nestedMarker);
    if (nestedIndex >= 0) {
      const value = normalized.slice(nestedIndex + nestedMarker.length);
      if (value && !value.includes('/')) return { kind, value };
    }

    const rootValue = taxonomyValueFromPath(normalized, `${segment}/`);
    if (rootValue) return { kind, value: rootValue };

    for (const rootMarker of [`/.fieldtheory/library/${segment}/`]) {
      const rootIndex = normalized.indexOf(rootMarker);
      if (rootIndex < 0) continue;
      const value = normalized.slice(rootIndex + rootMarker.length);
      if (value && !value.includes('/')) return { kind, value };
    }
  }

  return null;
}

export function isGeneratedBookmarkTaxonomyPath(path: string | undefined | null): boolean {
  return getGeneratedBookmarkTaxonomyPathInfo(path) !== null;
}

function shouldIndexLibraryNodeForLauncher(root: LauncherLibraryRoot, node: LauncherLibraryNode): boolean {
  if (node.kind !== 'file') return false;
  if (!root.builtin) return true;
  return !isGeneratedBookmarkTaxonomyPath(node.relPath);
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
  lastUpdated?: number;
}

export interface LauncherBookmarkPostSource {
  id: string;
  sourceType?: 'x' | 'web';
  text: string;
  url: string;
  authorHandle: string;
  authorName: string;
  postedAt: string;
  title?: string;
  domain?: string;
  excerpt?: string;
}

export interface LauncherBookmarkPostItem extends LauncherSearchableItem {
  id: string;
  type: 'bookmark';
  bookmarkId: string;
  authorHandle: string;
  postedAt: string;
  hotkeyDisplay: string;
  lastUpdated?: number;
}

export interface LauncherVisibleItem {
  id: string;
  type?: string;
  name: string;
  displayName: string;
  hotkeyDisplay?: string;
  timeAgo?: string;
}

export function areLauncherVisibleItemsSameOrder(
  current: readonly LauncherVisibleItem[],
  next: readonly LauncherVisibleItem[],
): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;
  return current.every((item, index) => (
    item.id === next[index]?.id
      && item.type === next[index]?.type
      && item.name === next[index]?.name
      && item.displayName === next[index]?.displayName
      && item.hotkeyDisplay === next[index]?.hotkeyDisplay
      && item.timeAgo === next[index]?.timeAgo
  ));
}

export const LAUNCHER_FILTER_TRACE_MIN_ELAPSED_MS = 8;

export function shouldTraceLauncherRendererEvent(
  event: string,
  details: Record<string, unknown> = {},
): boolean {
  if (event !== 'filter-results') return true;
  const launcherSessionId = details.launcherSessionId;
  if (typeof launcherSessionId === 'string' && launcherSessionId.startsWith('benchmark-')) return true;
  const queryLength = details.queryLength;
  if (typeof queryLength === 'number' && queryLength > 0 && queryLength <= 2) return true;
  const elapsedMs = details.elapsedMs;
  return typeof elapsedMs !== 'number' || elapsedMs >= LAUNCHER_FILTER_TRACE_MIN_ELAPSED_MS;
}

export interface LauncherAuthorNamespaceCandidate extends LauncherVisibleItem {
  authorHandle?: string;
  keywords?: string[];
}

export interface LauncherBookmarkFacetNamespaceCandidate extends LauncherVisibleItem {
  facetPaths?: string[];
  keywords?: string[];
}

export interface LauncherDirectoryNamespaceCandidate extends LauncherVisibleItem {
  rootPath?: string;
  rootBuiltin?: boolean;
  directoryPath?: string;
  directoryRelPath?: string;
  keywords?: string[];
}

export interface LauncherLibraryMoveSource {
  type: 'wiki' | 'external';
  rootPath: string;
  relPath: string;
  filePath: string;
  title: string;
}

export interface LauncherMoveDirectoryTarget {
  sourceRootPath: string;
  targetRootPath: string;
  targetDirRelPath: string;
  targetType: 'wiki' | 'external';
}

export interface LauncherCommandOpenCandidate extends LauncherVisibleItem {
  filePath?: string;
  keywords?: string[];
}

export type LauncherFieldTheoryMarkdownTarget = {
  kind: 'wiki' | 'artifact' | 'command' | 'external' | 'bookmarks' | 'ember' | 'library' | 'commands' | 'clipboard';
  path: string;
  contentMode?: MarkdownContentMode;
  selectionStart?: number;
  selectionEnd?: number;
  clipboardItemId?: number;
  clipboardStackId?: string;
  clipboardSearch?: string;
};

export interface LauncherFieldTheoryTargetCandidate extends LauncherVisibleItem {
  filePath?: string;
  relPath?: string;
  recentKind?: 'wiki' | 'external';
  isDirectory?: boolean;
  keywords?: string[];
}

export interface LauncherLibraryRootPath {
  path: string;
  builtin: boolean;
}

export type LauncherUsageMap = Record<string, { count: number; lastUsedAt: number }>;

export interface LauncherUsageScoreItem {
  id: string;
  type?: string;
  name: string;
}

export interface LauncherNormalModeItem {
  type?: string;
  isPinned?: boolean;
  lastOpenedAt?: number;
  lastUpdated?: number;
  postedAt?: string;
}

export interface ScoredLauncherNormalModeItem<T extends LauncherNormalModeItem> {
  item: T;
  score: number;
}

export interface LauncherNormalModeBalanceOptions {
  maxResults?: number;
}

export interface LauncherDirectoryNamespace {
  label: string;
  directoryPath: string;
  directoryRelPath?: string;
}

export const LAUNCHER_NORMAL_MODE_MAX_RESULTS = 20;

interface NormalizedLauncherSearchableItem {
  sourceName: string;
  sourceDisplayName: string;
  sourceKeywords: string[];
  name: string;
  displayName: string;
  keywords: string[];
  searchText: string;
}

const normalizedLauncherSearchableItems = new WeakMap<LauncherSearchableItem, NormalizedLauncherSearchableItem>();

function normalizeLauncherSearchText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function getNormalizedLauncherSearchableItem(item: LauncherSearchableItem): NormalizedLauncherSearchableItem {
  const cached = normalizedLauncherSearchableItems.get(item);
  if (
    cached
    && cached.sourceName === item.name
    && cached.sourceDisplayName === item.displayName
    && cached.sourceKeywords === item.keywords
  ) {
    return cached;
  }

  const normalized = {
    sourceName: item.name,
    sourceDisplayName: item.displayName,
    sourceKeywords: item.keywords,
    name: normalizeLauncherSearchText(item.name),
    displayName: normalizeLauncherSearchText(item.displayName),
    keywords: item.keywords.map(keyword => normalizeLauncherSearchText(keyword)),
    searchText: '',
  };
  normalized.searchText = [
    normalized.name,
    normalized.displayName,
    ...normalized.keywords,
  ].filter(Boolean).join(' ');
  normalizedLauncherSearchableItems.set(item, normalized);
  return normalized;
}

export function warmLauncherSearchableItemCache(
  items: LauncherSearchableItem[],
  startIndex = 0,
  maxItems = items.length,
): number {
  const endIndex = Math.min(items.length, startIndex + Math.max(0, maxItems));
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = items[index];
    getNormalizedLauncherSearchableItem(item);
  }
  return endIndex;
}

function fuzzySubsequenceScore(text: string, query: string): number {
  if (query.length < 3) return 0;
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let gapPenalty = 0;

  for (let i = 0; i < text.length && queryIndex < query.length; i += 1) {
    if (text[i] !== query[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = i;
    if (lastMatch !== -1) gapPenalty += Math.max(0, i - lastMatch - 1);
    lastMatch = i;
    queryIndex += 1;
  }

  if (queryIndex !== query.length || firstMatch === -1) return 0;
  return Math.max(40, 220 - firstMatch * 4 - gapPenalty * 8 - (text.length - query.length));
}

function hasLauncherTokenPrefix(text: string, query: string): boolean {
  if (text.startsWith(query)) return true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== ' ' && char !== '/' && char !== '.' && char !== '_' && char !== '-') continue;
    if (text.startsWith(query, index + 1)) return true;
  }
  return false;
}

function scoreNormalizedLauncherText(text: string, query: string, allowFuzzy = true): number {
  if (!text || !query) return 0;
  if (text === query) return 1000;
  if (text.startsWith(query)) return 850 - Math.min(120, text.length - query.length);
  if (hasLauncherTokenPrefix(text, query)) return 760 - Math.min(120, text.length - query.length);
  const containsIndex = text.indexOf(query);
  if (containsIndex >= 0) return 600 - Math.min(180, containsIndex * 5);
  if (!allowFuzzy) return 0;
  return fuzzySubsequenceScore(text, query);
}

export function scoreLauncherText(rawText: string | undefined, query: string): number {
  return scoreNormalizedLauncherText(normalizeLauncherSearchText(rawText), query);
}

export function scoreLauncherSearchableItem<T extends LauncherSearchableItem & LauncherNormalModeItem>(item: T, query: string): number {
  const allowFuzzy = item.type !== 'wiki-page' && item.type !== 'markdown-file' && item.type !== 'recent-file';
  if (query.length < 3 && (item.type === 'wiki-page' || item.type === 'markdown-file') && !item.isPinned) return 0;

  const searchableItem = getNormalizedLauncherSearchableItem(item);
  if (!allowFuzzy && !searchableItem.searchText.includes(query)) return 0;

  let textScore = Math.max(
    0,
    scoreNormalizedLauncherText(searchableItem.name, query, allowFuzzy),
    scoreNormalizedLauncherText(searchableItem.displayName, query, allowFuzzy) - 20,
  );
  for (const keyword of searchableItem.keywords) {
    const keywordScore = scoreNormalizedLauncherText(keyword, query, allowFuzzy) - 70;
    if (keywordScore > textScore) textScore = keywordScore;
  }
  if (textScore <= 0) return 0;

  let typeScore = 0;
  if (item.type === 'directory') typeScore += 35;
  if (item.type === 'source') typeScore += 30;
  if (item.type === 'command') typeScore += 20;
  if (item.type === 'action') typeScore += 19;
  if (item.type === 'file') typeScore += 16;
  if (item.type === 'bookmark-author') typeScore += 15;
  if (item.type === 'bookmark-facet') typeScore += 15;
  if (item.type === 'recent-file') typeScore += 12;
  if (item.type === 'handoff') typeScore += 3;

  return textScore + typeScore;
}

function parseLauncherTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getLauncherItemRecency(item: LauncherNormalModeItem): number {
  if (typeof item.lastOpenedAt === 'number') return item.lastOpenedAt;
  if (typeof item.lastUpdated === 'number') return item.lastUpdated;
  return parseLauncherTimestamp(item.postedAt);
}

function compareScoredLauncherMatches<T extends LauncherNormalModeItem>(
  a: ScoredLauncherNormalModeItem<T>,
  b: ScoredLauncherNormalModeItem<T>,
): number {
  const launcherTypePriority = (item: LauncherNormalModeItem): number => {
    if (item.type === 'command') return 4;
    if (item.type === 'action') return 3;
    if (item.type === 'directory') return 2;
    return 0;
  };
  const aTypePriority = launcherTypePriority(a.item);
  const bTypePriority = launcherTypePriority(b.item);
  if (aTypePriority !== bTypePriority) return bTypePriority - aTypePriority;

  const pinnedDelta = Number(Boolean(b.item.isPinned)) - Number(Boolean(a.item.isPinned));
  if (pinnedDelta !== 0) return pinnedDelta;

  if (a.item.type === 'command' && b.item.type === 'command' && a.score !== b.score) {
    return b.score - a.score;
  }

  if ((a.item.type === 'directory' || b.item.type === 'directory') && a.score !== b.score) {
    return b.score - a.score;
  }

  const aRecency = getLauncherItemRecency(a.item);
  const bRecency = getLauncherItemRecency(b.item);
  if ((aRecency || bRecency) && aRecency !== bRecency) return bRecency - aRecency;
  if (a.score !== b.score) return b.score - a.score;
  return 0;
}

function insertScoredLauncherMatch<T extends LauncherNormalModeItem>(
  bestMatches: ScoredLauncherNormalModeItem<T>[],
  match: ScoredLauncherNormalModeItem<T>,
  maxResults: number,
): void {
  if (match.score <= 0 || maxResults <= 0) return;

  let insertIndex = 0;
  while (
    insertIndex < bestMatches.length
    && compareScoredLauncherMatches(match, bestMatches[insertIndex]) >= 0
  ) {
    insertIndex += 1;
  }

  if (insertIndex >= maxResults) return;
  bestMatches.splice(insertIndex, 0, match);
  if (bestMatches.length > maxResults) {
    bestMatches.pop();
  }
}

export function balanceLauncherNormalModeMatches<T extends LauncherNormalModeItem>(
  matches: ScoredLauncherNormalModeItem<T>[],
  options: LauncherNormalModeBalanceOptions = {},
): T[] {
  const maxResults = options.maxResults ?? LAUNCHER_NORMAL_MODE_MAX_RESULTS;
  if (maxResults <= 0) return [];

  const bestMatches: ScoredLauncherNormalModeItem<T>[] = [];

  for (const match of matches) {
    insertScoredLauncherMatch(bestMatches, match, maxResults);
  }

  return bestMatches.map(({ item }) => item);
}

interface LauncherCommandFileFilterInput {
  filePath?: string | null;
  commandFilePaths: ReadonlySet<string>;
  allowCommandFile?: boolean;
}

function shouldIncludeLauncherNonCommandFile(input: LauncherCommandFileFilterInput): boolean {
  return input.allowCommandFile === true || !input.filePath || !input.commandFilePaths.has(input.filePath);
}

export function shouldIncludeLauncherRecentFile(input: LauncherCommandFileFilterInput): boolean {
  return shouldIncludeLauncherNonCommandFile(input);
}

export function shouldIncludeLauncherLibraryMarkdownItem(input: LauncherCommandFileFilterInput): boolean {
  return shouldIncludeLauncherNonCommandFile(input);
}

export function isLauncherPreviewToggleKey(event: { key?: string; code?: string }): boolean {
  return event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.code === 'Space';
}

export function shouldHandleLauncherPreviewShortcut(
  event: { key?: string; code?: string },
  hasExplicitSelection: boolean,
  previewOpen: boolean,
): boolean {
  return isLauncherPreviewToggleKey(event) && (hasExplicitSelection || previewOpen);
}

export function nextLauncherArrowIndex(
  currentIndex: number,
  itemCount: number,
  direction: 'down' | 'up',
): number {
  if (itemCount <= 0) return 0;
  const clampedIndex = Math.max(0, Math.min(currentIndex, itemCount - 1));
  return direction === 'down'
    ? Math.min(clampedIndex + 1, itemCount - 1)
    : Math.max(clampedIndex - 1, 0);
}

export function shouldReturnLauncherSelectionToInput(
  currentIndex: number,
  itemCount: number,
  hasExplicitSelection: boolean,
): boolean {
  return itemCount > 0 && hasExplicitSelection && currentIndex <= 0;
}

export function resolveHighlightedLauncherIndex(currentIndex: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(currentIndex, itemCount - 1));
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

function facetItemMatchesQuery(item: LauncherBookmarkFacetNamespaceCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return item.name.toLowerCase().includes(q) ||
    item.displayName.toLowerCase().includes(q) ||
    item.keywords?.some(keyword => keyword.toLowerCase().includes(q)) ||
    false;
}

function directoryItemMatchesQuery(item: LauncherDirectoryNamespaceCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return item.name.toLowerCase() === q ||
    item.displayName.toLowerCase() === q ||
    item.directoryRelPath?.toLowerCase() === q ||
    item.keywords?.some(keyword => keyword.toLowerCase() === q) ||
    false;
}

function normalizeCommandLookupText(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/');
}

function stripCommandMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, '');
}

function basename(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? value;
}

function scoreLauncherOpenCandidateText(rawCandidates: string[], query: string): number {
  const q = normalizeCommandLookupText(query);
  if (!q) return 0;

  const candidates = rawCandidates.map(normalizeCommandLookupText).filter(Boolean);
  let best = 0;
  for (const candidate of candidates) {
    const withoutExtension = stripCommandMarkdownExtension(candidate);
    if (candidate === q || withoutExtension === q) best = Math.max(best, 1000);
    else if (candidate.startsWith(q) || withoutExtension.startsWith(q)) best = Math.max(best, 850);
    else if (candidate.split(/[\s/._-]+/).some(part => part.startsWith(q))) best = Math.max(best, 760);
    else if (candidate.includes(q)) best = Math.max(best, 600);
  }
  return best;
}

function scoreCommandOpenCandidate(item: LauncherCommandOpenCandidate, query: string): number {
  if (!query.trim() || item.type !== 'command' || !item.filePath) return 0;

  const pathName = basename(item.filePath);
  return scoreLauncherOpenCandidateText([
    item.name,
    item.displayName,
    pathName,
    stripCommandMarkdownExtension(pathName),
    item.filePath,
    ...(item.keywords ?? []),
  ], query);
}

function scoreFieldTheoryOpenCandidate(item: LauncherFieldTheoryTargetCandidate, query: string): number {
  if (!query.trim() || !getLauncherFieldTheoryMarkdownTarget(item)) return 0;

  const pathName = basename(item.filePath ?? item.relPath ?? '');
  return scoreLauncherOpenCandidateText([
    item.name,
    item.displayName,
    pathName,
    stripCommandMarkdownExtension(pathName),
    item.relPath ?? '',
    item.filePath ?? '',
    ...(item.keywords ?? []),
  ], query);
}

export function filterLauncherNamespaceItems<T extends LauncherSearchableItem & LauncherNormalModeItem>(items: T[], search: string): T[] {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch
    ? items.filter(item =>
      item.name.toLowerCase().includes(normalizedSearch) ||
      item.displayName.toLowerCase().includes(normalizedSearch) ||
      item.keywords.some(k => k.toLowerCase().includes(normalizedSearch))
    )
    : items;
  return filtered.slice().sort(compareLauncherItemsByRecency);
}

export function shouldShowLauncherItemInTypedSearch(item: { type: string }): boolean {
  return item.type !== 'recent-file';
}

export function isLauncherRiverItem(item: { source?: string; sourceLabel?: string }): boolean {
  return item.source === 'shared' || item.sourceLabel === 'River (shared)';
}

export function getLauncherDefaultPanelItems<T>(input: {
  expanded: boolean;
  isRootIdle: boolean;
  source: 'recents' | 'clipboard' | 'bookmarks';
  recentItems: T[];
  clipboardItems: T[];
  bookmarkItems?: T[];
  maxItems?: number;
}): T[] {
  if (!input.expanded || !input.isRootIdle) return [];
  const maxItems = input.maxItems ?? 5;
  if (input.source === 'clipboard') return input.clipboardItems.slice(0, maxItems);
  if (input.source === 'bookmarks') return (input.bookmarkItems ?? []).slice(0, maxItems);
  return input.recentItems.slice(0, maxItems);
}

function joinLauncherPath(parent: string, child: string): string {
  const cleanParent = parent.replace(/\/+$/, '');
  const cleanChild = child.replace(/^\/+/, '');
  return cleanChild ? `${cleanParent}/${cleanChild}` : cleanParent;
}

function directoryDisplayName(root: LauncherLibraryRoot, relPath: string): string {
  if (!relPath) return root.label;
  return root.builtin ? relPath : `${relPath} — ${root.label}`;
}

export function flattenLibraryDirectoriesForLauncher(roots: LauncherLibraryRoot[]): LauncherDirectoryItem[] {
  const items: LauncherDirectoryItem[] = [];
  const seen = new Set<string>();

  const addDirectory = (root: LauncherLibraryRoot, relPath: string, name: string) => {
    if (!relPath && root.builtin) return;
    const key = `${root.path}:${relPath}`;
    if (seen.has(key)) return;
    seen.add(key);

    const displayName = directoryDisplayName(root, relPath);
    items.push({
      id: `directory-${root.path}-${relPath}`,
      type: 'directory',
      name,
      displayName,
      keywords: [
        name,
        relPath,
        displayName,
        root.label,
        ...name.split(/[-_]/),
        ...relPath.split('/'),
      ].filter(Boolean),
      rootPath: root.path,
      rootBuiltin: root.builtin,
      directoryPath: joinLauncherPath(root.path, relPath),
      directoryRelPath: relPath,
      hotkeyDisplay: 'folder',
    });
  };

  const addParentDirectories = (root: LauncherLibraryRoot, fileRelPath: string) => {
    const parts = fileRelPath.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      const relPath = parts.slice(0, i).join('/');
      addDirectory(root, relPath, parts[i - 1]);
    }
  };

  const visit = (root: LauncherLibraryRoot, node: LauncherLibraryNode) => {
    if (node.kind === 'file') {
      addParentDirectories(root, node.relPath);
      return;
    }

    addDirectory(root, node.relPath, node.name);
    for (const child of node.children) visit(root, child);
  };

  for (const root of roots) {
    if (!root.builtin) addDirectory(root, '', root.label);
    for (const node of root.tree) visit(root, node);
  }

  return items.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function buildCommandDirectoriesForLauncher(directories: LauncherCommandDirectorySource[]): LauncherDirectoryItem[] {
  return directories.map((directory): LauncherDirectoryItem => ({
    id: `command-directory-${directory.directoryPath}`,
    type: 'directory',
    name: directory.name,
    displayName: directory.displayName,
    keywords: [
      directory.name,
      directory.displayName,
      directory.directoryRelPath,
      directory.directoryPath,
      directory.rootPath,
      'command',
      'commands',
      'portable command',
      'portable commands',
      'folder',
      ...directory.displayName.split(/[\\/]/),
    ].filter(Boolean),
    rootPath: directory.rootPath,
    rootBuiltin: false,
    directoryPath: directory.directoryPath,
    directoryRelPath: directory.directoryRelPath,
    lastUpdated: Number.isFinite(directory.lastModified) ? directory.lastModified : undefined,
    hotkeyDisplay: 'folder',
  })).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function flattenLibraryRootsForLauncher(roots: LauncherLibraryRoot[]): LauncherLibraryMarkdownItem[] {
  const items: LauncherLibraryMarkdownItem[] = [];

  const isBuiltinCommandLibraryFile = (relPath: string | undefined): boolean => (
    relPath?.split(/[\\/]/, 1)[0]?.toLowerCase() === 'commands'
  );

  const visit = (root: LauncherLibraryRoot, node: LauncherLibraryNode) => {
    if (node.kind === 'dir') {
      for (const child of node.children) visit(root, child);
      return;
    }
    if (!shouldIndexLibraryNodeForLauncher(root, node)) return;

    const isCommandLibraryFile = root.builtin && isBuiltinCommandLibraryFile(node.relPath);
    const isWikiMarkdown = root.builtin
      && !isCommandLibraryFile
      && (node.documentKind === undefined || node.documentKind === 'markdown');
    const type = isWikiMarkdown ? 'wiki-page' : 'markdown-file';
    const rootLabel = isCommandLibraryFile ? 'commands' : root.builtin ? 'wiki' : root.label;
    const displayRootLabel = isCommandLibraryFile ? 'Commands' : root.label;
    const sharedAuthorCallsign = node.sharedAuthorCallsign?.trim();
    const isSharedRiverFile = root.label === 'River (shared)' || Boolean(node.sharedOriginalSourcePath || sharedAuthorCallsign);
    const readableName = node.name.replace(/[-_]+/g, ' ');
    const todoKeywords = node.todoState
      ? ['todo', 'task', node.todoState, node.todoState === 'done' ? 'completed' : 'open']
      : [];
    items.push({
      id: `${type}-${root.path}-${node.relPath}`,
      type,
      name: node.name,
      displayName: isWikiMarkdown ? node.title : `${node.title} — ${displayRootLabel}`,
      keywords: [
        node.name,
        readableName,
        node.title,
        node.relPath,
        rootLabel,
        sharedAuthorCallsign ?? '',
        ...node.name.split('-'),
        ...node.title.split(/\s+/),
        ...todoKeywords,
      ].filter(Boolean),
      filePath: node.absPath,
      relPath: isWikiMarkdown ? node.relPath : undefined,
      lastUpdated: Number.isFinite(node.lastUpdated) ? node.lastUpdated : undefined,
      todoState: node.todoState,
      source: isSharedRiverFile ? 'shared' : undefined,
      sourceLabel: isSharedRiverFile ? root.label : undefined,
      sharedAuthorCallsign,
    });
  };

  for (const root of roots) {
    for (const node of root.tree) visit(root, node);
  }

  return items.sort(compareLauncherItemsByRecency);
}

function normalizeFsPathForLauncherMatch(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function commandPathToLauncherLibraryOpenTarget(
  commandPath: string,
  libraryRoots: LauncherLibraryRootPath[] | undefined,
): LauncherFieldTheoryMarkdownTarget {
  const normalizedCommandPath = normalizeFsPathForLauncherMatch(commandPath);
  const builtinRoot = libraryRoots?.find((root) => {
    if (!root.builtin) return false;
    const normalizedRoot = normalizeFsPathForLauncherMatch(root.path);
    return normalizedCommandPath === normalizedRoot || normalizedCommandPath.startsWith(`${normalizedRoot}/`);
  });

  if (builtinRoot) {
    const normalizedRoot = normalizeFsPathForLauncherMatch(builtinRoot.path);
    const relPath = normalizedCommandPath.slice(normalizedRoot.length + 1).replace(/\.md$/i, '');
    const topLevelFolder = relPath.split(/[\\/]/, 1)[0]?.toLowerCase();
    if (relPath && topLevelFolder !== 'commands') return { kind: 'wiki', path: relPath };
  }

  return { kind: 'external', path: commandPath };
}

export function getLauncherNativeIconPathForItem(item: LauncherNativeIconPathCandidate | undefined | null): string | null {
  return item?.filePath || item?.directoryPath || null;
}

function launcherParentPathLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return 'file';
  return parts[parts.length - 2] || 'file';
}

export function buildLauncherFileItems(files: LauncherFileSource[]): LauncherFileItem[] {
  return files.map((fileInfo): LauncherFileItem => {
    const pathParts = fileInfo.filePath.split(/[\\/]/).filter(Boolean);
    const nameParts = fileInfo.name.split(/[\s._-]+/).filter(Boolean);
    return {
      id: `file-${fileInfo.filePath}`,
      type: 'file',
      rootSearchKind: 'file',
      rootSearchLabel: LAUNCHER_ROOT_SEARCH_KIND_LABELS.file,
      name: fileInfo.name,
      displayName: fileInfo.displayName,
      keywords: [
        fileInfo.name,
        fileInfo.displayName,
        fileInfo.filePath,
        ...nameParts,
        ...pathParts,
      ].filter(Boolean),
      filePath: fileInfo.filePath,
      isDirectory: fileInfo.isDirectory,
      lastUpdated: Number.isFinite(fileInfo.lastModified) ? fileInfo.lastModified : undefined,
      hotkeyDisplay: fileInfo.isDirectory ? 'folder' : launcherParentPathLabel(fileInfo.filePath),
    };
  });
}

export function getLauncherFileSearchQuery(query: string): string | null {
  if (!query.startsWith("'")) return null;
  return query.slice(1).trim();
}

export function getLauncherClipboardSearchQuery(query: string): string | null {
  if (!query.startsWith('. ')) return null;
  return query.slice(2).trim();
}

export function getLauncherClipboardSearchInputState(input: {
  active: boolean;
  query: string;
}): { active: boolean; query: string } {
  if (input.active) return input;
  const clipboardSearch = getLauncherClipboardSearchQuery(input.query);
  return clipboardSearch === null
    ? input
    : { active: true, query: clipboardSearch };
}

export function shouldExitLauncherClipboardSearch(input: {
  active: boolean;
  query: string;
  key: string;
}): boolean {
  return input.active && input.query.length === 0 && input.key === 'Backspace';
}

function isDescendantPath(path: string | undefined, directoryPath: string): boolean {
  if (!path) return false;
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedDirectory = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedPath.startsWith(`${normalizedDirectory}/`);
}

function isDescendantRelPath(relPath: string | undefined, directoryRelPath: string | undefined): boolean {
  if (!relPath || !directoryRelPath) return false;
  const normalizedDirectory = directoryRelPath.replace(/\/+$/, '');
  return relPath.startsWith(`${normalizedDirectory}/`);
}

function compareLauncherDirectoryItemsByRecency<T extends LauncherSearchableItem & { lastUpdated?: number }>(a: T, b: T): number {
  const aUpdated = typeof a.lastUpdated === 'number' ? a.lastUpdated : 0;
  const bUpdated = typeof b.lastUpdated === 'number' ? b.lastUpdated : 0;
  if (aUpdated !== bUpdated) return bUpdated - aUpdated;
  return a.displayName.localeCompare(b.displayName);
}

export function compareLauncherItemsByRecency<T extends LauncherSearchableItem & LauncherNormalModeItem>(a: T, b: T): number {
  const pinnedDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinnedDelta !== 0) return pinnedDelta;
  const aRecency = getLauncherItemRecency(a);
  const bRecency = getLauncherItemRecency(b);
  if (aRecency !== bRecency) return bRecency - aRecency;
  return a.displayName.localeCompare(b.displayName);
}

export function getLauncherUsageScore(
  item: LauncherUsageScoreItem,
  query: string,
  usageByItemId: LauncherUsageMap,
  baseScore: number,
  now: number = Date.now(),
): number {
  if (baseScore <= 0) return 0;
  const usage = usageByItemId[item.id];
  const usageScore = usage ? Math.min(140, usage.count * 12) : 0;
  const recencyScore = usage ? Math.max(0, 24 - Math.floor((now - usage.lastUsedAt) / 86_400_000)) : 0;
  const commandPrefixBoost = item.type === 'command' && item.name.toLowerCase().startsWith(query) ? 45 : 0;
  return usageScore + recencyScore + commandPrefixBoost;
}

export interface LauncherNormalModeFilterOptions<T extends LauncherSearchableItem & LauncherNormalModeItem & LauncherUsageScoreItem> extends LauncherNormalModeBalanceOptions {
  includeItem?: (item: T, score: number, baseScore: number) => boolean;
}

export function filterLauncherNormalModeItems<T extends LauncherSearchableItem & LauncherNormalModeItem & LauncherUsageScoreItem>(
  items: T[],
  query: string,
  usageByItemId: LauncherUsageMap = {},
  options: LauncherNormalModeFilterOptions<T> = {},
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const maxResults = options.maxResults ?? LAUNCHER_NORMAL_MODE_MAX_RESULTS;
  if (maxResults <= 0) return [];
  const bestMatches: ScoredLauncherNormalModeItem<T>[] = [];

  for (const item of items) {
    const baseScore = scoreLauncherSearchableItem(item, q);
    const score = baseScore + getLauncherUsageScore(item, q, usageByItemId, baseScore);
    if (score <= 0 || !(options.includeItem?.(item, score, baseScore) ?? true)) continue;
    insertScoredLauncherMatch(bestMatches, { item, score }, maxResults);
  }

  return bestMatches.map(({ item }) => item);
}

export function resolveLauncherNormalModeQueryMatch<T extends LauncherSearchableItem & LauncherNormalModeItem & LauncherUsageScoreItem>(
  items: T[],
  query: string,
  usageByItemId: LauncherUsageMap = {},
  options: LauncherNormalModeFilterOptions<T> = {},
): T | null {
  return filterLauncherNormalModeItems(items, query, usageByItemId, { ...options, maxResults: 1 })[0] ?? null;
}

export function filterLauncherDirectoryNamespaceItems<T extends LauncherSearchableItem & { filePath?: string; relPath?: string; lastUpdated?: number }>(
  items: T[],
  namespace: LauncherDirectoryNamespace,
  search: string,
): T[] {
  const descendants = items.filter((item) =>
    isDescendantRelPath(item.relPath, namespace.directoryRelPath) ||
    isDescendantPath(item.filePath, namespace.directoryPath)
  );
  const filtered = filterLauncherNamespaceItems(descendants, search);
  return filtered.slice().sort(compareLauncherDirectoryItemsByRecency);
}

function parentLauncherRelPath(relPath: string): string {
  return relPath.split('/').slice(0, -1).join('/');
}

export function getLauncherMoveDirectoryTarget(
  source: LauncherLibraryMoveSource,
  directory: LauncherDirectoryNamespaceCandidate,
): LauncherMoveDirectoryTarget | null {
  if (!directory.rootPath) return null;
  const targetDirRelPath = directory.directoryRelPath;
  if (targetDirRelPath === undefined) return null;
  if (directory.rootPath === source.rootPath && targetDirRelPath === parentLauncherRelPath(source.relPath)) return null;
  const targetBuiltin = directory.rootBuiltin ?? (directory.rootPath === source.rootPath && source.type === 'wiki');
  return {
    sourceRootPath: source.rootPath,
    targetRootPath: directory.rootPath,
    targetDirRelPath,
    targetType: targetBuiltin ? 'wiki' : 'external',
  };
}

export function filterLauncherMoveTargetDirectories<T extends LauncherDirectoryNamespaceCandidate & LauncherSearchableItem>(
  directories: T[],
  source: LauncherLibraryMoveSource,
  query: string,
): T[] {
  return filterLauncherNamespaceItems(
    directories.filter((directory) => getLauncherMoveDirectoryTarget(source, directory)),
    query,
  );
}

export function getLauncherMoveUndoTargetDirRelPath(sourceRelPath: string): string {
  return parentLauncherRelPath(sourceRelPath);
}

export function getLauncherMovedFilePath(
  source: LauncherLibraryMoveSource,
  movedRelPath: string,
  targetRootPath = source.rootPath,
  targetType: 'wiki' | 'external' = source.type,
): string {
  if (targetType === 'wiki') return movedRelPath;
  return joinLauncherPath(targetRootPath, `${movedRelPath}.md`);
}

function formatBookmarkFacetKind(kind: LauncherBookmarkFacetKind): string {
  return kind;
}

function normalizeBookmarkFacetLabel(label: string): string {
  return label.trim().replace(/^@+/, '').toLowerCase();
}

function bookmarkFacetDisplayName(node: Extract<LauncherLibraryNode, { kind: 'file' }>, info: LauncherBookmarkTaxonomyInfo): string {
  const title = node.title.trim();
  if (title && title.toLowerCase() !== 'readme') return title;
  return info.value.replace(/[-_]+/g, ' ');
}

export function flattenBookmarkTaxonomyRootsForLauncher(roots: LauncherLibraryRoot[]): LauncherBookmarkFacetItem[] {
  const byLabel = new Map<string, LauncherBookmarkFacetItem>();

  const visit = (root: LauncherLibraryRoot, node: LauncherLibraryNode) => {
    if (node.kind === 'dir') {
      for (const child of node.children) visit(root, child);
      return;
    }
    if (!root.builtin) return;

    const info = getGeneratedBookmarkTaxonomyPathInfo(node.relPath) ?? getGeneratedBookmarkTaxonomyPathInfo(node.absPath);
    if (!info || info.value.toLowerCase() === 'readme') return;

    const displayName = bookmarkFacetDisplayName(node, info);
    const labelKey = normalizeBookmarkFacetLabel(displayName || info.value);
    if (!labelKey) return;

    const pathKey = node.absPath;
    const existing = byLabel.get(labelKey);
    if (existing) {
      if (!existing.facetPaths.includes(pathKey)) existing.facetPaths.push(pathKey);
      if (!existing.facetKinds.includes(info.kind)) existing.facetKinds.push(info.kind);
      existing.keywords.push(info.value, info.kind, node.relPath, node.name);
      existing.hotkeyDisplay = existing.facetKinds.map(formatBookmarkFacetKind).join('/');
      return;
    }

    byLabel.set(labelKey, {
      id: `bookmark-facet-${labelKey}`,
      type: 'bookmark-facet',
      name: displayName,
      displayName,
      keywords: [
        displayName,
        info.value,
        node.name,
        node.relPath,
        info.kind,
        'bookmark',
        'bookmarks',
      ].filter(Boolean),
      facetPaths: [pathKey],
      facetKinds: [info.kind],
      hotkeyDisplay: formatBookmarkFacetKind(info.kind),
    });
  };

  for (const root of roots) {
    for (const node of root.tree) visit(root, node);
  }

  return [...byLabel.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
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
      lastUpdated: parseLauncherTimestamp(author.lastPostedAt),
    };
  }).filter((item) => item.authorHandle || item.displayName)
    .sort(compareLauncherItemsByRecency);
}

export function buildBookmarkPostLauncherItems(bookmarks: LauncherBookmarkPostSource[]): LauncherBookmarkPostItem[] {
  return bookmarks.map((bookmark): LauncherBookmarkPostItem => {
    const date = formatLauncherBookmarkDate(bookmark.postedAt);
    const handle = bookmark.authorHandle.trim().replace(/^@+/, '');
    const displayName = truncateLauncherBookmarkText(
      bookmark.sourceType === 'web'
        ? (bookmark.title || bookmark.excerpt || bookmark.text || bookmark.url)
        : bookmark.text
    );
    return {
      id: `bookmark-${bookmark.id}`,
      type: 'bookmark',
      name: displayName,
      displayName,
      keywords: [
        bookmark.text,
        bookmark.title ?? '',
        bookmark.domain ?? '',
        bookmark.excerpt ?? '',
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
      lastUpdated: parseLauncherTimestamp(bookmark.postedAt),
    };
  }).sort(compareLauncherItemsByRecency);
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
  const rawQuery = query.trim();
  const rawHandle = handleFromLauncherLabel(rawQuery);
  if (rawHandle) {
    const exactAuthor = authorItems.find((item) => item.authorHandle?.toLowerCase() === rawHandle.toLowerCase());
    return cleanLauncherHandle(exactAuthor?.authorHandle ?? rawHandle);
  }

  const selectedHandle = handleFromLauncherItem(filteredItems[selectedIndex]);
  if (selectedHandle) return selectedHandle;

  return null;
}

export function resolveLauncherDirectoryNamespace(
  filteredItems: LauncherDirectoryNamespaceCandidate[],
  directoryItems: LauncherDirectoryNamespaceCandidate[],
  selectedIndex: number,
  query: string,
): LauncherDirectoryNamespaceCandidate | null {
  const selected = filteredItems[selectedIndex];
  if (selected?.type === 'directory' && selected.directoryPath) return selected;

  const rawQuery = query.trim();
  return directoryItems.find((item) => item.directoryPath && directoryItemMatchesQuery(item, rawQuery)) ?? null;
}

export function resolveLauncherBookmarkFacetNamespace(
  filteredItems: LauncherBookmarkFacetNamespaceCandidate[],
  facetItems: LauncherBookmarkFacetNamespaceCandidate[],
  selectedIndex: number,
  query: string,
): LauncherBookmarkFacetNamespaceCandidate | null {
  const selected = filteredItems[selectedIndex];
  if (selected?.type === 'bookmark-facet' && selected.facetPaths?.length) return selected;

  const rawQuery = query.trim();
  const filteredFacet = filteredItems.find((item) => item.type === 'bookmark-facet' && item.facetPaths?.length);
  if (filteredFacet) return filteredFacet;

  return facetItems.find((item) => item.facetPaths?.length && facetItemMatchesQuery(item, rawQuery)) ?? null;
}

export function resolveLauncherCommandOpenTarget<T extends LauncherCommandOpenCandidate>(
  filteredItems: T[],
  commandItems: T[],
  selectedIndex: number,
  query: string,
  hasExplicitSelection: boolean,
): T | null {
  const selected = filteredItems[selectedIndex];
  const rawQuery = query.trim();
  if (selected?.type === 'command' && selected.filePath && (hasExplicitSelection || !rawQuery)) {
    return selected;
  }
  if (hasExplicitSelection && selected) return null;

  if (!rawQuery) return null;

  const seen = new Set<string>();
  const candidates = [...filteredItems, ...commandItems]
    .filter((item) => {
      if (item.type !== 'command' || !item.filePath) return false;
      if (seen.has(item.filePath)) return false;
      seen.add(item.filePath);
      return true;
    })
    .map((item) => ({ item, score: scoreCommandOpenCandidate(item, rawQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.item ?? null;
}

export function resolveLauncherFieldTheoryOpenTarget<T extends LauncherFieldTheoryTargetCandidate>(
  filteredItems: T[],
  fieldTheoryItems: T[],
  selectedIndex: number,
  query: string,
  hasExplicitSelection: boolean,
): T | null {
  const selected = filteredItems[selectedIndex];
  const rawQuery = query.trim();
  if (selected && getLauncherFieldTheoryMarkdownTarget(selected) && (hasExplicitSelection || !rawQuery)) {
    return selected;
  }

  if (!rawQuery) return null;

  const seen = new Set<string>();
  const candidates = [...filteredItems, ...fieldTheoryItems]
    .filter((item) => {
      const target = getLauncherFieldTheoryMarkdownTarget(item);
      if (!target) return false;
      const key = `${target.kind}:${target.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({ item, score: scoreFieldTheoryOpenCandidate(item, rawQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.item ?? null;
}

export function getLauncherFieldTheoryMarkdownTarget(
  item: LauncherFieldTheoryTargetCandidate,
): LauncherFieldTheoryMarkdownTarget | null {
  if (item.type === 'recent-file') {
    if (item.recentKind === 'wiki' && item.relPath) return { kind: 'wiki', path: item.relPath };
    if (item.recentKind === 'external' && item.filePath) return { kind: 'external', path: item.filePath };
  }
  if (item.type === 'wiki-page' && item.relPath) {
    return { kind: 'wiki', path: item.relPath };
  }
  if (item.type === 'markdown-file' && item.filePath) {
    return { kind: 'external', path: item.filePath };
  }
  if (item.type === 'artifact' && item.filePath) {
    return { kind: 'artifact', path: item.filePath };
  }
  if (item.type === 'command' && item.filePath) {
    return { kind: 'command', path: item.filePath };
  }
  if (item.type === 'handoff' && item.filePath) {
    return { kind: 'external', path: item.filePath };
  }
  if (item.type === 'file' && item.filePath && !item.isDirectory && /\.(md|markdown)$/i.test(item.filePath)) {
    return { kind: 'external', path: item.filePath };
  }
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

export function getLauncherAreaActionIdForQuery(query: string): string | null {
  switch (query.trim().toLowerCase()) {
    case 'clipboard':
      return 'open-history';
    case 'library':
      return 'open-library';
    case 'commands':
      return 'open-library';
    case 'archive':
      return 'archive-current-library-file';
    case 'meeting':
      return 'start-meeting-here';
    default:
      return null;
  }
}

export function buildBuiltInLauncherActions(
  hotkeys: LauncherHotkeyMap,
  isDarkMode: boolean,
  squaresHotkeys: Record<string, string> = DEFAULT_SQUARES_HOTKEYS,
  _showSquaresInCommandLauncher = true
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
      id: 'action-new-meeting-note',
      type: 'action',
      name: 'new meeting',
      displayName: 'New Meeting Note',
      keywords: ['meeting', 'meetings', 'new meeting', 'meeting note', 'notes'],
      actionId: 'new-meeting-note',
    },
    {
      id: 'action-start-meeting-here',
      type: 'action',
      name: 'start meeting',
      displayName: 'Start Meeting Here',
      keywords: ['meeting', 'meetings', 'start meeting', 'record meeting', 'transcribe meeting'],
      actionId: 'start-meeting-here',
    },
    {
      id: 'action-stop-meeting',
      type: 'action',
      name: 'stop meeting',
      displayName: 'Stop Meeting',
      keywords: ['meeting', 'meetings', 'stop meeting', 'finish meeting', 'meeting transcript'],
      actionId: 'stop-meeting',
    },
    {
      id: 'action-summarize-meeting',
      type: 'action',
      name: 'summarize meeting',
      displayName: 'Summarize Meeting',
      keywords: ['meeting', 'meetings', 'summarize meeting', 'meeting summary', 'meeting notes'],
      actionId: 'summarize-meeting',
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
      id: 'action-open-library',
      type: 'action',
      name: 'library',
      displayName: 'Open Library',
      keywords: ['library', 'markdown', 'wiki', 'files', 'commands', 'portable commands', 'command library'],
      actionId: 'open-library',
    },
    {
      id: 'action-line-numbers',
      type: 'action',
      name: 'line numbers',
      displayName: 'Toggle Line Numbers',
      keywords: ['line numbers', 'line number', 'numbers', 'editor lines', 'markdown line numbers'],
      hotkey: 'Shift+Command+K',
      hotkeyDisplay: '⇧ ⌘ K',
      actionId: 'toggle-line-numbers',
    },
    {
      id: 'action-view-bookmarks',
      type: 'action',
      name: 'bookmarks',
      displayName: 'View Bookmarks',
      keywords: ['bookmarks', 'bookmark canvas', 'view bookmarks', 'saved posts', 'saved links', 'library'],
      actionId: 'view-bookmarks',
    },
    {
      id: 'action-save-current-website',
      type: 'action',
      name: 'save website',
      displayName: 'Save Website',
      keywords: ['save website', 'save web page', 'save page', 'bookmark page', 'bookmark website', 'current tab', 'browser', 'markdown'],
      actionId: 'save-current-website',
    },
    {
      id: 'action-move-current-library-file',
      type: 'action',
      name: 'move file',
      displayName: 'Move Current File',
      keywords: ['move', 'move file', 'move current file', 'library move', 'folder'],
      actionId: 'move-current-library-file',
    },
    {
      id: 'action-archive-current-library-file',
      type: 'action',
      name: 'archive',
      displayName: 'Archive Current File',
      keywords: ['archive', 'archive file', 'archive current file', 'library archive', 'e'],
      hotkey: 'E',
      hotkeyDisplay: 'E',
      actionId: 'archive-current-library-file',
    },
    {
      id: 'action-undo-library-move',
      type: 'action',
      name: 'undo move',
      displayName: 'Undo Last Move',
      keywords: ['undo', 'undo move', 'move back', 'restore move', 'library move'],
      actionId: 'undo-library-move',
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
  { actionId: 'horizontalSpread', name: 'spread horizontal', displayName: 'Spread Horizontal', keywords: ['horizontal', 'spread horizontal', 'side by side', 'split'] },
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
