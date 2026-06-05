import React from 'react';
import ReactDOM from 'react-dom/client';
import { useTheme } from './contexts/ThemeContext';
import type { LibrarianSelectedItemType } from './components/LibrarianView';
import {
  LibraryFooterLocalCommandStatusControls,
  LibraryFooterLogo,
  LibraryFooterMaxwellHistoryButton,
  LibraryFooterMaxwellHistoryPopover,
  LibraryFooterSidebarToggle,
  LibraryFooterStatusOverlay,
  LibraryFooterThemeToggleButton,
  LibraryFooterUpdaterStatus,
  useLibraryFooterLocalCommandStatus,
  useLibraryFooterUpdaterStatus,
} from './components/LibraryFooterControls';
import {
  FOCUS_CHROME_ICON_OPACITY,
  LibraryFocusChromeIcon,
} from './components/LibrarySurfaceTopTabs';
import './styles.css';
import {
  isSidebarToggleShortcut,
  RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT,
  RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY,
  RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT,
  RENDERED_EDIT_CLICK_MODE_STORAGE_KEY,
  RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT,
  RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY,
  SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY,
  TEXT_CURSOR_BLINK_CHANGED_EVENT,
  TEXT_CURSOR_BLINK_STORAGE_KEY,
} from './utils/editorShortcuts';
import {
  buildHotkeyString,
  hasNonShiftModifierHotkey,
  normalizeHotkeyForComparison,
} from './utils/hotkeys';
import { commandPathToLauncherLibraryOpenTarget, type LauncherLibraryRootPath } from './commandLauncherUtils';
import { BROWSER_LIBRARY_RENDERER_STORAGE_KEYS } from '../electron/shared/browserLibraryRendererStorage';
import {
  browserLibraryTargetFromSearchParams,
  normalizeBrowserLibraryOpenTarget,
  type FieldTheoryMarkdownTarget,
} from '../electron/shared/fieldTheoryMarkdownTarget';
import {
  getAppBracketNavigationDirection,
  popAppBackHistory,
  popAppForwardHistory,
  pushAppNavigationHistory,
  type AppNavigationSurface,
} from './utils/clipboardHistoryRestore';
import {
  FOCUS_CHROME_EDGE_FULL_OPACITY_DISTANCE_PX,
  FOCUS_CHROME_GROUP_REVEAL_DISTANCE_PX,
  FOCUS_CHROME_TOP_FULL_OPACITY_DISTANCE_PX,
  getFocusChromeSurfaceOpacity,
  getGroupedFocusChromeProximityOpacity,
  isClientPointOutsideBounds,
} from './utils/focusChrome';

type BrowserHelperConfig = {
  api: string;
  token: string;
  clientId: string;
};

type RequestOptions = RequestInit & {
  json?: unknown;
  allowErrorResult?: boolean;
};

declare global {
  interface Window {
    __fieldTheoryBrowserLibraryErrors?: Array<{
      type: string;
      message: string;
      filename?: string;
      lineno?: number;
      colno?: number;
      stack?: string;
    }>;
    __fieldTheoryBrowserLibraryRequestTimings?: BrowserHelperRequestTimingEntry[];
    __fieldTheoryBrowserOpenMarkdownTarget?: (target: any) => boolean;
    __fieldTheoryBrowserActiveSurface?: BrowserHelperClientSurfaceName;
    __fieldTheoryBrowserReportActiveSurface?: (surface: BrowserHelperClientSurfaceName) => void;
    fieldTheoryBookmarkMediaAPI?: {
      mediaUrl: (filename: string) => string;
    };
    fieldTheoryLocalImageAPI?: {
      localImageUrl: (url: string) => string;
    };
  }
}

const noopUnsubscribe = () => {};
const LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY = 'librarian-sidebar-collapsed';
const LIBRARIAN_IMMERSIVE_STORAGE_KEY = 'librarian-immersive';
const BROWSER_LIBRARY_SET_FULLSCREEN_EVENT = 'fieldtheory:browser-library-set-fullscreen';
const RENDERER_STORAGE_SYNC_KEYS = BROWSER_LIBRARY_RENDERER_STORAGE_KEYS;
const RENDERER_STORAGE_SYNC_KEY_SET = new Set<string>(RENDERER_STORAGE_SYNC_KEYS);
const RENDERER_STORAGE_CHANGED_EVENT_BY_KEY = new Map<string, string>([
  [RENDERED_EDIT_CLICK_MODE_STORAGE_KEY, RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT],
  [TEXT_CURSOR_BLINK_STORAGE_KEY, TEXT_CURSOR_BLINK_CHANGED_EVENT],
  [RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY, RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT],
  [RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY, RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT],
  [SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY, 'fieldtheory:shared-file-toggle-hotkey-changed'],
]);
type RendererStorageApplyOptions = {
  fillMissingOnly?: boolean;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

type RendererStorageResponse = {
  available: boolean;
  values: Record<string, string | null>;
};
type BrowserCreatedCommand = { path: string; name: string };
type BrowserHelperRequestTimingEntry = {
  path: string;
  method: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  startedAt: number;
  error?: string;
};

export const BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT = 'fieldtheory:browser-helper-event-stream-open';
export const BROWSER_HELPER_REQUEST_TIMING_EVENT = 'fieldtheory:browser-helper-request-timing';

type BrowserLibrarySurfaceName = 'library' | 'commands';
type BrowserHelperClientSurfaceName = BrowserLibrarySurfaceName | 'bookmarks' | 'ember';
const BROWSER_HELPER_RECONNECT_REFRESH_EVENT_TYPES = [
  'wiki:changed',
  'library:changed',
  'recent:changed',
  'bookmarks:changed',
];
const BROWSER_HELPER_COALESCED_REFRESH_EVENT_TYPES = new Set(BROWSER_HELPER_RECONNECT_REFRESH_EVENT_TYPES);
const BROWSER_HELPER_REFRESH_COALESCE_MS = 75;
const BROWSER_HELPER_REQUEST_TIMING_LIMIT = 120;

export function mergeBrowserHelperRefreshDetail(type: string, previous: any, detail: any, sources: string[]): any {
  const nextDetail = { ...previous, ...detail, sources };
  if (type === 'recent:changed' && !Object.prototype.hasOwnProperty.call(detail ?? {}, 'entries')) {
    delete nextDetail.entries;
  }
  return nextDetail;
}

export function getBrowserLibraryInitialOpenTarget(location: Pick<Location, 'search'>): any | null {
  return browserLibraryTargetFromSearchParams(new URLSearchParams(location.search));
}

function browserLibrarySurfaceToAppNavigationSurface(surface: BrowserLibrarySurfaceName): AppNavigationSurface {
  return surface === 'commands' ? 'commands' : 'librarian';
}

function appNavigationSurfaceToBrowserLibrarySurface(surface: AppNavigationSurface): BrowserLibrarySurfaceName | null {
  if (surface === 'commands') return 'commands';
  if (surface === 'librarian') return 'library';
  return null;
}

function initialBrowserClientSurfaceFromTarget(target: FieldTheoryMarkdownTarget | null): BrowserHelperClientSurfaceName {
  if (target?.kind === 'commands') return 'commands';
  if (target?.kind === 'bookmarks') return 'bookmarks';
  if (target?.kind === 'ember') return 'ember';
  return 'library';
}

export function isBrowserLibraryIncludedOpenTarget(target: unknown): boolean {
  return Boolean(normalizeBrowserLibraryOpenTarget(target));
}

class BrowserLibraryErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    window.__fieldTheoryBrowserLibraryErrors?.push({
      type: 'render',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  render() {
    if (this.state.error) {
      return <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>Field Theory Library failed to render: {this.state.error}</div>;
    }
    return this.props.children;
  }
}

function readBrowserHelperConfig(): BrowserHelperConfig {
  const params = new URLSearchParams(window.location.search);
  const api = params.get('api') ?? window.location.origin;
  const token = params.get('token') ?? '';
  return { api: api.replace(/\/$/, ''), token, clientId: readBrowserClientId() };
}

function readBrowserClientId(): string {
  const key = 'fieldtheory.browserLibrary.clientId';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clientId = generated.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  window.sessionStorage.setItem(key, clientId);
  return clientId;
}

export function createBrowserHelperClient(config: BrowserHelperConfig) {
  return async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const startedAt = performance.now();
    const method = options.method ?? 'GET';
    let status: number | null = null;
    try {
      const response = await fetch(`${config.api}${path}`, {
        ...options,
        body: options.json === undefined ? options.body : JSON.stringify(options.json),
        headers: {
          'X-FieldTheory-Browser-Token': config.token,
          'X-FieldTheory-Browser-Client': config.clientId,
          ...(options.json === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers ?? {}),
        },
      });
      status = response.status;
      const body = await response.json().catch(() => ({}));
      if (options.allowErrorResult && body && typeof body === 'object' && 'result' in body) {
        recordBrowserHelperRequestTiming({ path, method, status, ok: response.ok, startedAt });
        return body as T;
      }
      if (!response.ok || body.ok === false) {
        throw new Error(body.error ?? body.result?.reason ?? `Request failed: ${response.status}`);
      }
      recordBrowserHelperRequestTiming({ path, method, status, ok: true, startedAt });
      return body as T;
    } catch (error) {
      recordBrowserHelperRequestTiming({
        path,
        method,
        status,
        ok: false,
        startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

function recordBrowserHelperRequestTiming(input: Omit<BrowserHelperRequestTimingEntry, 'durationMs'>): void {
  const entry: BrowserHelperRequestTimingEntry = {
    ...input,
    durationMs: Math.round((performance.now() - input.startedAt) * 10) / 10,
  };
  const timings = window.__fieldTheoryBrowserLibraryRequestTimings ?? [];
  timings.push(entry);
  if (timings.length > BROWSER_HELPER_REQUEST_TIMING_LIMIT) {
    timings.splice(0, timings.length - BROWSER_HELPER_REQUEST_TIMING_LIMIT);
  }
  window.__fieldTheoryBrowserLibraryRequestTimings = timings;
  window.dispatchEvent(new CustomEvent(BROWSER_HELPER_REQUEST_TIMING_EVENT, { detail: entry }));
}

function installBookmarkMediaResolver(config: BrowserHelperConfig): void {
  window.fieldTheoryBookmarkMediaAPI = {
    mediaUrl: (filename: string) => (
      `${config.api}/native/bookmarks/media/${encodeURIComponent(filename)}?token=${encodeURIComponent(config.token)}`
    ),
  };
}

function installLocalImageResolver(config: BrowserHelperConfig): void {
  window.fieldTheoryLocalImageAPI = {
    localImageUrl: (url: string) => (
      `${config.api}/native/local-image?token=${encodeURIComponent(config.token)}&url=${encodeURIComponent(url)}`
    ),
  };
}

function createBrowserEventHub(config: BrowserHelperConfig) {
  const listeners = new Map<string, Set<(detail: any) => void>>();
  const coalescedRefreshDetails = new Map<string, any>();
  const coalescedRefreshTimers = new Map<string, number>();
  let eventSource: EventSource | null = null;
  const notifyListeners = (type: string, detail: any) => {
    listeners.get(type)?.forEach((listener) => listener(detail));
  };
  const notifyChangedListeners = (type: string, detail: any) => {
    if (!BROWSER_HELPER_COALESCED_REFRESH_EVENT_TYPES.has(type)) {
      notifyListeners(type, detail);
      return;
    }
    const previous = coalescedRefreshDetails.get(type);
    const previousSources = Array.isArray(previous?.sources)
      ? previous.sources
      : previous
        ? [previous.source ?? type]
        : [];
    const sources = [
      ...new Set([
        ...previousSources,
        detail?.reconnect ? 'reconnect' : type,
      ]),
    ];
    coalescedRefreshDetails.set(type, mergeBrowserHelperRefreshDetail(type, previous, detail, sources));
    if (coalescedRefreshTimers.has(type)) return;
    const timer = window.setTimeout(() => {
      coalescedRefreshTimers.delete(type);
      const nextDetail = coalescedRefreshDetails.get(type) ?? {};
      coalescedRefreshDetails.delete(type);
      notifyListeners(type, nextDetail);
    }, BROWSER_HELPER_REFRESH_COALESCE_MS);
    coalescedRefreshTimers.set(type, timer);
  };

  const ensureEventSource = () => {
    if (eventSource) return;
    eventSource = new EventSource(`${config.api}/native/events?token=${encodeURIComponent(config.token)}&clientId=${encodeURIComponent(config.clientId)}`);
    eventSource.onopen = () => {
      window.dispatchEvent(new Event(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT));
      for (const type of BROWSER_HELPER_RECONNECT_REFRESH_EVENT_TYPES) {
        notifyChangedListeners(type, { reconnect: true });
      }
    };
    for (const type of [
      'wiki:changed',
      'wiki:deleted',
      'wiki:renamed',
      'wiki:openPage',
      'wiki:openScratchpad',
      'library:changed',
      'library:renamed',
      'external:openPage',
      'librarian:readingAdded',
      'librarian:readingUpdated',
      'librarian:readingRemoved',
      'librarian:readingRenamed',
      'librarian:newReadingAvailable',
      'librarian:showNewReading',
      'librarian:showReading',
      'librarian:setFullscreen',
      'librarian:insertMarkdownText',
      'librarian:insertPlainMarkdownText',
      'librarian:replaceSelectedMarkdownText',
      'recent:changed',
      'taggedDocs:updated',
      'taggedDocs:scanProgress',
      'sharedFiles:presenceChanged',
      'sharedFiles:pinsChanged',
      'commands:changed',
      'commands:directoryChanged',
      'commands:localCommandStatus',
      'commands:openMarkdownFromLauncher',
      'commands:toggleLineNumbersFromLauncher',
      'meetings:status',
      'auth:sessionChanged',
      'quota:tierChanged',
      'quota:changed',
      'team:changed',
      'bookmarks:changed',
      'updater:checkingForUpdate',
      'updater:updateAvailable',
      'updater:updateNotAvailable',
      'updater:downloadProgress',
      'updater:updateDownloaded',
      'updater:installing',
      'updater:error',
      'agent:kickoffProgress',
      'agent:kickoffStatus',
      'theme:changed',
      'renderer-storage:changed',
    ]) {
      eventSource.addEventListener(type, (event) => {
        const detail = parseBrowserEventDetail(event);
        notifyChangedListeners(type, detail);
      });
    }
  };

  return {
    on(type: string, listener: (detail: any) => void) {
      ensureEventSource();
      const typeListeners = listeners.get(type) ?? new Set<(detail: any) => void>();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
      return () => {
        typeListeners.delete(listener);
        if (typeListeners.size === 0) listeners.delete(type);
        if (listeners.size === 0) {
          eventSource?.close();
          eventSource = null;
          coalescedRefreshTimers.forEach((timer) => window.clearTimeout(timer));
          coalescedRefreshTimers.clear();
          coalescedRefreshDetails.clear();
        }
      };
    },
  };
}

function parseBrowserEventDetail(event: Event): any {
  const data = (event as MessageEvent).data;
  if (typeof data !== 'string' || data.length === 0) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function applyRendererStorageChangeFromNative(
  detail: { key?: unknown; value?: unknown },
  options: RendererStorageApplyOptions,
): void {
  const key = typeof detail.key === 'string' ? detail.key : '';
  if (!RENDERER_STORAGE_SYNC_KEY_SET.has(key)) return;
  const value = typeof detail.value === 'string' ? detail.value : null;
  const currentValue = window.localStorage.getItem(key);
  if (currentValue === value) return;
  if (value === null) {
    const removeItem = options.removeItem ?? window.localStorage.removeItem.bind(window.localStorage);
    removeItem(key);
  } else {
    const setItem = options.setItem ?? window.localStorage.setItem.bind(window.localStorage);
    setItem(key, value);
  }
  dispatchRendererStorageChange(key, currentValue, value);
}

function dispatchRendererStorageChange(key: string, oldValue: string | null, newValue: string | null): void {
  try {
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      oldValue,
      newValue,
      storageArea: window.localStorage,
      url: window.location.href,
    }));
  } catch {
    window.dispatchEvent(new Event('storage'));
  }
  window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
    detail: { key, oldValue, newValue },
  }));
  const changedEvent = RENDERER_STORAGE_CHANGED_EVENT_BY_KEY.get(key);
  if (changedEvent) window.dispatchEvent(new Event(changedEvent));
}

export async function syncRendererStorage(
  request: ReturnType<typeof createBrowserHelperClient>,
  options: RendererStorageApplyOptions = {},
): Promise<void> {
  const response = await request<RendererStorageResponse>('/native/renderer-storage')
    .catch((): RendererStorageResponse => ({ available: false, values: {} }));
  if (!response.available) return;
  const values = response.values;
  const setItem = options.setItem ?? window.localStorage.setItem.bind(window.localStorage);
  const removeItem = options.removeItem ?? window.localStorage.removeItem.bind(window.localStorage);
  for (const key of RENDERER_STORAGE_SYNC_KEYS) {
    const value = values[key];
    const currentValue = window.localStorage.getItem(key);
    if (typeof value === 'string') {
      if (options.fillMissingOnly && currentValue !== null) continue;
      if (currentValue === value) continue;
      setItem(key, value);
      dispatchRendererStorageChange(key, currentValue, value);
    } else if (!options.fillMissingOnly && currentValue !== null) {
      removeItem(key);
      dispatchRendererStorageChange(key, currentValue, null);
    }
  }
}

function installRendererStorageWriteThrough(request: ReturnType<typeof createBrowserHelperClient>): RendererStorageApplyOptions {
  const storage = window.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  const originalRemoveItem = storage.removeItem.bind(storage);

  storage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    if (RENDERER_STORAGE_SYNC_KEY_SET.has(key)) {
      void request('/native/renderer-storage', { method: 'POST', json: { key, value } }).catch(() => {});
    }
  };

  storage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (RENDERER_STORAGE_SYNC_KEY_SET.has(key)) {
      void request('/native/renderer-storage', { method: 'POST', json: { key, value: null } }).catch(() => {});
    }
  };

  return { setItem: originalSetItem, removeItem: originalRemoveItem };
}

