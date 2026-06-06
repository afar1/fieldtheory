import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { BrowserHelperDocumentService, type BrowserHelperWikiPage } from './browserHelperDocumentService';
import type { DocumentVersion } from './documentSaveGuard';
import type { DocumentPresenceContext } from './documentPresence';
import {
  getLocalImageCacheHeaders,
  getLocalImageContentType,
  isAllowedLocalImagePath,
  localImagePathFromProtocolUrl,
  shouldReturnLocalImageNotModified,
} from './localImageProtocol';
import { isPathInside } from './pathSafety';
import type { RecentEntry, RecentKind } from './recentManager';
import { isAllowedExternalShellUrl } from './shellIpc';

export type BrowserHelperServerOptions = {
  service: BrowserHelperDocumentServiceLike;
  reportCurrentDocument?: (context: DocumentPresenceContext, clientId?: string | null) => void;
  clearCurrentDocument?: (clientId?: string | null) => void;
  setActiveClient?: (clientId?: string | null, surface?: BrowserHelperClientSurface | null) => void;
  clearActiveClient?: (clientId?: string | null) => void;
  onClientDisconnected?: (clientId: string | null) => void;
  nativeBridge?: BrowserHelperNativeBridge;
  token?: string;
  host?: string;
  port?: number;
  staticDir?: string;
};

export type BrowserHelperDocumentServiceLike = {
  getRoots: BrowserHelperDocumentService['getRoots'];
  getLibraryRoots: () => unknown[];
  addLibraryRoot: (dirPath: string) => unknown | null;
  removeLibraryRoot: (dirPath: string) => boolean;
  getWikiTree: () => unknown[];
  getWikiPage: (relPath: string) => BrowserHelperWikiPage | null;
  findWikiPageByDocumentVersion: (version: DocumentVersion, previousRelPath?: string) => unknown | null;
  saveWikiPage: BrowserHelperDocumentService['saveWikiPage'];
  createWikiFile: (folderRelPath: string, fileName: string) => unknown | null;
  createWikiFileWithDefaultTitle: (folderRelPath: string) => unknown | null;
  createScratchpadDefault?: () => unknown | null;
  openScratchpadDefault?: () => unknown | null;
  createWikiDir: BrowserHelperDocumentService['createWikiDir'];
  deleteWikiPage: (relPath: string) => boolean | Promise<boolean>;
  renameWikiPage: BrowserHelperDocumentService['renameWikiPage'];
  createLibraryFile: (rootPath: string, folderRelPath: string, fileName: string) => unknown | null;
  createLibraryDir: BrowserHelperDocumentService['createLibraryDir'];
  deleteLibraryDir: (rootPath: string, dirRelPath: string) => boolean | Promise<boolean>;
  moveLibraryItem: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string) => string | null;
  openExternal: BrowserHelperDocumentService['openExternal'];
  saveExternal: BrowserHelperDocumentService['saveExternal'];
  findLibraryFileByDocumentVersion: (version: DocumentVersion, previousAbsPath?: string) => unknown | null;
  renameExternal: (filePath: string, newName: string) => unknown | null;
  deleteExternal: (filePath: string) => boolean | Promise<boolean>;
  getDocument: BrowserHelperDocumentService['getDocument'];
  saveDocument: BrowserHelperDocumentService['saveDocument'];
};

export type BrowserHelperServerAddress = {
  host: string;
  port: number;
  token: string;
  url: string;
};

export type BrowserHelperClientSurface = 'library' | 'commands' | 'bookmarks' | 'ember';

export type BrowserHelperNativeEvent =
  | { type: 'wiki:changed'; event?: unknown }
  | { type: 'wiki:deleted'; relPath: string }
  | { type: 'wiki:renamed'; event: unknown }
  | { type: 'wiki:openPage'; relPath: string }
  | { type: 'wiki:openScratchpad'; relPath: string }
  | { type: 'library:changed'; event?: unknown }
  | { type: 'library:renamed'; event: unknown }
  | { type: 'external:openPage'; absPath: string }
  | { type: 'librarian:readingAdded'; reading: unknown }
  | { type: 'librarian:readingUpdated'; reading: unknown }
  | { type: 'librarian:readingRemoved'; filePath: string }
  | { type: 'librarian:readingRenamed'; event: unknown }
  | { type: 'librarian:newReadingAvailable'; readingPath: string }
  | { type: 'librarian:showNewReading'; readingPath: string }
  | { type: 'librarian:showReading'; readingPath: string }
  | { type: 'librarian:setFullscreen'; fullscreen: boolean }
  | { type: 'librarian:insertMarkdownText'; text: string }
  | { type: 'librarian:insertPlainMarkdownText'; text: string }
  | { type: 'librarian:replaceSelectedMarkdownText'; request: unknown }
  | { type: 'recent:changed'; entries?: unknown }
  | { type: 'taggedDocs:updated'; docs?: unknown }
  | { type: 'taggedDocs:scanProgress'; progress: unknown }
  | { type: 'sharedFiles:presenceChanged'; payload: unknown }
  | { type: 'sharedFiles:pinsChanged' }
  | { type: 'commands:changed'; commands: unknown[] }
  | { type: 'commands:directoryChanged'; directoryPath: string | null }
  | { type: 'commands:localCommandStatus'; status: unknown }
  | { type: 'commands:openMarkdownFromLauncher'; target: unknown }
  | { type: 'commands:toggleLineNumbersFromLauncher' }
  | { type: 'meetings:status'; session: unknown }
  | { type: 'auth:sessionChanged'; session: unknown | null }
  | { type: 'quota:tierChanged'; tier: 'free' | 'pro' }
  | { type: 'quota:changed'; data: unknown }
  | { type: 'team:changed' }
  | { type: 'bookmarks:changed' }
  | { type: 'updater:checkingForUpdate' }
  | { type: 'updater:updateAvailable'; info: unknown }
  | { type: 'updater:updateNotAvailable' }
  | { type: 'updater:downloadProgress'; percent: number }
  | { type: 'updater:updateDownloaded'; info: unknown }
  | { type: 'updater:installing' }
  | { type: 'updater:error'; error: string }
  | { type: 'agent:kickoffProgress'; event: unknown }
  | { type: 'agent:kickoffStatus'; event: unknown }
  | { type: 'theme:changed'; isDark: boolean }
  | { type: 'renderer-storage:changed'; key: string; value: string | null };

export type BrowserHelperRendererStorageSnapshot = {
  available: boolean;
  values: Record<string, string | null>;
};

