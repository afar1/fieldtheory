import { app, BrowserWindow, ipcMain, clipboard, screen, Display, Notification, dialog, globalShortcut, shell, Menu, systemPreferences, powerMonitor, net, protocol } from 'electron';
import { pathToFileURL } from 'url';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createLogger } from './logger';
import crypto from 'crypto';
import { parseEnvContent } from './envUtils';
import { NativeHelper } from './nativeHelper';
import { isAlfredApp } from './alfredVisibility';
import { AudioManager } from './audioManager';
import { TrayManager } from './trayManager';
import { TranscriberManager } from './transcriberManager';
import { PreferencesManager, normalizeClipboardHistorySizeKey, pickSavedBoundsByKey, resolveFieldTheoryWindowMode, type ClipboardHistorySizeKey, type FieldTheoryWindowMode } from './preferences';
import { ClipboardManager } from './clipboardManager';
import {
  DEFAULT_MODEL_SIZE,
  isModelSize,
  ModelSize,
} from './modelManager';
import { ClipboardHistoryWindow } from './clipboardHistoryWindow';
import { isFieldTheorySuperPasteBundleId, shouldRouteSuperPasteToLibrarian } from './superPasteRouting';
import { FeedbackManager } from './feedbackManager';
import { AuthManager } from './authManager';
import { createUserDataManager, UserDataManager } from './userDataManager';
import { SocialIPCChannels } from './types/social';
import {
  AudioIPCChannels,
  SetPriorityModePayload,
  SetPriorityDevicePayload,
} from './types/audio';
import {
  isParakeetEngine,
  TranscribeIPCChannels,
  type TranscriptionEngine,
} from './types/transcribe';
import {
  ClipboardIPCChannels,
  ClipboardQueryOptions,
  ContinuousContextState,
} from './types/clipboard';
import {
  ClipboardItem,
  isTerminalApp,
  isIDEWithTerminal,
  isFinder,
  obscureHomePath,
  orderStackItemsForPaste,
} from './clipboardManager';
import { getHotkeyManager, KNOWN_CONFLICT_APPS } from './hotkeyManager';
import {
  setSupabaseUrl as setEngineerSupabaseUrl,
} from './promptEngineer';
import { OnboardingWindow, OnboardingStep } from './onboardingWindow';
import { OnboardingIPCChannels } from './types/onboarding';
import { CursorStatusManager } from './cursorStatusManager';
import {
  DynamicIslandManager,
  DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING,
  type DynamicIslandGeometryTuning,
} from './dynamicIslandManager';
import { AgentAttentionManager } from './agentAttentionManager';
import {
  AgentKickoffManager,
  type AgentKickoffArgs,
  type AgentKickoffProgressEvent,
  type AgentKickoffStartResult,
  type AgentKickoffStatusEvent,
} from './agentKickoffManager';
import { AgentHookInstaller, type InstallTargets } from './agentHookInstaller';
import { launchAgentImproveInTerminal, type AgentImproveLaunchRequest } from './agentImproveLauncher';
import { QuotaManager } from './quotaManager';
import { AccountStatusManager } from './accountStatusManager';
import { DiagnosticsCollector } from './diagnosticsCollector';
import { CommandsManager, PortableCommand } from './commandsManager';
import { CommandSyncService } from './commandSyncService';
import { LibrarySyncService } from './librarySyncService';
import { isFieldTheoryInternalSyncEnvEnabled, resolveFieldTheorySyncStatus, type FieldTheorySyncStatus } from './releaseSyncPolicy';
import { CommandsIPCChannels } from './types/commands';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import { CommandLauncherWindow } from './commandLauncherWindow';
import { appendCommandLauncherTrace, getCommandLauncherTracePath } from './commandLauncherTrace';
import { LibrarianManager, LibraryRoot, Reading, ReadingMeta, WatchedDir, WikiFolder, WikiPage, type LibraryRenameEvent, type ReadingRenameEvent, type WikiNode } from './librarianManager';
import { buildLibraryMigrationPlan, executeLibraryMigration } from './libraryMigration';
import { libraryDir } from './fieldTheoryPaths';
import { getPossibleIdeaBatch, listPossibleIdeaBatches } from './possibleIdeasManager';
import { isAllowedMarkdownExt, resolveIncomingMarkdownPath } from './openFileRouter';
import { markdownFileNameFromUserInput, stripMarkdownFileExtension } from './pathSafety';
import {
  FIELD_THEORY_URL_SCHEME,
  fieldTheoryProtocolClientArgs,
  shouldRegisterFieldTheoryProtocol,
} from './urlProtocolRegistration';
import { RecentManager, type RecentEntry } from './recentManager';
import { BookmarksManager, BookmarksSnapshot, mediaDir as bookmarkMediaDir } from './bookmarksManager';
import { buildBookmarkAgentCopyText } from './bookmarkAgentCopy';
import { bookmarksForTaxonomyFiles, searchBookmarks } from './bookmarkCollections';
import { bookmarkById, bookmarksForAuthor, buildBookmarkAuthorSummaries, formatBookmarkAuthorTimeline, formatBookmarkPost } from './bookmarkAuthorTimeline';
import { getLocalImageContentType, isAllowedLocalImagePath, localImagePathFromProtocolUrl } from './localImageProtocol';
import { getActiveBrowserPage } from './browserPageLocator';
import {
  COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
  captureClipboardSnapshot,
  restoreClipboardSnapshot,
  waitForCommandClipboardPasteRead,
} from './commandClipboard';
import { TaggedDocsIPCChannels, TaggedDocsManager, type TaggedDoc, type TaggedDocsScanProgress } from './taggedDocsManager';
import { MetricsManager, UserMetrics } from './metricsManager';
import { MESSAGES } from './messages';
import { TodoStore, Todo } from './todoStore';
import { TodoIPCChannels } from './types/todo';
import { HotMicManager, KNOWN_TERMINALS } from './hotMicManager';
import { HOT_MIC_DEFAULTS, HOT_MIC_DEFAULT_SYSTEM_COMMANDS, HOT_MIC_DEFAULT_WINDOW_COMMANDS } from './hotMicDefaults';
import { detectSSHSession, scpToRemote, SSHTarget } from './sshDetector';
import { SquaresManager } from './squaresManager';

import { SquaresIPCChannels, SquaresAction, SquaresActionSource } from './types/squares';
import { GazeTrackingManager } from './gaze/gazeTrackingManager';
import { GazeDebugOverlayManager } from './gaze/gazeDebugOverlayManager';
import { GazeScreenOverlayManager } from './gaze/gazeScreenOverlayManager';
import {
  createDefaultGazeWindowFocusConfig,
  createUnavailableCalibrationState,
  createUnavailableDebugOverlayState,
  createUnavailableScreenOverlayState,
  createUnavailableGazeStatus,
  GazeIPCChannels,
  type GazeWindowFocusConfig,
} from './types/gaze';

const log = createLogger('Main');
const LIBRARY_RENAME_TRACE_ENABLED = process.env.LIBRARY_RENAME_TRACE === 'true';

function traceLibraryRename(stage: string, payload: Record<string, unknown>): void {
  if (!LIBRARY_RENAME_TRACE_ENABLED) return;
  log.warn('[RenameTrace] %s %o', stage, payload);
}

const BOOT_MARK = Date.now();
const VISION_BUILD_ENABLED = false;
const MARKDOWN_PREVIEW_MAX_BYTES = 512 * 1024;
const BOOKMARK_BACKGROUND_SYNC_STALE_MS = 15 * 60 * 1000;

// Helper for exec with timeout to prevent osascript hangs (especially with Finder)
const { exec, execFile: execFileCp } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFileCp);

type BookmarkBackgroundSyncResult =
  | { status: 'synced' | 'already-running' | 'too-recent' | 'missing-cli' | 'unavailable' }
  | { status: 'failed'; error: string };

let bookmarkBackgroundSyncInFlight: Promise<BookmarkBackgroundSyncResult> | null = null;
let bookmarkBackgroundSyncLastAttemptAt = 0;

function findFieldTheoryCli(): string | null {
  const candidates = [
    '/opt/homebrew/bin/ft',
    '/usr/local/bin/ft',
    'ft',
  ];

  for (const candidate of candidates) {
    if (candidate === 'ft') return candidate;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep trying common install locations.
    }
  }

  return null;
}

function fieldTheoryCliEnv(): NodeJS.ProcessEnv {
  const pathValue = process.env.PATH ?? '';
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return {
    ...process.env,
    PATH: [...extraPaths, pathValue].filter(Boolean).join(':'),
  };
}

async function syncBookmarksFromCliIfStale(): Promise<BookmarkBackgroundSyncResult> {
  if (!bookmarksManager) return { status: 'unavailable' };
  if (bookmarkBackgroundSyncInFlight) return { status: 'already-running' };

  const now = Date.now();
  if (bookmarkBackgroundSyncLastAttemptAt > 0 && now - bookmarkBackgroundSyncLastAttemptAt < BOOKMARK_BACKGROUND_SYNC_STALE_MS) {
    return { status: 'too-recent' };
  }

  const cli = findFieldTheoryCli();
  if (!cli) return { status: 'missing-cli' };

  bookmarkBackgroundSyncLastAttemptAt = now;
  bookmarkBackgroundSyncInFlight = (async () => {
    try {
      await execFileAsync(cli, ['sync', '--yes'], { env: fieldTheoryCliEnv(), maxBuffer: 10 * 1024 * 1024 });
      bookmarksManager?.reloadAndEmitChanged();
      return { status: 'synced' as const };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return { status: 'missing-cli' as const };
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.debug('Background bookmark sync failed:', message);
      return { status: 'failed' as const, error: message };
    } finally {
      bookmarkBackgroundSyncInFlight = null;
    }
  })();

  return bookmarkBackgroundSyncInFlight;
}

function execWithTimeout(command: string, timeoutMs: number = 5000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs }, (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Activate the target app, then optionally hide launcher chrome before pasting.
async function activateAndPaste(
  targetApp: { bundleId: string; name: string } | null,
  options: { beforePaste?: () => void | Promise<void> } = {},
): Promise<boolean> {
  appendCommandLauncherTrace('activate-and-paste-start', {
    targetBundleId: targetApp?.bundleId ?? null,
    targetName: targetApp?.name ?? null,
  });
  const beforePaste = options.beforePaste;
  if (targetApp) {
    const bundleId = targetApp.bundleId;
    if (bundleId.includes('"') || bundleId.includes("'")) {
      log.error('activateAndPaste: invalid bundleId contains quotes:', bundleId);
      appendCommandLauncherTrace('activate-and-paste-invalid-bundle', { bundleId });
      return false;
    }
    const activateScript = `tell application id "${bundleId}"\n  activate\nend tell`;
    await execFileAsync('osascript', ['-e', activateScript], { timeout: 3000 });
    const afterActivate = nativeHelper?.getFrontmostApp() ?? null;
    appendCommandLauncherTrace('activate-and-paste-after-activate', {
      targetBundleId: bundleId,
      frontmostBundleId: afterActivate?.bundleId ?? null,
      frontmostName: afterActivate?.name ?? null,
    });
    await beforePaste?.();
    await new Promise(resolve => setTimeout(resolve, 40));
    const beforeKeystroke = nativeHelper?.getFrontmostApp() ?? null;
    appendCommandLauncherTrace('activate-and-paste-before-keystroke', {
      targetBundleId: bundleId,
      frontmostBundleId: beforeKeystroke?.bundleId ?? null,
      frontmostName: beforeKeystroke?.name ?? null,
    });
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { timeout: 3000 });
  } else {
    await beforePaste?.();
    await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
  }
  const afterKeystroke = nativeHelper?.getFrontmostApp() ?? null;
  appendCommandLauncherTrace('activate-and-paste-success', {
    targetBundleId: targetApp?.bundleId ?? null,
    targetName: targetApp?.name ?? null,
    frontmostBundleId: afterKeystroke?.bundleId ?? null,
    frontmostName: afterKeystroke?.name ?? null,
  });
  return true;
}

function activateAndPasteFromCommandLauncher(targetApp: { bundleId: string; name: string }): Promise<boolean> {
  commandLauncherWindow?.suppressActivationForExternalInvocation();
  return activateAndPaste(targetApp, {
    beforePaste: () => commandLauncherWindow?.hide(true),
  });
}

function isFieldTheoryBundleId(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  const lower = bundleId.toLowerCase();
  return lower.includes('fieldtheory') || lower.includes('electron');
}

function hasFocusedFieldTheoryMarkdownInsertionTarget(): boolean {
  const clipboardWindow = clipboardHistoryWindow?.getWindow() ?? null;
  return Boolean(
    librarianMarkdownEditorFocused &&
    clipboardWindow &&
    !clipboardWindow.isDestroyed() &&
    clipboardWindow.isVisible()
  );
}

function insertTextIntoFocusedFieldTheoryMarkdown(text: string): boolean {
  if (!text || !hasFocusedFieldTheoryMarkdownInsertionTarget()) {
    return false;
  }
  clipboardHistoryWindow?.getWindow()?.webContents.send('librarian:insertMarkdownText', text);
  return true;
}

function resolveClipboardFullScreenHotkeyPreference(prefs: {
  clipboardFullScreenHotkey?: string | null;
  clipboardDesktopScreenshotHotkey?: string | null;
}): string | null | undefined {
  return prefs.clipboardFullScreenHotkey !== undefined
    ? prefs.clipboardFullScreenHotkey
    : prefs.clipboardDesktopScreenshotHotkey;
}

function getLocalEnvPaths(): string[] {
  return [
    '/Users/afar/dev/fieldtheory/.env.local',
    path.join(__dirname, '../../../.env.local'),
    path.join(__dirname, '../../.env.local'),
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '../.env.local'),
    path.join(process.cwd(), 'mac-app/.env.local'),
    path.join(app.getAppPath(), '.env.local'),
    path.join(app.getAppPath(), '../.env.local'),
  ];
}

let cachedLocalEnvByPath: Record<string, Record<string, string>> | null = null;

function loadLocalEnvMaps(): Record<string, Record<string, string>> {
  if (cachedLocalEnvByPath) {
    return cachedLocalEnvByPath;
  }

  const loaded: Record<string, Record<string, string>> = {};

  for (const envPath of getLocalEnvPaths()) {
    try {
      if (!fs.existsSync(envPath)) {
        continue;
      }

      loaded[envPath] = parseEnvContent(fs.readFileSync(envPath, 'utf-8'));
    } catch {
      // Ignore errors and continue searching other env files.
    }
  }

  cachedLocalEnvByPath = loaded;
  return loaded;
}

function getOptionalEnvValue(key: string): string | undefined {
  if (process.env[key]) {
    return process.env[key];
  }

  const envMaps = loadLocalEnvMaps();
  for (const envPath of getLocalEnvPaths()) {
    const envMap = envMaps[envPath];
    if (!envMap) {
      continue;
    }

    if (key in envMap) {
      return envMap[key];
    }
  }

  return undefined;
}

// Load environment variables from .env.local for Supabase credentials.
// In development, the file is in the mac-app directory.
// In production, we use the bundled values or fall back to hardcoded ones.
function loadEnvVars(): { supabaseUrl?: string; supabaseAnonKey?: string } {
  const supabaseUrl = getOptionalEnvValue('VITE_SUPABASE_URL');
  const supabaseAnonKey = getOptionalEnvValue('VITE_SUPABASE_ANON_KEY');

  if (supabaseUrl && supabaseAnonKey) {
    return {
      supabaseUrl,
      supabaseAnonKey,
    };
  }

  // Production fallback - anon key is public by design, protected by RLS.
  return {
    supabaseUrl: 'https://FIELD_THEORY_SUPABASE_URL.example',
    supabaseAnonKey: 'FIELD_THEORY_SUPABASE_ANON_KEY',
  };
}

// Register the ftmedia:// scheme as privileged so the renderer can load
// locally-cached bookmark media without going through the Twitter CDN.
// Must happen before app.whenReady(). The actual handler is installed inside.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ftmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
  { scheme: 'ftlocalfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

// Pin userData paths explicitly so auth/session storage is stable across package-name changes.
// This must happen before app.whenReady() and before any code calls app.getPath('userData').
if (process.env.EXPERIMENTAL === 'true') {
  const experimentalUserData = path.join(
    os.homedir(),
    'Library/Application Support/Field Theory Experimental'
  );
  app.setPath('userData', experimentalUserData);
  app.setName('Field Theory Experimental');
} else {
  const productionUserData = path.join(app.getPath('appData'), 'fieldtheory-mac');
  app.setPath('userData', productionUserData);
}

// Configure autoUpdater for manual update flow.
// allowPrerelease ensures users on prerelease builds (e.g., 0.1.29-maxwell) can update to stable releases (0.1.30).
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = true;
autoUpdater.setFeedURL({ provider: 'github', owner: 'afar1', repo: 'field-releases' });

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelper | null = null;
let audioManager: AudioManager | null = null;
let trayManager: TrayManager | null = null;
let transcriberManager: TranscriberManager | null = null;
let preferencesManager: PreferencesManager | null = null;
let clipboardManager: ClipboardManager | null = null;
let clipboardHistoryWindow: ClipboardHistoryWindow | null = null;
let authManager: AuthManager | null = null;
let userDataManager: UserDataManager | null = null;
let feedbackManager: FeedbackManager | null = null;
let onboardingWindow: OnboardingWindow | null = null;
let cursorStatusManager: CursorStatusManager | null = null;
let dynamicIslandManager: DynamicIslandManager | null = null;
let agentAttentionManager: AgentAttentionManager | null = null;
let agentKickoffManager: AgentKickoffManager | null = null;
let agentHookInstaller: AgentHookInstaller | null = null;
let quotaManager: QuotaManager | null = null;
let accountStatusManager: AccountStatusManager | null = null;
let diagnosticsCollector: DiagnosticsCollector | null = null;
let librarianManager: LibrarianManager | null = null;
let recentManager: RecentManager | null = null;
let bookmarksManager: BookmarksManager | null = null;
let taggedDocsManager: TaggedDocsManager | null = null;
let commandsManager: CommandsManager | null = null;
let commandSyncService: CommandSyncService | null = null;
let librarySyncService: LibrarySyncService | null = null;
let commandLauncherWindow: CommandLauncherWindow | null = null;
let lastExternalCommandTargetApp: { bundleId: string; name: string } | null = null;
type ActiveLibraryFileContext = {
  type: 'wiki' | 'external';
  rootPath: string;
  relPath: string;
  filePath: string;
  title: string;
};
let activeLibraryFileContext: ActiveLibraryFileContext | null = null;
let metricsManager: MetricsManager | null = null;
let todoStore: TodoStore | null = null;
let hotMicManager: HotMicManager | null = null;
let librarianMarkdownEditorFocused = false;
let lastScratchpadOpenAt = 0;

function broadcastTodosChanged(todos: Todo[]): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(TodoIPCChannels.TODOS_CHANGED, todos);
    }
  });
}

function getFieldTheorySyncStatus(): FieldTheorySyncStatus {
  const localEnabled =
    preferencesManager?.get().fieldTheoryInternalSyncEnabled === true ||
    isFieldTheoryInternalSyncEnvEnabled();
  return resolveFieldTheorySyncStatus({
    localEnabled,
    authenticated: authManager?.isAuthenticated() ?? false,
  });
}

function canUseFieldTheorySync(): boolean {
  return getFieldTheorySyncStatus().enabled;
}

function fieldTheorySyncDisabledError(): string {
  const status = getFieldTheorySyncStatus();
  if (status.reason === 'not_authenticated') return 'Not authenticated';
  return 'Field Theory sync is not enabled for this user';
}

function refreshFieldTheorySyncServices(): void {
  if (!canUseFieldTheorySync()) {
    librarySyncService?.dispose();
    librarySyncService = null;
    commandSyncService?.destroy();
    commandSyncService = null;
    todoStore?.destroy();
    todoStore = null;
    return;
  }

  if (!commandSyncService && authManager && commandsManager) {
    commandSyncService = new CommandSyncService(authManager, commandsManager);
  }
  if (!librarySyncService && authManager) {
    librarySyncService = new LibrarySyncService(authManager);
  }
  if (!todoStore && authManager) {
    todoStore = new TodoStore(authManager);
    todoStore.on('todosChanged', broadcastTodosChanged);
  }
}

function scheduleLibrarySyncIfAllowed(): void {
  refreshFieldTheorySyncServices();
  if (canUseFieldTheorySync()) {
    librarySyncService?.scheduleSync();
  }
}

function canWriteFieldTheoryContent(): boolean {
  return accountStatusManager?.getCapabilityMode() !== 'read_only';
}

function blockWrite(reason: string = 'read_only'): { blocked: true; reason: string } {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('account:blockedWrite', { reason });
    }
  });
  return { blocked: true, reason };
}

function openScratchpadDefaultFromHotkey(): WikiPage | null {
  if (!librarianManager || !clipboardHistoryWindow) return null;
  if (!canWriteFieldTheoryContent()) {
    blockWrite();
    return null;
  }

  const now = Date.now();
  if (now - lastScratchpadOpenAt < 750) return null;
  lastScratchpadOpenAt = now;

  const page = librarianManager.createScratchpadDefault();
  if (!page) return null;
  const boundsToUse = restoreClipboardHistoryBounds('library');
  suspendDynamicIslandFocusForClipboardHistory('show-scratchpad-hotkey');
  clipboardHistoryWindow.show(boundsToUse);
  clipboardHistoryWindow.openScratchpad({
    relPath: page.relPath,
  });
  return page;
}

function rememberCommandTargetApp(appInfo: { bundleId?: string | null; name?: string | null } | null | undefined): void {
  if (!appInfo?.bundleId || !appInfo.name || isFieldTheoryBundleId(appInfo.bundleId)) {
    return;
  }

  lastExternalCommandTargetApp = {
    bundleId: appInfo.bundleId,
    name: appInfo.name,
  };
}

function getCommandLauncherTargetApp(): { bundleId: string; name: string } | null {
  const previousApp = commandLauncherWindow?.getPreviousApp() ?? null;
  if (previousApp?.bundleId && !isFieldTheoryBundleId(previousApp.bundleId)) {
    appendCommandLauncherTrace('target-resolved', {
      source: 'previous-app',
      previousBundleId: previousApp.bundleId,
      previousName: previousApp.name,
      fallbackBundleId: lastExternalCommandTargetApp?.bundleId ?? null,
      fallbackName: lastExternalCommandTargetApp?.name ?? null,
    });
    return previousApp;
  }

  appendCommandLauncherTrace('target-resolved', {
    source: lastExternalCommandTargetApp ? 'last-external-app' : 'none',
    previousBundleId: previousApp?.bundleId ?? null,
    previousName: previousApp?.name ?? null,
    fallbackBundleId: lastExternalCommandTargetApp?.bundleId ?? null,
    fallbackName: lastExternalCommandTargetApp?.name ?? null,
  });
  return lastExternalCommandTargetApp;
}

function hideFieldTheoryForAlfred(): void {
  commandLauncherWindow?.hide(true);

  if (clipboardHistoryWindow?.isShowing() || clipboardHistoryWindow?.isVisible()) {
    clipboardHistoryWindow.hide(false, 'alfred-activated');
  }

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  app.hide();
}

/**
 * Check if the configured transcription engine is ready.
 * For parakeet: checks parakeet installation.
 * For whisper (default): checks whisper model availability.
 */
async function isTranscriptionEngineReady(): Promise<boolean> {
  if (!transcriberManager) return false;
  const engine = preferencesManager?.get()?.transcriptionEngine;
  if (isParakeetEngine(engine)) {
    return transcriberManager.isParakeetInstalled();
  }
  const modelManager = transcriberManager.getModelManager();
  return modelManager ? modelManager.isModelAvailable() : false;
}

/**
 * Shared entry point for direct hot mic start/stop actions.
 * This controls runtime activation only; preference persistence and
 * input-mode broadcasting happen through applyInputMode().
 */
function applyHotMicMode(action: 'activate' | 'deactivate' | 'start'): void {
  if (!hotMicManager) return;
  if (action === 'activate') {
    hotMicManager.activate();
  } else if (action === 'start') {
    hotMicManager.start();
  } else {
    hotMicManager.stop();
  }
}

/**
 * Route a newly captured screenshot/image item into the active voice workflow.
 * Standard recording/silent stack owns item stacking when active; Hot Mic owns
 * figure tracking while always-on listening is active.
 */
function routeCapturedItemToActiveSession(itemId: number): void {
  if (itemId <= 0) return;

  const transcriberStatus = transcriberManager?.getStatus();
  if (transcriberManager && (transcriberStatus === 'recording' || transcriberStatus === 'silentStacking')) {
    transcriberManager.addToStack(itemId);
    return;
  }

  if (hotMicManager?.isActive) {
    hotMicManager.addScreenshotToSession(itemId);
  }
}
let squaresManager: SquaresManager | null = null;
let gazeTrackingManager: GazeTrackingManager | null = null;
let gazeDebugOverlayManager: GazeDebugOverlayManager | null = null;
let gazeScreenOverlayManager: GazeScreenOverlayManager | null = null;
let clipboardHistoryLastHideAt = 0;
let clipboardHistoryLastHideReason: string | null = null;
const DYNAMIC_ISLAND_BLUR_TOGGLE_SUPPRESS_MS = 450;
let clipboardHistoryDynamicIslandFocusRestoreTimer: ReturnType<typeof setTimeout> | null = null;

const HOT_MIC_ISLAND_GEOMETRY_LIMITS = {
  notchWidthOverride: { min: 0, max: 320 },
  pillWidth: { min: 0, max: 120 },
  pillHeight: { min: 0, max: 120 },
  offsetX: { min: -240, max: 240 },
  offsetY: { min: -160, max: 160 },
} as const;
const HOT_MIC_DRAWER_TEXT_SIZE_DEFAULT = 14;
const HOT_MIC_DRAWER_TEXT_SIZE_MIN = 11;
const HOT_MIC_DRAWER_TEXT_SIZE_MAX = 22;
type InputMode = 'hot-mic' | 'standard';

function clampIslandGeometryInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function resolveInputModeFromHotMicEnabled(enabled: boolean): InputMode {
  return enabled ? 'hot-mic' : 'standard';
}

function getCurrentInputMode(): InputMode {
  const enabled = preferencesManager?.getPreference('hotMicEnabled') ?? false;
  return resolveInputModeFromHotMicEnabled(enabled);
}

function broadcastInputMode(mode: InputMode): void {
  dynamicIslandManager?.setInputMode(mode);
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('hotmic:inputModeChanged', mode);
    }
  });
}

async function applyInputMode(mode: InputMode): Promise<InputMode> {
  const normalized: InputMode = mode === 'hot-mic' ? 'hot-mic' : 'standard';
  const shouldEnableHotMic = normalized === 'hot-mic';
  await preferencesManager?.save({ hotMicEnabled: shouldEnableHotMic });

  if (shouldEnableHotMic) {
    if (hotMicManager && !hotMicManager.isActive) {
      hotMicManager.activate();
    }
  } else if (hotMicManager?.isActive) {
    hotMicManager.stop();
  }

  broadcastInputMode(normalized);
  return normalized;
}

function getDefaultHotMicRuntimeStatus(): import('./hotMicManager').HotMicRuntimeStatus {
  return {
    state: 'idle',
    condition: null,
    engineReady: false,
    whisperFallbackActive: false,
    queueDepth: 0,
    lastChunkAgeMs: null,
    chunksReceived: 0,
    micHealthy: true,
    engine: null,
    timing: {
      chunkIntervalMs: null,
      queueWaitMs: null,
      transcribeMs: null,
      postProcessMs: null,
      totalPipelineMs: null,
      avgTranscribeMs: null,
      avgTotalPipelineMs: null,
    },
  };
}

function getHotMicRuntimeStatusSnapshot(): import('./hotMicManager').HotMicRuntimeStatus {
  return hotMicManager?.getRuntimeStatus() ?? getDefaultHotMicRuntimeStatus();
}

function broadcastHotMicRuntimeStatus(): void {
  const status = getHotMicRuntimeStatusSnapshot();
  dynamicIslandManager?.updateHotMicRuntimeStatus(status);
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('hotmic:runtimeStatusChanged', status);
    }
  });
}

function normalizeHotMicIslandGeometry(
  geometry: Partial<DynamicIslandGeometryTuning> | null | undefined
): DynamicIslandGeometryTuning {
  const input = geometry ?? {};
  return {
    notchWidthOverride: clampIslandGeometryInt(
      input.notchWidthOverride,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.notchWidthOverride.min,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.notchWidthOverride.max,
      DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING.notchWidthOverride
    ),
    pillWidth: clampIslandGeometryInt(
      input.pillWidth,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.pillWidth.min,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.pillWidth.max,
      DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING.pillWidth
    ),
    pillHeight: clampIslandGeometryInt(
      input.pillHeight,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.pillHeight.min,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.pillHeight.max,
      DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING.pillHeight
    ),
    offsetX: clampIslandGeometryInt(
      input.offsetX,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.offsetX.min,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.offsetX.max,
      DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING.offsetX
    ),
    offsetY: clampIslandGeometryInt(
      input.offsetY,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.offsetY.min,
      HOT_MIC_ISLAND_GEOMETRY_LIMITS.offsetY.max,
      DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING.offsetY
    ),
  };
}

function getHotMicIslandGeometryFromPreferences(): DynamicIslandGeometryTuning {
  return normalizeHotMicIslandGeometry({
    notchWidthOverride: preferencesManager?.getPreference('hotMicIslandNotchWidthOverride'),
    pillWidth: preferencesManager?.getPreference('hotMicIslandPillWidth'),
    pillHeight: preferencesManager?.getPreference('hotMicIslandPillHeight'),
    offsetX: preferencesManager?.getPreference('hotMicIslandOffsetX'),
    offsetY: preferencesManager?.getPreference('hotMicIslandOffsetY'),
  });
}

async function saveAndApplyHotMicIslandGeometry(
  geometry: Partial<DynamicIslandGeometryTuning>
): Promise<DynamicIslandGeometryTuning> {
  const current = getHotMicIslandGeometryFromPreferences();
  const next = normalizeHotMicIslandGeometry({ ...current, ...geometry });

  if (preferencesManager) {
    const prefsToSave: Parameters<PreferencesManager['save']>[0] = {};
    if (Object.prototype.hasOwnProperty.call(geometry, 'notchWidthOverride')) {
      prefsToSave.hotMicIslandNotchWidthOverride = next.notchWidthOverride;
    }
    if (Object.prototype.hasOwnProperty.call(geometry, 'pillWidth')) {
      prefsToSave.hotMicIslandPillWidth = next.pillWidth;
    }
    if (Object.prototype.hasOwnProperty.call(geometry, 'pillHeight')) {
      prefsToSave.hotMicIslandPillHeight = next.pillHeight;
    }
    if (Object.prototype.hasOwnProperty.call(geometry, 'offsetX')) {
      prefsToSave.hotMicIslandOffsetX = next.offsetX;
    }
    if (Object.prototype.hasOwnProperty.call(geometry, 'offsetY')) {
      prefsToSave.hotMicIslandOffsetY = next.offsetY;
    }
    await preferencesManager.save(prefsToSave);
  }

  dynamicIslandManager?.setGeometryTuning(next);
  return next;
}

function normalizeHotMicDrawerTextSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return HOT_MIC_DRAWER_TEXT_SIZE_DEFAULT;
  }
  const rounded = Math.round(value);
  return Math.max(HOT_MIC_DRAWER_TEXT_SIZE_MIN, Math.min(HOT_MIC_DRAWER_TEXT_SIZE_MAX, rounded));
}

function getHotMicDrawerTextSizeFromPreferences(): number {
  return normalizeHotMicDrawerTextSize(preferencesManager?.getPreference('hotMicDrawerTextSize'));
}

async function saveAndApplyHotMicDrawerTextSize(value: unknown): Promise<number> {
  const next = normalizeHotMicDrawerTextSize(value);
  if (preferencesManager) {
    await preferencesManager.save({ hotMicDrawerTextSize: next });
  }
  dynamicIslandManager?.setDrawerTextSize(next);
  return next;
}

// Track pending update state so windows can query it when they open.
let pendingUpdateInfo: { status: 'available' | 'downloading' | 'ready'; version: string } | null = null;

// Consolidated user state logging - single line showing auth/tier state
function logUserState(_context: string) {
  // Silenced for production - enable for debugging auth issues
}

// Track pending reading to auto-open in Library. Renderer polls for this.
let pendingAutoOpenReading: string | null = null;

/**
 * Lightweight process performance snapshot for in-app HUD rendering.
 */
type ProcessPerformanceSnapshot = {
  timestampMs: number;
  cpuPercent: number;
  cpuCoresUsed: number;
  cpuSystemPercent: number;
  totalCores: number;
  memoryUsedMb: number;
  memorySystemPercent: number;
  totalMemoryGb: number;
};

let lastPerformanceCpuSample: { usage: NodeJS.CpuUsage; hrtimeNs: bigint } | null = null;
const TOTAL_SYSTEM_CORES = Math.max(1, os.cpus().length);
const TOTAL_SYSTEM_MEMORY_BYTES = os.totalmem();

async function collectProcessPerformanceSnapshot(): Promise<ProcessPerformanceSnapshot> {
  const nowNs = process.hrtime.bigint();
  const usage = process.cpuUsage();

  let cpuCoresUsed = 0;
  if (lastPerformanceCpuSample) {
    const elapsedUs = Number(nowNs - lastPerformanceCpuSample.hrtimeNs) / 1000;
    const deltaUserUs = usage.user - lastPerformanceCpuSample.usage.user;
    const deltaSystemUs = usage.system - lastPerformanceCpuSample.usage.system;
    const consumedUs = Math.max(0, deltaUserUs + deltaSystemUs);
    if (elapsedUs > 0) {
      cpuCoresUsed = consumedUs / elapsedUs;
    }
  }
  lastPerformanceCpuSample = { usage, hrtimeNs: nowNs };

  let memoryKb = 0;
  try {
    const processMemory = await process.getProcessMemoryInfo();
    memoryKb = typeof processMemory.residentSet === 'number'
      ? processMemory.residentSet
      : (typeof processMemory.private === 'number' ? processMemory.private : 0);
  } catch {
    memoryKb = Math.round(process.memoryUsage().rss / 1024);
  }

  const memoryUsedMb = memoryKb / 1024;
  const cpuPercent = cpuCoresUsed * 100;
  const cpuSystemPercent = (cpuCoresUsed / TOTAL_SYSTEM_CORES) * 100;
  const memorySystemPercent = TOTAL_SYSTEM_MEMORY_BYTES > 0
    ? ((memoryUsedMb * 1024 * 1024) / TOTAL_SYSTEM_MEMORY_BYTES) * 100
    : 0;

  return {
    timestampMs: Date.now(),
    cpuPercent: Number(cpuPercent.toFixed(1)),
    cpuCoresUsed: Number(cpuCoresUsed.toFixed(2)),
    cpuSystemPercent: Number(cpuSystemPercent.toFixed(1)),
    totalCores: TOTAL_SYSTEM_CORES,
    memoryUsedMb: Number(memoryUsedMb.toFixed(1)),
    memorySystemPercent: Number(memorySystemPercent.toFixed(1)),
    totalMemoryGb: Number((TOTAL_SYSTEM_MEMORY_BYTES / (1024 ** 3)).toFixed(1)),
  };
}


/**
 * Migrate data from legacy app directories to the current Field Theory location.
 * This handles users upgrading from older versions that used different names.
 * Runs once and creates a marker file to prevent re-running.
 */
function migrateFromLegacyPaths(): void {
  const newUserData = app.getPath('userData');
  const migrationMarker = path.join(newUserData, '.migration-v1-complete');

  // Skip if already migrated
  if (fs.existsSync(migrationMarker)) {
    return;
  }

  const homeDir = app.getPath('home');
  const legacyPaths = [
    path.join(homeDir, 'Library', 'Application Support', 'littleai-mac'),
    path.join(homeDir, 'Library', 'Application Support', 'Oscar'),
  ];

  let migrated = false;

  for (const legacyPath of legacyPaths) {
    if (!fs.existsSync(legacyPath)) {
      continue;
    }

    // Migrate figures directory
    const legacyFigures = path.join(legacyPath, 'figures');
    const newFigures = path.join(newUserData, 'figures');
    if (fs.existsSync(legacyFigures) && !fs.existsSync(newFigures)) {
      try {
        fs.renameSync(legacyFigures, newFigures);
        migrated = true;
      } catch (err) {
        log.error(`Failed to move figures: ${err}`);
      }
    }

    // Migrate clipboard.db
    const legacyDb = path.join(legacyPath, 'clipboard.db');
    const newDb = path.join(newUserData, 'clipboard.db');
    if (fs.existsSync(legacyDb) && !fs.existsSync(newDb)) {
      try {
        fs.copyFileSync(legacyDb, newDb);
        migrated = true;
      } catch (err) {
        log.error(`Failed to copy clipboard.db: ${err}`);
      }
    }

    // Migrate preferences.json (for very old versions)
    const legacyPrefs = path.join(legacyPath, 'preferences.json');
    const newPrefs = path.join(newUserData, 'preferences.json');
    if (fs.existsSync(legacyPrefs) && !fs.existsSync(newPrefs)) {
      try {
        fs.copyFileSync(legacyPrefs, newPrefs);
        migrated = true;
      } catch (err) {
        log.error(`Failed to copy preferences.json: ${err}`);
      }
    }
  }

  // Write migration marker (even if nothing was migrated, to avoid checking every launch)
  try {
    fs.writeFileSync(migrationMarker, `Migration completed at ${new Date().toISOString()}\n`);
  } catch (err) {
    log.error(`Failed to write migration marker: ${err}`);
  }
}


/**
 * Register all application hotkeys.
 * Called after onboarding is complete to avoid triggering permission prompts during setup.
 */
