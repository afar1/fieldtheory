import React from 'react';
import ReactDOM from 'react-dom/client';
import { useTheme } from './contexts/ThemeContext';
import MaxwellHistoryPopover from './components/MaxwellHistoryPopover';
import './styles.css';
import { isSidebarToggleShortcut } from './utils/editorShortcuts';

type BrowserHelperConfig = {
  api: string;
  token: string;
  clientId: string;
};

type RequestOptions = RequestInit & {
  json?: unknown;
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
    __fieldTheoryBrowserOpenMarkdownTarget?: (target: any) => void;
  }
}

const noopUnsubscribe = () => {};
const LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY = 'librarian-sidebar-collapsed';
const RENDERER_STORAGE_SYNC_KEYS = [
  'library-sort-mode',
  'wiki-expanded-folders',
  'wiki-recent-collapsed',
  'library-pinned-item-ids',
  'library-sidebar-icon-color-indices',
  'library-sidebar-icon-color-order',
  'library-new-doc-location',
  'fieldtheory.libraryRenameTrace',
  'fieldtheory.contentToolbar.pinnedActions.v2',
  'librarian-text-size',
  'librarian-typography-preset',
  'librarian-line-height',
  'librarian-unordered-list-marker',
  'librarian-todo-marker',
  'librarian-maxwell-items',
  'librarian-html-layout-by-path',
  'librarian-last-selection',
  'librarian-editor-session',
  'fieldtheory.lineNumbers',
  'librarian-sidebar-width',
  LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY,
  'bookmarks-view-mode',
  'bookmarks-show-text',
  'commands-text-size',
  'commands-sidebar-width',
  'fieldtheory-rendered-editor-debug',
  'darkMode',
  'glassEffect',
  'accentPreset',
  'darkModeIntensity',
] as const;
const RENDERER_STORAGE_SYNC_KEY_SET = new Set<string>(RENDERER_STORAGE_SYNC_KEYS);
type RendererStorageApplyOptions = {
  fillMissingOnly?: boolean;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

type RendererStorageResponse = {
  available: boolean;
  values: Record<string, string | null>;
};

type FooterLocalCommandStatus = {
  status: 'running' | 'success' | 'error' | 'notice';
  message: string;
  detail?: string;
  commandName?: string;
  filePath?: string;
  mode?: 'document' | 'selection';
  runId?: string;
  phase?: string;
  error?: string;
  updatedAt?: number;
};

const LOCAL_COMMAND_ACTIVITY_FRAMES = ['|', '/', '-', '\\'] as const;

function compactFooterStatusDetail(value: string | undefined, maxLength = 96): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3)}...`
    : compacted;
}

function formatFooterLocalCommandStatus(status: FooterLocalCommandStatus, activityFrame?: string): string {
  const detail = compactFooterStatusDetail(status.detail);
  const message = status.status === 'running' && activityFrame
    ? `[${activityFrame}] ${status.message}`
    : status.message;
  return detail ? `${message} - ${detail}` : message;
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

function createBrowserHelperClient(config: BrowserHelperConfig) {
  return async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.error ?? body.result?.reason ?? `Request failed: ${response.status}`);
    }
    return body as T;
  };
}

function createBrowserEventHub(config: BrowserHelperConfig) {
  const listeners = new Map<string, Set<(detail: any) => void>>();
  let eventSource: EventSource | null = null;

  const ensureEventSource = () => {
    if (eventSource) return;
    eventSource = new EventSource(`${config.api}/native/events?token=${encodeURIComponent(config.token)}&clientId=${encodeURIComponent(config.clientId)}`);
    for (const type of [
      'wiki:changed',
      'wiki:deleted',
      'wiki:renamed',
      'wiki:openPage',
      'library:changed',
      'library:renamed',
      'external:openPage',
      'librarian:readingAdded',
      'librarian:readingUpdated',
      'librarian:readingRemoved',
      'librarian:readingRenamed',
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
      'commands:localCommandStatus',
      'commands:openMarkdownFromLauncher',
      'commands:toggleLineNumbersFromLauncher',
      'meetings:status',
      'auth:sessionChanged',
      'team:changed',
      'bookmarks:changed',
      'agent:kickoffStatus',
    ]) {
      eventSource.addEventListener(type, (event) => {
        const detail = parseBrowserEventDetail(event);
        listeners.get(type)?.forEach((listener) => listener(detail));
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
}

async function syncRendererStorage(
  request: ReturnType<typeof createBrowserHelperClient>,
  options: RendererStorageApplyOptions = {},
): Promise<void> {
  const response = await request<RendererStorageResponse>('/native/renderer-storage')
    .catch(() => ({ available: false, values: {} }));
  if (!response.available) return;
  const setItem = options.setItem ?? window.localStorage.setItem.bind(window.localStorage);
  const removeItem = options.removeItem ?? window.localStorage.removeItem.bind(window.localStorage);
  for (const key of RENDERER_STORAGE_SYNC_KEYS) {
    const value = response.values[key];
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

function startRendererStorageRefresh(
  request: ReturnType<typeof createBrowserHelperClient>,
  storageApplyOptions: RendererStorageApplyOptions,
): void {
  let inFlight = false;
  const refresh = () => {
    if (inFlight) return;
    inFlight = true;
    void syncRendererStorage(request, storageApplyOptions).finally(() => {
      inFlight = false;
    });
  };
  const interval = window.setInterval(refresh, 3000);
  window.addEventListener('focus', refresh);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(interval);
    window.removeEventListener('focus', refresh);
  }, { once: true });
}

function startBrowserSurfaceActivityReporting(request: ReturnType<typeof createBrowserHelperClient>): void {
  let lastReportedAt = 0;
  const reportActive = () => {
    const now = Date.now();
    if (now - lastReportedAt < 500) return;
    lastReportedAt = now;
    void request('/native/client-active', { method: 'POST' }).catch(() => {});
  };
  const reportVisibleActive = () => {
    if (document.visibilityState === 'hidden') return;
    reportActive();
  };
  reportVisibleActive();
  window.addEventListener('focus', reportVisibleActive);
  window.addEventListener('pointerdown', reportVisibleActive, true);
  window.addEventListener('keydown', reportVisibleActive, true);
  document.addEventListener('visibilitychange', reportVisibleActive);
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('focus', reportVisibleActive);
    window.removeEventListener('pointerdown', reportVisibleActive, true);
    window.removeEventListener('keydown', reportVisibleActive, true);
    document.removeEventListener('visibilitychange', reportVisibleActive);
  }, { once: true });
}

async function installBrowserLibraryHost(config: BrowserHelperConfig): Promise<void> {
  const request = createBrowserHelperClient(config);
  const events = createBrowserEventHub(config);
  await syncRendererStorage(request, { fillMissingOnly: true });
  const storageApplyOptions = installRendererStorageWriteThrough(request);
  startRendererStorageRefresh(request, storageApplyOptions);
  startBrowserSurfaceActivityReporting(request);

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
    onRootsChanged: (callback: () => void) => events.on('library:changed', callback),
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
    onPageChanged: (callback: () => void) => events.on('wiki:changed', callback),
    onPageDeleted: (callback: (relPath: string) => void) => events.on('wiki:deleted', (detail) => callback(detail.relPath)),
    onPageRenamed: (callback: (event: unknown) => void) => events.on('wiki:renamed', (detail) => callback(detail.event)),
    onOpenWikiPage: (callback: (relPath: string) => void) => events.on('wiki:openPage', (detail) => callback(detail.relPath)),
  } as any;

  window.externalAPI = {
    open: async (filePath: string) => (
      await request<{ file: unknown }>(`/native/external/open?path=${encodeURIComponent(filePath)}`)
    ).file,
    save: async (filePath: string, content: string, expectedVersion?: unknown) => (
      await request<{ result: unknown }>('/native/external/save', {
        method: 'PUT',
        json: { path: filePath, content, expectedVersion },
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
    isSetupComplete: async () => true,
    getReadings: async () => (await request<{ readings: unknown[] }>('/native/librarian/readings')).readings,
    getReading: async (filePath: string) => (
      await request<{ reading: unknown }>(`/native/librarian/reading?path=${encodeURIComponent(filePath)}`)
    ).reading,
    saveReading: async (filePath: string, content: string, expectedVersion?: unknown) => (
      await request<{ result: unknown }>('/native/librarian/reading', {
        method: 'PUT',
        json: { filePath, content, expectedVersion },
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
    isMutedForToday: async () => (
      await request<{ muted: boolean }>('/native/librarian/muted-for-today')
    ).muted,
    muteForToday: async () => (
      await request<{ muted: boolean }>('/native/librarian/mute-for-today', { method: 'POST' })
    ).muted,
    unmute: async () => (
      await request<{ muted: boolean }>('/native/librarian/unmute', { method: 'POST' })
    ).muted === false,
    setImmersiveDismissable: async () => {},
    setSizeKey: async () => {},
    setMarkdownEditorFocused: async (focused: boolean) => {
      await request('/native/librarian/editor-focused', { method: 'POST', json: { focused, clientId: config.clientId } }).catch(() => {});
    },
    onReadingAdded: (callback: (reading: unknown) => void) => events.on('librarian:readingAdded', (detail) => callback(detail.reading)),
    onReadingUpdated: (callback: (reading: unknown) => void) => events.on('librarian:readingUpdated', (detail) => callback(detail.reading)),
    onReadingRemoved: (callback: (filePath: string) => void) => events.on('librarian:readingRemoved', (detail) => callback(detail.filePath)),
    onReadingRenamed: (callback: (event: unknown) => void) => events.on('librarian:readingRenamed', (detail) => callback(detail.event)),
    onShowReading: (callback: (readingPath: string) => void) => events.on('librarian:showReading', (detail) => callback(detail.readingPath)),
    onSetFullscreen: (callback: (fullscreen: boolean) => void) => events.on('librarian:setFullscreen', (detail) => callback(detail.fullscreen === true)),
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
    onChanged: (callback: () => void) => events.on('recent:changed', callback),
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

  window.commandsAPI = {
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
      await request<{ command: unknown }>('/native/commands/by-path', {
        method: 'POST',
        json: { directoryPath, name, content },
      })
    ).command,
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
    setActiveLibraryFileContext: async (context: any) => {
      await request('/native/current', context ? { method: 'POST', json: context } : { method: 'DELETE' }).catch(() => {});
    },
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
    onLocalCommandStatus: (callback: (status: unknown) => void) => events.on('commands:localCommandStatus', (detail) => callback(detail.status)),
    onMeetingStatus: (callback: (session: unknown) => void) => events.on('meetings:status', (detail) => callback(detail.session)),
    onOpenMarkdownFromLauncher: (callback: (target: unknown) => void) => events.on('commands:openMarkdownFromLauncher', (detail) => callback(detail.target)),
    onToggleLineNumbersFromLauncher: (callback: () => void) => events.on('commands:toggleLineNumbersFromLauncher', callback),
    openFieldTheoryMarkdown: async (target: any) => {
      window.__fieldTheoryBrowserOpenMarkdownTarget?.(target);
      return { success: true };
    },
  } as any;

  window.shellAPI = {
    openExternal: (href: string) => {
      void request('/native/shell/open-external', {
        method: 'POST',
        json: { href },
      }).catch(() => {
        if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
      });
    },
    showItemInFolder: (filePath: string) => {
      void request('/native/shell/show-item-in-folder', {
        method: 'POST',
        json: { filePath },
      }).catch(() => {});
    },
    setRepresentedFilename: () => {},
  } as any;

  window.authAPI = {
    onSessionChanged: (callback: (session: unknown | null) => void) => events.on('auth:sessionChanged', (detail) => callback(detail.session ?? null)),
  } as any;

  window.teamAPI = {
    onTeamChanged: (callback: () => void) => events.on('team:changed', callback),
  } as any;

  window.fieldTheorySyncAPI = {
    getStatus: async () => (
      await request<{ status: unknown }>('/native/field-theory-sync/status')
    ).status,
  } as any;

  window.agentKickoffAPI = {
    onStatus: (callback: (event: unknown) => void) => events.on('agent:kickoffStatus', (detail) => callback(detail.event)),
  } as any;

  window.bookmarksAPI = {
    getAll: async () => (
      await request<{ snapshot: unknown }>('/native/bookmarks/all')
    ).snapshot,
    syncIfStale: async () => (
      await request<{ result: unknown }>('/native/bookmarks/sync-if-stale', { method: 'POST' })
    ).result,
    copyForAgent: async (id: string) => (
      await request<{ result: unknown }>('/native/bookmarks/copy-for-agent', {
        method: 'POST',
        json: { id },
      })
    ).result,
    onChanged: (callback: () => void) => events.on('bookmarks:changed', callback),
  } as any;

  window.diagnosticsAPI = {
    appendRenderedEditorDebug: async () => {},
    clearRenderedEditorDebugLog: async () => {},
  } as any;
}

function BrowserLibraryApp(props: {
  LibrarianView: React.ComponentType<any>;
  CommandsView: React.ComponentType<any>;
  ThemeProvider: React.ComponentType<{ children: React.ReactNode }>;
}) {
  const { LibrarianView, CommandsView, ThemeProvider } = props;

  return (
    <BrowserLibraryErrorBoundary>
      <ThemeProvider>
        <BrowserLibrarySurface LibrarianView={LibrarianView} CommandsView={CommandsView} />
      </ThemeProvider>
    </BrowserLibraryErrorBoundary>
  );
}

function BrowserLibrarySurface(props: {
  LibrarianView: React.ComponentType<any>;
  CommandsView: React.ComponentType<any>;
}) {
  const { LibrarianView, CommandsView } = props;
  const { theme } = useTheme();
  const [surface, setSurface] = React.useState<'library' | 'commands'>('library');
  const [launcherOpenTarget, setLauncherOpenTarget] = React.useState<any>(null);
  const [initialCommandPath, setInitialCommandPath] = React.useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => (
    window.localStorage.getItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  ));
  const [librarySidebarToggleRequestKey, setLibrarySidebarToggleRequestKey] = React.useState(0);
  const [bookmarksCanvasChromeActive, setBookmarksCanvasChromeActive] = React.useState(false);
  const [focusChromeChildActive, setFocusChromeChildActive] = React.useState(false);
  const [focusChromeGlobalEnabled, setFocusChromeGlobalEnabledState] = React.useState(false);
  const [focusChromeGroupOpacity, setFocusChromeGroupOpacity] = React.useState(0);
  const focusChromeGlobalEnabledRef = React.useRef(false);
  const focusChromePreviousSidebarCollapsedRef = React.useRef<boolean | null>(null);
  const footerRef = React.useRef<HTMLDivElement | null>(null);
  const focusChromeSurfaceEnabled = focusChromeChildActive || focusChromeGlobalEnabled;
  const footerChromeOpacity = focusChromeSurfaceEnabled ? 0 : 1;
  const footerChromeInteractive = footerChromeOpacity > 0.05;
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

  const openMarkdownTarget = React.useCallback((target: any) => {
    if (!target || target.kind === 'clipboard' || target.kind === 'settings') return;
    if (target.sidebarCollapsed === true) {
      setSidebarCollapsed(true);
      window.localStorage.setItem(LIBRARIAN_SIDEBAR_COLLAPSED_STORAGE_KEY, '1');
    }
    if (target.focusChrome === true) {
      enableGlobalFocusChrome();
    }
    if (target.kind === 'command') {
      setInitialCommandPath(typeof target.path === 'string' ? target.path : null);
      setSurface('commands');
      return;
    }
    if (target.kind === 'commands') {
      setInitialCommandPath(null);
      setSurface('commands');
      return;
    }
    if (target.kind === 'library') {
      setLauncherOpenTarget(null);
      setSurface('library');
      return;
    }
    setLauncherOpenTarget(target);
    setSurface('library');
  }, [enableGlobalFocusChrome]);

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
      if (!isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [toggleSidebarCollapsed]);

  return (
    <div
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
            />
          ) : (
            <LibrarianView
              active
              browserLibrarySurface
              initialOpenTarget={launcherOpenTarget}
              onInitialOpenTargetConsumed={() => setLauncherOpenTarget(null)}
              sidebarCollapsed={sidebarCollapsed}
              sidebarToggleRequestKey={librarySidebarToggleRequestKey}
              onSwitchToClipboard={() => {}}
              onFocusChromeActiveChange={handleFocusChromeActiveChange}
              onBookmarksCanvasActiveChange={setBookmarksCanvasChromeActive}
              focusChromeGroupOpacity={focusChromeGroupOpacity}
              focusChromeEnabled={focusChromeGlobalEnabled}
              onFocusChromeEnabledChange={handleGlobalFocusChromeChange}
              onFocusChromeShortcut={enableGlobalFocusChrome}
              onOpenCommandPath={(path: string) => openMarkdownTarget({ kind: 'command', path })}
            />
          )}
      </div>
      <BrowserLibraryFooter
        footerRef={footerRef}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebarCollapsed}
        hidden={bookmarksCanvasChromeActive}
        opacity={footerChromeOpacity}
        interactive={footerChromeInteractive}
      />
    </div>
  );
}

function BrowserLibraryFooter(props: {
  footerRef: React.RefObject<HTMLDivElement | null>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  hidden: boolean;
  opacity: number;
  interactive: boolean;
}) {
  const { footerRef, sidebarCollapsed, onToggleSidebar, hidden, opacity, interactive } = props;
  const { theme } = useTheme();
  const [localCommandStatus, setLocalCommandStatus] = React.useState<FooterLocalCommandStatus | null>(null);
  const [localCommandActivityFrameIndex, setLocalCommandActivityFrameIndex] = React.useState(0);
  const [maxwellHistoryOpen, setMaxwellHistoryOpen] = React.useState(false);

  React.useEffect(() => {
    return window.commandsAPI?.onLocalCommandStatus?.((status: FooterLocalCommandStatus) => {
      setLocalCommandStatus(status);
    });
  }, []);

  React.useEffect(() => {
    if (localCommandStatus?.status !== 'running') {
      setLocalCommandActivityFrameIndex(0);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setLocalCommandActivityFrameIndex((index) => (index + 1) % LOCAL_COMMAND_ACTIVITY_FRAMES.length);
    }, 180);
    return () => window.clearInterval(interval);
  }, [localCommandStatus?.status]);

  React.useEffect(() => {
    if (!localCommandStatus) return undefined;
    const timeoutMs = localCommandStatus.status === 'running'
      ? 300000
      : localCommandStatus.status === 'error'
        ? 9000
        : 3500;
    const timeout = window.setTimeout(() => setLocalCommandStatus(null), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [localCommandStatus]);

  const cancelLocalCommandRun = React.useCallback(async () => {
    const runId = localCommandStatus?.runId;
    if (!runId || !window.commandsAPI?.cancelMaxwellRun) return;
    const showCancelError = (message: string) => {
      setLocalCommandStatus({
        status: 'error',
        message,
        commandName: localCommandStatus.commandName,
        filePath: localCommandStatus.filePath,
        mode: localCommandStatus.mode,
        runId,
        error: message,
        updatedAt: Date.now(),
      });
    };
    try {
      const result = await window.commandsAPI.cancelMaxwellRun(runId);
      if (!result?.success) {
        showCancelError(result?.error ?? 'Could not cancel Maxwell run');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not cancel Maxwell run';
      showCancelError(message);
    }
  }, [localCommandStatus]);

  const localCommandActivityFrame = LOCAL_COMMAND_ACTIVITY_FRAMES[localCommandActivityFrameIndex] ?? LOCAL_COMMAND_ACTIVITY_FRAMES[0];
  const footerStatusLabel = localCommandStatus
    ? formatFooterLocalCommandStatus(
      localCommandStatus,
      localCommandStatus.status === 'running' ? localCommandActivityFrame : undefined,
    )
    : null;
  const showFocusStatusOverlay = !hidden && !interactive && !!footerStatusLabel;
  const focusStatusOverlayColor = localCommandStatus?.status === 'error' ? theme.error : theme.textSecondary;

  return (
    <>
      <style>{`
        @keyframes localStatusFadeOut {
          0%, 68% { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>
      <div
      ref={footerRef}
      data-fieldtheory-browser-library-footer="true"
      style={{
        position: interactive ? 'relative' : 'absolute',
        left: interactive ? undefined : 0,
        right: interactive ? undefined : 0,
        bottom: interactive ? undefined : 0,
        zIndex: interactive ? undefined : 20,
        boxSizing: 'border-box',
        padding: '8px 16px',
        borderTop: `1px solid ${theme.border}`,
        backgroundColor: theme.bgSecondary,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={onToggleSidebar}
          title={`${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} (⌘,)`}
          aria-label="Toggle sidebar"
          style={{
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            background: 'transparent',
            color: theme.textSecondary,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background 0.15s ease, opacity 0.15s ease',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: sidebarCollapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          >
            <path d="M10 4L6 8l4 4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setMaxwellHistoryOpen((open) => !open)}
          title="Maxwell history"
          aria-label="Maxwell history"
          style={{
            width: '18px',
            height: '18px',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: maxwellHistoryOpen ? theme.accent : 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={maxwellHistoryOpen ? '#fff' : theme.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 3v6h6" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
        {footerStatusLabel ? (
          <>
            <span style={{ fontWeight: 500 }}>Local model:</span>
            <span
              style={{
                color: localCommandStatus?.status === 'error' ? theme.error : theme.textSecondary,
                opacity: 0.85,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {footerStatusLabel}
            </span>
            {localCommandStatus?.status === 'running' && localCommandStatus.runId ? (
              <button
                type="button"
                onClick={() => void cancelLocalCommandRun()}
                title="Cancel Maxwell run"
                aria-label="Cancel Maxwell run"
                style={{
                  width: '18px',
                  height: '18px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {!footerStatusLabel ? (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <img
          src={theme.isDark ? 'fieldtheory-logo-white.png' : 'fieldtheory-logo-black.png'}
          alt="Field Theory"
          style={{
            height: '14px',
            width: 'auto',
            maxWidth: '112px',
            objectFit: 'contain',
            opacity: 0.72,
            display: 'block',
          }}
        />
      </div>
      ) : <div style={{ flex: 1 }} />}
      <div style={{ flex: 1 }} />
      </div>
      {showFocusStatusOverlay ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '14px',
            transform: 'translateX(-50%)',
            zIndex: 24,
            maxWidth: 'min(620px, calc(100% - 48px))',
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: theme.isDark ? 'rgba(20, 23, 29, 0.76)' : 'rgba(255, 255, 255, 0.86)',
            border: `1px solid ${theme.border}`,
            color: focusStatusOverlayColor,
            fontSize: '10px',
            lineHeight: 1.35,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            opacity: 0.9,
            transition: 'opacity 160ms ease',
            animation: localCommandStatus && localCommandStatus.status !== 'running'
              ? `localStatusFadeOut ${localCommandStatus.status === 'error' ? 9 : 3.5}s ease forwards`
              : undefined,
          }}
        >
          {footerStatusLabel}
        </div>
      ) : null}
      <MaxwellHistoryPopover
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
      <BrowserLibraryApp LibrarianView={LibrarianView} CommandsView={CommandsView} ThemeProvider={ThemeProvider} />
    </React.StrictMode>,
  );
  document.body.dataset.fieldTheoryBrowserLibraryReact = 'render-called';
}

void main().catch((error) => {
  window.__fieldTheoryBrowserLibraryErrors?.push({
    type: 'startup',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  document.body.dataset.fieldTheoryBrowserLibraryNative = 'error';
});