export type BrowserHelperNativeBridge = {
  getAuthSession?: () => unknown | Promise<unknown>;
  getAuthCallsign?: () => string | null | Promise<string | null>;
  getMetrics?: () => unknown | Promise<unknown>;
  fetchMetricsFromSupabase?: () => boolean | Promise<boolean>;
  getQuotas?: () => unknown | Promise<unknown>;
  getTheme?: () => boolean | Promise<boolean>;
  setTheme?: (isDark: boolean) => void | Promise<void>;
  getHotkey?: (id: string) => string | null | Promise<string | null>;
  getHiddenFolders?: () => string[];
  setFolderHidden?: (folderId: string, hidden: boolean) => string[];
  recordRecentWikiPage?: (page: unknown) => void | Promise<void>;
  recordRecentCreatedLibraryPage?: (page: unknown, rootPath: string) => void | Promise<void>;
  notifyWikiPageChanged?: (event: unknown) => void | Promise<void>;
  notifyWikiPageRenamed?: (event: unknown) => void | Promise<void>;
  notifyLibraryPageChanged?: (event: unknown) => void | Promise<void>;
  notifyLibraryItemRenamed?: (event: unknown) => void | Promise<void>;
  getReadings?: () => unknown[] | Promise<unknown[]>;
  getReading?: (filePath: string) => unknown | Promise<unknown>;
  saveReading?: (filePath: string, content: string, expectedVersion?: unknown) => unknown | Promise<unknown>;
  deleteReading?: (filePath: string) => boolean | Promise<boolean>;
  getShareStatus?: (filePath: string) => unknown | Promise<unknown>;
  shareReading?: (filePath: string) => unknown | Promise<unknown>;
  unshareReading?: (filePath: string) => boolean | Promise<boolean>;
  updateSharedReading?: (filePath: string, content: string, title: string) => boolean | Promise<boolean>;
  isLibrarianEnabled?: () => boolean | Promise<boolean>;
  setLibrarianEnabled?: (enabled: boolean) => boolean | Promise<boolean>;
  isLibrarianSetupComplete?: () => boolean | Promise<boolean>;
  setLibrarianSetupComplete?: (complete: boolean) => void | Promise<void>;
  createWelcomeArtifact?: (dirPath: string) => boolean | Promise<boolean>;
  getLibrarianWatchedDirs?: () => unknown[] | Promise<unknown[]>;
  addLibrarianWatchedDir?: (dirPath: string) => unknown | Promise<unknown>;
  removeLibrarianWatchedDir?: (dirPath: string) => boolean | Promise<boolean>;
  browseLibrarianDirectory?: () => string | null | Promise<string | null>;
  getDiscoveryFrequency?: () => string | Promise<string>;
  setDiscoveryFrequency?: (frequency: string) => boolean | Promise<boolean>;
  getUserExpertiseContext?: () => string | undefined | Promise<string | undefined>;
  setUserExpertiseContext?: (context: string | undefined) => boolean | Promise<boolean>;
  getClaudeCodeStatus?: () => string | Promise<string>;
  isStateEnforcedHookInstalled?: () => boolean | Promise<boolean>;
  installStateEnforcedHook?: () => boolean | Promise<boolean>;
  uninstallStateEnforcedHook?: () => boolean | Promise<boolean>;
  isCursorHookInstalled?: () => boolean | Promise<boolean>;
  installCursorHook?: () => boolean | Promise<boolean>;
  uninstallCursorHook?: () => boolean | Promise<boolean>;
  isCodexHookInstalled?: () => boolean | Promise<boolean>;
  installCodexHook?: () => boolean | Promise<boolean>;
  uninstallCodexHook?: () => boolean | Promise<boolean>;
  pollLibrarianStatus?: () => unknown | Promise<unknown>;
  muteForToday?: () => boolean | Promise<boolean>;
  isMutedForToday?: () => boolean | Promise<boolean>;
  unmute?: () => boolean | Promise<boolean>;
  setBrowserLibraryImmersiveDismissable?: (dismissable: boolean, clientId?: string | null) => void | Promise<void>;
  setBrowserLibrarySizeKey?: (key: 'fields' | 'library' | 'canvas' | 'draw', clientId?: string | null) => void | Promise<void>;
  setMarkdownEditorFocused?: (focused: boolean, clientId?: string | null) => void | Promise<void>;
  replaceSelectedMarkdownTextResult?: (result: { requestId?: string; success?: boolean }) => void | Promise<void>;
  listRecent?: () => RecentEntry[];
  visitRecent?: (entry: RecentEntry) => RecentEntry[];
  removeRecent?: (kind: RecentKind, entryPath: string) => RecentEntry[];
  listTaggedDocs?: () => unknown[] | Promise<unknown[]>;
  markTaggedDocRead?: (ulid: string) => unknown | Promise<unknown>;
  markAllTaggedDocsRead?: () => unknown[] | Promise<unknown[]>;
  rescanTaggedDocs?: () => unknown[] | Promise<unknown[]>;
  getSharedFilesAvailability?: () => unknown | Promise<unknown>;
  getSharedFileStatus?: (filePath: string) => unknown | Promise<unknown>;
  shareSharedFile?: (input: unknown) => unknown | Promise<unknown>;
  unshareSharedFile?: (filePath: string) => boolean | Promise<boolean>;
  syncSharedFiles?: () => unknown | Promise<unknown>;
  updateSharedFileContent?: (sharedId: string, content: string, expectedRevision: number, documentPath?: string | null) => unknown | Promise<unknown>;
  setActivePresence?: (sharedId: string | null) => unknown[] | Promise<unknown[]>;
  getPinnedItemIds?: () => string[] | Promise<string[]>;
  setPinned?: (filePath: string, pinned: boolean) => unknown | Promise<unknown>;
  initializeCommands?: () => void | Promise<void>;
  getWatchedCommandDirs?: () => unknown[] | Promise<unknown[]>;
  addWatchedCommandDir?: (dirPath: string) => unknown | Promise<unknown>;
  removeWatchedCommandDir?: (dirPath: string) => boolean | Promise<boolean>;
  getDefaultCommandDirectory?: () => string | Promise<string>;
  createDefaultCommandDirectory?: () => string | null | Promise<string | null>;
  getCommands?: () => unknown[] | Promise<unknown[]>;
  getCommandByPath?: (filePath: string) => unknown | Promise<unknown>;
  getCommandDirectory?: () => string | null | Promise<string | null>;
  setCommandDirectory?: (directoryPath: string | null) => unknown | Promise<unknown>;
  getCommandDirectories?: () => unknown[] | Promise<unknown[]>;
  refreshCommands?: () => unknown[] | Promise<unknown[]>;
  getCommandContent?: (commandName: string) => unknown | Promise<unknown>;
  getMarkdownPreview?: (filePath: string) => unknown | Promise<unknown>;
  saveCommand?: (filePath: string, content: string, expectedVersion?: unknown) => unknown | Promise<unknown>;
  createCommand?: (directoryPath: string, name: string, content?: string) => unknown | Promise<unknown>;
  deleteCommand?: (filePath: string) => boolean | Promise<boolean>;
  renameCommand?: (oldFilePath: string, newName: string) => string | null | Promise<string | null>;
  shareCommand?: (command: unknown) => unknown | Promise<unknown>;
  unshareCommand?: (commandId: string) => unknown | Promise<unknown>;
  runLocalCommand?: (request: unknown) => unknown | Promise<unknown>;
  listMaxwellRuns?: (limit?: number) => unknown[] | Promise<unknown[]>;
  getMaxwellMemory?: () => unknown | Promise<unknown>;
  saveMaxwellMemory?: (request: unknown) => unknown | Promise<unknown>;
  cancelMaxwellRun?: (runId: string) => unknown | Promise<unknown>;
  undoMaxwellRun?: (runId: string) => unknown | Promise<unknown>;
  redoMaxwellRun?: (runId: string) => unknown | Promise<unknown>;
  archiveActiveLibraryFile?: () => unknown | Promise<unknown>;
  toggleActiveLibraryLineNumbers?: () => unknown | Promise<unknown>;
  getActiveMeeting?: () => unknown | Promise<unknown>;
  startMeetingHere?: () => unknown | Promise<unknown>;
  stopMeeting?: () => unknown | Promise<unknown>;
  getBookmarks?: () => unknown | Promise<unknown>;
  getBookmarkDataSource?: () => unknown | Promise<unknown>;
  syncBookmarksIfStale?: () => unknown | Promise<unknown>;
  getBookmarkAuthors?: () => unknown[] | Promise<unknown[]>;
  getAuthorBookmarks?: (handle: string) => unknown[] | Promise<unknown[]>;
  getTaxonomyBookmarks?: (filePaths: string[]) => unknown[] | Promise<unknown[]>;
  searchBookmarks?: (query: string) => unknown[] | Promise<unknown[]>;
  saveWebBookmarkUrl?: (url: string) => unknown | Promise<unknown>;
  getActiveWebPageForBookmark?: () => unknown | Promise<unknown>;
  saveActiveWebPageBookmark?: () => unknown | Promise<unknown>;
  invokeBookmark?: (id: string) => unknown | Promise<unknown>;
  sendBookmarkToCodex?: (id: string) => unknown | Promise<unknown>;
  copyBookmarkForAgent?: (id: string) => unknown | Promise<unknown>;
  invokeBookmarkAuthorTimeline?: (handle: string) => unknown | Promise<unknown>;
  getBookmarkMediaDirectory?: () => string | null | Promise<string | null>;
  getBookmarkMediaFilePath?: (filename: string) => string | null | Promise<string | null>;
  getAppVersion?: () => string | Promise<string>;
  isUpdaterEnabled?: () => boolean | Promise<boolean>;
  getUpdaterStatus?: () => unknown | Promise<unknown>;
  checkForUpdates?: () => unknown | Promise<unknown>;
  downloadUpdate?: () => unknown | Promise<unknown>;
  installUpdate?: () => unknown | Promise<unknown>;
  dismissUpdate?: () => unknown | Promise<unknown>;
  openExternal?: (href: string) => boolean | Promise<boolean>;
  showItemInFolder?: (filePath: string) => boolean | Promise<boolean>;
  setRepresentedFilename?: (filePath: string, clientId?: string | null) => void | Promise<void>;
  pasteIntoCodexInput?: (text: string) => unknown | Promise<unknown>;
  openFieldTheoryMarkdownInNativeApp?: (target: unknown) => unknown | Promise<unknown>;
  writeClipboardText?: (text: string) => unknown | Promise<unknown>;
  getClipboardImagePath?: () => string | null | Promise<string | null>;
  savePastedImageFile?: (file: { name?: string | null; type?: string | null; data: unknown }) => string | null | Promise<string | null>;
  pickFolder?: () => string | null | Promise<string | null>;
  openDocumentWindow?: (target: unknown) => unknown | Promise<unknown>;
  copyImageForDocument?: (documentPath: string, imagePath: string, alt?: string) => unknown | Promise<unknown>;
  copyImageDataUrlForDocument?: (documentPath: string, dataUrl: string, alt?: string) => unknown | Promise<unknown>;
  makeImagesPortable?: (documentPath: string, content: string) => unknown | Promise<unknown>;
  deleteUnusedCopiedImages?: (documentPath: string, removedMarkdown: string, remainingContent: string) => unknown | Promise<unknown>;
  getFieldTheorySyncStatus?: () => unknown | Promise<unknown>;
  startAgentKickoff?: (args: unknown) => unknown | Promise<unknown>;
  cancelAgentKickoff?: (runId: string) => boolean | Promise<boolean>;
  getRendererStorage?: () => BrowserHelperRendererStorageSnapshot | Promise<BrowserHelperRendererStorageSnapshot>;
  setRendererStorage?: (key: string, value: string | null) => void | Promise<void>;
  appendRenderedEditorDebug?: (entry: unknown) => unknown | Promise<unknown>;
  clearRenderedEditorDebugLog?: () => unknown | Promise<unknown>;
  getActiveLibraryFileContext?: () => unknown | Promise<unknown>;
};

function sanitizeAuthSessionForBrowserHelper(session: unknown): unknown | null {
  if (!session || typeof session !== 'object') return null;
  const input = session as {
    authenticated?: unknown;
    expires_at?: unknown;
    expiresAt?: unknown;
    tier?: unknown;
    callsign?: unknown;
    displayName?: unknown;
    user?: {
      id?: unknown;
      email?: unknown;
      user_metadata?: unknown;
      app_metadata?: unknown;
    } | null;
  };
  const user = input.user && typeof input.user === 'object'
    ? {
        id: typeof input.user.id === 'string' ? input.user.id : '',
        email: typeof input.user.email === 'string' ? input.user.email : undefined,
        user_metadata: input.user.user_metadata && typeof input.user.user_metadata === 'object'
          ? input.user.user_metadata
          : undefined,
        app_metadata: input.user.app_metadata && typeof input.user.app_metadata === 'object'
          ? input.user.app_metadata
          : undefined,
      }
    : null;
  if (!user?.id) return null;
  return {
    authenticated: input.authenticated === false ? false : true,
    expires_at: typeof input.expires_at === 'number' ? input.expires_at : null,
    expiresAt: typeof input.expiresAt === 'number'
      ? input.expiresAt
      : typeof input.expires_at === 'number'
        ? input.expires_at
        : null,
    tier: input.tier === 'pro' ? 'pro' : 'free',
    callsign: typeof input.callsign === 'string' ? input.callsign : null,
    displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
    user,
  };
}

function sanitizeNativeEvent(event: BrowserHelperNativeEvent): BrowserHelperNativeEvent {
  if (event.type !== 'auth:sessionChanged') return event;
  return {
    ...event,
    session: sanitizeAuthSessionForBrowserHelper(event.session),
  };
}