function registerHotkeysAfterOnboarding(): void {
  if (!clipboardManager || !preferencesManager) {
    log.info('registerHotkeysAfterOnboarding: skipping (missing manager)');
    return;
  }

  // Re-register transcription hotkeys (may have been unregistered during sign-out or onboarding reset)
  if (transcriberManager) {
    transcriberManager.reRegisterHotkeys();
  }

  // Register Squares window management hotkeys.
  if (squaresManager) {
    squaresManager.registerHotkeys();
  }

  const prefs = preferencesManager.get();
  const hotkeys = clipboardManager.getHotkeys();

  // Register clipboard hotkeys (screenshot, full screen, active window)
  clipboardManager.registerScreenshotHotkey(async () => {
    const id = await clipboardManager!.captureScreenshot({ region: true });
    if (id > 0) {
      routeCapturedItemToActiveSession(id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      metricsManager?.recordScreenshot();
    }
  });

  clipboardManager.registerFullScreenHotkey(async () => {
    const id = await clipboardManager!.captureScreenshot({ fullScreen: true });
    if (id > 0) {
      routeCapturedItemToActiveSession(id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      metricsManager?.recordScreenshot();
    }
  });

  clipboardManager.registerActiveWindowHotkey(async () => {
    const id = await clipboardManager!.captureScreenshot({ activeWindow: true });
    if (id > 0) {
      routeCapturedItemToActiveSession(id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      metricsManager?.recordScreenshot();
    }
  });

  // Register history hotkey (Option+Space)
  // Uses internal isShowing() state for instant toggle - no debounce needed.
  // State updates synchronously in show()/hide() so rapid toggle works correctly.
  clipboardManager.registerHistoryHotkey(async () => {
    if (!clipboardHistoryWindow) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
    }

    // Use internal state for instant toggle (avoids querying window system).
    const showing = clipboardHistoryWindow.isShowing();
    const existingWindow = clipboardHistoryWindow.getWindow();

    if (
      showing
      && shouldUseClipboardAppWindowMode()
      && existingWindow
      && !existingWindow.isDestroyed()
      && existingWindow.isVisible()
      && !existingWindow.isFocused()
    ) {
      await clipboardHistoryWindow.capturePreviousApp();
      clipboardHistoryWindow.focusExistingWindow();
      cursorStatusManager?.refreshWindowProperties();
      dynamicIslandManager?.refreshWindowProperties('clipboard-history:focus-hotkey');
      return;
    }

    if (!showing) {
      clipboardHistoryWindow.playOpenSound();
      const boundsToUse = restoreClipboardHistoryBounds();
      suspendDynamicIslandFocusForClipboardHistory('show-hotkey');
      clipboardHistoryWindow.capturePreviousAppAndShow(boundsToUse, false, true);
      // Opening clipboard history during recording can corrupt transparent
      // overlay backing on some macOS compositor paths.
      cursorStatusManager?.refreshWindowProperties();
      dynamicIslandManager?.refreshWindowProperties('clipboard-history:show-hotkey');
    } else {
      // If in immersive mode, exit fullscreen instead of hiding (like pressing ESC)
      if (clipboardHistoryWindow.getImmersiveMode()) {
        clipboardHistoryWindow.sendExitFullscreen();
      } else {
        // Explicit hotkey close should return to the previous app deterministically.
        await clipboardHistoryWindow.hideAndRestorePreviousApp('hotkey-toggle-hide');
        cursorStatusManager?.refreshWindowProperties();
        dynamicIslandManager?.refreshWindowProperties('clipboard-history:hide-hotkey');
      }
    }
  });

  // Register Super Paste hotkey - now customizable via HotkeyManager
  const hotkeyManager = getHotkeyManager();
  // If there's an active stack in TranscriberManager (transcript + screenshots), paste the full stack.
  // Otherwise, paste the most recent item from clipboard history.
  const superPasteHotkey = prefs.superPasteHotkey || 'Command+Shift+V';
  let lastSuperPasteTriggerTime = 0;
  const SUPER_PASTE_DUPLICATE_GUARD_MS = 120;

  hotkeyManager.register('superPaste', superPasteHotkey, async () => {
      // Keep only a tiny guard against duplicate callbacks from the same
      // physical keypress; a larger debounce makes intentional repeats feel
      // unreliable.
      const now = Date.now();
      if (now - lastSuperPasteTriggerTime < SUPER_PASTE_DUPLICATE_GUARD_MS) {
        return;
      }
      lastSuperPasteTriggerTime = now;

      if (!clipboardManager) {
        return;
      }

      // If in silentStacking mode, paste the collected stack and return to idle.
      if (transcriberManager && transcriberManager.getStatus() === 'silentStacking') {
        await transcriberManager.finishSilentStacking();
        return;
      }

      const clipboardWindow = clipboardHistoryWindow?.getWindow() ?? null;
      if (shouldRouteSuperPasteToLibrarian({
        editorFocused: librarianMarkdownEditorFocused,
        windowVisible: clipboardWindow?.isVisible() ?? false,
        windowFocused: clipboardWindow?.isFocused() ?? false,
      })) {
        const imagePath = await clipboardManager.exportCurrentClipboardImageToCache();
        if (imagePath) {
          clipboardWindow?.webContents.send('librarian:insertMarkdownText', imagePath);
          return;
        }
        const text = clipboard.readText();
        if (text) {
          clipboardWindow?.webContents.send('librarian:insertMarkdownText', text);
          return;
        }
        return;
      }

      // Get most recent item from clipboard history
      const db = clipboardManager['db'];
      if (!db) return;
      const stmt = db.prepare('SELECT id FROM clipboard_items ORDER BY created_at DESC LIMIT 1');
      const row = stmt.get() as { id: number } | undefined;

      if (!row) return;

      const mostRecentItem = clipboardManager.getItem(row.id);
      if (!mostRecentItem) return;

      // Check if this item belongs to a stack - if so, paste the whole stack
      let itemsToPaste: typeof mostRecentItem[] = [mostRecentItem];

      if (mostRecentItem.stackId) {
        const stackItems = clipboardManager.queryItemsByStackId(mostRecentItem.stackId);
        if (stackItems.length > 1) {
          itemsToPaste = stackItems;
        }
      }

      // Get frontmost app info
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let bundleId = '';
      let frontmostPid = 0;
      let isTerminal = false;
      let isIDE = false;
      try {
        const script = `
          tell application "System Events"
            set frontApp to first application process whose frontmost is true
            return (bundle identifier of frontApp) & "|" & (unix id of frontApp)
          end tell
        `;
        const { stdout } = await execAsync(`osascript -e '${script}'`);
        const rawOutput = stdout.trim();
        const pipeIdx = rawOutput.lastIndexOf('|');
        if (pipeIdx !== -1) {
          bundleId = rawOutput.substring(0, pipeIdx);
          frontmostPid = parseInt(rawOutput.substring(pipeIdx + 1), 10) || 0;
        } else {
          bundleId = rawOutput;
        }

        // If frontmost app is Field Theory itself, use the previous app instead
        // This handles cases where super paste is triggered while Field Theory UI is visible
        if (isFieldTheorySuperPasteBundleId(bundleId) && clipboardHistoryWindow) {
          const previousApp = clipboardHistoryWindow.getPreviousApp();
          if (previousApp?.bundleId) {
            bundleId = previousApp.bundleId;
            try {
              const safeBundleId = previousApp.bundleId.replace(/["\\]/g, '');
              const pidScript = `tell application "System Events" to return unix id of (first application process whose bundle identifier is "${safeBundleId}")`;
              const { stdout: pidOut } = await execAsync(`osascript -e '${pidScript}'`);
              frontmostPid = parseInt(pidOut.trim(), 10) || 0;
            } catch { /* frontmostPid stays 0, SSH detection skipped */ }
          }
        }

        isTerminal = isTerminalApp(bundleId);
        isIDE = isIDEWithTerminal(bundleId);
      } catch (e) {
        log.error('Super Paste: failed to get frontmost app:', e);
      }

      const pasteImagesAsPaths = isTerminal || isIDE;
      const orderedItemsToPaste = orderStackItemsForPaste(itemsToPaste, bundleId);
      if (isFieldTheorySuperPasteBundleId(bundleId)) {
        log.info('Super Paste: no external target resolved; skipping paste into Field Theory');
        return;
      }

      let sshTarget: SSHTarget | null = null;
      if (isTerminal && frontmostPid) {
        sshTarget = await detectSSHSession(frontmostPid);
      }

      const resolveImagePath = async (localPath: string): Promise<string> => {
        if (sshTarget) {
          const remotePath = await scpToRemote(localPath, sshTarget.destination);
          if (remotePath) return remotePath;
        }
        return localPath;
      };

      try {
        // If Field Theory is visible, use the normal paste-dismiss path, then
        // explicitly activate the resolved target so Cmd+V does not paste into us.
        if (clipboardHistoryWindow?.isVisible()) {
          clipboardHistoryWindow.hideAfterPaste('super-paste');
        }
        if (bundleId && clipboardHistoryWindow && !isFinder(bundleId)) {
          await clipboardHistoryWindow.activateApp(bundleId);
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        // For terminal-like targets with stacks, combine text with image paths.
        if (pasteImagesAsPaths && itemsToPaste.length > 1) {
          // Find text/transcript items and image items
          const textItems = itemsToPaste.filter(i => i.type === 'text' || i.type === 'transcript');
          const imageItems = itemsToPaste.filter(i => i.imageData);

          // Build combined text with figure paths
          let combinedText = '';
          for (const item of textItems) {
            if (item.content) {
              combinedText += item.content + '\n';
            }
          }

          // Add figure paths for images
          if (imageItems.length > 0) {
            combinedText += '\nfigures:\n';
            for (const item of imageItems) {
              const imagePath = await clipboardManager.exportImageToCache(item);
              if (imagePath) {
                const resolvedPath = await resolveImagePath(imagePath);
                const label = item.figureLabel || '';
                combinedText += `[figure ${label}] ${resolvedPath}\n`;
              }
            }
          }

          clipboard.writeText(`${combinedText.trim()} `);
          await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');

        } else {
          // Paste items sequentially
          for (const item of orderedItemsToPaste) {
            if (item.content && (item.type === 'text' || item.type === 'transcript' || !item.imageData)) {
              // Paste as text: text/transcript types, or any item with content but no image
              clipboard.writeText(item.content);
              await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
            } else if (item.imageData) {
              // Paste as file paths for terminal-like targets, or raw images elsewhere.
              if (pasteImagesAsPaths) {
                const imagePath = await clipboardManager.exportImageToCache(item);
                if (imagePath) {
                  const resolvedPath = await resolveImagePath(imagePath);
                  clipboard.writeText(`${resolvedPath} `);
                  await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
                }
              } else {
                const { nativeImage } = require('electron');
                const imageBuffer = typeof item.imageData === 'string'
                  ? Buffer.from(item.imageData, 'base64')
                  : item.imageData;
                const image = nativeImage.createFromBuffer(imageBuffer);
                if (image.isEmpty()) continue;
                clipboard.writeImage(image);
                clipboardManager.syncClipboardHash();
                await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
              }
            }
            // Small delay between items
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

      } catch (error) {
        log.error('Super Paste: error during paste:', error);
      }
  });

  // Register Command Launcher hotkey - now customizable via HotkeyManager
  // Simple toggle: open or close the command launcher
  const commandLauncherHotkey = prefs.commandLauncherHotkey || 'Command+Shift+K';
  appendCommandLauncherTrace('hotkey-registered', {
    hotkey: commandLauncherHotkey,
    tracePath: getCommandLauncherTracePath(),
  });
  hotkeyManager.register('commandLauncher', commandLauncherHotkey, async () => {
      const launcherVisible = commandLauncherWindow?.isVisible() ?? false;
      const launcherShowingOrVisible = commandLauncherWindow?.isShowingOrVisible() ?? false;
      const immersiveMode = clipboardHistoryWindow?.getImmersiveMode() ?? false;
      const fieldTheoryFocused = clipboardHistoryWindow?.getWindow()?.isFocused() ?? false;

      appendCommandLauncherTrace('hotkey-trigger', {
        hotkey: commandLauncherHotkey,
        launcherVisible,
        launcherShowingOrVisible,
        immersiveMode,
        fieldTheoryFocused,
      });

      try {
        if (launcherVisible) {
          appendCommandLauncherTrace('hotkey-hide-request');
          commandLauncherWindow?.hide();
          return;
        }

        if (!commandLauncherWindow) {
          appendCommandLauncherTrace('hotkey-show-missing-window');
          return;
        }

        // If immersive view is open behind another app, dismiss it first to avoid
        // z-order conflicts. Keep it in place when Field Theory is the active
        // writing surface so launcher selection can navigate inside the app.
        if (immersiveMode && !fieldTheoryFocused) {
          appendCommandLauncherTrace('hotkey-hide-immersive-window');
          clipboardHistoryWindow?.hide();
        }

        const anchorBounds = fieldTheoryFocused
          ? clipboardHistoryWindow?.getBounds()
          : null;

        const appWindowFocusSuppressed = !fieldTheoryFocused
          && (clipboardHistoryWindow?.temporarilyDisableAppWindowFocus('command-launcher-show') ?? false);

        appendCommandLauncherTrace('hotkey-show-request', {
          anchor: anchorBounds ? 'field-theory-window' : 'frontmost-window',
          appWindowFocusSuppressed,
        });
        await commandLauncherWindow.show({ anchorBounds });
        appendCommandLauncherTrace('hotkey-show-complete', {
          launcherVisible: commandLauncherWindow.isVisible(),
          launcherShowingOrVisible: commandLauncherWindow.isShowingOrVisible(),
        });
        metricsManager?.recordCommandLauncherUse();
      } catch (error) {
        appendCommandLauncherTrace('hotkey-show-error', { error });
        log.error('Command launcher hotkey failed:', error);
      }
  });

  // Scratchpad hotkey: show Field Theory, jump to Library, create a new
  // scratchpad doc, and drop into edit mode.
  const scratchpadHotkey = prefs.scratchpadHotkey || 'Control+Option+Command+Space';
  const scratchpadRegistered = hotkeyManager.register('scratchpad', scratchpadHotkey, () => {
    openScratchpadDefaultFromHotkey();
  });
  if (!scratchpadRegistered.success) {
    log.warn(`Scratchpad hotkey (${scratchpadHotkey}) registration failed — likely claimed by another app.`);
  }

}

/**
 * Create and initialize an OnboardingWindow instance.
 * Ensures the window has access to preferencesManager for proper close handling.
 */
function createOnboardingWindow(): OnboardingWindow {
  const window = new OnboardingWindow();
  if (preferencesManager) {
    window.setPreferencesManager(preferencesManager);
  }
  return window;
}

/**
 * Create the main application window.
 */
function createWindow(): void {
  // Determine the preload script path.
  // In both dev and production, use the compiled .js file
  const preloadPath = path.join(__dirname, '../preload.js');

  // Load saved window state from preferences
  const savedState = preferencesManager?.get().windowState;
  const showInDock = shouldUseClipboardAppWindowMode();
  const defaultWidth = 800;
  const defaultHeight = 600;

  mainWindow = new BrowserWindow({
    width: savedState?.width || defaultWidth,
    height: savedState?.height || defaultHeight,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 600,  // Minimum window width
    minHeight: 400, // More compact for settings
    backgroundColor: '#f5f5f5',
    titleBarStyle: 'hiddenInset', // Modern macOS style with traffic lights in content.
    roundedCorners: true,
    skipTaskbar: !showInDock, // Don't show in Dock when in panel mode
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      // Enable DevTools in development to debug renderer issues
      devTools: process.env.NODE_ENV !== 'production',
      // Allow loading local files (needed for file:// protocol with ES modules)
      webSecurity: true, // Keep security enabled, but ensure file:// works
    },
  });

  // Save window state on resize/move (debounced)
  let saveTimeout: NodeJS.Timeout | null = null;
  const saveWindowState = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && preferencesManager) {
        const bounds = mainWindow.getBounds();
        preferencesManager.save({
          windowState: {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
          },
        }).catch((error) => {
          log.error('Failed to save window state:', error);
        });
      }
    }, 500); // Debounce saves to avoid excessive disk writes
  };

  mainWindow.on('resized', saveWindowState);
  mainWindow.on('moved', saveWindowState);

  // Load the app - either from Vite dev server or built files.
  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
  } else {
    // Use absolute path via app.getAppPath() to ensure correct resolution
    // regardless of working directory (important for npm start vs packaged app)
    // Use loadURL with file:// protocol to properly support ES modules
    const htmlPath = path.join(app.getAppPath(), 'dist', 'index.html');
    const fileUrl = `file://${htmlPath}`;
    mainWindow.loadURL(fileUrl);

    // Add error handlers to debug loading issues
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      log.error('Failed to load:', errorCode, errorDescription, validatedURL);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Show the main window, creating it if needed.
 */
function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/**
 * Handle display changes - move clipboard history window if its display is removed.
 */
function handleDisplayRemoved(_event: Electron.Event, removedDisplay: Electron.Display): void {
  gazeTrackingManager?.noteScreenParametersChanged();

  if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) {
    return;
  }

  if (!preferencesManager) {
    return;
  }

  const prefs = preferencesManager.get();
  const savedBounds = prefs?.clipboardHistoryBounds;
  if (!savedBounds || !savedBounds.displayId) {
    return;
  }

  // Check if the removed display matches the saved display ID.
  const removedDisplayId = ClipboardHistoryWindow.getDisplayId(removedDisplay);
  if (removedDisplayId === savedBounds.displayId) {
    
    // Move window to primary display (absolute coordinates).
    const primaryDisplay = screen.getPrimaryDisplay();
    const primaryBounds = primaryDisplay.bounds;
    
    const newBounds = {
      x: primaryBounds.x + primaryBounds.width / 2 - savedBounds.width / 2,
      y: primaryBounds.y + 80,
      width: savedBounds.width,
      height: savedBounds.height,
    };
    
    // Update saved bounds to primary display.
    const displayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    const primaryDisplayId = ClipboardHistoryWindow.getDisplayId(primaryDisplay);
    const primaryRelative = ClipboardHistoryWindow.convertToDisplayRelative(newBounds.x, newBounds.y);
    
    preferencesManager.save({
      clipboardHistoryBounds: {
        relativeX: primaryRelative.relativeX,
        relativeY: primaryRelative.relativeY,
        width: savedBounds.width,
        height: savedBounds.height,
        displayId: primaryDisplayId,
        displayConfig,
      },
    }).catch((err) => {
      log.error('Failed to update clipboard history bounds:', err);
    });
    
    // Reposition window immediately.
    clipboardHistoryWindow.show(newBounds);
  }
}

let displayMetricsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Handle display metrics changes - recalculate window position if needed.
 * Debounced since display changes fire many events in quick succession.
 */
function handleDisplayMetricsChanged(_event: Electron.Event, _changedDisplay: Electron.Display): void {
  gazeTrackingManager?.noteScreenParametersChanged();

  if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) {
    return;
  }

  if (!preferencesManager) {
    return;
  }

  if (displayMetricsDebounceTimer) {
    clearTimeout(displayMetricsDebounceTimer);
  }
  
  displayMetricsDebounceTimer = setTimeout(() => {
    displayMetricsDebounceTimer = null;
    if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) return;

    const boundsToUse = restoreClipboardHistoryBounds(clipboardHistoryWindow.getCurrentSizeKey());
    if (boundsToUse) {
      clipboardHistoryWindow.reposition(boundsToUse);
    }
  }, 200);
}

/**
 * Set up display change event listeners.
 */
function setupDisplayListeners(): void {
  screen.on('display-removed', handleDisplayRemoved);
  screen.on('display-metrics-changed', handleDisplayMetricsChanged);
}

/**
 * Restore clipboard history window bounds from saved preferences.
 * Handles both old format (absolute x, y) and new format (display-relative).
 * Returns absolute screen coordinates for use with the native vibrancy window.
 */
function isClipboardHistorySizeKey(value: unknown): value is ClipboardHistorySizeKey {
  return value === 'fields' || value === 'library' || value === 'canvas' || value === 'draw';
}

function getLastClipboardHistorySizeKey(): ClipboardHistorySizeKey {
  const savedKey = preferencesManager?.get().clipboardHistoryLastSizeKey;
  return isClipboardHistorySizeKey(savedKey) ? normalizeClipboardHistorySizeKey(savedKey) : 'fields';
}

const RESTORED_LIBRARY_MIN_BOUNDS = { width: 720, height: 640 };
const RESTORED_LIBRARY_DEFAULT_BOUNDS = { width: 720, height: 820 };

function defaultClipboardHistoryBoundsForSizeKey(sizeKey: ClipboardHistorySizeKey): { x: number; y: number; width: number; height: number } | undefined {
  if (sizeKey !== 'library') return undefined;
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.min(RESTORED_LIBRARY_DEFAULT_BOUNDS.width, work.width);
  const height = Math.min(RESTORED_LIBRARY_DEFAULT_BOUNDS.height, work.height);
  return {
    x: Math.round(work.x + (work.width - width) / 2),
    y: Math.round(work.y + Math.min(80, Math.max(0, work.height - height))),
    width,
    height,
  };
}

function coerceClipboardHistoryBoundsForSizeKey(
  sizeKey: ClipboardHistorySizeKey,
  bounds: { x: number; y: number; width: number; height: number } | undefined,
): { x: number; y: number; width: number; height: number } | undefined {
  if (sizeKey !== 'library') return bounds;
  const sourceBounds = bounds ?? defaultClipboardHistoryBoundsForSizeKey(sizeKey);
  if (!sourceBounds) return undefined;

  const display = screen.getDisplayMatching(sourceBounds);
  const work = display.workArea;
  const width = Math.min(Math.max(sourceBounds.width, RESTORED_LIBRARY_MIN_BOUNDS.width), work.width);
  const height = Math.min(Math.max(sourceBounds.height, RESTORED_LIBRARY_MIN_BOUNDS.height), work.height);
  const x = Math.min(Math.max(sourceBounds.x, work.x), work.x + Math.max(0, work.width - width));
  const y = Math.min(Math.max(sourceBounds.y, work.y), work.y + Math.max(0, work.height - height));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function restoreClipboardHistoryBounds(sizeKey: ClipboardHistorySizeKey = getLastClipboardHistorySizeKey()): { x: number; y: number; width: number; height: number } | undefined {
  if (!preferencesManager) {
    return defaultClipboardHistoryBoundsForSizeKey(sizeKey);
  }

  const savedBounds = pickSavedBoundsByKey(preferencesManager.get(), sizeKey);
  if (!savedBounds) {
    return defaultClipboardHistoryBoundsForSizeKey(sizeKey);
  }

  // Try new format first: display-relative coordinates.
  if (savedBounds.relativeX !== undefined && savedBounds.relativeY !== undefined && savedBounds.displayId) {
    const absolutePos = ClipboardHistoryWindow.convertToAbsolute(
      savedBounds.relativeX,
      savedBounds.relativeY,
      savedBounds.displayId
    );

    if (absolutePos) {
      // Return absolute screen coordinates directly.
      return coerceClipboardHistoryBoundsForSizeKey(sizeKey, {
        x: absolutePos.x,
        y: absolutePos.y,
        width: savedBounds.width,
        height: savedBounds.height,
      });
    } else {
      // Display not found - fall back to primary display centered.
      const primaryDisplay = screen.getPrimaryDisplay();
      const primaryBounds = primaryDisplay.bounds;
      return coerceClipboardHistoryBoundsForSizeKey(sizeKey, {
        x: primaryBounds.x + primaryBounds.width / 2 - savedBounds.width / 2,
        y: primaryBounds.y + 80,
        width: savedBounds.width,
        height: savedBounds.height,
      });
    }
  }

  // Fall back to old format: absolute coordinates.
  if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
    const currentDisplayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    if (savedBounds.displayConfig === currentDisplayConfig) {
      return coerceClipboardHistoryBoundsForSizeKey(sizeKey, {
        x: savedBounds.x,
        y: savedBounds.y,
        width: savedBounds.width,
        height: savedBounds.height,
      });
    }
  }

  return defaultClipboardHistoryBoundsForSizeKey(sizeKey);
}

async function saveClipboardHistoryBoundsForKey(
  bounds: { x: number; y: number; width: number; height: number },
  key: ClipboardHistorySizeKey
): Promise<void> {
  if (!preferencesManager) return;
  const normalizedKey = normalizeClipboardHistorySizeKey(key);

  const displayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
  const displayRelative = ClipboardHistoryWindow.convertToDisplayRelative(bounds.x, bounds.y);

  const entry = {
    relativeX: displayRelative.relativeX,
    relativeY: displayRelative.relativeY,
    width: bounds.width,
    height: bounds.height,
    displayId: displayRelative.displayId,
    displayConfig,
  };

  const prefs = preferencesManager.get();
  const existing = prefs?.clipboardHistoryBoundsByView ?? {};
  await preferencesManager.save({
    clipboardHistoryBoundsByView: { ...existing, [normalizedKey]: entry },
    clipboardHistoryLastSizeKey: normalizedKey,
    ...(normalizedKey === 'fields' ? { clipboardHistoryBounds: entry } : {}),
  });
}

/**
 * Initialize clipboard history window with bounds change callback.
 */
function initClipboardHistoryWindow(): ClipboardHistoryWindow {
  const window = new ClipboardHistoryWindow(preferencesManager ?? undefined);

  // Wire up native helper for fast sound playback if available.
  if (nativeHelper) {
    window.setNativeHelper(nativeHelper);
    window.getSoundManager().setNativeHelper(nativeHelper);
  }

  // Wire up resume-after-close setting getter for immersive mode
  window.setResumeAfterCloseGetter(() => {
    return librarianManager?.isResumeAfterCloseEnabled() ?? false;
  });
  window.setImmersiveHeightPercentGetter(() => {
    return librarianManager?.getImmersiveHeightPercent() ?? 85;
  });

  // Set up callback to save bounds when window is moved/resized.
  // Bounds are persisted per size-key so each view remembers its own dims.
  window.setOnBoundsChanged(async (bounds) => {
    await saveClipboardHistoryBoundsForKey(bounds, window.getCurrentSizeKey());
  });

  window.setOnHidden(({ reason }) => {
    clipboardHistoryLastHideAt = Date.now();
    clipboardHistoryLastHideReason = reason;
    if (clipboardHistoryDynamicIslandFocusRestoreTimer) {
      clearTimeout(clipboardHistoryDynamicIslandFocusRestoreTimer);
      clipboardHistoryDynamicIslandFocusRestoreTimer = null;
    }
    clipboardHistoryDynamicIslandFocusRestoreTimer = setTimeout(() => {
      clipboardHistoryDynamicIslandFocusRestoreTimer = null;
      dynamicIslandManager?.setLeftWindowFocusable(true);
    }, 150);
    dynamicIslandManager?.refreshWindowProperties(`clipboard-history:hidden:${reason}`);
  });

  return window;
}

function getFieldTheoryWindowMode(): FieldTheoryWindowMode {
  return resolveFieldTheoryWindowMode(preferencesManager?.get());
}

function shouldUseClipboardAppWindowMode(): boolean {
  return getFieldTheoryWindowMode() === 'app';
}

async function prepareClipboardWindowStyleTransition(): Promise<void> {
  const window = clipboardHistoryWindow?.getWindow();
  if (!window || window.isDestroyed() || !window.isVisible()) return;

  await window.webContents.executeJavaScript(
    "localStorage.setItem('ftWindowStyleTransitionIn', 'true')",
    true
  ).catch(() => undefined);

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ipcMain.removeListener('clipboard:windowStyleTransitionReady', onReady);
      resolve();
    };
    const onReady = (event: Electron.IpcMainEvent) => {
      if (event.sender !== window.webContents) return;
      finish();
    };
    const timeout = setTimeout(finish, 220);
    ipcMain.on('clipboard:windowStyleTransitionReady', onReady);
    window.webContents.send('clipboard:windowStyleTransitionOut');
  });
}

async function applyClipboardWindowStyleChange(reason: string, restoreSettings: boolean = false): Promise<void> {
  if (process.platform === 'darwin') {
    if (shouldUseClipboardAppWindowMode()) {
      await app.dock.show();
    } else {
      app.dock.hide();
    }
  }

  if (!clipboardHistoryWindow) return;

  const wasVisible = clipboardHistoryWindow.isVisible();
  const bounds = clipboardHistoryWindow.getWindow()?.getBounds();
  await prepareClipboardWindowStyleTransition();

  clipboardHistoryWindow.destroy();
  clipboardHistoryWindow = initClipboardHistoryWindow();

  if (wasVisible && bounds) {
    suspendDynamicIslandFocusForClipboardHistory(reason);
    clipboardHistoryWindow.show(bounds, restoreSettings, true);
  }
}

function suspendDynamicIslandFocusForClipboardHistory(_reason: string): void {
  if (clipboardHistoryDynamicIslandFocusRestoreTimer) {
    clearTimeout(clipboardHistoryDynamicIslandFocusRestoreTimer);
    clipboardHistoryDynamicIslandFocusRestoreTimer = null;
  }
  dynamicIslandManager?.setLeftWindowFocusable(false);
}

/**
 * Show settings in the clipboard history window.
 * Opens the clipboard history window with the settings panel visible.
 * This is called from the tray menu "Settings..." item.
 */
function showSettingsInClipboardWindow(): void {
  // Don't show settings if onboarding is not complete.
  const prefs = preferencesManager?.get();
  if (!prefs?.onboardingComplete) {
    return;
  }

  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }

  const boundsToUse = restoreClipboardHistoryBounds('fields');
  suspendDynamicIslandFocusForClipboardHistory('show-settings');
  clipboardHistoryWindow.show(boundsToUse, true);
}

/**
 * Show clipboard history window when app becomes active.
 * Called from app 'activate' event handler.
 */
function showClipboardHistoryOnActivate(): void {
  // Don't show clipboard history if onboarding is not complete.
  const prefs = preferencesManager?.get();
  if (!prefs?.onboardingComplete) {
    return;
  }

  // Don't show clipboard history if the command launcher is visible OR showing.
  // Using isShowingOrVisible() closes the TOCTTOU race window during async show().
  if (commandLauncherWindow?.isShowingOrVisible()) {
    return;
  }

  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }

  // If clipboard history is already visible (e.g., immersive mode), don't call show().
  // Calling show() triggers moveTop() which would steal focus from other windows.
  if (clipboardHistoryWindow.isVisible()) {
    return;
  }

  if (shouldUseClipboardAppWindowMode() && clipboardHistoryWindow.focusExistingWindow()) {
    cursorStatusManager?.refreshWindowProperties();
    dynamicIslandManager?.refreshWindowProperties('clipboard-history:focus-app-activate');
    return;
  }

  // Show the clipboard window when app is activated (e.g., Dock icon click).
  const boundsToUse = restoreClipboardHistoryBounds();
  suspendDynamicIslandFocusForClipboardHistory('show-app-activate');
  clipboardHistoryWindow.show(boundsToUse);
  // Re-assert transparent overlay properties after clipboard window show.
  cursorStatusManager?.refreshWindowProperties();
  dynamicIslandManager?.refreshWindowProperties('clipboard-history:show-app-activate');
}

/** Route an incoming markdown path to the library view. Called from `open-file`
 *  (macOS) and also deferred until the main window exists for cold starts. */
function routeOpenMarkdown(inputPath: string): void {
  const resolved = resolveIncomingMarkdownPath(inputPath, librarianManager?.getWikiRoot() ?? null);
  if (!resolved) {
    log.info(`open-file: ignoring non-markdown or unreadable path: ${inputPath}`);
    return;
  }
  if (!clipboardHistoryWindow) {
    log.info('open-file: main window not ready, queueing');
    pendingOpenMarkdownPath = inputPath;
    return;
  }
  const boundsToUse = restoreClipboardHistoryBounds('library');
  suspendDynamicIslandFocusForClipboardHistory('show-reading');
  clipboardHistoryWindow.show(boundsToUse);
  const webContents = clipboardHistoryWindow.getWindow()?.webContents;
  if (!webContents) return;
  if (resolved.kind === 'wiki') {
    webContents.send('wiki:openPage', resolved.relPath);
  } else {
    webContents.send('external:openPage', resolved.absPath);
  }
}

// Cold-start queue — macOS fires `open-file` before windows exist. Last-wins
// (batch multi-select also ends up here; we only show one file at a time).
let pendingOpenMarkdownPath: string | null = null;

/**
 * Set up all IPC handlers for audio-related communication.
 */
function setupIPCHandlers(): void {
  ipcMain.handle(AudioIPCChannels.GET_STATE, () => {
    if (!audioManager) {
      return {
        devices: [],
        defaultInputId: null,
        priorityMode: false,
        priorityDeviceId: null,
        userOverrideId: null,
      };
    }
    return audioManager.getState();
  });

  ipcMain.handle(
    AudioIPCChannels.SET_PRIORITY_MODE,
    async (_event, payload: SetPriorityModePayload) => {
      if (audioManager) {
        await audioManager.setPriorityMode(payload.enabled);
      }
    }
  );

  ipcMain.handle(
    AudioIPCChannels.SET_PRIORITY_DEVICE,
    async (_event, payload: SetPriorityDevicePayload) => {
      if (audioManager) {
        // setPriorityDevice now triggers onPriorityChanged callback which saves to prefs
        await audioManager.setPriorityDevice(payload.deviceId);
      }
    }
  );

  ipcMain.handle(AudioIPCChannels.RESET_OVERRIDE, async () => {
    if (audioManager) {
      await audioManager.clearUserOverride();
    }
  });

  // Get favorite device name (for UI display)
  ipcMain.handle(AudioIPCChannels.GET_FAVORITE_DEVICE_NAME, () => {
    return audioManager?.getFavoriteDeviceName() ?? null;
  });

  // Set favorite device by ID
  ipcMain.handle(AudioIPCChannels.SET_FAVORITE_DEVICE, async (_event, deviceId: string) => {
    if (audioManager) {
      return audioManager.setFavoriteDeviceById(deviceId);
    }
    return false;
  });

  // Clear favorite device (removes auto-reconnect behavior)
  ipcMain.handle(AudioIPCChannels.CLEAR_FAVORITE_DEVICE, async () => {
    if (audioManager) {
      audioManager.clearFavoriteDevice();
    }
  });

  // Permission check handler
  ipcMain.handle('permissions:check', async () => {
    return await checkPermissions();
  });
}

/**
 * Set up IPC handlers for theme synchronization across windows.
 */
function setupThemeIPCHandlers(): void {
  // Get current theme preference
  ipcMain.handle('theme:get', () => {
    return preferencesManager?.getPreference('darkMode') ?? false;
  });

  // Set theme preference and broadcast to all windows
  ipcMain.handle('theme:set', async (_event, isDark: boolean) => {
    if (preferencesManager) {
      await preferencesManager.save({ darkMode: isDark });
    }

    // Broadcast to all windows
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      win.webContents.send('theme:changed', isDark);
    }
  });
}

/**
 * Set up IPC handlers for Librarian (reading collection) functionality.
 */