export function startRendererStorageForegroundRefresh(
  request: ReturnType<typeof createBrowserHelperClient>,
  storageApplyOptions: RendererStorageApplyOptions,
): () => void {
  let inFlight = false;
  const refresh = () => {
    if (document.visibilityState === 'hidden') return;
    if (inFlight) return;
    inFlight = true;
    void syncRendererStorage(request, storageApplyOptions).finally(() => {
      inFlight = false;
    });
  };
  const refreshWhenVisible = () => {
    if (document.visibilityState !== 'hidden') refresh();
  };
  const cleanup = () => {
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refreshWhenVisible);
    window.removeEventListener('beforeunload', cleanup);
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refreshWhenVisible);
  window.addEventListener('beforeunload', cleanup, { once: true });
  return cleanup;
}

function startRendererStorageEventSync(
  events: ReturnType<typeof createBrowserEventHub>,
  storageApplyOptions: RendererStorageApplyOptions,
): () => void {
  return events.on('renderer-storage:changed', (detail) => {
    applyRendererStorageChangeFromNative(detail, storageApplyOptions);
  });
}

export async function setBrowserActiveLibraryFileContext(
  request: ReturnType<typeof createBrowserHelperClient>,
  context: unknown,
): Promise<boolean> {
  const result = await request<{ ok: boolean }>(
    '/native/current',
    context ? { method: 'POST', json: context } : { method: 'DELETE' },
  ).catch(() => ({ ok: false }));
  return result.ok === true;
}

export function normalizeBrowserCreatedCommand(command: unknown): BrowserCreatedCommand | null {
  if (!command || typeof command !== 'object') return null;
  const record = command as Record<string, unknown>;
  const commandPath = typeof record.path === 'string'
    ? record.path
    : typeof record.filePath === 'string'
      ? record.filePath
      : '';
  const commandName = typeof record.name === 'string'
    ? record.name
    : typeof record.displayName === 'string'
      ? record.displayName
      : '';
  if (!commandPath || !commandName) return null;
  return { path: commandPath, name: commandName };
}

export async function browserCreateCommand(
  request: ReturnType<typeof createBrowserHelperClient>,
  directoryPath: string,
  name: string,
  content?: string,
): Promise<BrowserCreatedCommand | null> {
  const response = await request<{ command: unknown }>('/native/commands/by-path', {
    method: 'POST',
    json: { directoryPath, name, content },
  });
  return normalizeBrowserCreatedCommand(response.command);
}

export async function browserArchiveActiveLibraryFile(
  request: ReturnType<typeof createBrowserHelperClient>,
): Promise<{ success: boolean; error?: string }> {
  const response = await request<{ result: { success: boolean; error?: string } }>('/native/commands/archive-active-library-file', {
    method: 'POST',
  });
  return response.result;
}

export async function browserToggleActiveLibraryLineNumbers(
  request: ReturnType<typeof createBrowserHelperClient>,
): Promise<{ success: boolean; error?: string }> {
  const response = await request<{ result: { success: boolean; error?: string } }>('/native/commands/toggle-active-line-numbers', {
    method: 'POST',
  });
  return response.result;
}

export async function browserShellOpenExternal(
  request: ReturnType<typeof createBrowserHelperClient>,
  href: string,
): Promise<void> {
  await request('/native/shell/open-external', {
    method: 'POST',
    json: { href },
  }).catch(() => {
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  });
}

export async function browserShellShowItemInFolder(
  request: ReturnType<typeof createBrowserHelperClient>,
  filePath: string,
): Promise<void> {
  await request('/native/shell/show-item-in-folder', {
    method: 'POST',
    json: { filePath },
  }).catch(() => {});
}

export async function browserShellSetRepresentedFilename(
  request: ReturnType<typeof createBrowserHelperClient>,
  filePath: string,
  clientId: string,
): Promise<void> {
  await request('/native/shell/represented-filename', {
    method: 'POST',
    json: { filePath, clientId },
  });
}

function startBrowserSurfaceActivityReporting(request: ReturnType<typeof createBrowserHelperClient>): void {
  let lastReportedAt = 0;
  const clearActiveBrowserOwnership = () => {
    void request('/native/client-active', { method: 'DELETE' }).catch(() => {});
    void request('/native/current', { method: 'DELETE' }).catch(() => {});
    void request('/native/librarian/editor-focused', {
      method: 'POST',
      json: { focused: false },
    }).catch(() => {});
  };
  const reportActive = () => {
    const now = Date.now();
    if (now - lastReportedAt < 500) return;
    lastReportedAt = now;
    const surface = window.__fieldTheoryBrowserActiveSurface ?? 'library';
    void request('/native/client-active', { method: 'POST', json: { surface } }).catch(() => {});
  };
  const reportVisibleActive = () => {
    if (document.visibilityState === 'hidden') {
      clearActiveBrowserOwnership();
      return;
    }
    reportActive();
  };
  reportVisibleActive();
  window.addEventListener('focus', reportVisibleActive);
  window.addEventListener('pointerdown', reportVisibleActive, true);
  window.addEventListener('keydown', reportVisibleActive, true);
  document.addEventListener('visibilitychange', reportVisibleActive);
  window.addEventListener('beforeunload', () => {
    clearActiveBrowserOwnership();
    window.removeEventListener('focus', reportVisibleActive);
    window.removeEventListener('pointerdown', reportVisibleActive, true);
    window.removeEventListener('keydown', reportVisibleActive, true);
    document.removeEventListener('visibilitychange', reportVisibleActive);
  }, { once: true });
}