export class BrowserHelperServer {
  private readonly service: BrowserHelperDocumentServiceLike;
  private readonly reportCurrentDocument?: (context: DocumentPresenceContext, clientId?: string | null) => void;
  private readonly clearCurrentDocument?: (clientId?: string | null) => void;
  private readonly setActiveClient?: (clientId?: string | null, surface?: BrowserHelperClientSurface | null) => void;
  private readonly clearActiveClient?: (clientId?: string | null) => void;
  private readonly onClientDisconnected?: (clientId: string | null) => void;
  private readonly nativeBridge: BrowserHelperNativeBridge;
  private readonly token: string;
  private readonly host: string;
  private readonly port: number;
  private readonly staticDir: string | null;
  private server: http.Server | null = null;
  private readonly eventClients = new Map<http.ServerResponse, string | null>();

  constructor(options: BrowserHelperServerOptions) {
    this.service = options.service;
    this.reportCurrentDocument = options.reportCurrentDocument;
    this.clearCurrentDocument = options.clearCurrentDocument;
    this.setActiveClient = options.setActiveClient;
    this.clearActiveClient = options.clearActiveClient;
    this.onClientDisconnected = options.onClientDisconnected;
    this.nativeBridge = options.nativeBridge ?? {};
    this.token = options.token ?? crypto.randomBytes(16).toString('hex');
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.staticDir = options.staticDir ? path.resolve(options.staticDir) : null;
  }

  async start(): Promise<BrowserHelperServerAddress> {
    if (this.server) return this.address();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    return this.address();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const client of this.eventClients.keys()) {
      client.end();
    }
    this.eventClients.clear();
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  emitNativeEvent(event: BrowserHelperNativeEvent): void {
    const safeEvent = sanitizeNativeEvent(event);
    const payload = `event: ${safeEvent.type}\ndata: ${JSON.stringify(safeEvent)}\n\n`;
    for (const client of this.eventClients.keys()) {
      client.write(payload);
    }
  }

  hasNativeEventClients(): boolean {
    return this.eventClients.size > 0;
  }

  emitNativeEventToClient(clientId: string | null | undefined, event: BrowserHelperNativeEvent): boolean {
    if (!clientId) return false;
    const safeEvent = sanitizeNativeEvent(event);
    const payload = `event: ${safeEvent.type}\ndata: ${JSON.stringify(safeEvent)}\n\n`;
    let sent = false;
    for (const [client, connectedClientId] of this.eventClients) {
      if (connectedClientId !== clientId) continue;
      client.write(payload);
      sent = true;
    }
    return sent;
  }

  hasNativeEventClient(clientId: string | null | undefined): boolean {
    if (!clientId) return false;
    for (const connectedClientId of this.eventClients.values()) {
      if (connectedClientId === clientId) return true;
    }
    return false;
  }

  address(): BrowserHelperServerAddress {
    if (!this.server) {
      return { host: this.host, port: this.port, token: this.token, url: '' };
    }
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.port;
    return {
      host: this.host,
      port,
      token: this.token,
      url: `http://${this.host}:${port}/?token=${encodeURIComponent(this.token)}`,
    };
  }

  private pageChangeEvent(
    type: 'file-added' | 'file-changed' | 'file-deleted',
    page: unknown,
    builtin: boolean,
    fallbackRootPath?: string,
  ): unknown {
    const pageObject = page && typeof page === 'object' ? page as Record<string, unknown> : {};
    const relPath = typeof pageObject.relPath === 'string' ? pageObject.relPath : '';
    const absPath = typeof pageObject.absPath === 'string'
      ? pageObject.absPath
      : typeof pageObject.path === 'string'
        ? pageObject.path
        : '';
    const rootPath = typeof pageObject.rootPath === 'string' ? pageObject.rootPath : fallbackRootPath ?? '';
    return {
      type,
      rootPath,
      relPath,
      absPath,
      builtin,
      source: 'app',
      detectedAt: Date.now(),
      page,
    };
  }

  private deletedWikiPageChangeEvent(relPath: string): unknown {
    const rootPath = this.builtinWikiRootPath();
    return {
      type: 'file-deleted',
      rootPath,
      relPath,
      absPath: rootPath ? path.resolve(rootPath, `${relPath}.md`) : '',
      builtin: true,
      source: 'app',
      detectedAt: Date.now(),
    };
  }

  private builtinWikiRootPath(): string {
    const roots = this.service.getLibraryRoots();
    const root = roots.find((candidate) => (
      candidate
      && typeof candidate === 'object'
      && (candidate as { builtin?: unknown }).builtin === true
    )) ?? roots[0];
    return root && typeof root === 'object' && typeof (root as { path?: unknown }).path === 'string'
      ? (root as { path: string }).path
      : '';
  }

  private wikiRenameEvent(oldRelPath: string, newRelPath: string): unknown {
    const rootPath = this.builtinWikiRootPath();
    return this.libraryRenameEvent(rootPath, oldRelPath, newRelPath, true);
  }