function setupLibrarianIPCHandlers(): void {
  // Get all readings (metadata only, for sidebar)
  ipcMain.handle('librarian:getReadings', (): ReadingMeta[] => {
    if (!librarianManager) {
      return [];
    }
    return librarianManager.getReadings();
  });

  // Get a single reading with full content (by path)
  ipcMain.handle('librarian:getReading', (_event, filePath: string): Reading | null => {
    if (!librarianManager) {
      return null;
    }
    return librarianManager.getReading(filePath);
  });

  // Save reading content to disk
  ipcMain.handle('librarian:saveReading', (_event, filePath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult => {
    if (!librarianManager) {
      return { ok: false, reason: 'error' };
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { ok: false, reason: 'blocked' };
    }
    return librarianManager.saveReading(filePath, content, expectedVersion);
  });

  // Delete a reading file
  ipcMain.handle('librarian:deleteReading', async (_event, filePath: string): Promise<boolean> => {
    if (!librarianManager) {
      return false;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.deleteReading(filePath);
  });

  ipcMain.handle('wiki:getTree', (): WikiFolder[] => {
    if (!librarianManager) return [];
    const startedAt = Date.now();
    const tree = librarianManager.getWikiTree();
    traceLibraryRename('ipc-wiki-getTree', {
      durationMs: Date.now() - startedAt,
      folders: tree.length,
      files: tree.reduce((total, folder) => total + folder.files.length, 0),
    });
    return tree;
  });

  ipcMain.handle('library:getRoots', (): LibraryRoot[] => {
    if (!librarianManager) return [];
    const startedAt = Date.now();
    const roots = librarianManager.getLibraryRoots();
    const files = roots.reduce((total, root) => {
      const countNodes = (nodes: WikiNode[]): number => nodes.reduce((sum, node) => (
        sum + (node.kind === 'file' ? 1 : countNodes(node.children))
      ), 0);
      return total + countNodes(root.tree);
    }, 0);
    traceLibraryRename('ipc-library-getRoots', {
      durationMs: Date.now() - startedAt,
      roots: roots.length,
      files,
    });
    return roots;
  });

  ipcMain.handle('possible:listBatches', () => {
    return listPossibleIdeaBatches();
  });

  ipcMain.handle('possible:getBatch', (_event, batchId?: string) => {
    return getPossibleIdeaBatch(typeof batchId === 'string' ? batchId : undefined);
  });

  ipcMain.handle('library:previewMigration', () => {
    return buildLibraryMigrationPlan();
  });

  ipcMain.handle('library:executeMigration', () => {
    const plan = buildLibraryMigrationPlan();
    const result = executeLibraryMigration(plan);
    if (result.success && librarianManager) {
      librarianManager.emit('wiki:changed');
      librarianManager.emit('library:changed', plan.targetDir);
    }
    return result;
  });

  ipcMain.handle('library:getHiddenFolders', (): string[] => {
    if (!librarianManager) return [];
    return librarianManager.getHiddenDefaultFolders();
  });

  ipcMain.handle('library:setFolderHidden', (_event, folderId: string, hidden: boolean): string[] => {
    if (!librarianManager) return [];
    return librarianManager.setDefaultFolderHidden(folderId, hidden);
  });

  ipcMain.handle('library:addRoot', (_event, dirPath: string): LibraryRoot | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.addLibraryRoot(dirPath);
  });

  ipcMain.handle('library:removeRoot', (_event, dirPath: string): boolean => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.removeLibraryRoot(dirPath);
  });

  ipcMain.handle('library:createFile', (_event, rootPath: string, folderRelPath: string, fileName: string): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.createLibraryFile(rootPath, folderRelPath, fileName);
  });

  ipcMain.handle('library:createDir', (_event, rootPath: string, dirRelPath: string): boolean => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.createLibraryDir(rootPath, dirRelPath);
  });

  ipcMain.handle('library:deleteDir', async (_event, rootPath: string, dirRelPath: string): Promise<boolean> => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.deleteLibraryDir(rootPath, dirRelPath);
  });

  ipcMain.handle('library:moveItem', (_event, rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string): string | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.moveLibraryItem(rootPath, kind, sourceRelPath, targetDirRelPath, targetRootPath);
  });

  ipcMain.handle('library:pickFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('wiki:getPage', (_event, relPath: string): WikiPage | null => {
    if (!librarianManager) return null;
    return librarianManager.getWikiPage(relPath);
  });

  ipcMain.handle('wiki:findPageByDocumentVersion', (_event, version: DocumentVersion, previousRelPath?: string): WikiPage | null => {
    if (!librarianManager) return null;
    return librarianManager.findWikiPageByDocumentVersion(version, previousRelPath);
  });

  ipcMain.handle('wiki:save', (_event, relPath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult => {
    if (!librarianManager) return { ok: false, reason: 'error' };
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { ok: false, reason: 'blocked' };
    }
    return librarianManager.saveWikiPage(relPath, content, expectedVersion);
  });

  ipcMain.handle('wiki:createFile', (_event, folderName: string, fileName: string): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.createWikiFile(folderName, fileName);
  });

  ipcMain.handle('wiki:createFileWithDefaultTitle', (_event, folderName: string): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.createWikiFileWithDefaultTitle(folderName);
  });

  ipcMain.handle('wiki:deletePage', async (_event, relPath: string): Promise<boolean> => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.deleteWikiPage(relPath);
  });

  ipcMain.handle('wiki:createScratchpadDefault', (): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.createScratchpadDefault();
  });

  ipcMain.handle('wiki:openScratchpadDefault', (): WikiPage | null => {
    return openScratchpadDefaultFromHotkey();
  });

  ipcMain.handle('wiki:createDir', (_event, dirName: string): boolean => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.createWikiDir(dirName);
  });

  ipcMain.handle('wiki:rename', (_event, relPath: string, newName: string): string | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.renameWikiPage(relPath, newName);
  });

  // Recent items (wiki + external). Returns the updated list so the renderer
  // can re-render without a second round-trip; also broadcasts `recent:changed`
  // so other windows/components (e.g. sidebar) drop stale entries immediately.
  const broadcastRecentChanged = () => {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('recent:changed');
    });
  };
  ipcMain.handle('recent:list', (): RecentEntry[] => recentManager?.list() ?? []);
  ipcMain.handle('recent:visit', (_event, entry: RecentEntry): RecentEntry[] => {
    const next = recentManager?.visit(entry) ?? [];
    broadcastRecentChanged();
    return next;
  });
  ipcMain.handle(
    'recent:remove',
    (_event, kind: 'wiki' | 'external', entryPath: string): RecentEntry[] => {
      const next = recentManager?.remove(kind, entryPath) ?? [];
      broadcastRecentChanged();
      return next;
    },
  );

  // External markdown files — used when macOS opens a .md file "With Field
  // Theory" and the canonical path falls outside the wiki root. The app
  // reads/writes the file in place; no copy, no watcher.
  ipcMain.handle(
    'external:open',
    (_event, absPath: string): { path: string; name: string; content: string; mtime: number; documentVersion: DocumentVersion } | null => {
      try {
        const canonical = fs.realpathSync(absPath);
        if (!isAllowedMarkdownExt(canonical)) return null;
        const content = fs.readFileSync(canonical, 'utf-8');
        const stats = fs.statSync(canonical);
        return {
          path: canonical,
          name: path.basename(canonical),
          content,
          mtime: Math.floor(stats.mtimeMs),
          documentVersion: readDocumentVersion(canonical),
        };
      } catch (error) {
        log.error(`external:open failed for ${absPath}:`, error);
        return null;
      }
    },
  );

  ipcMain.handle('external:save', (_event, absPath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { ok: false, reason: 'blocked' };
    }
    try {
      const canonical = fs.realpathSync(absPath);
      if (!isAllowedMarkdownExt(canonical)) return { ok: false, reason: 'not-found' };
      return writeTextFileWithConflictGuard(canonical, content, expectedVersion);
    } catch (error) {
      log.error(`external:save failed for ${absPath}:`, error);
      return { ok: false, reason: 'error' };
    }
  });

  ipcMain.handle(
    'external:findLibraryFileByDocumentVersion',
    (_event, version: DocumentVersion, previousAbsPath?: string): { path: string; name: string; content: string; mtime: number; documentVersion: DocumentVersion } | null => {
      if (!librarianManager) return null;
      const candidatePaths: string[] = [];
      const collectFiles = (nodes: WikiNode[]) => {
        for (const node of nodes) {
          if (node.kind === 'file') {
            candidatePaths.push(node.absPath);
          } else {
            collectFiles(node.children);
          }
        }
      };

      for (const root of librarianManager.getLibraryRoots()) {
        if (root.builtin) continue;
        collectFiles(root.tree);
      }

      const previousDir = previousAbsPath ? path.dirname(previousAbsPath) : null;
      const sortedPaths = previousDir
        ? candidatePaths.sort((left, right) => {
          const leftSameDir = path.dirname(left) === previousDir ? 0 : 1;
          const rightSameDir = path.dirname(right) === previousDir ? 0 : 1;
          return leftSameDir - rightSameDir;
        })
        : candidatePaths;

      for (const candidatePath of sortedPaths) {
        if (candidatePath === previousAbsPath) continue;
        try {
          const candidateVersion = readDocumentVersion(candidatePath);
          if (
            candidateVersion.mtimeMs !== version.mtimeMs ||
            candidateVersion.size !== version.size ||
            candidateVersion.sha256 !== version.sha256
          ) {
            continue;
          }
          const content = fs.readFileSync(candidatePath, 'utf-8');
          const stats = fs.statSync(candidatePath);
          return {
            path: candidatePath,
            name: path.basename(candidatePath),
            content,
            mtime: Math.floor(stats.mtimeMs),
            documentVersion: candidateVersion,
          };
        } catch {}
      }
      return null;
    },
  );

  ipcMain.handle(
    'external:rename',
    (_event, absPath: string, newName: string): { path: string; name: string; content: string; mtime: number; documentVersion: DocumentVersion } | null => {
      if (!canWriteFieldTheoryContent()) {
        blockWrite();
        return null;
      }
      try {
        const canonical = fs.realpathSync(absPath);
        if (!isAllowedMarkdownExt(canonical)) return null;
        const trimmed = newName.trim();
        if (!trimmed) return null;
        const lower = trimmed.toLowerCase();
        const extension = path.extname(canonical) || '.md';
        const nextFileName = lower.endsWith('.md') || lower.endsWith('.markdown')
          ? markdownFileNameFromUserInput(trimmed)
          : markdownFileNameFromUserInput(`${trimmed}${extension}`);
        if (!nextFileName) return null;
        const nextPath = path.join(path.dirname(canonical), nextFileName);
        if (nextPath === canonical) {
          const content = fs.readFileSync(canonical, 'utf-8');
          const stats = fs.statSync(canonical);
          return {
            path: canonical,
            name: path.basename(canonical),
            content,
            mtime: Math.floor(stats.mtimeMs),
            documentVersion: readDocumentVersion(canonical),
          };
        }
        if (fs.existsSync(nextPath)) {
          try {
            if (fs.realpathSync(nextPath) !== fs.realpathSync(canonical)) return null;
          } catch {
            return null;
          }
        }
        fs.renameSync(canonical, nextPath);
        const content = fs.readFileSync(nextPath, 'utf-8');
        const stats = fs.statSync(nextPath);
        const title = stripMarkdownFileExtension(path.basename(nextPath));
        const libraryRoot = librarianManager?.getLibraryRoots().find((root) => {
          if (root.builtin) return false;
          const relative = path.relative(root.path, canonical);
          return relative === '' || (!!relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        });
        if (libraryRoot && librarianManager) {
          const detectedAt = Date.now();
          const event: LibraryRenameEvent = {
            rootPath: libraryRoot.path,
            oldRelPath: stripMarkdownFileExtension(path.relative(libraryRoot.path, canonical).split(path.sep).join('/')),
            newRelPath: stripMarkdownFileExtension(path.relative(libraryRoot.path, nextPath).split(path.sep).join('/')),
            oldAbsPath: canonical,
            newAbsPath: nextPath,
            builtin: false,
            source: 'external',
            detectedAt,
          };
          traceLibraryRename('external-rename-record', {
            oldAbsPath: canonical,
            newAbsPath: nextPath,
            oldRelPath: event.oldRelPath,
            newRelPath: event.newRelPath,
          });
          librarianManager.recordLibraryRename(event);
        }
        librarianManager?.recordWatchedReadingRename(canonical, nextPath);
        recentManager?.remove('external', canonical);
        recentManager?.visit({ kind: 'external', path: nextPath, title, lastOpenedAt: Date.now() });
        broadcastRecentChanged();
        return {
          path: nextPath,
          name: path.basename(nextPath),
          content,
          mtime: Math.floor(stats.mtimeMs),
          documentVersion: readDocumentVersion(nextPath),
        };
      } catch (error) {
        log.error(`external:rename failed for ${absPath}:`, error);
        return null;
      }
    },
  );

  if (librarianManager) {
    librarianManager.startWikiWatcher();
    librarianManager.on('wiki:changed', () => {
      scheduleLibrarySyncIfAllowed();
      traceLibraryRename('broadcast-wiki-changed', {
        windows: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
      });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) {
          w.webContents.send('wiki:changed');
          w.webContents.send('library:changed');
        }
      });
    });
    librarianManager.on('wiki:renamed', (event: LibraryRenameEvent) => {
      scheduleLibrarySyncIfAllowed();
      traceLibraryRename('broadcast-wiki-renamed', {
        traceId: event.traceId,
        source: event.source,
        oldRelPath: event.oldRelPath,
        newRelPath: event.newRelPath,
        ageMs: event.emittedAt ? Date.now() - event.emittedAt : null,
      });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) {
          w.webContents.send('wiki:renamed', event);
          w.webContents.send('library:renamed', event);
        }
      });
    });
    librarianManager.on('library:changed', () => {
      scheduleLibrarySyncIfAllowed();
      traceLibraryRename('broadcast-library-changed', {
        windows: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
      });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('library:changed');
      });
    });
    librarianManager.on('library:renamed', (event: LibraryRenameEvent) => {
      scheduleLibrarySyncIfAllowed();
      traceLibraryRename('broadcast-library-renamed', {
        traceId: event.traceId,
        source: event.source,
        oldRelPath: event.oldRelPath,
        newRelPath: event.newRelPath,
        ageMs: event.emittedAt ? Date.now() - event.emittedAt : null,
      });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('library:renamed', event);
      });
    });
    // Auto-prune recent when a wiki page is trashed so stale entries drop
    // from the sidebar even if the caller didn't explicitly call recent:remove.
    librarianManager.on('wiki:deleted', (relPath: string) => {
      if (recentManager) {
        recentManager.remove('wiki', relPath);
        broadcastRecentChanged();
      }
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('wiki:deleted', relPath);
      });
    });
  }

  ipcMain.handle('bookmarks:getAll', (): BookmarksSnapshot => {
    if (!bookmarksManager) return { bookmarks: [], folders: [], xLastSyncedAt: null };
    return bookmarksManager.getSnapshot();
  });

  ipcMain.handle('bookmarks:syncIfStale', () => syncBookmarksFromCliIfStale());

  ipcMain.handle('bookmarks:getAuthors', () => {
    if (!bookmarksManager) return [];
    return buildBookmarkAuthorSummaries(bookmarksManager.getSnapshot().bookmarks);
  });

  const pasteBookmarkTextFromLauncher = async (
    tracePrefix: string,
    tracePayload: Record<string, unknown>,
    text: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const targetApp = getCommandLauncherTargetApp();
      appendCommandLauncherTrace(`${tracePrefix}-start`, {
        ...tracePayload,
        targetBundleId: targetApp?.bundleId ?? null,
        targetName: targetApp?.name ?? null,
      });

      if (!targetApp) {
        commandLauncherWindow?.hide(true);
        appendCommandLauncherTrace(`${tracePrefix}-no-target`, tracePayload);
        return { success: false, error: 'No external target app available' };
      }

      clipboard.writeText(text);
      clipboardManager?.syncClipboardHash();
      await activateAndPasteFromCommandLauncher(targetApp);

      appendCommandLauncherTrace(`${tracePrefix}-success`, {
        ...tracePayload,
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
      });
      return { success: true };
    } catch (error) {
      log.error(`Error invoking ${tracePrefix}:`, error);
      appendCommandLauncherTrace(`${tracePrefix}-error`, { ...tracePayload, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  ipcMain.handle('bookmarks:getAuthorBookmarks', (_event, handle: string) => {
    if (!bookmarksManager) return [];
    return bookmarksForAuthor(handle, bookmarksManager.getSnapshot().bookmarks);
  });

  ipcMain.handle('bookmarks:getTaxonomyBookmarks', (_event, filePaths: string[]) => {
    if (!bookmarksManager) return [];
    if (!Array.isArray(filePaths)) return [];
    return bookmarksForTaxonomyFiles(filePaths, bookmarksManager.getSnapshot().bookmarks);
  });

  ipcMain.handle('bookmarks:search', (_event, query: string) => {
    if (!bookmarksManager || typeof query !== 'string') return [];
    return searchBookmarks(query, bookmarksManager.getSnapshot().bookmarks);
  });

  ipcMain.handle('bookmarks:saveWebUrl', async (_event, url: string) => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { success: false, error: 'Field Theory is read-only' };
    }
    if (!bookmarksManager) {
      return { success: false, error: 'Bookmarks not initialized' };
    }
    if (typeof url !== 'string' || !url.trim()) {
      return { success: false, error: 'URL is required' };
    }

    try {
      const result = await bookmarksManager.saveWebBookmarkFromUrl(url);
      return { success: true, ...result };
    } catch (error) {
      log.error('Error saving web bookmark:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  const getActiveWebPageForLauncher = async (tracePrefix: string) => {
    const targetApp = getCommandLauncherTargetApp();
    appendCommandLauncherTrace(`${tracePrefix}-start`, {
      targetBundleId: targetApp?.bundleId ?? null,
      targetName: targetApp?.name ?? null,
    });

    if (!targetApp) {
      appendCommandLauncherTrace(`${tracePrefix}-no-target`);
      return { success: false, error: 'No browser app was active before the launcher opened' };
    }

    try {
      const page = await getActiveBrowserPage(targetApp);
      if (!page) {
        appendCommandLauncherTrace(`${tracePrefix}-no-page`, {
          targetBundleId: targetApp.bundleId,
          targetName: targetApp.name,
        });
        return { success: false, error: `No active browser page found in ${targetApp.name}` };
      }
      appendCommandLauncherTrace(`${tracePrefix}-success`, {
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        url: page.url,
      });
      return { success: true, page };
    } catch (error) {
      log.error(`Error resolving active browser page for ${tracePrefix}:`, error);
      appendCommandLauncherTrace(`${tracePrefix}-error`, {
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        error,
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  ipcMain.handle('bookmarks:getActiveWebPage', async () => getActiveWebPageForLauncher('get-active-web-page'));

  ipcMain.handle('bookmarks:saveActiveWebPage', async () => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { success: false, error: 'Field Theory is read-only' };
    }
    if (!bookmarksManager) {
      return { success: false, error: 'Bookmarks not initialized' };
    }

    const activePage = await getActiveWebPageForLauncher('save-active-web-page');
    if (!activePage.success || !activePage.page) {
      return activePage;
    }

    try {
      const { page } = activePage;
      const result = await bookmarksManager.saveWebBookmarkFromUrl(page.url);
      appendCommandLauncherTrace('save-active-web-page-success', {
        targetBundleId: page.bundleId,
        targetName: page.appName,
        url: page.url,
        created: result.created,
        markdownPath: result.markdownPath,
      });
      return { success: true, page, ...result };
    } catch (error) {
      log.error('Error saving active browser page:', error);
      appendCommandLauncherTrace('save-active-web-page-error', {
        targetBundleId: activePage.page.bundleId,
        targetName: activePage.page.appName,
        error,
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('bookmarks:invokeBookmark', async (_event, id: string) => {
    if (!bookmarksManager) {
      return { success: false, error: 'Bookmarks not initialized' };
    }

    const bookmark = bookmarkById(id, bookmarksManager.getSnapshot().bookmarks);
    if (!bookmark) {
      return { success: false, error: 'Bookmark not found' };
    }

    return pasteBookmarkTextFromLauncher('invoke-bookmark-post', { id }, formatBookmarkPost(bookmark));
  });

  ipcMain.handle('bookmarks:copyForAgent', async (_event, id: string) => {
    if (!bookmarksManager) {
      return { success: false, error: 'Bookmarks not initialized' };
    }

    const bookmark = bookmarkById(id, bookmarksManager.getSnapshot().bookmarks);
    if (!bookmark) {
      return { success: false, error: 'Bookmark not found' };
    }

    try {
      clipboard.writeText(buildBookmarkAgentCopyText(bookmark, bookmarkMediaDir()));
      clipboardManager?.syncClipboardHash();
      return { success: true };
    } catch (error) {
      log.error('Error copying bookmark for agent:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('bookmarks:invokeAuthorTimeline', async (_event, handle: string) => {
    if (!bookmarksManager) {
      return { success: false, error: 'Bookmarks not initialized' };
    }

    const timeline = formatBookmarkAuthorTimeline(handle, bookmarksManager.getSnapshot().bookmarks);
    if (!timeline) {
      return { success: false, error: 'No bookmarks found for author' };
    }

    return pasteBookmarkTextFromLauncher('invoke-bookmark-author', { handle }, timeline);
  });

  if (bookmarksManager) {
    bookmarksManager.startWatcher();
    bookmarksManager.on('bookmarks:changed', () => {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('bookmarks:changed');
      });
    });
  }

  // Get all watched directories
  ipcMain.handle('librarian:getWatchedDirs', (): WatchedDir[] => {
    if (!librarianManager) {
      return [];
    }
    return librarianManager.getWatchedDirs();
  });

  // Add a watched directory
  ipcMain.handle('librarian:addWatchedDir', (_event, dirPath: string): WatchedDir | null => {
    if (!librarianManager) {
      return null;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return librarianManager.addWatchedDir(dirPath);
  });

  // Remove a watched directory (by path)
  ipcMain.handle('librarian:removeWatchedDir', (_event, dirPath: string): boolean => {
    if (!librarianManager) {
      return false;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.removeWatchedDir(dirPath);
  });

  // Browse for a directory (open folder picker)
  ipcMain.handle('librarian:browseDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select a directory to watch for readings',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.on('librarian:setMarkdownEditorFocused', (_event, focused: boolean) => {
    librarianMarkdownEditorFocused = Boolean(focused);
  });

  // ===========================================================================
  // New Settings API (v2)
  // ===========================================================================

  // Check if Librarian is enabled
  ipcMain.handle('librarian:isEnabled', (): boolean => {
    return librarianManager?.isEnabled() ?? false;
  });

  // Enable or disable Librarian
  ipcMain.handle('librarian:setEnabled', (_event, enabled: boolean): boolean => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager?.setEnabled(enabled) ?? false;
  });

  // Check if setup wizard is complete
  ipcMain.handle('librarian:isSetupComplete', (): boolean => {
    return librarianManager?.isSetupComplete() ?? false;
  });

  // Mark setup wizard as complete
  ipcMain.handle('librarian:setSetupComplete', (_event, complete: boolean): void => {
    librarianManager?.setSetupComplete(complete);
  });

  // Create welcome artifact for setup wizard
  ipcMain.handle('librarian:createWelcomeArtifact', (_event, dirPath: string): boolean => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager?.createWelcomeArtifact(dirPath) ?? false;
  });

  // ===========================================================================
  // State-Enforced Mode API
  // ===========================================================================

  // Get state-enforced mode threshold
  ipcMain.handle('librarian:getStateEnforcedThreshold', (): number => {
    return librarianManager?.getStateEnforcedThreshold() ?? 3;
  });

  // Set state-enforced mode threshold
  ipcMain.handle('librarian:setStateEnforcedThreshold', (_event, threshold: number): boolean => {
    return librarianManager?.setStateEnforcedThreshold(threshold) ?? false;
  });

  // Get default rule content
  ipcMain.handle('librarian:getDefaultRuleContent', (): string => {
    return librarianManager?.getDefaultRuleContent() ?? '';
  });

  // Get custom rule content
  ipcMain.handle('librarian:getCustomRuleContent', (): string | undefined => {
    return librarianManager?.getCustomRuleContent();
  });

  // Set custom rule content
  ipcMain.handle('librarian:setCustomRuleContent', (_event, content: string | undefined): boolean => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager?.setCustomRuleContent(content) ?? false;
  });

  // Install global state-enforced hook
  ipcMain.handle('librarian:installStateEnforcedHook', (): boolean => {
    return librarianManager?.installStateEnforcedHook() ?? false;
  });

  // Uninstall global state-enforced hook
  ipcMain.handle('librarian:uninstallStateEnforcedHook', (): boolean => {
    return librarianManager?.uninstallStateEnforcedHook() ?? false;
  });

  // Check if global state-enforced hook is installed
  ipcMain.handle('librarian:isStateEnforcedHookInstalled', (): boolean => {
    return librarianManager?.isStateEnforcedHookInstalled() ?? false;
  });

  // Get count of pending jobs (from central directory)
  ipcMain.handle('librarian:getPendingJobCount', (): number => {
    return librarianManager?.getPendingJobCount() ?? 0;
  });

  // ===========================================================================
  // Cursor Hook API
  // ===========================================================================

  // Check if Cursor hook is installed
  ipcMain.handle('librarian:isCursorHookInstalled', (): boolean => {
    return librarianManager?.isCursorHookInstalled() ?? false;
  });

  // Install Cursor hook
  ipcMain.handle('librarian:installCursorHook', (): boolean => {
    return librarianManager?.installCursorHook() ?? false;
  });

  // Uninstall Cursor hook
  ipcMain.handle('librarian:uninstallCursorHook', (): boolean => {
    return librarianManager?.uninstallCursorHook() ?? false;
  });

  // ===========================================================================
  // Codex Hook API
  // ===========================================================================

  // Get Codex CLI installation status
  ipcMain.handle('librarian:getCodexStatus', (): string => {
    return librarianManager?.getCodexStatus() ?? 'not-installed';
  });

  // Check if Codex hook is installed
  ipcMain.handle('librarian:isCodexHookInstalled', (): boolean => {
    return librarianManager?.isCodexHookInstalled() ?? false;
  });

  // Install Codex hook
  ipcMain.handle('librarian:installCodexHook', (): boolean => {
    return librarianManager?.installCodexHook() ?? false;
  });

  // Uninstall Codex hook
  ipcMain.handle('librarian:uninstallCodexHook', (): boolean => {
    return librarianManager?.uninstallCodexHook() ?? false;
  });

  ipcMain.handle('librarian:isCodexStopOnPendingEnabled', (): boolean => {
    return librarianManager?.isCodexStopOnPendingEnabled() ?? false;
  });

  ipcMain.handle('librarian:setCodexStopOnPendingEnabled', (_event, enabled: boolean): boolean => {
    return librarianManager?.setCodexStopOnPendingEnabled(enabled) ?? false;
  });

  // ===========================================================================
  // Discovery Frequency API
  // ===========================================================================

  // Get discovery frequency
  ipcMain.handle('librarian:getDiscoveryFrequency', (): string => {
    return librarianManager?.getDiscoveryFrequency() ?? 'sometimes';
  });

  // Set discovery frequency
  ipcMain.handle('librarian:setDiscoveryFrequency', (_event, frequency: string): boolean => {
    if (librarianManager && (frequency === 'often' || frequency === 'sometimes' || frequency === 'rarely')) {
      return librarianManager.setDiscoveryFrequency(frequency);
    }
    return false;
  });

  // ===========================================================================
  // User Expertise API
  // ===========================================================================

  // Get user expertise context
  ipcMain.handle('librarian:getUserExpertiseContext', (): string | undefined => {
    return librarianManager?.getUserExpertiseContext();
  });

  // Set user expertise context
  ipcMain.handle('librarian:setUserExpertiseContext', (_event, context: string | undefined): boolean => {
    return librarianManager?.setUserExpertiseContext(context) ?? false;
  });

  // ===========================================================================
  // Legacy Settings API (kept for backward compatibility)
  // ===========================================================================

  // Get auto-run frequency setting (deprecated)
  ipcMain.handle('librarian:getAutoRunFrequency', (): string => {
    return librarianManager?.getAutoRunFrequency() || 'off';
  });

  // Set auto-run frequency setting (deprecated)
  ipcMain.handle('librarian:setAutoRunFrequency', (_event, frequency: string): boolean => {
    if (librarianManager && (frequency === 'off' || frequency === 'occasionally' || frequency === 'regularly' || frequency === 'frequently' || frequency === 'always')) {
      return librarianManager.setAutoRunFrequency(frequency);
    }
    return false;
  });

  // Force re-sync CLAUDE.md with current settings
  ipcMain.handle('librarian:resyncClaudeMd', (): boolean => {
    return librarianManager?.resyncClaudeMd() ?? false;
  });

  // Get Claude Code installation status
  ipcMain.handle('librarian:getClaudeCodeStatus', (): string => {
    return librarianManager?.getClaudeCodeStatus() ?? 'not-installed';
  });

  // Install Claude Code hook for automatic Librarian reminders
  ipcMain.handle('librarian:installClaudeCodeHook', (): boolean => {
    return librarianManager?.installClaudeCodeHook() ?? false;
  });

  // Uninstall Claude Code hook
  ipcMain.handle('librarian:uninstallClaudeCodeHook', (): boolean => {
    return librarianManager?.uninstallClaudeCodeHook() ?? false;
  });

  // Check if Claude Code hook is installed
  ipcMain.handle('librarian:isClaudeCodeHookInstalled', (): boolean => {
    return librarianManager?.isClaudeCodeHookInstalled() ?? false;
  });

  // Initialize project status for hook system
  ipcMain.handle('librarian:initializeProjectStatus', (_event, projectPath: string): void => {
    librarianManager?.initializeProjectStatus(projectPath);
  });

  // Get Cursor instructions text
  ipcMain.handle('librarian:getCursorInstructions', (): string => {
    return librarianManager?.getCursorInstructions() || '';
  });

  // Get configuration file paths
  ipcMain.handle('librarian:getConfigPaths', (): { claudeMd: string; librarianCommand: string } => {
    return {
      claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
      librarianCommand: path.join(os.homedir(), '.fieldtheory', 'commands', 'librarian.md'),
    };
  });

  // Allowed path prefixes for librarian file operations (defense-in-depth)
  const librarianAllowedPrefixes = [
    path.join(os.homedir(), '.fieldtheory'),
    path.join(os.homedir(), '.librarian'),
    path.join(os.homedir(), '.claude'),
    app.getPath('userData'),
  ];

  function isLibrarianPathAllowed(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return librarianAllowedPrefixes.some(prefix => resolved.startsWith(prefix + path.sep) || resolved === prefix);
  }

  // Open a file in the default editor
  ipcMain.handle('librarian:openInEditor', async (_event, filePath: string): Promise<boolean> => {
    try {
      if (!isLibrarianPathAllowed(filePath)) {
        log.error('Librarian: path not allowed:', filePath);
        return false;
      }
      await shell.openPath(filePath);
      return true;
    } catch (error) {
      log.error('Librarian failed to open file:', error);
      return false;
    }
  });

  // Read a config file's contents
  ipcMain.handle('librarian:readConfigFile', (_event, filePath: string): string | null => {
    try {
      if (!isLibrarianPathAllowed(filePath)) {
        log.error('Librarian: path not allowed:', filePath);
        return null;
      }
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return null;
    } catch (error) {
      log.error('Librarian failed to read file:', error);
      return null;
    }
  });

  // Write a config file's contents
  ipcMain.handle('librarian:writeConfigFile', (_event, filePath: string, content: string): boolean => {
    try {
      if (!isLibrarianPathAllowed(filePath)) {
        log.error('Librarian: path not allowed:', filePath);
        return false;
      }
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
      return true;
    } catch (error) {
      log.error('Librarian failed to write file:', error);
      return false;
    }
  });

  // Get auto-show setting
  ipcMain.handle('librarian:getAutoShowEnabled', (): boolean => {
    return librarianManager?.isAutoShowEnabled() ?? true;
  });

  // Set auto-show setting
  ipcMain.handle('librarian:setAutoShowEnabled', (_event, enabled: boolean): void => {
    librarianManager?.setAutoShowEnabled(enabled);
  });

  // Get whether auto-show steals focus
  ipcMain.handle('librarian:getAutoShowStealsFocus', (): boolean => {
    return librarianManager?.doesAutoShowStealFocus() ?? true;
  });

  // Set whether auto-show steals focus
  ipcMain.handle('librarian:setAutoShowStealsFocus', (_event, enabled: boolean): void => {
    librarianManager?.setAutoShowStealsFocus(enabled);
  });

  // Get resume after close setting
  ipcMain.handle('librarian:getResumeAfterClose', (): boolean => {
    return librarianManager?.isResumeAfterCloseEnabled() ?? false;
  });

  // Set resume after close setting
  ipcMain.handle('librarian:setResumeAfterClose', (_event, enabled: boolean): void => {
    librarianManager?.setResumeAfterClose(enabled);
  });

  ipcMain.handle('librarian:getImmersiveHeightPercent', (): number => {
    return librarianManager?.getImmersiveHeightPercent() ?? 85;
  });

  ipcMain.handle('librarian:setImmersiveHeightPercent', (_event, percent: number): void => {
    librarianManager?.setImmersiveHeightPercent(percent);
  });

  // Get Claude config file path
  ipcMain.handle('librarian:getClaudeConfigPath', (): string => {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), '.claude', 'CLAUDE.md');
  });

  // Get default content guidance
  ipcMain.handle('librarian:getDefaultContentGuidance', (): string => {
    return librarianManager?.getDefaultContentGuidance() || '';
  });

  // Get current content guidance (custom or default)
  ipcMain.handle('librarian:getContentGuidance', (): string => {
    return librarianManager?.getContentGuidance() || '';
  });

  // Get custom content guidance (undefined if using default)
  ipcMain.handle('librarian:getCustomContentGuidance', (): string | undefined => {
    return librarianManager?.getCustomContentGuidance();
  });

  // Set custom content guidance (pass empty string or undefined to reset to default)
  ipcMain.handle('librarian:setCustomContentGuidance', (_event, guidance: string | undefined): boolean => {
    return librarianManager?.setCustomContentGuidance(guidance) ?? false;
  });

  // Reset content guidance to default
  ipcMain.handle('librarian:resetContentGuidance', (): boolean => {
    return librarianManager?.resetContentGuidance() ?? false;
  });

  // Discover existing .librarian directories that are not yet watched
  ipcMain.handle('librarian:discoverLibrarianDirs', async (): Promise<string[]> => {
    return librarianManager?.discoverLibrarianDirs() ?? [];
  });

  // Reset edit counters for all projects (for debugging/testing)
  ipcMain.handle('librarian:resetAllCounters', (): boolean => {
    return librarianManager?.resetAllCounters() ?? false;
  });

  // Get edit status for debugging
  ipcMain.handle('librarian:getEditStatus', (): { edits: number; threshold: number } | null => {
    return librarianManager?.getEditStatus() ?? null;
  });

  // Get custom threshold (undefined if using frequency-based)
  ipcMain.handle('librarian:getCustomThreshold', (): number | undefined => {
    return librarianManager?.getCustomThreshold();
  });

  // Set custom threshold (pass undefined to return to frequency-based)
  ipcMain.handle('librarian:setCustomThreshold', (_event, threshold: number | undefined): boolean => {
    return librarianManager?.setCustomThreshold(threshold) ?? false;
  });

  // Poll for pending artifact and counter state.
  // Renderer calls this on mount/interval for UI display.
  // Counter resets are handled by reading-added event, not here.
  ipcMain.handle('librarian:pollStatus', (): {
    pendingPath: string | null;
    edits: number;
    threshold: number;
    didReset: boolean;
  } => {
    // Get current counter state (no reset logic here)
    const status = librarianManager?.checkAndResetIfNeeded() ?? { edits: 0, threshold: 5, didReset: false };

    // Get and clear pending auto-open reading
    const p = pendingAutoOpenReading;
    pendingAutoOpenReading = null;

    return {
      pendingPath: p,
      edits: status.edits,
      threshold: status.threshold,
      didReset: status.didReset,
    };
  });

  // ===========================================================================
  // Public Sharing
  // ===========================================================================

  // Share a reading publicly
  ipcMain.handle('librarian:shareReading', async (_event, filePath: string): Promise<{ slug: string; url: string } | null> => {
    if (!authManager?.isAuthenticated()) {
      return null;
    }

    const reading = librarianManager?.getReading(filePath);
    if (!reading) {
      return null;
    }

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) {
      return null;
    }

    // Get author name from profile (first + last for "First L." format)
    let authorName: string | null = null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .single();
      if (profile?.first_name && profile?.last_name) {
        authorName = `${profile.first_name} ${profile.last_name}`;
      } else if (profile?.first_name) {
        authorName = profile.first_name;
      }
    } catch {
      // Ignore profile fetch errors
    }

    // Check if this reading was previously shared (re-sharing)
    const { data: existing } = await supabase
      .from('shared_readings')
      .select('slug, is_public')
      .eq('source_path', filePath)
      .eq('user_id', session.user.id)
      .single();

    if (existing) {
      // Re-enable existing share
      if (!existing.is_public) {
        await supabase
          .from('shared_readings')
          .update({ is_public: true, content: reading.content, title: reading.title, author_name: authorName })
          .eq('source_path', filePath)
          .eq('user_id', session.user.id);
      }
      return {
        slug: existing.slug,
        url: `https://librarian.fieldtheory.dev/${existing.slug}`,
      };
    }

    // Generate slug: title-abc123
    const slugify = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

    const baseSlug = slugify(reading.title);

    // Try up to 3 times with different random suffixes
    for (let attempt = 0; attempt < 3; attempt++) {
      const randomSuffix = crypto.randomBytes(3).toString('hex');
      const slug = `${baseSlug}-${randomSuffix}`;

      const { data, error } = await supabase
        .from('shared_readings')
        .insert({
          user_id: session.user.id,
          slug,
          title: reading.title,
          content: reading.content,
          author_name: authorName,
          source_path: filePath,
          is_public: true,
        })
        .select('slug')
        .single();

      if (!error && data) {
        metricsManager?.recordLibrarianArtifactShared();
        return {
          slug: data.slug,
          url: `https://librarian.fieldtheory.dev/${data.slug}`,
        };
      }

      // If unique constraint violation, try again with new suffix
      if (error?.code === '23505') {
        continue;
      }

      log.error('Librarian share failed:', error);
      return null;
    }

    log.error('Librarian share failed: max retries exceeded');
    return null;
  });

  // Unshare a reading (soft delete)
  ipcMain.handle('librarian:unshareReading', async (_event, filePath: string): Promise<boolean> => {
    if (!authManager?.isAuthenticated()) return false;

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) return false;

    const { error } = await supabase
      .from('shared_readings')
      .update({ is_public: false })
      .eq('source_path', filePath)
      .eq('user_id', session.user.id);

    if (error) {
      log.error('Librarian unshare failed:', error);
      return false;
    }

    return true;
  });

  // Check if a reading is shared
  ipcMain.handle('librarian:getShareStatus', async (_event, filePath: string): Promise<{ shared: boolean; slug?: string; url?: string } | null> => {
    if (!authManager?.isAuthenticated()) return null;

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) return null;

    const { data, error } = await supabase
      .from('shared_readings')
      .select('slug, is_public')
      .eq('source_path', filePath)
      .eq('user_id', session.user.id)
      .single();

    if (error || !data) {
      return { shared: false };
    }

    if (!data.is_public) {
      return { shared: false };
    }

    return {
      shared: true,
      slug: data.slug,
      url: `https://librarian.fieldtheory.dev/${data.slug}`,
    };
  });

  // Update a shared reading's content
  ipcMain.handle('librarian:updateSharedReading', async (_event, filePath: string, content: string, title: string): Promise<boolean> => {
    if (!authManager?.isAuthenticated()) return false;

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) return false;

    // Get author name from profile
    let authorName: string | null = null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .single();
      if (profile?.first_name && profile?.last_name) {
        authorName = `${profile.first_name} ${profile.last_name}`;
      } else if (profile?.first_name) {
        authorName = profile.first_name;
      }
    } catch {
      // Ignore profile fetch errors
    }

    const { error } = await supabase
      .from('shared_readings')
      .update({ content, title, author_name: authorName, updated_at: new Date().toISOString() })
      .eq('source_path', filePath)
      .eq('user_id', session.user.id)
      .eq('is_public', true);

    if (error) {
      log.error('Librarian update shared reading failed:', error);
      return false;
    }

    return true;
  });

  // Mute librarian for today
  ipcMain.handle('librarian:muteForToday', (): boolean => {
    return librarianManager?.muteForToday() ?? false;
  });

  // Check if muted for today
  ipcMain.handle('librarian:isMutedForToday', (): boolean => {
    return librarianManager?.isMutedForToday() ?? false;
  });

  // Unmute librarian
  ipcMain.handle('librarian:unmute', (): boolean => {
    return librarianManager?.unmute() ?? false;
  });

  // Get concepts index for story/lesson graph visualization
  ipcMain.handle('librarian:getConceptsIndex', (): {
    schema_version: number;
    description?: string;
    indexed_at: string | null;
    artifacts: Record<string, { title: string; stories: string[]; lessons: string[] }>;
    stories_used: string[];
    lessons_used: string[];
  } | null => {
    return librarianManager?.getConceptsIndex() ?? null;
  });

  // ===========================================================================
  // Claude IPC handlers - Claude Code integration settings
  // ===========================================================================

  // Check if screenshot permission is enabled
  ipcMain.handle('claude:isScreenshotPermissionEnabled', (): boolean => {
    return librarianManager?.isScreenshotPermissionEnabled() ?? false;
  });

  // Enable screenshot permission
  ipcMain.handle('claude:enableScreenshotPermission', (): boolean => {
    return librarianManager?.enableScreenshotPermission() ?? false;
  });

  // Get figures directory path for permissions
  ipcMain.handle('claude:getFiguresPath', (): string => {
    return path.join(app.getPath('userData'), 'figures');
  });

  // Get available permission profiles
  ipcMain.handle('claude:getAvailableProfiles', (): Array<{ id: string; name: string; description: string; permissionCount: number; permissions: string[] }> => {
    return librarianManager?.getAvailableProfiles() ?? [];
  });

  // Get current permission status
  ipcMain.handle('claude:getPermissionStatus', (): { currentProfile: string | null; managedPermissions: string[]; allClaudePermissions: string[] } => {
    return librarianManager?.getPermissionStatus() ?? { currentProfile: null, managedPermissions: [], allClaudePermissions: [] };
  });

  // Apply a permission profile
  ipcMain.handle('claude:applyPermissionProfile', (_event, profileId: string): boolean => {
    return librarianManager?.applyPermissionProfile(profileId) ?? false;
  });

  // Add individual permissions
  ipcMain.handle('claude:addPermissions', (_event, permissions: string[]): boolean => {
    return librarianManager?.addPermissions(permissions) ?? false;
  });

  // Remove individual permissions
  ipcMain.handle('claude:removePermissions', (_event, permissions: string[]): boolean => {
    return librarianManager?.removePermissions(permissions) ?? false;
  });

  // Clear all managed permissions
  ipcMain.handle('claude:clearManagedPermissions', (): boolean => {
    return librarianManager?.clearManagedPermissions() ?? false;
  });

  // ---------------------------------------------------------------------------
  // Read Permission Hooks (separate from Librarian)
  // Auto-approve reads for Field Theory files (figures, commands)
  // ---------------------------------------------------------------------------

  // Check if Claude Code read permission hook is installed
  ipcMain.handle('claude:isReadPermissionHookInstalled', (): boolean => {
    return librarianManager?.isReadPermissionHookInstalled() ?? false;
  });

  // Check if Claude Code read permission hook needs updating
  ipcMain.handle('claude:needsReadPermissionUpdate', (): boolean => {
    return librarianManager?.needsReadPermissionUpdate() ?? false;
  });

  // Install Claude Code read permission hook
  ipcMain.handle('claude:installReadPermissionHook', (): { success: boolean; message: string } => {
    return librarianManager?.installReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // Uninstall Claude Code read permission hook
  ipcMain.handle('claude:uninstallReadPermissionHook', (): { success: boolean; message: string } => {
    return librarianManager?.uninstallReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // Check if Cursor read permission hook is installed
  ipcMain.handle('cursor:isReadPermissionHookInstalled', (): boolean => {
    return librarianManager?.isCursorReadPermissionHookInstalled() ?? false;
  });

  // Install Cursor read permission hook
  ipcMain.handle('cursor:installReadPermissionHook', (): { success: boolean; message: string } => {
    return librarianManager?.installCursorReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // Uninstall Cursor read permission hook
  ipcMain.handle('cursor:uninstallReadPermissionHook', (): { success: boolean; message: string } => {
    return librarianManager?.uninstallCursorReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // Check if Codex read permission hook is installed
  ipcMain.handle('codex:isReadPermissionHookInstalled', (): boolean => {
    return librarianManager?.isCodexReadPermissionHookInstalled() ?? false;
  });

  // Install Codex read permission hook
  ipcMain.handle('codex:installReadPermissionHook', (): { success: boolean; message: string } => {
    return librarianManager?.installCodexReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // Uninstall Codex read permission hook
  ipcMain.handle('codex:uninstallReadPermissionHook', (): { success: boolean; message: string } => {
    return librarianManager?.uninstallCodexReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // ===========================================================================
  // Metrics IPC handlers - User-visible usage stats
  // "The metrics you see are the metrics we see."
  // ===========================================================================

  // Get current metrics for display in Settings
  ipcMain.handle('metrics:getMetrics', (): UserMetrics => {
    return metricsManager?.getMetrics() ?? {
      transcriptions: 0,
      words_transcribed: 0,
      words_improved: 0,
      priority_mic_minutes: 0,
      verbal_commands: 0,
      command_launcher_uses: 0,
      clipboard_items: 0,
      pastes_used: 0,
      stacks_created: 0,
      autostacks_created: 0,
      stacks_pasted: 0,
      items_added_to_context: 0,
      sketches_created: 0,
      screenshots_taken: 0,
      librarian_artifacts_created: 0,
      librarian_artifacts_shared: 0,
      commands_executed: 0,
      commands_contributed: 0,
      feedback_given: 0,
    };
  });

  // Get metrics with sync status
  ipcMain.handle('metrics:getMetricsWithStatus', (): { metrics: UserMetrics; lastSyncedAt: string | null; pendingSync: boolean } => {
    return metricsManager?.getMetricsWithStatus() ?? {
      metrics: {
        transcriptions: 0,
        words_transcribed: 0,
        words_improved: 0,
        priority_mic_minutes: 0,
        verbal_commands: 0,
        command_launcher_uses: 0,
        clipboard_items: 0,
        pastes_used: 0,
        stacks_created: 0,
        autostacks_created: 0,
        stacks_pasted: 0,
        items_added_to_context: 0,
        sketches_created: 0,
        screenshots_taken: 0,
        librarian_artifacts_created: 0,
        librarian_artifacts_shared: 0,
        commands_executed: 0,
        commands_contributed: 0,
        feedback_given: 0,
      },
      lastSyncedAt: null,
      pendingSync: false,
    };
  });

  // Force sync to Supabase
  ipcMain.handle('metrics:syncToSupabase', async (): Promise<boolean> => {
    return metricsManager?.syncToSupabase() ?? false;
  });

  // Fetch from Supabase (merge with local)
  ipcMain.handle('metrics:fetchFromSupabase', async (): Promise<boolean> => {
    return metricsManager?.fetchFromSupabase() ?? false;
  });
}

function setupTaggedDocsIPCHandlers(): void {
  ipcMain.handle(TaggedDocsIPCChannels.LIST, (): TaggedDoc[] => {
    return taggedDocsManager?.list() ?? [];
  });

  ipcMain.handle(TaggedDocsIPCChannels.MARK_READ, (_event, ulid: string): TaggedDoc | null => {
    return taggedDocsManager?.markRead(ulid) ?? null;
  });

  ipcMain.handle(TaggedDocsIPCChannels.MARK_ALL_READ, (): TaggedDoc[] => {
    return taggedDocsManager?.markAllRead() ?? [];
  });

  ipcMain.handle(TaggedDocsIPCChannels.RESCAN, async (): Promise<TaggedDoc[]> => {
    return taggedDocsManager?.rescan() ?? [];
  });
}

/**
 * Set up IPC handlers for Squares window management.
 */
function setupSquaresIPCHandlers(): void {
  // Execute a window management action (e.g., leftHalf, grid, focus)
  ipcMain.handle(
    SquaresIPCChannels.EXECUTE_ACTION,
    async (_event, action: SquaresAction, source?: SquaresActionSource) => {
      return squaresManager?.executeAction(action, { source }) ?? false;
    }
  );

  // Get all visible windows
  ipcMain.handle(SquaresIPCChannels.GET_WINDOWS, async () => {
    return squaresManager?.getWindows() ?? [];
  });

  // Get display/screen info
  ipcMain.handle(SquaresIPCChannels.GET_SCREENS, () => {
    return squaresManager?.getScreens() ?? [];
  });

  // Configuration
  ipcMain.handle(SquaresIPCChannels.GET_CONFIG, () => {
    return squaresManager?.getConfig() ?? null;
  });

  ipcMain.handle(SquaresIPCChannels.SET_CONFIG, async (_event, config: Record<string, any>) => {
    await squaresManager?.setConfig(config);
  });

  ipcMain.handle(SquaresIPCChannels.GET_HOTKEYS, () => {
    return squaresManager?.getHotkeys() ?? null;
  });

  ipcMain.handle(SquaresIPCChannels.SET_HOTKEYS, async (_event, hotkeys: Record<string, any>) => {
    await squaresManager?.setHotkeys(hotkeys);
  });

  ipcMain.handle(SquaresIPCChannels.RESET_HOTKEYS, async () => {
    await squaresManager?.resetHotkeys();
  });

  // History / undo
  ipcMain.handle(SquaresIPCChannels.GET_HISTORY_COUNT, () => {
    return squaresManager?.getHistoryCount() ?? 0;
  });

  ipcMain.handle(SquaresIPCChannels.CLEAR_HISTORY, () => {
    squaresManager?.clearHistory();
  });
}

/**
 * Set up IPC handlers for gaze tracking pipeline.
 * Phases 1-4: status/sample, calibration, dwell/window focus config, debug overlay.
 */
function setupGazeIPCHandlers(): void {
  ipcMain.handle(GazeIPCChannels.GET_STATUS, () => {
    return gazeTrackingManager?.getStatus() ?? createUnavailableGazeStatus();
  });

  ipcMain.handle(GazeIPCChannels.SET_ENABLED, async (_event, enabled: boolean) => {
    if (!gazeTrackingManager) {
      return createUnavailableGazeStatus();
    }
    return await gazeTrackingManager.setEnabled(!!enabled);
  });

  ipcMain.handle(GazeIPCChannels.GET_LATEST_SAMPLE, () => {
    return gazeTrackingManager?.getLatestSample() ?? null;
  });

  ipcMain.handle(GazeIPCChannels.GET_CALIBRATION_STATE, () => {
    return gazeTrackingManager?.getCalibrationState() ?? createUnavailableCalibrationState();
  });

  ipcMain.handle(GazeIPCChannels.START_CALIBRATION, async () => {
    if (!gazeTrackingManager) {
      return createUnavailableCalibrationState();
    }
    return await gazeTrackingManager.startCalibration();
  });

  ipcMain.handle(GazeIPCChannels.CANCEL_CALIBRATION, () => {
    if (!gazeTrackingManager) {
      return createUnavailableCalibrationState();
    }
    return gazeTrackingManager.cancelCalibration();
  });

  ipcMain.handle(GazeIPCChannels.RESET_EYE_TRACKING_DATA, async () => {
    if (!gazeTrackingManager) {
      return createUnavailableCalibrationState();
    }
    return await gazeTrackingManager.resetEyeTrackingData();
  });

  ipcMain.handle(
    GazeIPCChannels.APPLY_MANUAL_CORRECTION,
    async (_event, target: { x: number; y: number }) => {
      if (!gazeTrackingManager) {
        return createUnavailableCalibrationState();
      }
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
        return gazeTrackingManager.getCalibrationState();
      }
      return await gazeTrackingManager.applyManualCorrection({
        x: target.x,
        y: target.y,
      });
    }
  );

  ipcMain.handle(GazeIPCChannels.GET_FOCUS_CONFIG, () => {
    return gazeTrackingManager?.getFocusConfig() ?? createDefaultGazeWindowFocusConfig();
  });

  ipcMain.handle(
    GazeIPCChannels.SET_FOCUS_CONFIG,
    async (_event, config: Partial<GazeWindowFocusConfig> | null | undefined) => {
      if (!gazeTrackingManager) {
        return createDefaultGazeWindowFocusConfig();
      }
      return await gazeTrackingManager.setFocusConfig(config ?? {});
    }
  );

  ipcMain.handle(GazeIPCChannels.GET_DEBUG_OVERLAY_STATE, () => {
    return gazeDebugOverlayManager?.getState() ?? createUnavailableDebugOverlayState();
  });

  ipcMain.handle(GazeIPCChannels.SET_DEBUG_OVERLAY_ENABLED, async (_event, enabled: boolean) => {
    if (!gazeDebugOverlayManager) {
      return createUnavailableDebugOverlayState();
    }
    const next = await gazeDebugOverlayManager.setEnabled(!!enabled);
    if (enabled && gazeTrackingManager) {
      gazeDebugOverlayManager.updateStatus(gazeTrackingManager.getStatus());
      gazeDebugOverlayManager.updateCalibration(gazeTrackingManager.getCalibrationState());
      const latestSample = gazeTrackingManager.getLatestSample();
      if (latestSample) {
        gazeDebugOverlayManager.updateSample(latestSample);
      }
    }
    return next;
  });

  ipcMain.handle(GazeIPCChannels.GET_SCREEN_OVERLAY_STATE, () => {
    return gazeScreenOverlayManager?.getState() ?? createUnavailableScreenOverlayState();
  });

  ipcMain.handle(GazeIPCChannels.SET_SCREEN_OVERLAY_ENABLED, async (_event, enabled: boolean) => {
    if (!gazeScreenOverlayManager) {
      return createUnavailableScreenOverlayState();
    }
    const next = await gazeScreenOverlayManager.setEnabled(!!enabled);
    if (enabled && gazeTrackingManager) {
      gazeScreenOverlayManager.updateStatus(gazeTrackingManager.getStatus());
      const latestSample = gazeTrackingManager.getLatestSample();
      if (latestSample) {
        gazeScreenOverlayManager.updateSample(latestSample);
      }
    }
    return next;
  });
}

/**
 * Set up all IPC handlers for transcription-related communication.
 */
function setupTranscribeIPCHandlers(): void {
  ipcMain.handle(TranscribeIPCChannels.GET_STATUS, () => {
    if (!transcriberManager) {
      return 'idle';
    }
    return transcriberManager.getStatus();
  });

  ipcMain.handle(TranscribeIPCChannels.TOGGLE_RECORDING, () => {
    if (!transcriberManager) {
      return;
    }
    transcriberManager.toggleRecording();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_MODEL_STATUS, async () => {
    if (!transcriberManager) {
      return 'missing';
    }
    const modelManager = transcriberManager.getModelManager();
    const selectedModel = modelManager.getSelectedModel();
    const isAvailable = await modelManager.isModelAvailableForSize(selectedModel);
    return isAvailable ? 'downloaded' : 'missing';
  });

  ipcMain.handle(TranscribeIPCChannels.DOWNLOAD_MODEL, async (_event, modelSize?: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    let requestedModel: ModelSize | undefined;
    if (typeof modelSize === 'string') {
      if (!isModelSize(modelSize)) {
        throw new Error(`Invalid model size: ${modelSize}`);
      }
      requestedModel = modelSize;
    }
    
    const downloadFn = requestedModel
      ? (onProgress?: (downloaded: number, total: number) => void) =>
          modelManager.downloadModelForSize(requestedModel, onProgress)
      : (onProgress?: (downloaded: number, total: number) => void) =>
          modelManager.downloadModel(onProgress);
    
    await downloadFn((downloaded, total) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(
            TranscribeIPCChannels.MODEL_DOWNLOAD_PROGRESS,
            downloaded,
            total
          );
        }
      });
    });
  });

  ipcMain.handle(TranscribeIPCChannels.DELETE_MODEL, async (_event, modelSize: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    if (!isModelSize(modelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    return await modelManager.deleteModelForSize(modelSize);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AVAILABLE_MODELS, () => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    return modelManager.getAvailableModels();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_MODEL_DOWNLOAD_STATUS, async () => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    return modelManager.getDownloadStatus();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_DOWNLOADING_MODELS, () => {
    if (!transcriberManager) {
      return [];
    }
    const modelManager = transcriberManager.getModelManager();
    return modelManager.getDownloadingModels();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_SELECTED_MODEL, () => {
    if (!transcriberManager) {
      return DEFAULT_MODEL_SIZE;
    }
    return transcriberManager.getSelectedModel();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_SELECTED_MODEL, async (_event, modelSize: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    if (!isModelSize(modelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    log.info('Transcription model set: %s', modelSize);
    await transcriberManager.setSelectedModel(modelSize);
    broadcastHotMicRuntimeStatus();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_RECORDING_SOURCE, () => {
    return transcriberManager?.getRecordingSource() ?? 'microphone';
  });

  ipcMain.handle(TranscribeIPCChannels.SET_RECORDING_SOURCE, async (_event, source: 'microphone' | 'system-audio') => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.setRecordingSource(source);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_HOTKEY, () => {
    if (!transcriberManager) {
      return 'Option+/';
    }
    return transcriberManager.getHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_HOTKEY, async (_event, hotkey: string | null) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const success = await transcriberManager.setHotkey(hotkey);

    // Update tray manager with new transcription hotkey
    if (success && trayManager && clipboardManager) {
      const historyHotkey = clipboardManager.getHotkeys().history || 'Option+Space';
      const screenshotHotkey = clipboardManager.getHotkeys().screenshot || 'Command+4';
      trayManager.setHotkeys(historyHotkey, hotkey || '', screenshotHotkey);
    }

    return success;
  });

  ipcMain.handle(TranscribeIPCChannels.GET_SECONDARY_HOTKEY, () => {
    if (!transcriberManager) {
      return null;
    }
    return transcriberManager.getSecondaryHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_SECONDARY_HOTKEY, async (_event, hotkey: string | null) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    return await transcriberManager.setSecondaryHotkey(hotkey);
  });

  // Abandon recording hotkey settings.
  ipcMain.handle(TranscribeIPCChannels.GET_ABANDON_HOTKEY, () => {
    if (!transcriberManager) {
      return 'Escape';
    }
    return transcriberManager.getAbandonHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_ABANDON_HOTKEY, async (_event, hotkey: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    return await transcriberManager.setAbandonHotkey(hotkey);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_ABANDON_CONFIRMATION, () => {
    if (!transcriberManager) {
      return true;
    }
    return transcriberManager.getAbandonConfirmation();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_ABANDON_CONFIRMATION, async (_event, enabled: boolean) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.setAbandonConfirmation(enabled);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AUTO_IMPROVE, () => {
    return false;
  });

  ipcMain.handle(TranscribeIPCChannels.SET_AUTO_IMPROVE, async () => {
    if (!transcriberManager) return;
    await transcriberManager.setAutoImprove(false);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AUTO_IMPROVE_MIN_WORDS, () => {
    return 0;
  });

  ipcMain.handle(TranscribeIPCChannels.SET_AUTO_IMPROVE_MIN_WORDS, async () => {
    return;
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AUTO_IMPROVE_STATS, () => {
    if (!preferencesManager) {
      return { wordsImproved: 0, apiCalls: 0, inputTokens: 0, outputTokens: 0 };
    }
    const prefs = preferencesManager.get();
    return prefs.autoImproveStats || { wordsImproved: 0, apiCalls: 0, inputTokens: 0, outputTokens: 0 };
  });

  ipcMain.handle(TranscribeIPCChannels.RESET_AUTO_IMPROVE_STATS, async () => {
    if (!preferencesManager) {
      throw new Error('PreferencesManager not initialized');
    }
    await preferencesManager.save({
      autoImproveStats: { wordsImproved: 0, apiCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
  });

  ipcMain.handle(TranscribeIPCChannels.GET_TRANSCRIPTION_ENGINE, () => {
    return transcriberManager?.getConfiguredTranscriptionEngine()
      ?? preferencesManager?.getPreference('transcriptionEngine')
      ?? 'whisper';
  });

  ipcMain.handle(TranscribeIPCChannels.SET_TRANSCRIPTION_ENGINE, async (_event, engine: TranscriptionEngine) => {
    if (!preferencesManager) {
      throw new Error('PreferencesManager not initialized');
    }
    log.info('Transcription engine set: %s', engine);
    await preferencesManager.save({
      transcriptionEngine: engine,
      hotMicTranscriptionEngine: 'default',
    });
    await transcriberManager?.restartTranscriptionRuntime();
    broadcastHotMicRuntimeStatus();
  });

  // Sound settings handlers.
  ipcMain.handle(TranscribeIPCChannels.GET_SOUND_CONFIG, () => {
    if (!transcriberManager) {
      return { enabled: true, recordingStart: undefined, recordingStop: undefined, recordingCancel: undefined };
    }
    return transcriberManager.getSoundManager().getConfig();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_SOUND_CONFIG, async (_event, config: {
    enabled?: boolean;
    recordingStart?: string;
    recordingStop?: string;
    recordingCancel?: string;
  }) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.getSoundManager().setConfig(config);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AVAILABLE_SOUNDS, () => {
    // Import dynamically to avoid circular dependency issues.
    const { getAllSounds } = require('./soundManager');
    return getAllSounds();
  });

  ipcMain.handle(TranscribeIPCChannels.PREVIEW_SOUND, async (_event, soundId: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    transcriberManager.getSoundManager().preview(soundId);
  });

  ipcMain.handle(TranscribeIPCChannels.IS_APPLE_SILICON, () => {
    return process.arch === 'arm64';
  });

  ipcMain.handle(TranscribeIPCChannels.IS_MLX_WHISPER_INSTALLED, async () => {
    if (!transcriberManager) {
      return false;
    }
    return transcriberManager.isMlxWhisperInstalled();
  });

  ipcMain.handle(TranscribeIPCChannels.SETUP_MLX_WHISPER, async () => {
    const macAppRoot = path.resolve(__dirname, '../..');
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'setup-mlx-whisper.sh')
      : path.join(macAppRoot, 'scripts', 'setup-mlx-whisper.sh');
    const setupCwd = app.isPackaged ? app.getPath('userData') : macAppRoot;

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `MLX Whisper setup script not found at: ${scriptPath}` };
    }

    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      exec(`bash "${scriptPath}"`, { cwd: setupCwd, timeout: 600000 }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          const details = [stderr?.trim(), stdout?.trim(), error.message].filter(Boolean).join('\n');
          resolve({ success: false, error: details });
        } else {
          resolve({ success: true });
        }
      });
    });
  });

  ipcMain.handle(TranscribeIPCChannels.IS_PARAKEET_INSTALLED, async () => {
    if (!transcriberManager) {
      return false;
    }
    return transcriberManager.isParakeetInstalled();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_PARAKEET_STATUS, async () => {
    if (!transcriberManager) {
      return null;
    }
    return transcriberManager.getParakeetStatus();
  });

  ipcMain.handle(TranscribeIPCChannels.SETUP_PARAKEET, async (_event, engine?: 'parakeet' | 'parakeet-multilingual') => {
    if (!transcriberManager) {
      return { success: false, error: 'Transcriber manager not initialized' };
    }
    return transcriberManager.setupParakeet(engine);
  });

  ipcMain.handle(TranscribeIPCChannels.UNINSTALL_PARAKEET, async () => {
    if (!transcriberManager) {
      return { success: false, error: 'Transcriber manager not initialized' };
    }
    return transcriberManager.uninstallParakeet();
  });

  ipcMain.handle('transcribe:getStackCount', () => {
    if (!transcriberManager) {
      return 0;
    }
    return transcriberManager.getCurrentStack().length;
  });
  
  ipcMain.handle('transcribe:addToStack', (_event, itemId: number) => {
    if (!transcriberManager) {
      return;
    }
    transcriberManager.addToStack(itemId);
  });
}

/**
 * Set up all IPC handlers for clipboard-related communication.
 */
function setupClipboardIPCHandlers(): void {
  ipcMain.handle(ClipboardIPCChannels.QUERY_ITEMS, async (_event, options?: ClipboardQueryOptions) => {
    if (!clipboardManager) {
      return [];
    }
    const items = clipboardManager.queryItems(options);
    // Convert Buffer to base64 for IPC. For list view, thumbnailData is preferred.
    return items.map(item => ({
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
      thumbnailData: item.thumbnailData ? item.thumbnailData.toString('base64') : null,
    }));
  });

  ipcMain.handle(ClipboardIPCChannels.GET_ITEM, async (_event, id: number) => {
    if (!clipboardManager) {
      return null;
    }
    const item = clipboardManager.getItem(id);
    if (!item) {
      return null;
    }
    return {
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
      thumbnailData: item.thumbnailData ? item.thumbnailData.toString('base64') : null,
    };
  });

  ipcMain.handle(ClipboardIPCChannels.DELETE_ITEM, async (_event, id: number) => {
    if (clipboardManager) {
      clipboardManager.deleteItem(id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_DELETED, id);
        }
      });
    }
  });

  ipcMain.handle(ClipboardIPCChannels.RESTORE_ITEM, async (_event, item: any) => {
    if (clipboardManager) {
      const id = await clipboardManager.restoreItem(item);
      // Notify listeners of restored item
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      return id;
    }
    return -1;
  });

  ipcMain.handle(ClipboardIPCChannels.CLEAR_ALL, async () => {
    if (clipboardManager) {
      clipboardManager.clearAll();
    }
  });

  ipcMain.handle(ClipboardIPCChannels.CAPTURE_SCREENSHOT, async (_event, region?: boolean) => {
    if (!clipboardManager) {
      return -1;
    }
    const id = await clipboardManager.captureScreenshot({ region: region || false });
    if (id > 0) {
      routeCapturedItemToActiveSession(id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
    }
    return id;
  });

  ipcMain.handle(ClipboardIPCChannels.GET_CLIPBOARD_IMAGE_PATH, async (): Promise<string | null> => {
    if (!clipboardManager) {
      return null;
    }
    return clipboardManager.exportCurrentClipboardImageToCache();
  });

  ipcMain.handle(ClipboardIPCChannels.EXPORT_ITEM_IMAGE_PATH, async (_event, id: number): Promise<string | null> => {
    if (!clipboardManager) {
      return null;
    }
    const item = clipboardManager.getItem(id);
    if (!item) {
      return null;
    }
    return clipboardManager.exportImageToCache(item);
  });

  ipcMain.handle(ClipboardIPCChannels.SAVE_SKETCH, async (_event, imageData: string, width: number, height: number) => {
    if (!clipboardManager) {
      return -1;
    }
    
    try {
      // Convert base64 to Buffer
      const imageBuffer = Buffer.from(imageData, 'base64');
      
      // Create NativeImage from buffer
      const { nativeImage } = require('electron');
      const image = nativeImage.createFromBuffer(imageBuffer);
      
      if (image.isEmpty()) {
        return -1;
      }
      
      // Store in clipboard history as screenshot type
      const id = await clipboardManager.storeImage(
        image,
        imageBuffer,
        'screenshot',
        undefined, // No source app for sketches
        undefined, // No stack ID
        'mac' // Source is Mac
      );
      
      // Notify listeners
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });

      // Track sketch creation
      metricsManager?.recordSketchCreated();

      return id;
    } catch (error) {
      log.error('Failed to save sketch:', error);
      return -1;
    }
  });

  ipcMain.handle(ClipboardIPCChannels.GET_HOTKEYS, async () => {
    if (!clipboardManager) {
      return {
        screenshot: 'Command+4',
        history: 'Alt+Space',
      };
    }
    return clipboardManager.getHotkeys();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_HOTKEYS, async (_event, hotkeys: { screenshot?: string; fullScreen?: string; activeWindow?: string; history?: string }) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }

    let success = true;
    const prefsToSave: { clipboardScreenshotHotkey?: string; clipboardFullScreenHotkey?: string; clipboardActiveWindowHotkey?: string; clipboardHistoryHotkey?: string } = {};

    if (hotkeys.screenshot !== undefined) {
      if (typeof hotkeys.screenshot !== 'string') {
        return false;
      }
      // Empty string clears the hotkey
      const result = clipboardManager.setScreenshotHotkey(hotkeys.screenshot);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardScreenshotHotkey = hotkeys.screenshot;
      }
    }

    if (hotkeys.fullScreen !== undefined) {
      if (typeof hotkeys.fullScreen !== 'string') {
        return false;
      }
      // Empty string clears the hotkey
      const result = clipboardManager.setFullScreenHotkey(hotkeys.fullScreen);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardFullScreenHotkey = hotkeys.fullScreen;
      }
    }

    if (hotkeys.activeWindow !== undefined) {
      if (typeof hotkeys.activeWindow !== 'string') {
        return false;
      }
      // Empty string clears the hotkey
      const result = clipboardManager.setActiveWindowHotkey(hotkeys.activeWindow);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardActiveWindowHotkey = hotkeys.activeWindow;
      }
    }

    if (hotkeys.history !== undefined) {
      if (typeof hotkeys.history !== 'string' || hotkeys.history.trim() === '') {
        return false;
      }
      const result = clipboardManager.setHistoryHotkey(hotkeys.history);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardHistoryHotkey = hotkeys.history;
      }
    }

    // Save hotkeys to preferences
    if (Object.keys(prefsToSave).length > 0) {
      await preferencesManager.save(prefsToSave);
    }

    // Update tray manager if any displayed hotkey changed
    if (trayManager && transcriberManager && (hotkeys.history !== undefined || hotkeys.screenshot !== undefined)) {
      const currentHotkeys = clipboardManager.getHotkeys();
      const historyHotkey = hotkeys.history || currentHotkeys.history || 'Option+Space';
      const transcriptionHotkey = transcriberManager.getHotkey() || 'Option+Shift+Space';
      const screenshotHotkey = hotkeys.screenshot || currentHotkeys.screenshot || 'Command+4';
      trayManager.setHotkeys(historyHotkey, transcriptionHotkey, screenshotHotkey);
    }

    return success;
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_ITEM, async (_event, id: number, targetBundleId?: string, useImproved?: boolean) => {
    try {
      if (!clipboardManager) {
        return;
      }
      const item = clipboardManager.getItem(id);
      if (!item) {
        return;
      }

      // Determine the target bundle ID for terminal detection
      let effectiveBundleId: string | null = targetBundleId || null;
      if (!effectiveBundleId && clipboardHistoryWindow) {
        const targetApp = clipboardHistoryWindow.getTargetApp() ?? clipboardHistoryWindow.getPreviousApp();
        effectiveBundleId = targetApp?.bundleId || null;
      }

      // Skip pasting to Finder - it doesn't handle Cmd+V well and causes stalls
      if (isFinder(effectiveBundleId)) {
        log.info('pasteItem: skipping paste to Finder');
        if (clipboardHistoryWindow) {
          clipboardHistoryWindow.hideAfterPaste('paste-item-finder-skip');
        }
        return;
      }

      // Check if target needs file paths instead of image buffers.
      const shouldPasteImageAsPath = isTerminalApp(effectiveBundleId) || isIDEWithTerminal(effectiveBundleId);

      // Put content on clipboard first.
      // Use optimized hash methods to avoid expensive clipboard reads after write.
      if (item.type === 'text' || item.type === 'transcript') {
        // Use improved content based on explicit parameter, or fall back to item's stored preference.
        const shouldUseImproved = useImproved !== undefined ? useImproved : item.useImprovedVersion;
        let textContent = (shouldUseImproved && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');

        // If this item belongs to a stack, append the figure list
        if (item.stackId) {
          const stackItems = clipboardManager.queryItemsByStackId(item.stackId);
          const hasFigures = stackItems.some(i => i.imageData && i.figureLabel);

          if (hasFigures) {
            // Build figure list with real paths (for terminal compatibility)
            const figurePaths: string[] = [];
            for (const stackItem of stackItems) {
              if (stackItem.imageData && stackItem.figureLabel) {
                const imagePath = await clipboardManager.exportImageToCache(stackItem);
                if (imagePath) {
                  // Use real path for terminal compatibility
                  figurePaths.push(`figure ${stackItem.figureLabel}: \`${imagePath.replace(os.homedir(), '~')}\``);
                }
              }
            }

            if (figurePaths.length > 0) {
              textContent = `${textContent}\n\n${figurePaths.join('\n')}\n\n`;
            }
          }
        }

        clipboard.writeText(textContent);
        // Set hash directly from the text we just wrote (avoids clipboard read)
        clipboardManager.setClipboardHashFromText(textContent);
      } else if (item.imageData) {
        if (shouldPasteImageAsPath) {
          // For terminal-like targets: export image to file and put path on clipboard.
          const imagePath = await clipboardManager.exportImageToCache(item);
          if (imagePath) {
            // Use real path for terminal compatibility
            const shortPath = imagePath.replace(os.homedir(), '~');
            const figureRef = item.figureLabel
              ? `figure ${item.figureLabel}: \`${shortPath}\``
              : `\`${shortPath}\``;
            const figureRefWithSpace = `${figureRef} `;
            clipboard.writeText(figureRefWithSpace);
            // Set hash from exact clipboard payload to avoid self-capture churn.
            clipboardManager.setClipboardHashFromText(figureRefWithSpace);
          } else {
            log.error('Failed to export image for terminal paste');
            return;
          }
        } else {
          // For non-terminals: put image buffer on clipboard as before
          const { nativeImage } = require('electron');
          const imageBuffer = typeof item.imageData === 'string'
            ? Buffer.from(item.imageData, 'base64')
            : item.imageData;
          const image = nativeImage.createFromBuffer(imageBuffer);
          clipboard.writeImage(image);
          // Set hash directly from the buffer we just wrote (avoids expensive toPNG() call)
          clipboardManager.setClipboardHashFromBuffer(imageBuffer);
        }
      }

      // Dismiss panel mode before paste; app mode stays visible.
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.hideAfterPaste('paste-item');
      }

      // If a specific target app was provided, activate it and paste there.
      // Otherwise, use the default behavior (paste to previous app).
      if (targetBundleId && clipboardHistoryWindow) {
        await clipboardHistoryWindow.pasteToApp(targetBundleId);
      } else if (effectiveBundleId && clipboardHistoryWindow) {
        await clipboardHistoryWindow.pasteToApp(effectiveBundleId);
      } else {
        // Last-resort paste when no known target app is available.
        try {
          await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
        } catch { /* Silently fail if paste times out */ }
      }

      // Record paste metric
      metricsManager?.recordPaste();
    } catch (error) {
      log.error('pasteItem error:', error);
    }
  });

  // Copy item to clipboard without pasting.
  ipcMain.handle(ClipboardIPCChannels.COPY_ITEM, async (_event, id: number, useImproved?: boolean) => {
    try {
      if (!clipboardManager) {
        return;
      }
      const item = clipboardManager.getItem(id);
      if (!item) {
        return;
      }

      // Put content on clipboard.
      if (item.type === 'text' || item.type === 'transcript') {
        // Use improved content based on explicit parameter, or fall back to item's stored preference.
        const shouldUseImproved = useImproved !== undefined ? useImproved : item.useImprovedVersion;
        const textContent = (shouldUseImproved && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');
        clipboard.writeText(textContent);
      } else if (item.imageData) {
        const { nativeImage } = require('electron');
        const imageBuffer = typeof item.imageData === 'string' 
          ? Buffer.from(item.imageData, 'base64')
          : item.imageData;
        const image = nativeImage.createFromBuffer(imageBuffer);
        clipboard.writeImage(image);
      }
      
      clipboardManager.syncClipboardHash();
    } catch (error) {
      log.error('copyItem error:', error);
    }
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_STACK, async (_event, ids: number[], targetBundleId?: string) => {
    try {
      if (!clipboardManager) {
        return;
      }
      if (!ids || ids.length === 0) {
        return;
      }

      // Get all items from IDs
      const items = ids
        .map(id => clipboardManager!.getItem(id))
        .filter((item): item is ClipboardItem => item !== null);

      if (items.length === 0) {
        return;
      }

      // Use explicit target from renderer if provided, otherwise fall back to window state.
      let effectiveBundleId: string | null = targetBundleId || null;
      if (!effectiveBundleId && clipboardHistoryWindow) {
        const targetApp = clipboardHistoryWindow.getTargetApp() ?? clipboardHistoryWindow.getPreviousApp();
        effectiveBundleId = targetApp?.bundleId || null;
      }

      // Dismiss panel mode before paste; app mode stays visible.
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.hideAfterPaste('paste-stack');
      }
      
      const { nativeImage } = require('electron');

      // Detect target app to check for terminal path pastes or Finder.
      let frontmostBundleId: string | null = effectiveBundleId;
      let isTerminal = false;
      let isIDE = false;
      let pasteImagesAsPaths = false;
      if (frontmostBundleId) {
        isTerminal = isTerminalApp(frontmostBundleId);
        isIDE = isIDEWithTerminal(frontmostBundleId);
        pasteImagesAsPaths = isTerminal || isIDE;
      } else {
        try {
          const { stdout } = await execWithTimeout(
            'osascript -e \'tell application "System Events" to get bundle identifier of first process whose frontmost is true\'',
            3000
          );
          frontmostBundleId = stdout.trim();
          isTerminal = isTerminalApp(frontmostBundleId);
          isIDE = isIDEWithTerminal(frontmostBundleId);
          pasteImagesAsPaths = isTerminal || isIDE;
        } catch {
          // Default to non-terminal if detection fails or times out
        }
      }

      const orderedItems = orderStackItemsForPaste(items, frontmostBundleId);

      if (frontmostBundleId && clipboardHistoryWindow && !isFinder(frontmostBundleId)) {
        await clipboardHistoryWindow.activateApp(frontmostBundleId);
        // Give macOS a short moment to settle focus before synthetic paste events.
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Skip pasting to Finder - it doesn't handle Cmd+V well
      if (isFinder(frontmostBundleId)) {
        log.info('pasteStack: skipping paste to Finder');
        return;
      }

      // Check if we have images with figure labels (for building figure paths).
      const imageItems = items.filter(i => i.imageData && i.figureLabel);
      const hasTranscriptWithFigures = 
        items.some(i => i.type === 'text' || i.type === 'transcript') && 
        imageItems.length > 0;
      
      // Count images we'll actually paste (for non-terminals).
      const imagesToPaste = pasteImagesAsPaths
        ? 0 
        : items.filter(i => i.imageData).length;
      
      // Show warning for more than 10 images being pasted to multimodal apps.
      if (imagesToPaste > 10 && cursorStatusManager) {
        cursorStatusManager.showCriticalMessage(MESSAGES.critical.pastingManyImages);
      }

      // Build figure paths for text content if we have multiple items.
      const buildFigurePaths = async (): Promise<string> => {
        const paths: string[] = [];
        for (const item of imageItems) {
          const imagePath = await clipboardManager!.exportImageToCache(item);
          if (imagePath) {
            // Use real path for terminal compatibility
            paths.push(`figure ${item.figureLabel}: \`${imagePath.replace(os.homedir(), '~')}\``);
          }
        }
        return paths.length > 0 ? `\n\n${paths.join('\n')}\n\n` : '';
      };
      
      // Adaptive delay for image pastes: give apps more time when pasting many images.
      // Base delay is 100ms, scales up to 400ms for large batches.
      const getImagePasteDelay = (imageCount: number): number => {
        if (imageCount <= 5) return 100;
        if (imageCount <= 10) return 150;
        if (imageCount <= 20) return 250;
        return 400;
      };
      const imagePasteDelay = getImagePasteDelay(imagesToPaste);

      // Paste each item sequentially with delays.
      for (const item of orderedItems) {
        try {
          if (item.type === 'text' || item.type === 'transcript') {
            // Use improved content if available and toggle is set.
            let textContent = (item.useImprovedVersion && item.improvedContent)
              ? item.improvedContent
              : (item.content || '');
            
            // Terminal-like targets get text file references instead of raw image pastes.
            if (items.length > 1 && pasteImagesAsPaths) {
              textContent += await buildFigurePaths();
            }
            
            clipboard.writeText(textContent);
            clipboardManager.syncClipboardHash();
            try {
              await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
            } catch { /* Silently fail if paste times out (e.g., Finder) */ }
            await new Promise(resolve => setTimeout(resolve, 100));
          } else if (item.imageData) {
            // For terminal-like targets with transcript+figures, skip individual image paste.
            // Users will use the file paths from the Figures section.
            if (pasteImagesAsPaths && hasTranscriptWithFigures) {
              continue;
            }
            
            if (pasteImagesAsPaths) {
              // Terminal-like target without transcript: paste file path instead of image.
              const imagePath = await clipboardManager!.exportImageToCache(item);
              if (imagePath) {
                // Use real path for terminal compatibility
                clipboard.writeText(`${imagePath} `);
                clipboardManager.syncClipboardHash();
                try {
                  await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
                } catch { /* Silently fail if paste times out */ }
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            } else {
              // Non-terminal: paste actual image (multimodal apps can render it).
              const imageBuffer = typeof item.imageData === 'string'
                ? Buffer.from(item.imageData, 'base64')
                : item.imageData;
              const image = nativeImage.createFromBuffer(imageBuffer);
              clipboard.writeImage(image);
              // Set hash directly from the buffer (avoids expensive toPNG() call)
              clipboardManager.setClipboardHashFromBuffer(imageBuffer);
              try {
                await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
              } catch { /* Silently fail if paste times out */ }
              // Use adaptive delay for images to prevent overwhelming target apps.
              await new Promise(resolve => setTimeout(resolve, imagePasteDelay));
            }
          }
        } catch (itemError) {
          log.error('pasteStack: failed to paste item', item.id, itemError);
          // Continue with next item even if this one fails
        }
      }

      // Record stack paste metrics
      metricsManager?.recordStackPasted(items.length);
    } catch (error) {
      log.error('pasteStack error:', error);
    }
  });

  // Paste arbitrary text (used for pasting improved prompts)
  ipcMain.handle(ClipboardIPCChannels.PASTE_TEXT, async (_event, text: string, targetBundleId?: string) => {
    try {
      if (!text) {
        return;
      }
      
      // Put text on clipboard first
      clipboard.writeText(text);
      
      if (clipboardManager) clipboardManager.syncClipboardHash();
      
      let effectiveBundleId: string | null = targetBundleId || null;
      if (!effectiveBundleId && clipboardHistoryWindow) {
        const targetApp = clipboardHistoryWindow.getTargetApp() ?? clipboardHistoryWindow.getPreviousApp();
        effectiveBundleId = targetApp?.bundleId || null;
      }

      if (isFinder(effectiveBundleId)) {
        log.info('pasteText: skipping paste to Finder');
        if (clipboardHistoryWindow) {
          clipboardHistoryWindow.hideAfterPaste('paste-text-finder-skip');
        }
        return;
      }

      // Dismiss panel mode before paste; app mode stays visible.
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.hideAfterPaste('paste-text');
      }
      
      // If a specific target app was provided, activate it and paste there
      if (targetBundleId && clipboardHistoryWindow) {
        await clipboardHistoryWindow.pasteToApp(targetBundleId);
      } else if (effectiveBundleId && clipboardHistoryWindow) {
        await clipboardHistoryWindow.pasteToApp(effectiveBundleId);
      } else {
        // Last-resort paste when no known target app is available.
        // Use timeout to prevent hang if target app is unresponsive.
        try {
          await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
        } catch { /* Silently fail if paste times out */ }
      }
    } catch (error) {
      log.error('pasteText error:', error);
    }
  });

  ipcMain.handle(ClipboardIPCChannels.SEPARATE_INTO_TASKS, async (_event, id: number) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.separateIntoTasks(id);
  });

  // Save bounds handler - receives absolute screen coordinates directly.
  // Called on window hide or explicit save. Persists under the currently-
  // active size key so each view remembers its own dims.
  ipcMain.handle(ClipboardIPCChannels.SAVE_BOUNDS, async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    const key = clipboardHistoryWindow?.getCurrentSizeKey() ?? 'fields';
    await saveClipboardHistoryBoundsForKey(bounds, key);
  });

  // Target app management handlers.
  ipcMain.handle(ClipboardIPCChannels.GET_TARGET_APP, async () => {
    if (!clipboardHistoryWindow) {
      return null;
    }
    return clipboardHistoryWindow.getTargetApp();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_TARGET_APP, async (_event, app: { bundleId: string; name: string } | null) => {
    if (!clipboardHistoryWindow) {
      return;
    }
    clipboardHistoryWindow.setTargetApp(app);
  });

  ipcMain.handle(ClipboardIPCChannels.GET_RUNNING_APPS, async () => {
    if (!clipboardHistoryWindow) {
      return [];
    }
    // Return cached apps (already fetched when window was shown).
    return clipboardHistoryWindow.getCachedRunningApps();
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_TO_APP, async (_event, bundleId: string) => {
    if (!clipboardHistoryWindow) {
      return false;
    }

    // Skip pasting to Finder - it doesn't handle Cmd+V well and causes stalls
    if (isFinder(bundleId)) {
      log.info('pasteToApp: skipping paste to Finder');
      clipboardHistoryWindow.hideAfterPaste('paste-to-app-finder-skip');
      return false;
    }

    // Dismiss panel mode before paste; app mode stays visible.
    clipboardHistoryWindow.hideAfterPaste('paste-to-app');

    // Paste to the target app.
    return clipboardHistoryWindow.pasteToApp(bundleId);
  });

  ipcMain.on('clipboard:closeWindow', async () => {
    // Avoid app.hide() here: that compositor path can destabilize transparent
    // overlay corners. Hide only the window, then explicitly restore focus.
    if (clipboardHistoryWindow) {
      await clipboardHistoryWindow.hideAndRestorePreviousApp('ipc-close-window');
    }
  });

  // Toggle Developer Tools for debugging (secret shortcut: Cmd+Shift+I)
  ipcMain.on('electron:toggleDevTools', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.webContents.toggleDevTools();
    }
  });

  // Relaunch the app
  ipcMain.on('electron:relaunch', () => {
    // Close all windows first
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });
    app.relaunch();
    app.exit(0);
  });
  
  // Show "no target" error at cursor position (replaces old toast window).
  ipcMain.on('clipboard:showNoTargetError', async (_event, message?: string) => {
    if (cursorStatusManager) {
      cursorStatusManager.showNoTargetError(message);
    }
  });
  
  ipcMain.on('clipboard:setSketchMode', async (_event, active: boolean) => {
    clipboardHistoryWindow?.setSketchModeActive(active);
  });

  // Immersive mode for Librarian - when active, window should not auto-hide on blur
  ipcMain.on('clipboard-history:setImmersiveMode', async (_event, immersive: boolean) => {
    clipboardHistoryWindow?.setImmersiveMode(immersive);
  });

  // Some immersive content (bookmarks canvas) opts in to dismiss-on-blur,
  // while artifact reading keeps the current stay-put behavior.
  ipcMain.on('clipboard-history:setImmersiveDismissable', async (_event, dismissable: boolean) => {
    clipboardHistoryWindow?.setImmersiveDismissableOnBlur(dismissable);
  });

  // Renderer reports the currently-active "size profile" (fields, library,
  // canvas, draw). Main animates to the saved bounds for that profile and
  // subsequent user resizes persist under that key.
  ipcMain.on('clipboard-history:setSizeKey', (_event, key: string) => {
    if (!isClipboardHistorySizeKey(key)) return;
    clipboardHistoryWindow?.setSizeKey(key);
  });

  // Stack operations for prompt stacking feature
  ipcMain.handle(ClipboardIPCChannels.QUERY_ITEMS_BY_STACK, async (_event, stackId: string) => {
    if (!clipboardManager) {
      return [];
    }
    const items = clipboardManager.queryItemsByStackId(stackId);
    return items.map(item => ({
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
      thumbnailData: item.thumbnailData ? item.thumbnailData.toString('base64') : null,
    }));
  });

  ipcMain.handle(ClipboardIPCChannels.GET_UNIQUE_STACKS, async () => {
    if (!clipboardManager) {
      return [];
    }
    return clipboardManager.getUniqueStacks();
  });

  // Note: getAllTimeStats and INCREMENT_IMPROVED_COUNT removed - stats now tracked by MetricsManager

  ipcMain.handle(ClipboardIPCChannels.UPDATE_STACK_ID, async (_event, itemIds: number[], stackId: string | null) => {
    try {
      if (!clipboardManager) {
        return;
      }
      // Check if this creates a new stack (for metrics)
      const isNewStack = stackId !== null && clipboardManager.queryItemsByStackId(stackId).length === 0;

      clipboardManager.updateStackId(itemIds, stackId);

      // Record manual stack creation metric
      if (isNewStack) {
        metricsManager?.recordStackCreated();
      }
    } catch (error) {
      log.error('updateStackId error:', error);
    }
  });

  // Track temp files for cleanup
  const dragTempFiles: string[] = [];

  ipcMain.handle(ClipboardIPCChannels.START_DRAG, async (event, stackId: string) => {
    try {
      if (!clipboardManager) {
        return;
      }

      const items = clipboardManager.queryItemsByStackId(stackId);
      if (items.length === 0) {
        return;
      }

      const fs = await import('fs');
      const tempFiles: string[] = [];

      // Collect text content and write images to temp files
      let combinedText = '';
      for (const item of items) {
        if (item.imageData) {
          try {
            const tempPath = path.join(app.getPath('temp'), `drag-${item.id}-${Date.now()}.png`);
            fs.writeFileSync(tempPath, item.imageData);
            tempFiles.push(tempPath);
            dragTempFiles.push(tempPath); // Track for cleanup
          } catch (writeError) {
            log.error('startDrag: failed to write temp image', item.id, writeError);
          }
        }
        if (item.content) {
          combinedText += (combinedText ? '\n\n' : '') + item.content;
        }
      }

      // If no images but we have text, create a temp text file
      if (tempFiles.length === 0 && combinedText) {
        try {
          const textTempPath = path.join(app.getPath('temp'), `drag-text-${Date.now()}.txt`);
          fs.writeFileSync(textTempPath, combinedText);
          tempFiles.push(textTempPath);
          dragTempFiles.push(textTempPath);
        } catch (writeError) {
          log.error('startDrag: failed to write temp text file', writeError);
        }
      }

      // If we have files to drag, initiate native drag
      if (tempFiles.length > 0) {
        event.sender.startDrag({
          file: tempFiles[0], // Primary file (required by Electron API)
          files: tempFiles,   // All files for multi-file drag
          icon: tempFiles[0], // Use first image as icon
        });
      }
    } catch (error) {
      log.error('startDrag error:', error);
    }
  });

  // =========================================================================
  // Improved Content Management - Save/clear improved versions of transcriptions
  // =========================================================================

  // Save improved content for a specific item.
  ipcMain.handle(ClipboardIPCChannels.SAVE_IMPROVED_CONTENT, async (_event, itemId: number, improvedContent: string) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }
      clipboardManager.saveImprovedContent(itemId, improvedContent);
      return { success: true };
    } catch (error) {
      log.error('saveImprovedContent error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save improved content',
      };
    }
  });

  // Clear improved content for a specific item (revert to original only).
  ipcMain.handle(ClipboardIPCChannels.CLEAR_IMPROVED_CONTENT, async (_event, itemId: number) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }
      clipboardManager.clearImprovedContent(itemId);
      return { success: true };
    } catch (error) {
      log.error('clearImprovedContent error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear improved content',
      };
    }
  });

  // Toggle between improved and original text for an item.
  ipcMain.handle(ClipboardIPCChannels.SET_USE_IMPROVED_VERSION, async (_event, itemId: number, useImproved: boolean) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }
      clipboardManager.setUseImprovedVersion(itemId, useImproved);
      return { success: true };
    } catch (error) {
      log.error('setUseImprovedVersion error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set use improved version',
      };
    }
  });

  // Clean up temp files and hotkeys on app quit
  app.on('will-quit', () => {
    // Unregister all hotkeys via HotkeyManager
    const hotkeyManager = getHotkeyManager();
    hotkeyManager.unregisterAll();

    // Unregister Squares window management hotkeys.
    squaresManager?.unregisterHotkeys();

    // Clean up LibrarianManager (stop file watchers, close database)
    librarianManager?.destroy();

    // Clean up TaggedDocsManager (stop file watcher, close database)
    taggedDocsManager?.destroy();

    // Clean up TranscriberManager (stop persistent runtimes, unregister hotkeys)
    transcriberManager?.destroy();

    const fs = require('fs');
    for (const tempFile of dragTempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors - files will be cleaned by OS eventually
      }
    }
  });

  // =========================================================================
  // Mobile Sync IPC Handlers - Sync iOS transcriptions to clipboard history
  // =========================================================================

  ipcMain.handle(ClipboardIPCChannels.SET_SYNC_SESSION, async (_event, accessToken: string, refreshToken: string) => {
    if (!authManager) {
      return false;
    }
    await authManager.setSession(accessToken, refreshToken);
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.CLEAR_SYNC_SESSION, async () => {
    if (authManager) {
      authManager.clearSession();
    }
    return true;
  });

  // Get session from main process for recovery when renderer localStorage is cleared.
  // This allows the renderer to recover auth state without re-login.
  ipcMain.handle(ClipboardIPCChannels.GET_SYNC_SESSION, async () => {
    if (!authManager) {
      return null;
    }
    const session = authManager.getSession();
    if (!session) {
      return null;
    }
    // Only return tokens if session is not expired.
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at <= now) {
      return null;
    }
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      user: session.user ? {
        id: session.user.id,
        email: session.user.email,
      } : null,
    };
  });

  // =========================================================================
  // Password Authentication IPC Handlers
  // =========================================================================

  ipcMain.handle('auth:signUp', async (_event, email: string, password: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.signUp(email, password);
  });

  ipcMain.handle('auth:signInWithPassword', async (_event, email: string, password: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized', session: null };
    }
    return await authManager.signInWithPassword(email, password);
  });

  ipcMain.handle('auth:prepareForNewLogin', async () => {
    authManager?.prepareForNewLogin();
  });

  ipcMain.handle('auth:requestOtp', async (_event, email: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.requestOtp(email);
  });

  ipcMain.handle('auth:verifyOtp', async (_event, email: string, token: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized', session: null };
    }
    const result = await authManager.verifyOtp(email, token);

    // Sync quota data after login
    if (result.session && quotaManager) {
      await quotaManager.reload();
    }

    return result;
  });

  ipcMain.handle('auth:resetPasswordForEmail', async (_event, email: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.resetPasswordForEmail(email);
  });

  ipcMain.handle('auth:updatePassword', async (_event, newPassword: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.updatePassword(newPassword);
  });

  ipcMain.handle('auth:updateFullName', async (_event, fullName: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.updateFullName(fullName);
  });

  ipcMain.handle('auth:setSessionFromUrl', async (_event, accessToken: string, refreshToken: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized', session: null };
    }
    return await authManager.setSessionFromUrl(accessToken, refreshToken);
  });

  ipcMain.handle('auth:signOut', async () => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    const result = await authManager.signOut();

    if (!result.error) {
      // Clear cached quota data on logout so quotas show free limits.
      if (quotaManager) {
        quotaManager.clearCache();
      }

      // Reset onboarding state so user sees login screen on next open.
      if (preferencesManager) {
        await preferencesManager.save({
          onboardingComplete: false,
          onboardingStep: undefined,
        });
      }

      // Unregister all hotkeys - they shouldn't work while signed out.
      getHotkeyManager().unregisterAll();

      // Refresh tray menu to show onboarding-only options.
      if (trayManager) {
        trayManager.refreshMenu();
      }

      // Reset renderer tier state on sign-out.
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('tier:changed', 'free');
        }
      });

      // Hide other windows and show onboarding window for re-login.
      clipboardHistoryWindow?.hide(true);
      mainWindow?.hide();
      if (!onboardingWindow) {
        onboardingWindow = createOnboardingWindow();
      }
      onboardingWindow.show(OnboardingStep.ACCOUNT);
    }

    return result;
  });

  ipcMain.handle('auth:deleteAccount', async () => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }

    const session = authManager.getSession();
    if (!session?.access_token) {
      return { error: 'Not authenticated' };
    }

    const envVars = loadEnvVars();
    if (!envVars.supabaseUrl) {
      return { error: 'Supabase not configured' };
    }

    const edgeFunctionUrl = `${envVars.supabaseUrl}/functions/v1/delete-account`;

    try {
      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json() as { error?: string; success?: boolean };

      if (!response.ok) {
        log.error('Delete account failed:', result);
        return { error: result.error || 'Failed to delete account' };
      }

      await authManager.signOut();
      if (quotaManager) {
        quotaManager.clearCache();
      }

      // Reset onboarding state so user sees login screen on next open.
      if (preferencesManager) {
        await preferencesManager.save({
          onboardingComplete: false,
          onboardingStep: undefined,
        });
      }

      // Unregister all hotkeys - they shouldn't work while signed out.
      getHotkeyManager().unregisterAll();

      // Refresh tray menu to show onboarding-only options.
      if (trayManager) {
        trayManager.refreshMenu();
      }

      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('tier:changed', 'free');
        }
      });

      // Hide clipboard history and show onboarding window.
      clipboardHistoryWindow?.hide(true);
      if (onboardingWindow) {
        onboardingWindow.show(); // show() handles focus internally
      }

      return { error: null };
    } catch (err) {
      log.error('Delete account error:', err);
      return { error: 'Failed to connect to server' };
    }
  });

  ipcMain.handle('auth:getSession', async () => {
    if (!authManager) {
      return null;
    }
    return authManager.getSession();
  });

  ipcMain.handle('auth:isSuperAdmin', (): boolean => {
    return authManager?.isSuperAdmin() ?? false;
  });

  // Open external URL in default browser (for Stripe checkout, etc).
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    const allowed = /^https?:|^mailto:|^x-apple\.systempreferences:/i;
    if (!allowed.test(url)) {
      log.warn('shell:openExternal blocked non-http URL: %s', url);
      return;
    }
    await shell.openExternal(url);
  });

  // Reveal file in Finder (macOS).
  ipcMain.handle('shell:showItemInFolder', async (_event, fullPath: string) => {
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        await shell.openPath(fullPath);
        return;
      }
    } catch {
      // Fall through to the existing reveal behavior.
    }
    shell.showItemInFolder(fullPath);
  });

  // macOS proxy-icon / Cmd-click title menu. Empty string clears.
  ipcMain.handle('shell:setRepresentedFilename', (event, fullPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setRepresentedFilename(fullPath || '');
  });

  ipcMain.handle('agent-improve:launch', async (_event, request: AgentImproveLaunchRequest) => {
    return launchAgentImproveInTerminal(request);
  });

  // =========================================================================
  // Generic Hotkey IPC Handlers (for UI-configurable hotkeys)
  // =========================================================================

  // Preference key mapping for each hotkey ID
  const hotkeyPreferenceKeys: Record<string, string> = {
    superPaste: 'superPasteHotkey',
    commandLauncher: 'commandLauncherHotkey',
    scratchpad: 'scratchpadHotkey',
  };

  // Default values for each hotkey
  const hotkeyDefaults: Record<string, string> = {
    superPaste: 'Command+Shift+V',
    commandLauncher: 'Command+Shift+K',
    scratchpad: 'Control+Option+Command+Space',
  };

  ipcMain.handle('hotkey:get', async (_event, id: string) => {
    if (!preferencesManager || !hotkeyPreferenceKeys[id]) {
      return hotkeyDefaults[id] || null;
    }
    const prefs = await preferencesManager.load();
    const prefKey = hotkeyPreferenceKeys[id];
    return ((prefs as any)[prefKey] as string) || hotkeyDefaults[id] || null;
  });

  ipcMain.handle('hotkey:set', async (_event, id: string, key: string) => {
    if (!preferencesManager || !hotkeyPreferenceKeys[id]) {
      return { success: false, error: 'Invalid hotkey ID' };
    }

    const hotkeyManager = getHotkeyManager();
    const result = hotkeyManager.change(id as any, key);

    if (result.success) {
      const prefKey = hotkeyPreferenceKeys[id];
      await preferencesManager.save({ [prefKey]: key });
      return { success: true };
    }

    return { success: false, error: result.error };
  });

  ipcMain.handle('hotkey:getAll', async () => {
    if (!preferencesManager) {
      return hotkeyDefaults;
    }
    const prefs = await preferencesManager.load();
    const result: Record<string, string | null> = {};
    for (const [id, prefKey] of Object.entries(hotkeyPreferenceKeys)) {
      result[id] = ((prefs as any)[prefKey] as string) || hotkeyDefaults[id] || null;
    }
    return result;
  });

  // Diagnostic handler to check hotkey registration state
  ipcMain.handle('hotkey:diagnose', async () => {
    const hotkeyManager = getHotkeyManager();
    const testKeys = ['Alt+4', 'Alt+3', 'Alt+Space', 'Command+4', 'Shift+Alt+4'];
    const results: Record<string, any> = {};

    for (const key of testKeys) {
      results[key] = {
        isRegisteredWithOS: globalShortcut.isRegistered(key),
      };
    }

    // Get all registered hotkeys from our manager
    const registered = hotkeyManager.getAll();
    results.registeredHotkeys = Object.fromEntries(registered);

    // Check clipboard manager state
    if (clipboardManager) {
      results.clipboardConfig = clipboardManager.getHotkeys();
    }

    log.info('Hotkey diagnostic:', JSON.stringify(results, null, 2));
    return results;
  });

  // Hotkey conflict detection - test if a hotkey is working
  ipcMain.handle('hotkey:test', async (_event, key: string, timeoutMs?: number) => {
    const hotkeyManager = getHotkeyManager();
    const result = await hotkeyManager.testHotkey(key, timeoutMs || 3000);

    // If registration succeeded, the hotkey is working (we own it)
    // Only check for conflict apps if registration actually FAILED
    let conflictApp: string | undefined;
    if (!result.success) {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      try {
        const { stdout } = await execAsync('ps aux');
        const normalizedKey = hotkeyManager.normalizeKeyPublic(key);

        for (const app of KNOWN_CONFLICT_APPS) {
          const isRunning = app.processNames.some(name => stdout.includes(name));
          const mightConflict = app.defaultConflicts.some(k =>
            hotkeyManager.normalizeKeyPublic(k) === normalizedKey
          );
          // Flag if app is running AND (its known to conflict with this key OR it has no specific conflicts listed)
          if (isRunning && (mightConflict || app.defaultConflicts.length === 0)) {
            conflictApp = app.name;
            break;
          }
        }
      } catch {
        // Ignore errors checking running processes
      }
    }

    return {
      key,
      // If registration succeeded, the hotkey is working
      status: result.success ? 'working' : 'conflict',
      callbackFired: result.callbackFired,
      conflictApp,
      error: result.error,
    };
  });

  // Get list of running apps that commonly capture hotkeys
  ipcMain.handle('hotkey:getRunningConflictApps', async () => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync('ps aux');
      return KNOWN_CONFLICT_APPS
        .filter(app => app.processNames.some(name => stdout.includes(name)))
        .map(app => app.name);
    } catch {
      return [];
    }
  });

  // =========================================================================
  // Continuous Context Mode IPC Handlers
  // =========================================================================

  ipcMain.handle(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_STATE, async () => {
    if (!clipboardManager) {
      return { active: false, stackId: null, screenshotCount: 0 };
    }
    return clipboardManager.getContinuousContextState();
  });

  ipcMain.handle(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_ENABLED, async () => {
    if (!clipboardManager) {
      return false;
    }
    return clipboardManager.isContinuousContextEnabled();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_CONTINUOUS_CONTEXT_ENABLED, async (_event, enabled: boolean) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }
    clipboardManager.setContinuousContextEnabled(enabled);
    await preferencesManager.save({ continuousContextEnabled: enabled });
    
    // Register/unregister the hotkey callback when enabling/disabling
    if (enabled) {
      clipboardManager.registerContinuousContextHotkey(async () => {
        if (!clipboardManager) return;
        
        const state = clipboardManager.getContinuousContextState();
        if (state.active) {
          // If already active, stop it
          clipboardManager.stopContinuousContext();
        } else {
          // Start continuous context mode
          await clipboardManager.startContinuousContext();
        }
      });
    }
    
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_HOTKEY, async () => {
    if (!clipboardManager) {
      return 'Shift+Command+4';
    }
    return clipboardManager.getContinuousContextHotkey();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_CONTINUOUS_CONTEXT_HOTKEY, async (_event, hotkey: string) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }
    const success = clipboardManager.setContinuousContextHotkey(hotkey);
    if (success) {
      await preferencesManager.save({ continuousContextHotkey: hotkey });
      
      // Re-register the hotkey with the callback if continuous context is enabled
      if (clipboardManager.isContinuousContextEnabled()) {
        clipboardManager.registerContinuousContextHotkey(async () => {
          if (!clipboardManager) return;
          
          const state = clipboardManager.getContinuousContextState();
          if (state.active) {
            // If already active, stop it
            clipboardManager.stopContinuousContext();
          } else {
            // Start continuous context mode
            await clipboardManager.startContinuousContext();
          }
        });
      }
    }
    return success;
  });

  ipcMain.handle(ClipboardIPCChannels.START_CONTINUOUS_CONTEXT, async () => {
    if (!clipboardManager) {
      return;
    }
    await clipboardManager.startContinuousContext();
  });

  ipcMain.handle(ClipboardIPCChannels.STOP_CONTINUOUS_CONTEXT, async () => {
    if (!clipboardManager) {
      return;
    }
    clipboardManager.stopContinuousContext();
  });

  // Permission banner settings - allow user to hide screen recording permission banner.
  ipcMain.handle(ClipboardIPCChannels.GET_HIDE_SCREEN_RECORDING_BANNER, async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('hideScreenRecordingBanner') ?? false;
  });

  ipcMain.handle(ClipboardIPCChannels.SET_HIDE_SCREEN_RECORDING_BANNER, async (_event, hide: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ hideScreenRecordingBanner: hide });
    return true;
  });

  // Cursor status indicator settings - show dot next to cursor during recording/transcribing.
  ipcMain.handle(ClipboardIPCChannels.GET_CURSOR_STATUS_ENABLED, async () => {
    if (!preferencesManager) {
      return true; // Default enabled
    }
    return preferencesManager.getPreference('cursorStatusEnabled') ?? true;
  });

  ipcMain.handle(ClipboardIPCChannels.SET_CURSOR_STATUS_ENABLED, async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ cursorStatusEnabled: enabled });
    cursorStatusManager?.setEnabled(enabled);
    return true;
  });

  // Performance HUD - lightweight in-app CPU/RAM/FPS overlay toggle.
  ipcMain.handle(ClipboardIPCChannels.GET_PERFORMANCE_HUD_ENABLED, async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('performanceHudEnabled') ?? false;
  });

  ipcMain.handle(ClipboardIPCChannels.SET_PERFORMANCE_HUD_ENABLED, async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ performanceHudEnabled: enabled });
    return true;
  });

  // Performance HUD telemetry snapshot (sampled by renderer at low frequency).
  ipcMain.handle(ClipboardIPCChannels.GET_PERFORMANCE_SNAPSHOT, async () => {
    return collectProcessPerformanceSnapshot();
  });

  // Hide status labels - show only colored dots (red/purple/green).
  ipcMain.handle('clipboard:getHideStatusLabels', async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('hideStatusLabels') ?? false;
  });

  ipcMain.handle('clipboard:setHideStatusLabels', async (_event, hide: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ hideStatusLabels: hide });
    cursorStatusManager?.setHideLabels(hide);
    return true;
  });

  // Cursor status debug mode - shows blue background to prove we control the overlay.
  // Useful for debugging the white rectangle issue on multi-monitor setups.
  ipcMain.handle('clipboard:getCursorStatusDebugMode', async () => {
    return cursorStatusManager?.isDebugMode() ?? false;
  });

  ipcMain.handle('clipboard:setCursorStatusDebugMode', async (_event, enabled: boolean) => {
    cursorStatusManager?.setDebugMode(enabled);
    return true;
  });

  // Cursor status window color debug - shows magenta BrowserWindow background.
  // Useful for debugging the white rectangle issue (colors the native window, not React content).
  ipcMain.handle('clipboard:getCursorStatusWindowColorDebug', async () => {
    return cursorStatusManager?.isDebugWindowColor() ?? false;
  });

  ipcMain.handle('clipboard:setCursorStatusWindowColorDebug', async (_event, enabled: boolean) => {
    cursorStatusManager?.setDebugWindowColor(enabled);
    return true;
  });

  // Field Theory window behavior - panel uses the floating overlay, app uses a normal app window.
  ipcMain.handle('clipboard:getFieldTheoryWindowMode', async () => {
    return getFieldTheoryWindowMode();
  });

  ipcMain.handle('clipboard:setFieldTheoryWindowMode', async (_event, mode: FieldTheoryWindowMode) => {
    if (!preferencesManager || (mode !== 'panel' && mode !== 'app')) {
      return false;
    }

    const wasAppWindowMode = shouldUseClipboardAppWindowMode();
    await preferencesManager.save({
      fieldTheoryWindowMode: mode,
      showInDock: mode === 'app',
      clickAwayToDismiss: mode === 'panel',
    });

    if (wasAppWindowMode !== shouldUseClipboardAppWindowMode()) {
      await applyClipboardWindowStyleChange('field-theory-window-mode-toggle', true);
    }
    return true;
  });

  // Show in Dock - legacy API; maps onto Field Theory window behavior.
  ipcMain.handle('clipboard:getShowInDock', async () => {
    if (!preferencesManager) {
      return false;
    }
    return shouldUseClipboardAppWindowMode();
  });
  
  ipcMain.handle('clipboard:setShowInDock', async (_event, show: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    const wasAppWindowMode = shouldUseClipboardAppWindowMode();
    await preferencesManager.save({
      showInDock: show,
      fieldTheoryWindowMode: show ? 'app' : 'panel',
      clickAwayToDismiss: !show,
    });
    
    // Apply immediately. Window type can't change dynamically, so recreate
    // only when the effective native style changes.
    if (wasAppWindowMode !== shouldUseClipboardAppWindowMode()) {
      await applyClipboardWindowStyleChange('show-window-type-toggle', true);
    }
    return true;
  });

  // Click-away dismissal - controls whether the panel hides when another app gets focus.
  ipcMain.handle('clipboard:getClickAwayToDismiss', async () => {
    if (!preferencesManager) {
      return true;
    }
    return preferencesManager.getPreference('clickAwayToDismiss') ?? true;
  });

  ipcMain.handle('clipboard:setClickAwayToDismiss', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ clickAwayToDismiss: enabled });
    return true;
  });

  // Show fieldtheory.dev link in footer - toggleable per user preference.
  ipcMain.handle('clipboard:getShowFieldTheoryLink', async () => {
    if (!preferencesManager) {
      return true; // Default to showing
    }
    return preferencesManager.getPreference('showFieldTheoryLink') ?? true;
  });

  ipcMain.handle('clipboard:setShowFieldTheoryLink', async (_event, show: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ showFieldTheoryLink: show });
    return true;
  });

  // Launch at login - start app automatically when macOS starts.
  // Returns the actual system state, not just the preference.
  ipcMain.handle('clipboard:getLaunchAtLogin', async () => {
    if (process.platform === 'darwin' && app.isPackaged) {
      const settings = app.getLoginItemSettings();
      return settings.openAtLogin;
    }
    // Fallback to preference for non-macOS
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('launchAtLogin') ?? true;
  });

  ipcMain.handle('clipboard:setLaunchAtLogin', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return { success: false, enabled: false };
    }
    await preferencesManager.save({ launchAtLogin: enabled });

    // Apply immediately using Electron's login item settings.
    if (process.platform === 'darwin' && app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true, // Start in background (menu bar app)
      });

      // Verify the setting was applied
      const settings = app.getLoginItemSettings();
      return { success: settings.openAtLogin === enabled, enabled: settings.openAtLogin };
    }
    return { success: true, enabled };
  });

  // Sounds enabled - master toggle for all sounds.
  ipcMain.handle('clipboard:getSoundsEnabled', async () => {
    if (!preferencesManager) {
      return true;
    }
    return preferencesManager.getPreference('soundsEnabled') ?? true;
  });

  ipcMain.handle('clipboard:setSoundsEnabled', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ soundsEnabled: enabled });
    return true;
  });

  // =========================================================================
  // Tasks Tab - hidden by default, toggled with Shift+Cmd+T
  // =========================================================================

  ipcMain.handle('clipboard:getTasksTabEnabled', async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('tasksTabEnabled') ?? false;
  });

  ipcMain.handle('clipboard:setTasksTabEnabled', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ tasksTabEnabled: enabled });
    // Broadcast change to renderer
    const win = clipboardHistoryWindow?.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('clipboard:tasksTabToggled', enabled);
    }
    return true;
  });

  // =========================================================================
  // Word Substitutions - correction pairs for transcription
  // =========================================================================

  ipcMain.handle('clipboard:getWordSubstitutions', async () => {
    if (!preferencesManager) {
      return [];
    }
    return preferencesManager.getPreference('wordSubstitutions') ?? [];
  });

  ipcMain.handle('clipboard:setWordSubstitutions', async (_event, substitutions: Array<{ from: string; to: string }>) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ wordSubstitutions: substitutions });
    return true;
  });

  // =========================================================================
  // App Voice Aliases - custom voice trigger words for app switching
  // =========================================================================

  ipcMain.handle('clipboard:getAppVoiceAliases', async () => {
    if (!preferencesManager) {
      return [];
    }
    return preferencesManager.getPreference('hotMicAppAliases') ?? [];
  });

  ipcMain.handle('clipboard:setAppVoiceAliases', async (_event, aliases: Array<{ appName: string; aliases: string }>) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ hotMicAppAliases: aliases });
    return true;
  });

  ipcMain.handle('clipboard:browseForApp', async (event) => {
    // Use the caller window as parent so macOS presents this as a modal sheet.
    // This avoids panel blur-dismiss races when opening "Other..." from settings.
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const parentWindow = senderWindow && !senderWindow.isDestroyed()
      ? senderWindow
      : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);

    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, {
          title: 'Select Application',
          message: 'Choose an application',
          defaultPath: '/Applications',
          properties: ['openFile'],
          filters: [{ name: 'Applications', extensions: ['app'] }],
          buttonLabel: 'Select',
        })
      : await dialog.showOpenDialog({
          title: 'Select Application',
          message: 'Choose an application',
          defaultPath: '/Applications',
          properties: ['openFile'],
          filters: [{ name: 'Applications', extensions: ['app'] }],
          buttonLabel: 'Select',
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    // Extract app name from path: "/Applications/Ghostty.app" → "Ghostty"
    const appPath = result.filePaths[0];
    const match = appPath.match(/([^/]+)\.app$/);
    return match ? match[1] : null;
  });

  // =========================================================================
  // Data Retention - how long to keep clipboard history
  // =========================================================================

  ipcMain.handle('clipboard:getDataRetentionDays', async () => {
    if (!preferencesManager) {
      return -1; // Default: never delete
    }
    return preferencesManager.getPreference('dataRetentionDays') ?? -1;
  });

  ipcMain.handle('clipboard:setDataRetentionDays', async (_event, days: number) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ dataRetentionDays: days });

    if (clipboardManager) {
      clipboardManager.setRetentionDays(days);
      // Trigger immediate cleanup with new retention setting.
      if (days !== -1) {
        clipboardManager.applyDataRetention(days);
      }
    }
    return true;
  });

  // =========================================================================
  // Quota IPC Handlers - Local usage tracking
  // QuotaManager handles session checking internally via setSessionChecker().
  // =========================================================================

  ipcMain.handle('quota:getQuotas', async () => {
    if (!quotaManager) {
      return null;
    }
    return quotaManager.getQuotas();
  });

  ipcMain.handle('quota:checkQuota', async (_event, feature: 'priorityMic' | 'autoStack' | 'textImprove' | 'portableCommands') => {
    if (!quotaManager) {
      return { allowed: true, used: 0, limit: Infinity, remaining: Infinity, percentUsed: 0 };
    }
    // Map old feature names to new database column names.
    const featureMap: Record<string, 'text_improve_words' | 'priority_mic_seconds' | 'auto_stack_sessions' | 'portable_commands'> = {
      priorityMic: 'priority_mic_seconds',
      autoStack: 'auto_stack_sessions',
      textImprove: 'text_improve_words',
      portableCommands: 'portable_commands',
    };
    const dbFeature = featureMap[feature];
    return quotaManager.getFeatureStatus(dbFeature);
  });

  ipcMain.handle('quota:getFormattedUsage', async () => {
    if (!quotaManager) {
      return { priorityMic: 'Unlimited', autoStack: 'Unlimited', textImprove: 'Unlimited', portableCommands: 'Unlimited' };
    }
    return {
      priorityMic: quotaManager.formatPriorityMicUsage(),
      autoStack: quotaManager.formatAutoStackUsage(),
      textImprove: quotaManager.formatTextImproveUsage(),
      portableCommands: quotaManager.formatPortableCommandsUsage(),
    };
  });

  ipcMain.handle('quota:getResetDate', async () => {
    // Quotas now reset on calendar month boundary (1st of each month).
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  });

  ipcMain.handle('quota:getDaysUntilReset', async () => {
    if (!quotaManager) {
      return 0;
    }
    return quotaManager.getDaysUntilReset();
  });

  ipcMain.handle('quota:getLimits', async () => {
    if (!quotaManager) {
      return { priorityMicMinutes: Infinity, autoStackSessions: Infinity, textImprovementWords: Infinity, portableCommands: Infinity };
    }
    const raw = quotaManager.getLimits();
    // Transform keys from snake_case to camelCase and convert seconds to minutes.
    return {
      priorityMicMinutes: raw.priority_mic_seconds === Infinity ? Infinity : Math.floor(raw.priority_mic_seconds / 60),
      autoStackSessions: raw.auto_stack_sessions,
      textImprovementWords: raw.text_improve_words,
      portableCommands: raw.portable_commands,
    };
  });

  ipcMain.handle('quota:refreshTier', async () => {
    // Sync usage and tier from server. Tier is included in get-usage response.
    if (!quotaManager) {
      return { tier: 'free', error: 'Not initialized' };
    }

    try {
      await quotaManager.syncFromServer();
      const tier = quotaManager.getCachedTier();

      // Broadcast tier change to all windows.
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('tier:changed', tier);
        }
      });

      return { tier, error: null };
    } catch (err) {
      log.error('Error refreshing tier:', err);
      return { tier: quotaManager.getCachedTier(), error: String(err) };
    }
  });

  // =========================================================================
  // Diagnostics IPC Handlers - For remote troubleshooting
  // =========================================================================

  ipcMain.handle('diagnostics:get', async () => {
    if (!diagnosticsCollector) {
      return { error: 'Diagnostics not initialized' };
    }
    return diagnosticsCollector.collect();
  });

  ipcMain.handle('diagnostics:getMarkdown', async () => {
    if (!diagnosticsCollector) {
      return 'Diagnostics not initialized';
    }
    const report = await diagnosticsCollector.collect();
    return diagnosticsCollector.formatAsMarkdown(report);
  });

  // =========================================================================
  // Commands IPC Handlers - Portable commands management
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.GET_DIRECTORY, async () => {
    if (!commandsManager) {
      return null;
    }
    return commandsManager.getDirectory();
  });

  ipcMain.handle(CommandsIPCChannels.SET_DIRECTORY, async (_event, directoryPath: string | null) => {
    if (!commandsManager || !preferencesManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      await commandsManager.setDirectory(directoryPath);
      await preferencesManager.save({ commandsDirectory: directoryPath || undefined });
      return { success: true };
    } catch (error) {
      log.error('Failed to set commands directory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(CommandsIPCChannels.BROWSE_DIRECTORY, async () => {
    // NSPanel windows (like clipboard history) don't support modal dialogs properly.
    // Use mainWindow as parent, or show dialog without parent if mainWindow doesn't exist.
    // This ensures the dialog appears and works correctly.
    const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

    const result = await dialog.showOpenDialog(parentWindow as BrowserWindow, {
      title: 'Select Commands Directory',
      message: 'Choose a folder containing your command markdown files',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Select',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle(CommandsIPCChannels.GET_COMMANDS, async () => {
    if (!commandsManager) {
      return [];
    }
    return commandsManager.getCommands().map(cmd => ({
      name: cmd.name,
      displayName: cmd.displayName,
      filePath: cmd.filePath,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.REFRESH_COMMANDS, async () => {
    if (!commandsManager) {
      return [];
    }
    await commandsManager.refresh();
    return commandsManager.getCommands().map(cmd => ({
      name: cmd.name,
      displayName: cmd.displayName,
      filePath: cmd.filePath,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.GET_COMMAND_CONTENT, async (_event, commandName: string) => {
    if (!commandsManager) {
      return null;
    }
    const command = commandsManager.getCommand(commandName);
    if (!command) {
      return null;
    }
    const loaded = await commandsManager.loadCommandContent(command);
    if (!loaded) {
      return null;
    }
    return { content: loaded.content, filePath: loaded.filePath };
  });

  ipcMain.handle(CommandsIPCChannels.GET_MARKDOWN_PREVIEW, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isAllowedMarkdownExt(filePath)) {
      return null;
    }
    try {
      const canonicalPath = fs.realpathSync(filePath);
      const stat = fs.statSync(canonicalPath);
      if (!stat.isFile()) return null;

      let content = fs.readFileSync(canonicalPath, 'utf-8');
      if (Buffer.byteLength(content, 'utf-8') > MARKDOWN_PREVIEW_MAX_BYTES) {
        content = content.slice(0, MARKDOWN_PREVIEW_MAX_BYTES) + '\n\n[preview truncated]';
      }

      return {
        title: path.basename(canonicalPath),
        filePath: canonicalPath,
        content,
      };
    } catch (error) {
      log.warn('Failed to load markdown preview:', error);
      return null;
    }
  });

  // =========================================================================
  // Multi-Directory Management
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.INITIALIZE, async () => {
    if (!commandsManager) {
      return;
    }
    await commandsManager.initialize();
  });

  ipcMain.handle(CommandsIPCChannels.GET_WATCHED_DIRS, async () => {
    if (!commandsManager) {
      return [];
    }
    return commandsManager.getWatchedDirs();
  });

  ipcMain.handle(CommandsIPCChannels.ADD_WATCHED_DIR, async (_event, dirPath: string) => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.addWatchedDir(dirPath);
  });

  ipcMain.handle(CommandsIPCChannels.REMOVE_WATCHED_DIR, async (_event, dirPath: string) => {
    if (!commandsManager) {
      return false;
    }
    return commandsManager.removeWatchedDir(dirPath);
  });

  ipcMain.handle(CommandsIPCChannels.GET_DEFAULT_DIRECTORY, async () => {
    if (!commandsManager) {
      return '';
    }
    return commandsManager.getDefaultDirectory();
  });

  ipcMain.handle(CommandsIPCChannels.CREATE_DEFAULT_DIRECTORY, async () => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.createDefaultDirectory();
  });

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.GET_COMMAND_BY_PATH, async (_event, filePath: string) => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.getCommandByPath(filePath);
  });

  ipcMain.handle(CommandsIPCChannels.SAVE_COMMAND, async (_event, filePath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> => {
    if (!commandsManager) {
      return { ok: false, reason: 'error' };
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { ok: false, reason: 'blocked' };
    }
    return commandsManager.saveCommand(filePath, content, expectedVersion);
  });

  ipcMain.handle(CommandsIPCChannels.CREATE_COMMAND, async (_event, directoryPath: string, name: string, content: string) => {
    if (!commandsManager) {
      return null;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return commandsManager.createCommand(directoryPath, name, content);
  });

  ipcMain.handle(CommandsIPCChannels.DELETE_COMMAND, async (_event, filePath: string) => {
    if (!commandsManager) {
      return false;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return commandsManager.deleteCommand(filePath);
  });

  ipcMain.handle(CommandsIPCChannels.RENAME_COMMAND, async (_event, oldFilePath: string, newName: string) => {
    if (!commandsManager) {
      return null;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return commandsManager.renameCommand(oldFilePath, newName);
  });

  // =========================================================================
  // Mobile Sync Operations
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.SET_MOBILE_SYNC, async (_event, dirPath: string, enabled: boolean) => {
    if (!commandsManager) {
      return false;
    }
    refreshFieldTheorySyncServices();
    if (!canUseFieldTheorySync()) {
      return false;
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    const success = commandsManager.setMobileSyncEnabled(dirPath, enabled);
    // Trigger sync after enabling/disabling
    if (success && commandSyncService) {
      commandSyncService.syncToSupabase().then((result) => {
        // Track newly contributed commands
        if (result.uploaded > 0) {
          for (let i = 0; i < result.uploaded; i++) {
            metricsManager?.recordCommandContributed();
          }
        }
      });
    }
    return success;
  });

  ipcMain.handle(CommandsIPCChannels.GET_MOBILE_SYNC_STATUS, async () => {
    refreshFieldTheorySyncServices();
    if (!canUseFieldTheorySync()) {
      return { ready: false, lastSyncAt: null };
    }
    if (!commandSyncService) {
      return { ready: false, lastSyncAt: null };
    }
    return {
      ready: commandSyncService.isReady(),
      lastSyncAt: commandSyncService.getLastSyncAt(),
    };
  });

  ipcMain.handle(CommandsIPCChannels.SYNC_TO_MOBILE, async () => {
    refreshFieldTheorySyncServices();
    if (!commandSyncService) {
      return { success: false, uploaded: 0, updated: 0, deleted: 0, errors: [fieldTheorySyncDisabledError()] };
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { success: false, uploaded: 0, updated: 0, deleted: 0, errors: ['Field Theory is read-only'] };
    }
    const result = await commandSyncService.syncToSupabase();
    // Track newly contributed commands
    if (result.uploaded > 0) {
      for (let i = 0; i < result.uploaded; i++) {
        metricsManager?.recordCommandContributed();
      }
    }
    return result;
  });

  ipcMain.handle(CommandsIPCChannels.GET_REMOTE_COMMAND_COUNT, async () => {
    refreshFieldTheorySyncServices();
    if (!canUseFieldTheorySync()) {
      return 0;
    }
    if (!commandSyncService) {
      return 0;
    }
    return await commandSyncService.getRemoteCommandCount();
  });

  // =========================================================================
  // Handoffs - Global session handoff files
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.GET_HANDOFFS, async (_event, limit?: number) => {
    if (!commandsManager) {
      return [];
    }
    const resolvedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.round(limit as number))) : 10;
    const handoffs = await commandsManager.getHandoffs(resolvedLimit);
    return handoffs.map(h => ({
      name: h.name,
      displayName: h.displayName,
      filePath: h.filePath,
      lastModified: h.lastModified,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.GET_HANDOFF_CONTENT, async (_event, filePath: string) => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.loadHandoffContent(filePath);
  });

  ipcMain.handle('commands:getLauncherContext', async (): Promise<{ fieldTheoryActive: boolean }> => {
    const fieldTheoryActive = commandLauncherWindow?.wasFieldTheoryActiveOnShow() ?? false;
    const previousApp = commandLauncherWindow?.getPreviousApp() ?? null;
    const frontmostApp = nativeHelper?.getFrontmostApp() ?? null;
    appendCommandLauncherTrace('launcher-context', {
      fieldTheoryActive,
      previousBundleId: previousApp?.bundleId ?? null,
      previousName: previousApp?.name ?? null,
      frontmostBundleId: frontmostApp?.bundleId ?? null,
      frontmostName: frontmostApp?.name ?? null,
      fallbackBundleId: lastExternalCommandTargetApp?.bundleId ?? null,
      fallbackName: lastExternalCommandTargetApp?.name ?? null,
    });
    return { fieldTheoryActive };
  });

  ipcMain.handle('commands:getActiveLibraryFileContext', (): ActiveLibraryFileContext | null => {
    return activeLibraryFileContext;
  });

  ipcMain.handle('commands:setActiveLibraryFileContext', (_event, context: ActiveLibraryFileContext | null): boolean => {
    if (context === null) {
      activeLibraryFileContext = null;
      return true;
    }
    if (
      (context.type !== 'wiki' && context.type !== 'external') ||
      !context.rootPath ||
      !context.relPath ||
      !context.filePath ||
      !context.title
    ) {
      return false;
    }
    activeLibraryFileContext = {
      type: context.type,
      rootPath: context.rootPath,
      relPath: context.relPath,
      filePath: context.filePath,
      title: context.title,
    };
    return true;
  });

  ipcMain.handle('commands:openFieldTheoryMarkdown', async (_event, target: { kind: 'wiki' | 'artifact' | 'command' | 'external' | 'bookmarks' | 'library' | 'commands' | 'clipboard'; path: string; contentMode?: 'rendered' | 'markdown' }) => {
    if (!target?.path || !['wiki', 'artifact', 'command', 'external', 'bookmarks', 'library', 'commands', 'clipboard'].includes(target.kind)) {
      return { success: false, error: 'Invalid markdown target' };
    }
    if (!clipboardHistoryWindow) {
      return { success: false, error: 'Field Theory window not available' };
    }

    const sizeKey: ClipboardHistorySizeKey = target.kind === 'command' || target.kind === 'commands' || target.kind === 'clipboard' ? 'fields' : 'library';
    if (clipboardHistoryWindow.isVisible()) {
      suspendDynamicIslandFocusForClipboardHistory('command-launcher-open-markdown');
      clipboardHistoryWindow.focusExistingWindow();
    } else {
      const boundsToUse = restoreClipboardHistoryBounds(sizeKey);
      suspendDynamicIslandFocusForClipboardHistory('command-launcher-open-markdown');
      clipboardHistoryWindow.show(boundsToUse);
    }

    commandLauncherWindow?.hide(true);
    clipboardHistoryWindow.getWindow()?.webContents.send('commands:openMarkdownFromLauncher', target);
    return { success: true };
  });

  ipcMain.handle('commands:insertMarkdownText', async (_event, text: string) => {
    if (!clipboardHistoryWindow || !text) {
      return { success: false, error: 'No markdown editor target' };
    }
    commandLauncherWindow?.hide(true);
    clipboardHistoryWindow.getWindow()?.webContents.send('librarian:insertMarkdownText', text);
    return { success: true };
  });

  // Handle handoff invocation from command launcher (same behavior as commands).
  ipcMain.handle('commands:invokeHandoff', async (_event, filePath: string) => {
    const plist = require('plist');

    if (!commandsManager || !fs.existsSync(filePath)) {
      return { success: false, error: 'Handoff not found' };
    }

    try {
      const targetApp = getCommandLauncherTargetApp();
      appendCommandLauncherTrace('invoke-handoff-start', {
        filePath,
        targetBundleId: targetApp?.bundleId ?? null,
        targetName: targetApp?.name ?? null,
      });
      if (!targetApp) {
        commandLauncherWindow?.hide(true);
        appendCommandLauncherTrace('invoke-handoff-no-target', { filePath });
        return { success: false, error: 'No external target app available' };
      }
      const isTerminal = isTerminalApp(targetApp.bundleId);
      const isIDE = isIDEWithTerminal(targetApp.bundleId);
      const fileName = path.basename(filePath);

      if (isTerminal || isIDE) {
        clipboard.writeText(`${fileName}\n${filePath} `);
        clipboardManager?.syncClipboardHash();
      } else {
        const plistData = plist.build([filePath]);
        clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData));
        clipboardManager?.syncClipboardHash();
      }

      await activateAndPasteFromCommandLauncher(targetApp);
      appendCommandLauncherTrace('invoke-handoff-success', {
        filePath,
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        terminal: isTerminal,
        IDE: isIDE,
      });
      return { success: true };
    } catch (error) {
      log.error('Error invoking handoff:', error);
      appendCommandLauncherTrace('invoke-handoff-error', { filePath, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Handle direct command invocation from command launcher (Cmd+Shift+K).
  // Gets the command, determines if target is terminal, and pastes appropriately.
  ipcMain.handle('commands:invoke', async (_event, commandName: string) => {
    const plist = require('plist');

    if (!commandsManager) {
      return { success: false, error: 'Not initialized' };
    }

    const command = commandsManager.getCommand(commandName);
    if (!command) {
      log.error(`Command not found: "${commandName}". Available: ${commandsManager.getCommands().map(c => c.name).join(', ')}`);
      return { success: false, error: 'Command not found' };
    }

    try {
      const targetApp = getCommandLauncherTargetApp();
      appendCommandLauncherTrace('invoke-command-start', {
        commandName,
        commandPath: command.filePath,
        targetBundleId: targetApp?.bundleId ?? null,
        targetName: targetApp?.name ?? null,
      });
      if (!targetApp) {
        appendCommandLauncherTrace('invoke-command-no-target', {
          commandName,
          commandPath: command.filePath,
        });
        cursorStatusManager?.showNoTargetError('Portable command: no target app');
        return { success: false, error: 'No external target app available' };
      }
      const isTerminal = isTerminalApp(targetApp.bundleId);
      const isIDE = isIDEWithTerminal(targetApp.bundleId);

      log.info(`Invoking command "${commandName}" → ${command.filePath} (target: ${targetApp?.name ?? 'unknown'} [${targetApp?.bundleId ?? '?'}], terminal: ${isTerminal}, IDE: ${isIDE})`);

      const clipboardSnapshot = captureClipboardSnapshot();
      try {
        if (isTerminal || isIDE) {
          const commandReferenceText = `[${command.name}.md]\n${command.filePath} `;
          clipboard.writeText(commandReferenceText);
          clipboardManager?.syncClipboardHash();
          appendCommandLauncherTrace('invoke-command-clipboard-written', {
            commandName,
            format: 'text',
            textLength: commandReferenceText.length,
          });
        } else {
          const fileUrl = pathToFileURL(command.filePath).toString();
          const plistData = plist.build([command.filePath]);
          clipboard.writeText(command.filePath);
          clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData));
          clipboard.writeBuffer('public.file-url', Buffer.from(fileUrl, 'utf-8'));
          clipboard.writeBuffer('NSURLPboardType', Buffer.from(fileUrl, 'utf-8'));
          clipboardManager?.syncClipboardHash();
          appendCommandLauncherTrace('invoke-command-clipboard-written', {
            commandName,
            format: 'file-list+file-url+text',
            filePath: command.filePath,
            fileUrl,
            availableFormats: clipboard.availableFormats(),
          });
        }

        const pasted = await activateAndPasteFromCommandLauncher(targetApp);
        if (!pasted) {
          cursorStatusManager?.showNoTargetError('Portable command paste failed');
          return { success: false, error: 'Could not paste into target app' };
        }
      } finally {
        appendCommandLauncherTrace('invoke-command-wait-before-clipboard-restore', {
          commandName,
          commandPath: command.filePath,
          delayMs: COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
        });
        await waitForCommandClipboardPasteRead();
        restoreClipboardSnapshot(clipboardSnapshot);
        clipboardManager?.syncClipboardHash();
        appendCommandLauncherTrace('invoke-command-clipboard-restored', {
          commandName,
          commandPath: command.filePath,
        });
      }
      appendCommandLauncherTrace('invoke-command-success', {
        commandName,
        commandPath: command.filePath,
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        terminal: isTerminal,
        IDE: isIDE,
      });

      await quotaManager?.updateUsage('portable_commands', 1);
      metricsManager?.recordCommandExecuted();
      return { success: true };
    } catch (error) {
      log.error('Error invoking command:', error);
      appendCommandLauncherTrace('invoke-command-error', { commandName, commandPath: command.filePath, error });
      cursorStatusManager?.showNoTargetError('Portable command paste failed');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Share a command to the shared pool (popular_commands table).
  // Routes through main process to use AuthManager's authenticated Supabase client.
  ipcMain.handle('commands:share', async (_event, command: { name: string; content: string }) => {
    refreshFieldTheorySyncServices();
    if (!canUseFieldTheorySync()) {
      return { error: fieldTheorySyncDisabledError() };
    }
    const supabase = authManager?.getSupabaseClient();
    if (!supabase) {
      return { error: 'Not authenticated' };
    }

    const session = await authManager?.getSession();
    if (!session) {
      return { error: 'Please log in to share commands' };
    }

    const { data, error } = await supabase
      .from('popular_commands')
      .insert({
        name: command.name,
        content: command.content,
        copy_count: 0,
        contributed_by: session.user?.id || null,
      })
      .select()
      .single();

    if (error) {
      log.error('Failed to share command:', error);
      return { error: error.message };
    }
    return { data };
  });

  // Unshare a command from the shared pool.
  ipcMain.handle('commands:unshare', async (_event, commandId: string) => {
    refreshFieldTheorySyncServices();
    if (!canUseFieldTheorySync()) {
      return { error: fieldTheorySyncDisabledError() };
    }
    const supabase = authManager?.getSupabaseClient();
    if (!supabase) {
      return { error: 'Not authenticated' };
    }

    const { error } = await supabase
      .from('popular_commands')
      .delete()
      .eq('id', commandId);

    if (error) {
      log.error('Failed to unshare command:', error);
      return { error: error.message };
    }
    return { success: true };
  });

  // =========================================================================
  // Feedback IPC Handlers
  // =========================================================================

  // Send a text reply to feedback.
  ipcMain.handle(SocialIPCChannels.SEND_TEXT_DM, async (_event, recipientUserId: string, text: string, parentMessageId?: string) => {
    if (!feedbackManager || !parentMessageId) {
      return null;
    }
    return await feedbackManager.sendTextReply(recipientUserId, text, parentMessageId);
  });

  // Send an image reply to feedback.
  ipcMain.handle(SocialIPCChannels.SEND_IMAGE_REPLY, async (_event, recipientUserId: string, imageBase64: string, text?: string, parentMessageId?: string) => {
    if (!feedbackManager || !parentMessageId) {
      return null;
    }
    return await feedbackManager.sendImageReply(recipientUserId, imageBase64, text, parentMessageId);
  });

  // Mark a message as read.
  ipcMain.handle(SocialIPCChannels.MARK_AS_READ, async (_event, messageId: string) => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.markAsRead(messageId);
  });

  // Mark multiple messages as read in batch.
  ipcMain.handle(SocialIPCChannels.MARK_AS_READ_BATCH, async (_event, messageIds: string[]) => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.markAsReadBatch(messageIds);
  });

  // Check if there are unread feedback messages.
  ipcMain.handle(SocialIPCChannels.HAS_UNREAD_FEEDBACK, async () => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.hasUnreadFeedback();
  });

  // Mark all feedback messages as read.
  ipcMain.handle(SocialIPCChannels.MARK_ALL_FEEDBACK_AS_READ, async () => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.markAllFeedbackAsRead();
  });

  // Submit feedback (send to admin).
  ipcMain.handle(SocialIPCChannels.SUBMIT_FEEDBACK, async (_event, localItemId: number) => {
    if (!feedbackManager) {
      return null;
    }
    const result = await feedbackManager.submitFeedback(localItemId);
    if (result) metricsManager?.recordFeedbackGiven();
    return result;
  });

  // Submit text feedback (for diagnostics, etc.).
  ipcMain.handle(SocialIPCChannels.SUBMIT_TEXT_FEEDBACK, async (_event, text: string) => {
    if (!feedbackManager) {
      return null;
    }
    const result = await feedbackManager.submitTextFeedback(text);
    if (result) metricsManager?.recordFeedbackGiven();
    return result;
  });

  // Submit image feedback with optional caption and source app name.
  ipcMain.handle(SocialIPCChannels.SUBMIT_IMAGE_FEEDBACK, async (_event, imageBase64: string, caption?: string, sourceAppName?: string) => {
    if (!feedbackManager) {
      return null;
    }
    const result = await feedbackManager.submitImageFeedback(imageBase64, caption, sourceAppName);
    if (result) metricsManager?.recordFeedbackGiven();
    return result;
  });

  // Get current user's submitted feedback.
  ipcMain.handle(SocialIPCChannels.GET_MY_FEEDBACK, async () => {
    if (!feedbackManager) {
      return [];
    }
    return await feedbackManager.getMyFeedback();
  });

  // Get all feedback (admin only).
  ipcMain.handle(SocialIPCChannels.GET_ALL_FEEDBACK, async () => {
    if (!feedbackManager) {
      return [];
    }
    return await feedbackManager.getAllFeedback();
  });

  // Get replies to a feedback item.
  ipcMain.handle(SocialIPCChannels.GET_FEEDBACK_REPLIES, async (_event, feedbackId: string) => {
    if (!feedbackManager) {
      return [];
    }
    return await feedbackManager.getFeedbackReplies(feedbackId);
  });

  // Update feedback status.
  ipcMain.handle(SocialIPCChannels.UPDATE_FEEDBACK_STATUS, async (_event, feedbackId: string, status: 'open' | 'resolved' | 'archived') => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.updateFeedbackStatus(feedbackId, status);
  });

  // Get activity log for a feedback item.
  ipcMain.handle(SocialIPCChannels.GET_ACTIVITY_LOG, async (_event, feedbackId: string) => {
    if (!feedbackManager) {
      return [];
    }
    return await feedbackManager.getActivityLog(feedbackId);
  });

  // Check if current user is admin.
  ipcMain.handle(SocialIPCChannels.IS_ADMIN, async () => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.isCurrentUserAdmin();
  });

  ipcMain.handle('account:getStatus', async () => {
    return accountStatusManager?.getStatus() ?? { state: 'checking', capabilityMode: 'writable' };
  });

  ipcMain.handle('account:checkNow', async () => {
    if (!accountStatusManager) {
      return { state: 'checking', capabilityMode: 'writable' };
    }
    return accountStatusManager.checkNow();
  });

  ipcMain.handle('fieldTheorySync:getStatus', async () => {
    return getFieldTheorySyncStatus();
  });

  ipcMain.handle('fieldTheorySync:setLocalEnabled', async (_event, enabled: boolean) => {
    if (preferencesManager) {
      await preferencesManager.save({ fieldTheoryInternalSyncEnabled: enabled === true });
      refreshFieldTheorySyncServices();
    }
    return getFieldTheorySyncStatus();
  });
}


/**
 * Set up IPC handlers for onboarding wizard.
 */
function setupOnboardingIPCHandlers(): void {
  // Get current permission status for all required permissions.
  ipcMain.handle(OnboardingIPCChannels.GET_PERMISSION_STATUS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    return await onboardingWindow.getPermissionStatus();
  });

  // Request microphone permission - shows system dialog if not determined.
  ipcMain.handle(OnboardingIPCChannels.REQUEST_MICROPHONE, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    return await onboardingWindow.requestMicrophonePermission();
  });

  // Open System Settings to Accessibility pane.
  ipcMain.handle(OnboardingIPCChannels.OPEN_ACCESSIBILITY_SETTINGS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    onboardingWindow.openAccessibilitySettings();
    return true;
  });

  // Open System Settings to Screen Recording pane.
  ipcMain.handle(OnboardingIPCChannels.OPEN_SCREEN_RECORDING_SETTINGS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    onboardingWindow.openScreenRecordingSettings();
    return true;
  });

  // Trigger screen capture to add app to Screen Recording permissions list.
  // This saves users from manually clicking "+" to add the app.
  ipcMain.handle(OnboardingIPCChannels.TRIGGER_SCREEN_RECORDING_PROMPT, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    await onboardingWindow.triggerScreenRecordingPrompt();
    return true;
  });

  // Get current onboarding state (complete, step, permissions, model).
  ipcMain.handle(OnboardingIPCChannels.GET_ONBOARDING_STATE, async () => {
    const prefs = preferencesManager?.get();
    const permissions = onboardingWindow 
      ? await onboardingWindow.getPermissionStatus()
      : { microphone: 'not-determined' as const, accessibility: false };
    
    // Check if the configured transcription engine is ready.
    const modelDownloaded = await isTranscriptionEngineReady();

    return {
      isComplete: prefs?.onboardingComplete ?? false,
      currentStep: prefs?.onboardingStep ?? 0,
      permissions,
      modelDownloaded,
    };
  });

  // Update current onboarding step (for resume capability).
  ipcMain.handle(OnboardingIPCChannels.SET_ONBOARDING_STEP, async (_event, step: number) => {
    if (!preferencesManager) return false;
    await preferencesManager.save({ onboardingStep: step });
    return true;
  });

  // Mark onboarding as complete.
  ipcMain.handle(OnboardingIPCChannels.COMPLETE_ONBOARDING, async () => {
    if (!preferencesManager) return false;
    await preferencesManager.save({ onboardingComplete: true });

    // Register hotkeys now that onboarding is complete
    registerHotkeysAfterOnboarding();

    // Refresh tray menu to show full options
    if (trayManager) {
      trayManager.refreshMenu();
    }

    // Close onboarding window and show clipboard history.
    if (onboardingWindow) {
      onboardingWindow.close();
    }
    showClipboardHistoryOnActivate();
    return true;
  });

  // Skip onboarding (set up later).
  ipcMain.handle(OnboardingIPCChannels.SKIP_ONBOARDING, async () => {
    if (!preferencesManager) return false;
    await preferencesManager.save({ onboardingComplete: true });

    // Register hotkeys now that onboarding is complete
    registerHotkeysAfterOnboarding();

    // Refresh tray menu to show full options
    if (trayManager) {
      trayManager.refreshMenu();
    }

    // Close onboarding window.
    if (onboardingWindow) {
      onboardingWindow.close();
    }
    return true;
  });

  // Check if transcription engine is ready (for model download step).
  ipcMain.handle(OnboardingIPCChannels.CHECK_MODEL_STATUS, async () => {
    const isAvailable = await isTranscriptionEngineReady();
    return { downloaded: isAvailable };
  });

  // Reset onboarding state - clears completion flag and shows onboarding window again.
  // Useful for testing and development.
  ipcMain.handle(OnboardingIPCChannels.RESET_ONBOARDING, async () => {
    if (!preferencesManager) return false;

    // Clear onboarding state.
    await preferencesManager.save({
      onboardingComplete: false,
      onboardingStep: undefined,
    });

    // Unregister hotkeys - they shouldn't work during onboarding.
    getHotkeyManager().unregisterAll();

    // Hide clipboard history window if visible.
    if (clipboardHistoryWindow?.isVisible()) {
      clipboardHistoryWindow.hide();
    }

    // Refresh tray menu to show onboarding options.
    if (trayManager) {
      trayManager.refreshMenu();
    }

    // Close any existing onboarding window.
    if (onboardingWindow) {
      onboardingWindow.close();
      onboardingWindow = null;
    }

    // Show onboarding window from the beginning.
    onboardingWindow = createOnboardingWindow();
    onboardingWindow.show(OnboardingStep.PERMISSIONS);

    return true;
  });

  // Show sign-in screen (onboarding at account step).
  // Used when user clicks "Sign in" from settings while logged out.
  ipcMain.handle(OnboardingIPCChannels.SHOW_SIGN_IN, async () => {
    // Hide clipboard history window if visible.
    if (clipboardHistoryWindow?.isVisible()) {
      clipboardHistoryWindow.hide();
    }

    // Create onboarding window if needed and show at account step.
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    onboardingWindow.show(OnboardingStep.ACCOUNT);

    return true;
  });

  // Note: EXPAND_WINDOW handler removed - no longer needed since onboarding
  // is now just 2 phases (permissions + model) with no tutorial phase.

  // ---------------------------------------------------------------------------
  // AI Integration (Claude Code / Cursor) - shown during model download
  // ---------------------------------------------------------------------------

  // Get status of Claude Code and Cursor - checks if installed and if hooks are connected.
  ipcMain.handle(OnboardingIPCChannels.GET_AI_INTEGRATION_STATUS, () => {
    const claudeCodeAvailable = librarianManager?.getClaudeCodeStatus() !== 'not-installed';
    const cursorAvailable = fs.existsSync(path.join(os.homedir(), '.cursor'));
    const codexAvailable = librarianManager?.getCodexStatus() !== 'not-installed';

    const claudeHookInstalled = librarianManager?.isReadPermissionHookInstalled() ?? false;
    const cursorHookInstalled = librarianManager?.isCursorReadPermissionHookInstalled() ?? false;

    return {
      claudeCode: { available: claudeCodeAvailable, connected: claudeHookInstalled },
      cursor: { available: cursorAvailable, connected: cursorHookInstalled },
      codex: { available: codexAvailable, connected: librarianManager?.isCodexHookInstalled() ?? false },
    };
  });

  // Install Claude Code read permission hook for screenshot access.
  ipcMain.handle(OnboardingIPCChannels.INSTALL_CLAUDE_HOOK, () => {
    return librarianManager?.installReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });

  // Install Cursor read permission hook for screenshot access.
  ipcMain.handle(OnboardingIPCChannels.INSTALL_CURSOR_HOOK, () => {
    return librarianManager?.installCursorReadPermissionHook() ?? { success: false, message: 'Manager not ready' };
  });
}


/**
 * Check permissions and return status.
 */
async function checkPermissions(): Promise<{ accessibilityGranted: boolean }> {
  if (!nativeHelper) {
    return { accessibilityGranted: false };
  }
  try {
    return await nativeHelper.checkPermissions();
  } catch (error) {
    log.error('Failed to check permissions:', error);
    return { accessibilityGranted: false };
  }
}

/**
 * Broadcast transcription events to all renderer windows.
 */
function broadcastTranscribeEvents(): void {
  if (!transcriberManager) return;

  transcriberManager.on('statusChanged', (status) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.STATUS_CHANGED, status);
      }
    });
    
    // Update clipboard history window's recording state
    // This ensures blur event doesn't hide the app when recording is active
    clipboardHistoryWindow?.setRecordingActive(status === 'recording');

    // Update dynamic island with recording state transitions.
    if (dynamicIslandManager) {
      if (status === 'silentStacking') {
        dynamicIslandManager.setState('silentStacking');
      } else if (status === 'recording') {
        dynamicIslandManager.setState('recording');
      } else if (status === 'transcribing') {
        dynamicIslandManager.setState('transcribing');
      } else if (status === 'idle') {
        dynamicIslandManager.updateDrawerTranscript('');
        // Don't immediately dismiss - let transcript display timeout handle it.
        if (dynamicIslandManager.getState() !== 'showing-transcript') {
          dynamicIslandManager.setState('idle');
        }
      }
    }
    
    // Force Dock visibility when showInDock is enabled.
    if (process.platform === 'darwin' && preferencesManager) {
      const showInDock = shouldUseClipboardAppWindowMode();
      if (showInDock) {
        app.dock.show();
      }
    }
  });

  // Standard mode no longer shows live preview in the drawer.
  // The left pill displays "Recording" / "Transcribing" status instead.
  // Hot Mic still uses the drawer via its own path.

  transcriberManager.on('result', (text) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.RESULT, text);
      }
    });
    // Send final transcript to the dynamic island for display.
    dynamicIslandManager?.sendTranscript(text, true);

    // Record transcription metrics
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    metricsManager?.recordTranscription(wordCount);
  });

  transcriberManager.on('verbalCommand', () => {
    metricsManager?.recordVerbalCommand();
    quotaManager?.updateUsage('portable_commands', 1);
  });

  // Forward detected command names to the dynamic island for highlighting.
  transcriberManager.on('commandsDetected', (commandNames: string[]) => {
    if (dynamicIslandManager) {
      commandNames.forEach((name: string) => {
        dynamicIslandManager?.sendCommandDetected(name.toLowerCase(), 0, 0);
      });
    }
  });

  transcriberManager.on('autostackCreated', () => {
    metricsManager?.recordAutostackCreated();
  });

  transcriberManager.on('error', (error) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.ERROR, error.message);
      }
    });
  });

  transcriberManager.on('parakeetSetupProgress', (progress) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.PARAKEET_SETUP_PROGRESS, progress);
      }
    });
  });

  transcriberManager.on('hotkeyChanged', (hotkey) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.HOTKEY_CHANGED, hotkey);
      }
    });
  });

  transcriberManager.on('stackChanged', (count) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('transcribe:stackChanged', count);
      }
    });
    // Forward stack count to the Dynamic Island for pipe display.
    dynamicIslandManager?.updateStackCount(count);
  });

  // Forward standard recording audio levels to the Dynamic Island for waveform.
  transcriberManager.on('audioLevel', (level: number) => {
    dynamicIslandManager?.updateStandardAudioLevel(level);
  });

  // Track if quota just exhausted - skip paste-success to preserve temporary status.
  let quotaJustExhausted = false;
  
  transcriberManager.on('paste-success', (_transcription) => {
    // If quota was just exhausted, skip the normal done state to preserve temporary status.
    if (quotaJustExhausted) {
      quotaJustExhausted = false;
      return;
    }
    dynamicIslandManager?.updateStackCount(0);
    dynamicIslandManager?.updateDrawerTranscript('');
    dynamicIslandManager?.setState('idle');
  });
  
  transcriberManager.on('paste-failed', (_message, _transcription) => {
    return;
  });
  
  // Confirmation state events for cursor status widget
  transcriberManager.on('confirmation-show', () => {
    return;
  });
  
  transcriberManager.on('confirmation-hide', () => {
    return;
  });
  
  // Handle quota exhausted events - show a temporary status at cursor and broadcast to windows.
  transcriberManager.on('quotaExhausted', (data: { feature: 'priorityMic' | 'autoStack'; used: number; limit: number }) => {
    const { feature, used, limit } = data;
    const featureName = feature === 'priorityMic' ? 'priority mic minutes' : 'auto-stacks';
    const limitDisplay = feature === 'priorityMic' ? `${Math.floor(limit / 60)} minutes` : `${limit} stacks`;
    
    // Show message at cursor for auto-stack quota exhaustion.
    if (feature === 'autoStack' && cursorStatusManager) {
      quotaJustExhausted = true;
      cursorStatusManager.setScreenshotCount(0);
      cursorStatusManager.setStateWithData('paste-failed', {
        transcription: 'Transcript saved — open Field Theory to add screenshots',
        pasteFailed: true,
      });
    }
    
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('quota:exhausted', { feature, used, limit, featureName, limitDisplay });
      }
    });
    
  });
  
  // Handle stacking disabled during recording - screenshot taken but quota exhausted.
  transcriberManager.on('stackingDisabled', (data: { itemId: number; message: string }) => {
    if (cursorStatusManager) {
      cursorStatusManager.showNoTargetError(data.message);
    }
  });

}