export async function installBrowserLibraryHost(config: BrowserHelperConfig): Promise<void> {
  const request = createBrowserHelperClient(config);
  const events = createBrowserEventHub(config);
  installBookmarkMediaResolver(config);
  installLocalImageResolver(config);
  window.__fieldTheoryBrowserActiveSurface = 'library';
  window.__fieldTheoryBrowserReportActiveSurface = (surface) => {
    window.__fieldTheoryBrowserActiveSurface = surface;
    void request('/native/client-active', { method: 'POST', json: { surface } }).catch(() => {});
  };
  await syncRendererStorage(request);
  const storageApplyOptions = installRendererStorageWriteThrough(request);
  startRendererStorageEventSync(events, storageApplyOptions);
  startRendererStorageForegroundRefresh(request, storageApplyOptions);
  startBrowserSurfaceActivityReporting(request);

  window.themeAPI = {
    initialTheme: false,
    getTheme: async () => (
      await request<{ isDark: boolean }>('/native/theme')
    ).isDark,
    setTheme: async (isDark: boolean) => {
      await request('/native/theme', { method: 'POST', json: { isDark } });
    },
    onThemeChanged: (callback: (isDark: boolean) => void) => (
      events.on('theme:changed', (detail) => callback(detail.isDark === true))
    ),
  } as any;

  window.hotkeyAPI = {
    getHotkey: async (id: string) => (
      await request<{ hotkey: string | null }>(`/native/hotkey?id=${encodeURIComponent(id)}`)
    ).hotkey,
  } as any;

  window.libraryAPI = {
    getRoots: async () => (await request<{ roots: unknown[] }>('/native/library/roots')).roots,
    addRoot: async (dirPath: string) => (
      await request<{ root: unknown }>('/native/library/root', {
        method: 'POST',
        json: { dirPath },
      })
    ).root,
    removeRoot: async (dirPath: string) => (
      await request<{ ok: boolean }>('/native/library/root', {
        method: 'DELETE',
        json: { dirPath },
      })
    ).ok,
    getHiddenFolders: async () => (await request<{ hiddenFolders: string[] }>('/native/library/hidden-folders')).hiddenFolders,
    setFolderHidden: async (folderId: string, hidden: boolean) => (
      await request<{ hiddenFolders: string[] }>('/native/library/hidden-folders', {
        method: 'POST',
        json: { folderId, hidden },
      })
    ).hiddenFolders,
    createFile: async (rootPath: string, folderRelPath: string, fileName: string) => (
      await request<{ page: unknown }>('/native/library/file', {
        method: 'POST',
        json: { rootPath, folderRelPath, fileName },
      })
    ).page,
    createDir: async (rootPath: string, dirRelPath: string) => (
      await request<{ ok: boolean }>('/native/library/dir', {
        method: 'POST',
        json: { rootPath, dirRelPath },
      })
    ).ok,
    deleteDir: async (rootPath: string, dirRelPath: string) => (
      await request<{ ok: boolean }>('/native/library/dir', {
        method: 'DELETE',
        json: { rootPath, dirRelPath },
      })
    ).ok,
    moveItem: async (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string) => (
      await request<{ newRelPath: string }>('/native/library/move', {
        method: 'POST',
        json: { rootPath, kind, sourceRelPath, targetDirRelPath, targetRootPath },
      })
    ).newRelPath,
    pickFolder: async () => (
      await request<{ dirPath: string | null }>('/native/library/pick-folder', { method: 'POST' })
    ).dirPath,
    openDocumentWindow: async (target: unknown) => (
      await request<{ result: unknown }>('/native/library/open-document-window', {
        method: 'POST',
        json: target,
      })
    ).result,
    onRootsChanged: (callback: (event?: unknown) => void) => events.on('library:changed', (detail) => callback(detail?.event)),
    onItemRenamed: (callback: (event: unknown) => void) => events.on('library:renamed', (detail) => callback(detail.event)),
  } as any;

  window.wikiAPI = {
    getTree: async () => (await request<{ tree: unknown[] }>('/native/wiki/tree')).tree,
    getPage: async (relPath: string) => (
      await request<{ page: unknown }>(`/native/wiki/page?relPath=${encodeURIComponent(relPath)}`)
    ).page,
    findPageByDocumentVersion: async (version: unknown, previousRelPath?: string) => (
      await request<{ page: unknown }>('/native/wiki/find-by-document-version', {
        method: 'POST',
        json: { version, previousRelPath },
      })
    ).page,
    save: async (relPath: string, content: string, expectedVersion?: unknown) => (
      await request<{ result: unknown }>('/native/wiki/page', {
        method: 'PUT',
        json: { relPath, content, expectedVersion },
        allowErrorResult: true,
      })
    ).result,
    createFile: async (folderRelPath: string, fileName: string) => (
      await request<{ page: unknown }>('/native/wiki/file', {
        method: 'POST',
        json: { folderRelPath, fileName },
      })
    ).page,
    createFileWithDefaultTitle: async (folderRelPath: string) => (
      await request<{ page: unknown }>('/native/wiki/default-file', {
        method: 'POST',
        json: { folderRelPath },
      })
    ).page,
    createScratchpadDefault: async () => (
      await request<{ page: unknown }>('/native/wiki/scratchpad-default', { method: 'POST' })
    ).page,
    openScratchpadDefault: async () => (
      await request<{ page: unknown }>('/native/wiki/open-scratchpad-default', { method: 'POST' })
    ).page,
    createDir: async (dirRelPath: string) => (
      await request<{ ok: boolean }>('/native/wiki/dir', {
        method: 'POST',
        json: { dirRelPath },
      })
    ).ok,
    rename: async (relPath: string, newName: string) => (
      await request<{ newRelPath: string }>('/native/wiki/rename', {
        method: 'POST',
        json: { relPath, newName },
      })
    ).newRelPath,
    deletePage: async (relPath: string) => (
      await request<{ ok: boolean }>('/native/wiki/page', {
        method: 'DELETE',
        json: { relPath },
      })
    ).ok,
    onPageChanged: (callback: (event?: unknown) => void) => events.on('wiki:changed', (detail) => callback(detail?.event)),
    onPageDeleted: (callback: (relPath: string) => void) => events.on('wiki:deleted', (detail) => callback(detail.relPath)),
    onPageRenamed: (callback: (event: unknown) => void) => events.on('wiki:renamed', (detail) => callback(detail.event)),
    onOpenWikiPage: (callback: (relPath: string) => void) => events.on('wiki:openPage', (detail) => callback(detail.relPath)),
    onOpenScratchpad: (callback: (relPath: string) => void) => events.on('wiki:openScratchpad', (detail) => callback(detail.relPath)),
  } as any;

  window.externalAPI = {
    open: async (filePath: string) => (
      await request<{ file: unknown }>(`/native/external/open?path=${encodeURIComponent(filePath)}`)
    ).file,
    save: async (filePath: string, content: string, expectedVersion?: unknown) => (
      await request<{ result: unknown }>('/native/external/save', {
        method: 'PUT',
        json: { path: filePath, content, expectedVersion },
        allowErrorResult: true,
      })
    ).result,
    findLibraryFileByDocumentVersion: async (version: unknown, previousAbsPath?: string) => (
      await request<{ file: unknown }>('/native/external/find-by-document-version', {
        method: 'POST',
        json: { version, previousAbsPath },
      })
    ).file,
    rename: async (filePath: string, newName: string) => (
      await request<{ file: unknown }>('/native/external/rename', {
        method: 'POST',
        json: { path: filePath, newName },
      })
    ).file,
    delete: async (filePath: string) => (
      await request<{ ok: boolean }>('/native/external/file', {
        method: 'DELETE',
        json: { path: filePath },
      })
    ).ok,
    onOpenExternal: (callback: (absPath: string) => void) => events.on('external:openPage', (detail) => callback(detail.absPath)),
  } as any;

  window.librarianAPI = {
    isEnabled: async () => (
      await request<{ enabled: boolean }>('/native/librarian/enabled')
    ).enabled,
    setEnabled: async (enabled: boolean) => (
      await request<{ enabled: boolean }>('/native/librarian/enabled', {
        method: 'POST',
        json: { enabled },
      })
    ).enabled,
    isSetupComplete: async () => (
      await request<{ complete: boolean }>('/native/librarian/setup-complete')
    ).complete,
    setSetupComplete: async (complete: boolean) => {
      await request('/native/librarian/setup-complete', {
        method: 'POST',
        json: { complete },
      });
    },
    createWelcomeArtifact: async (dirPath: string) => (
      await request<{ created: boolean }>('/native/librarian/welcome-artifact', {
        method: 'POST',
        json: { dirPath },
      })
    ).created,
    getWatchedDirs: async () => (
      await request<{ dirs: unknown[] }>('/native/librarian/watched-dirs')
    ).dirs,
    addWatchedDir: async (dirPath: string) => (
      await request<{ dir: unknown }>('/native/librarian/watched-dirs', {
        method: 'POST',
        json: { dirPath },
      })
    ).dir,
    removeWatchedDir: async (dirPath: string) => (
      await request<{ success: boolean }>('/native/librarian/watched-dirs', {
        method: 'DELETE',
        json: { dirPath },
      })
    ).success,
    browseDirectory: async () => (
      await request<{ dirPath: string | null }>('/native/librarian/browse-directory')
    ).dirPath,
    getDiscoveryFrequency: async () => (
      await request<{ frequency: string }>('/native/librarian/discovery-frequency')
    ).frequency,
    setDiscoveryFrequency: async (frequency: string) => (
      await request<{ success: boolean }>('/native/librarian/discovery-frequency', {
        method: 'POST',
        json: { frequency },
      })
    ).success,
    getUserExpertiseContext: async () => {
      const response = await request<{ context: string | null }>('/native/librarian/user-expertise-context');
      return response.context ?? undefined;
    },
    setUserExpertiseContext: async (context: string | undefined) => (
      await request<{ success: boolean }>('/native/librarian/user-expertise-context', {
        method: 'POST',
        json: { context },
      })
    ).success,
    getClaudeCodeStatus: async () => (
      await request<{ status: string }>('/native/librarian/claude-code-status')
    ).status,
    isStateEnforcedHookInstalled: async () => (
      await request<{ installed: boolean }>('/native/librarian/state-enforced-hook')
    ).installed,
    installStateEnforcedHook: async () => (
      await request<{ success: boolean }>('/native/librarian/state-enforced-hook', { method: 'POST' })
    ).success,
    uninstallStateEnforcedHook: async () => (
      await request<{ success: boolean }>('/native/librarian/state-enforced-hook', { method: 'DELETE' })
    ).success,
    isCursorHookInstalled: async () => (
      await request<{ installed: boolean }>('/native/librarian/cursor-hook')
    ).installed,
    installCursorHook: async () => (
      await request<{ success: boolean }>('/native/librarian/cursor-hook', { method: 'POST' })
    ).success,
    uninstallCursorHook: async () => (
      await request<{ success: boolean }>('/native/librarian/cursor-hook', { method: 'DELETE' })
    ).success,
    isCodexHookInstalled: async () => (
      await request<{ installed: boolean }>('/native/librarian/codex-hook')
    ).installed,
    installCodexHook: async () => (
      await request<{ success: boolean }>('/native/librarian/codex-hook', { method: 'POST' })
    ).success,
    uninstallCodexHook: async () => (
      await request<{ success: boolean }>('/native/librarian/codex-hook', { method: 'DELETE' })
    ).success,
    getReadings: async () => (await request<{ readings: unknown[] }>('/native/librarian/readings')).readings,
    getReading: async (filePath: string) => (
      await request<{ reading: unknown }>(`/native/librarian/reading?path=${encodeURIComponent(filePath)}`)
    ).reading,
    saveReading: async (filePath: string, content: string, expectedVersion?: unknown) => (
      await request<{ result: unknown }>('/native/librarian/reading', {
        method: 'PUT',
        json: { filePath, content, expectedVersion },
        allowErrorResult: true,
      })
    ).result,
    deleteReading: async (filePath: string) => (
      await request<{ ok: boolean }>('/native/librarian/reading', {
        method: 'DELETE',
        json: { filePath },
      })
    ).ok,
    getShareStatus: async (filePath: string) => (
      await request<{ status: unknown }>(`/native/librarian/share-status?path=${encodeURIComponent(filePath)}`)
    ).status,
    shareReading: async (filePath: string) => (
      await request<{ result: unknown }>('/native/librarian/share-reading', {
        method: 'POST',
        json: { filePath },
      })
    ).result,
    unshareReading: async (filePath: string) => (
      await request<{ success: boolean }>('/native/librarian/unshare-reading', {
        method: 'POST',
        json: { filePath },
      })
    ).success,
    updateSharedReading: async (filePath: string, content: string, title: string) => (
      await request<{ success: boolean }>('/native/librarian/update-shared-reading', {
        method: 'POST',
        json: { filePath, content, title },
      })
    ).success,
    pollStatus: async () => (
      await request<{ status: unknown }>('/native/librarian/status')
    ).status,
    isMutedForToday: async () => (
      await request<{ muted: boolean }>('/native/librarian/muted-for-today')
    ).muted,
    muteForToday: async () => (
      await request<{ muted: boolean }>('/native/librarian/mute-for-today', { method: 'POST' })
    ).muted,
    unmute: async () => (
      await request<{ muted: boolean }>('/native/librarian/unmute', { method: 'POST' })
    ).muted === false,
    setImmersiveDismissable: async (dismissable: boolean) => {
      await request('/native/librarian/immersive-dismissable', {
        method: 'POST',
        json: { dismissable, clientId: config.clientId },
      }).catch(() => {});
    },
    setSizeKey: async (key: 'fields' | 'library' | 'canvas' | 'draw') => {
      await request('/native/librarian/size-key', {
        method: 'POST',
        json: { key, clientId: config.clientId },
      }).catch(() => {});
    },
    setMarkdownEditorFocused: async (focused: boolean) => {
      await request('/native/librarian/editor-focused', { method: 'POST', json: { focused, clientId: config.clientId } }).catch(() => {});
    },
    onReadingAdded: (callback: (reading: unknown) => void) => events.on('librarian:readingAdded', (detail) => callback(detail.reading)),
    onReadingUpdated: (callback: (reading: unknown) => void) => events.on('librarian:readingUpdated', (detail) => callback(detail.reading)),
    onReadingRemoved: (callback: (filePath: string) => void) => events.on('librarian:readingRemoved', (detail) => callback(detail.filePath)),
    onReadingRenamed: (callback: (event: unknown) => void) => events.on('librarian:readingRenamed', (detail) => callback(detail.event)),
    onNewReadingAvailable: (callback: (readingPath: string) => void) => events.on('librarian:newReadingAvailable', (detail) => callback(detail.readingPath)),
    onShowNewReading: (callback: (readingPath: string) => void) => events.on('librarian:showNewReading', (detail) => callback(detail.readingPath)),
    onShowReading: (callback: (readingPath: string) => void) => events.on('librarian:showReading', (detail) => callback(detail.readingPath)),
    onSetFullscreen: (callback: (fullscreen: boolean) => void) => {
      const unsubscribeNative = events.on('librarian:setFullscreen', (detail) => callback(detail.fullscreen === true));
      const onLocalFullscreen = (event: Event) => {
        callback((event as CustomEvent<{ fullscreen?: boolean }>).detail?.fullscreen === true);
      };
      window.addEventListener(BROWSER_LIBRARY_SET_FULLSCREEN_EVENT, onLocalFullscreen);
      return () => {
        unsubscribeNative();
        window.removeEventListener(BROWSER_LIBRARY_SET_FULLSCREEN_EVENT, onLocalFullscreen);
      };
    },
    onInsertMarkdownText: (callback: (text: string) => void) => events.on('librarian:insertMarkdownText', (detail) => callback(String(detail.text ?? ''))),
    onInsertPlainMarkdownText: (callback: (text: string) => void) => events.on('librarian:insertPlainMarkdownText', (detail) => callback(String(detail.text ?? ''))),
    onReplaceSelectedMarkdownText: (callback: (request: any) => boolean | Promise<boolean>) => events.on('librarian:replaceSelectedMarkdownText', (detail) => {
      const replaceRequest = detail.request ?? {};
      void Promise.resolve(callback(replaceRequest))
        .then((success) => request('/native/librarian/replace-selected-markdown-text-result', {
          method: 'POST',
          json: { requestId: replaceRequest.requestId, success: success === true },
        }))
        .catch(() => request('/native/librarian/replace-selected-markdown-text-result', {
          method: 'POST',
          json: { requestId: replaceRequest.requestId, success: false },
        }))
        .catch(() => {});
    }),
  } as any;

  window.recentAPI = {
    list: async () => (await request<{ entries: unknown[] }>('/native/recent/list')).entries,
    visit: async (entry: unknown) => (
      await request<{ entries: unknown[] }>('/native/recent/visit', { method: 'POST', json: entry })
    ).entries,
    remove: async (kind: string, path: string) => (
      await request<{ entries: unknown[] }>('/native/recent/remove', {
        method: 'POST',
        json: { kind, path },
      })
    ).entries,
    onChanged: (callback: (entries?: unknown[]) => void) => events.on('recent:changed', (detail) => callback(detail?.entries)),
  } as any;

  window.taggedDocsAPI = {
    list: async () => (await request<{ items: unknown[] }>('/native/tagged-docs/list')).items,
    markRead: async (ulid: string) => (
      await request<{ item: unknown }>('/native/tagged-docs/mark-read', { method: 'POST', json: { ulid } })
    ).item,
    markAllRead: async () => (
      await request<{ items: unknown[] }>('/native/tagged-docs/mark-all-read', { method: 'POST' })
    ).items,
    rescan: async () => (
      await request<{ items: unknown[] }>('/native/tagged-docs/rescan', { method: 'POST' })
    ).items,
    onUpdated: (callback: (docs: unknown[]) => void) => events.on('taggedDocs:updated', (detail) => callback(Array.isArray(detail.docs) ? detail.docs : [])),
    onScanProgress: (callback: (progress: unknown) => void) => events.on('taggedDocs:scanProgress', (detail) => callback(detail.progress)),
  } as any;

  window.sharedFilesAPI = {
    getAvailability: async () => (
      await request<{ availability: unknown }>('/native/shared-files/availability')
    ).availability,
    getPinnedItemIds: async () => (await request<{ ids: string[] }>('/native/shared-files/pinned-item-ids')).ids,
    getStatus: async (filePath: string) => (
      await request<{ status: unknown }>(`/native/shared-files/status?path=${encodeURIComponent(filePath)}`)
    ).status,
    share: async (input: unknown) => (
      await request<{ status: unknown }>('/native/shared-files/share', { method: 'POST', json: input })
    ).status,
    unshare: async (filePath: string) => (
      await request<{ success: boolean }>('/native/shared-files/unshare', { method: 'POST', json: { filePath } })
    ).success,
    sync: async () => (
      await request<{ result: unknown }>('/native/shared-files/sync', { method: 'POST' })
    ).result,
    updateContent: async (sharedId: string, content: string, expectedRevision: number, documentPath?: string | null) => (
      await request<{ result: unknown }>('/native/shared-files/update-content', {
        method: 'POST',
        json: { sharedId, content, expectedRevision, documentPath: documentPath ?? null },
      })
    ).result,
    setActivePresence: async (sharedId: string | null) => (
      await request<{ users: unknown[] }>('/native/shared-files/active-presence', {
        method: 'POST',
        json: { sharedId },
      })
    ).users,
    setPinned: async (filePath: string, pinned: boolean) => (
      await request<{ result: unknown }>('/native/shared-files/pinned', {
        method: 'POST',
        json: { filePath, pinned },
      })
    ).result,
    onPresenceChanged: (callback: (payload: unknown) => void) => events.on('sharedFiles:presenceChanged', (detail) => callback(detail.payload)),
    onPinsChanged: (callback: () => void) => events.on('sharedFiles:pinsChanged', callback),
  } as any;

  window.markdownImagesAPI = {
    makeImagesPortable: async (documentPath: string, content: string) => (
      await request<{ result: unknown }>('/native/markdown-images/make-portable', {
        method: 'POST',
        json: { documentPath, content },
      })
    ).result,
    copyImageForDocument: async (documentPath: string, imagePath: string, alt?: string) => (
      await request<{ result: unknown }>('/native/markdown-images/copy-file', {
        method: 'POST',
        json: { documentPath, imagePath, alt },
      })
    ).result,
    copyImageDataUrlForDocument: async (documentPath: string, dataUrl: string, alt?: string) => (
      await request<{ result: unknown }>('/native/markdown-images/copy-data-url', {
        method: 'POST',
        json: { documentPath, dataUrl, alt },
      })
    ).result,
    deleteUnusedCopiedImages: async (documentPath: string, removedMarkdown: string, remainingContent: string) => (
      await request<{ result: unknown }>('/native/markdown-images/delete-unused', {
        method: 'POST',
        json: { documentPath, removedMarkdown, remainingContent },
      })
    ).result,
  } as any;

  window.clipboardAPI = {
    writeText: async (text: string) => (
      await request<{ result: { success?: boolean; error?: string } }>('/native/clipboard/text', {
        method: 'POST',
        json: { text },
      })
    ).result,
    getClipboardImagePath: async () => (
      await request<{ path: string | null }>('/native/clipboard/image-path')
    ).path,
    savePastedImageFile: async (file: { name?: string | null; type?: string | null; data: Uint8Array }) => (
      await request<{ path: string | null }>('/native/clipboard/pasted-image-file', {
        method: 'POST',
        json: {
          name: file.name ?? null,
          type: file.type ?? null,
          data: Array.from(file.data),
        },
      })
    ).path,
    closeWindow: async () => {},
  } as any;

  window.commandsAPI = {
    getDirectory: async () => (
      await request<{ directory: string | null }>('/native/commands/directory')
    ).directory,
    setDirectory: async (directoryPath: string | null) => (
      await request<{ result: { success: boolean; error?: string } }>('/native/commands/directory', {
        method: 'POST',
        json: { directoryPath },
      })
    ).result,
    initialize: async () => {
      await request('/native/commands/initialize', { method: 'POST' });
    },
    getWatchedDirs: async () => (
      await request<{ dirs: unknown[] }>('/native/commands/watched-dirs')
    ).dirs,
    addWatchedDir: async (dirPath: string) => (
      await request<{ dir: unknown }>('/native/commands/watched-dir', {
        method: 'POST',
        json: { dirPath },
      })
    ).dir,
    removeWatchedDir: async (dirPath: string) => (
      await request<{ success: boolean }>('/native/commands/watched-dir', {
        method: 'DELETE',
        json: { dirPath },
      })
    ).success,
    getDefaultDirectory: async () => (
      await request<{ directory: string }>('/native/commands/default-directory')
    ).directory,
    createDefaultDirectory: async () => (
      await request<{ directory: string | null }>('/native/commands/default-directory', { method: 'POST' })
    ).directory,
    browseDirectory: async () => (
      await request<{ dirPath: string | null }>('/native/commands/pick-directory', { method: 'POST' })
    ).dirPath,
    getCommands: async () => (await request<{ commands: unknown[] }>('/native/commands/list')).commands,
    getCommandDirectories: async () => (
      await request<{ directories: unknown[] }>('/native/commands/directories')
    ).directories,
    refreshCommands: async () => (
      await request<{ commands: unknown[] }>('/native/commands/refresh', { method: 'POST' })
    ).commands,
    getCommandContent: async (commandName: string) => (
      await request<{ content: unknown }>(`/native/commands/content?name=${encodeURIComponent(commandName)}`)
    ).content,
    getCommandByPath: async (filePath: string) => (
      await request<{ command: unknown }>(`/native/commands/by-path?path=${encodeURIComponent(filePath)}`)
    ).command,
    getMarkdownPreview: async (filePath: string) => (
      await request<{ preview: unknown }>(`/native/commands/markdown-preview?path=${encodeURIComponent(filePath)}`)
    ).preview,
    saveCommand: async (filePath: string, content: string, expectedVersion?: unknown) => (
      await request<{ result: unknown }>('/native/commands/by-path', {
        method: 'PUT',
        json: { filePath, content, expectedVersion },
      })
    ).result,
    createCommand: async (directoryPath: string, name: string, content?: string) => (
      browserCreateCommand(request, directoryPath, name, content)
    ),
    deleteCommand: async (filePath: string) => (
      await request<{ success: boolean }>('/native/commands/by-path', {
        method: 'DELETE',
        json: { filePath },
      })
    ).success,
    renameCommand: async (oldFilePath: string, newName: string) => (
      await request<{ filePath: string | null }>('/native/commands/rename', {
        method: 'POST',
        json: { oldFilePath, newName },
      })
    ).filePath,
    getActiveMeeting: async () => (
      await request<{ session: unknown }>('/native/meetings/active')
    ).session,
    getActiveLibraryFileContext: async () => (
      await request<{ context: unknown }>('/native/current')
    ).context,
    setActiveLibraryFileContext: async (context: any) => setBrowserActiveLibraryFileContext(request, context),
    archiveActiveLibraryFile: async () => browserArchiveActiveLibraryFile(request),
    toggleActiveLibraryLineNumbers: async () => browserToggleActiveLibraryLineNumbers(request),
    runLocalCommand: async (runRequest: unknown) => (
      await request<{ result: unknown }>('/native/commands/run-local', {
        method: 'POST',
        json: runRequest,
      })
    ).result,
    listMaxwellRuns: async (limit?: number) => (
      await request<{ runs: unknown[] }>(`/native/commands/maxwell-runs${typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : ''}`)
    ).runs,
    getMaxwellMemory: async () => (
      await request<{ memory: unknown }>('/native/commands/maxwell-memory')
    ).memory,
    saveMaxwellMemory: async (memoryRequest: unknown) => (
      await request<{ result: unknown }>('/native/commands/maxwell-memory', {
        method: 'POST',
        json: memoryRequest,
      })
    ).result,
    undoMaxwellRun: async (runId: string) => (
      await request<{ result: unknown }>('/native/commands/maxwell-run/undo', {
        method: 'POST',
        json: { runId },
      })
    ).result,
    cancelMaxwellRun: async (runId: string) => (
      await request<{ result: unknown }>('/native/commands/maxwell-run/cancel', {
        method: 'POST',
        json: { runId },
      })
    ).result,
    redoMaxwellRun: async (runId: string) => (
      await request<{ result: unknown }>('/native/commands/maxwell-run/redo', {
        method: 'POST',
        json: { runId },
      })
    ).result,
    shareCommand: async (command: unknown) => (
      await request<{ result: unknown }>('/native/commands/share', {
        method: 'POST',
        json: command,
      })
    ).result,
    unshareCommand: async (commandId: string) => (
      await request<{ result: unknown }>('/native/commands/unshare', {
        method: 'POST',
        json: { commandId },
      })
    ).result,
    startMeetingHere: async () => (
      await request<{ result: unknown }>('/native/meetings/start-here', { method: 'POST' })
    ).result,
    stopMeeting: async () => (
      await request<{ result: unknown }>('/native/meetings/stop', { method: 'POST' })
    ).result,
    onCommandsChanged: (callback: (commands: unknown[]) => void) => events.on('commands:changed', (detail) => callback(Array.isArray(detail.commands) ? detail.commands : [])),
    onDirectoryChanged: (callback: (directoryPath: string | null) => void) => events.on('commands:directoryChanged', (detail) => (
      callback(typeof detail.directoryPath === 'string' ? detail.directoryPath : null)
    )),
    onLocalCommandStatus: (callback: (status: unknown) => void) => events.on('commands:localCommandStatus', (detail) => callback(detail.status)),
    onMeetingStatus: (callback: (session: unknown) => void) => events.on('meetings:status', (detail) => callback(detail.session)),
    onOpenMarkdownFromLauncher: (callback: (target: unknown) => void) => events.on('commands:openMarkdownFromLauncher', (detail) => callback(detail.target)),
    onToggleLineNumbersFromLauncher: (callback: () => void) => events.on('commands:toggleLineNumbersFromLauncher', callback),
    openFieldTheoryMarkdown: async (target: any) => {
      const success = window.__fieldTheoryBrowserOpenMarkdownTarget?.(target) === true;
      return success ? { success: true } : { success: false, error: 'Target is not available in Browser Library' };
    },
  } as any;

  window.shellAPI = {
    openExternal: (href: string) => browserShellOpenExternal(request, href),
    showItemInFolder: (filePath: string) => browserShellShowItemInFolder(request, filePath),
    pasteIntoCodexInput: async (text: string) => (
      await request<{ result: { success: boolean; error?: string; delivery?: string } }>('/native/shell/paste-into-codex-input', {
        method: 'POST',
        json: { text },
      })
    ).result,
    openFieldTheoryMarkdown: async (target: unknown) => (
      await request<{ result: { success: boolean; error?: string } }>('/native/shell/open-field-theory-markdown', {
        method: 'POST',
        json: { target },
      })
    ).result,
    setRepresentedFilename: (filePath: string) => browserShellSetRepresentedFilename(request, filePath, config.clientId),
  } as any;

  window.authAPI = {
    getSession: async () => (
      await request<{ session: unknown | null }>('/native/auth/session')
    ).session,
    getCallsign: async () => (
      await request<{ callsign: string | null }>('/native/auth/callsign')
    ).callsign,
    onSessionChanged: (callback: (session: unknown | null) => void) => events.on('auth:sessionChanged', (detail) => callback(detail.session ?? null)),
  } as any;

  Object.defineProperty(window, 'metricsAPI', {
    configurable: true,
    value: {
      getMetrics: async () => (
        await request<{ metrics: unknown | null }>('/native/metrics')
      ).metrics,
      fetchFromSupabase: async () => (
        await request<{ success: boolean }>('/native/metrics/fetch-from-supabase', { method: 'POST' })
      ).success,
    },
  });

  Object.defineProperty(window, 'quotaAPI', {
    configurable: true,
    value: {
      getQuotas: async () => (
        await request<{ quotas: unknown | null }>('/native/quota/quotas')
      ).quotas,
      onTierChanged: (callback: (tier: 'free' | 'pro') => void) => events.on('quota:tierChanged', (detail) => {
        if (detail.tier === 'free' || detail.tier === 'pro') callback(detail.tier);
      }),
      onQuotaChanged: (callback: (data: unknown) => void) => events.on('quota:changed', (detail) => callback(detail.data ?? detail)),
    },
  });

  window.teamAPI = {
    onTeamChanged: (callback: () => void) => events.on('team:changed', callback),
  } as any;

  window.fieldTheorySyncAPI = {
    getStatus: async () => (
      await request<{ status: unknown }>('/native/field-theory-sync/status')
    ).status,
  } as any;

  window.agentKickoffAPI = {
    kickoff: async (args: unknown) => (
      await request<{ result: unknown }>('/native/agent-kickoff/start', {
        method: 'POST',
        json: args,
      })
    ).result,
    cancel: async (runId: string) => (
      await request<{ success: boolean }>('/native/agent-kickoff/cancel', {
        method: 'POST',
        json: { runId },
      })
    ).success,
    onProgress: (callback: (event: unknown) => void) => events.on('agent:kickoffProgress', (detail) => callback(detail.event)),
    onStatus: (callback: (event: unknown) => void) => events.on('agent:kickoffStatus', (detail) => callback(detail.event)),
  } as any;

  window.bookmarksAPI = {
    getAll: async () => (
      await request<{ snapshot: unknown }>('/native/bookmarks/all')
    ).snapshot,
    getDataSource: async () => (
      await request<{ source: unknown }>('/native/bookmarks/source')
    ).source,
    syncIfStale: async () => (
      await request<{ result: unknown }>('/native/bookmarks/sync-if-stale', { method: 'POST' })
    ).result,
    getAuthors: async () => (
      await request<{ authors: unknown[] }>('/native/bookmarks/authors')
    ).authors,
    getAuthorBookmarks: async (handle: string) => (
      await request<{ bookmarks: unknown[] }>(`/native/bookmarks/author?handle=${encodeURIComponent(handle)}`)
    ).bookmarks,
    getTaxonomyBookmarks: async (filePaths: string[]) => (
      await request<{ bookmarks: unknown[] }>('/native/bookmarks/taxonomy', {
        method: 'POST',
        json: { filePaths },
      })
    ).bookmarks,
    search: async (query: string) => (
      await request<{ bookmarks: unknown[] }>(`/native/bookmarks/search?query=${encodeURIComponent(query)}`)
    ).bookmarks,
    saveWebUrl: async (url: string) => (
      await request<{ result: unknown }>('/native/bookmarks/save-web-url', {
        method: 'POST',
        json: { url },
      })
    ).result,
    getActiveWebPage: async () => (
      await request<{ result: unknown }>('/native/bookmarks/active-web-page')
    ).result,
    saveActiveWebPage: async () => (
      await request<{ result: unknown }>('/native/bookmarks/save-active-web-page', { method: 'POST' })
    ).result,
    invokeBookmark: async (id: string) => (
      await request<{ result: unknown }>('/native/bookmarks/invoke', {
        method: 'POST',
        json: { id },
      })
    ).result,
    sendToCodex: async (id: string) => (
      await request<{ result: unknown }>('/native/bookmarks/send-to-codex', {
        method: 'POST',
        json: { id },
      })
    ).result,
    copyForAgent: async (id: string) => (
      await request<{ result: unknown }>('/native/bookmarks/copy-for-agent', {
        method: 'POST',
        json: { id },
      })
    ).result,
    invokeAuthorTimeline: async (handle: string) => (
      await request<{ result: unknown }>('/native/bookmarks/invoke-author-timeline', {
        method: 'POST',
        json: { handle },
      })
    ).result,
    onChanged: (callback: () => void) => events.on('bookmarks:changed', callback),
  } as any;

  let browserAppVersion = '0.0.0';
  let browserUpdaterEnabled = false;
  try {
    const [{ version }, { enabled }] = await Promise.all([
      request<{ version: string }>('/native/app/version'),
      request<{ enabled: boolean }>('/native/updater/enabled'),
    ]);
    browserAppVersion = version || browserAppVersion;
    browserUpdaterEnabled = enabled;
  } catch (error) {
    window.__fieldTheoryBrowserLibraryErrors?.push({
      type: 'updater-bootstrap',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  window.updaterAPI = {
    getVersion: () => browserAppVersion,
    isEnabled: () => browserUpdaterEnabled,
    getStatus: async () => (
      await request<{ status: any }>('/native/updater/status')
    ).status,
    checkForUpdates: async () => {
      await request<{ result: unknown }>('/native/updater/check', { method: 'POST' });
    },
    downloadUpdate: async () => {
      await request<{ result: unknown }>('/native/updater/download', { method: 'POST' });
    },
    installUpdate: async () => {
      await request<{ result: unknown }>('/native/updater/install', { method: 'POST' });
    },
    dismissUpdate: async () => {
      await request<{ result: unknown }>('/native/updater/dismiss', { method: 'POST' });
    },
    onCheckingForUpdate: (callback: () => void) => events.on('updater:checkingForUpdate', callback),
    onUpdateAvailable: (callback: (info: any) => void) => events.on('updater:updateAvailable', (detail) => callback(detail.info)),
    onUpdateNotAvailable: (callback: () => void) => events.on('updater:updateNotAvailable', callback),
    onDownloadProgress: (callback: (percent: number) => void) => events.on('updater:downloadProgress', (detail) => callback(detail.percent)),
    onUpdateDownloaded: (callback: (info: any) => void) => events.on('updater:updateDownloaded', (detail) => callback(detail.info)),
    onInstalling: (callback: () => void) => events.on('updater:installing', callback),
    onError: (callback: (message: string) => void) => events.on('updater:error', (detail) => callback(detail.error)),
  };

  window.diagnosticsAPI = {
    appendRenderedEditorDebug: async (entry: unknown) => (
      await request<{ result: { ok: boolean; path: string; error?: string } }>('/native/diagnostics/rendered-editor-debug', {
        method: 'POST',
        json: { entry },
      })
    ).result,
    clearRenderedEditorDebugLog: async () => (
      await request<{ result: { ok: boolean; path: string; error?: string } }>('/native/diagnostics/rendered-editor-debug', {
        method: 'DELETE',
      })
    ).result,
  } as any;
}

export function BrowserLibraryApp(props: {
  LibrarianView: React.ComponentType<any>;
  CommandsView: React.ComponentType<any>;
  ThemeProvider: React.ComponentType<{ children: React.ReactNode }>;
  initialOpenTarget?: any | null;
}) {
  const { LibrarianView, CommandsView, ThemeProvider, initialOpenTarget = null } = props;

  return (
    <BrowserLibraryErrorBoundary>
      <ThemeProvider>
        <BrowserLibrarySurface LibrarianView={LibrarianView} CommandsView={CommandsView} initialOpenTarget={initialOpenTarget} />
      </ThemeProvider>
    </BrowserLibraryErrorBoundary>
  );
}

function BrowserLibrarySurface(props: {
  LibrarianView: React.ComponentType<any>;
  CommandsView: React.ComponentType<any>;
  initialOpenTarget?: any | null;
}) {
  const { LibrarianView, CommandsView, initialOpenTarget = null } = props;
  const { theme, toggleDarkMode } = useTheme();
  const normalizedInitialOpenTarget = React.useMemo(() => (
    isBrowserLibraryIncludedOpenTarget(initialOpenTarget)
      ? normalizeBrowserLibraryOpenTarget(initialOpenTarget)
      : null
  ), [initialOpenTarget]);
  const [surface, setSurface] = React.useState<BrowserLibrarySurfaceName>(() => (
    normalizedInitialOpenTarget?.kind === 'commands'
      ? 'commands'
      : 'library'
  ));
  const [librarianEverRendered, setLibrarianEverRendered] = React.useState(() => (
    normalizedInitialOpenTarget?.kind !== 'commands'
  ));
  const initialClientSurface = initialBrowserClientSurfaceFromTarget(normalizedInitialOpenTarget);
  const [activeClientSurface, setActiveClientSurface] = React.useState<BrowserHelperClientSurfaceName>(initialClientSurface);
  const activeClientSurfaceRef = React.useRef<BrowserHelperClientSurfaceName>(initialClientSurface);
  const [pendingReadingPath, setPendingReadingPath] = React.useState<string | null>(null);
  const [launcherOpenTarget, setLauncherOpenTarget] = React.useState<any>(() => (
    normalizedInitialOpenTarget
    && normalizedInitialOpenTarget.kind !== 'command'
    && normalizedInitialOpenTarget.kind !== 'commands'
    && normalizedInitialOpenTarget.kind !== 'library'
      ? normalizedInitialOpenTarget
      : null
  ));
  const [initialCommandPath, setInitialCommandPath] = React.useState<string | null>(() => (
    null
  ));
  const initialCommandOpenPathRef = React.useRef<string | null>(
    normalizedInitialOpenTarget?.kind === 'command' ? normalizedInitialOpenTarget.path : null,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => (
    normalizedInitialOpenTarget?.focusChrome === true
    || normalizedInitialOpenTarget?.sidebarCollapsed === true
    || window.localStorage.getItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  ));
  const [librarySidebarToggleRequestKey, setLibrarySidebarToggleRequestKey] = React.useState(0);
  const [bookmarksCanvasChromeActive, setBookmarksCanvasChromeActive] = React.useState(false);
  const [bookmarksCanvasToolbarTop, setBookmarksCanvasToolbarTop] = React.useState<number | null>(null);
  const [librarianImmersive, setLibrarianImmersive] = React.useState(() => (
    window.localStorage.getItem(LIBRARIAN_IMMERSIVE_STORAGE_KEY) === 'true'
  ));
  const [focusChromeChildActive, setFocusChromeChildActive] = React.useState(false);
  const [focusChromeGlobalEnabled, setFocusChromeGlobalEnabledState] = React.useState(
    normalizedInitialOpenTarget?.focusChrome === true
  );
  const [focusChromeGroupOpacity, setFocusChromeGroupOpacity] = React.useState(0);
  const [focusChromeContentCenterX, setFocusChromeContentCenterX] = React.useState<number | null>(null);
  const [activeLibraryFile, setActiveLibraryFile] = React.useState<{ path: string; title: string; mtime: number } | null>(null);
  const [fieldTheoryButtonProximity, setFieldTheoryButtonProximity] = React.useState(0);
  const [fieldTheoryButtonHovered, setFieldTheoryButtonHovered] = React.useState(false);
  const [browserTextSelected, setBrowserTextSelected] = React.useState(false);
  const [actionFeedback, setActionFeedback] = React.useState<string | null>(null);
  const focusChromeGlobalEnabledRef = React.useRef(normalizedInitialOpenTarget?.focusChrome === true);
  const focusChromePreviousSidebarCollapsedRef = React.useRef<boolean | null>(
    normalizedInitialOpenTarget?.focusChrome === true
      ? window.localStorage.getItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
      : null
  );
  const actionFeedbackTimerRef = React.useRef<number | null>(null);
  const appBackHistoryRef = React.useRef<AppNavigationSurface[]>([]);
  const appForwardHistoryRef = React.useRef<AppNavigationSurface[]>([]);
  const appHistoryNavigationRef = React.useRef(false);
  const appNavigationSurfaceRef = React.useRef<AppNavigationSurface>('librarian');
  const [navigationAvailability, setNavigationAvailability] = React.useState({ back: false, forward: false });
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const footerRef = React.useRef<HTMLDivElement>(null);
  const [shellWidth, setShellWidth] = React.useState(() => Math.round(window.innerWidth));
  const focusChromeSurfaceEnabled = focusChromeChildActive || focusChromeGlobalEnabled;
  const librarianSurfaceVisible = surface === 'library';
  const keepLibrarianMounted = librarianEverRendered || librarianSurfaceVisible;
  const libraryImmersiveChromeActive = librarianSurfaceVisible && librarianImmersive;
  const focusChromeOverlayActive = librarianSurfaceVisible && focusChromeSurfaceEnabled;
  const browserChromeHidden = bookmarksCanvasChromeActive || libraryImmersiveChromeActive;
  const focusChromeSurfaceOpacity = getFocusChromeSurfaceOpacity({
    isFocusChromeSurface: librarianSurfaceVisible,
    focusChromeActive: focusChromeSurfaceEnabled,
  });
  const footerChromeOpacity = browserChromeHidden || focusChromeOverlayActive ? 0 : 1;
  const footerChromeInteractive = footerChromeOpacity > 0.05;
  const focusChromeIconSize = Math.max(20, Math.min(28, Math.round(shellWidth * 0.024)));
  const focusChromeIconTop = bookmarksCanvasToolbarTop === null
    ? Math.max(8, Math.round(focusChromeIconSize * 0.45))
    : Math.max(8, Math.round(bookmarksCanvasToolbarTop / 2 - focusChromeIconSize / 2));
  const reportActiveSurface = React.useCallback((nextSurface: BrowserHelperClientSurfaceName) => {
    activeClientSurfaceRef.current = nextSurface;
    setActiveClientSurface(nextSurface);
    window.__fieldTheoryBrowserReportActiveSurface?.(nextSurface);
  }, []);
  React.useEffect(() => {
    const element = shellRef.current;
    if (!element) return undefined;
    const updateShellWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      setShellWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    updateShellWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateShellWidth);
      return () => window.removeEventListener('resize', updateShellWidth);
    }
    const observer = new ResizeObserver(updateShellWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    const element = shellRef.current;
    if (!element) return undefined;
    const updateProximity = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const dx = Math.max(0, rect.right - event.clientX);
      const dy = Math.max(0, rect.bottom - event.clientY);
      const distance = Math.sqrt(dx * dx + dy * dy);
      setFieldTheoryButtonProximity(Math.max(0, Math.min(1, 1 - distance / 220)));
    };
    const clearProximity = () => setFieldTheoryButtonProximity(0);
    element.addEventListener('mousemove', updateProximity);
    element.addEventListener('mouseleave', clearProximity);
    return () => {
      element.removeEventListener('mousemove', updateProximity);
      element.removeEventListener('mouseleave', clearProximity);
    };
  }, []);
  React.useEffect(() => {
    const updateBrowserTextSelected = () => {
      setBrowserTextSelected((document.getSelection()?.toString().trim().length ?? 0) > 0);
    };
    document.addEventListener('selectionchange', updateBrowserTextSelected);
    updateBrowserTextSelected();
    return () => document.removeEventListener('selectionchange', updateBrowserTextSelected);
  }, []);

  React.useEffect(() => {
    reportActiveSurface(initialClientSurface);
  }, [initialClientSurface, reportActiveSurface]);
  React.useEffect(() => {
    const reportCurrentSurface = () => {
      reportActiveSurface(activeClientSurfaceRef.current);
    };
    window.addEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, reportCurrentSurface);
    return () => {
      window.removeEventListener(BROWSER_HELPER_EVENT_STREAM_OPEN_EVENT, reportCurrentSurface);
    };
  }, [reportActiveSurface]);
  React.useEffect(() => {
    if (!focusChromeSurfaceEnabled) {
      setFocusChromeGroupOpacity(0);
      return undefined;
    }

    const updateProximity = (event: MouseEvent) => {
      const opacity = getGroupedFocusChromeProximityOpacity({
        cursorClientY: event.clientY,
        paneClientTop: 0,
        viewportHeight: window.innerHeight,
        revealDistancePx: FOCUS_CHROME_GROUP_REVEAL_DISTANCE_PX,
        fullOpacityDistancePx: FOCUS_CHROME_EDGE_FULL_OPACITY_DISTANCE_PX,
        topFullOpacityDistancePx: FOCUS_CHROME_TOP_FULL_OPACITY_DISTANCE_PX,
      });
      setFocusChromeGroupOpacity(opacity);
    };
    const hideProximityChrome = (event: MouseEvent) => {
      if (!isClientPointOutsideBounds(event.clientX, event.clientY, {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      })) return;
      setFocusChromeGroupOpacity(0);
    };

    window.addEventListener('mousemove', updateProximity);
    window.addEventListener('mouseleave', hideProximityChrome);
    return () => {
      window.removeEventListener('mousemove', updateProximity);
      window.removeEventListener('mouseleave', hideProximityChrome);
    };
  }, [focusChromeSurfaceEnabled]);
  const showActionFeedback = React.useCallback((message: string) => {
    if (actionFeedbackTimerRef.current !== null) {
      window.clearTimeout(actionFeedbackTimerRef.current);
    }
    setActionFeedback(message);
    actionFeedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback(null);
      actionFeedbackTimerRef.current = null;
    }, 3000);
  }, []);
  const openScratchpadPage = React.useCallback((relPath: string | null | undefined) => {
    if (!relPath) return;
    setPendingReadingPath(null);
    setInitialCommandPath(null);
    setLauncherOpenTarget({
      kind: 'wiki',
      path: relPath,
      contentMode: 'rendered',
    });
    setSurface('library');
  }, []);
  const openWikiPage = React.useCallback((relPath: string | null | undefined) => {
    if (!relPath) return;
    setPendingReadingPath(null);
    setInitialCommandPath(null);
    setLauncherOpenTarget({
      kind: 'wiki',
      path: relPath,
      contentMode: 'rendered',
    });
    setSurface('library');
  }, []);
  const openExternalPage = React.useCallback((absPath: string | null | undefined) => {
    if (!absPath) return;
    setPendingReadingPath(null);
    setInitialCommandPath(null);
    setLauncherOpenTarget({
      kind: 'external',
      path: absPath,
      contentMode: 'rendered',
    });
    setSurface('library');
  }, []);
  const setFocusChromeGlobalEnabled = React.useCallback((enabled: boolean) => {
    focusChromeGlobalEnabledRef.current = enabled;
    setFocusChromeGlobalEnabledState(enabled);
  }, []);
  const enableGlobalFocusChrome = React.useCallback(() => {
    if (focusChromePreviousSidebarCollapsedRef.current === null) {
      focusChromePreviousSidebarCollapsedRef.current = sidebarCollapsed;
    }
    setFocusChromeGlobalEnabled(true);
    setSidebarCollapsed(true);
    window.localStorage.setItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY, '1');
  }, [setFocusChromeGlobalEnabled, sidebarCollapsed]);
  React.useEffect(() => {
    if (!normalizedInitialOpenTarget) return;
    if (normalizedInitialOpenTarget.sidebarCollapsed === true) {
      setSidebarCollapsed(true);
    }
    if (normalizedInitialOpenTarget.focusChrome === true && !focusChromeGlobalEnabledRef.current) {
      enableGlobalFocusChrome();
    }
  }, [enableGlobalFocusChrome, normalizedInitialOpenTarget]);
  const disableGlobalFocusChrome = React.useCallback(() => {
    setFocusChromeGlobalEnabled(false);
    setFocusChromeGroupOpacity(0);
    const previous = focusChromePreviousSidebarCollapsedRef.current;
    if (previous === null) return;
    focusChromePreviousSidebarCollapsedRef.current = null;
    setSidebarCollapsed(previous);
    window.localStorage.setItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY, previous ? '1' : '0');
  }, [setFocusChromeGlobalEnabled]);
  const handleGlobalFocusChromeChange = React.useCallback((enabled: boolean) => {
    if (enabled) {
      enableGlobalFocusChrome();
    } else {
      disableGlobalFocusChrome();
    }
  }, [disableGlobalFocusChrome, enableGlobalFocusChrome]);
  const handleFocusChromeActiveChange = React.useCallback((active: boolean, visualVisible?: boolean, visualOpacity?: number) => {
    setFocusChromeChildActive(active);
    setFocusChromeGroupOpacity(active && visualVisible ? (visualOpacity ?? 1) : 0);
    if (active || focusChromeGlobalEnabledRef.current) return;
    const previous = focusChromePreviousSidebarCollapsedRef.current;
    if (previous === null) return;
    focusChromePreviousSidebarCollapsedRef.current = null;
    setSidebarCollapsed(previous);
    window.localStorage.setItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY, previous ? '1' : '0');
  }, []);
  const updateNavigationAvailability = React.useCallback(() => {
    setNavigationAvailability({
      back: appBackHistoryRef.current.some((entry) => appNavigationSurfaceToBrowserLibrarySurface(entry) !== null),
      forward: appForwardHistoryRef.current.some((entry) => appNavigationSurfaceToBrowserLibrarySurface(entry) !== null),
    });
  }, []);
  const hasBrowserSurfaceHistoryTarget = React.useCallback((direction: -1 | 1): boolean => {
    const history = direction < 0 ? appBackHistoryRef.current : appForwardHistoryRef.current;
    return history.some((entry) => appNavigationSurfaceToBrowserLibrarySurface(entry) !== null);
  }, []);
  React.useEffect(() => {
    const nextSurface = browserLibrarySurfaceToAppNavigationSurface(surface);
    const previousSurface = appNavigationSurfaceRef.current;
    if (appHistoryNavigationRef.current) {
      appHistoryNavigationRef.current = false;
      appNavigationSurfaceRef.current = nextSurface;
      updateNavigationAvailability();
      return;
    }

    appBackHistoryRef.current = pushAppNavigationHistory(
      appBackHistoryRef.current,
      previousSurface,
      nextSurface,
    );
    if (previousSurface !== nextSurface) {
      appForwardHistoryRef.current = [];
    }
    appNavigationSurfaceRef.current = nextSurface;
    updateNavigationAvailability();
  }, [surface, updateNavigationAvailability]);
  React.useEffect(() => {
    if (surface === 'commands') reportActiveSurface('commands');
  }, [reportActiveSurface, surface]);
  React.useEffect(() => () => {
    if (actionFeedbackTimerRef.current !== null) {
      window.clearTimeout(actionFeedbackTimerRef.current);
    }
  }, []);
  React.useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowNewReading?.((readingPath: string) => {
      setPendingReadingPath(readingPath);
      setLauncherOpenTarget(null);
      setInitialCommandPath(null);
      setSurface('library');
    });
    return () => unsubscribe?.();
  }, []);
  React.useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowReading?.((readingPath: string) => {
      setPendingReadingPath(readingPath);
      setLauncherOpenTarget(null);
      setInitialCommandPath(null);
      setSurface('library');
    });
    return () => unsubscribe?.();
  }, []);
  React.useEffect(() => {
    const unsubscribe = window.librarianAPI?.onSetFullscreen?.((fullscreen: boolean) => {
      setLibrarianImmersive(fullscreen);
      if (fullscreen) {
        setInitialCommandPath(null);
        setSurface('library');
      }
    });
    return () => unsubscribe?.();
  }, []);
  React.useEffect(() => {
    const nextValue = librarianImmersive ? 'true' : 'false';
    if (window.localStorage.getItem(LIBRARIAN_IMMERSIVE_STORAGE_KEY) !== nextValue) {
      window.localStorage.setItem(LIBRARIAN_IMMERSIVE_STORAGE_KEY, nextValue);
    }
  }, [librarianImmersive]);
  React.useEffect(() => {
    const syncLibrarianImmersive = () => {
      setLibrarianImmersive(window.localStorage.getItem(LIBRARIAN_IMMERSIVE_STORAGE_KEY) === 'true');
    };
    window.addEventListener('storage', syncLibrarianImmersive);
    window.addEventListener('fieldtheory:renderer-storage-changed', syncLibrarianImmersive);
    return () => {
      window.removeEventListener('storage', syncLibrarianImmersive);
      window.removeEventListener('fieldtheory:renderer-storage-changed', syncLibrarianImmersive);
    };
  }, []);
  React.useEffect(() => {
    if (librarianSurfaceVisible) setLibrarianEverRendered(true);
  }, [librarianSurfaceVisible]);
  React.useEffect(() => {
    let cancelled = false;
    const scratchpadHotkeyRef = { current: '' };
    const setScratchpadHotkey = (hotkey: string | null | undefined) => {
      scratchpadHotkeyRef.current = normalizeHotkeyForComparison(hotkey);
    };
    void window.hotkeyAPI?.getHotkey?.('scratchpad').then((hotkey) => {
      if (!cancelled) setScratchpadHotkey(hotkey);
    });

    const hotkeyChangedHandler = (event: Event) => {
      setScratchpadHotkey((event as CustomEvent<string>).detail);
    };
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const configuredHotkey = scratchpadHotkeyRef.current;
      if (!configuredHotkey) return;
      if (!hasNonShiftModifierHotkey(configuredHotkey)) return;
      if (normalizeHotkeyForComparison(buildHotkeyString(event)) !== configuredHotkey) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const page = await window.wikiAPI?.openScratchpadDefault?.();
        const relPath = page && typeof (page as { relPath?: unknown }).relPath === 'string'
          ? (page as { relPath: string }).relPath
          : null;
        openScratchpadPage(relPath);
      })();
    };

    window.addEventListener('fieldtheory:scratchpad-hotkey-changed', hotkeyChangedHandler);
    document.addEventListener('keydown', handler, true);
    return () => {
      cancelled = true;
      window.removeEventListener('fieldtheory:scratchpad-hotkey-changed', hotkeyChangedHandler);
      document.removeEventListener('keydown', handler, true);
    };
  }, [openScratchpadPage]);
  React.useEffect(() => {
    const unsubscribe = window.wikiAPI?.onOpenScratchpad?.((relPath) => {
      openScratchpadPage(relPath);
    });
    return () => unsubscribe?.();
  }, [openScratchpadPage]);
  React.useEffect(() => {
    const unsubscribe = window.wikiAPI?.onOpenWikiPage?.((relPath) => {
      if (keepLibrarianMounted) {
        setPendingReadingPath(null);
        setInitialCommandPath(null);
        setLauncherOpenTarget({
          kind: 'wiki',
          path: relPath,
          contentMode: 'rendered',
        });
        setSurface('library');
      } else {
        openWikiPage(relPath);
      }
    });
    return () => unsubscribe?.();
  }, [keepLibrarianMounted, openWikiPage]);
  React.useEffect(() => {
    const unsubscribe = window.externalAPI?.onOpenExternal?.((absPath) => {
      openExternalPage(absPath);
    });
    return () => unsubscribe?.();
  }, [openExternalPage]);
  React.useEffect(() => {
    const unsubscribe = window.commandsAPI?.onToggleLineNumbersFromLauncher?.(() => {
      setPendingReadingPath(null);
      setLauncherOpenTarget(null);
      setInitialCommandPath(null);
      setSurface('library');
    });
    return () => unsubscribe?.();
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refreshPendingReadingStatus = async () => {
      if (document.visibilityState === 'hidden') return;
      if (inFlight) return;
      inFlight = true;
      const statusPromise = window.librarianAPI?.pollStatus?.();
      const status = statusPromise ? await statusPromise.catch(() => null) : null;
      inFlight = false;
      if (cancelled || !status || typeof status !== 'object') return;
      const pendingPath = (status as { pendingPath?: unknown }).pendingPath;
      if (typeof pendingPath !== 'string' || pendingPath.length === 0) return;
      setPendingReadingPath(pendingPath);
      setLauncherOpenTarget(null);
      setSurface('library');
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshPendingReadingStatus();
    };

    void refreshPendingReadingStatus();
    window.addEventListener('focus', refreshPendingReadingStatus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshPendingReadingStatus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
  const applyAppNavigationSurface = React.useCallback((nextSurface: AppNavigationSurface) => {
    const browserSurface = appNavigationSurfaceToBrowserLibrarySurface(nextSurface);
    if (!browserSurface) return;
    appHistoryNavigationRef.current = true;
    if (browserSurface === 'library') {
      setLauncherOpenTarget(null);
    } else {
      setInitialCommandPath(null);
    }
    setSurface(browserSurface);
  }, []);
  const navigateAppHistory = React.useCallback((direction: -1 | 1): boolean => {
    const current = appNavigationSurfaceRef.current;
    const result = direction < 0
      ? popAppBackHistory({
        backHistory: appBackHistoryRef.current,
        forwardHistory: appForwardHistoryRef.current,
        current,
      })
      : popAppForwardHistory({
        backHistory: appBackHistoryRef.current,
        forwardHistory: appForwardHistoryRef.current,
        current,
      });

    if (!result.target) return false;
    appBackHistoryRef.current = result.backHistory;
    appForwardHistoryRef.current = result.forwardHistory;
    updateNavigationAvailability();
    applyAppNavigationSurface(result.target);
    return true;
  }, [applyAppNavigationSurface, updateNavigationAvailability]);
  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      if (focusChromeSurfaceEnabled && collapsed) {
        setFocusChromeGlobalEnabled(false);
        focusChromePreviousSidebarCollapsedRef.current = null;
        setFocusChromeGroupOpacity(0);
      }
      const next = !collapsed;
      window.localStorage.setItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      setLibrarySidebarToggleRequestKey((key) => key + 1);
      return next;
    });
  }, [focusChromeSurfaceEnabled, setFocusChromeGlobalEnabled]);
  const handleSelectedCommandPathChange = React.useCallback((path: string | null) => {
    if (path) {
      void window.commandsAPI?.setActiveLibraryFileContext?.(null);
    }
  }, []);
  const openCommandPathInLibrary = React.useCallback((path: string) => {
    setPendingReadingPath(null);
    setInitialCommandPath(null);
    setSurface('library');
    void (async () => {
      const roots = await window.libraryAPI?.getRoots?.().catch(() => undefined);
      setLauncherOpenTarget(commandPathToLauncherLibraryOpenTarget(path, roots as LauncherLibraryRootPath[] | undefined));
    })();
  }, []);
  React.useEffect(() => {
    const initialCommandPath = initialCommandOpenPathRef.current;
    if (!initialCommandPath) return;
    initialCommandOpenPathRef.current = null;
    openCommandPathInLibrary(initialCommandPath);
  }, [openCommandPathInLibrary]);

  React.useEffect(() => {
    const syncSidebarCollapsed = () => {
      setSidebarCollapsed(window.localStorage.getItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1');
    };
    window.addEventListener('storage', syncSidebarCollapsed);
    window.addEventListener('fieldtheory:renderer-storage-changed', syncSidebarCollapsed);
    return () => {
      window.removeEventListener('storage', syncSidebarCollapsed);
      window.removeEventListener('fieldtheory:renderer-storage-changed', syncSidebarCollapsed);
    };
  }, []);

  const openMarkdownTarget = React.useCallback((target: any): boolean => {
    const normalizedTarget = normalizeBrowserLibraryOpenTarget(target);
    if (!normalizedTarget) return false;
    target = normalizedTarget;
    setPendingReadingPath(null);
    if (target.sidebarCollapsed === true) {
      setSidebarCollapsed(true);
      window.localStorage.setItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY, '1');
    }
    if (target.focusChrome === true) {
      enableGlobalFocusChrome();
    }
    if (target.kind === 'command') {
      openCommandPathInLibrary(target.path);
      return true;
    }
    if (target.kind === 'commands') {
      setLauncherOpenTarget(null);
      setInitialCommandPath(null);
      setSurface('commands');
      return true;
    }
    if (target.kind === 'library') {
      setInitialCommandPath(null);
      setLauncherOpenTarget(null);
      setSurface('library');
      return true;
    }
    setInitialCommandPath(null);
    setLauncherOpenTarget(target);
    setSurface('library');
    return true;
  }, [enableGlobalFocusChrome, openCommandPathInLibrary]);

  React.useEffect(() => {
    window.__fieldTheoryBrowserOpenMarkdownTarget = openMarkdownTarget;
    const unsubscribe = window.commandsAPI?.onOpenMarkdownFromLauncher?.(openMarkdownTarget);
    return () => {
      unsubscribe?.();
      if (window.__fieldTheoryBrowserOpenMarkdownTarget === openMarkdownTarget) {
        delete window.__fieldTheoryBrowserOpenMarkdownTarget;
      }
    };
  }, [openMarkdownTarget]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const historyDirection = getAppBracketNavigationDirection(event);
      const shouldHandleAppHistory = historyDirection
        && (surface !== 'library' || hasBrowserSurfaceHistoryTarget(historyDirection));
      if (shouldHandleAppHistory && navigateAppHistory(historyDirection)) {
        event.preventDefault();
        return;
      }
      if (!isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [hasBrowserSurfaceHistoryTarget, navigateAppHistory, surface, toggleSidebarCollapsed]);

  const resolveFieldTheoryNativeOpenTarget = React.useCallback(async (): Promise<FieldTheoryMarkdownTarget> => {
    if (surface === 'commands') return { kind: 'commands', path: 'commands' };
    if (activeClientSurface === 'bookmarks') return { kind: 'bookmarks', path: 'bookmarks' };
    if (activeClientSurface === 'ember') return { kind: 'ember', path: 'ember' };
    const context = await window.commandsAPI?.getActiveLibraryFileContext?.().catch(() => null);
    if (context?.type === 'wiki' && context.relPath) {
      return { kind: 'wiki', path: context.relPath, contentMode: 'rendered' };
    }
    if (context?.filePath) {
      return { kind: 'external', path: context.filePath, contentMode: 'rendered' };
    }
    return { kind: 'library', path: 'library' };
  }, [activeClientSurface, surface]);
  const openCurrentTargetInFieldTheory = React.useCallback(() => {
    void (async () => {
      const target = await resolveFieldTheoryNativeOpenTarget();
      const result = await window.shellAPI?.openFieldTheoryMarkdown?.(target);
      showActionFeedback(result?.success ? 'Opened in Field Theory' : result?.error ?? 'Could not open Field Theory');
    })();
  }, [resolveFieldTheoryNativeOpenTarget, showActionFeedback]);
  const exitBrowserImmersive = React.useCallback(() => {
    setLibrarianImmersive(false);
    disableGlobalFocusChrome();
    setFocusChromeChildActive(false);
    setFocusChromeGroupOpacity(0);
    window.dispatchEvent(new CustomEvent(BROWSER_LIBRARY_SET_FULLSCREEN_EVENT, {
      detail: { fullscreen: false },
    }));
  }, [disableGlobalFocusChrome]);
  const fieldTheoryButtonVisible = (
    surface === 'commands'
    || activeClientSurface === 'bookmarks'
    || activeClientSurface === 'ember'
    || Boolean(activeLibraryFile)
  ) && !browserTextSelected;
  const immersiveExitVisible = librarianSurfaceVisible && (librarianImmersive || focusChromeSurfaceEnabled);

  return (
    <div
      ref={shellRef}
      data-fieldtheory-browser-library-shell="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        height: '100vh',
        minHeight: 0,
        backgroundColor: theme.bg,
      }}
    >
      {focusChromeSurfaceEnabled ? (
        <LibraryFocusChromeIcon
          isDark={theme.isDark}
          top={focusChromeIconTop}
          contentCenterX={focusChromeContentCenterX}
          opacity={FOCUS_CHROME_ICON_OPACITY}
          size={focusChromeIconSize}
        />
      ) : null}
      {immersiveExitVisible ? (
        <button
          type="button"
          data-fieldtheory-browser-exit-immersive-button="true"
          aria-label="Exit immersive view"
          title="Exit immersive view"
          onClick={exitBrowserImmersive}
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            zIndex: 28,
            width: '28px',
            height: '28px',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            backgroundColor: theme.isDark ? 'rgba(20, 20, 22, 0.78)' : 'rgba(255, 255, 255, 0.88)',
            color: theme.textSecondary,
            boxShadow: theme.isDark ? '0 8px 22px rgba(0,0,0,0.28)' : '0 8px 22px rgba(0,0,0,0.1)',
            cursor: 'pointer',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 4.5 11.5 11.5" />
            <path d="M11.5 4.5 4.5 11.5" />
          </svg>
        </button>
      ) : null}
      {actionFeedback ? (
        <span
          data-fieldtheory-top-chrome-action-feedback="true"
          style={{
            position: 'absolute',
            top: '12px',
            right: '16px',
            zIndex: 24,
            fontSize: '9px',
            fontWeight: 500,
            color: theme.textSecondary,
            pointerEvents: 'none',
          }}
        >
          {actionFeedback}
        </span>
      ) : null}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {surface === 'commands' ? (
            <CommandsView
              initialCommandPath={initialCommandPath}
              onInitialCommandConsumed={() => setInitialCommandPath(null)}
              sidebarCollapsed={sidebarCollapsed}
              onSwitchToClipboard={() => setSurface('library')}
              focusChromeEnabled={focusChromeGlobalEnabled}
              onFocusChromeEnabledChange={handleGlobalFocusChromeChange}
              onFocusChromeShortcut={enableGlobalFocusChrome}
              onFocusChromeActiveChange={handleFocusChromeActiveChange}
              canNavigateBack={navigationAvailability.back}
              canNavigateForward={navigationAvailability.forward}
              onNavigateBack={() => navigateAppHistory(-1)}
              onNavigateForward={() => navigateAppHistory(1)}
              onSelectedCommandPathChange={handleSelectedCommandPathChange}
            />
          ) : null}
          {keepLibrarianMounted ? (
            <div
              data-fieldtheory-browser-library-keepalive="library"
              style={{
                flex: 1,
                minHeight: 0,
                display: librarianSurfaceVisible ? 'flex' : 'none',
                flexDirection: 'column',
              }}
            >
            <LibrarianView
              active={librarianSurfaceVisible}
              browserLibrarySurface
              onFullScreenChange={setLibrarianImmersive}
              initialReadingPath={pendingReadingPath}
              onInitialReadingConsumed={() => setPendingReadingPath(null)}
              initialOpenTarget={launcherOpenTarget}
              initialFullScreen={librarianImmersive}
              onInitialOpenTargetConsumed={() => setLauncherOpenTarget(null)}
              sidebarCollapsed={sidebarCollapsed}
              sidebarToggleRequestKey={librarySidebarToggleRequestKey}
              onSwitchToClipboard={() => {}}
              onFocusChromeActiveChange={handleFocusChromeActiveChange}
              onBookmarksCanvasActiveChange={setBookmarksCanvasChromeActive}
              onBookmarksCanvasToolbarTopChange={setBookmarksCanvasToolbarTop}
              onSelectedItemTypeChange={(type: LibrarianSelectedItemType) => {
                if (surface !== 'library') return;
                if (type === 'bookmarks' || type === 'ember') {
                  reportActiveSurface(type);
                } else {
                  reportActiveSurface('library');
                }
              }}
              focusChromeGroupOpacity={focusChromeGroupOpacity}
              focusChromeEnabled={focusChromeGlobalEnabled}
              onFocusChromeEnabledChange={handleGlobalFocusChromeChange}
              onFocusChromeShortcut={enableGlobalFocusChrome}
              onActionFeedback={showActionFeedback}
              onFocusChromeContentCenterChange={setFocusChromeContentCenterX}
              onActiveFileUpdatedChange={setActiveLibraryFile}
              onOpenCommandPath={openCommandPathInLibrary}
            />
            </div>
          ) : null}
      </div>
      {fieldTheoryButtonVisible ? (
        <button
          type="button"
          data-fieldtheory-browser-open-native-button="true"
          aria-label="Open app"
          title="Open app"
          onClick={openCurrentTargetInFieldTheory}
          onMouseEnter={() => setFieldTheoryButtonHovered(true)}
          onMouseLeave={() => setFieldTheoryButtonHovered(false)}
          style={{
            position: 'absolute',
            right: '18px',
            bottom: footerChromeInteractive ? '54px' : '18px',
            zIndex: 30,
            width: '38px',
            height: '38px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '10px',
            border: `1px solid ${theme.border}`,
            backgroundColor: fieldTheoryButtonHovered
              ? (theme.isDark ? 'rgba(30,30,34,0.92)' : 'rgba(255,255,255,0.96)')
              : (theme.isDark ? 'rgba(20,20,22,0.78)' : 'rgba(255,255,255,0.86)'),
            color: theme.text,
            boxShadow: theme.isDark ? '0 10px 28px rgba(0,0,0,0.32)' : '0 10px 28px rgba(0,0,0,0.14)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            cursor: 'pointer',
            opacity: browserChromeHidden || focusChromeOverlayActive
              ? (fieldTheoryButtonHovered ? 1 : 0.9)
              : (fieldTheoryButtonHovered ? 1 : 0.18 + fieldTheoryButtonProximity * 0.82),
            transform: fieldTheoryButtonHovered ? 'translateY(-1px)' : `translateY(${Math.round((1 - fieldTheoryButtonProximity) * 2)}px)`,
            transition: 'opacity 120ms ease, transform 120ms ease, background-color 120ms ease',
          }}
        >
          <img
            src="/field-theory-icon-black.png"
            alt=""
            aria-hidden="true"
            style={{
              width: '20px',
              height: '20px',
              display: 'block',
              opacity: theme.isDark ? 0.86 : 0.72,
            }}
          />
        </button>
      ) : null}
      <BrowserLibraryFooter
        footerRef={footerRef}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebarCollapsed}
        hidden={browserChromeHidden}
        opacity={footerChromeOpacity}
        interactive={footerChromeInteractive}
      />
    </div>
  );
}