  private libraryRenameEvent(rootPath: string, oldRelPath: string, newRelPath: string, builtin: boolean, newRootPath = rootPath): unknown {
    return {
      rootPath: newRootPath,
      oldRelPath,
      newRelPath,
      oldAbsPath: rootPath ? path.resolve(rootPath, `${oldRelPath}.md`) : '',
      newAbsPath: newRootPath ? path.resolve(newRootPath, `${newRelPath}.md`) : '',
      builtin,
      source: 'app',
      detectedAt: Date.now(),
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? `${this.host}:${this.port}`}`);

    if (!this.isAllowedOrigin(req)) {
      writeJson(res, 403, { ok: false, error: 'Forbidden origin' });
      return;
    }

    if (req.method === 'OPTIONS') {
      writeEmpty(res, 204, req.headers.origin);
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/panel') {
      this.writePanelRedirect(parsed, res, req.headers.origin);
      return;
    }

    if (!this.isAuthorized(req, parsed)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized' }, req.headers.origin);
      return;
    }

    try {
      if (req.method === 'GET' && parsed.pathname === '/health') {
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/client-active') {
        const body = await readJsonBody(req);
        this.setActiveClient?.(readBrowserClientId(req), readBrowserClientSurface(body.surface));
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/client-active') {
        this.clearActiveClient?.(readBrowserClientId(req));
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/events') {
        this.openEventStream(req, res);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/local-image') {
        const url = parsed.searchParams.get('url') ?? '';
        const filePath = localImagePathFromProtocolUrl(url);
        if (!filePath || !isAllowedLocalImagePath(filePath)) {
          writeEmpty(res, 404, req.headers.origin);
          return;
        }
        try {
          const stat = await fs.promises.stat(filePath);
          const cacheHeaders = getLocalImageCacheHeaders(stat);
          if (shouldReturnLocalImageNotModified(stat, {
            ifNoneMatch: req.headers['if-none-match'],
            ifModifiedSince: req.headers['if-modified-since'],
          })) {
            writeNotModified(res, req.headers.origin, cacheHeaders);
            return;
          }
          const image = await fs.promises.readFile(filePath);
          writeBuffer(res, 200, image, getLocalImageContentType(filePath), req.headers.origin, cacheHeaders);
        } catch {
          writeEmpty(res, 404, req.headers.origin);
        }
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/renderer-storage') {
        const snapshot = await this.nativeBridge.getRendererStorage?.() ?? { available: false, values: {} };
        writeJson(res, 200, { ok: true, ...snapshot }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/diagnostics/rendered-editor-debug') {
        const body = await readJsonBody(req);
        const result = await this.nativeBridge.appendRenderedEditorDebug?.(body.entry) ?? { ok: false, path: '', error: 'Diagnostics bridge unavailable' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/diagnostics/rendered-editor-debug') {
        const result = await this.nativeBridge.clearRenderedEditorDebugLog?.() ?? { ok: false, path: '', error: 'Diagnostics bridge unavailable' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/renderer-storage') {
        const body = await readJsonBody(req);
        const key = typeof body.key === 'string' ? body.key : '';
        const value = typeof body.value === 'string' ? body.value : null;
        if (!key) {
          writeJson(res, 400, { ok: false, error: 'Missing key' }, req.headers.origin);
          return;
        }
        await this.nativeBridge.setRendererStorage?.(key, value);
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/theme') {
        const isDark = await this.nativeBridge.getTheme?.() ?? false;
        writeJson(res, 200, { ok: true, isDark }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/auth/session') {
        const session = sanitizeAuthSessionForBrowserHelper(await this.nativeBridge.getAuthSession?.() ?? null);
        writeJson(res, 200, { ok: true, session }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/auth/callsign') {
        const callsign = await this.nativeBridge.getAuthCallsign?.() ?? null;
        writeJson(res, 200, { ok: true, callsign }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/metrics') {
        const metrics = await this.nativeBridge.getMetrics?.() ?? null;
        writeJson(res, 200, { ok: true, metrics }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/metrics/fetch-from-supabase') {
        const success = await this.nativeBridge.fetchMetricsFromSupabase?.() ?? false;
        writeJson(res, 200, { ok: true, success: success === true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/quota/quotas') {
        const quotas = await this.nativeBridge.getQuotas?.() ?? null;
        writeJson(res, 200, { ok: true, quotas }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/theme') {
        const body = await readJsonBody(req);
        const isDark = body.isDark === true;
        await this.nativeBridge.setTheme?.(isDark);
        writeJson(res, 200, { ok: true, isDark }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/hotkey') {
        const id = String(parsed.searchParams.get('id') ?? '');
        const hotkey = id ? await this.nativeBridge.getHotkey?.(id) ?? null : null;
        writeJson(res, 200, { ok: true, hotkey }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && this.writeStaticAsset(parsed.pathname, res, req.headers.origin)) {
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/tree') {
        writeJson(res, 200, { ok: true, roots: this.service.getRoots() }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/library/roots') {
        writeJson(res, 200, { ok: true, roots: this.service.getLibraryRoots() }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/root') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const root = dirPath ? await this.service.addLibraryRoot(dirPath) : null;
        writeJson(res, root ? 200 : 400, { ok: Boolean(root), root }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/library/root') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const success = dirPath ? await this.service.removeLibraryRoot(dirPath) : false;
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/library/hidden-folders') {
        writeJson(res, 200, { ok: true, hiddenFolders: this.nativeBridge.getHiddenFolders?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/hidden-folders') {
        const body = await readJsonBody(req);
        const folderId = typeof body.folderId === 'string' ? body.folderId : '';
        const hidden = body.hidden === true;
        const hiddenFolders = this.nativeBridge.setFolderHidden?.(folderId, hidden) ?? this.nativeBridge.getHiddenFolders?.() ?? [];
        writeJson(res, 200, { ok: true, hiddenFolders }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/wiki/tree') {
        writeJson(res, 200, { ok: true, tree: this.service.getWikiTree() }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/wiki/page') {
        const page = this.service.getWikiPage(String(parsed.searchParams.get('relPath') ?? ''));
        if (!page) {
          writeJson(res, 200, { ok: true, page: null }, req.headers.origin);
          return;
        }
        writeJson(res, 200, { ok: true, page }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/find-by-document-version') {
        const body = await readJsonBody(req);
        if (!isDocumentVersion(body.version)) {
          writeJson(res, 400, { ok: false, error: 'Missing version' }, req.headers.origin);
          return;
        }
        const previousRelPath = typeof body.previousRelPath === 'string' ? body.previousRelPath : undefined;
        const page = this.service.findWikiPageByDocumentVersion(body.version, previousRelPath);
        writeJson(res, 200, { ok: true, page }, req.headers.origin);
        return;
      }

      if (req.method === 'PUT' && parsed.pathname === '/native/wiki/page') {
        const body = await readJsonBody(req);
        const relPath = typeof body.relPath === 'string' ? body.relPath : '';
        const content = typeof body.content === 'string' ? body.content : null;
        if (!relPath || content === null) {
          writeJson(res, 400, { ok: false, error: 'Missing relPath or content' }, req.headers.origin);
          return;
        }
        const result = this.service.saveWikiPage(
          relPath,
          content,
          isDocumentVersion(body.expectedVersion) ? body.expectedVersion : null,
        );
        writeJson(res, result.ok ? 200 : result.reason === 'conflict' ? 409 : 403, { ok: result.ok, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/file') {
        const body = await readJsonBody(req);
        const folderRelPath = typeof body.folderRelPath === 'string' ? body.folderRelPath : '';
        const fileName = typeof body.fileName === 'string' ? body.fileName : '';
        const page = this.service.createWikiFile(folderRelPath, fileName);
        if (page) {
          await this.nativeBridge.recordRecentWikiPage?.(page);
          await this.nativeBridge.notifyWikiPageChanged?.(this.pageChangeEvent('file-added', page, true));
        }
        writeJson(res, page ? 200 : 400, { ok: Boolean(page), page }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/default-file') {
        const body = await readJsonBody(req);
        const folderRelPath = typeof body.folderRelPath === 'string' ? body.folderRelPath : '';
        const page = this.service.createWikiFileWithDefaultTitle(folderRelPath);
        if (page) {
          await this.nativeBridge.recordRecentWikiPage?.(page);
          await this.nativeBridge.notifyWikiPageChanged?.(this.pageChangeEvent('file-added', page, true));
        }
        writeJson(res, page ? 200 : 400, { ok: Boolean(page), page }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/scratchpad-default') {
        const page = this.service.createScratchpadDefault?.() ?? this.service.createWikiFileWithDefaultTitle('scratchpad');
        writeJson(res, page ? 200 : 400, { ok: Boolean(page), page }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/open-scratchpad-default') {
        const page = this.service.openScratchpadDefault?.() ?? this.service.createScratchpadDefault?.() ?? this.service.createWikiFileWithDefaultTitle('scratchpad');
        writeJson(res, page ? 200 : 400, { ok: Boolean(page), page }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/dir') {
        const body = await readJsonBody(req);
        const dirRelPath = typeof body.dirRelPath === 'string' ? body.dirRelPath : '';
        const success = this.service.createWikiDir(dirRelPath);
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/wiki/page') {
        const body = await readJsonBody(req);
        const relPath = typeof body.relPath === 'string' ? body.relPath : '';
        const success = relPath ? await this.service.deleteWikiPage(relPath) : false;
        if (success) {
          await this.nativeBridge.notifyWikiPageChanged?.(this.deletedWikiPageChangeEvent(relPath));
        }
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/wiki/rename') {
        const body = await readJsonBody(req);
        const relPath = typeof body.relPath === 'string' ? body.relPath : '';
        const newName = typeof body.newName === 'string' ? body.newName : '';
        const newRelPath = this.service.renameWikiPage(relPath, newName);
        if (newRelPath) await this.nativeBridge.notifyWikiPageRenamed?.(this.wikiRenameEvent(relPath, newRelPath));
        writeJson(res, newRelPath ? 200 : 400, { ok: Boolean(newRelPath), newRelPath }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/external/open') {
        const file = this.service.openExternal(String(parsed.searchParams.get('path') ?? ''));
        if (!file) {
          writeJson(res, 200, { ok: true, file: null }, req.headers.origin);
          return;
        }
        writeJson(res, 200, { ok: true, file }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/file') {
        const body = await readJsonBody(req);
        const rootPath = typeof body.rootPath === 'string' ? body.rootPath : '';
        const folderRelPath = typeof body.folderRelPath === 'string' ? body.folderRelPath : '';
        const fileName = typeof body.fileName === 'string' ? body.fileName : '';
        const page = this.service.createLibraryFile(rootPath, folderRelPath, fileName);
        if (page) {
          await this.nativeBridge.recordRecentCreatedLibraryPage?.(page, rootPath);
          await this.nativeBridge.notifyLibraryPageChanged?.(this.pageChangeEvent('file-added', page, false, rootPath));
        }
        writeJson(res, page ? 200 : 400, { ok: Boolean(page), page }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/dir') {
        const body = await readJsonBody(req);
        const rootPath = typeof body.rootPath === 'string' ? body.rootPath : '';
        const dirRelPath = typeof body.dirRelPath === 'string' ? body.dirRelPath : '';
        const success = this.service.createLibraryDir(rootPath, dirRelPath);
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/library/dir') {
        const body = await readJsonBody(req);
        const rootPath = typeof body.rootPath === 'string' ? body.rootPath : '';
        const dirRelPath = typeof body.dirRelPath === 'string' ? body.dirRelPath : '';
        const success = rootPath && dirRelPath ? await this.service.deleteLibraryDir(rootPath, dirRelPath) : false;
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/move') {
        const body = await readJsonBody(req);
        const rootPath = typeof body.rootPath === 'string' ? body.rootPath : '';
        const sourceRelPath = typeof body.sourceRelPath === 'string' ? body.sourceRelPath : '';
        const targetDirRelPath = typeof body.targetDirRelPath === 'string' ? body.targetDirRelPath : '';
        const kind = body.kind === 'dir' ? 'dir' : 'file';
        const targetRootPath = typeof body.targetRootPath === 'string' ? body.targetRootPath : undefined;
        const newRelPath = rootPath && sourceRelPath ? this.service.moveLibraryItem(rootPath, kind, sourceRelPath, targetDirRelPath, targetRootPath) : null;
        if (newRelPath && kind === 'file') {
          const builtin = rootPath === this.builtinWikiRootPath();
          const event = this.libraryRenameEvent(rootPath, sourceRelPath, newRelPath, builtin, targetRootPath ?? rootPath);
          if (builtin) await this.nativeBridge.notifyWikiPageRenamed?.(event);
          else await this.nativeBridge.notifyLibraryItemRenamed?.(event);
        }
        writeJson(res, newRelPath ? 200 : 400, { ok: Boolean(newRelPath), newRelPath }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/pick-folder') {
        const dirPath = await this.nativeBridge.pickFolder?.() ?? null;
        writeJson(res, 200, { ok: true, dirPath }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/library/open-document-window') {
        const target = await readJsonBody(req);
        const result = await this.nativeBridge.openDocumentWindow?.(target) ?? { success: false, error: 'Document windows are not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'PUT' && parsed.pathname === '/native/external/save') {
        const body = await readJsonBody(req);
        const filePath = typeof body.path === 'string' ? body.path : '';
        const content = typeof body.content === 'string' ? body.content : null;
        if (!filePath || content === null) {
          writeJson(res, 400, { ok: false, error: 'Missing path or content' }, req.headers.origin);
          return;
        }
        const result = this.service.saveExternal(
          filePath,
          content,
          isDocumentVersion(body.expectedVersion) ? body.expectedVersion : null,
        );
        writeJson(res, result.ok ? 200 : result.reason === 'conflict' ? 409 : 403, { ok: result.ok, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/external/find-by-document-version') {
        const body = await readJsonBody(req);
        if (!isDocumentVersion(body.version)) {
          writeJson(res, 400, { ok: false, error: 'Missing version' }, req.headers.origin);
          return;
        }
        const previousAbsPath = typeof body.previousAbsPath === 'string' ? body.previousAbsPath : undefined;
        const file = this.service.findLibraryFileByDocumentVersion(body.version, previousAbsPath);
        writeJson(res, 200, { ok: true, file }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/external/rename') {
        const body = await readJsonBody(req);
        const filePath = typeof body.path === 'string' ? body.path : '';
        const newName = typeof body.newName === 'string' ? body.newName : '';
        const file = filePath && newName ? this.service.renameExternal(filePath, newName) : null;
        writeJson(res, file ? 200 : 400, { ok: Boolean(file), file }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/external/file') {
        const body = await readJsonBody(req);
        const filePath = typeof body.path === 'string' ? body.path : '';
        const success = filePath ? await this.service.deleteExternal(filePath) : false;
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/markdown-images/copy-file') {
        const body = await readJsonBody(req);
        const documentPath = typeof body.documentPath === 'string' ? body.documentPath : '';
        const imagePath = typeof body.imagePath === 'string' ? body.imagePath : '';
        const alt = typeof body.alt === 'string' ? body.alt : undefined;
        const result = documentPath && imagePath ? await this.nativeBridge.copyImageForDocument?.(documentPath, imagePath, alt) ?? null : null;
        writeJson(res, result ? 200 : 400, { ok: Boolean(result), result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/markdown-images/copy-data-url') {
        const body = await readJsonBody(req);
        const documentPath = typeof body.documentPath === 'string' ? body.documentPath : '';
        const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
        const alt = typeof body.alt === 'string' ? body.alt : undefined;
        const result = documentPath && dataUrl ? await this.nativeBridge.copyImageDataUrlForDocument?.(documentPath, dataUrl, alt) ?? null : null;
        writeJson(res, result ? 200 : 400, { ok: Boolean(result), result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/markdown-images/make-portable') {
        const body = await readJsonBody(req);
        const documentPath = typeof body.documentPath === 'string' ? body.documentPath : '';
        const content = typeof body.content === 'string' ? body.content : null;
        const result = documentPath && content !== null
          ? await this.nativeBridge.makeImagesPortable?.(documentPath, content) ?? { content, copied: 0, rewritten: 0, missing: 0 }
          : null;
        writeJson(res, result ? 200 : 400, { ok: Boolean(result), result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/markdown-images/delete-unused') {
        const body = await readJsonBody(req);
        const documentPath = typeof body.documentPath === 'string' ? body.documentPath : '';
        const removedMarkdown = typeof body.removedMarkdown === 'string' ? body.removedMarkdown : '';
        const remainingContent = typeof body.remainingContent === 'string' ? body.remainingContent : '';
        const result = documentPath
          ? await this.nativeBridge.deleteUnusedCopiedImages?.(documentPath, removedMarkdown, remainingContent) ?? { deleted: 0, skipped: 0, missing: 0 }
          : null;
        writeJson(res, result ? 200 : 400, { ok: Boolean(result), result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/readings') {
        writeJson(res, 200, { ok: true, readings: await this.nativeBridge.getReadings?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/status') {
        const status = await this.nativeBridge.pollLibrarianStatus?.() ?? {
          pendingPath: null,
          edits: 0,
          threshold: 5,
          didReset: false,
        };
        writeJson(res, 200, { ok: true, status }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/reading') {
        const filePath = String(parsed.searchParams.get('path') ?? '');
        const reading = filePath ? await this.nativeBridge.getReading?.(filePath) ?? null : null;
        writeJson(res, 200, { ok: true, reading }, req.headers.origin);
        return;
      }

      if (req.method === 'PUT' && parsed.pathname === '/native/librarian/reading') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const content = typeof body.content === 'string' ? body.content : null;
        if (!filePath || content === null) {
          writeJson(res, 400, { ok: false, error: 'Missing filePath or content' }, req.headers.origin);
          return;
        }
        const result = await this.nativeBridge.saveReading?.(filePath, content, body.expectedVersion) ?? { ok: false, reason: 'error' };
        const saved = result && typeof result === 'object' && (result as { ok?: unknown }).ok === true;
        const reason = result && typeof result === 'object' ? (result as { reason?: unknown }).reason : null;
        writeJson(res, saved ? 200 : reason === 'conflict' ? 409 : 400, { ok: saved, result }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/librarian/reading') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const success = filePath ? await this.nativeBridge.deleteReading?.(filePath) ?? false : false;
        writeJson(res, success ? 200 : 400, { ok: success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/share-status') {
        const filePath = String(parsed.searchParams.get('path') ?? '');
        const status = filePath ? await this.nativeBridge.getShareStatus?.(filePath) ?? null : null;
        writeJson(res, 200, { ok: true, status }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/share-reading') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const result = filePath ? await this.nativeBridge.shareReading?.(filePath) ?? null : null;
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/unshare-reading') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const success = filePath ? await this.nativeBridge.unshareReading?.(filePath) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/update-shared-reading') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const content = typeof body.content === 'string' ? body.content : null;
        const title = typeof body.title === 'string' ? body.title : '';
        const success = filePath && content !== null && title
          ? await this.nativeBridge.updateSharedReading?.(filePath, content, title) ?? false
          : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/enabled') {
        writeJson(res, 200, { ok: true, enabled: await this.nativeBridge.isLibrarianEnabled?.() ?? false }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/enabled') {
        const body = await readJsonBody(req);
        const enabled = await this.nativeBridge.setLibrarianEnabled?.(body.enabled === true) ?? false;
        writeJson(res, 200, { ok: true, enabled }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/setup-complete') {
        writeJson(res, 200, { ok: true, complete: await this.nativeBridge.isLibrarianSetupComplete?.() ?? true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/setup-complete') {
        const body = await readJsonBody(req);
        await this.nativeBridge.setLibrarianSetupComplete?.(body.complete === true);
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/welcome-artifact') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const created = dirPath ? await this.nativeBridge.createWelcomeArtifact?.(dirPath) ?? false : false;
        writeJson(res, 200, { ok: true, created }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/watched-dirs') {
        writeJson(res, 200, { ok: true, dirs: await this.nativeBridge.getLibrarianWatchedDirs?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/watched-dirs') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const dir = dirPath ? await this.nativeBridge.addLibrarianWatchedDir?.(dirPath) ?? null : null;
        writeJson(res, dir ? 200 : 400, { ok: Boolean(dir), dir }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/librarian/watched-dirs') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const success = dirPath ? await this.nativeBridge.removeLibrarianWatchedDir?.(dirPath) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/browse-directory') {
        writeJson(res, 200, { ok: true, dirPath: await this.nativeBridge.browseLibrarianDirectory?.() ?? null }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/discovery-frequency') {
        writeJson(res, 200, { ok: true, frequency: await this.nativeBridge.getDiscoveryFrequency?.() ?? 'sometimes' }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/discovery-frequency') {
        const body = await readJsonBody(req);
        const frequency = typeof body.frequency === 'string' ? body.frequency : '';
        const success = await this.nativeBridge.setDiscoveryFrequency?.(frequency) ?? false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/user-expertise-context') {
        writeJson(res, 200, { ok: true, context: await this.nativeBridge.getUserExpertiseContext?.() ?? null }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/user-expertise-context') {
        const body = await readJsonBody(req);
        const context = typeof body.context === 'string' ? body.context : undefined;
        const success = await this.nativeBridge.setUserExpertiseContext?.(context) ?? false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/claude-code-status') {
        writeJson(res, 200, { ok: true, status: await this.nativeBridge.getClaudeCodeStatus?.() ?? 'not-installed' }, req.headers.origin);
        return;
      }

      const librarianHookRoute = matchLibrarianHookRoute(parsed.pathname);
      if (librarianHookRoute) {
        const hookBridge = getLibrarianHookBridge(this.nativeBridge, librarianHookRoute);
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, installed: await hookBridge.isInstalled?.() ?? false }, req.headers.origin);
          return;
        }
        if (req.method === 'POST') {
          writeJson(res, 200, { ok: true, success: await hookBridge.install?.() ?? false }, req.headers.origin);
          return;
        }
        if (req.method === 'DELETE') {
          writeJson(res, 200, { ok: true, success: await hookBridge.uninstall?.() ?? false }, req.headers.origin);
          return;
        }
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/mute-for-today') {
        writeJson(res, 200, { ok: true, muted: await this.nativeBridge.muteForToday?.() ?? false }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/librarian/muted-for-today') {
        writeJson(res, 200, { ok: true, muted: await this.nativeBridge.isMutedForToday?.() ?? false }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/unmute') {
        writeJson(res, 200, { ok: true, muted: !(await this.nativeBridge.unmute?.() ?? false) }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/immersive-dismissable') {
        const body = await readJsonBody(req);
        const clientId = typeof body.clientId === 'string' ? body.clientId : readBrowserClientId(req);
        await this.nativeBridge.setBrowserLibraryImmersiveDismissable?.(body.dismissable === true, clientId);
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/size-key') {
        const body = await readJsonBody(req);
        const key = body.key;
        if (key !== 'fields' && key !== 'library' && key !== 'canvas' && key !== 'draw') {
          writeJson(res, 400, { ok: false, error: 'Invalid size key' }, req.headers.origin);
          return;
        }
        const clientId = typeof body.clientId === 'string' ? body.clientId : readBrowserClientId(req);
        await this.nativeBridge.setBrowserLibrarySizeKey?.(key, clientId);
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/editor-focused') {
        const body = await readJsonBody(req);
        const clientId = typeof body.clientId === 'string' ? body.clientId : readBrowserClientId(req);
        await this.nativeBridge.setMarkdownEditorFocused?.(body.focused === true, clientId);
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/librarian/replace-selected-markdown-text-result') {
        const body = await readJsonBody(req);
        await this.nativeBridge.replaceSelectedMarkdownTextResult?.({
          requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
          success: body.success === true,
        });
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/recent/list') {
        writeJson(res, 200, { ok: true, entries: this.nativeBridge.listRecent?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/recent/visit') {
        const body = await readJsonBody(req);
        const entries = this.recordRecentVisit(body);
        writeJson(res, 200, { ok: true, entries }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/recent/remove') {
        const body = await readJsonBody(req);
        const kind = body.kind === 'external' ? 'external' : 'wiki';
        const entryPath = typeof body.path === 'string' ? body.path : '';
        const entries = entryPath
          ? this.nativeBridge.removeRecent?.(kind, entryPath) ?? this.nativeBridge.listRecent?.() ?? []
          : this.nativeBridge.listRecent?.() ?? [];
        writeJson(res, 200, { ok: true, entries }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/tagged-docs/list') {
        writeJson(res, 200, { ok: true, items: await this.nativeBridge.listTaggedDocs?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/tagged-docs/mark-read') {
        const body = await readJsonBody(req);
        const ulid = typeof body.ulid === 'string' ? body.ulid : '';
        const item = ulid ? await this.nativeBridge.markTaggedDocRead?.(ulid) ?? null : null;
        writeJson(res, 200, { ok: true, item }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/tagged-docs/mark-all-read') {
        writeJson(res, 200, { ok: true, items: await this.nativeBridge.markAllTaggedDocsRead?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/tagged-docs/rescan') {
        writeJson(res, 200, { ok: true, items: await this.nativeBridge.rescanTaggedDocs?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/shared-files/availability') {
        writeJson(res, 200, { ok: true, availability: await this.nativeBridge.getSharedFilesAvailability?.() ?? { available: false, canWrite: false, hasTeamMembers: false, reason: 'not_authenticated' } }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/shared-files/status') {
        const filePath = String(parsed.searchParams.get('path') ?? '');
        const status = filePath ? await this.nativeBridge.getSharedFileStatus?.(filePath) ?? { shared: false } : { shared: false };
        writeJson(res, 200, { ok: true, status }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shared-files/share') {
        const input = await readJsonBody(req);
        const status = await this.nativeBridge.shareSharedFile?.(input) ?? { shared: false };
        writeJson(res, 200, { ok: true, status }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shared-files/unshare') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const success = filePath ? await this.nativeBridge.unshareSharedFile?.(filePath) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shared-files/sync') {
        const result = await this.nativeBridge.syncSharedFiles?.() ?? { written: 0, removed: 0, created: 0, errors: ['Field Theory shared sync is not ready'] };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shared-files/update-content') {
        const body = await readJsonBody(req);
        const sharedId = typeof body.sharedId === 'string' ? body.sharedId : '';
        const content = typeof body.content === 'string' ? body.content : null;
        const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : NaN;
        if (!sharedId || content === null || !Number.isFinite(expectedRevision)) {
          writeJson(res, 400, { ok: false, error: 'Missing sharedId, content, or expectedRevision' }, req.headers.origin);
          return;
        }
        const documentPath = typeof body.documentPath === 'string' ? body.documentPath : null;
        const result = await this.nativeBridge.updateSharedFileContent?.(sharedId, content, expectedRevision, documentPath) ?? { ok: false, error: 'Field Theory shared files are not ready' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shared-files/active-presence') {
        const body = await readJsonBody(req);
        const sharedId = typeof body.sharedId === 'string' ? body.sharedId : null;
        const users = await this.nativeBridge.setActivePresence?.(sharedId) ?? [];
        writeJson(res, 200, { ok: true, users }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/shared-files/pinned-item-ids') {
        writeJson(res, 200, { ok: true, ids: await this.nativeBridge.getPinnedItemIds?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shared-files/pinned') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const pinned = body.pinned === true;
        const result = filePath ? await this.nativeBridge.setPinned?.(filePath, pinned) : { ok: false, reason: 'missing_path' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/list') {
        writeJson(res, 200, { ok: true, commands: await this.nativeBridge.getCommands?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/initialize') {
        await this.nativeBridge.initializeCommands?.();
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/watched-dirs') {
        writeJson(res, 200, { ok: true, dirs: await this.nativeBridge.getWatchedCommandDirs?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/directory') {
        writeJson(res, 200, { ok: true, directory: await this.nativeBridge.getCommandDirectory?.() ?? null }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/directory') {
        const body = await readJsonBody(req);
        const directoryPath = typeof body.directoryPath === 'string' ? body.directoryPath : null;
        const result = await this.nativeBridge.setCommandDirectory?.(directoryPath) ?? { success: false, error: 'Commands are not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/directories') {
        writeJson(res, 200, { ok: true, directories: await this.nativeBridge.getCommandDirectories?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/refresh') {
        writeJson(res, 200, { ok: true, commands: await this.nativeBridge.refreshCommands?.() ?? [] }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/content') {
        const commandName = String(parsed.searchParams.get('name') ?? '');
        const content = commandName ? await this.nativeBridge.getCommandContent?.(commandName) ?? null : null;
        writeJson(res, 200, { ok: true, content }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/watched-dir') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const dir = dirPath ? await this.nativeBridge.addWatchedCommandDir?.(dirPath) ?? null : null;
        writeJson(res, 200, { ok: true, dir }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/commands/watched-dir') {
        const body = await readJsonBody(req);
        const dirPath = typeof body.dirPath === 'string' ? body.dirPath : '';
        const success = dirPath ? await this.nativeBridge.removeWatchedCommandDir?.(dirPath) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/default-directory') {
        writeJson(res, 200, { ok: true, directory: await this.nativeBridge.getDefaultCommandDirectory?.() ?? '' }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/default-directory') {
        writeJson(res, 200, { ok: true, directory: await this.nativeBridge.createDefaultCommandDirectory?.() ?? null }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/pick-directory') {
        writeJson(res, 200, { ok: true, dirPath: await this.nativeBridge.pickFolder?.() ?? null }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/by-path') {
        const filePath = String(parsed.searchParams.get('path') ?? '');
        const command = filePath ? await this.nativeBridge.getCommandByPath?.(filePath) ?? null : null;
        writeJson(res, 200, { ok: true, command }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/markdown-preview') {
        const filePath = String(parsed.searchParams.get('path') ?? '');
        const preview = filePath ? await this.nativeBridge.getMarkdownPreview?.(filePath) ?? null : null;
        writeJson(res, 200, { ok: true, preview }, req.headers.origin);
        return;
      }

      if (req.method === 'PUT' && parsed.pathname === '/native/commands/by-path') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const content = typeof body.content === 'string' ? body.content : null;
        if (!filePath || content === null) {
          writeJson(res, 400, { ok: false, error: 'Missing filePath or content' }, req.headers.origin);
          return;
        }
        const result = await this.nativeBridge.saveCommand?.(filePath, content, body.expectedVersion);
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/by-path') {
        const body = await readJsonBody(req);
        const directoryPath = typeof body.directoryPath === 'string' ? body.directoryPath : '';
        const name = typeof body.name === 'string' ? body.name : '';
        const content = typeof body.content === 'string' ? body.content : undefined;
        const command = directoryPath && name ? await this.nativeBridge.createCommand?.(directoryPath, name, content) ?? null : null;
        writeJson(res, 200, { ok: true, command }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/commands/by-path') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const success = filePath ? await this.nativeBridge.deleteCommand?.(filePath) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/rename') {
        const body = await readJsonBody(req);
        const oldFilePath = typeof body.oldFilePath === 'string' ? body.oldFilePath : '';
        const newName = typeof body.newName === 'string' ? body.newName : '';
        const filePath = oldFilePath && newName ? await this.nativeBridge.renameCommand?.(oldFilePath, newName) ?? null : null;
        writeJson(res, 200, { ok: true, filePath }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/share') {
        const command = await readJsonBody(req);
        const result = await this.nativeBridge.shareCommand?.(command) ?? { error: 'Field Theory command sharing is not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/unshare') {
        const body = await readJsonBody(req);
        const commandId = typeof body.commandId === 'string' ? body.commandId : '';
        const result = commandId ? await this.nativeBridge.unshareCommand?.(commandId) ?? { error: 'Field Theory command sharing is not available' } : { error: 'Missing command id' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/field-theory-sync/status') {
        const status = await this.nativeBridge.getFieldTheorySyncStatus?.() ?? {
          localEnabled: false,
          authenticated: false,
          serverEnforced: false,
          enabled: false,
          reason: 'local_disabled',
        };
        writeJson(res, 200, { ok: true, status }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/agent-kickoff/start') {
        const args = await readJsonBody(req);
        const result = await this.nativeBridge.startAgentKickoff?.(args) ?? {
          ok: false,
          runId: '',
          error: 'Agent kickoff is not available',
        };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/agent-kickoff/cancel') {
        const body = await readJsonBody(req);
        const runId = typeof body.runId === 'string' ? body.runId : '';
        const success = runId ? await this.nativeBridge.cancelAgentKickoff?.(runId) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/run-local') {
        const body = await readJsonBody(req);
        const result = await this.nativeBridge.runLocalCommand?.(body) ?? { success: false, error: 'Field Theory command system is not ready' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/maxwell-runs') {
        const rawLimit = Number(parsed.searchParams.get('limit') ?? NaN);
        const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
        const runs = await this.nativeBridge.listMaxwellRuns?.(limit) ?? [];
        writeJson(res, 200, { ok: true, runs }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/commands/maxwell-memory') {
        const memory = await this.nativeBridge.getMaxwellMemory?.() ?? { enabled: true, content: '', path: '', maxChars: 0 };
        writeJson(res, 200, { ok: true, memory }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/maxwell-memory') {
        const body = await readJsonBody(req);
        const result = await this.nativeBridge.saveMaxwellMemory?.(body) ?? { success: false, error: 'Maxwell memory is not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/maxwell-run/cancel') {
        const body = await readJsonBody(req);
        const runId = typeof body.runId === 'string' ? body.runId : '';
        const result = runId ? await this.nativeBridge.cancelMaxwellRun?.(runId) ?? { success: false, error: 'Maxwell cancel is not available' } : { success: false, error: 'Maxwell run id is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/maxwell-run/undo') {
        const body = await readJsonBody(req);
        const runId = typeof body.runId === 'string' ? body.runId : '';
        const result = runId ? await this.nativeBridge.undoMaxwellRun?.(runId) ?? { success: false, error: 'Maxwell undo is not available' } : { success: false, error: 'Maxwell run id is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/maxwell-run/redo') {
        const body = await readJsonBody(req);
        const runId = typeof body.runId === 'string' ? body.runId : '';
        const result = runId ? await this.nativeBridge.redoMaxwellRun?.(runId) ?? { success: false, error: 'Maxwell redo is not available' } : { success: false, error: 'Maxwell run id is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/archive-active-library-file') {
        const result = await this.nativeBridge.archiveActiveLibraryFile?.() ?? { success: false, error: 'Archive is not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/commands/toggle-active-line-numbers') {
        const result = await this.nativeBridge.toggleActiveLibraryLineNumbers?.() ?? { success: false, error: 'Line number toggle is not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/meetings/active') {
        const session = await this.nativeBridge.getActiveMeeting?.() ?? null;
        writeJson(res, 200, { ok: true, session }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/meetings/start-here') {
        const result = await this.nativeBridge.startMeetingHere?.() ?? { success: false, error: 'Meetings are not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/meetings/stop') {
        const result = await this.nativeBridge.stopMeeting?.() ?? { success: false, error: 'Meetings are not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/bookmarks/all') {
        const snapshot = await this.nativeBridge.getBookmarks?.() ?? { bookmarks: [], folders: [], xLastSyncedAt: null };
        writeJson(res, 200, { ok: true, snapshot }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/bookmarks/source') {
        const source = await this.nativeBridge.getBookmarkDataSource?.() ?? null;
        writeJson(res, 200, { ok: true, source }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/sync-if-stale') {
        const result = await this.nativeBridge.syncBookmarksIfStale?.() ?? { status: 'unavailable' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/bookmarks/authors') {
        const authors = await this.nativeBridge.getBookmarkAuthors?.() ?? [];
        writeJson(res, 200, { ok: true, authors }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/bookmarks/author') {
        const handle = String(parsed.searchParams.get('handle') ?? '');
        const bookmarks = handle ? await this.nativeBridge.getAuthorBookmarks?.(handle) ?? [] : [];
        writeJson(res, 200, { ok: true, bookmarks }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/taxonomy') {
        const body = await readJsonBody(req);
        const filePaths = Array.isArray(body.filePaths)
          ? body.filePaths.filter((filePath: unknown): filePath is string => typeof filePath === 'string')
          : [];
        const bookmarks = await this.nativeBridge.getTaxonomyBookmarks?.(filePaths) ?? [];
        writeJson(res, 200, { ok: true, bookmarks }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/bookmarks/search') {
        const query = String(parsed.searchParams.get('query') ?? '');
        const bookmarks = query ? await this.nativeBridge.searchBookmarks?.(query) ?? [] : [];
        writeJson(res, 200, { ok: true, bookmarks }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/save-web-url') {
        const body = await readJsonBody(req);
        const url = typeof body.url === 'string' ? body.url : '';
        const result = url ? await this.nativeBridge.saveWebBookmarkUrl?.(url) ?? { success: false, error: 'Bookmarks are not available' } : { success: false, error: 'URL is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/bookmarks/active-web-page') {
        const result = await this.nativeBridge.getActiveWebPageForBookmark?.() ?? { success: false, error: 'Bookmarks are not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/save-active-web-page') {
        const result = await this.nativeBridge.saveActiveWebPageBookmark?.() ?? { success: false, error: 'Bookmarks are not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/invoke') {
        const body = await readJsonBody(req);
        const id = typeof body.id === 'string' ? body.id : '';
        const result = id ? await this.nativeBridge.invokeBookmark?.(id) ?? { success: false, error: 'Bookmarks are not available' } : { success: false, error: 'Bookmark id is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/send-to-codex') {
        const body = await readJsonBody(req);
        const id = typeof body.id === 'string' ? body.id : '';
        const result = id ? await this.nativeBridge.sendBookmarkToCodex?.(id) ?? { success: false, error: 'Bookmarks are not available' } : { success: false, error: 'Bookmark id is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/copy-for-agent') {
        const body = await readJsonBody(req);
        const id = typeof body.id === 'string' ? body.id : '';
        const result = id ? await this.nativeBridge.copyBookmarkForAgent?.(id) ?? { success: false, error: 'Bookmarks are not available' } : { success: false, error: 'Bookmark id is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/bookmarks/invoke-author-timeline') {
        const body = await readJsonBody(req);
        const handle = typeof body.handle === 'string' ? body.handle : '';
        const result = handle ? await this.nativeBridge.invokeBookmarkAuthorTimeline?.(handle) ?? { success: false, error: 'Bookmarks are not available' } : { success: false, error: 'Author handle is required' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname.startsWith('/native/bookmarks/media/')) {
        const filename = bookmarkMediaFilenameFromPathname(parsed.pathname);
        if (!filename) {
          writeJson(res, 404, { ok: false, error: 'Not found' }, req.headers.origin);
          return;
        }
        const mediaDir = await this.nativeBridge.getBookmarkMediaDirectory?.() ?? null;
        const filePath = await this.nativeBridge.getBookmarkMediaFilePath?.(filename)
          ?? (mediaDir ? path.join(mediaDir, filename) : null);
        if (!filePath || !mediaDir || !this.writeNativeFileInside(filePath, mediaDir, res, req.headers.origin)) {
          writeJson(res, 404, { ok: false, error: 'Not found' }, req.headers.origin);
        }
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/app/version') {
        const version = await this.nativeBridge.getAppVersion?.() ?? '0.0.0';
        writeJson(res, 200, { ok: true, version }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/updater/enabled') {
        const enabled = await this.nativeBridge.isUpdaterEnabled?.() ?? false;
        writeJson(res, 200, { ok: true, enabled }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/updater/status') {
        const status = await this.nativeBridge.getUpdaterStatus?.() ?? null;
        writeJson(res, 200, { ok: true, status }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/updater/check') {
        const result = await this.nativeBridge.checkForUpdates?.() ?? null;
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/updater/download') {
        const result = await this.nativeBridge.downloadUpdate?.() ?? null;
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/updater/install') {
        const result = await this.nativeBridge.installUpdate?.() ?? null;
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/updater/dismiss') {
        const result = await this.nativeBridge.dismissUpdate?.() ?? null;
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shell/open-external') {
        const body = await readJsonBody(req);
        const href = typeof body.href === 'string' ? body.href : '';
        const success = href && isAllowedExternalShellUrl(href)
          ? await this.nativeBridge.openExternal?.(href) ?? false
          : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shell/show-item-in-folder') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const success = filePath ? await this.nativeBridge.showItemInFolder?.(filePath) ?? false : false;
        writeJson(res, 200, { ok: true, success }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shell/represented-filename') {
        const body = await readJsonBody(req);
        const filePath = typeof body.filePath === 'string' ? body.filePath : '';
        const clientId = typeof body.clientId === 'string' ? body.clientId : readBrowserClientId(req);
        await this.nativeBridge.setRepresentedFilename?.(filePath, clientId);
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shell/paste-into-codex-input') {
        const body = await readJsonBody(req);
        const text = typeof body.text === 'string' ? body.text : '';
        const result = text.trim()
          ? await this.nativeBridge.pasteIntoCodexInput?.(text) ?? { success: false, error: 'Codex paste is not available' }
          : { success: false, error: 'No selected text' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/shell/open-field-theory-markdown') {
        const body = await readJsonBody(req);
        const result = await this.nativeBridge.openFieldTheoryMarkdownInNativeApp?.(body.target) ?? { success: false, error: 'Field Theory open is not available' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/clipboard/image-path') {
        const path = await this.nativeBridge.getClipboardImagePath?.() ?? null;
        writeJson(res, 200, { ok: true, path }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/clipboard/text') {
        const body = await readJsonBody(req);
        const text = typeof body.text === 'string' ? body.text : '';
        const result = text
          ? await this.nativeBridge.writeClipboardText?.(text) ?? { success: false, error: 'Clipboard text bridge is not available' }
          : { success: false, error: 'No text to copy' };
        writeJson(res, 200, { ok: true, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/clipboard/pasted-image-file') {
        const body = await readJsonBody(req);
        const name = typeof body.name === 'string' ? body.name : null;
        const type = typeof body.type === 'string' ? body.type : null;
        const data = Array.isArray(body.data)
          ? Uint8Array.from(body.data.map((value) => Number(value) & 0xff))
          : null;
        const path = data
          ? await this.nativeBridge.savePastedImageFile?.({ name, type, data }) ?? null
          : null;
        writeJson(res, path ? 200 : 400, { ok: Boolean(path), path }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/native/current') {
        const body = await readJsonBody(req);
        const context = await this.readNativeCurrentContext(body);
        if (!context) {
          writeJson(res, 403, { ok: false, error: 'Document not allowed' }, req.headers.origin);
          return;
        }
        this.reportCurrentDocument?.(context, readBrowserClientId(req));
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/native/current') {
        const context = await this.nativeBridge.getActiveLibraryFileContext?.() ?? null;
        writeJson(res, 200, { ok: true, context }, req.headers.origin);
        return;
      }

      if (req.method === 'DELETE' && parsed.pathname === '/native/current') {
        this.clearCurrentDocument?.(readBrowserClientId(req));
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      if (req.method === 'GET' && parsed.pathname === '/doc') {
        const document = this.service.getDocument(readDocumentRef(parsed));
        if (!document) {
          writeJson(res, 403, { ok: false, error: 'Document not allowed' }, req.headers.origin);
          return;
        }
        writeJson(res, 200, { ok: true, document }, req.headers.origin);
        return;
      }

      if (req.method === 'PUT' && parsed.pathname === '/doc') {
        const body = await readJsonBody(req);
        const content = typeof body.content === 'string' ? body.content : null;
        if (content === null) {
          writeJson(res, 400, { ok: false, error: 'Missing content' }, req.headers.origin);
          return;
        }
        const result = this.service.saveDocument(
          readDocumentRef(parsed, body),
          content,
          isDocumentVersion(body.expectedVersion) ? body.expectedVersion : null,
        );
        writeJson(res, result.ok ? 200 : result.reason === 'conflict' ? 409 : 403, { ok: result.ok, result }, req.headers.origin);
        return;
      }

      if (req.method === 'POST' && parsed.pathname === '/current') {
        const body = await readJsonBody(req);
        const document = this.service.getDocument(readDocumentRef(parsed, body));
        if (!document) {
          writeJson(res, 403, { ok: false, error: 'Document not allowed' }, req.headers.origin);
          return;
        }
        this.reportCurrentDocument?.({
          type: document.kind === 'markdown' ? 'wiki' : 'external',
          rootPath: document.rootPath,
          relPath: document.relPath,
          filePath: document.path,
          title: document.title,
          selectionStart: numberField(body.selectionStart),
          selectionEnd: numberField(body.selectionEnd),
          selectionText: typeof body.selectionText === 'string' ? body.selectionText : null,
        }, readBrowserClientId(req));
        writeJson(res, 200, { ok: true }, req.headers.origin);
        return;
      }

      writeJson(res, 404, { ok: false, error: 'Not found' }, req.headers.origin);
    } catch {
      writeJson(res, 500, { ok: false, error: 'Internal error' }, req.headers.origin);
    }
  }

  private isAuthorized(req: http.IncomingMessage, parsed: URL): boolean {
    const headerToken = req.headers['x-fieldtheory-browser-token'];
    const requestToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    return requestToken === this.token || parsed.searchParams.get('token') === this.token || readCookie(req, 'ft_browser_token') === this.token;
  }

  private isAllowedOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  private writePanelRedirect(parsed: URL, res: http.ServerResponse, origin?: string): void {
    const address = this.address();
    const apiUrl = `http://${this.host}:${address.port}`;
    const destination = new URL(`${apiUrl}/browser-library.html`);
    destination.searchParams.set('api', apiUrl);
    destination.searchParams.set('token', this.token);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (key === 'api' || key === 'token') continue;
      destination.searchParams.append(key, value);
    }
    res.writeHead(302, {
      ...corsHeaders(origin),
      Location: destination.toString(),
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  private writeStaticAsset(pathname: string, res: http.ServerResponse, origin?: string): boolean {
    if (!this.staticDir) return false;

    const relativePath = staticRelativePath(pathname);
    if (!relativePath) return false;

    const filePath = path.resolve(this.staticDir, relativePath);
    if (!isPathInside(this.staticDir, filePath)) return false;

    let realStaticDir: string;
    let realFilePath: string;
    try {
      realStaticDir = fs.realpathSync(this.staticDir);
      realFilePath = fs.realpathSync(filePath);
    } catch {
      return false;
    }
    if (!isPathInside(realStaticDir, realFilePath)) return false;

    const body = fs.readFileSync(realFilePath);
    res.writeHead(200, {
      ...corsHeaders(origin),
      'Content-Type': contentTypeForPath(realFilePath),
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
      'Set-Cookie': `ft_browser_token=${encodeURIComponent(this.token)}; Path=/; SameSite=Lax`,
    });
    res.end(body);
    return true;
  }

  private writeNativeFile(filePath: string, res: http.ServerResponse, origin?: string): boolean {
    let realFilePath: string;
    try {
      realFilePath = fs.realpathSync(filePath);
      if (!fs.statSync(realFilePath).isFile()) return false;
    } catch {
      return false;
    }

    const body = fs.readFileSync(realFilePath);
    res.writeHead(200, {
      ...corsHeaders(origin),
      'Content-Type': contentTypeForPath(realFilePath),
      'Content-Length': body.byteLength,
      'Cache-Control': 'private, max-age=3600',
    });
    res.end(body);
    return true;
  }

  private writeNativeFileInside(filePath: string, baseDir: string, res: http.ServerResponse, origin?: string): boolean {
    let realBaseDir: string;
    let realFilePath: string;
    try {
      realBaseDir = fs.realpathSync(baseDir);
      realFilePath = fs.realpathSync(filePath);
      const relativePath = path.relative(realBaseDir, realFilePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;
      if (!fs.statSync(realFilePath).isFile()) return false;
    } catch {
      return false;
    }

    return this.writeNativeFile(realFilePath, res, origin);
  }

  private openEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? `${this.host}:${this.port}`}`);
    const clientId = normalizedBrowserClientId(parsed.searchParams.get('clientId'));
    res.writeHead(200, {
      ...corsHeaders(req.headers.origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.eventClients.set(res, clientId);
    req.on('close', () => {
      this.eventClients.delete(res);
      this.onClientDisconnected?.(clientId);
    });
  }

  private recordRecentVisit(body: Record<string, unknown>): RecentEntry[] {
    const kind = body.kind === 'external' ? 'external' : 'wiki';
    const pathValue = typeof body.path === 'string' ? body.path : '';
    if (!pathValue) return this.nativeBridge.listRecent?.() ?? [];
    const entry: RecentEntry = {
      kind,
      path: pathValue,
      title: typeof body.title === 'string' ? body.title : titleFromPath(pathValue),
      lastOpenedAt: Date.now(),
    };
    const entries = this.nativeBridge.visitRecent?.(entry) ?? this.nativeBridge.listRecent?.() ?? [];
    return entries;
  }

  private async readNativeCurrentContext(body: Record<string, unknown>): Promise<DocumentPresenceContext | null> {
    const type = body.type === 'external' ? 'external' : 'wiki';
    if (type === 'wiki') {
      const relPath = typeof body.relPath === 'string' ? body.relPath : typeof body.path === 'string' ? body.path : '';
      const page = this.service.getWikiPage(relPath);
      if (!page) return null;
      return {
        type: 'wiki',
        rootPath: page.rootPath,
        relPath: page.relPath,
        filePath: page.absPath,
        title: page.title,
        selectionStart: numberField(body.selectionStart),
        selectionEnd: numberField(body.selectionEnd),
        selectionText: typeof body.selectionText === 'string' ? body.selectionText : null,
      };
    }

    const filePath = typeof body.filePath === 'string' ? body.filePath : typeof body.path === 'string' ? body.path : '';
    const file = this.service.openExternal(filePath);
    if (!file) return this.readNativeReadingCurrentContext(body, filePath);
    const requestedRootPath = typeof body.rootPath === 'string' ? path.resolve(body.rootPath) : '';
    const requestedRelPath = typeof body.relPath === 'string' ? body.relPath.replace(/\\/g, '/') : '';
    const requestedFilePath = requestedRootPath && requestedRelPath
      ? path.resolve(requestedRootPath, requestedRelPath.match(/\.(?:md|markdown|mdx|html?|css)$/i) ? requestedRelPath : `${requestedRelPath}.md`)
      : '';
    const canPreserveRootRelativeIdentity = Boolean(
      requestedRootPath &&
      requestedRelPath &&
      isPathInside(requestedRootPath, file.path) &&
      requestedFilePath === path.resolve(file.path),
    );
    return {
      type,
      rootPath: canPreserveRootRelativeIdentity ? requestedRootPath : path.dirname(file.path),
      relPath: canPreserveRootRelativeIdentity ? requestedRelPath : path.basename(file.path),
      filePath: file.path,
      title: file.title,
      selectionStart: numberField(body.selectionStart),
      selectionEnd: numberField(body.selectionEnd),
      selectionText: typeof body.selectionText === 'string' ? body.selectionText : null,
    };
  }

  private async readNativeReadingCurrentContext(body: Record<string, unknown>, filePath: string): Promise<DocumentPresenceContext | null> {
    if (!filePath) return null;
    const reading = await this.nativeBridge.getReading?.(filePath);
    if (!isNativeReading(reading)) return null;
    return {
      type: 'external',
      rootPath: path.dirname(reading.path),
      relPath: path.basename(reading.path),
      filePath: reading.path,
      title: reading.title,
      selectionStart: numberField(body.selectionStart),
      selectionEnd: numberField(body.selectionEnd),
      selectionText: typeof body.selectionText === 'string' ? body.selectionText : null,
    };
  }
}

function isNativeReading(value: unknown): value is { path: string; title: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { title?: unknown }).title === 'string',
  );
}

function readDocumentRef(parsed: URL, body: Record<string, unknown> = {}): { rootId: string; relPath: string } {
  return {
    rootId: String(body.rootId ?? parsed.searchParams.get('rootId') ?? ''),
    relPath: String(body.relPath ?? parsed.searchParams.get('relPath') ?? ''),
  };
}

function isDocumentVersion(value: unknown): value is DocumentVersion {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.mtimeMs === 'number'
    && typeof candidate.size === 'number'
    && typeof candidate.sha256 === 'string';
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readCookie(req: http.IncomingMessage, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = cookie.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValueParts.join('='));
    } catch {
      return rawValueParts.join('=');
    }
  }
  return null;
}

function readBrowserClientId(req: http.IncomingMessage): string | null {
  const header = req.headers['x-fieldtheory-browser-client'];
  const value = Array.isArray(header) ? header[0] : header;
  return normalizedBrowserClientId(value ?? null);
}

function normalizedBrowserClientId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(trimmed) ? trimmed : null;
}

function readBrowserClientSurface(value: unknown): BrowserHelperClientSurface | null {
  return value === 'library' || value === 'commands' || value === 'bookmarks' || value === 'ember'
    ? value
    : null;
}

type LibrarianHookRoute = 'state-enforced' | 'cursor' | 'codex';

function matchLibrarianHookRoute(pathname: string): LibrarianHookRoute | null {
  if (pathname === '/native/librarian/state-enforced-hook') return 'state-enforced';
  if (pathname === '/native/librarian/cursor-hook') return 'cursor';
  if (pathname === '/native/librarian/codex-hook') return 'codex';
  return null;
}

function getLibrarianHookBridge(
  bridge: BrowserHelperNativeBridge,
  route: LibrarianHookRoute,
): {
  isInstalled?: () => boolean | Promise<boolean>;
  install?: () => boolean | Promise<boolean>;
  uninstall?: () => boolean | Promise<boolean>;
} {
  if (route === 'state-enforced') {
    return {
      isInstalled: bridge.isStateEnforcedHookInstalled,
      install: bridge.installStateEnforcedHook,
      uninstall: bridge.uninstallStateEnforcedHook,
    };
  }
  if (route === 'cursor') {
    return {
      isInstalled: bridge.isCursorHookInstalled,
      install: bridge.installCursorHook,
      uninstall: bridge.uninstallCursorHook,
    };
  }
  return {
    isInstalled: bridge.isCodexHookInstalled,
    install: bridge.installCodexHook,
    uninstall: bridge.uninstallCodexHook,
  };
}

function staticRelativePath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  if (decoded === '/' || decoded === '/browser-library.html') return 'browser-library.html';
  if (
    decoded === '/field-theory-icon-black.png'
    || decoded === '/fieldtheory-icon.png'
    || decoded === '/fieldtheory-logo-black.png'
    || decoded === '/fieldtheory-logo-white.png'
  ) {
    return decoded.slice(1);
  }
  if (!decoded.startsWith('/assets/')) return null;
  const relativePath = decoded.slice(1);
  return relativePath.includes('\0') ? null : relativePath;
}

function bookmarkMediaFilenameFromPathname(pathname: string): string | null {
  const rawFilename = pathname.slice('/native/bookmarks/media/'.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawFilename);
  } catch {
    return null;
  }
  const filename = path.basename(decoded);
  return filename && filename === decoded ? filename : null;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function titleFromPath(filePath: string): string {
  const basename = path.basename(filePath);
  return basename.replace(/\.(md|markdown|mdx|html?|css)$/i, '') || basename;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>, origin?: string): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...corsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function writeBuffer(
  res: http.ServerResponse,
  statusCode: number,
  body: Buffer,
  contentType: string,
  origin?: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(statusCode, {
    ...corsHeaders(origin),
    'Content-Type': contentType,
    'Content-Length': body.byteLength,
    'Cache-Control': 'private, max-age=3600',
    ...extraHeaders,
  });
  res.end(body);
}

function writeNotModified(res: http.ServerResponse, origin: string | undefined, cacheHeaders: Record<string, string>): void {
  res.writeHead(304, {
    ...corsHeaders(origin),
    ...cacheHeaders,
  });
  res.end();
}

function writeEmpty(res: http.ServerResponse, statusCode: number, origin?: string): void {
  res.writeHead(statusCode, {
    ...corsHeaders(origin),
    'Content-Length': '0',
    'Cache-Control': 'no-store',
  });
  res.end();
}

function corsHeaders(origin?: string): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-FieldTheory-Browser-Token, X-FieldTheory-Browser-Client',
    'Vary': 'Origin',
  };
}