/**
 * Broadcast audio state changes to all renderer windows.
 */
function broadcastStateChanged(): void {
  if (!audioManager) return;

  const state = audioManager.getState();

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(AudioIPCChannels.STATE_CHANGED, state);
    }
  });
}

/**
 * Initialize the audio management system.
 * This sets up the native helper, audio manager, and tray integration.
 */
async function initAudioSystem(checkForUpdatesCallback?: () => void): Promise<void> {

  // Initialize preferences manager first to load saved priority device
  if (!preferencesManager) {
    preferencesManager = new PreferencesManager();
    await preferencesManager.load();
  }

  log.info('[audio-startup] === BOOT TIMELINE (ready handler): +%dms since module load', Date.now() - BOOT_MARK);
  nativeHelper = new NativeHelper();
  nativeHelper.start();
  log.info('[audio-startup] after nativeHelper.start(): +%dms', Date.now() - BOOT_MARK);
  nativeHelper.warmupAudio();
  log.info('[audio-startup] after nativeHelper.warmupAudio() call (async): +%dms', Date.now() - BOOT_MARK);

  nativeHelper.on('frontmostAppChanged', (appInfo) => {
    rememberCommandTargetApp(appInfo);
    if (isAlfredApp(appInfo)) {
      hideFieldTheoryForAlfred();
    }
  });

  // Hide clipboard history when another app (like Alfred/Spotlight) becomes active.
  // NSPanel windows don't always trigger blur events on other panels, so we use
  // app-level blur detection with a small delay to check if any Field Theory window
  // still has focus.
  app.on('browser-window-blur', () => {
    const historyWindow = clipboardHistoryWindow;
    const shouldAutoHide = historyWindow?.shouldAutoHideOnBlur() ?? false;
    if (!shouldAutoHide) return;
    if (!historyWindow) return;

    setTimeout(() => {
      if (!clipboardHistoryWindow || clipboardHistoryWindow !== historyWindow) {
        return;
      }

      const recentNativeBlur = historyWindow.hadRecentNativeWindowBlur(150);
      if (recentNativeBlur) {
        return;
      }

      void historyWindow.dismissForExternalBlur('app-browser-window-blur', 0);
    }, 50);
  });
  
  audioManager = new AudioManager(nativeHelper);

  // Load saved priority device from preferences
  const prefs = preferencesManager.get();
  if (prefs.priorityDeviceId) {
    audioManager.setSavedPriorityDeviceId(prefs.priorityDeviceId);
  }
  // Load favorite device name for auto-reconnect
  if (prefs.favoriteDeviceName) {
    audioManager.setFavoriteDeviceName(prefs.favoriteDeviceName);
  }
  // Save favorite device name when it changes
  audioManager.setOnFavoriteChanged(async (name) => {
    log.info('Saving favorite device to prefs:', name);
    if (preferencesManager) {
      await preferencesManager.save({ favoriteDeviceName: name });
      log.info('Favorite device saved successfully');
    }
  });
  // Save priority device ID when it changes (ensures all paths save correctly)
  audioManager.setOnPriorityChanged(async (deviceId) => {
    log.info('Saving priority device to prefs:', deviceId);
    if (preferencesManager) {
      await preferencesManager.save({ priorityDeviceId: deviceId });
      log.info('Priority device saved successfully');
    }
  });

  audioManager.on('stateChanged', () => {
    broadcastStateChanged();
  });

  // Track priority mic minutes (time the mic is locked)
  audioManager.on('priorityMicMinute', () => {
    metricsManager?.recordPriorityMicMinute();
  });

  log.info('[audio-startup] before audioManager.init(): +%dms', Date.now() - BOOT_MARK);
  await audioManager.init();
  log.info('[audio-startup] after audioManager.init(): +%dms', Date.now() - BOOT_MARK);

  trayManager = new TrayManager(audioManager, undefined, preferencesManager);

  // Start recording callback - toggles recording via transcriberManager.
  // Wrapped in a function that checks if transcriberManager is ready.
  const startRecordingCallback = () => {
    if (transcriberManager) {
      transcriberManager.toggleRecording();
    }
  };

  // Take screenshot callback - triggers region selection screenshot.
  const takeScreenshotCallback = async () => {
    if (clipboardManager) {
      const id = await clipboardManager.captureScreenshot({ region: true });
      if (id > 0) {
        routeCapturedItemToActiveSession(id);
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
          }
        });
      }
    }
  };

  // Take full screen screenshot callback.
  const takeFullScreenCallback = async () => {
    if (clipboardManager) {
      const id = await clipboardManager.captureScreenshot({ fullScreen: true });
      if (id > 0) {
        routeCapturedItemToActiveSession(id);
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
          }
        });
      }
    }
  };

  // Take active window screenshot callback.
  const takeActiveWindowCallback = async () => {
    if (clipboardManager) {
      const id = await clipboardManager.captureScreenshot({ activeWindow: true });
      if (id > 0) {
        routeCapturedItemToActiveSession(id);
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
          }
        });
      }
    }
  };

  trayManager.init(showSettingsInClipboardWindow, checkForUpdatesCallback, startRecordingCallback, takeScreenshotCallback, takeFullScreenCallback, takeActiveWindowCallback, showMainWindow);

  // Set up callback to show onboarding window from tray menu
  trayManager.setShowOnboardingCallback(() => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    const prefs = preferencesManager?.get();
    const startStep = prefs?.onboardingStep ?? OnboardingStep.PERMISSIONS;
    onboardingWindow.show(startStep);
  });

  // Set up callback to check if user is logged in
  trayManager.setIsLoggedInCallback(() => {
    const session = authManager?.getSession();
    return !!session?.user?.email;
  });

  // Set up callback to open developer tools
  trayManager.setOpenDevToolsCallback(() => {
    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.openDevTools();
    }
  });

}