function BrowserLibraryFooter(props: {
  footerRef: React.RefObject<HTMLDivElement>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  hidden: boolean;
  opacity: number;
  interactive: boolean;
}) {
  const { footerRef, sidebarCollapsed, onToggleSidebar, hidden, opacity, interactive } = props;
  const { theme, toggleDarkMode } = useTheme();
  const [maxwellHistoryOpen, setMaxwellHistoryOpen] = React.useState(false);
  const { localCommandStatus, footerStatusLabel, cancelLocalCommandRun } = useLibraryFooterLocalCommandStatus();
  const updaterStatus = useLibraryFooterUpdaterStatus();
  const [callsign, setCallsign] = React.useState<string | null>(null);
  const [isOnline, setIsOnline] = React.useState(() => navigator.onLine);
  const [isWindowVisible, setIsWindowVisible] = React.useState(() => document.visibilityState === 'visible');
  const [authSession, setAuthSession] = React.useState<{ user?: { id?: string } } | null>(null);
  const [cachedTier, setCachedTier] = React.useState<'free' | 'pro'>('free');
  const showFocusStatusOverlay = !hidden && !interactive && !!footerStatusLabel;
  React.useEffect(() => {
    const refreshCallsign = () => {
      const request = window.authAPI?.getCallsign?.();
      if (!request) {
        setCallsign(null);
        return;
      }
      void request
        .then((value) => setCallsign(value || null))
        .catch(() => setCallsign(null));
    };
    refreshCallsign();
    const unsubscribe = window.authAPI?.onSessionChanged?.((session) => {
      if (!session) {
        setCallsign(null);
        return;
      }
      refreshCallsign();
    });
    return () => unsubscribe?.();
  }, []);
  React.useEffect(() => {
    let active = true;
    const loadSession = async () => {
      try {
        const session = await window.authAPI?.getSession?.();
        if (active) setAuthSession(session && typeof session === 'object' ? session as { user?: { id?: string } } : null);
      } catch {
        if (active) setAuthSession(null);
      }
    };
    void loadSession();
    const unsubscribe = window.authAPI?.onSessionChanged?.((session) => {
      setAuthSession(session && typeof session === 'object' ? session as { user?: { id?: string } } : null);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  React.useEffect(() => {
    if (!isWindowVisible || !window.quotaAPI) return;
    let cancelled = false;
    const fetchQuotas = async () => {
      try {
        const quotas = await window.quotaAPI?.getQuotas?.();
        if (!cancelled && quotas?.tier) setCachedTier(quotas.tier === 'pro' ? 'pro' : 'free');
      } catch {}
    };
    void fetchQuotas();
    const unsubscribeTier = window.quotaAPI.onTierChanged?.(() => {
      void fetchQuotas();
    });
    const unsubscribeQuota = window.quotaAPI.onQuotaChanged?.(() => {
      void fetchQuotas();
    });
    return () => {
      cancelled = true;
      unsubscribeTier?.();
      unsubscribeQuota?.();
    };
  }, [isWindowVisible]);
  React.useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    const updateVisibility = () => setIsWindowVisible(document.visibilityState === 'visible');
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);
  return (
    <>
      <style>{`
        @keyframes localStatusFadeOut {
          0%, 68% { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>
      <div
        ref={footerRef as React.LegacyRef<HTMLDivElement>}
        data-fieldtheory-browser-library-footer="true"
        style={{
          position: interactive ? 'relative' : 'absolute',
          left: interactive ? undefined : 0,
          right: interactive ? undefined : 0,
          bottom: interactive ? undefined : 0,
          zIndex: interactive ? undefined : 20,
        boxSizing: 'border-box',
        padding: '8px 16px',
        height: 'auto',
        overflow: 'hidden',
        borderTop: `1px solid ${theme.border}`,
        backgroundColor: theme.bgSecondary,
        backdropFilter: theme.isDark && theme.glassEnabled ? 'blur(10px)' : 'none',
        display: hidden ? 'none' : 'flex',
        opacity,
        pointerEvents: interactive ? 'auto' : 'none',
        transition: 'opacity 90ms linear',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: theme.textSecondary,
        userSelect: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', flex: 1, minWidth: 0 }}>
        <LibraryFooterSidebarToggle
          theme={theme}
          collapsed={sidebarCollapsed}
          enabled
          onToggle={onToggleSidebar}
          shortcutLabel="⌘."
        />
        <LibraryFooterMaxwellHistoryButton
          theme={theme}
          open={maxwellHistoryOpen}
          onToggle={() => setMaxwellHistoryOpen((open) => !open)}
        />
        {localCommandStatus ? (
          <LibraryFooterLocalCommandStatusControls
            theme={theme}
            status={localCommandStatus}
            label={footerStatusLabel}
            onCancel={() => void cancelLocalCommandRun()}
          />
        ) : authSession && cachedTier === 'pro' ? (
          <span style={{ fontWeight: 500 }}>Pro</span>
        ) : authSession ? (
          <span style={{ fontWeight: 500 }}>Basic</span>
        ) : null}
      </div>
      {!footerStatusLabel ? (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <LibraryFooterLogo theme={theme} />
      </div>
      ) : <div style={{ flex: 1 }} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', fontSize: '9px', flex: 1, minHeight: '18px' }}>
        <LibraryFooterUpdaterStatus
          theme={theme}
          appVersion={updaterStatus.appVersion}
          updaterEnabled={updaterStatus.updaterEnabled}
          updateStatus={updaterStatus.updateStatus}
          updateError={updaterStatus.updateError}
          isOnline={isOnline}
          fpsActive={isWindowVisible && !hidden}
          callsign={callsign}
          onCheckForUpdates={() => void updaterStatus.checkForUpdates()}
          onDismissUpdate={updaterStatus.dismissUpdate}
          onDownloadUpdate={updaterStatus.downloadUpdate}
          onInstallUpdate={updaterStatus.installUpdate}
        />
        <LibraryFooterThemeToggleButton theme={theme} onToggle={toggleDarkMode} />
      </div>
      </div>
      {showFocusStatusOverlay ? (
        <LibraryFooterStatusOverlay
          theme={theme}
          label={footerStatusLabel}
          status={localCommandStatus}
        />
      ) : null}
      <LibraryFooterMaxwellHistoryPopover
        open={maxwellHistoryOpen && !hidden}
        onClose={() => setMaxwellHistoryOpen(false)}
        footerRef={footerRef}
      />
    </>
  );
}

async function main() {
  await installBrowserLibraryHost(readBrowserHelperConfig());
  document.body.dataset.fieldTheoryBrowserLibraryHost = 'ready';
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Missing browser Library root element');
  rootElement.textContent = 'Loading Field Theory Library...';
  const [{ default: LibrarianView }, { default: CommandsView }, { ThemeProvider }] = await Promise.all([
    import('./components/LibrarianView'),
    import('./components/CommandsView'),
    import('./contexts/ThemeContext'),
  ]);
  document.body.dataset.fieldTheoryBrowserLibraryNative = 'loaded';
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserLibraryApp
        LibrarianView={LibrarianView}
        CommandsView={CommandsView}
        ThemeProvider={ThemeProvider}
        initialOpenTarget={getBrowserLibraryInitialOpenTarget(window.location)}
      />
    </React.StrictMode>,
  );
  document.body.dataset.fieldTheoryBrowserLibraryReact = 'render-called';
}

if (import.meta.env.MODE !== 'test') {
  void main().catch((error) => {
    window.__fieldTheoryBrowserLibraryErrors?.push({
      type: 'startup',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    document.body.dataset.fieldTheoryBrowserLibraryNative = 'error';
  });
}