/**
 * Initialize the transcription system.
 */
async function initTranscriberSystem(): Promise<void> {
  if (!nativeHelper) {
    log.error('Cannot initialize transcriber - nativeHelper not available');
    return;
  }

  // Initialize preferences manager if needed (already loaded in initAudioSystem)
  if (!preferencesManager) {
    preferencesManager = new PreferencesManager();
    await preferencesManager.load();
  }

  if (VISION_BUILD_ENABLED) {
    if (!gazeDebugOverlayManager) {
      gazeDebugOverlayManager = new GazeDebugOverlayManager(preferencesManager);
      gazeDebugOverlayManager.on('stateChanged', (state) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.DEBUG_OVERLAY_STATE_CHANGED, state);
          }
        });
      });
      await gazeDebugOverlayManager.initFromPreferences();
    }

    if (!gazeScreenOverlayManager) {
      gazeScreenOverlayManager = new GazeScreenOverlayManager(preferencesManager);
      gazeScreenOverlayManager.on('stateChanged', (state) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.SCREEN_OVERLAY_STATE_CHANGED, state);
          }
        });
      });
      await gazeScreenOverlayManager.initFromPreferences();
    }

    // Initialize gaze tracking manager (capture + calibration + dwell/focus).
    if (!gazeTrackingManager) {
      gazeTrackingManager = new GazeTrackingManager(nativeHelper, preferencesManager);

      gazeTrackingManager.on('statusChanged', (status) => {
        gazeDebugOverlayManager?.updateStatus(status);
        gazeScreenOverlayManager?.updateStatus(status);
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.STATUS_CHANGED, status);
          }
        });
      });

      gazeTrackingManager.on('sample', (sample) => {
        gazeDebugOverlayManager?.updateSample(sample);
        gazeScreenOverlayManager?.updateSample(sample);
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.SAMPLE, sample);
          }
        });
      });

      gazeTrackingManager.on('calibrationChanged', (state) => {
        gazeDebugOverlayManager?.updateCalibration(state);
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.CALIBRATION_CHANGED, state);
          }
        });
      });

      gazeTrackingManager.on('dwellTriggered', (event) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.DWELL_TRIGGERED, event);
          }
        });
      });

      gazeTrackingManager.on('highlightWindow', (windowSnapshot) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(GazeIPCChannels.HIGHLIGHT_WINDOW, windowSnapshot);
          }
        });
      });

      await gazeTrackingManager.init();
      gazeDebugOverlayManager?.updateStatus(gazeTrackingManager.getStatus());
      gazeScreenOverlayManager?.updateStatus(gazeTrackingManager.getStatus());
      gazeDebugOverlayManager?.updateCalibration(gazeTrackingManager.getCalibrationState());
      const latestSample = gazeTrackingManager.getLatestSample();
      if (latestSample) {
        gazeDebugOverlayManager?.updateSample(latestSample);
        gazeScreenOverlayManager?.updateSample(latestSample);
      }
    }
  }

  // Initialize clipboard manager with hotkeys and retention from preferences
  clipboardManager = new ClipboardManager({
    retentionDays: preferencesManager.get().dataRetentionDays ?? -1,
  });
  
  // Broadcast ITEM_ADDED when clipboard polling detects new items
  clipboardManager.setOnItemAdded((id) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
      }
    });
  });

  // Bring onboarding window to front on any clipboard copy
  // This helps users who copied the OTP code and need to get back to Field Theory
  clipboardManager.setOnClipboardChange(() => {
    if (onboardingWindow?.isVisible()) {
      onboardingWindow.show();
    }
  });

  const prefs = preferencesManager.get();
  clipboardManager.loadHotkeysFromPreferences(
    prefs.clipboardScreenshotHotkey,
    prefs.clipboardHistoryHotkey,
    resolveClipboardFullScreenHotkeyPreference(prefs),
    prefs.clipboardActiveWindowHotkey
  );

  // Apply user-configured data retention on startup.
  // This cleans up items older than the user's retention setting.
  const retentionDays = prefs.dataRetentionDays ?? -1;
  if (retentionDays !== -1) {
    clipboardManager.applyDataRetention(retentionDays);
  }
  
  // Load continuous context preferences
  // Continuous Context feature disabled for now
  // clipboardManager.loadContinuousContextFromPreferences(
  //   prefs.continuousContextEnabled,
  //   prefs.continuousContextHotkey
  // );

  // Listen for continuous context state changes and broadcast to renderer
  // Disabled for now
  // clipboardManager.on('continuousContextChanged', (state: ContinuousContextState) => {
  //   BrowserWindow.getAllWindows().forEach((window) => {
  //     if (!window.isDestroyed()) {
  //       window.webContents.send(ClipboardIPCChannels.CONTINUOUS_CONTEXT_CHANGED, state);
  //     }
  //   });
  // });
  
  // When continuous context captures a screenshot, notify all windows
  // Disabled for now
  // clipboardManager.on('continuousContextScreenshot', (itemId: number) => {
  //   BrowserWindow.getAllWindows().forEach((window) => {
  //     if (!window.isDestroyed()) {
  //       window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, itemId);
  //     }
  //   });
  // });
  
  // Hotkeys will be registered after checking onboarding status (see below in app.whenReady).

  // Initialize quota manager (will be configured after auth is ready).
  quotaManager = new QuotaManager();
  accountStatusManager = new AccountStatusManager();

  // Initialize librarian manager for watching markdown reading files.
  librarianManager = new LibrarianManager();
  recentManager = new RecentManager();

  // Initialize bookmarks manager for reading synced X bookmarks.
  bookmarksManager = new BookmarksManager();

  // Broadcast artifact-added events to all windows and auto-show if enabled
  librarianManager.on('reading-added', async (reading: Reading) => {

    // Record librarian artifact created metric
    metricsManager?.recordLibrarianArtifactCreated();

    // Reset prompt counter - new artifact means fresh start
    librarianManager!.resetCounter();

    // Broadcast to all windows (updates reading lists)
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingAdded', reading);
      }
    });

    // Check if muted for today - halts interruption even if existing sessions create artifacts
    const isMuted = librarianManager!.isMutedForToday();
    if (isMuted) {
      return;
    }

    // If the Field Theory window is already open, the user may be typing,
    // reading, searching, or managing another surface. Save and index the
    // artifact, but do not take over the current view.
    if (clipboardHistoryWindow?.isVisible()) {
      clipboardHistoryWindow.getWindow()?.webContents.send('librarian:newReadingAvailable', reading.path);
      clipboardHistoryWindow.playArtifactDiscoverySound();
      return;
    }

    // Auto-show the window if enabled
    if (librarianManager!.isAutoShowEnabled()) {
      const shouldStealFocus = librarianManager!.doesAutoShowStealFocus();
      pendingAutoOpenReading = reading.path;
      if (!clipboardHistoryWindow) {
        clipboardHistoryWindow = initClipboardHistoryWindow();
      }

      const boundsToUse = restoreClipboardHistoryBounds('library');
      suspendDynamicIslandFocusForClipboardHistory('show-auto-artifact');
      clipboardHistoryWindow.show(boundsToUse, false, true, false, shouldStealFocus);
      // Showing/focusing clipboard history can corrupt transparent overlay backing
      // on some macOS compositor paths — reinforce window properties.
      cursorStatusManager?.refreshWindowProperties();
      dynamicIslandManager?.refreshWindowProperties('clipboard-history:show-auto-artifact');

      // Only bounce dock if the icon is visible (showInDock mode).
      // Bouncing when hidden can cause the dock icon to reappear.
      const showInDock = shouldUseClipboardAppWindowMode();
      if (app.dock && showInDock) {
        app.dock.bounce('informational');
      }
      clipboardHistoryWindow?.playArtifactDiscoverySound();
    } else {
      // Just play the discovery sound if window exists.
      clipboardHistoryWindow?.playArtifactDiscoverySound();
    }
  });

  // Broadcast reading-updated events to all windows
  librarianManager.on('reading-updated', (reading: ReadingMeta) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingUpdated', reading);
      }
    });
  });

  librarianManager.on('reading-renamed', (event: ReadingRenameEvent) => {
    traceLibraryRename('broadcast-reading-renamed', {
      traceId: event.traceId,
      oldPath: event.oldPath,
      newPath: event.reading.path,
      ageMs: event.emittedAt ? Date.now() - event.emittedAt : null,
    });
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingRenamed', event);
      }
    });
  });

  // Broadcast reading-removed events to all windows
  librarianManager.on('reading-removed', (filePath: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingRemoved', filePath);
      }
    });
  });

  // Connect quota manager to tray for menu bar display
  if (trayManager) {
    trayManager.setQuotaManager(quotaManager);
  }

  // Broadcast tier changes to all windows so UI can update in real-time.
  // Also persist tier locally so Pro users don't get downgraded on startup.
  quotaManager.on('tierChanged', (tier) => {
    // Save tier to preferences for offline/startup use
    if (preferencesManager) {
      preferencesManager.save({ cachedTier: tier as 'free' | 'pro' }).catch((err) => {
        log.warn('Failed to save cached tier:', err);
      });
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('tier:changed', tier);
      }
    });
  });

  // Broadcast trial-state changes (pro / trial / expired) to all windows.
  quotaManager.on('stateChanged', (state) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('state:changed', state);
      }
    });
  });

  // Broadcast quota changes to all windows so usage stats can update in real-time.
  quotaManager.on('quotaChanged', () => {
    const formatted = {
      priorityMic: quotaManager!.formatPriorityMicUsage(),
      autoStack: quotaManager!.formatAutoStackUsage(),
      textImprove: quotaManager!.formatTextImproveUsage(),
      portableCommands: quotaManager!.formatPortableCommandsUsage(),
    };
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('quota:changed', formatted);
      }
    });
  });

  // Initialize cursor status indicator BEFORE transcriberManager so it can be passed in.
  cursorStatusManager = new CursorStatusManager();
  const cursorStatusEnabled = preferencesManager.getPreference('cursorStatusEnabled') ?? true;
  cursorStatusManager.setEnabled(cursorStatusEnabled);
  const hideStatusLabels = preferencesManager.getPreference('hideStatusLabels') ?? false;
  cursorStatusManager.setHideLabels(hideStatusLabels);

  // Initialize the dynamic island overlay (fixed near the notch, shows transcript + history).
  dynamicIslandManager = new DynamicIslandManager();
  const hotMicEnabledOnLaunch = preferencesManager.getPreference('hotMicEnabled') ?? false;
  dynamicIslandManager.setEnabled(true);
  dynamicIslandManager.setInputMode(resolveInputModeFromHotMicEnabled(hotMicEnabledOnLaunch));
  dynamicIslandManager.setClipboardManager(clipboardManager);
  dynamicIslandManager.setGeometryTuning(getHotMicIslandGeometryFromPreferences());
  dynamicIslandManager.setDrawerTextSize(getHotMicDrawerTextSizeFromPreferences());
  dynamicIslandManager.setStayOnLaptop(preferencesManager.getPreference('hotMicIslandStayOnLaptop') ?? false);
  dynamicIslandManager.setAutoHide(preferencesManager.getPreference('hotMicIslandAutoHide') ?? false);

  // Hook installer must exist before the attention manager so the manager's
  // tool filter can be seeded from install status (and re-synced on toggle).
  agentHookInstaller = new AgentHookInstaller();

  // Watch ~/.fieldtheory/agents/state/ for agent-waiting snapshots and
  // surface them as glyphs in the Dynamic Island.
  agentAttentionManager = new AgentAttentionManager();
  agentAttentionManager.setToolFilter(agentHookInstaller.getStatus());
  agentAttentionManager.setLayoutProvider({
    listWindows: () => nativeHelper?.getWindowList() ?? Promise.resolve([]),
    listDisplays: () =>
      screen.getAllDisplays().map(d => ({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      })),
  });
  agentAttentionManager.on('change', (agents) => {
    dynamicIslandManager?.setWaitingAgents(agents);
  });
  agentAttentionManager.on('layout', (layout) => {
    dynamicIslandManager?.setAgentLayout(layout);
  });
  agentAttentionManager.start();
  dynamicIslandManager.setWaitingAgents(agentAttentionManager.getWaiting());
  ipcMain.handle('agent:focus', async (_e, agentId: string) => {
    return agentAttentionManager?.focus(agentId) ?? false;
  });
  ipcMain.handle('agent:setSynthetic', async (_e, count: number) => {
    agentAttentionManager?.setSynthetic(Math.max(0, Math.floor(count)));
  });

  // Local agent kickoff — invokes the locally-installed Claude Code or Codex
  // CLI against a markdown file in the user's library, then appends a summary
  // footer to the file. Progress events stream to whichever window invoked it.
  agentKickoffManager = new AgentKickoffManager();
  agentKickoffManager.on('progress', (event: AgentKickoffProgressEvent) => {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('agent:kickoffProgress', event);
    });
  });
  agentKickoffManager.on('status', (event: AgentKickoffStatusEvent) => {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('agent:kickoffStatus', event);
    });
  });
  ipcMain.handle('agent:kickoff', async (_e, args: AgentKickoffArgs): Promise<AgentKickoffStartResult> => {
    if (!agentKickoffManager) {
      return {
        ok: false,
        runId: '',
        error: 'Agent kickoff manager unavailable',
      };
    }
    return agentKickoffManager.start(args);
  });
  ipcMain.handle('agent:cancelKickoff', async (_e, runId: string): Promise<boolean> => {
    return agentKickoffManager?.cancel(runId) ?? false;
  });

  // Dev-only: cycle synthetic waiting-agent count to stress-test Dynamic
  // Island pill sizing. 0 → 1 → 2 → 3 → 5 → 0. Look for clipped rounded
  // corners as the count changes, with recording on/off.
  const syntheticAgentCounts = [0, 1, 2, 3, 5];
  let syntheticAgentIndex = 0;
  globalShortcut.register('CommandOrControl+Alt+Shift+A', () => {
    syntheticAgentIndex = (syntheticAgentIndex + 1) % syntheticAgentCounts.length;
    const count = syntheticAgentCounts[syntheticAgentIndex];
    agentAttentionManager?.setSynthetic(count);
  });

  const syncAgentToolFilter = () => {
    if (!agentHookInstaller || !agentAttentionManager) return;
    agentAttentionManager.setToolFilter(agentHookInstaller.getStatus());
  };
  ipcMain.handle('agent-hooks:install', async (_e, targets: InstallTargets) => {
    const result = agentHookInstaller?.install(targets ?? {});
    syncAgentToolFilter();
    return result;
  });
  ipcMain.handle('agent-hooks:uninstall', async (_e, targets: InstallTargets) => {
    const result = agentHookInstaller?.uninstall(targets ?? {});
    syncAgentToolFilter();
    return result;
  });
  ipcMain.handle('agent-hooks:status', async () => {
    return agentHookInstaller?.getStatus();
  });

  // Now create transcriberManager with cursorStatusManager.
  log.info('[audio-startup] before transcriberManager.init(): +%dms', Date.now() - BOOT_MARK);
  transcriberManager = new TranscriberManager(nativeHelper, preferencesManager, clipboardManager, quotaManager, audioManager ?? undefined, cursorStatusManager);
  transcriberManager.setFieldTheoryMarkdownInsertionTarget({
    isAvailable: hasFocusedFieldTheoryMarkdownInsertionTarget,
    insertText: insertTextIntoFocusedFieldTheoryMarkdown,
  });
  await transcriberManager.init();
  log.info('[audio-startup] after transcriberManager.init(): +%dms', Date.now() - BOOT_MARK);
  broadcastTranscribeEvents();

  // Pre-warm transcription engine so first use is fast (Parakeet model load, etc.).
  log.info('[audio-startup] calling transcriberManager.warmup() (async): +%dms', Date.now() - BOOT_MARK);
  transcriberManager.warmup().catch((err) => {
    log.warn('Transcription warmup failed (non-fatal): %s', err?.message || err);
  });

  // Wire up native helper for fast sound playback and preload all sounds.
  // This gives ~1-5ms latency instead of ~50-100ms with afplay.
  if (nativeHelper) {
    const transcriberSoundManager = transcriberManager.getSoundManager();
    transcriberSoundManager.setNativeHelper(nativeHelper);

    // Preload all sounds once (shared cache in native helper).
    log.info('[audio-startup] calling preloadAllSounds() (async): +%dms', Date.now() - BOOT_MARK);
    transcriberSoundManager.preloadAllSounds().catch((err) => {
    });
  }

  // Initialize Hot Mic manager for continuous voice input.
  if (nativeHelper && preferencesManager) {
    const soundMgr = transcriberManager.getSoundManager();
    hotMicManager = new HotMicManager(nativeHelper, preferencesManager, soundMgr);
    hotMicManager.setFieldTheoryMarkdownInsertionTarget({
      isAvailable: hasFocusedFieldTheoryMarkdownInsertionTarget,
      insertText: insertTextIntoFocusedFieldTheoryMarkdown,
    });
    hotMicManager.setCursorStatusManager(cursorStatusManager);
    hotMicManager.setMetricsWordsRecorder((wordCount: number) => {
      metricsManager?.recordHotMicTranscribedWords(wordCount);
    });
    if (clipboardManager) {
      hotMicManager.setClipboardManager(clipboardManager);
    }
    if (dynamicIslandManager) {
      hotMicManager.setDynamicIslandManager(dynamicIslandManager);
      dynamicIslandManager.on('toggleMute', () => {
        hotMicManager?.toggleMute();
      });
      dynamicIslandManager.on('dismiss-transcript', () => {
        hotMicManager?.dismissCurrentTranscript();
      });
      dynamicIslandManager.on('cancel-session', () => {
        // Cancel whichever recording mode is active and collapse the tray.
        const transcriberStatus = transcriberManager?.getStatus();
        if (transcriberStatus === 'silentStacking') {
          transcriberManager?.cancelSilentStacking();
        } else if (transcriberStatus === 'recording') {
          transcriberManager?.toggleRecording();
        } else if (transcriberStatus === 'idle' && transcriberManager && transcriberManager.getStackLength() > 0) {
          transcriberManager.clearStack();
          // Explicitly reset DI state and stack count so both pills collapse.
          // clearStack emits stackChanged(0) but it travels through multiple hops;
          // sending directly ensures the right pill's pipeCount resets immediately.
          dynamicIslandManager?.updateStackCount(0);
          dynamicIslandManager?.setState('idle');
        }
        if (hotMicManager?.isActive || getCurrentInputMode() === 'hot-mic') {
          applyHotMicMode('deactivate');
          void applyInputMode('standard');
        }
      });
      dynamicIslandManager.on('open-field-theory', async () => {
        if (!clipboardHistoryWindow) {
          clipboardHistoryWindow = initClipboardHistoryWindow();
        }
        if (clipboardHistoryWindow.isShowing()) {
          await clipboardHistoryWindow.hideAndRestorePreviousApp('dynamic-island-toggle-history-window');
          cursorStatusManager?.refreshWindowProperties();
          dynamicIslandManager?.refreshWindowProperties('clipboard-history:hide-open-field-theory');
          return;
        }

        // Clicking the Dynamic Island while Field Theory is focused causes a blur-hide
        // first; suppress immediate reopen so second click behaves like a true toggle-close.
        if (
          clipboardHistoryLastHideReason === 'window-blur-handler' &&
          Date.now() - clipboardHistoryLastHideAt <= DYNAMIC_ISLAND_BLUR_TOGGLE_SUPPRESS_MS
        ) {
          return;
        }

        clipboardHistoryWindow.playOpenSound();
        const boundsToUse = restoreClipboardHistoryBounds();
        suspendDynamicIslandFocusForClipboardHistory('show-open-field-theory');
        clipboardHistoryWindow.capturePreviousAppAndShow(boundsToUse, false, true);
        // Opening clipboard history while recording can affect overlay transparency;
        // refresh transparent overlay window properties to keep them stable.
        cursorStatusManager?.refreshWindowProperties();
        dynamicIslandManager?.refreshWindowProperties('clipboard-history:show-open-field-theory');
      });
    }
    hotMicManager.setTranscriberStatusGetter(() => transcriberManager?.getStatus() ?? 'idle');
    hotMicManager.setTranscribeFunction((wavPath) => transcriberManager!.transcribeAudioForHotMic(wavPath));
    hotMicManager.setWarmupFunction(() => transcriberManager!.warmupForHotMic());
    hotMicManager.setFallbackCheckFunction(() => transcriberManager?.lastHotMicUsedWhisperFallback ?? false);
    hotMicManager.setEngineStatusGetter(() => transcriberManager!.getHotMicEngineStatus());

    // Wire hotkey delegation: when Hot Mic is active, hotkey presses go to it
    transcriberManager.setHotMicDelegate({
      get isActive() { return hotMicManager?.isActive ?? false; },
      handleShortPress: () => hotMicManager?.handleShortPress() ?? Promise.resolve(),
      yieldToTranscriber: () => hotMicManager?.yieldToTranscriber() ?? Promise.resolve(),
      resumeAfterTranscriber: () => hotMicManager?.resumeAfterTranscriber() ?? Promise.resolve(),
    });

    // Broadcast state changes to all windows
    if (audioManager) {
      hotMicManager.setAudioManager(audioManager);
    }

    hotMicManager.on('stateChanged', (state: string) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('hotmic:stateChanged', state);
        }
      });
    });
    hotMicManager.on('runtimeStatusChanged', () => {
      broadcastHotMicRuntimeStatus();
    });

    hotMicManager.on('statusChanged', (status: { state: string; muted: boolean }) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('hotmic:statusChanged', status);
        }
      });
    });

    hotMicManager.on('toggleInputModeRequested', () => {
      const nextMode: InputMode = getCurrentInputMode() === 'hot-mic' ? 'standard' : 'hot-mic';
      void applyInputMode(nextMode);
    });

    hotMicManager.on('inputModeResetRequested', () => {
      void applyInputMode('standard');
    });

    hotMicManager.on('screenshotStackChanged', (count: number) => {
      dynamicIslandManager?.updateStackCount(count);
    });

    broadcastInputMode(getCurrentInputMode());
  }

  // Wire up confirmation response from cursor status widget to transcriber manager
  cursorStatusManager.on('confirmation-response', ({ abandon }) => {
    transcriberManager?.handleConfirmationResponse(abandon);
  });
  
  // Shift cursor status indicator right during screenshot to avoid overlap.
  clipboardManager.on('screenshotStart', () => {
    cursorStatusManager?.setScreenshotMode(true);
  });
  clipboardManager.on('screenshotEnd', () => {
    cursorStatusManager?.setScreenshotMode(false);
  });
  
  // Initialize diagnostics collector for remote troubleshooting.
  diagnosticsCollector = new DiagnosticsCollector(preferencesManager);
  if (transcriberManager) {
    diagnosticsCollector.setModelManager(transcriberManager.getModelManager());
    diagnosticsCollector.setTranscriberManager(transcriberManager);
  }
  if (audioManager) {
    diagnosticsCollector.setAudioManager(audioManager);
  }

  // Initialize Squares window management.
  // Window management.
  squaresManager = new SquaresManager(preferencesManager, nativeHelper!);

  // Broadcast Squares events to all renderer windows.
  squaresManager.on('actionExecuted', (action: SquaresAction) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(SquaresIPCChannels.ACTION_EXECUTED, action);
      }
    });
  });

  squaresManager.on('configChanged', (config: any) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(SquaresIPCChannels.CONFIG_CHANGED, config);
      }
    });
  });

  // Initialize commands manager for portable commands feature.
  commandsManager = new CommandsManager();

  // Wire up commands manager to transcriber and hot mic for command detection.
  if (transcriberManager) {
    // Connect Squares for voice-triggered window management (e.g., "grid", "focus").
    if (squaresManager) {
      transcriberManager.setSquaresManager(squaresManager);
      if (hotMicManager) {
        hotMicManager.setSquaresManager(squaresManager);
      }
    }
    transcriberManager.setCommandsManager(commandsManager);
  }
  if (hotMicManager) {
    hotMicManager.setCommandsManager(commandsManager);
    // Connect app switcher for voice-triggered app activation (e.g., "open chrome").
    // Use closures that read clipboardHistoryWindow at call time — it may be null during
    // init but will be set by the time Hot Mic is actually used.
    hotMicManager.setAppSwitcher({
      getRunningApps: async () => {
        if (!clipboardHistoryWindow) return [];
        return clipboardHistoryWindow.getRunningApps();
      },
      activateApp: async (bundleId: string) => {
        if (!clipboardHistoryWindow) return false;
        return clipboardHistoryWindow.activateApp(bundleId);
      },
    });
  }

  // Initialize multi-directory watching from settings file.
  await commandsManager.initialize();

  // Migrate legacy single-directory setting to multi-directory system.
  // If user has a commandsDirectory set but watchedDirs is empty, add it to watchedDirs.
  const savedCommandsDir = preferencesManager.getPreference('commandsDirectory');
  if (savedCommandsDir) {
    const watchedDirs = commandsManager.getWatchedDirs();
    if (watchedDirs.length === 0) {
      // Migrate: add legacy directory as first watched directory
      await commandsManager.addWatchedDir(savedCommandsDir);
      // Only set legacy directoryPath during migration (when no watchedDirs exist yet)
      // DO NOT call setDirectory when watchedDirs already has entries - it clears all commands!
      await commandsManager.setDirectory(savedCommandsDir);
    }
  }
  
  // Broadcast commands changes to all windows.
  commandsManager.on('commandsChanged', (commands: PortableCommand[]) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(CommandsIPCChannels.COMMANDS_CHANGED, commands.map((cmd: PortableCommand) => ({
          name: cmd.name,
          displayName: cmd.displayName,
          filePath: cmd.filePath,
        })));
      }
    });
  });
  
  commandsManager.on('directoryChanged', (directoryPath) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(CommandsIPCChannels.DIRECTORY_CHANGED, directoryPath);
      }
    });
  });

  // Initialize command launcher window for Cmd+Shift+K.
  // Pass nativeHelper for instant access to cached frontmost app info.
  commandLauncherWindow = new CommandLauncherWindow(nativeHelper ?? undefined, {
    getInitialDarkMode: () => preferencesManager?.getPreference('darkMode') ?? false,
  });
  commandLauncherWindow.preload();

  // Skip auto-paste only when draw canvas is actively visible
  transcriberManager.setSketchModeChecker(() => {
    return (clipboardHistoryWindow?.isSketchModeActive() && clipboardHistoryWindow?.isVisible()) ?? false;
  });

  // Initialize auth manager first - single source of truth for authentication.
  // Load Supabase credentials from .env.local file.
  const envVars = loadEnvVars();

  // Create UserDataManager for per-user data isolation.
  // Restore last known user from current-user.json so per-user paths work
  // immediately — no need to wait for auth to resolve.
  userDataManager = createUserDataManager();
  await userDataManager.restoreCurrentUser();

  // Set UserDataManager on managers BEFORE authManager.init().
  // authManager.init() may emit 'userChanged' during session restoration,
  // so managers must have their userDataManager ready to use per-user paths.
  if (preferencesManager) {
    preferencesManager.setUserDataManager(userDataManager);
    await preferencesManager.load();
  }
  if (clipboardManager) {
    clipboardManager.setUserDataManager(userDataManager);
  }
  if (librarianManager) {
    librarianManager.setUserDataManager(userDataManager);
    if (userDataManager.isLoggedIn()) {
      await librarianManager.reinitializeForUser();
    }
  }
  if (commandsManager) {
    commandsManager.setUserDataManager(userDataManager);
    // Reload per-user commands immediately if user was restored from disk.
    if (userDataManager.isLoggedIn()) {
      await commandsManager.reinitializeForUser();
    }
  }
  if (recentManager) {
    recentManager.setUserDataManager(userDataManager);
  }
  authManager = new AuthManager();
  authManager.setUserDataManager(userDataManager);

  taggedDocsManager = new TaggedDocsManager({
    dbPath: userDataManager.isLoggedIn()
      ? userDataManager.getUserDataPath('tagged.db')
      : userDataManager.getSharedDataPath('tagged.db'),
  });

  taggedDocsManager.on('updated', (docs: TaggedDoc[]) => {
    trayManager?.setTaggedDocsUnreadCount(docs.filter((doc) => doc.unread).length);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(TaggedDocsIPCChannels.UPDATED, docs);
      }
    });
  });

  taggedDocsManager.on('scanProgress', (progress: TaggedDocsScanProgress) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(TaggedDocsIPCChannels.SCAN_PROGRESS, progress);
      }
    });
  });

  // Initialize metrics manager BEFORE authManager.init() so it exists when userChanged fires.
  // "The metrics you see are the metrics we see."
  metricsManager = new MetricsManager(authManager);
  if (userDataManager) {
    metricsManager.setUserDataManager(userDataManager);
  }
  await metricsManager.init();

  // Register event handlers BEFORE authManager.init().
  // init() restores session and may emit 'userChanged' synchronously.
  authManager.on('userChanged', async (userId: string) => {
    // Reinitialize all managers with user-specific data
    if (preferencesManager) {
      await preferencesManager.load();

      // Reload hotkeys from freshly loaded preferences
      const prefs = preferencesManager.get();
      if (clipboardManager) {
        clipboardManager.loadHotkeysFromPreferences(
          prefs.clipboardScreenshotHotkey,
          prefs.clipboardHistoryHotkey,
          resolveClipboardFullScreenHotkeyPreference(prefs),
          prefs.clipboardActiveWindowHotkey
        );
      }
      // Reload audio manager preferences (may differ in per-user prefs)
      if (audioManager) {
        audioManager.setFavoriteDeviceName(prefs.favoriteDeviceName ?? null);
        // Restore priority device - must call setPriorityDevice directly since init() already ran
        if (prefs.priorityDeviceId) {
          await audioManager.setPriorityDevice(prefs.priorityDeviceId);
          log.info('Restored priority device from user prefs:', prefs.priorityDeviceId);
        }
        log.info('Reloaded favorite device from user prefs:', prefs.favoriteDeviceName);
      }

      // Re-apply per-user Dynamic Island tuning after preferences reload.
      dynamicIslandManager?.setGeometryTuning(getHotMicIslandGeometryFromPreferences());
      dynamicIslandManager?.setDrawerTextSize(getHotMicDrawerTextSizeFromPreferences());
      dynamicIslandManager?.setStayOnLaptop(prefs.hotMicIslandStayOnLaptop ?? false);
      dynamicIslandManager?.setAutoHide(prefs.hotMicIslandAutoHide ?? false);
      dynamicIslandManager?.setEnabled(true);
      dynamicIslandManager?.setInputMode(resolveInputModeFromHotMicEnabled(prefs.hotMicEnabled ?? false));
      broadcastInputMode(resolveInputModeFromHotMicEnabled(prefs.hotMicEnabled ?? false));
      await gazeTrackingManager?.reloadFromPreferences();
      await gazeDebugOverlayManager?.reloadFromPreferences();
      await gazeScreenOverlayManager?.reloadFromPreferences();
    }
    if (clipboardManager) {
      await clipboardManager.reinitializeForUser();
    }
    if (metricsManager) {
      await metricsManager.reinitializeForUser();
    }
    if (quotaManager) {
      // Set cached tier from user prefs before server sync (so Pro users stay Pro during sync)
      const prefs = preferencesManager?.get();
      if (prefs?.cachedTier) {
        quotaManager.setInitialTier(prefs.cachedTier);
      }
      quotaManager.reload();
    }
    if (librarianManager) {
      await librarianManager.reinitializeForUser();
    }
    if (commandsManager) {
      await commandsManager.reinitializeForUser();
    }
    refreshFieldTheorySyncServices();
    if (taggedDocsManager && userDataManager) {
      taggedDocsManager.setDatabasePath(userDataManager.getUserDataPath('tagged.db'));
      void taggedDocsManager.rescan();
    }
    // Register Hot Mic hotkey and auto-start if enabled (now that user prefs are loaded)
    if (hotMicManager) {
      hotMicManager.registerHotkey();
      hotMicManager.autoStartIfEnabled();
    }
  });

  // Listen for logout to clear manager state.
  authManager.on('userLoggedOut', async () => {
    if (preferencesManager) {
      await preferencesManager.resetForSignedOutState();
    }
    dynamicIslandManager?.setEnabled(false);
    dynamicIslandManager?.setGeometryTuning(DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING);
    dynamicIslandManager?.setDrawerTextSize(HOT_MIC_DRAWER_TEXT_SIZE_DEFAULT);
    await gazeTrackingManager?.setEnabled(false);
    await gazeDebugOverlayManager?.setEnabled(false);
    await gazeScreenOverlayManager?.setEnabled(false);
    if (clipboardManager) {
      clipboardManager.onUserLoggedOut();
    }
    if (metricsManager) {
      metricsManager.reset();
    }
    if (librarianManager) {
      await librarianManager.onUserLoggedOut();
    }
    if (commandsManager) {
      commandsManager.onUserLoggedOut();
    }
    refreshFieldTheorySyncServices();
    taggedDocsManager?.onUserLoggedOut();
    accountStatusManager?.setNeedsLogin();
  });

  // Listen for session changes (login/logout, token refresh)
  authManager.on('sessionChanged', async (session) => {
    logUserState(session ? 'login' : 'logout');
    taggedDocsManager?.setIdentity(session?.user?.email ?? null);

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('session-changed', session);
      }
    });

    // Sync quota data when session is restored
    if (session && quotaManager) {
      await quotaManager.reload();
    }
    if (session) {
      await accountStatusManager?.checkNow();
    } else {
      accountStatusManager?.setNeedsLogin();
    }
    refreshFieldTheorySyncServices();
  });

  // Forward auth debug events to all renderer windows for DevTools visibility
  authManager.on('authDebug', (event) => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('auth:debug', event);
      }
    });
  });

  // Now safe to init AuthManager - handlers are registered
  await authManager.init(envVars.supabaseUrl, envVars.supabaseAnonKey);

  // Handle system wake from sleep - check if token needs refresh.
  // Timers may not have fired while sleeping, so we check on wake.
  // Delay to allow DNS/network to come back online before attempting refresh.
  let wakeNetworkPoll: ReturnType<typeof setInterval> | null = null;
  let wakeNetworkTimeout: ReturnType<typeof setTimeout> | null = null;
  let wakeOverlayRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  const scheduleWakeOverlayRefresh = (reason: string): void => {
    if (wakeOverlayRefreshTimeout) {
      clearTimeout(wakeOverlayRefreshTimeout);
      wakeOverlayRefreshTimeout = null;
    }

    wakeOverlayRefreshTimeout = setTimeout(() => {
      wakeOverlayRefreshTimeout = null;
      cursorStatusManager?.refreshWindowProperties();
      dynamicIslandManager?.refreshWindowProperties(reason);
    }, 450);
  };

  powerMonitor.on('suspend', () => {
    log.info('[PowerMonitor] System going to sleep, stopping transcription servers');
    if (wakeOverlayRefreshTimeout) {
      clearTimeout(wakeOverlayRefreshTimeout);
      wakeOverlayRefreshTimeout = null;
    }
    transcriberManager?.stopMlxWhisperServer();
    void transcriberManager?.stopWhisperServer();
  });

  powerMonitor.on('resume', () => {
    log.info('[PowerMonitor] System resumed from sleep, checking token expiry');
    scheduleWakeOverlayRefresh('power-monitor:resume');

    // Pre-warm the configured transcription runtime if Hot Mic is active.
    if (hotMicManager?.isActive) {
      log.info('[PowerMonitor] Hot Mic active, pre-warming transcription runtime');
      transcriberManager?.warmup().catch(() => {});
    }

    // Cancel any previous wake poll (e.g., rapid sleep/wake cycles)
    if (wakeNetworkPoll) { clearInterval(wakeNetworkPoll); wakeNetworkPoll = null; }
    if (wakeNetworkTimeout) { clearTimeout(wakeNetworkTimeout); wakeNetworkTimeout = null; }

    setTimeout(() => {
      if (net.isOnline()) {
        authManager?.refreshIfExpiringSoon();
        return;
      }

      log.info('[PowerMonitor] Network not ready after wake, waiting for connectivity');
      wakeNetworkPoll = setInterval(() => {
        if (net.isOnline()) {
          if (wakeNetworkPoll) { clearInterval(wakeNetworkPoll); wakeNetworkPoll = null; }
          if (wakeNetworkTimeout) { clearTimeout(wakeNetworkTimeout); wakeNetworkTimeout = null; }
          log.info('[PowerMonitor] Network restored, refreshing token');
          authManager?.refreshIfExpiringSoon();
        }
      }, 5000);
      // Give up after 2 minutes
      wakeNetworkTimeout = setTimeout(() => {
        if (wakeNetworkPoll) { clearInterval(wakeNetworkPoll); wakeNetworkPoll = null; }
        log.warn('[PowerMonitor] Gave up waiting for network after wake');
      }, 120000);
    }, 3000);
  });

  powerMonitor.on('unlock-screen', () => {
    scheduleWakeOverlayRefresh('power-monitor:unlock-screen');
  });

  // The userChanged handler handles preference reloading when session is restored.
  // Don't call load() again here - it would race with the async handler.

  // Configure prompt engineer with Supabase URL for Edge Function calls.
  if (envVars.supabaseUrl) {
    setEngineerSupabaseUrl(envVars.supabaseUrl);
  }

  // Initialize quota manager with Supabase credentials and session getter.
  // Server is the single source of truth for usage data.
  if (quotaManager && envVars.supabaseUrl && envVars.supabaseAnonKey) {
    quotaManager.init(envVars.supabaseUrl, envVars.supabaseAnonKey, () => {
      const session = authManager?.getSession();
      if (!session) return null;
      return {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: { id: session.user.id },
      };
    });

    // Set initial tier from preferences so Pro users don't get downgraded on startup.
    // Server will update this when sync completes.
    const prefs = preferencesManager?.get();
    if (prefs?.cachedTier) {
      quotaManager.setInitialTier(prefs.cachedTier);
    }
  }

  if (accountStatusManager && envVars.supabaseUrl) {
    accountStatusManager.init(envVars.supabaseUrl, () => {
      const session = authManager?.getSession();
      if (!session) return null;
      return {
        access_token: session.access_token,
        user: {
          email: session.user.email ?? undefined,
        },
      };
    });
    accountStatusManager.on('statusChanged', (status) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('account:statusChanged', status);
        }
      });
    });
    void accountStatusManager.checkNow();
  }

  // Initialize feedback manager for user feedback to admin.
  feedbackManager = new FeedbackManager(authManager, clipboardManager);

  // Field Theory cloud sync is internal-only and disabled unless the hidden
  // local setting is on. Add a Supabase allowlist before enabling it outside dev.
  refreshFieldTheorySyncServices();

  // metricsManager was initialized earlier, before authManager.init()

  // Trust cached tier until we get positive confirmation from server.
  // Don't reset pro→free just because session isn't immediately valid.
  // If user is offline, they can't use cost-incurring features anyway (API calls fail).
  // Tier only changes when: (1) server confirms different tier, or (2) explicit sign-out.
  logUserState('startup');

  // NOTE: Super Paste (Cmd+Shift+V) hotkeys
  // are now registered in registerHotkeysAfterOnboarding() to avoid permission
  // prompts during onboarding.
}

/**
 * Initialize clipboard callbacks for auto-stacking.
 */
async function initClipboardCallbacks(): Promise<void> {
  if (!clipboardManager) {
    return;
  }

  // Set up callback for auto-stacking clipboard items during recording.
  // This ensures ALL clipboard items (text, images, screenshots) are added to the recording stack.
  clipboardManager.setOnItemAdded((id) => {
    const item = clipboardManager!.getItem(id);

    // Record clipboard item metric
    metricsManager?.recordClipboardItem();

    // Add ALL items to recording/silentStacking stack if user is currently recording or silentStacking.
    // This enables any clipboard copy (text, images, screenshots) to participate in auto-stacking.
    const status = transcriberManager?.getStatus();
    if (item && transcriberManager && (status === 'recording' || status === 'silentStacking')) {
      transcriberManager.addToStack(id);
    } else if (item && hotMicManager?.isActive && (item.type === 'screenshot' || item.type === 'image')) {
      hotMicManager.addScreenshotToSession(id);
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
      }
    });
  });
}

// Prevent multiple instances of the app.
const gotTheLock = app.requestSingleInstanceLock();

// Register fieldtheory:// URL protocol for deep linking.
// Development and experimental builds only register when explicitly opted in.
if (shouldRegisterFieldTheoryProtocol({
  appName: app.getName(),
  isDefaultApp: process.defaultApp,
  env: process.env,
})) {
  const clientArgs = fieldTheoryProtocolClientArgs({
    isDefaultApp: process.defaultApp,
    argv: process.argv,
  });

  if (process.defaultApp) {
    if (clientArgs) {
      app.setAsDefaultProtocolClient(FIELD_THEORY_URL_SCHEME, process.execPath, clientArgs);
    }
  } else {
    app.setAsDefaultProtocolClient(FIELD_THEORY_URL_SCHEME);
  }
}

/**
 * Handle fieldtheory:// URLs
 * Supported paths:
 * - fieldtheory://librarian/import?file=/path/to/reading.md&fullscreen=true - Import a reading and show it
 * - fieldtheory://wiki/open?file=/abs/path/to/page.md&immersive=true - Open a wiki page in the library view
 */
async function handleProtocolUrl(url: string): Promise<void> {
  try {
    const parsed = new URL(url);

    // Hot Mic URL handlers
    if (parsed.host === 'hotmic') {
      if (parsed.pathname === '/start') {
        applyHotMicMode('start');
      } else if (parsed.pathname === '/stop') {
        applyHotMicMode('deactivate');
      }
      return;
    }

    if (parsed.host === 'wiki' && parsed.pathname === '/open') {
      const filePath = parsed.searchParams.get('file');
      const immersive = parsed.searchParams.get('immersive') === 'true';

      if (!filePath) return;

      const decodedPath = decodeURIComponent(filePath);
      const wikiRoot = librarianManager?.getWikiRoot() ?? libraryDir();
      const resolved = resolveIncomingMarkdownPath(decodedPath, wikiRoot);
      const relPath = resolved?.kind === 'wiki'
        ? resolved.relPath
        : path.relative(wikiRoot, decodedPath).replace(/\.md$/i, '');

      if (clipboardHistoryWindow) {
        const boundsToUse = restoreClipboardHistoryBounds('library');
        suspendDynamicIslandFocusForClipboardHistory('show-reading');
        clipboardHistoryWindow.show(boundsToUse);
        clipboardHistoryWindow.getWindow()?.webContents.send('wiki:openPage', relPath);
        if (immersive) {
          clipboardHistoryWindow.getWindow()?.webContents.send('librarian:setFullscreen', true);
        }
      }
      return;
    }

    if (parsed.host === 'librarian' && parsed.pathname === '/import') {
      const filePath = parsed.searchParams.get('file');
      const fullscreen = parsed.searchParams.get('fullscreen') === 'true';

      if (!filePath) {
        return;
      }

      // Decode the file path (it may be URL-encoded)
      const decodedPath = decodeURIComponent(filePath);

      // Read the file directly - in file-only architecture, readings are on disk
      if (librarianManager) {
        const reading = librarianManager.getReading(decodedPath);
        if (reading) {
          // Send the reading path to the renderer to display it
          clipboardHistoryWindow?.getWindow()?.webContents.send('librarian:showReading', reading.path);
        }
      }

      // Show and focus the clipboard history window (show() handles focusing)
      if (clipboardHistoryWindow) {
        const boundsToUse = restoreClipboardHistoryBounds('library');
        suspendDynamicIslandFocusForClipboardHistory('show-reading');
        clipboardHistoryWindow.show(boundsToUse);
        // If fullscreen requested, notify renderer to enter fullscreen mode
        if (fullscreen) {
          clipboardHistoryWindow.getWindow()?.webContents.send('librarian:setFullscreen', true);
        }
      }
    }
  } catch (error) {
    log.error('Error handling protocol URL:', error);
  }
}

if (!gotTheLock) {
  app.quit();
} else {
  // Handle URL on macOS when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

  // Batch multi-select fires this once per file; we only show one at a time.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    routeOpenMarkdown(filePath);
  });

  app.on('second-instance', (_event, argv) => {
    // Handle URL from second instance (Windows/Linux)
    const url = argv.find(arg => arg.startsWith('fieldtheory://'));
    if (url) {
      handleProtocolUrl(url);
      return;
    }

    // If onboarding is not complete, focus the onboarding window instead.
    const prefs = preferencesManager?.get();
    if (!prefs?.onboardingComplete && onboardingWindow?.isVisible()) {
      // Focus is handled by the onboarding window itself.
      return;
    }
    // Show clipboard history when user tries to launch app again
    showClipboardHistoryOnActivate();
  });

  app.whenReady().then(async () => {
    log.info('App ready');

    // ftmedia://media/<filename> → the bookmark media folder.
    // basename() strips any path traversal attempts from the URL.
    protocol.handle('ftmedia', (req) => {
      const filename = path.basename(decodeURIComponent(new URL(req.url).pathname));
      return net.fetch(pathToFileURL(path.join(bookmarkMediaDir(), filename)).toString());
    });

    protocol.handle('ftlocalfile', async (req) => {
      const filePath = localImagePathFromProtocolUrl(req.url);
      if (!filePath || !isAllowedLocalImagePath(filePath)) {
        log.warn('ftlocalfile blocked invalid image URL: %s -> %s', req.url, filePath ? obscureHomePath(filePath) : '(unparseable)');
        return new Response('', { status: 404 });
      }
      try {
        const image = await fs.promises.readFile(filePath);
        log.debug('ftlocalfile served image: %s (%d bytes)', obscureHomePath(filePath), image.byteLength);
        return new Response(image, {
          headers: { 'Content-Type': getLocalImageContentType(filePath) },
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        log.warn('ftlocalfile failed to read image: %s (%s)', obscureHomePath(filePath), err.code ?? err.message ?? 'unknown error');
        return new Response('', { status: 404 });
      }
    });

    // Migrate data from legacy app directories (littleai-mac, Oscar) if needed.
    migrateFromLegacyPaths();

    setupIPCHandlers();
    setupThemeIPCHandlers();
    setupLibrarianIPCHandlers();
    setupTaggedDocsIPCHandlers();
    setupSquaresIPCHandlers();
    setupGazeIPCHandlers();
    setupTranscribeIPCHandlers();
    setupClipboardIPCHandlers();
    setupOnboardingIPCHandlers();
    setupDisplayListeners();

    // Hot Mic IPC handlers
    ipcMain.handle('hotmic:getStatus', () => {
      if (hotMicManager) {
        return hotMicManager.getStatus();
      }
      return {
        state: 'idle',
        muted: preferencesManager?.getPreference('hotMicMuted') ?? false,
      };
    });

    ipcMain.handle('hotmic:getState', () => {
      return hotMicManager?.getState() ?? 'idle';
    });

    ipcMain.handle('hotmic:getRuntimeStatus', () => {
      return getHotMicRuntimeStatusSnapshot();
    });

    ipcMain.handle('hotmic:getMuted', () => {
      if (hotMicManager) {
        return hotMicManager.getMuted();
      }
      return preferencesManager?.getPreference('hotMicMuted') ?? false;
    });

    ipcMain.handle('hotmic:getEnabled', () => {
      return preferencesManager?.getPreference('hotMicEnabled') ?? false;
    });

    ipcMain.handle('hotmic:getInputMode', () => {
      return getCurrentInputMode();
    });

    ipcMain.handle('hotmic:setInputMode', async (_event, mode: InputMode) => {
      return await applyInputMode(mode);
    });

    ipcMain.handle('hotmic:getTranscriptionEngineMode', () => {
      return 'default';
    });

    ipcMain.handle('hotmic:setTranscriptionEngineMode', async (_event, mode: 'default' | TranscriptionEngine) => {
      if (mode !== 'default') {
        log.info('Hot Mic engine override is deprecated; using global transcription engine');
      }
      await preferencesManager?.save({ hotMicTranscriptionEngine: 'default' });
      await transcriberManager?.restartTranscriptionRuntime();
      broadcastHotMicRuntimeStatus();
      return 'default';
    });

    ipcMain.handle('hotmic:getWhisperModel', () => {
      return transcriberManager?.getSelectedModel() ?? DEFAULT_MODEL_SIZE;
    });

    ipcMain.handle('hotmic:setWhisperModel', async (_event, model: ModelSize) => {
      const normalized: ModelSize = isModelSize(model) ? model : DEFAULT_MODEL_SIZE;
      log.info('Hot Mic whisper model request mapped to global model: %s', normalized);
      if (transcriberManager) {
        await transcriberManager.setSelectedModel(normalized);
      } else {
        await preferencesManager?.save({ selectedModel: normalized });
      }
      broadcastHotMicRuntimeStatus();
      return normalized;
    });

    ipcMain.handle('hotmic:setEnabled', async (_event, enabled: boolean) => {
      await applyInputMode(enabled ? 'hot-mic' : 'standard');
      return enabled;
    });

    ipcMain.handle('hotmic:getTargetApp', () => {
      return preferencesManager?.getPreference('hotMicTargetBundleId') ?? null;
    });

    ipcMain.handle('hotmic:setTargetApp', async (_event, bundleId: string | null) => {
      await preferencesManager?.save({ hotMicTargetBundleId: bundleId ?? undefined });
      return bundleId;
    });

    ipcMain.handle('hotmic:getSoundsEnabled', () => {
      return preferencesManager?.getPreference('hotMicSoundsEnabled') ?? true;
    });

    ipcMain.handle('hotmic:setSoundsEnabled', async (_event, enabled: boolean) => {
      await preferencesManager?.save({ hotMicSoundsEnabled: enabled });
      return enabled;
    });

    ipcMain.handle('hotmic:getBackgroundFilterEnabled', () => {
      return preferencesManager?.getPreference('hotMicBackgroundFilterEnabled') ?? false;
    });

    ipcMain.handle('hotmic:setBackgroundFilterEnabled', async (_event, enabled: boolean) => {
      await preferencesManager?.save({ hotMicBackgroundFilterEnabled: !!enabled });
      return !!enabled;
    });

    ipcMain.handle('hotmic:getBackgroundFilterStrength', () => {
      const value = preferencesManager?.getPreference('hotMicBackgroundFilterStrength');
      if (typeof value !== 'number' || Number.isNaN(value)) return 4;
      return Math.max(0, Math.min(100, Math.round(value)));
    });

    ipcMain.handle('hotmic:setBackgroundFilterStrength', async (_event, strength: number) => {
      const normalized = Number.isFinite(strength)
        ? Math.max(0, Math.min(100, Math.round(strength)))
        : 4;
      await preferencesManager?.save({ hotMicBackgroundFilterStrength: normalized });
      return normalized;
    });

    ipcMain.handle('hotmic:getDrawerTextSize', () => {
      return getHotMicDrawerTextSizeFromPreferences();
    });

    ipcMain.handle('hotmic:setDrawerTextSize', async (_event, size: number) => {
      return await saveAndApplyHotMicDrawerTextSize(size);
    });

    ipcMain.handle('hotmic:getIslandGeometry', () => {
      return dynamicIslandManager?.getGeometryTuning() ?? getHotMicIslandGeometryFromPreferences();
    });

    ipcMain.handle('hotmic:setIslandGeometry', async (_event, geometry: Partial<DynamicIslandGeometryTuning>) => {
      return await saveAndApplyHotMicIslandGeometry(geometry ?? {});
    });

    ipcMain.handle('hotmic:resetIslandGeometry', async () => {
      return await saveAndApplyHotMicIslandGeometry(DEFAULT_DYNAMIC_ISLAND_GEOMETRY_TUNING);
    });

    ipcMain.handle('hotmic:getResolvedIslandGeometry', () => {
      return dynamicIslandManager?.getResolvedGeometry() ?? null;
    });

    ipcMain.handle('hotmic:getIslandStayOnLaptop', () => {
      return preferencesManager?.getPreference('hotMicIslandStayOnLaptop') ?? false;
    });

    ipcMain.handle('hotmic:setIslandStayOnLaptop', async (_event, value: boolean) => {
      if (preferencesManager) {
        await preferencesManager.save({ hotMicIslandStayOnLaptop: value });
      }
      dynamicIslandManager?.setStayOnLaptop(value);
      return value;
    });

    ipcMain.handle('hotmic:getIslandAutoHide', () => {
      return dynamicIslandManager?.getAutoHideEnabled() ?? preferencesManager?.getPreference('hotMicIslandAutoHide') ?? false;
    });

    ipcMain.handle('hotmic:setIslandAutoHide', async (_event, value: boolean) => {
      const next = !!value;
      if (preferencesManager) {
        await preferencesManager.save({ hotMicIslandAutoHide: next });
      }
      dynamicIslandManager?.setAutoHide(next);
      return next;
    });

    ipcMain.handle('hotmic:getSubmitWord', () => {
      return preferencesManager?.getPreference('hotMicSubmitWord') ?? HOT_MIC_DEFAULTS.submitPhrases;
    });

    ipcMain.handle('hotmic:setSubmitWord', async (_event, word: string) => {
      await preferencesManager?.save({ hotMicSubmitWord: word });
      return word;
    });

    ipcMain.handle('hotmic:getHotkey', () => {
      return hotMicManager?.getHotkey() ?? null;
    });

    ipcMain.handle('hotmic:setHotkey', async (_event, hotkey: string | null) => {
      if (!hotMicManager) return false;
      return hotMicManager.setHotkey(hotkey);
    });

    ipcMain.handle('hotmic:getPasteWords', () => {
      return preferencesManager?.getPreference('hotMicPasteWords') ?? HOT_MIC_DEFAULTS.pastePhrases;
    });

    ipcMain.handle('hotmic:setPasteWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicPasteWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getShowWordCount', () => {
      return preferencesManager?.getPreference('hotMicShowWordCount') === true;
    });

    ipcMain.handle('hotmic:setShowWordCount', async (_event, enabled: boolean) => {
      await preferencesManager?.save({ hotMicShowWordCount: enabled });
      return enabled;
    });

    ipcMain.handle('hotmic:getCancelWords', () => {
      return preferencesManager?.getPreference('hotMicCancelWords') ?? HOT_MIC_DEFAULTS.cancelPhrases;
    });

    ipcMain.handle('hotmic:setCancelWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicCancelWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getScrapWords', () => {
      return preferencesManager?.getPreference('hotMicScrapWords') ?? HOT_MIC_DEFAULTS.scrapPhrases;
    });

    ipcMain.handle('hotmic:setScrapWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicScrapWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getPrevWindowWords', () => {
      return preferencesManager?.getPreference('hotMicPrevWindowWords') ?? HOT_MIC_DEFAULTS.prevWindowPhrases;
    });

    ipcMain.handle('hotmic:setPrevWindowWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicPrevWindowWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getNewWindowWords', () => {
      return preferencesManager?.getPreference('hotMicNewWindowWords') ?? HOT_MIC_DEFAULTS.newWindowPhrases;
    });

    ipcMain.handle('hotmic:setNewWindowWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicNewWindowWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getCloseWindowWords', () => {
      return preferencesManager?.getPreference('hotMicCloseWindowWords') ?? HOT_MIC_DEFAULTS.closeWindowPhrases;
    });

    ipcMain.handle('hotmic:setCloseWindowWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicCloseWindowWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getMinimizePhrases', () => {
      return preferencesManager?.getPreference('hotMicMinimizePhrases') ?? HOT_MIC_DEFAULTS.minimizePhrases;
    });

    ipcMain.handle('hotmic:setMinimizePhrases', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicMinimizePhrases: words });
      return words;
    });

    ipcMain.handle('hotmic:getHidePhrases', () => {
      return preferencesManager?.getPreference('hotMicHidePhrases') ?? HOT_MIC_DEFAULTS.hidePhrases;
    });

    ipcMain.handle('hotmic:setHidePhrases', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicHidePhrases: words });
      return words;
    });

    ipcMain.handle('hotmic:getQuitPhrases', () => {
      return preferencesManager?.getPreference('hotMicQuitPhrases') ?? HOT_MIC_DEFAULTS.quitPhrases;
    });

    ipcMain.handle('hotmic:setQuitPhrases', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicQuitPhrases: words });
      return words;
    });

    ipcMain.handle('hotmic:getSwitchWords', () => {
      return preferencesManager?.getPreference('hotMicSwitchWords') ?? HOT_MIC_DEFAULTS.switchWindowPhrases;
    });

    ipcMain.handle('hotmic:getOpenAppPrefixes', () => {
      return preferencesManager?.getPreference('hotMicOpenAppPrefixes') ?? HOT_MIC_DEFAULTS.appOpenPrefixes;
    });

    ipcMain.handle('hotmic:setOpenAppPrefixes', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicOpenAppPrefixes: words });
      return words;
    });

    ipcMain.handle('hotmic:getQuitAppPrefixes', () => {
      return preferencesManager?.getPreference('hotMicQuitAppPrefixes') ?? HOT_MIC_DEFAULTS.appQuitPrefixes;
    });

    ipcMain.handle('hotmic:setQuitAppPrefixes', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicQuitAppPrefixes: words });
      return words;
    });

    ipcMain.handle('hotmic:setSwitchWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicSwitchWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getRunClaudeWords', () => {
      return preferencesManager?.getPreference('hotMicRunClaudeWords') ?? HOT_MIC_DEFAULTS.runClaudePhrases;
    });

    ipcMain.handle('hotmic:setRunClaudeWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicRunClaudeWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getRunCodexWords', () => {
      return preferencesManager?.getPreference('hotMicRunCodexWords') ?? HOT_MIC_DEFAULTS.runCodexPhrases;
    });

    ipcMain.handle('hotmic:setRunCodexWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicRunCodexWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getRestartServerWords', () => {
      return preferencesManager?.getPreference('hotMicRestartServerWords') ?? HOT_MIC_DEFAULTS.restartServerPhrases;
    });

    ipcMain.handle('hotmic:setRestartServerWords', async (_event, words: string) => {
      await preferencesManager?.save({ hotMicRestartServerWords: words });
      return words;
    });

    ipcMain.handle('hotmic:getRestartServerCommand', () => {
      return preferencesManager?.getPreference('hotMicRestartServerCommand') ?? '';
    });

    ipcMain.handle('hotmic:setRestartServerCommand', async (_event, command: string) => {
      await preferencesManager?.save({ hotMicRestartServerCommand: command });
      return command;
    });

    // System commands — media, volume, sleep, lock (stored as individual prefs)
    const SYSTEM_CMD_PREF_KEYS: Record<string, { prefKey: string; defaults: string }> = {
      'play-pause':     { prefKey: 'hotMicPlayPausePhrases',  defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['play-pause'] },
      'next-track':     { prefKey: 'hotMicNextTrackPhrases',  defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['next-track'] },
      'previous-track': { prefKey: 'hotMicPrevTrackPhrases',  defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['previous-track'] },
      'volume-up':      { prefKey: 'hotMicVolumeUpPhrases',   defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['volume-up'] },
      'volume-down':    { prefKey: 'hotMicVolumeDownPhrases', defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['volume-down'] },
      'mute':           { prefKey: 'hotMicMutePhrases',       defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.mute },
      'unmute':         { prefKey: 'hotMicUnmutePhrases',     defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.unmute },
      'sleep':          { prefKey: 'hotMicSleepPhrases',      defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.sleep },
      'lock':           { prefKey: 'hotMicLockPhrases',       defaults: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.lock },
    };

    ipcMain.handle('hotmic:getSystemCommands', () => {
      const result: Record<string, string> = {};
      for (const [action, { prefKey, defaults }] of Object.entries(SYSTEM_CMD_PREF_KEYS)) {
        const val = preferencesManager?.getPreference(prefKey as any);
        result[action] = typeof val === 'string' && val.trim() ? val : defaults;
      }
      return result;
    });

    ipcMain.handle('hotmic:setSystemCommand', async (_event, action: string, phrases: string) => {
      const entry = SYSTEM_CMD_PREF_KEYS[action];
      if (!entry) return false;
      await preferencesManager?.save({ [entry.prefKey]: phrases } as any);
      return true;
    });

    ipcMain.handle('hotmic:getFocusPhrases', () => {
      const explicit = preferencesManager?.getPreference('hotMicFocusPhrases');
      if (typeof explicit === 'string' && explicit.trim()) return explicit;
      const savedWindow = preferencesManager?.getPreference('hotMicRectangleCommands')?.focus;
      if (typeof savedWindow === 'string' && savedWindow.trim()) return savedWindow;
      return HOT_MIC_DEFAULT_WINDOW_COMMANDS.focus;
    });

    ipcMain.handle('hotmic:setFocusPhrases', async (_event, words: string) => {
      const existingWindowCommands = preferencesManager?.getPreference('hotMicRectangleCommands') ?? {};
      await preferencesManager?.save({
        hotMicFocusPhrases: words,
        hotMicRectangleCommands: { ...existingWindowCommands, focus: words },
      });
      return words;
    });

    ipcMain.handle('hotmic:getCascadePhrases', () => {
      const explicit = preferencesManager?.getPreference('hotMicCascadePhrases');
      if (typeof explicit === 'string' && explicit.trim()) return explicit;
      const savedWindow = preferencesManager?.getPreference('hotMicRectangleCommands')?.cascade;
      if (typeof savedWindow === 'string' && savedWindow.trim()) return savedWindow;
      return HOT_MIC_DEFAULT_WINDOW_COMMANDS.cascade;
    });

    ipcMain.handle('hotmic:setCascadePhrases', async (_event, words: string) => {
      const existingWindowCommands = preferencesManager?.getPreference('hotMicRectangleCommands') ?? {};
      await preferencesManager?.save({
        hotMicCascadePhrases: words,
        hotMicRectangleCommands: { ...existingWindowCommands, cascade: words },
      });
      return words;
    });

    ipcMain.handle('hotmic:getRectangleCommands', () => {
      const saved = preferencesManager?.getPreference('hotMicRectangleCommands') ?? {};
      return { ...HOT_MIC_DEFAULT_WINDOW_COMMANDS, ...saved };
    });

    ipcMain.handle('hotmic:setRectangleCommands', async (_event, commands: Record<string, string>) => {
      const payload: Record<string, unknown> = { hotMicRectangleCommands: commands };
      if (typeof commands.focus === 'string' && commands.focus.trim()) {
        payload.hotMicFocusPhrases = commands.focus;
      }
      if (typeof commands.cascade === 'string' && commands.cascade.trim()) {
        payload.hotMicCascadePhrases = commands.cascade;
      }
      await preferencesManager?.save(payload as any);
      return commands;
    });

    ipcMain.handle('hotmic:resetCommandDefaults', async () => {
      const resetPayload: Record<string, unknown> = {
        hotMicSubmitWord: HOT_MIC_DEFAULTS.submitPhrases,
        hotMicPasteWords: HOT_MIC_DEFAULTS.pastePhrases,
        hotMicCancelWords: HOT_MIC_DEFAULTS.cancelPhrases,
        hotMicScrapWords: HOT_MIC_DEFAULTS.scrapPhrases,
        hotMicPrevWindowWords: HOT_MIC_DEFAULTS.prevWindowPhrases,
        hotMicNewWindowWords: HOT_MIC_DEFAULTS.newWindowPhrases,
        hotMicCloseWindowWords: HOT_MIC_DEFAULTS.closeWindowPhrases,
        hotMicMinimizePhrases: HOT_MIC_DEFAULTS.minimizePhrases,
        hotMicHidePhrases: HOT_MIC_DEFAULTS.hidePhrases,
        hotMicQuitPhrases: HOT_MIC_DEFAULTS.quitPhrases,
        hotMicSwitchWords: HOT_MIC_DEFAULTS.switchWindowPhrases,
        hotMicOpenAppPrefixes: HOT_MIC_DEFAULTS.appOpenPrefixes,
        hotMicQuitAppPrefixes: HOT_MIC_DEFAULTS.appQuitPrefixes,
        hotMicRunClaudeWords: HOT_MIC_DEFAULTS.runClaudePhrases,
        hotMicRunCodexWords: HOT_MIC_DEFAULTS.runCodexPhrases,
        hotMicRestartServerWords: HOT_MIC_DEFAULTS.restartServerPhrases,
        hotMicPlayPausePhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['play-pause'],
        hotMicNextTrackPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['next-track'],
        hotMicPrevTrackPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['previous-track'],
        hotMicVolumeUpPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['volume-up'],
        hotMicVolumeDownPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS['volume-down'],
        hotMicMutePhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.mute,
        hotMicUnmutePhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.unmute,
        hotMicSleepPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.sleep,
        hotMicLockPhrases: HOT_MIC_DEFAULT_SYSTEM_COMMANDS.lock,
        hotMicRectangleCommands: { ...HOT_MIC_DEFAULT_WINDOW_COMMANDS },
        hotMicFocusPhrases: HOT_MIC_DEFAULT_WINDOW_COMMANDS.focus,
        hotMicCascadePhrases: HOT_MIC_DEFAULT_WINDOW_COMMANDS.cascade,
      };

      await preferencesManager?.save(resetPayload as any);
      return true;
    });

    ipcMain.handle('hotmic:getKnownTerminals', () => {
      return KNOWN_TERMINALS;
    });

    ipcMain.handle('hotmic:start', () => {
      applyHotMicMode('activate');
    });

    ipcMain.handle('hotmic:stop', () => {
      applyHotMicMode('deactivate');
    });

    ipcMain.handle('hotmic:isHookInstalled', () => {
      return hotMicManager?.isHookInstalled() ?? false;
    });

    ipcMain.handle('hotmic:installHook', () => {
      return hotMicManager?.installHook() ?? { success: false, error: 'Not initialized' };
    });

    ipcMain.handle('hotmic:uninstallHook', () => {
      return hotMicManager?.uninstallHook() ?? { success: false, error: 'Not initialized' };
    });

    // Todo IPC handlers
    ipcMain.handle('todo:isAuthenticated', () => {
      refreshFieldTheorySyncServices();
      return canUseFieldTheorySync();
    });

    ipcMain.handle(TodoIPCChannels.GET_TODOS, () => {
      refreshFieldTheorySyncServices();
      return todoStore?.getTodos() ?? [];
    });

    ipcMain.handle(TodoIPCChannels.SYNC_TODOS, async () => {
      refreshFieldTheorySyncServices();
      return await todoStore?.syncTodos() ?? [];
    });

    ipcMain.handle(TodoIPCChannels.CREATE_TODO, async (_event, text: string) => {
      refreshFieldTheorySyncServices();
      if (!todoStore) return null;
      // Generate a client ID for deduplication
      const clientId = crypto.randomUUID();
      return await todoStore.create(text, clientId);
    });

    ipcMain.handle(TodoIPCChannels.UPDATE_TODO, async (_event, id: string, text: string) => {
      refreshFieldTheorySyncServices();
      if (!todoStore) return null;
      const success = await todoStore.update(id, { text });
      if (success) {
        const todos = todoStore.getTodos();
        return todos.find(t => t.id === id) ?? null;
      }
      return null;
    });

    ipcMain.handle(TodoIPCChannels.TOGGLE_TODO, async (_event, id: string) => {
      refreshFieldTheorySyncServices();
      if (!todoStore) return null;
      const success = await todoStore.toggle(id);
      if (success) {
        const todos = todoStore.getTodos();
        return todos.find(t => t.id === id) ?? null;
      }
      return null;
    });

    ipcMain.handle(TodoIPCChannels.DELETE_TODO, async (_event, id: string) => {
      refreshFieldTheorySyncServices();
      return await todoStore?.delete(id) ?? false;
    });

    ipcMain.handle(TodoIPCChannels.DELETE_TODOS, async (_event, ids: string[]) => {
      refreshFieldTheorySyncServices();
      return await todoStore?.deleteBatch(ids) ?? false;
    });

    ipcMain.handle(TodoIPCChannels.COMPLETE_TODOS, async (_event, ids: string[]) => {
      refreshFieldTheorySyncServices();
      return await todoStore?.completeBatch(ids) ?? false;
    });

    // Set up macOS app menu with standard items (required for Cmd+H, Cmd+Q, etc.)
    if (process.platform === 'darwin') {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { 
              label: 'Hide Field Theory',
              accelerator: 'Command+H',
              click: () => {
                app.hide();
              }
            },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label: 'View',
          submenu: [
            {
              label: 'Portable Commands',
              accelerator: 'Command+Shift+K',
              click: () => {
                if (commandLauncherWindow) {
                  commandLauncherWindow.show();
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Toggle Developer Tools',
              accelerator: 'Command+Option+I',
              click: () => {
                const focusedWindow = BrowserWindow.getFocusedWindow();
                if (focusedWindow) {
                  focusedWindow.webContents.toggleDevTools();
                }
              }
            }
          ]
        },
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'close' }
          ]
        }
      ];
      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
    }

    // Register keyboard shortcut to reset onboarding (Cmd+Shift+O).
    // Only in unpackaged (development) builds.
    if (!app.isPackaged) {
      globalShortcut.register('Command+Shift+O', async () => {
        if (!preferencesManager) return;

        await preferencesManager.save({
          onboardingComplete: false,
          onboardingStep: undefined,
        });

        // Refresh tray menu to show onboarding-only options
        if (trayManager) {
          trayManager.refreshMenu();
        }

        if (onboardingWindow) {
          onboardingWindow.close();
          onboardingWindow = null;
        }

        onboardingWindow = createOnboardingWindow();
        onboardingWindow.show(OnboardingStep.PERMISSIONS);
      });
    }

    // Manual update check function for tray menu.
    function checkForUpdatesManual(): void {
      autoUpdater.checkForUpdates().catch((err) => {
        log.error('Update check failed:', err);
      });
    }

    await initAudioSystem(checkForUpdatesManual);
    await initTranscriberSystem();
    await initClipboardCallbacks();

    // Preload clipboard history window for instant first open.
    // Always preload - even before onboarding completes, user may trigger hotkey.
    clipboardHistoryWindow = initClipboardHistoryWindow();
    const boundsToUse = restoreClipboardHistoryBounds();
    clipboardHistoryWindow.preload(boundsToUse);

    // If the app cold-started via `open-file`, the pending path was queued
    // before the window existed. Flush it once the renderer finishes loading
    // so wiki:openPage / external:openPage have a listener on the other end.
    const pendingFlushContents = clipboardHistoryWindow.getWindow()?.webContents;
    if (pendingFlushContents) {
      const flushPendingOpen = () => {
        if (!pendingOpenMarkdownPath) return;
        const queued = pendingOpenMarkdownPath;
        pendingOpenMarkdownPath = null;
        routeOpenMarkdown(queued);
      };
      if (pendingFlushContents.isLoading()) {
        pendingFlushContents.once('did-finish-load', flushPendingOpen);
      } else {
        flushPendingOpen();
      }
    }

    // Update tray manager with current hotkeys for menu display
    if (trayManager && clipboardManager && transcriberManager) {
      const historyHotkey = clipboardManager.getHotkeys().history || 'Option+Space';
      const transcriptionHotkey = transcriberManager.getHotkey() || 'Option+Shift+Space';
      const screenshotHotkey = clipboardManager.getHotkeys().screenshot || 'Command+4';
      trayManager.setHotkeys(historyHotkey, transcriptionHotkey, screenshotHotkey);
    }

    // Apply Dock visibility setting.
    // Default is panel mode (hidden from Dock). This is a WIP feature.
    if (process.platform === 'darwin') {
      const showInDock = shouldUseClipboardAppWindowMode();
      if (showInDock) {
        await app.dock.show();
      } else {
        app.dock.hide();
      }
    }

    // Apply launch at login setting.
    if (process.platform === 'darwin' && app.isPackaged) {
      const launchAtLogin = preferencesManager?.getPreference('launchAtLogin') ?? true;
      app.setLoginItemSettings({
        openAtLogin: launchAtLogin,
        openAsHidden: true,
      });
    }

    // Check for updates on startup and periodically (production only).
    {
      // Initial check after 5s delay to not block UI.
      setTimeout(() => {
        autoUpdater.checkForUpdates();
      }, 5000);

      // Periodic check every 30 minutes.
      setInterval(() => {
        autoUpdater.checkForUpdates();
      }, 30 * 60 * 1000);
    }

    // Auto-updater event handlers - send to renderer for in-app notification UI.
    autoUpdater.on('checking-for-update', () => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:checkingForUpdate');
        }
      });
    });

    autoUpdater.on('update-available', (info) => {
      pendingUpdateInfo = { status: 'available', version: info.version };
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:updateAvailable', { version: info.version });
        }
      });
    });

    autoUpdater.on('update-not-available', (_info) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:updateNotAvailable');
        }
      });
    });

    autoUpdater.on('error', (err) => {
      log.error('Updater error:', err);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:error', err.message);
        }
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      if (pendingUpdateInfo) {
        pendingUpdateInfo.status = 'downloading';
      }
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:downloadProgress', percent);
        }
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      pendingUpdateInfo = { status: 'ready', version: info.version };
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:updateDownloaded', { version: info.version });
        }
      });
    });

    // App version (sync for immediate access).
    ipcMain.on('app:getVersion', (event) => {
      event.returnValue = app.getVersion();
    });

    // Updater IPC handlers.
    ipcMain.handle('updater:checkForUpdates', () => {
      if (app.isPackaged) {
        autoUpdater.checkForUpdates();
      } else {
        // In dev mode, simulate "up to date" response
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send('updater:updateNotAvailable');
          }
        });
      }
    });

    ipcMain.handle('updater:downloadUpdate', () => {
      autoUpdater.downloadUpdate();
    });

    ipcMain.handle('updater:installUpdate', () => {
      autoUpdater.quitAndInstall();
    });

    ipcMain.handle('updater:dismissUpdate', () => {
      // Clear pending update state so notification doesn't reappear.
      pendingUpdateInfo = null;
    });

    ipcMain.handle('updater:getStatus', () => {
      // Return current update state so windows can query it on open.
      return pendingUpdateInfo;
    });

    // Check permissions on startup and notify main window
    const permissions = await checkPermissions();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('permissions-status', permissions);
      });
    }
    
    // Permission and model check at startup - always verify all requirements are met.
    // If any permission is missing or model not downloaded, show onboarding regardless of previous completion state.
    const prefs = preferencesManager?.get();
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    const accessibilityStatus = systemPreferences.isTrustedAccessibilityClient(false);
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');

    // Check if the configured transcription engine is ready
    const modelDownloaded = await isTranscriptionEngineReady();

    // Check if user is authenticated. A returning user with a stored local
    // session can use offline/local features while token refresh catches up.
    const isAuthenticated = authManager?.isAuthenticated() ?? false;
    const canUseLocalAccount = isAuthenticated || (authManager?.hasEverBeenAuthenticated() ?? false);

    // All three permissions, model download, and a known local account are
    // required for full local app functionality.
    const isFullyReady =
      micStatus === 'granted' &&
      accessibilityStatus &&
      screenStatus === 'granted' &&
      modelDownloaded &&
      canUseLocalAccount;

    if (isFullyReady) {
      // All requirements met - mark onboarding complete and allow app access
      if (!prefs?.onboardingComplete) {
        await preferencesManager?.save({ onboardingComplete: true });
      }
      registerHotkeysAfterOnboarding();
    } else {
      // Missing requirements - force onboarding flow

      // Reset onboarding state if it was previously complete
      if (prefs?.onboardingComplete) {
        await preferencesManager?.save({ onboardingComplete: false });

        // Refresh tray menu to show onboarding-only options
        if (trayManager) {
          trayManager.refreshMenu();
        }
      }

      onboardingWindow = createOnboardingWindow();

      // Determine the correct starting step based on what's missing
      // If only auth is missing (all permissions + model OK), start at account phase (step 2)
      const hasAllPermissions =
        micStatus === 'granted' &&
        accessibilityStatus &&
        screenStatus === 'granted';

      const hasAllPermissionsAndModel = hasAllPermissions && modelDownloaded;

      let startStep: number;
      if (hasAllPermissionsAndModel && !canUseLocalAccount) {
        // Only auth is missing - go straight to account phase
        startStep = OnboardingStep.ACCOUNT;
      } else if (hasAllPermissions && !modelDownloaded) {
        // Only model is missing - go straight to model download phase
        startStep = OnboardingStep.MODEL;
      } else {
        // Other requirements missing - use saved step or start from beginning
        startStep = prefs?.onboardingStep ?? OnboardingStep.PERMISSIONS;
      }

      onboardingWindow.show(startStep);
      // Hotkeys will be registered when onboarding completes (see onboarding:complete handler)
    }

    // Monitor permissions and auth periodically - if any are revoked/lost, show onboarding again
    const REQUIREMENT_CHECK_INTERVAL = 5000; // Check every 5 seconds
    setInterval(async () => {
      const currentPrefs = preferencesManager?.get();
      if (!currentPrefs?.onboardingComplete) {
        // Already in onboarding mode, no need to check
        return;
      }

      const mic = systemPreferences.getMediaAccessStatus('microphone');
      const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      const screen = systemPreferences.getMediaAccessStatus('screen');
      const authenticated = authManager?.isAuthenticated() ?? false;
      const hasEverAuthenticated = authManager?.hasEverBeenAuthenticated() ?? false;

      const hasAllPermissions = mic === 'granted' && accessibility && screen === 'granted';

      // Check if permissions are revoked
      if (!hasAllPermissions) {
        // Unregister all hotkeys - they shouldn't work without permissions
        getHotkeyManager().unregisterAll();

        // Reset onboarding state
        await preferencesManager?.save({ onboardingComplete: false });

        // Refresh tray menu to show onboarding option
        if (trayManager) {
          trayManager.refreshMenu();
        }

        // Hide clipboard window if visible
        if (clipboardHistoryWindow?.isVisible()) {
          clipboardHistoryWindow.hide();
        }

        // Show onboarding window at beginning
        if (!onboardingWindow) {
          onboardingWindow = createOnboardingWindow();
        }
        onboardingWindow.show(OnboardingStep.PERMISSIONS);
        return;
      }

      // Check if user logged out (permissions OK but auth lost)
      // IMPORTANT: Only force onboarding for truly new users who have never authenticated.
      // Existing users who temporarily lose auth (network issues, token expired) should
      // continue using local features. AuthManager will retry token refresh automatically.
      if (!authenticated && !hasEverAuthenticated) {
        // Unregister all hotkeys - app requires login for new users
        getHotkeyManager().unregisterAll();

        // Reset onboarding state
        await preferencesManager?.save({ onboardingComplete: false });

        // Refresh tray menu to show onboarding option
        if (trayManager) {
          trayManager.refreshMenu();
        }

        // Hide clipboard window if visible
        if (clipboardHistoryWindow?.isVisible()) {
          clipboardHistoryWindow.hide();
        }

        // Show onboarding window at account phase (step 2)
        if (!onboardingWindow) {
          onboardingWindow = createOnboardingWindow();
        }
        onboardingWindow.show(2); // account phase
      }
    }, REQUIREMENT_CHECK_INTERVAL);

    app.on('activate', () => {
      // Always show clipboard history when app becomes active.
      // We no longer create the old main/settings window - the app is a background app
      // that primarily operates through the clipboard history window and tray.
      showClipboardHistoryOnActivate();
      logUserState('activate');
      // Note: SDK handles token refresh automatically via autoRefreshToken
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    log.info('App quitting, cleaning up...');

    if (feedbackManager) {
      feedbackManager.destroy();
    }

    if (transcriberManager) {
      transcriberManager.destroy();
    }

    if (dynamicIslandManager) {
      dynamicIslandManager.destroy();
    }

    if (gazeTrackingManager) {
      gazeTrackingManager.destroy().catch(() => {});
    }

    if (gazeDebugOverlayManager) {
      gazeDebugOverlayManager.destroy();
      gazeDebugOverlayManager = null;
    }

    if (gazeScreenOverlayManager) {
      gazeScreenOverlayManager.destroy();
      gazeScreenOverlayManager = null;
    }

    if (trayManager) {
      trayManager.destroy();
    }

    if (nativeHelper) {
      nativeHelper.stop();
    }

    if (clipboardManager) {
      clipboardManager.destroy();
    }

    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.destroy();
    }

    librarySyncService?.dispose();
    commandSyncService?.destroy();
    todoStore?.destroy();

    // Sync metrics before quitting (fire-and-forget, don't block quit)
    if (metricsManager) {
      metricsManager.shutdown().catch(() => {});
    }
  });
}
