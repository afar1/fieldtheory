import { app, BrowserWindow, ipcMain, clipboard, screen, Display, Notification, dialog, globalShortcut, shell, Menu, systemPreferences, powerMonitor, net, protocol, nativeImage, type IpcMainEvent } from 'electron';
import { pathToFileURL } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createLogger } from './logger';
import crypto from 'crypto';
import { parseEnvContent } from './envUtils';
import { NativeHelper } from './nativeHelper';
import { isAlfredApp } from './alfredVisibility';
import {
  shouldHideFieldTheoryWindowsForAlfred,
  shouldRestoreFieldTheoryFocusAfterFloatingRecording,
  shouldShowClipboardWindowOnStartup,
  shouldToggleCloseFieldTheoryFromDynamicIsland,
} from './fieldTheoryWindowModePolicy';
import { AudioManager } from './audioManager';
import { TrayManager } from './trayManager';
import type { TranscriberManager } from './transcriberManager';
import {
  DEFAULT_MEETING_SUMMARY_PROMPT,
  PreferencesManager,
  normalizeClipboardHistorySizeKey,
  normalizeLauncherRootSearchEnabledKinds,
  pickSavedBoundsByKey,
  resolveFieldTheoryWindowMode,
  type ClipboardHistorySizeKey,
  type FieldTheoryWindowMode,
} from './preferences';
import { ClipboardManager } from './clipboardManager';
import {
  DEFAULT_MODEL_SIZE,
  isModelSize,
  ModelSize,
} from './modelManager';
import { ClipboardHistoryWindow } from './clipboardHistoryWindow';
import { BrowserHelperDocumentService } from './browserHelperDocumentService';
import { BrowserHelperServer, type BrowserHelperNativeEvent } from './browserHelperServer';
import { clearBrowserHelperState, writeBrowserHelperState } from './browserHelperState';
import { BROWSER_LIBRARY_RENDERER_STORAGE_KEYS } from '../shared/browserLibraryRendererStorage';
import { normalizeFieldTheoryMarkdownTarget } from '../shared/fieldTheoryMarkdownTarget';
import { BrowserLibraryRendererStorageStore } from './browserLibraryRendererStorageStore';
import { isActiveLibraryFileContextAllowed } from './activeLibraryFileContextPolicy';
import {
  getBrowserLibraryMarkdownCommandTargetClientId,
  getBrowserLibraryNativeFocusHandoff,
  shouldPromoteBrowserLibraryClientContext,
  shouldTargetBrowserLibraryNavigation,
} from './browserLibraryActiveContext';
import { buildBrowserLibraryUrl } from './browserLibraryUrl';
import {
  LibraryDocumentWindowManager,
  persistableLibraryDocumentWindowBounds,
  type LibraryDocumentWindowTarget,
} from './documentWindow';
import { DocumentPresenceManager, type DocumentPresenceContext } from './documentPresence';
import { getClipboardHistoryActivationPreflightSkipReason } from './clipboardHistoryActivationPolicy';
import { isFieldTheorySuperPasteBundleId, shouldRouteSuperPasteToLibrarian } from './superPasteRouting';
import { FeedbackManager } from './feedbackManager';
import type { AuthManager } from './authManager';
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
import { getHotkeyManager, HOTKEY_CONFIGS, KNOWN_CONFLICT_APPS } from './hotkeyManager';
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
  type FloatingIndicatorPosition,
  type RecordingIndicatorMode,
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
import type { QuotaManager } from './quotaManager';
import { registerQuotaIpc } from './quotaIpc';
import { AccountStatusManager } from './accountStatusManager';
import { registerAccountIpc } from './accountIpc';
import { DiagnosticsCollector } from './diagnosticsCollector';
import { CommandsManager, DEFAULT_IMPROVE_COMMAND_CONTENT, PortableCommand } from './commandsManager';
import { CommandSyncService } from './commandSyncService';
import { LocalLlmManager, isLocalLlmModelId, type LocalLlmModelId, type LocalLlmProgressEvent } from './localLlmManager';
import { MaxwellRunManager, type MaxwellRunRecord } from './maxwellRunManager';
import { MeetingManager, type MeetingSession } from './meetingManager';
import { registerMeetingsIpc } from './meetingsIpc';
import { LibrarySyncService } from './librarySyncService';
import { SharedSyncService, type SharedFilePresenceUser, type SharedFileShareInput } from './sharedSyncService';
import { parseSharedFileFrontmatter } from './sharedFiles';
import { SharedTeamService, type SharedTeamMutationResult } from './sharedTeamService';
import { isFieldTheoryInternalSyncEnvEnabled, resolveFieldTheorySyncStatus, type FieldTheorySyncStatus } from './releaseSyncPolicy';
import { registerFieldTheorySyncIpc } from './fieldTheorySyncIpc';
import { resolveStartupReadiness } from './startupReadinessPolicy';
import { collectQuitBlockingActivities, formatQuitBlockingActivityDetail } from './appQuitGuard';
import {
  CommandsIPCChannels,
  type LauncherFileIconResult,
  type LauncherFileSearchResult,
  type LauncherSettings,
  type LocalCommandRunMode,
  type LocalCommandRunRequest,
  type LocalCommandRunResult,
  type LocalCommandSelectionInput,
  type LocalCommandStatus,
  type MaxwellCancelResult,
  type MaxwellMemorySaveResult,
  type MaxwellMemoryState,
  type MaxwellRedoFailureReason,
  type MaxwellRedoResult,
  type MaxwellRunSummary,
  type MaxwellUndoFailureReason,
  type MaxwellUndoResult,
} from './types/commands';
import {
  type DocumentSaveResult,
  type DocumentVersion,
  documentSaveConflictIfVersionChanged,
  documentSaveResultForSharedConflict,
  documentSaveResultForUpdatedFile,
  readDocumentVersion,
  writeTextFileWithConflictGuard,
} from './documentSaveGuard';
import { CommandLauncherWindow } from './commandLauncherWindow';
import { waitForTargetAppFrontmost } from './commandLauncherActivation';
import { isExternalCommandTargetBundleId, isFieldTheoryCommandTargetBundleId, resolveCommandLauncherInvocationTarget } from './commandLauncherTarget';
import { appendCommandLauncherTrace, getCommandLauncherTracePath } from './commandLauncherTrace';
import { appendTranscriberTrace } from './transcriberTrace';
import { appendVisibilityTrace, isVisibilityTraceEnabled } from './visibilityTrace';
import type { LibrarianManager, LibraryBacklinkRelationDocument, LibraryBacklinkTarget, LibraryChangeEvent, LibraryRoot, Reading, ReadingMeta, WatchedDir, WikiBacklinkRelationDocument, WikiFolder, WikiPage, LibraryRenameEvent, ReadingRenameEvent, WikiNode } from './librarianManager';
import { inferLibrarianSetupComplete } from './librarianSetupState';
import { buildLibraryMigrationPlan, executeLibraryMigration } from './libraryMigration';
import { commandsDir, libraryDir } from './fieldTheoryPaths';
import { getPossibleIdeaBatch, listPossibleIdeaBatches } from './possibleIdeasManager';
import {
  autoUpdaterAllowsPrereleaseForBuildChannel,
  autoUpdaterAuthTokenForBuildChannel,
  autoUpdaterFeedOptionsForBuildChannel,
  autoUpdaterGitHubCliPaths,
  autoUpdaterReleaseRepoForBuildChannel,
  normalizeGitHubToken,
  resolveFieldTheoryBuildChannel,
} from './buildChannel';
import { isAllowedMarkdownExt, resolveIncomingMarkdownPath } from './openFileRouter';
import { isLibraryTextDocumentPath, libraryTextDocumentFileNameFromUserInput, stripMarkdownFileExtension } from './pathSafety';
import { setMarkdownArchivedState, stampMarkdownContentEditIfBodyChanged } from '../shared/markdownFrontmatter';
import { resolveUpdaterStatusTransition, type UpdateStatus } from '../shared/updaterState';
import {
  FIELD_THEORY_URL_SCHEME,
  fieldTheoryProtocolClientArgs,
  shouldRegisterFieldTheoryProtocol,
} from './urlProtocolRegistration';
import { browserLibraryTargetFromProtocolUrl } from './fieldTheoryProtocolTarget';
import { RecentManager, type RecentEntry } from './recentManager';
import type { BookmarksManager, BookmarksSnapshot } from './bookmarksManager';
import {
  getLocalImageCacheHeaders,
  getLocalImageContentType,
  isAllowedLocalImagePath,
  localImagePathFromProtocolUrl,
  shouldReturnLocalImageNotModified,
} from './localImageProtocol';
import { consolidateMarkdownAssetsForLibraryRoot, copyImageDataUrlForMarkdownDocument, copyImageForMarkdownDocument, deleteUnusedCopiedMarkdownImages, makeMarkdownImagesPortable } from './portableMarkdownImages';
import { getActiveBrowserPage } from './browserPageLocator';
import {
  COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
  CommandClipboardRestoreCoordinator,
  captureCommandClipboardPayload,
  captureClipboardSnapshot,
  clipboardMatchesCommandPayload,
  formatCommandFilePasteText,
  resolveCommandFilePasteDelivery,
  resolveCommandFilePasteMode,
  shouldUseNativeCommandLauncherClipboardTextPaste,
  restoreClipboardSnapshot,
  waitForCommandClipboardPasteRead,
  type ClipboardSnapshot,
  type CommandClipboardPayloadSnapshot,
} from './commandClipboard';
import { TaggedDocsIPCChannels, TaggedDocsManager, type TaggedDoc, type TaggedDocsScanProgress } from './taggedDocsManager';
import { MetricsManager } from './metricsManager';
import { registerMetricsIpc } from './metricsIpc';
import { MESSAGES } from './messages';
import { TodoStore, Todo } from './todoStore';
import { TodoIPCChannels } from './types/todo';
import { HotMicManager, KNOWN_TERMINALS } from './hotMicManager';
import { HOT_MIC_DEFAULTS, HOT_MIC_DEFAULT_SYSTEM_COMMANDS, HOT_MIC_DEFAULT_WINDOW_COMMANDS } from './hotMicDefaults';
import { detectSSHSession, scpToRemote, SSHTarget } from './sshDetector';
import { SquaresManager } from './squaresManager';
import { CodexTerminalIPCChannels, CodexTerminalManager, type CodexTerminalPageContext } from './codexTerminalManager';
import { readCodexTerminalPasteText } from './codexTerminalClipboard';
import { isAllowedExternalShellUrl, registerShellIpc } from './shellIpc';

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
const renderedEditorDebugLogPath = path.join(process.cwd(), '.logs', 'rendered-editor-debug.jsonl');
const scrollDiagnosticsLogPath = path.join(process.cwd(), '.logs', 'scroll-diagnostics.jsonl');
const LIBRARY_RENAME_TRACE_ENABLED = process.env.LIBRARY_RENAME_TRACE === 'true';
const STARTUP_PROFILE_ENABLED = ['1', 'true', 'yes', 'on'].includes((process.env.FIELD_THEORY_STARTUP_PROFILE ?? '').toLowerCase());
const STARTUP_LAUNCHED_AT_MS = Number.parseFloat(process.env.FIELD_THEORY_STARTUP_LAUNCHED_AT_MS ?? '');
const STARTUP_BENCH_EXIT_AFTER = process.env.FIELD_THEORY_STARTUP_BENCH_EXIT_AFTER?.trim() ?? '';
const STARTUP_PROFILE_PATH = process.env.FIELD_THEORY_STARTUP_PROFILE_PATH?.trim() ?? '';
const startupMarks: Array<{ stage: string; moduleMs: number; launchedMs: number | null }> = [];

function writeStartupProfileLine(line: string): void {
  process.stderr.write(`${line}\n`);
  if (!STARTUP_PROFILE_PATH) return;
  try {
    fs.appendFileSync(STARTUP_PROFILE_PATH, `${line}\n`);
  } catch {
    // Profiling must never block app startup.
  }
}

function startupMark(stage: string): void {
  if (!STARTUP_PROFILE_ENABLED) return;
  const now = Date.now();
  const mark = {
    stage,
    moduleMs: now - BOOT_MARK,
    launchedMs: Number.isFinite(STARTUP_LAUNCHED_AT_MS) ? now - STARTUP_LAUNCHED_AT_MS : null,
  };
  startupMarks.push(mark);
  writeStartupProfileLine(`[StartupProfile] ${stage} moduleMs=${mark.moduleMs} launchedMs=${mark.launchedMs ?? 'n/a'}`);
}

function maybeExitStartupBenchmark(stage: string): void {
  if (!STARTUP_PROFILE_ENABLED || STARTUP_BENCH_EXIT_AFTER !== stage) return;
  writeStartupProfileLine(`[StartupProfile] summary ${JSON.stringify(startupMarks)}`);
  setTimeout(() => {
    app.quit();
  }, 25);
}

function markStartupSurfaceShown(window: BrowserWindow | null, stage: string): void {
  if (!window || window.isDestroyed()) return;
  const markShown = () => {
    startupMark(stage);
    maybeExitStartupBenchmark(stage);
  };
  if (window.isVisible()) {
    markShown();
    return;
  }
  window.once('show', markShown);
}

function writeJsonlDiagnosticLog(filePath: string, entry: unknown): { ok: boolean; path: string; error?: string } {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({ receivedAt: Date.now(), entry })}\n`,
      'utf-8',
    );
    return { ok: true, path: filePath };
  } catch (error) {
    return {
      ok: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function clearJsonlDiagnosticLog(filePath: string): { ok: boolean; path: string; error?: string } {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf-8');
    return { ok: true, path: filePath };
  } catch (error) {
    return {
      ok: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeRenderedEditorDebugLog(entry: unknown): { ok: boolean; path: string; error?: string } {
  return writeJsonlDiagnosticLog(renderedEditorDebugLogPath, entry);
}

function clearRenderedEditorDebugLog(): { ok: boolean; path: string; error?: string } {
  return clearJsonlDiagnosticLog(renderedEditorDebugLogPath);
}

function writeScrollDiagnosticsLog(entry: unknown): { ok: boolean; path: string; error?: string } {
  return writeJsonlDiagnosticLog(scrollDiagnosticsLogPath, entry);
}

function clearScrollDiagnosticsLog(): { ok: boolean; path: string; error?: string } {
  return clearJsonlDiagnosticLog(scrollDiagnosticsLogPath);
}

function traceLibraryRename(stage: string, payload: Record<string, unknown>): void {
  if (!LIBRARY_RENAME_TRACE_ENABLED) return;
  log.warn('[RenameTrace] %s %o', stage, payload);
}

const BOOT_MARK = Date.now();
startupMark('module-loaded');
const VISION_BUILD_ENABLED = false;
const MARKDOWN_PREVIEW_MAX_BYTES = 512 * 1024;
const BOOKMARK_BACKGROUND_SYNC_STALE_MS = 15 * 60 * 1000;
const SHARED_FILES_SYNC_DEBOUNCE_MS = 1500;

// Helper for exec with timeout to prevent osascript hangs (especially with Finder)
const { exec, execFile: execFileCp, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFileCp);

type BookmarkBackgroundSyncResult =
  | { status: 'synced' | 'already-running' | 'too-recent' | 'missing-cli' | 'unavailable' }
  | { status: 'failed'; error: string };

let bookmarkBackgroundSyncInFlight: Promise<BookmarkBackgroundSyncResult> | null = null;
const COMMAND_LAUNCHER_PASTE_TRACE_VERSION = 3;
const commandClipboardRestoreCoordinator = new CommandClipboardRestoreCoordinator();
const MAIN_PROCESS_STARTED_AT = new Date().toISOString();
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

function createLauncherSessionId(): string {
  return `launcher-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function elapsedMsSince(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

const QUALITY_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-benchmark=';
const QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-external-benchmark=';
const QUALITY_BROWSER_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-browser-benchmark=';
const QUALITY_COMMAND_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-command-benchmark=';
const QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-launcher-benchmark=';
const QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-launcher-normal-focus-benchmark=';
const QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-immersive-benchmark=';
const QUALITY_RECORDING_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-recording-benchmark=';
const QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-recording-asr-benchmark=';
const QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX = '--field-theory-run-quality-recording-asr-delivery-benchmark=';
const QUALITY_BENCHMARK_SWITCH = 'field-theory-run-quality-benchmark';
const QUALITY_EXTERNAL_BENCHMARK_SWITCH = 'field-theory-run-quality-external-benchmark';
const QUALITY_BROWSER_BENCHMARK_SWITCH = 'field-theory-run-quality-browser-benchmark';
const QUALITY_COMMAND_BENCHMARK_SWITCH = 'field-theory-run-quality-command-benchmark';
const QUALITY_LAUNCHER_BENCHMARK_SWITCH = 'field-theory-run-quality-launcher-benchmark';
const QUALITY_LAUNCHER_NORMAL_BENCHMARK_SWITCH = 'field-theory-run-quality-launcher-normal-focus-benchmark';
const QUALITY_IMMERSIVE_BENCHMARK_SWITCH = 'field-theory-run-quality-immersive-benchmark';
const QUALITY_RECORDING_BENCHMARK_SWITCH = 'field-theory-run-quality-recording-benchmark';
const QUALITY_RECORDING_ASR_BENCHMARK_SWITCH = 'field-theory-run-quality-recording-asr-benchmark';
const QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_SWITCH = 'field-theory-run-quality-recording-asr-delivery-benchmark';

function qualityBenchmarkIdFromArgv(argv: string[]): string | null {
  const arg = argv.find(item => (
    item.startsWith(QUALITY_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_BROWSER_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_COMMAND_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_RECORDING_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX)
    || item.startsWith(QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX)
  ));
  let prefix = QUALITY_BENCHMARK_ARG_PREFIX;
  if (arg?.startsWith(QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_BROWSER_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_BROWSER_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_COMMAND_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_COMMAND_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX;
  } else if (arg?.startsWith(QUALITY_RECORDING_BENCHMARK_ARG_PREFIX)) {
    prefix = QUALITY_RECORDING_BENCHMARK_ARG_PREFIX;
  }
  const id = arg?.slice(prefix.length).trim();
  return id || null;
}

function shouldRunExternalQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_EXTERNAL_BENCHMARK_ARG_PREFIX));
}

function shouldRunBrowserQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_BROWSER_BENCHMARK_ARG_PREFIX));
}

function shouldRunCommandQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_COMMAND_BENCHMARK_ARG_PREFIX));
}

function shouldRunLauncherQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_LAUNCHER_BENCHMARK_ARG_PREFIX));
}

function shouldRunLauncherNormalQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_LAUNCHER_NORMAL_BENCHMARK_ARG_PREFIX));
}

function shouldRunImmersiveQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_IMMERSIVE_BENCHMARK_ARG_PREFIX));
}

function shouldRunRecordingQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_RECORDING_BENCHMARK_ARG_PREFIX));
}

function shouldRunRecordingAsrQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_RECORDING_ASR_BENCHMARK_ARG_PREFIX));
}

function shouldRunRecordingAsrDeliveryQualityBenchmark(argv: string[]): boolean {
  return argv.some(item => item.startsWith(QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_ARG_PREFIX));
}

function qualityBenchmarkIdFromCommandLine(): string | null {
  return app.commandLine.getSwitchValue(QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_RECORDING_ASR_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_RECORDING_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_IMMERSIVE_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_LAUNCHER_NORMAL_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_LAUNCHER_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_COMMAND_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_BROWSER_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_EXTERNAL_BENCHMARK_SWITCH)
    || app.commandLine.getSwitchValue(QUALITY_BENCHMARK_SWITCH)
    || qualityBenchmarkIdFromArgv(process.argv)
    || null;
}

function qualityBenchmarkModeFromCommandLine(): 'controlled' | 'external' | 'browser' | 'command' | 'launcher' | 'launcher-normal' | 'immersive' | 'recording' | 'recording-asr' | 'recording-asr-delivery' {
  if (app.commandLine.hasSwitch(QUALITY_RECORDING_ASR_DELIVERY_BENCHMARK_SWITCH) || shouldRunRecordingAsrDeliveryQualityBenchmark(process.argv)) return 'recording-asr-delivery';
  if (app.commandLine.hasSwitch(QUALITY_RECORDING_ASR_BENCHMARK_SWITCH) || shouldRunRecordingAsrQualityBenchmark(process.argv)) return 'recording-asr';
  if (app.commandLine.hasSwitch(QUALITY_RECORDING_BENCHMARK_SWITCH) || shouldRunRecordingQualityBenchmark(process.argv)) return 'recording';
  if (app.commandLine.hasSwitch(QUALITY_IMMERSIVE_BENCHMARK_SWITCH) || shouldRunImmersiveQualityBenchmark(process.argv)) return 'immersive';
  if (app.commandLine.hasSwitch(QUALITY_LAUNCHER_NORMAL_BENCHMARK_SWITCH) || shouldRunLauncherNormalQualityBenchmark(process.argv)) return 'launcher-normal';
  if (app.commandLine.hasSwitch(QUALITY_LAUNCHER_BENCHMARK_SWITCH) || shouldRunLauncherQualityBenchmark(process.argv)) return 'launcher';
  if (app.commandLine.hasSwitch(QUALITY_COMMAND_BENCHMARK_SWITCH) || shouldRunCommandQualityBenchmark(process.argv)) return 'command';
  if (app.commandLine.hasSwitch(QUALITY_BROWSER_BENCHMARK_SWITCH) || shouldRunBrowserQualityBenchmark(process.argv)) return 'browser';
  if (app.commandLine.hasSwitch(QUALITY_EXTERNAL_BENCHMARK_SWITCH) || shouldRunExternalQualityBenchmark(process.argv)) return 'external';
  return 'controlled';
}

type QualityBenchmarkDeliveryResult = {
  success: boolean;
  elapsedMs: number;
  deliveredLength: number;
  error?: string;
};

async function waitForLauncherBenchmarkReady(
  launcherWindow: CommandLauncherWindow,
  traceContext: Record<string, unknown>,
  eventName = 'launcher-interaction-benchmark-ready',
): Promise<boolean> {
  const startedAt = process.hrtime.bigint();
  const inspectReadiness = `
(() => {
  const input = document.querySelector('input[name="field-theory-command-launcher-query"]');
  return {
    hasInput: Boolean(input),
    ready: Boolean(window.__fieldTheoryLauncherBenchmarkReady),
    documentReadyState: document.readyState,
  };
})()
`;

  let lastState: unknown = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    lastState = await launcherWindow.executeJavaScript<unknown>(inspectReadiness);
    if (
      typeof lastState === 'object'
      && lastState !== null
      && (lastState as { hasInput?: unknown }).hasInput === true
      && (lastState as { ready?: unknown }).ready === true
    ) {
      appendCommandLauncherTrace(eventName, {
        ...traceContext,
        elapsedMs: elapsedMsSince(startedAt),
        attempt,
      });
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  appendCommandLauncherTrace(`${eventName}-timeout`, {
    ...traceContext,
    elapsedMs: elapsedMsSince(startedAt),
    lastState,
  });
  return false;
}

async function runControlledBenchmarkDelivery(
  traceContext: Record<string, unknown>,
  text: string,
): Promise<QualityBenchmarkDeliveryResult> {
  const clipboardSnapshot = clipboard.readText();
  const startedAt = process.hrtime.bigint();
  let targetWindow: BrowserWindow | null = null;

  try {
    targetWindow = new BrowserWindow({
      width: 320,
      height: 120,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<textarea id="target" autofocus></textarea>')}`);
    await targetWindow.webContents.executeJavaScript('document.getElementById("target").focus();', true);
    clipboard.writeText(text);
    targetWindow.webContents.paste();

    let delivered = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      delivered = await targetWindow.webContents.executeJavaScript('document.getElementById("target").value;', true);
      if (delivered === text) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return {
      success: delivered === text,
      elapsedMs,
      deliveredLength: delivered.length,
      error: delivered === text ? undefined : 'Controlled target did not receive expected text',
    };
  } catch (error) {
    return {
      success: false,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      deliveredLength: 0,
      error: error instanceof Error ? error.message : 'Controlled delivery failed',
    };
  } finally {
    try {
      clipboard.writeText(clipboardSnapshot);
    } catch {}
    if (targetWindow && !targetWindow.isDestroyed()) {
      const windowToDestroy = targetWindow;
      setTimeout(() => {
        if (!windowToDestroy.isDestroyed()) {
          windowToDestroy.destroy();
        }
      }, 100);
    }
    appendCommandLauncherTrace('invoke-command-controlled-delivery-cleanup', {
      ...traceContext,
      clipboardRestored: true,
    });
  }
}

async function runExternalTextEditBenchmarkDelivery(
  traceContext: Record<string, unknown>,
  text: string,
): Promise<QualityBenchmarkDeliveryResult> {
  const clipboardSnapshot = clipboard.readText();
  const startedAt = process.hrtime.bigint();

  try {
    clipboard.writeText(text);
    const script = `
on run argv
  set expectedText to item 1 of argv
  set deliveredText to ""
  tell application "TextEdit"
    activate
    make new document with properties {text:""}
  end tell
  delay 0.5
  tell application "System Events"
    tell process "TextEdit"
      set frontmost to true
      keystroke "v" using command down
    end tell
  end tell
  repeat 40 times
    tell application "TextEdit"
      set deliveredText to text of front document
    end tell
    if deliveredText is expectedText or deliveredText is (expectedText & linefeed) then exit repeat
    delay 0.05
  end repeat
  tell application "TextEdit"
    set deliveredText to text of front document
    close front document saving no
  end tell
  return deliveredText
end run`;
    const result = await execFileAsync('osascript', ['-e', script, text], { timeout: 5000 });
    const delivered = result.stdout.replace(/\r?\n$/, '');
    const normalizedDelivered = delivered === `${text}\n` ? text : delivered;
    return {
      success: normalizedDelivered === text,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      deliveredLength: delivered.length,
      error: normalizedDelivered === text ? undefined : 'TextEdit did not receive expected text',
    };
  } catch (error) {
    try {
      await execFileAsync('osascript', ['-e', 'tell application "TextEdit" to if (count of documents) > 0 then close front document saving no'], { timeout: 1000 });
    } catch {}
    return {
      success: false,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      deliveredLength: 0,
      error: error instanceof Error ? error.message : 'External delivery failed',
    };
  } finally {
    try {
      clipboard.writeText(clipboardSnapshot);
    } catch {}
    appendCommandLauncherTrace('invoke-command-external-delivery-cleanup', {
      ...traceContext,
      clipboardRestored: true,
    });
  }
}

async function runExternalSafariTextareaBenchmarkDelivery(
  traceContext: Record<string, unknown>,
  text: string,
): Promise<QualityBenchmarkDeliveryResult> {
  const clipboardSnapshot = clipboard.readText();
  const startedAt = process.hrtime.bigint();
  const pageHtml = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Field Theory Quality Benchmark</title>',
    '<textarea id="target" autofocus style="width:90vw;height:70vh;font:16px -apple-system;"></textarea>',
    '<script>requestAnimationFrame(() => document.getElementById("target").focus());</script>',
  ].join('');
  const targetUrl = `data:text/html;charset=utf-8,${encodeURIComponent(pageHtml)}`;

  try {
    clipboard.writeText(text);
    const setupStartedAt = process.hrtime.bigint();
    const setupScript = `
on run argv
  set targetUrl to item 1 of argv
  tell application "Safari"
    activate
    make new document with properties {URL:targetUrl}
  end tell
  delay 0.7
  tell application "System Events"
    tell process "Safari"
      set frontmost to true
    end tell
  end tell
end run`;
    await execFileAsync('osascript', ['-e', setupScript, targetUrl], { timeout: 5000 });
    appendCommandLauncherTrace('invoke-command-benchmark-phase', {
      ...traceContext,
      phase: 'open-safari-textarea',
      elapsedMs: elapsedMsSince(setupStartedAt),
    });

    const deliveryStartedAt = process.hrtime.bigint();
    const deliveryScript = `
on run argv
  set expectedText to item 1 of argv
  set deliveredText to ""
  tell application "System Events"
    tell process "Safari"
      set frontmost to true
      keystroke "v" using command down
    end tell
  end tell
  delay 0.1
  repeat 40 times
    tell application "System Events"
      tell process "Safari"
        set frontmost to true
        keystroke "a" using command down
        delay 0.02
        keystroke "c" using command down
      end tell
    end tell
    delay 0.05
    try
      set deliveredText to the clipboard as text
    on error
      set deliveredText to ""
    end try
    if deliveredText is expectedText then exit repeat
  end repeat
  tell application "Safari"
    try
      close front window
    end try
  end tell
  return deliveredText
end run`;
    const result = await execFileAsync('osascript', ['-e', deliveryScript, text], { timeout: 7000 });
    const delivered = result.stdout.replace(/\r?\n$/, '');
    return {
      success: delivered === text,
      elapsedMs: Number(process.hrtime.bigint() - deliveryStartedAt) / 1_000_000,
      deliveredLength: delivered.length,
      error: delivered === text ? undefined : 'Safari textarea did not receive expected text',
    };
  } catch (error) {
    try {
      await execFileAsync('osascript', ['-e', 'tell application "Safari" to try\nclose front window\nend try'], { timeout: 1000 });
    } catch {}
    return {
      success: false,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      deliveredLength: 0,
      error: error instanceof Error ? error.message : 'Safari textarea delivery failed',
    };
  } finally {
    try {
      clipboard.writeText(clipboardSnapshot);
    } catch {}
    appendCommandLauncherTrace('invoke-command-browser-delivery-cleanup', {
      ...traceContext,
      clipboardRestored: true,
    });
  }
}

async function openTextEditBenchmarkDocument(): Promise<void> {
  const script = `
tell application "TextEdit"
  activate
  make new document with properties {text:""}
end tell
tell application "System Events"
  repeat 40 times
    if exists process "TextEdit" then
      tell process "TextEdit"
        set frontmost to true
        if exists window 1 then exit repeat
      end tell
    end if
    delay 0.05
  end repeat
end tell
tell application "TextEdit"
  activate
end tell
delay 0.1`;
  await execFileAsync('osascript', ['-e', script], { timeout: 3000 });
}

async function activateTargetAppWithSystemEvents(targetApp: { bundleId: string; name: string }): Promise<void> {
  const activateScript = `
on run argv
  set targetBundleId to item 1 of argv
  set targetName to item 2 of argv
  tell application id targetBundleId
    activate
  end tell
  tell application "System Events"
    if exists process targetName then
      tell process targetName
        set frontmost to true
      end tell
    end if
  end tell
end run`;
  await execFileAsync('osascript', ['-e', activateScript, targetApp.bundleId, targetApp.name], { timeout: 3000 });
}

async function readAndCloseTextEditBenchmarkDocument(expectedText: string): Promise<{
  success: boolean;
  deliveredLength: number;
  error?: string;
}> {
  const script = `
on run argv
  set expectedText to item 1 of argv
  set deliveredText to ""
  repeat 40 times
    tell application "TextEdit"
      set deliveredText to text of front document
    end tell
    if deliveredText is expectedText or deliveredText is (expectedText & linefeed) then exit repeat
    delay 0.05
  end repeat
  tell application "TextEdit"
    close front document saving no
  end tell
  return deliveredText
end run`;
  const result = await execFileAsync('osascript', ['-e', script, expectedText], { timeout: 5000 });
  const delivered = result.stdout.replace(/\r?\n$/, '');
  const normalizedDelivered = delivered === `${expectedText}\n` ? expectedText : delivered;
  return {
    success: normalizedDelivered === expectedText,
    deliveredLength: delivered.length,
    error: normalizedDelivered === expectedText ? undefined : 'TextEdit did not receive expected command text',
  };
}

async function readAndCloseTextEditCommandBenchmarkDocument(expectedText: string): Promise<{
  success: boolean;
  deliveredLength: number;
  error?: string;
}> {
  const script = `
on run argv
  set expectedText to item 1 of argv
  set deliveredText to ""
  repeat 40 times
    tell application "TextEdit"
      set deliveredText to text of front document
    end tell
    if deliveredText contains expectedText then exit repeat
    delay 0.05
  end repeat
  tell application "TextEdit"
    close front document saving no
  end tell
  return deliveredText
end run`;
  const result = await execFileAsync('osascript', ['-e', script, expectedText], { timeout: 5000 });
  const delivered = result.stdout.replace(/\r?\n$/, '');
  return {
    success: delivered.includes(expectedText),
    deliveredLength: delivered.length,
    error: delivered.includes(expectedText) ? undefined : 'TextEdit document did not contain expected command text',
  };
}

async function runCommandTextEditBenchmarkDelivery(
  traceContext: Record<string, unknown>,
  text: string,
): Promise<QualityBenchmarkDeliveryResult> {
  const benchmarkStartedAt = process.hrtime.bigint();
  let deliveryStartedAt = benchmarkStartedAt;
  const commandName = 'quality-benchmark-command';
  const commandPath = path.join(os.tmpdir(), `field-theory-quality-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.md`);
  const targetApp = { bundleId: 'com.apple.TextEdit', name: 'TextEdit' };
  let documentNeedsCleanup = false;

  try {
    fs.writeFileSync(commandPath, text, 'utf8');
    const openDocumentStartedAt = process.hrtime.bigint();
    await openTextEditBenchmarkDocument();
    documentNeedsCleanup = true;
    appendCommandLauncherTrace('invoke-command-benchmark-phase', {
      ...traceContext,
      phase: 'open-textedit-document',
      elapsedMs: elapsedMsSince(openDocumentStartedAt),
    });

    const pasteMode = resolveCommandFilePasteMode({ isTerminal: false, isIDE: false });
    const commandText = formatCommandFilePasteText({
      kind: 'command',
      name: commandName,
      filePath: commandPath,
      mode: pasteMode,
      markdownContent: text,
    });
    deliveryStartedAt = process.hrtime.bigint();

    const pasteResult = await runWithCommandLauncherExternalInvocation(async (): Promise<{ success: boolean; error?: string }> => {
      const clipboardRestore = commandClipboardRestoreCoordinator.begin(captureClipboardSnapshot());
      let launcherClipboardPayload: CommandClipboardPayloadSnapshot | null = null;
      try {
        const clipboardStartedAt = process.hrtime.bigint();
        clipboard.writeText(commandText);
        clipboardManager?.syncClipboardHash();
        launcherClipboardPayload = captureCommandClipboardPayload();
        appendCommandLauncherTrace('invoke-command-clipboard-written', {
          ...traceContext,
          commandName,
          format: 'text',
          contentMode: pasteMode,
          targetBundleId: targetApp.bundleId,
          targetName: targetApp.name,
          textReferenceTarget: false,
          markdownContentTarget: true,
          ...commandPayloadTrace(commandText),
          textLength: commandText.length,
          clipboard: readCommandPasteClipboardTrace(),
        });
        appendCommandLauncherTrace('invoke-command-benchmark-phase', {
          ...traceContext,
          phase: 'clipboard-write',
          elapsedMs: elapsedMsSince(clipboardStartedAt),
        });

        let pasted = false;
        const pasteDelivery = resolveCommandFilePasteDelivery({ mode: pasteMode, isTerminal: false, isIDE: false });
        const pasteStartedAt = process.hrtime.bigint();
        if (pasteDelivery === 'native-helper') {
          pasted = await typeTextFromCommandLauncher(targetApp, commandText, 'invoke-command', traceContext);
        } else {
          appendCommandLauncherTrace('invoke-command-native-type-skipped', {
            ...traceContext,
            commandName,
            targetBundleId: targetApp.bundleId,
            targetName: targetApp.name,
            contentMode: pasteMode,
            delivery: pasteDelivery,
          });
        }
        if (!pasted) {
          appendCommandLauncherTrace('invoke-command-native-type-fallback', {
            ...traceContext,
            commandName,
            targetBundleId: targetApp.bundleId,
            targetName: targetApp.name,
            contentMode: pasteMode,
          });
        }
        if (!pasted) {
          pasted = await activateAndPasteFromCommandLauncher(targetApp, {
            clipboardTrace: readCommandPasteClipboardTrace,
            requireFocusedTextInput: true,
            traceDetails: traceContext,
          });
        }
        appendCommandLauncherTrace('invoke-command-benchmark-phase', {
          ...traceContext,
          phase: pasted ? 'paste-delivery' : 'paste-delivery-failed',
          strategy: pasteDelivery,
          elapsedMs: elapsedMsSince(pasteStartedAt),
        });
        return pasted
          ? { success: true }
          : { success: false, error: 'Could not paste command text into TextEdit' };
      } finally {
        scheduleCommandClipboardRestore({
          commandName,
          commandPath,
          restoreGeneration: clipboardRestore.generation,
          restoreSnapshot: clipboardRestore.snapshot,
          launcherClipboardPayload,
        });
      }
    });

    if (!pasteResult.success) {
      return {
        success: false,
        elapsedMs: Number(process.hrtime.bigint() - deliveryStartedAt) / 1_000_000,
        deliveredLength: 0,
        error: pasteResult.error,
      };
    }

    const verifyStartedAt = process.hrtime.bigint();
    const delivered = await readAndCloseTextEditCommandBenchmarkDocument(commandText);
    appendCommandLauncherTrace('invoke-command-benchmark-phase', {
      ...traceContext,
      phase: delivered.success ? 'verify-textedit-delivery' : 'verify-textedit-delivery-failed',
      elapsedMs: elapsedMsSince(verifyStartedAt),
      deliveredLength: delivered.deliveredLength,
    });
    documentNeedsCleanup = false;
    return {
      success: delivered.success,
      elapsedMs: Number(process.hrtime.bigint() - deliveryStartedAt) / 1_000_000,
      deliveredLength: delivered.deliveredLength,
      error: delivered.error,
    };
  } catch (error) {
    return {
      success: false,
      elapsedMs: Number(process.hrtime.bigint() - deliveryStartedAt) / 1_000_000,
      deliveredLength: 0,
      error: error instanceof Error ? error.message : 'Command delivery benchmark failed',
    };
  } finally {
    try {
      fs.rmSync(commandPath, { force: true });
    } catch {}
    if (documentNeedsCleanup) {
      try {
        await execFileAsync('osascript', ['-e', 'tell application "TextEdit" to if (count of documents) > 0 then close front document saving no'], { timeout: 1000 });
      } catch {}
    }
  }
}

async function runLauncherInteractionQualityBenchmark(
  benchmarkId: string,
  options: { focusProtection?: boolean } = {},
): Promise<void> {
  if (!commandLauncherWindow) {
    appendCommandLauncherTrace('launcher-interaction-benchmark-error', {
      benchmark: true,
      benchmarkId,
      error: 'Command launcher window unavailable',
    });
    return;
  }

  const launcherSessionId = `benchmark-${benchmarkId}`;
  const traceContext = {
    benchmark: true,
    benchmarkId,
    launcherSessionId,
    delivery: options.focusProtection === false ? 'launcher-interaction-normal' : 'launcher-interaction-focus-protected',
    qualityScenario: options.focusProtection === false ? 'synthetic-launcher-normal-focus' : 'synthetic-launcher-focus-protected',
  };
  const query = 'quality benchmark';

  appendCommandLauncherTrace('launcher-interaction-benchmark-start', traceContext);
  const preloadReady = await waitForLauncherBenchmarkReady(
    commandLauncherWindow,
    traceContext,
    'launcher-interaction-benchmark-preload-ready',
  );
  if (!preloadReady) return;
  appendCommandLauncherTrace('hotkey-trigger', {
    ...traceContext,
    source: 'quality-benchmark',
  });
  await commandLauncherWindow.show({
    launcherSessionId,
    qualityScenario: String(traceContext.qualityScenario),
    ...(options.focusProtection === false ? {} : { suppressBlurHideMs: 2500 }),
  });
  const ready = await waitForLauncherBenchmarkReady(commandLauncherWindow, traceContext);
  if (!ready) return;
  const setBenchmarkQuery = `
(() => {
  const input = document.querySelector('input[name="field-theory-command-launcher-query"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, ${JSON.stringify(query)});
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(query)} }));
  return true;
})()
`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const didSetQuery = await commandLauncherWindow.executeJavaScript<boolean>(setBenchmarkQuery);
    if (didSetQuery) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  await commandLauncherWindow.executeJavaScript<boolean>(setBenchmarkQuery);
  await new Promise(resolve => setTimeout(resolve, 1000));
  commandLauncherWindow.hide(true);
  appendCommandLauncherTrace('launcher-interaction-benchmark-success', traceContext);
}

async function runImmersiveSurfaceQualityBenchmark(benchmarkId: string): Promise<void> {
  const qualityScenario = 'renderer-driven-immersive-surface';
  const traceContext = {
    benchmark: true,
    benchmarkId,
    launcherSessionId: `benchmark-${benchmarkId}`,
    delivery: 'immersive-surface',
    qualityScenario,
  };
  const startedAt = process.hrtime.bigint();
  appendCommandLauncherTrace('immersive-surface-benchmark-start', traceContext);
  try {
    if (!clipboardHistoryWindow) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
    }
    const libraryBounds = restoreClipboardHistoryBounds('library');
    clipboardHistoryWindow.showLibrary(libraryBounds, true, true);
    const immersiveRelPath = process.env.FIELD_THEORY_QUALITY_IMMERSIVE_WIKI_REL_PATH?.trim();
    if (immersiveRelPath) {
      clipboardHistoryWindow.openScratchpad({ relPath: immersiveRelPath });
    }
    await new Promise(resolve => setTimeout(resolve, 600));
    if (immersiveRelPath) {
      clipboardHistoryWindow.openScratchpad({ relPath: immersiveRelPath });
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const targetWindow = clipboardHistoryWindow.getWindow?.();
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error('Clipboard history BrowserWindow unavailable');
    }
    const librarySurfaceReady = await targetWindow.webContents.executeJavaScript(`
new Promise((resolve) => {
  const selectors = [
    '[data-ft-rendered-editor-root="true"]',
    '[data-ft-quality-editor="markdown"]',
    '[data-ft-librarian-content-scroll="true"]',
  ];
  const hasSurface = () => selectors.some((selector) => document.querySelector(selector));
  if (hasSurface()) {
    resolve(true);
    return;
  }
  const observer = new MutationObserver(() => {
    if (!hasSurface()) return;
    observer.disconnect();
    window.clearTimeout(timeout);
    resolve(true);
  });
  const timeout = window.setTimeout(() => {
    observer.disconnect();
    resolve(false);
  }, 3500);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})
`, true);
    appendCommandLauncherTrace('immersive-surface-library-ready', {
      ...traceContext,
      librarySurfaceReady,
    });
    const result = await targetWindow.webContents.executeJavaScript(`
(() => {
  const api = window.ftDebugScroll;
  if (!api?.recordRendererJourneyQualitySamples) {
    return { ok: false, error: 'ftDebugScroll renderer journey helper unavailable' };
  }
  return Promise.resolve(api.recordRendererJourneyQualitySamples(${JSON.stringify(qualityScenario)}, ${JSON.stringify(benchmarkId)}))
    .then((result) => {
      const evidence = result?.evidence ?? {};
      const journeyOk = Boolean(
        evidence.librarySurfaceReady
          && evidence.renderedScroll?.targetFound
          && evidence.markdownScroll?.targetFound
          && evidence.renderedInput?.targetFound
          && evidence.markdownInput?.targetFound
      );
      return { ...result, ok: journeyOk, journeyOk };
    });
})()
`, true);
    const launcherWindow = commandLauncherWindow;
    if (!launcherWindow) {
      throw new Error('Command launcher window unavailable for immersive journey');
    }
    const launcherReady = await waitForLauncherBenchmarkReady(
      launcherWindow,
      traceContext,
      'immersive-surface-launcher-preload-ready',
    );
    if (launcherReady) {
      appendCommandLauncherTrace('hotkey-trigger', {
        ...traceContext,
        source: 'quality-benchmark',
      });
      await launcherWindow.show({
        launcherSessionId: String(traceContext.launcherSessionId),
        qualityScenario,
        suppressBlurHideMs: 2500,
      });
      const ready = await waitForLauncherBenchmarkReady(launcherWindow, traceContext);
      if (ready) {
        const query = 'quality journey';
        await launcherWindow.executeJavaScript<boolean>(`
(() => {
  const api = window.ftDebugScroll;
  api?.enable?.();
  api?.setQualityContext?.({
    qualityScenario: ${JSON.stringify(qualityScenario)},
    benchmarkId: ${JSON.stringify(benchmarkId)},
    sampleOrigin: 'programmatic-dom-event',
    journeyStep: 'launcher-type',
  });
  const input = document.querySelector('input[name="field-theory-command-launcher-query"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, ${JSON.stringify(query)});
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(query)} }));
  window.setTimeout(() => api?.clearQualityContext?.(), 400);
  return true;
})()
`);
        await new Promise(resolve => setTimeout(resolve, 450));
        launcherWindow.hide(true);
      }
    }
    appendCommandLauncherTrace('immersive-surface-benchmark-success', {
      ...traceContext,
      elapsedMs: elapsedMsSince(startedAt),
      result,
    });
  } catch (error) {
    appendCommandLauncherTrace('immersive-surface-benchmark-error', {
      ...traceContext,
      elapsedMs: elapsedMsSince(startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runRecordingDeliveryQualityBenchmark(benchmarkId: string): Promise<void> {
  const traceContext = {
    benchmark: true,
    benchmarkId,
    delivery: 'recording-textedit',
    qualityScenario: 'synthetic-recording-textedit',
    source: 'quality-benchmark',
  };
  const text = `Field Theory recording benchmark ${benchmarkId}`;
  let documentNeedsCleanup = false;

  if (!transcriberManager) {
    appendTranscriberTrace('benchmark.error', {
      ...traceContext,
      error: 'Transcriber manager unavailable',
    });
    return;
  }

  try {
    appendTranscriberTrace('benchmark.start', traceContext);
    await openTextEditBenchmarkDocument();
    documentNeedsCleanup = true;
    await activateTargetAppWithSystemEvents({ bundleId: 'com.apple.TextEdit', name: 'TextEdit' });
    const result = await transcriberManager.runRecordingDeliveryQualityBenchmark({
      benchmarkId,
      text,
    });
    const delivered = await readAndCloseTextEditCommandBenchmarkDocument(text);
    documentNeedsCleanup = false;
    if (result.success && delivered.success) {
      appendTranscriberTrace('benchmark.delivery-success', {
        ...traceContext,
        deliveryElapsedMs: result.pasteMs,
        totalMs: result.totalMs,
        deliveredLength: delivered.deliveredLength,
      });
    } else {
      appendTranscriberTrace('benchmark.delivery-error', {
        ...traceContext,
        deliveryElapsedMs: result.pasteMs,
        totalMs: result.totalMs,
        deliveredLength: delivered.deliveredLength,
        error: result.error ?? delivered.error ?? 'Recording benchmark delivery failed',
      });
    }
  } catch (error) {
    appendTranscriberTrace('benchmark.error', {
      ...traceContext,
      error,
    });
  } finally {
    if (documentNeedsCleanup) {
      try {
        await execFileAsync('osascript', ['-e', 'tell application "TextEdit" to if (count of documents) > 0 then close front document saving no'], { timeout: 1000 });
      } catch {}
    }
  }
}

async function runRecordingAsrQualityBenchmark(benchmarkId: string): Promise<void> {
  const traceContext = {
    benchmark: true,
    benchmarkId,
    delivery: 'recording-asr-fixture',
    qualityScenario: 'fixture-audio',
    source: 'quality-benchmark',
  };
  let audioCleanup: (() => void) | null = null;

  if (!transcriberManager) {
    appendTranscriberTrace('benchmark.asr-error', {
      ...traceContext,
      error: 'Transcriber manager unavailable',
    });
    return;
  }

  try {
    const preparedAudio = await prepareRecordingAsrBenchmarkAudio(benchmarkId);
    audioCleanup = preparedAudio.cleanup;
    const result = await transcriberManager.runRecordingAsrQualityBenchmark({
      benchmarkId,
      wavPath: preparedAudio.audioPath,
    });
    if (!result.success) {
      appendTranscriberTrace('benchmark.asr-error', {
        ...traceContext,
        totalMs: result.totalMs,
        wavBytes: result.wavBytes,
        error: result.error ?? 'Recording ASR benchmark failed',
      });
    }
  } catch (error) {
    appendTranscriberTrace('benchmark.asr-error', {
      ...traceContext,
      error: error instanceof Error ? error.message : 'Recording ASR benchmark failed',
    });
  } finally {
    audioCleanup?.();
  }
}

function getRecordingAsrBenchmarkFixturePath(): string {
  const configuredFixturePath = process.env.FIELD_THEORY_RECORDING_ASR_BENCHMARK_AUDIO?.trim();
  if (!configuredFixturePath) {
    throw new Error('Set FIELD_THEORY_RECORDING_ASR_BENCHMARK_AUDIO to a local WAV fixture before running the recording ASR benchmark');
  }
  return path.resolve(configuredFixturePath);
}

async function prepareRecordingAsrBenchmarkAudio(benchmarkId: string): Promise<{ audioPath: string; cleanup: () => void }> {
  const fixturePath = getRecordingAsrBenchmarkFixturePath();
  const tempAudioPath = path.join(os.tmpdir(), `field-theory-recording-asr-${benchmarkId}.wav`);
  try {
    await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', fixturePath, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', tempAudioPath], { timeout: 10000 });
  } catch {
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', fixturePath, tempAudioPath], { timeout: 10000 });
  }
  return {
    audioPath: tempAudioPath,
    cleanup: () => fs.rm(tempAudioPath, { force: true }, () => {}),
  };
}

async function runRecordingAsrDeliveryQualityBenchmark(benchmarkId: string): Promise<void> {
  const traceContext = {
    benchmark: true,
    benchmarkId,
    delivery: 'recording-asr-textedit',
    qualityScenario: 'fixture-audio-textedit',
    source: 'quality-benchmark',
  };
  let audioCleanup: (() => void) | null = null;
  let documentNeedsCleanup = false;

  if (!transcriberManager) {
    appendTranscriberTrace('benchmark.asr-delivery-error', {
      ...traceContext,
      error: 'Transcriber manager unavailable',
    });
    return;
  }

  try {
    const preparedAudio = await prepareRecordingAsrBenchmarkAudio(benchmarkId);
    audioCleanup = preparedAudio.cleanup;
    appendTranscriberTrace('benchmark.asr-delivery-start', traceContext);
    await openTextEditBenchmarkDocument();
    documentNeedsCleanup = true;
    const result = await transcriberManager.runRecordingAsrDeliveryQualityBenchmark({
      benchmarkId,
      wavPath: preparedAudio.audioPath,
    });
    const delivered = result.text
      ? await readAndCloseTextEditCommandBenchmarkDocument(result.text)
      : { success: false, deliveredLength: 0, error: 'No ASR transcript to verify' };
    documentNeedsCleanup = false;
    if (result.success && delivered.success) {
      appendTranscriberTrace('benchmark.asr-delivery-success', {
        ...traceContext,
        asrMs: result.asrMs,
        deliveryElapsedMs: result.pasteMs,
        totalMs: result.totalMs,
        textChars: result.textChars,
        deliveredLength: delivered.deliveredLength,
        wavBytes: result.wavBytes,
      });
    } else {
      appendTranscriberTrace('benchmark.asr-delivery-error', {
        ...traceContext,
        asrMs: result.asrMs,
        deliveryElapsedMs: result.pasteMs,
        totalMs: result.totalMs,
        textChars: result.textChars,
        deliveredLength: delivered.deliveredLength,
        wavBytes: result.wavBytes,
        error: result.error ?? delivered.error ?? 'Recording ASR delivery benchmark failed',
      });
    }
  } catch (error) {
    appendTranscriberTrace('benchmark.asr-delivery-error', {
      ...traceContext,
      error: error instanceof Error ? error.message : 'Recording ASR delivery benchmark failed',
    });
  } finally {
    audioCleanup?.();
    if (documentNeedsCleanup) {
      try {
        await execFileAsync('osascript', ['-e', 'tell application "TextEdit" to if (count of documents) > 0 then close front document saving no'], { timeout: 1000 });
      } catch {}
    }
  }
}

async function runCommandLauncherQualityBenchmark(benchmarkId: string, mode: 'controlled' | 'external' | 'browser' | 'command' = 'controlled'): Promise<void> {
  const startedAt = process.hrtime.bigint();
  const launcherSessionId = `benchmark-${benchmarkId}`;
  const querySessionId = `${launcherSessionId}:query`;
  const invocationId = `${launcherSessionId}:invocation`;
  const deliveryMode = mode === 'command'
    ? 'command-textedit'
    : mode === 'external'
      ? 'controlled-textedit'
      : mode === 'browser'
        ? 'controlled-safari-textarea'
        : 'controlled-electron-textarea';
  const traceContext = {
    benchmark: true,
    benchmarkId,
    launcherSessionId,
    querySessionId,
    invocationId,
    delivery: deliveryMode,
    qualityScenario: mode === 'command'
      ? 'synthetic-command-textedit'
      : mode === 'external'
        ? 'synthetic-external-textedit'
        : mode === 'browser'
          ? 'synthetic-browser-safari-textarea'
          : 'synthetic-electron-textarea',
  };
  const benchmarkText = `field-theory-quality-benchmark:${benchmarkId}`;

  appendCommandLauncherTrace('quality-benchmark-start', traceContext);
  appendCommandLauncherTrace('renderer-invoke-item', {
    ...traceContext,
    item: {
      id: 'quality-benchmark-command',
      type: 'command',
      displayName: 'Quality benchmark command',
    },
    fieldTheoryActive: false,
    hasFieldTheoryTarget: false,
  });
  appendCommandLauncherTrace('invoke-command-start', {
    ...traceContext,
    commandName: 'quality-benchmark',
    commandPath: null,
    invocationTarget: mode === 'command'
      ? 'benchmark-command-textedit-target'
      : mode === 'external' ? 'benchmark-textedit-target' : mode === 'browser' ? 'benchmark-safari-textarea-target' : 'benchmark-controlled-target',
  });
  const delivery = mode === 'command'
    ? await runCommandTextEditBenchmarkDelivery(traceContext, benchmarkText)
    : mode === 'external'
      ? await runExternalTextEditBenchmarkDelivery(traceContext, benchmarkText)
      : mode === 'browser'
        ? await runExternalSafariTextareaBenchmarkDelivery(traceContext, benchmarkText)
        : await runControlledBenchmarkDelivery(traceContext, benchmarkText);
  appendCommandLauncherTrace(delivery.success
    ? 'invoke-command-benchmark-delivery-success'
    : 'invoke-command-benchmark-delivery-error', {
    ...traceContext,
    mutatedUserState: false,
    deliveredLength: delivery.deliveredLength,
    expectedLength: benchmarkText.length,
    deliveryElapsedMs: delivery.elapsedMs,
    error: delivery.error ?? null,
  });
  appendCommandLauncherTrace('invoke-command-success', {
    ...traceContext,
    deliveryVerified: delivery.success,
    commandName: 'quality-benchmark',
    commandPath: null,
    targetBundleId: null,
    targetName: mode === 'external' || mode === 'command' ? 'TextEdit' : mode === 'browser' ? 'Safari' : null,
    contentMode: mode === 'command'
      ? 'benchmark-command-textedit-target'
      : mode === 'external' ? 'benchmark-textedit-target' : mode === 'browser' ? 'benchmark-safari-textarea-target' : 'benchmark-controlled-target',
    fallbackRan: false,
    elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
  });
}

// Activate the target app, then optionally hide launcher chrome before pasting.
async function activateAndPaste(
  targetApp: { bundleId: string; name: string } | null,
  options: {
    beforePaste?: () => void | Promise<void>;
    clipboardTrace?: () => Record<string, unknown>;
    requireFocusedTextInput?: boolean;
    traceDetails?: Record<string, unknown>;
  } = {},
): Promise<boolean> {
  appendCommandLauncherTrace('activate-and-paste-start', {
    ...options.traceDetails,
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
    await activateTargetAppWithSystemEvents(targetApp);
    const afterActivate = nativeHelper?.getFrontmostApp() ?? null;
    appendCommandLauncherTrace('activate-and-paste-after-activate', {
      ...options.traceDetails,
      targetBundleId: bundleId,
      frontmostBundleId: afterActivate?.bundleId ?? null,
      frontmostName: afterActivate?.name ?? null,
    });
    const targetFrontmost = await waitForCommandLauncherTargetAppFrontmost(targetApp, 'activate-and-paste');
    if (!targetFrontmost) {
      return false;
    }
    appendCommandLauncherVisibilityTrace('command-launcher.activate-and-paste.before-hide', targetApp, {
      targetFrontmost,
    });
    await beforePaste?.();
    await new Promise(resolve => setTimeout(resolve, 40));
    appendCommandLauncherVisibilityTrace('command-launcher.activate-and-paste.after-hide-before-recheck', targetApp);
    let targetFrontmostAfterHide = await waitForCommandLauncherTargetAppFrontmost(targetApp, 'activate-and-paste-after-hide');
    if (!targetFrontmostAfterHide) {
      appendCommandLauncherVisibilityTrace('command-launcher.activate-and-paste.after-hide-lost-target', targetApp);
      targetFrontmostAfterHide = await activateCommandLauncherTargetApp(targetApp, 'activate-and-paste-after-hide-reactivate');
    }
    if (!targetFrontmostAfterHide) {
      appendCommandLauncherVisibilityTrace('command-launcher.activate-and-paste.after-hide-reactivate-failed', targetApp);
      return false;
    }
    appendCommandLauncherVisibilityTrace('command-launcher.activate-and-paste.before-keystroke', targetApp, {
      targetFrontmostAfterHide,
    });
    if (options.requireFocusedTextInput) {
      const focusedTextInput = await checkCommandLauncherFocusedTextInput('activate-and-paste-focused-text-input', targetApp);
      if (!focusedTextInput) {
        return false;
      }
    }
    const beforeKeystroke = nativeHelper?.getFrontmostApp() ?? null;
    appendCommandLauncherTrace('activate-and-paste-before-keystroke', {
      ...options.traceDetails,
      targetBundleId: bundleId,
      frontmostBundleId: beforeKeystroke?.bundleId ?? null,
      frontmostName: beforeKeystroke?.name ?? null,
      ...(options.clipboardTrace ? { clipboard: options.clipboardTrace() } : {}),
    });
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { timeout: 3000 });
  } else {
    await beforePaste?.();
    await execWithTimeout('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', 3000);
  }
  const afterKeystroke = nativeHelper?.getFrontmostApp() ?? null;
  appendCommandLauncherTrace('activate-and-paste-success', {
    ...options.traceDetails,
    targetBundleId: targetApp?.bundleId ?? null,
    targetName: targetApp?.name ?? null,
    frontmostBundleId: afterKeystroke?.bundleId ?? null,
    frontmostName: afterKeystroke?.name ?? null,
  });
  return true;
}

async function waitForCommandLauncherTargetAppFrontmost(
  targetApp: { bundleId: string; name: string },
  tracePrefix: string,
): Promise<boolean> {
  if (!nativeHelper) {
    appendCommandLauncherTrace(`${tracePrefix}-target-frontmost-unverified`, {
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      reason: 'missing-native-helper',
    });
    return true;
  }

  return waitForTargetAppFrontmost({
    targetApp,
    getFrontmostApp: () => nativeHelper?.getFrontmostApp() ?? null,
    tracePrefix,
    appendTrace: appendCommandLauncherTrace,
  });
}

function readCommandPasteClipboardTrace(): Record<string, unknown> {
  try {
    const text = clipboard.readText();
    const trace: Record<string, unknown> = {
      textLength: text.length,
      availableFormats: clipboard.availableFormats(),
    };
    if (isCommandPayloadTraceEnabled()) {
      trace.text = text;
    }
    return trace;
  } catch (error) {
    return { error };
  }
}

function isCommandPayloadTraceEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.FIELD_THEORY_COMMAND_PAYLOAD_TRACE ?? '').toLowerCase());
}

function appendCommandLauncherVisibilityTrace(
  event: string,
  targetApp: { bundleId: string; name: string } | null,
  data: Record<string, unknown> = {},
): void {
  const frontmostApp = nativeHelper?.getFrontmostApp() ?? null;
  const details = {
    targetBundleId: targetApp?.bundleId ?? null,
    targetName: targetApp?.name ?? null,
    frontmostBundleId: frontmostApp?.bundleId ?? null,
    frontmostName: frontmostApp?.name ?? null,
    commandLauncherVisible: commandLauncherWindow?.isVisible() ?? null,
    commandLauncherShowingOrVisible: commandLauncherWindow?.isShowingOrVisible() ?? null,
    commandLauncherExternalInvocationSuppressed: commandLauncherWindow?.isExternalInvocationActivationSuppressed() ?? null,
    ...data,
  };
  appendCommandLauncherTrace(event, details);
  appendVisibilityTrace(event, details);
}

async function checkCommandLauncherFocusedTextInput(
  event: string,
  targetApp: { bundleId: string; name: string },
  details: Record<string, unknown> = {},
): Promise<boolean> {
  const focusedTextInput = (await nativeHelper?.checkFocusedTextInput().catch(() => false)) ?? false;
  appendCommandLauncherTrace(event, {
    version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
    targetBundleId: targetApp.bundleId,
    targetName: targetApp.name,
    focusedTextInput,
    ...details,
  });
  return focusedTextInput;
}

function commandPayloadTrace(text: string): Record<string, unknown> {
  return isCommandPayloadTraceEnabled() ? { payload: text } : {};
}

function scheduleCommandClipboardRestore(input: {
  commandName: string;
  commandPath: string;
  restoreGeneration: number;
  restoreSnapshot: ClipboardSnapshot;
  launcherClipboardPayload: CommandClipboardPayloadSnapshot | null;
}): void {
  const {
    commandName,
    commandPath,
    restoreGeneration,
    restoreSnapshot,
    launcherClipboardPayload,
  } = input;

  void (async () => {
    appendCommandLauncherTrace('invoke-command-wait-before-clipboard-restore', {
      commandName,
      commandPath,
      delayMs: COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
      generation: restoreGeneration,
    });

    await waitForCommandClipboardPasteRead();

    if (commandClipboardRestoreCoordinator.canRestore(restoreGeneration)) {
      try {
        const clipboardStillHasLauncherPayload = launcherClipboardPayload
          ? clipboardMatchesCommandPayload(launcherClipboardPayload)
          : false;
        if (clipboardStillHasLauncherPayload) {
          restoreClipboardSnapshot(restoreSnapshot);
          clipboardManager?.syncClipboardHash();
          appendCommandLauncherTrace('invoke-command-clipboard-restored', {
            commandName,
            commandPath,
            generation: restoreGeneration,
            reason: 'clipboard-still-launcher-payload',
          });
        } else {
          appendCommandLauncherTrace('invoke-command-clipboard-restore-skipped', {
            commandName,
            commandPath,
            generation: restoreGeneration,
            reason: launcherClipboardPayload ? 'clipboard-changed-after-launcher-paste' : 'missing-launcher-payload-snapshot',
          });
        }
      } finally {
        commandClipboardRestoreCoordinator.finish(restoreGeneration);
      }
    } else {
      appendCommandLauncherTrace('invoke-command-clipboard-restore-skipped', {
        commandName,
        commandPath,
        generation: restoreGeneration,
        reason: 'newer-command-invocation',
      });
    }
  })().catch((error) => {
    appendCommandLauncherTrace('invoke-command-clipboard-restore-error', {
      commandName,
      commandPath,
      generation: restoreGeneration,
      error,
    });
  });
}

function scheduleBrowserLibraryClipboardRestore(input: {
  tracePrefix: string;
  tracePayload: Record<string, unknown>;
  restoreGeneration: number;
  restoreSnapshot: ClipboardSnapshot;
  launcherClipboardPayload: CommandClipboardPayloadSnapshot | null;
}): void {
  const {
    tracePrefix,
    tracePayload,
    restoreGeneration,
    restoreSnapshot,
    launcherClipboardPayload,
  } = input;

  void (async () => {
    appendCommandLauncherTrace(`${tracePrefix}-wait-before-clipboard-restore`, {
      ...tracePayload,
      delayMs: COMMAND_CLIPBOARD_RESTORE_DELAY_MS,
      generation: restoreGeneration,
    });

    await waitForCommandClipboardPasteRead();

    if (commandClipboardRestoreCoordinator.canRestore(restoreGeneration)) {
      try {
        const clipboardStillHasLauncherPayload = launcherClipboardPayload
          ? clipboardMatchesCommandPayload(launcherClipboardPayload)
          : false;
        if (clipboardStillHasLauncherPayload) {
          restoreClipboardSnapshot(restoreSnapshot);
          clipboardManager?.syncClipboardHash();
          appendCommandLauncherTrace(`${tracePrefix}-clipboard-restored`, {
            ...tracePayload,
            generation: restoreGeneration,
            reason: 'clipboard-still-browser-library-payload',
          });
        } else {
          appendCommandLauncherTrace(`${tracePrefix}-clipboard-restore-skipped`, {
            ...tracePayload,
            generation: restoreGeneration,
            reason: launcherClipboardPayload ? 'clipboard-changed-after-browser-library-paste' : 'missing-browser-library-payload-snapshot',
          });
        }
      } finally {
        commandClipboardRestoreCoordinator.finish(restoreGeneration);
      }
    } else {
      appendCommandLauncherTrace(`${tracePrefix}-clipboard-restore-skipped`, {
        ...tracePayload,
        generation: restoreGeneration,
        reason: 'newer-command-invocation',
      });
      commandClipboardRestoreCoordinator.finish(restoreGeneration);
    }
  })().catch((error) => {
    appendCommandLauncherTrace(`${tracePrefix}-clipboard-restore-error`, {
      ...tracePayload,
      generation: restoreGeneration,
      error,
    });
    commandClipboardRestoreCoordinator.finish(restoreGeneration);
  });
}

async function activateCommandLauncherTargetApp(
  targetApp: { bundleId: string; name: string },
  tracePrefix: string,
): Promise<boolean> {
  const bundleId = targetApp.bundleId;
  if (bundleId.includes('"') || bundleId.includes("'")) {
    log.error('activateCommandLauncherTargetApp: invalid bundleId contains quotes:', bundleId);
    appendCommandLauncherTrace(`${tracePrefix}-invalid-bundle`, { bundleId });
    return false;
  }
  try {
    await activateTargetAppWithSystemEvents(targetApp);
    const afterActivate = nativeHelper?.getFrontmostApp() ?? null;
    appendCommandLauncherTrace(`${tracePrefix}-after-activate`, {
      targetBundleId: bundleId,
      targetName: targetApp.name,
      frontmostBundleId: afterActivate?.bundleId ?? null,
      frontmostName: afterActivate?.name ?? null,
    });
    return waitForCommandLauncherTargetAppFrontmost(targetApp, tracePrefix);
  } catch (error) {
    appendCommandLauncherTrace(`${tracePrefix}-activate-error`, {
      targetBundleId: bundleId,
      targetName: targetApp.name,
      error,
    });
    return false;
  }
}

function activateAndPasteFromCommandLauncher(
  targetApp: { bundleId: string; name: string },
  options: { clipboardTrace?: () => Record<string, unknown>; requireFocusedTextInput?: boolean; traceDetails?: Record<string, unknown> } = {},
): Promise<boolean> {
  appendCommandLauncherTrace('command-launcher-paste-strategy', {
    ...options.traceDetails,
    version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
    strategy: 'applescript',
    targetBundleId: targetApp.bundleId,
    targetName: targetApp.name,
  });
  return activateAndPaste(targetApp, {
    beforePaste: () => commandLauncherWindow?.hide(true),
    clipboardTrace: options.clipboardTrace,
    requireFocusedTextInput: options.requireFocusedTextInput,
    traceDetails: options.traceDetails,
  });
}

async function typeTextFromCommandLauncher(
  targetApp: { bundleId: string; name: string },
  text: string,
  tracePrefix: 'invoke-command' | 'invoke-handoff',
  traceDetails: Record<string, unknown> = {},
): Promise<boolean> {
  const phaseStartedAt = process.hrtime.bigint();
  if (!nativeHelper) {
    appendCommandLauncherTrace(`${tracePrefix}-native-type-unavailable`, {
      ...traceDetails,
      version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      reason: 'missing-native-helper',
    });
    return false;
  }

  // Keep the launcher visible until the external app is actually frontmost.
  // Otherwise hiding it can expose the Field Theory library while macOS is
  // still completing the app switch.
  const activateStartedAt = process.hrtime.bigint();
  const activated = await activateCommandLauncherTargetApp(targetApp, `${tracePrefix}-native-type`);
  const activateMs = elapsedMsSince(activateStartedAt);
  if (!activated) {
    appendCommandLauncherTrace(`${tracePrefix}-native-type-phase`, {
      ...traceDetails,
      phase: 'activate-failed',
      activateMs,
      totalMs: elapsedMsSince(phaseStartedAt),
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
    });
    return false;
  }
  appendCommandLauncherVisibilityTrace(`command-launcher.${tracePrefix}-native-type.before-hide`, targetApp, {
    targetFrontmost: true,
  });
  const hideStartedAt = process.hrtime.bigint();
  commandLauncherWindow?.hide(true);
  await new Promise(resolve => setTimeout(resolve, 40));
  const hideMs = elapsedMsSince(hideStartedAt);
  appendCommandLauncherVisibilityTrace(`command-launcher.${tracePrefix}-native-type.after-hide-before-native-helper`, targetApp);

  appendCommandLauncherTrace('command-launcher-paste-strategy', {
    ...traceDetails,
    version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
    strategy: 'native-helper',
    tracePrefix,
    targetBundleId: targetApp.bundleId,
    targetName: targetApp.name,
  });
  const frontmostBeforeType = nativeHelper.getFrontmostApp();
  appendCommandLauncherTrace(`${tracePrefix}-native-type-start`, {
    ...traceDetails,
    version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
    targetBundleId: targetApp.bundleId,
    targetName: targetApp.name,
    textLength: text.length,
    clipboard: readCommandPasteClipboardTrace(),
    frontmostBundleId: frontmostBeforeType?.bundleId ?? null,
    frontmostName: frontmostBeforeType?.name ?? null,
  });

  try {
    const nativeStartedAt = process.hrtime.bigint();
    const result = await nativeHelper.typeIntoApp(targetApp.bundleId, text, false);
    const nativeMs = elapsedMsSince(nativeStartedAt);
    const frontmost = nativeHelper.getFrontmostApp();
    appendCommandLauncherTrace(`${tracePrefix}-native-type-result`, {
      ...traceDetails,
      version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      success: result.success,
      error: result.error ?? null,
      accessibilityTrusted: result.accessibilityTrusted ?? null,
      targetFrontmost: result.targetFrontmost ?? null,
      focusedTextInput: result.focusedTextInput ?? null,
      pasteboardWritten: result.pasteboardWritten ?? null,
      eventTarget: result.eventTarget ?? null,
      frontmostBundleId: frontmost?.bundleId ?? null,
      frontmostName: frontmost?.name ?? null,
      clipboard: readCommandPasteClipboardTrace(),
    });
    appendCommandLauncherTrace(`${tracePrefix}-native-type-phase`, {
      ...traceDetails,
      phase: result.success ? 'native-helper-success' : 'native-helper-failed',
      activateMs,
      hideMs,
      nativeMs,
      focusedTextInput: result.focusedTextInput ?? null,
      totalMs: elapsedMsSince(phaseStartedAt),
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
    });
    return result.success && result.focusedTextInput !== false;
  } catch (error) {
    appendCommandLauncherTrace(`${tracePrefix}-native-type-error`, {
      ...traceDetails,
      version: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      error,
    });
    appendCommandLauncherTrace(`${tracePrefix}-native-type-phase`, {
      ...traceDetails,
      phase: 'native-helper-error',
      activateMs,
      hideMs,
      totalMs: elapsedMsSince(phaseStartedAt),
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      error,
    });
    return false;
  }
}

async function pasteTextIntoCodexInputFromBrowserLibrary(text: string): Promise<{ success: boolean; error?: string; delivery?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { success: false, error: 'No selected text' };
  const targetApp = { bundleId: 'com.openai.codex', name: 'Codex' };
  const traceDetails = {
    source: 'browser-library-selection',
    targetBundleId: targetApp.bundleId,
    targetName: targetApp.name,
    textLength: text.length,
  };
  appendCommandLauncherTrace('browser-library-codex-input-paste-start', traceDetails);

  if (nativeHelper) {
    const clipboardRestore = commandClipboardRestoreCoordinator.begin(captureClipboardSnapshot());
    let launcherClipboardPayload: CommandClipboardPayloadSnapshot | null = null;
    try {
      const result = await nativeHelper.typeIntoApp(targetApp.bundleId, text, false);
      if (result.pasteboardWritten) {
        launcherClipboardPayload = captureCommandClipboardPayload();
        scheduleBrowserLibraryClipboardRestore({
          tracePrefix: 'browser-library-codex-input-native',
          tracePayload: traceDetails,
          restoreGeneration: clipboardRestore.generation,
          restoreSnapshot: clipboardRestore.snapshot,
          launcherClipboardPayload,
        });
      } else {
        commandClipboardRestoreCoordinator.finish(clipboardRestore.generation);
      }
      appendCommandLauncherTrace('browser-library-codex-input-native-result', {
        ...traceDetails,
        success: result.success,
        error: result.error ?? null,
        targetFrontmost: result.targetFrontmost ?? null,
        focusedTextInput: result.focusedTextInput ?? null,
        pasteboardWritten: result.pasteboardWritten ?? null,
      });
      if (result.success && result.focusedTextInput !== false) {
        return { success: true, delivery: 'native-helper' };
      }
    } catch (error) {
      commandClipboardRestoreCoordinator.finish(clipboardRestore.generation);
      appendCommandLauncherTrace('browser-library-codex-input-native-error', {
        ...traceDetails,
        error,
      });
    }
  }

  const clipboardRestore = commandClipboardRestoreCoordinator.begin(captureClipboardSnapshot());
  try {
    clipboard.writeText(text);
    clipboardManager?.syncClipboardHash();
    const launcherClipboardPayload = captureCommandClipboardPayload();
    const pasted = await activateAndPaste(targetApp, {
      clipboardTrace: readCommandPasteClipboardTrace,
      traceDetails,
    });
    scheduleBrowserLibraryClipboardRestore({
      tracePrefix: 'browser-library-codex-input-fallback',
      tracePayload: traceDetails,
      restoreGeneration: clipboardRestore.generation,
      restoreSnapshot: clipboardRestore.snapshot,
      launcherClipboardPayload,
    });
    appendCommandLauncherTrace('browser-library-codex-input-clipboard-fallback', {
      ...traceDetails,
      pasted,
      clipboard: readCommandPasteClipboardTrace(),
    });
    if (pasted) {
      return { success: true, delivery: 'clipboard-paste' };
    }
    return {
      success: true,
      delivery: 'clipboard-focus',
      error: 'Codex input was not focused; copied selection and activated Codex.',
    };
  } catch (error) {
    commandClipboardRestoreCoordinator.finish(clipboardRestore.generation);
    appendCommandLauncherTrace('browser-library-codex-input-failed', {
      ...traceDetails,
      error,
    });
    return { success: false, error: error instanceof Error ? error.message : 'Could not paste into Codex input' };
  }
}

async function runWithCommandLauncherExternalInvocation<T>(operation: () => Promise<T>): Promise<T> {
  const token = commandLauncherWindow?.beginExternalInvocationSuppression() ?? null;
  try {
    return await operation();
  } finally {
    commandLauncherWindow?.endExternalInvocationSuppression(token);
  }
}

function findRunningAppForBundleId(bundleId: string): { bundleId: string; name: string } | null {
  const lowerBundleId = bundleId.toLowerCase();
  const candidates = [
    commandLauncherWindow?.getPreviousApp(),
    getCommandLauncherTargetApp(),
    clipboardHistoryWindow?.getTargetApp(),
    ...(clipboardHistoryWindow?.getCachedRunningApps() ?? []),
    nativeHelper?.getFrontmostApp(),
  ];

  for (const candidate of candidates) {
    if (
      candidate?.bundleId &&
      candidate.name &&
      candidate.bundleId.toLowerCase() === lowerBundleId &&
      isExternalCommandTargetBundleId(candidate.bundleId)
    ) {
      return {
        bundleId: candidate.bundleId,
        name: candidate.name,
      };
    }
  }

  return isExternalCommandTargetBundleId(bundleId)
    ? { bundleId, name: bundleId }
    : null;
}

async function pasteClipboardFromCommandLauncher(
  targetBundleId: string,
  reason: string,
  textContent?: string,
): Promise<boolean> {
  const targetApp = findRunningAppForBundleId(targetBundleId);
  if (!targetApp) {
    appendCommandLauncherTrace('command-launcher-clipboard-paste-no-target', {
      reason,
      targetBundleId,
    });
    return false;
  }

  return runWithCommandLauncherExternalInvocation(async () => {
    clipboardHistoryWindow?.hideAfterPaste(reason);
    if (shouldUseNativeCommandLauncherClipboardTextPaste({
      commandLauncherPaste: true,
      hasTextContent: Boolean(textContent),
    })) {
      const typed = await typeTextFromCommandLauncher(targetApp, textContent!, 'invoke-command');
      if (typed) return true;
      appendCommandLauncherTrace('command-launcher-clipboard-native-type-fallback', {
        reason,
        targetBundleId,
        targetName: targetApp.name,
        textLength: textContent!.length,
      });
    }
    return activateAndPasteFromCommandLauncher(targetApp, {
      clipboardTrace: readCommandPasteClipboardTrace,
    });
  });
}

function isFieldTheoryBundleId(bundleId: string | null | undefined): boolean {
  return isFieldTheoryCommandTargetBundleId(bundleId);
}

function hasFocusedFieldTheoryMarkdownInsertionTarget(): boolean {
  const clipboardWindow = clipboardHistoryWindow?.getWindow() ?? null;
  return Boolean(
    (librarianMarkdownEditorFocused &&
      clipboardWindow &&
      !clipboardWindow.isDestroyed() &&
      clipboardWindow.isVisible()) ||
    (browserLibraryMarkdownEditorFocused && browserHelperServer?.hasNativeEventClient(activeBrowserLibraryClientId))
  );
}

function hasActiveFieldTheoryMarkdownInsertionTarget(): boolean {
  const clipboardWindow = clipboardHistoryWindow?.getWindow() ?? null;
  return Boolean(
    activeLibraryFileContext &&
    ((clipboardWindow &&
      !clipboardWindow.isDestroyed() &&
      clipboardWindow.isVisible()) ||
      getActiveBrowserLibraryMarkdownCommandTargetClientId())
  );
}

function insertTextIntoFocusedFieldTheoryMarkdown(text: string): boolean {
  if (!text || !hasFocusedFieldTheoryMarkdownInsertionTarget()) {
    return false;
  }
  if (browserLibraryMarkdownEditorFocused && browserHelperServer?.hasNativeEventClient(activeBrowserLibraryClientId)) {
    return browserHelperServer.emitNativeEventToClient(activeBrowserLibraryClientId, { type: 'librarian:insertMarkdownText', text });
  }
  clipboardHistoryWindow?.getWindow()?.webContents.send('librarian:insertMarkdownText', text);
  return true;
}

function insertTextIntoActiveFieldTheoryMarkdown(text: string): boolean {
  if (!text || !hasActiveFieldTheoryMarkdownInsertionTarget()) {
    return false;
  }
  const targetBrowserClientId = getActiveBrowserLibraryMarkdownCommandTargetClientId();
  if (targetBrowserClientId) {
    return browserHelperServer?.emitNativeEventToClient(targetBrowserClientId, { type: 'librarian:insertMarkdownText', text }) ?? false;
  }
  clipboardHistoryWindow?.getWindow()?.webContents.send('librarian:insertMarkdownText', text);
  return true;
}

function handleBrowserLibraryReplaceSelectedTextResult(result: { requestId?: string; success?: boolean }): void {
  if (!result.requestId) return;
  const pending = pendingBrowserLibraryReplaceSelectedText.get(result.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingBrowserLibraryReplaceSelectedText.delete(result.requestId);
  pending.resolve(result.success === true);
}

function writeTextIntoFocusedCodexTerminal(text: string): boolean {
  if (!text || !focusedCodexTerminalLauncherSessionId) return false;
  const wrote = getCodexTerminalManager().writeInput(focusedCodexTerminalLauncherSessionId, text);
  if (!wrote) {
    focusedCodexTerminalLauncherSessionId = null;
  }
  return wrote;
}

async function replaceSelectedTextInFieldTheoryMarkdown(input: {
  expectedText: string;
  replacementText: string;
}): Promise<boolean> {
  const targetBrowserClientId = getActiveBrowserLibraryMarkdownCommandTargetClientId();
  if (
    input.expectedText &&
    input.replacementText &&
    targetBrowserClientId
  ) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingBrowserLibraryReplaceSelectedText.delete(requestId);
        resolve(false);
      }, 600);
      pendingBrowserLibraryReplaceSelectedText.set(requestId, { resolve, timeout });
      const sent = browserHelperServer?.emitNativeEventToClient(targetBrowserClientId, {
        type: 'librarian:replaceSelectedMarkdownText',
        request: {
          requestId,
          expectedText: input.expectedText,
          replacementText: input.replacementText,
        },
      });
      if (!sent) {
        clearTimeout(timeout);
        pendingBrowserLibraryReplaceSelectedText.delete(requestId);
        resolve(false);
      }
    });
  }

  const clipboardWindow = clipboardHistoryWindow?.getWindow() ?? null;
  if (
    !input.expectedText ||
    !input.replacementText ||
    !clipboardWindow ||
    clipboardWindow.isDestroyed() ||
    !clipboardWindow.isVisible()
  ) {
    return false;
  }

  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('librarian:replaceSelectedMarkdownTextResult', onResult);
      resolve(false);
    }, 600);
    const onResult = (_event: IpcMainEvent, result: { requestId?: string; success?: boolean }) => {
      if (result?.requestId !== requestId) return;
      clearTimeout(timeout);
      ipcMain.removeListener('librarian:replaceSelectedMarkdownTextResult', onResult);
      resolve(result.success === true);
    };
    ipcMain.on('librarian:replaceSelectedMarkdownTextResult', onResult);
    clipboardWindow.webContents.send('librarian:replaceSelectedMarkdownText', {
      requestId,
      expectedText: input.expectedText,
      replacementText: input.replacementText,
    });
  });
}

export function formatFieldTheoryMarkdownImageDestination(filePath: string): string {
  const expandedPath = filePath === '~' || filePath.startsWith('~/')
    ? `${os.homedir()}${filePath.slice(1)}`
    : filePath;
  const url = /^file:\/\//i.test(expandedPath)
    ? expandedPath
    : `file://${expandedPath.split('/').map((part, index) => (
      index === 0 ? '' : encodeURIComponent(part)
    )).join('/')}`;
  return `<${url.replace(/>/g, '%3E')}>`;
}

export async function buildFieldTheoryMarkdownClipboardPayload(
  items: ClipboardItem[],
  exportImageToCache: (item: ClipboardItem) => Promise<string | null>,
): Promise<string> {
  const textBlocks: string[] = [];
  const imageBlocks: string[] = [];
  let imageIndex = 1;

  for (const item of items) {
    const text = (item.useImprovedVersion && item.improvedContent)
      ? item.improvedContent
      : item.content;
    if (text && (item.type === 'text' || item.type === 'transcript' || !item.imageData)) {
      textBlocks.push(text.trimEnd());
    }
  }

  for (const item of items) {
    if (!item.imageData && item.type !== 'image' && item.type !== 'screenshot') continue;
    const imagePath = await exportImageToCache(item);
    if (!imagePath) {
      imageBlocks.push(`> Image ${imageIndex} was unavailable when this note was created.`);
      imageIndex += 1;
      continue;
    }
    const alt = item.figureLabel
      ? `figure ${item.figureLabel}`
      : item.sourceAppName
        ? `${item.sourceAppName} image`
        : `Image ${imageIndex}`;
    imageBlocks.push(`![${alt.replace(/\]/g, '\\]')}](${formatFieldTheoryMarkdownImageDestination(imagePath)})`);
    imageIndex += 1;
  }

  return [...textBlocks, ...imageBlocks].filter(Boolean).join('\n\n');
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
function loadEnvVars(): { supabaseUrl?: string; supabasePublishableKey?: string } {
  const supabaseUrl = getOptionalEnvValue('VITE_SUPABASE_URL');
  const supabasePublishableKey = getOptionalEnvValue('FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY')
    ?? getOptionalEnvValue('VITE_SUPABASE_ANON_KEY');

  if (supabaseUrl && supabasePublishableKey) {
    return {
      supabaseUrl,
      supabasePublishableKey,
    };
  }

  // Production fallback: this publishable key is public app config. RLS and the
  // user's auth session decide what data the app can read or write.
  return {
    supabaseUrl: 'https://FIELD_THEORY_SUPABASE_URL.example',
    supabasePublishableKey: 'FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY',
  };
}

// Register the ftmedia:// scheme as privileged so the renderer can load
// locally-cached bookmark media without going through the Twitter CDN.
// Must happen before app.whenReady(). The actual handler is installed inside.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ftmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
  { scheme: 'ftlocalfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

function readPackagedBuildChannel(): string | undefined {
  try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { fieldTheoryBuildChannel?: unknown };
    return typeof packageJson.fieldTheoryBuildChannel === 'string'
      ? packageJson.fieldTheoryBuildChannel
      : undefined;
  } catch {
    return undefined;
  }
}

const fieldTheoryBuildChannel = resolveFieldTheoryBuildChannel({
  env: process.env,
  appName: app.getName(),
  metadataChannel: readPackagedBuildChannel(),
});
const isExperimentalBuild = fieldTheoryBuildChannel === 'experimental';
const autoUpdaterReleaseRepo = autoUpdaterReleaseRepoForBuildChannel(fieldTheoryBuildChannel);
const isAutoUpdaterEnabled = autoUpdaterReleaseRepo !== null;
let autoUpdaterInstance: import('electron-updater').AppUpdater | null = null;

function resolveAutoUpdaterAuthHeader(): string | null {
  const envToken = autoUpdaterAuthTokenForBuildChannel(fieldTheoryBuildChannel, process.env);
  if (envToken) return envToken;

  if (fieldTheoryBuildChannel !== 'experimental') return null;

  for (const ghPath of autoUpdaterGitHubCliPaths(process.env)) {
    try {
      const ghToken = execFileSync(ghPath, ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500,
      });
      return normalizeGitHubToken(ghToken);
    } catch {
      continue;
    }
  }

  return null;
}

function formatAutoUpdaterErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    fieldTheoryBuildChannel === 'experimental'
    && /(401|403|404|not found|forbidden|unauthorized)/i.test(message)
  ) {
    return 'Experimental updates need maintainer GitHub access. Sign in with the GitHub CLI or set the maintainer-only experimental update token, then restart Field Theory Experimental.';
  }
  return message;
}

function getAutoUpdater(): import('electron-updater').AppUpdater {
  if (!autoUpdaterInstance) {
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = autoUpdaterAllowsPrereleaseForBuildChannel(fieldTheoryBuildChannel);
    const autoUpdaterAuthToken = resolveAutoUpdaterAuthHeader();
    const feedOptions = autoUpdaterFeedOptionsForBuildChannel(fieldTheoryBuildChannel, autoUpdaterAuthToken);
    if (feedOptions) {
      autoUpdater.setFeedURL(feedOptions);
    }
    autoUpdaterInstance = autoUpdater;
  }
  return autoUpdaterInstance;
}

// Pin userData paths explicitly so auth/session storage is shared across release channels.
// This must happen before app.whenReady() and before any code calls app.getPath('userData').
const startupBenchmarkUserData = process.env.FIELD_THEORY_STARTUP_BENCH_USER_DATA_DIR?.trim();
const productionUserData = startupBenchmarkUserData
  ? path.resolve(startupBenchmarkUserData)
  : path.join(app.getPath('appData'), 'fieldtheory-mac');
app.setPath('userData', productionUserData);
if (isExperimentalBuild) {
  app.setName('Field Theory Experimental');
}

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelper | null = null;
let audioManager: AudioManager | null = null;
let trayManager: TrayManager | null = null;
let transcriberManager: TranscriberManager | null = null;
let preferencesManager: PreferencesManager | null = null;
let clipboardManager: ClipboardManager | null = null;
let clipboardHistoryWindow: ClipboardHistoryWindow | null = null;
let libraryDocumentWindowManager: LibraryDocumentWindowManager | null = null;
let documentPresenceManager: DocumentPresenceManager | null = null;
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
let browserHelperServer: BrowserHelperServer | null = null;
let markdownAssetsConsolidated = false;
let recentManager: RecentManager | null = null;
let bookmarksManager: BookmarksManager | null = null;
let bookmarksWatcherStarted = false;
let taggedDocsManager: TaggedDocsManager | null = null;
let commandsManager: CommandsManager | null = null;
let localLlmManager: LocalLlmManager | null = null;
let maxwellRunManager: MaxwellRunManager | null = null;
let meetingManager: MeetingManager | null = null;
let activeMaxwellLocalRun: { runId: string; cancelled: boolean } | null = null;
let localLlmInstallInFlight: Promise<{ success: boolean; error?: string; modelPath?: string; reusedExisting?: boolean }> | null = null;
let commandSyncService: CommandSyncService | null = null;
let runNativeLocalCommand = async (_rawRequest: unknown): Promise<LocalCommandRunResult> => ({
  success: false,
  error: 'Field Theory command system is not ready',
});

function isDocumentVersionLike(value: unknown): value is DocumentVersion {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DocumentVersion>;
  return typeof candidate.mtimeMs === 'number'
    && typeof candidate.size === 'number'
    && typeof candidate.sha256 === 'string';
}

function documentVersionsEqual(left: DocumentVersion, right: DocumentVersion): boolean {
  return left.mtimeMs === right.mtimeMs
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function renameExternalLibraryFile(absPath: string, newName: string): { path: string; name: string; content: string; mtime: number; documentVersion: DocumentVersion } | null {
  try {
    const canonical = fs.realpathSync(absPath);
    if (!isLibraryTextDocumentPath(canonical)) return null;
    const trimmed = newName.trim();
    if (!trimmed) return null;
    const extension = path.extname(canonical) || '.md';
    const nextFileName = libraryTextDocumentFileNameFromUserInput(trimmed, extension);
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
}

async function shareLibrarianReading(filePath: string): Promise<{ slug: string; url: string } | null> {
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
    // Ignore profile fetch errors.
  }

  const { data: existing } = await supabase
    .from('shared_readings')
    .select('slug, is_public')
    .eq('source_path', filePath)
    .eq('user_id', session.user.id)
    .single();

  if (existing) {
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

  const slugify = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

  const baseSlug = slugify(reading.title);

  for (let attempt = 0; attempt < 3; attempt += 1) {
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

    if (error?.code === '23505') {
      continue;
    }

    log.error('Librarian share failed:', error);
    return null;
  }

  log.error('Librarian share failed: max retries exceeded');
  return null;
}

async function unshareLibrarianReading(filePath: string): Promise<boolean> {
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
}

async function getLibrarianShareStatus(filePath: string): Promise<{ shared: boolean; slug?: string; url?: string } | null> {
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
}

async function getCurrentUserCallsign(): Promise<string | null> {
  if (!authManager?.isAuthenticated()) return null;
  const supabase = authManager.getSupabaseClient();
  const session = authManager.getSession();
  if (!supabase || !session?.user?.id) return null;

  try {
    const { data } = await supabase
      .from('profiles')
      .select('callsign')
      .eq('id', session.user.id)
      .single();
    return typeof data?.callsign === 'string' && data.callsign.trim()
      ? data.callsign.trim()
      : authManager.getCallsign();
  } catch {
    return authManager.getCallsign();
  }
}

async function updateSharedLibrarianReading(filePath: string, content: string, title: string): Promise<boolean> {
  if (!authManager?.isAuthenticated()) return false;

  const supabase = authManager.getSupabaseClient();
  const session = authManager.getSession();
  if (!supabase || !session?.user?.id) return false;

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
    // Ignore profile fetch errors.
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
}

async function startBrowserHelperIfEnabled(): Promise<void> {
  if (!librarianManager || browserHelperServer) return;

  const manager = librarianManager;
  const createFallbackDocumentService = () => new BrowserHelperDocumentService(manager.getLibraryRoots().map((root) => root.path));
  const nativeWikiPage = (page: ReturnType<LibrarianManager['getWikiPage']>) => page
    ? {
      ...page,
      rootPath: manager.getWikiRoot(),
      documentKind: page.documentKind ?? 'markdown',
    }
    : null;
  browserHelperServer = new BrowserHelperServer({
    service: {
      getRoots: () => createFallbackDocumentService().getRoots(),
      getLibraryRoots: () => manager.getLibraryRoots(),
      addLibraryRoot: (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        const added = manager.addLibraryRoot(dirPath);
        syncTaggedDocsRootsFromLibrary();
        return added;
      },
      removeLibraryRoot: (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        const removed = manager.removeLibraryRoot(dirPath);
        syncTaggedDocsRootsFromLibrary();
        return removed;
      },
      getWikiTree: () => manager.getWikiTree(),
      getWikiPage: (relPath) => nativeWikiPage(manager.getWikiPage(relPath)),
      findWikiPageByDocumentVersion: (version, previousRelPath) => manager.findWikiPageByDocumentVersion(version, previousRelPath),
      saveWikiPage: (relPath, content, expectedVersion) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { ok: false, reason: 'blocked' };
        }
        return manager.saveWikiPage(relPath, content, expectedVersion);
      },
      createWikiFile: (folderRelPath, fileName) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return nativeWikiPage(manager.createWikiFile(folderRelPath, fileName));
      },
      createWikiFileWithDefaultTitle: (folderRelPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return nativeWikiPage(manager.createWikiFileWithDefaultTitle(folderRelPath));
      },
      createScratchpadDefault: () => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        const page = nativeWikiPage(manager.createScratchpadDefault());
        recordRecentWikiPage(page);
        return page;
      },
      openScratchpadDefault: () => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        const page = nativeWikiPage(manager.createScratchpadDefault());
        recordRecentWikiPage(page);
        return page;
      },
      createWikiDir: (dirRelPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return manager.createWikiDir(dirRelPath);
      },
      deleteWikiPage: (relPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return manager.deleteWikiPage(relPath);
      },
      renameWikiPage: (relPath, newName) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return manager.renameWikiPage(relPath, newName);
      },
      createLibraryFile: (rootPath, folderRelPath, fileName) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        const page = manager.createLibraryFile(rootPath, folderRelPath, fileName);
        return page ? { ...page, rootPath, documentKind: page.documentKind ?? 'markdown' } : null;
      },
      createLibraryDir: (rootPath, dirRelPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return manager.createLibraryDir(rootPath, dirRelPath);
      },
      deleteLibraryDir: (rootPath, dirRelPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return manager.deleteLibraryDir(rootPath, dirRelPath);
      },
      moveLibraryItem: (rootPath, kind, sourceRelPath, targetDirRelPath, targetRootPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return manager.moveLibraryItem(rootPath, kind, sourceRelPath, targetDirRelPath, targetRootPath);
      },
      openExternal: (filePath) => createFallbackDocumentService().openExternal(filePath),
      saveExternal: (filePath, content, expectedVersion) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { ok: false, reason: 'blocked' };
        }
        return createFallbackDocumentService().saveExternal(filePath, content, expectedVersion);
      },
      findLibraryFileByDocumentVersion: (version, previousAbsPath) => {
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
        for (const root of manager.getLibraryRoots()) {
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
            if (!documentVersionsEqual(candidateVersion, version)) continue;
            return createFallbackDocumentService().openExternal(candidatePath);
          } catch {}
        }
        return null;
      },
      renameExternal: (filePath, newName) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        const renamed = renameExternalLibraryFile(filePath, newName);
        return renamed;
      },
      deleteExternal: (filePath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return manager.deleteExternalLibraryFile(filePath);
      },
      getDocument: (ref) => createFallbackDocumentService().getDocument(ref),
      saveDocument: (ref, content, expectedVersion) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { ok: false, reason: 'blocked' };
        }
        return createFallbackDocumentService().saveDocument(ref, content, expectedVersion);
      },
    },
    staticDir: path.join(app.getAppPath(), 'dist'),
    nativeBridge: {
      getAuthSession: () => authManager?.getSessionState() ?? null,
      getAuthCallsign: () => getCurrentUserCallsign(),
      getMetrics: () => metricsManager?.getMetrics() ?? null,
      fetchMetricsFromSupabase: () => metricsManager?.fetchFromSupabase() ?? false,
      getQuotas: () => quotaManager?.getQuotas() ?? null,
      getTheme: () => preferencesManager?.getPreference('darkMode') ?? false,
      setTheme: (isDark) => setThemePreferenceAndBroadcast(isDark),
      getHotkey: async (id) => {
        const preferenceKeys: Record<string, string> = {
          superPaste: 'superPasteHotkey',
          commandLauncher: 'commandLauncherHotkey',
          scratchpad: 'scratchpadHotkey',
        };
        const defaults: Record<string, string> = {
          superPaste: 'Command+Shift+V',
          commandLauncher: 'Command+Shift+K',
          scratchpad: 'Control+Option+Command+Space',
        };
        const prefKey = preferenceKeys[id];
        if (!prefKey) return null;
        const prefs = await preferencesManager?.load();
        return ((prefs as Record<string, unknown> | undefined)?.[prefKey] as string | undefined) || defaults[id] || null;
      },
      getHiddenFolders: () => librarianManager?.getHiddenDefaultFolders() ?? [],
      setFolderHidden: (folderId, hidden) => librarianManager?.setDefaultFolderHidden(folderId, hidden) ?? [],
      recordRecentWikiPage: (page) => {
        recordRecentWikiPage(page as ReturnType<LibrarianManager['getWikiPage']>);
      },
      recordRecentCreatedLibraryPage: (page, rootPath) => {
        recordRecentCreatedLibraryPage(page as ReturnType<LibrarianManager['getWikiPage']>, rootPath);
      },
      notifyWikiPageChanged: (event) => {
        const changedEvent = event && typeof event === 'object'
          ? { ...event as Record<string, unknown>, launcherDirectNotified: true }
          : event;
        commandLauncherWindow?.send('wiki:changed', event);
        librarianManager?.emit('wiki:changed', changedEvent);
        if (
          event
          && typeof event === 'object'
          && (event as { type?: unknown }).type === 'file-deleted'
          && activeLibraryFileContext?.type === 'wiki'
          && typeof (event as { relPath?: unknown }).relPath === 'string'
          && activeLibraryFileContext.relPath === (event as { relPath: string }).relPath
        ) {
          activeLibraryFileContext = null;
          activeLibraryFileContextSourceId = null;
        }
      },
      notifyWikiPageRenamed: (event) => {
        browserHelperServer?.emitNativeEvent({ type: 'wiki:renamed', event });
        commandLauncherWindow?.send('wiki:renamed', event);
        if (
          event
          && typeof event === 'object'
          && activeLibraryFileContext?.type === 'wiki'
          && typeof (event as { oldRelPath?: unknown }).oldRelPath === 'string'
          && typeof (event as { newRelPath?: unknown }).newRelPath === 'string'
          && activeLibraryFileContext.relPath === (event as { oldRelPath: string }).oldRelPath
        ) {
          const rename = event as { newRelPath: string; newAbsPath?: unknown };
          const nextFilePath = typeof rename.newAbsPath === 'string'
            ? rename.newAbsPath
            : path.resolve(activeLibraryFileContext.rootPath, `${rename.newRelPath}.md`);
          activeLibraryFileContext = {
            ...activeLibraryFileContext,
            relPath: rename.newRelPath,
            filePath: nextFilePath,
            title: path.basename(rename.newRelPath),
          };
          emitBrowserLibraryNavigationEvent({ type: 'wiki:openPage', relPath: rename.newRelPath }, { broadcastFallback: false });
          clipboardHistoryWindow?.getWindow()?.webContents.send('wiki:openPage', rename.newRelPath);
        }
      },
      notifyLibraryPageChanged: (event) => {
        const changedEvent = event && typeof event === 'object'
          ? { ...event as Record<string, unknown>, launcherDirectNotified: true }
          : event;
        const rootPath = changedEvent && typeof changedEvent === 'object' && typeof (changedEvent as { rootPath?: unknown }).rootPath === 'string'
          ? (changedEvent as { rootPath: string }).rootPath
          : undefined;
        commandLauncherWindow?.send('library:changed', event);
        librarianManager?.emit('library:changed', rootPath, changedEvent);
      },
      notifyLibraryItemRenamed: (event) => {
        browserHelperServer?.emitNativeEvent({ type: 'library:renamed', event });
        commandLauncherWindow?.send('library:renamed', event);
        if (
          event
          && typeof event === 'object'
          && activeLibraryFileContext?.type === 'external'
          && typeof (event as { oldAbsPath?: unknown }).oldAbsPath === 'string'
          && typeof (event as { newAbsPath?: unknown }).newAbsPath === 'string'
          && activeLibraryFileContext.filePath === (event as { oldAbsPath: string }).oldAbsPath
        ) {
          const rename = event as { rootPath?: unknown; newRelPath?: unknown; newAbsPath: string };
          activeLibraryFileContext = {
            ...activeLibraryFileContext,
            rootPath: typeof rename.rootPath === 'string' ? rename.rootPath : activeLibraryFileContext.rootPath,
            relPath: typeof rename.newRelPath === 'string' ? rename.newRelPath : rename.newAbsPath,
            filePath: rename.newAbsPath,
            title: path.basename(rename.newAbsPath).replace(/\.(?:md|markdown|mdx|html?|css)$/i, ''),
          };
          emitBrowserLibraryNavigationEvent({ type: 'external:openPage', absPath: rename.newAbsPath }, { broadcastFallback: false });
          clipboardHistoryWindow?.getWindow()?.webContents.send('external:openPage', rename.newAbsPath);
        }
      },
      getReadings: () => librarianManager?.getReadings() ?? [],
      getReading: (filePath) => librarianManager?.getReading(filePath) ?? null,
      saveReading: (filePath, content, expectedVersion) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { ok: false, reason: 'blocked' };
        }
        return librarianManager?.saveReading(filePath, content, isDocumentVersionLike(expectedVersion) ? expectedVersion : null) ?? { ok: false, reason: 'error' };
      },
      deleteReading: (filePath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return librarianManager?.deleteReading(filePath) ?? false;
      },
      getShareStatus: (filePath) => getLibrarianShareStatus(filePath),
      shareReading: (filePath) => shareLibrarianReading(filePath),
      unshareReading: (filePath) => unshareLibrarianReading(filePath),
      updateSharedReading: (filePath, content, title) => updateSharedLibrarianReading(filePath, content, title),
      isLibrarianEnabled: () => librarianManager?.isEnabled() ?? false,
      setLibrarianEnabled: (enabled) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return librarianManager?.setEnabled(enabled) ?? false;
      },
      isLibrarianSetupComplete: () => librarianManager?.isSetupComplete() ?? inferCurrentLibrarianSetupComplete(),
      setLibrarianSetupComplete: (complete) => {
        librarianManager?.setSetupComplete(complete);
      },
      createWelcomeArtifact: (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return librarianManager?.createWelcomeArtifact(dirPath) ?? false;
      },
      getLibrarianWatchedDirs: () => librarianManager?.getWatchedDirs() ?? [],
      addLibrarianWatchedDir: (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return librarianManager?.addWatchedDir(dirPath) ?? null;
      },
      removeLibrarianWatchedDir: (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return librarianManager?.removeWatchedDir(dirPath) ?? false;
      },
      browseLibrarianDirectory: async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: 'Select a directory to watch for readings',
        });
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
      },
      getDiscoveryFrequency: () => librarianManager?.getDiscoveryFrequency() ?? 'sometimes',
      setDiscoveryFrequency: (frequency) => (
        librarianManager && (frequency === 'often' || frequency === 'sometimes' || frequency === 'rarely')
          ? librarianManager.setDiscoveryFrequency(frequency)
          : false
      ),
      getUserExpertiseContext: () => librarianManager?.getUserExpertiseContext(),
      setUserExpertiseContext: (context) => librarianManager?.setUserExpertiseContext(context) ?? false,
      getClaudeCodeStatus: () => librarianManager?.getClaudeCodeStatus() ?? 'not-installed',
      isStateEnforcedHookInstalled: () => librarianManager?.isStateEnforcedHookInstalled() ?? false,
      installStateEnforcedHook: () => librarianManager?.installStateEnforcedHook() ?? false,
      uninstallStateEnforcedHook: () => librarianManager?.uninstallStateEnforcedHook() ?? false,
      isCursorHookInstalled: () => librarianManager?.isCursorHookInstalled() ?? false,
      installCursorHook: () => librarianManager?.installCursorHook() ?? false,
      uninstallCursorHook: () => librarianManager?.uninstallCursorHook() ?? false,
      isCodexHookInstalled: () => librarianManager?.isCodexHookInstalled() ?? false,
      installCodexHook: () => librarianManager?.installCodexHook() ?? false,
      uninstallCodexHook: () => librarianManager?.uninstallCodexHook() ?? false,
      pollLibrarianStatus: () => {
        const status = librarianManager?.checkAndResetIfNeeded() ?? { edits: 0, threshold: 5, didReset: false };
        const pendingPath = pendingAutoOpenReading;
        pendingAutoOpenReading = null;
        return {
          pendingPath,
          edits: status.edits,
          threshold: status.threshold,
          didReset: status.didReset,
        };
      },
      muteForToday: () => librarianManager?.muteForToday() ?? false,
      isMutedForToday: () => librarianManager?.isMutedForToday() ?? false,
      unmute: () => librarianManager?.unmute() ?? false,
      setBrowserLibraryImmersiveDismissable: (dismissable, clientId) => {
        if (clientId) browserLibraryImmersiveDismissableByClientId.set(clientId, dismissable);
        else browserLibraryImmersiveDismissable = dismissable;
      },
      setBrowserLibrarySizeKey: (key, clientId) => {
        if (clientId) browserLibrarySizeKeyByClientId.set(clientId, key);
        else browserLibrarySizeKey = key;
      },
      setMarkdownEditorFocused: (focused, clientId) => {
        browserLibraryMarkdownEditorFocused = Boolean(focused);
        if (browserLibraryMarkdownEditorFocused) {
          activeBrowserLibraryClientId = clientId ?? null;
          librarianMarkdownEditorFocused = false;
          promoteBrowserLibraryClientContext(activeBrowserLibraryClientId);
        } else if (!clientId || activeBrowserLibraryClientId === clientId) {
          activeBrowserLibraryClientId = null;
        }
        if (!browserLibraryMarkdownEditorFocused && activeLibraryFileContextSourceId === browserLibraryWindowId(clientId)) {
          activeLibraryFileContext = null;
          activeLibraryFileContextSourceId = null;
        }
      },
      replaceSelectedMarkdownTextResult: (result) => handleBrowserLibraryReplaceSelectedTextResult(result),
      listRecent: () => recentManager?.list() ?? [],
      visitRecent: (entry) => {
        const next = recentManager?.visit(entry) ?? [];
        broadcastRecentChanged();
        return next;
      },
      removeRecent: (kind, entryPath) => {
        const next = recentManager?.remove(kind, entryPath) ?? [];
        broadcastRecentChanged();
        return next;
      },
      listTaggedDocs: () => taggedDocsManager?.list() ?? [],
      markTaggedDocRead: (ulid) => taggedDocsManager?.markRead(ulid) ?? null,
      markAllTaggedDocsRead: () => taggedDocsManager?.markAllRead() ?? [],
      rescanTaggedDocs: () => taggedDocsManager?.rescan() ?? [],
      getSharedFilesAvailability: async () => {
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return { available: false, canWrite: false, hasTeamMembers: false, reason: 'not_authenticated' };
        return sharedSyncService.getAvailability();
      },
      getSharedFileStatus: async (filePath) => {
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return { shared: false };
        return sharedSyncService.getShareStatus(filePath);
      },
      shareSharedFile: async (input) => {
        if (!canWriteFieldTheoryContent()) return { shared: false };
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return { shared: false };
        const result = await sharedSyncService.shareFile(input as SharedFileShareInput);
        if (result.shared) librarianManager?.emit('library:changed');
        return result;
      },
      unshareSharedFile: async (filePath) => {
        if (!canWriteFieldTheoryContent()) return false;
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return false;
        const result = await sharedSyncService.unshareFile(filePath);
        if (result) librarianManager?.emit('library:changed');
        return result;
      },
      syncSharedFiles: async () => {
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return { written: 0, removed: 0, created: 0, errors: [sharedFeaturesDisabledError()] };
        const result = await sharedSyncService.syncOnce();
        if (result.written > 0 || result.removed > 0 || result.created > 0) {
          librarianManager?.emit('library:changed');
        }
        broadcastSharedFilePinsChanged();
        return result;
      },
      updateSharedFileContent: async (sharedId, content, expectedRevision, documentPath) => {
        if (!canWriteFieldTheoryContent()) return { ok: false, error: 'Read-only account mode' };
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return { ok: false, error: sharedFeaturesDisabledError() };
        const result = await sharedSyncService.updateSharedContent(sharedId, content, expectedRevision, documentPath);
        if (result.cachePath || result.conflictPath) librarianManager?.emit('library:changed');
        return result;
      },
      setActivePresence: async (sharedId) => {
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return [];
        return sharedSyncService.setActivePresence(sharedId);
      },
      getPinnedItemIds: async () => {
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return [];
        return sharedSyncService.getPinnedSidebarItemIds();
      },
      setPinned: async (filePath, pinned) => {
        if (!canWriteFieldTheoryContent()) return { ok: false, reason: 'read_only' };
        refreshFieldTheorySyncServices();
        if (!sharedSyncService || !canUseSharedFeatures()) return { ok: false, reason: 'not_authenticated' };
        return sharedSyncService.setPinned(filePath, pinned);
      },
      initializeCommands: async () => {
        await commandsManager?.initialize();
      },
      getWatchedCommandDirs: () => commandsManager?.getWatchedDirs() ?? [],
      addWatchedCommandDir: async (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return await commandsManager?.addWatchedDir(dirPath) ?? null;
      },
      removeWatchedCommandDir: (dirPath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return commandsManager?.removeWatchedDir(dirPath) ?? false;
      },
      getDefaultCommandDirectory: () => commandsManager?.getDefaultDirectory() ?? '',
      createDefaultCommandDirectory: async () => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return await commandsManager?.createDefaultDirectory() ?? null;
      },
      getCommands: () => commandsManager?.getCommands().map(cmd => ({
        name: cmd.name,
        displayName: cmd.displayName,
        filePath: cmd.filePath,
        lastModified: cmd.lastModified,
      })) ?? [],
      getCommandDirectory: () => commandsManager?.getDirectory() ?? null,
      setCommandDirectory: async (directoryPath) => {
        if (!commandsManager || !preferencesManager) {
          return { success: false, error: 'Not initialized' };
        }
        try {
          await commandsManager.setDirectory(typeof directoryPath === 'string' ? directoryPath : null);
          await preferencesManager.save({ commandsDirectory: directoryPath || undefined });
          return { success: true };
        } catch (error) {
          log.error('Failed to set Browser Library commands directory:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      },
      getCommandDirectories: () => commandsManager?.getCommandDirectories() ?? [],
      refreshCommands: async () => {
        if (!commandsManager) return [];
        await commandsManager.refresh();
        return commandsManager.getCommands().map(cmd => ({
          name: cmd.name,
          displayName: cmd.displayName,
          filePath: cmd.filePath,
          lastModified: cmd.lastModified,
        }));
      },
      getCommandContent: async (commandName) => {
        if (!commandsManager || typeof commandName !== 'string') return null;
        const command = commandsManager.getCommand(commandName);
        if (!command) return null;
        const loaded = await commandsManager.loadCommandContent(command);
        return loaded ? { content: loaded.content, filePath: loaded.filePath } : null;
      },
      getCommandByPath: (filePath) => commandsManager?.getCommandByPath(filePath) ?? null,
      getMarkdownPreview: (filePath) => loadMarkdownPreview(filePath),
      saveCommand: (filePath, content, expectedVersion) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { ok: false, reason: 'blocked' };
        }
        return commandsManager?.saveCommand(filePath, content, isDocumentVersionLike(expectedVersion) ? expectedVersion : null) ?? { ok: false, reason: 'error' };
      },
      createCommand: (directoryPath, name, content) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return commandsManager?.createCommand(directoryPath, name, content) ?? null;
      },
      deleteCommand: (filePath) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return false;
        }
        return commandsManager?.deleteCommand(filePath) ?? false;
      },
      renameCommand: (oldFilePath, newName) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return commandsManager?.renameCommand(oldFilePath, newName) ?? null;
      },
      shareCommand: async (command) => {
        refreshFieldTheorySyncServices();
        if (!canUseFieldTheorySync()) return { error: fieldTheorySyncDisabledError() };
        const supabase = authManager?.getSupabaseClient();
        if (!supabase) return { error: 'Not authenticated' };
        const session = await authManager?.getSession();
        if (!session) return { error: 'Please log in to share commands' };
        const commandInput = command as { name?: unknown; content?: unknown };
        const { data, error } = await supabase
          .from('popular_commands')
          .insert({
            name: typeof commandInput.name === 'string' ? commandInput.name : '',
            content: typeof commandInput.content === 'string' ? commandInput.content : '',
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
      },
      unshareCommand: async (commandId) => {
        refreshFieldTheorySyncServices();
        if (!canUseFieldTheorySync()) return { error: fieldTheorySyncDisabledError() };
        const supabase = authManager?.getSupabaseClient();
        if (!supabase) return { error: 'Not authenticated' };
        const { error } = await supabase
          .from('popular_commands')
          .delete()
          .eq('id', commandId);
        if (error) {
          log.error('Failed to unshare command:', error);
          return { error: error.message };
        }
        return { success: true };
      },
      runLocalCommand: (request) => runNativeLocalCommand(request),
      listMaxwellRuns: (limit) => listNativeMaxwellRuns(limit),
      getMaxwellMemory: () => getMaxwellMemoryState(),
      saveMaxwellMemory: (request) => saveNativeMaxwellMemory(request),
      cancelMaxwellRun: (runId) => cancelNativeMaxwellRun(runId),
      undoMaxwellRun: (runId) => undoNativeMaxwellRun(runId),
      redoMaxwellRun: (runId) => redoNativeMaxwellRun(runId),
      archiveActiveLibraryFile: () => archiveActiveLibraryFileForLauncher(),
      toggleActiveLibraryLineNumbers: () => toggleActiveLibraryLineNumbersForLauncher(),
      getActiveMeeting: () => {
        try {
          return getMeetingManager().getActiveSession();
        } catch {
          return null;
        }
      },
      startMeetingHere: async () => {
        try {
          return await getMeetingManager().startHere(activeLibraryFileContext ? { ...activeLibraryFileContext } : null);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Meeting action failed' };
        }
      },
      stopMeeting: async () => {
        try {
          return await getMeetingManager().stopActiveMeeting();
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Meeting action failed' };
        }
      },
      getBookmarks: () => ensureBookmarksManager().getSnapshot(),
      getBookmarkDataSource: () => {
        const { bookmarkDataDir, canonicalBookmarkDataDir, legacyBookmarkDataDir } = require('./fieldTheoryPaths') as typeof import('./fieldTheoryPaths');
        const dataDir = bookmarkDataDir();
        return {
          dataDir,
          canonicalDataDir: canonicalBookmarkDataDir(),
          legacyDataDir: legacyBookmarkDataDir(),
          usingLegacyDataDir: dataDir === legacyBookmarkDataDir(),
          bookmarksCachePath: path.join(dataDir, 'bookmarks.jsonl'),
          mediaDir: path.join(dataDir, 'media'),
          mediaManifestPath: path.join(dataDir, 'media-manifest.json'),
        };
      },
      syncBookmarksIfStale: () => syncBookmarksFromCliIfStale(),
      getBookmarkAuthors: () => {
        const { buildBookmarkAuthorSummaries } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
        return buildBookmarkAuthorSummaries(ensureBookmarksManager().getSnapshot().bookmarks);
      },
      getAuthorBookmarks: (handle) => {
        const { bookmarksForAuthor } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
        return bookmarksForAuthor(handle, ensureBookmarksManager().getSnapshot().bookmarks);
      },
      getTaxonomyBookmarks: (filePaths) => {
        const { bookmarksForTaxonomyFiles } = require('./bookmarkCollections') as typeof import('./bookmarkCollections');
        return bookmarksForTaxonomyFiles(filePaths, ensureBookmarksManager().getSnapshot().bookmarks);
      },
      searchBookmarks: (query) => {
        const { searchBookmarks } = require('./bookmarkCollections') as typeof import('./bookmarkCollections');
        return searchBookmarks(query, ensureBookmarksManager().getSnapshot().bookmarks);
      },
      saveWebBookmarkUrl: async (url) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { success: false, error: 'Field Theory is read-only' };
        }
        if (!url.trim()) return { success: false, error: 'URL is required' };
        try {
          const result = await ensureBookmarksManager().saveWebBookmarkFromUrl(url);
          return { success: true, ...result };
        } catch (error) {
          log.error('Error saving web bookmark from Browser Library:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      },
      getActiveWebPageForBookmark: () => getActiveWebPageForBrowserLibraryBookmark('browser-library-get-active-web-page'),
      saveActiveWebPageBookmark: async () => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { success: false, error: 'Field Theory is read-only' };
        }
        const activePage = await getActiveWebPageForBrowserLibraryBookmark('browser-library-save-active-web-page');
        if (!activePage.success || !activePage.page) return activePage;
        try {
          const result = await ensureBookmarksManager().saveWebBookmarkFromUrl(activePage.page.url);
          appendCommandLauncherTrace('browser-library-save-active-web-page-success', {
            targetBundleId: activePage.page.bundleId,
            targetName: activePage.page.appName,
            url: activePage.page.url,
            created: result.created,
            markdownPath: result.markdownPath,
          });
          return { success: true, page: activePage.page, ...result };
        } catch (error) {
          log.error('Error saving active browser page from Browser Library:', error);
          appendCommandLauncherTrace('browser-library-save-active-web-page-error', {
            targetBundleId: activePage.page.bundleId,
            targetName: activePage.page.appName,
            error,
          });
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      },
      invokeBookmark: (id) => {
        const { bookmarkById, formatBookmarkPost } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
        const bookmark = bookmarkById(id, ensureBookmarksManager().getSnapshot().bookmarks);
        if (!bookmark) return { success: false, error: 'Bookmark not found' };
        return pasteBookmarkTextFromBrowserLibrary('browser-library-invoke-bookmark-post', { id }, formatBookmarkPost(bookmark));
      },
      sendBookmarkToCodex: (id) => {
        const { buildBookmarkAgentCopyText } = require('./bookmarkAgentCopy') as typeof import('./bookmarkAgentCopy');
        const { bookmarkById } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
        const { mediaDir: bookmarkMediaDir } = require('./bookmarksManager') as typeof import('./bookmarksManager');
        const bookmark = bookmarkById(id, ensureBookmarksManager().getSnapshot().bookmarks);
        if (!bookmark) {
          return { success: false, error: 'Bookmark not found' };
        }
        return pasteTextIntoCodexInputFromBrowserLibrary(buildBookmarkAgentCopyText(bookmark, bookmarkMediaDir()));
      },
      copyBookmarkForAgent: (id) => {
        const { buildBookmarkAgentCopyText } = require('./bookmarkAgentCopy') as typeof import('./bookmarkAgentCopy');
        const { bookmarkById } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
        const { mediaDir: bookmarkMediaDir } = require('./bookmarksManager') as typeof import('./bookmarksManager');
        const bookmark = bookmarkById(id, ensureBookmarksManager().getSnapshot().bookmarks);
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
      },
      invokeBookmarkAuthorTimeline: (handle) => {
        const { formatBookmarkAuthorTimeline } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
        const timeline = formatBookmarkAuthorTimeline(handle, ensureBookmarksManager().getSnapshot().bookmarks);
        if (!timeline) return { success: false, error: 'No bookmarks found for author' };
        return pasteBookmarkTextFromBrowserLibrary('browser-library-invoke-bookmark-author', { handle }, timeline);
      },
      getBookmarkMediaDirectory: () => {
        const { mediaDir: bookmarkMediaDir } = require('./bookmarksManager') as typeof import('./bookmarksManager');
        return bookmarkMediaDir();
      },
      getBookmarkMediaFilePath: (filename) => {
        const { resolveBookmarkMediaFile } = require('./bookmarksManager') as typeof import('./bookmarksManager');
        return resolveBookmarkMediaFile(path.basename(filename));
      },
      getAppVersion: () => app.getVersion(),
      isUpdaterEnabled: () => isAutoUpdaterEnabled,
      getUpdaterStatus: () => pendingUpdateInfo,
      checkForUpdates: () => checkForAppUpdates(),
      downloadUpdate: () => downloadAppUpdate(),
      installUpdate: () => installAppUpdate(),
      dismissUpdate: () => dismissAppUpdate(),
      openExternal: (href) => {
        if (!isAllowedExternalShellUrl(href)) return false;
        shell.openExternal(href);
        return true;
      },
      showItemInFolder: (filePath) => {
        shell.showItemInFolder(filePath);
        return true;
      },
      setRepresentedFilename: (filePath, clientId) => {
        if (clientId) {
          browserLibraryRepresentedFilenameByClientId.set(clientId, filePath || '');
        } else {
          browserLibraryRepresentedFilename = filePath || '';
        }
      },
      pasteIntoCodexInput: (text) => pasteTextIntoCodexInputFromBrowserLibrary(text),
      openFieldTheoryMarkdownInNativeApp: (target) => openFieldTheoryMarkdownInNativeApp(target),
      writeClipboardText: (text) => {
        try {
          clipboard.writeText(text);
          clipboardManager?.syncClipboardHash();
          return { success: true };
        } catch (error) {
          log.error('Error writing Browser Library clipboard text:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      },
      getClipboardImagePath: () => clipboardManager?.exportCurrentClipboardImageToCache() ?? null,
      savePastedImageFile: (file) => clipboardManager?.savePastedImageFileToCache(file as { name?: string | null; type?: string | null; data: Uint8Array }) ?? null,
      pickFolder: async () => {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        if (result.canceled) return null;
        return result.filePaths[0] ?? null;
      },
      openDocumentWindow: (target) => {
        if (!target || typeof target !== 'object') return { success: false, error: 'Invalid document target' };
        const normalized = normalizeLibraryDocumentWindowTarget(target as Partial<LibraryDocumentWindowTarget>);
        if (!normalized) return { success: false, error: 'Invalid document window target' };
        getLibraryDocumentWindowManager().open(normalized);
        return { success: true };
      },
      copyImageForDocument: (documentPath, imagePath, alt) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return copyImageForMarkdownDocument(documentPath, imagePath, alt || 'Image', { libraryRoots: manager.getLibraryRoots().map((root) => root.path) });
      },
      copyImageDataUrlForDocument: (documentPath, dataUrl, alt) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return null;
        }
        return copyImageDataUrlForMarkdownDocument(documentPath, dataUrl, alt || 'Image', { libraryRoots: manager.getLibraryRoots().map((root) => root.path) });
      },
      makeImagesPortable: (documentPath, content) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { content, copied: 0, rewritten: 0, missing: 0 };
        }
        return makeMarkdownImagesPortable(documentPath, content, { libraryRoots: manager.getLibraryRoots().map((root) => root.path) });
      },
      deleteUnusedCopiedImages: (documentPath, removedMarkdown, remainingContent) => {
        if (!canWriteFieldTheoryContent()) {
          blockWrite();
          return { deleted: 0, skipped: 0, missing: 0 };
        }
        return deleteUnusedCopiedMarkdownImages(documentPath, removedMarkdown, remainingContent, { libraryRoots: manager.getLibraryRoots().map((root) => root.path) });
      },
      getFieldTheorySyncStatus: () => getFieldTheorySyncStatus(),
      startAgentKickoff: (args) => {
        if (!agentKickoffManager) {
          return {
            ok: false,
            runId: '',
            error: 'Agent kickoff manager unavailable',
          };
        }
        return agentKickoffManager.start(args as AgentKickoffArgs);
      },
      cancelAgentKickoff: (runId) => agentKickoffManager?.cancel(runId) ?? false,
      getRendererStorage: () => getBrowserLibraryRendererStorage(),
      setRendererStorage: (key, value) => setBrowserLibraryRendererStorage(key, value),
      appendRenderedEditorDebug: (entry) => writeRenderedEditorDebugLog(entry),
      clearRenderedEditorDebugLog: () => clearRenderedEditorDebugLog(),
      getActiveLibraryFileContext: () => getActiveBrowserLibraryPanelContext() ?? activeLibraryFileContext,
    },
    reportCurrentDocument: (context, clientId) => {
      const windowId = browserLibraryWindowId(clientId);
      if (!shouldAcceptActiveLibraryFileContext(context)) {
        if (activeLibraryFileContextSourceId === windowId) {
          activeLibraryFileContext = null;
          activeLibraryFileContextSourceId = null;
        }
        getDocumentPresenceManager().clearWindow(windowId);
        appendCommandLauncherTrace('active-library-context-rejected', {
          source: clientId ? 'browser-helper' : 'browser-helper-legacy',
          windowId,
          filePath: context.filePath,
          rootPath: context.rootPath,
        });
        return;
      }
      if (clientId) {
        browserLibraryContextByClientId.set(clientId, context);
        if (activeBrowserLibrarySurfaceClientId === clientId) {
          promoteBrowserLibraryClientContext(clientId);
        }
      } else {
        activeLibraryFileContext = activeLibraryFileContextFromPresence(context);
        activeLibraryFileContextSourceId = windowId;
      }
      getDocumentPresenceManager().setWindowDocument(windowId, context, true);
    },
    clearCurrentDocument: (clientId) => {
      const windowId = browserLibraryWindowId(clientId);
      if (clientId) {
        browserLibraryContextByClientId.delete(clientId);
      }
      if (activeLibraryFileContextSourceId === windowId) {
        activeLibraryFileContext = null;
        activeLibraryFileContextSourceId = null;
      }
      getDocumentPresenceManager().clearWindow(windowId);
    },
    setActiveClient: (clientId, surface) => {
      if (!clientId) return;
      activeBrowserLibrarySurfaceClientId = clientId;
      if (surface) {
        activeBrowserLibrarySurfaceKind = surface;
      }
      promoteBrowserLibraryClientContext(clientId);
    },
    clearActiveClient: (clientId) => {
      if (!clientId || activeBrowserLibrarySurfaceClientId !== clientId) return;
      activeBrowserLibrarySurfaceClientId = null;
      activeBrowserLibrarySurfaceKind = null;
    },
    onClientDisconnected: (clientId) => {
      const windowId = browserLibraryWindowId(clientId);
      getDocumentPresenceManager().closeWindow(windowId);
      if (clientId) {
        browserLibraryContextByClientId.delete(clientId);
        browserLibraryImmersiveDismissableByClientId.delete(clientId);
        browserLibrarySizeKeyByClientId.delete(clientId);
        browserLibraryRepresentedFilenameByClientId.delete(clientId);
      }
      if (activeLibraryFileContextSourceId === windowId) {
        activeLibraryFileContext = null;
        activeLibraryFileContextSourceId = null;
      }
      if (!clientId || activeBrowserLibrarySurfaceClientId === clientId) {
        activeBrowserLibrarySurfaceClientId = null;
        activeBrowserLibrarySurfaceKind = null;
      }
      if (!clientId || activeBrowserLibraryClientId === clientId) {
        browserLibraryMarkdownEditorFocused = false;
        activeBrowserLibraryClientId = null;
      }
    },
  });
  const address = await browserHelperServer.start();
  const devServer = process.env.ELECTRON_START_URL?.replace(/\/$/, '');
  const browserUrl = buildBrowserLibraryUrl({ address, devServer });
  writeBrowserHelperState({ address, browserUrl });
  log.info('Field Theory browser helper listening at %s', browserUrl);
}
let librarySyncService: LibrarySyncService | null = null;
let sharedFilesSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let sharedTeamService: SharedTeamService | null = null;
let sharedSyncService: SharedSyncService | null = null;
let commandLauncherWindow: CommandLauncherWindow | null = null;
let lastExternalCommandTargetApp: { bundleId: string; name: string } | null = null;
type ActiveLibraryFileContext = {
  type: 'wiki' | 'external';
  rootPath: string;
  relPath: string;
  filePath: string;
  title: string;
  selectionStart?: number;
  selectionEnd?: number;
  selectionText?: string;
};
let activeLibraryFileContext: ActiveLibraryFileContext | null = null;
let activeLibraryFileContextSourceId: string | null = null;
const browserLibraryContextByClientId = new Map<string, DocumentPresenceContext>();
const documentPresenceWindows = new WeakSet<BrowserWindow>();

function browserLibraryWindowId(clientId: string | null | undefined): string {
  return clientId ? `browser-helper:${clientId}` : 'browser-helper';
}

function browserLibraryClientIdFromWindowId(windowId: string | null | undefined): string | null {
  const prefix = 'browser-helper:';
  return windowId?.startsWith(prefix) ? windowId.slice(prefix.length) : null;
}

function getActiveBrowserLibraryMarkdownCommandTargetClientId(): string | null {
  const targetClientId = getBrowserLibraryMarkdownCommandTargetClientId({
    browserMarkdownEditorFocused: browserLibraryMarkdownEditorFocused,
    activeBrowserMarkdownClientId: activeBrowserLibraryClientId,
  });
  return targetClientId && browserHelperServer?.hasNativeEventClient(targetClientId) ? targetClientId : null;
}

function currentActiveLibraryContextRootPaths(): { libraryRootPaths: string[]; watchedDirPaths: string[] } {
  return {
    libraryRootPaths: librarianManager?.getLibraryRootPaths() ?? [],
    watchedDirPaths: librarianManager?.getWatchedDirs().map((dir) => dir.path) ?? [],
  };
}

function shouldAcceptActiveLibraryFileContext(context: ActiveLibraryFileContext | DocumentPresenceContext): boolean {
  return isActiveLibraryFileContextAllowed({
    context,
    ...currentActiveLibraryContextRootPaths(),
  });
}

function activeLibraryFileContextFromPresence(context: DocumentPresenceContext): ActiveLibraryFileContext {
  const next: ActiveLibraryFileContext = {
    type: context.type,
    rootPath: context.rootPath,
    relPath: context.relPath,
    filePath: context.filePath,
    title: context.title,
  };
  if (typeof context.selectionStart === 'number' && typeof context.selectionEnd === 'number') {
    next.selectionStart = context.selectionStart;
    next.selectionEnd = context.selectionEnd;
    if (typeof context.selectionText === 'string') {
      next.selectionText = context.selectionText;
    }
  }
  return next;
}

function getActiveBrowserLibraryPanelContext(): ActiveLibraryFileContext | null {
  if (activeBrowserLibrarySurfaceKind !== 'library' || !activeBrowserLibrarySurfaceClientId) return null;
  const context = browserLibraryContextByClientId.get(activeBrowserLibrarySurfaceClientId);
  if (!context || !shouldAcceptActiveLibraryFileContext(context)) return null;
  return activeLibraryFileContextFromPresence(context);
}

function archiveActiveLibraryFileForLauncher(): { success: boolean; error?: string } {
  if (!librarianManager) return { success: false, error: 'Library is not ready' };
  if (!canWriteFieldTheoryContent()) {
    blockWrite();
    return { success: false, error: 'Field Theory is read-only' };
  }
  if (!activeLibraryFileContext) return { success: false, error: 'No current Library file to archive' };
  if (!fs.existsSync(activeLibraryFileContext.filePath)) {
    return { success: false, error: 'Current Library file no longer exists' };
  }

  try {
    const expectedVersion = readDocumentVersion(activeLibraryFileContext.filePath);
    const content = fs.readFileSync(activeLibraryFileContext.filePath, 'utf-8');
    const nextContent = setMarkdownArchivedState(content, true);
    const result = activeLibraryFileContext.type === 'wiki'
      ? librarianManager.saveWikiPage(activeLibraryFileContext.relPath, nextContent, expectedVersion)
      : writeTextFileWithConflictGuard(activeLibraryFileContext.filePath, nextContent, expectedVersion);
    if (!result.ok) return { success: false, error: `Archive failed: ${result.reason}` };
    if (activeLibraryFileContext.type === 'external') {
      librarianManager.emit('library:changed', activeLibraryFileContext.rootPath);
    }
    appendCommandLauncherTrace('archive-active-library-file-success', {
      type: activeLibraryFileContext.type,
      relPath: activeLibraryFileContext.relPath,
      filePath: activeLibraryFileContext.filePath,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Archive failed';
    appendCommandLauncherTrace('archive-active-library-file-error', { error: message });
    return { success: false, error: message };
  }
}

function promoteBrowserLibraryClientContext(clientId: string | null | undefined): void {
  if (!clientId) return;
  if (!shouldPromoteBrowserLibraryClientContext({
    nativeMarkdownEditorFocused: librarianMarkdownEditorFocused,
    browserMarkdownEditorFocused: browserLibraryMarkdownEditorFocused,
    activeBrowserMarkdownClientId: activeBrowserLibraryClientId,
    candidateClientId: clientId,
  })) return;
  const context = browserLibraryContextByClientId.get(clientId);
  if (!context) return;
  activeLibraryFileContext = activeLibraryFileContextFromPresence(context);
  activeLibraryFileContextSourceId = browserLibraryWindowId(clientId);
}
const BROWSER_LIBRARY_RENDERER_STORAGE_KEY_SET = new Set<string>(BROWSER_LIBRARY_RENDERER_STORAGE_KEYS);
let browserLibraryRendererStorageStore: BrowserLibraryRendererStorageStore | null = null;

function getBrowserLibraryRendererStorageStore(): BrowserLibraryRendererStorageStore {
  if (!browserLibraryRendererStorageStore) {
    browserLibraryRendererStorageStore = new BrowserLibraryRendererStorageStore(
      BrowserLibraryRendererStorageStore.defaultPath(app.getPath('userData')),
    );
  }
  return browserLibraryRendererStorageStore;
}

async function getBrowserLibraryRendererStorage(): Promise<{ available: boolean; values: Record<string, string | null> }> {
  const store = getBrowserLibraryRendererStorageStore();
  const webContents = clipboardHistoryWindow?.getWindow()?.webContents;
  if (webContents && !webContents.isDestroyed()) {
    const values = await webContents.executeJavaScript(`
      (() => {
        const keys = ${JSON.stringify(BROWSER_LIBRARY_RENDERER_STORAGE_KEYS)};
        const values = {};
        for (const key of keys) values[key] = window.localStorage.getItem(key);
        return values;
      })()
    `, true).catch(() => null);
    if (values && typeof values === 'object') {
      await store.merge(values as Record<string, string | null>);
    }
  }
  return store.snapshot();
}

async function setBrowserLibraryRendererStorage(key: string, value: string | null): Promise<void> {
  if (!BROWSER_LIBRARY_RENDERER_STORAGE_KEY_SET.has(key)) return;
  const changed = await getBrowserLibraryRendererStorageStore().set(key, value);
  if (!changed) return;
  if (changed) broadcastBrowserLibraryRendererStorageChanged(key, value);
  const webContents = clipboardHistoryWindow?.getWindow()?.webContents;
  if (!webContents || webContents.isDestroyed()) return;
  await applyBrowserLibraryRendererStorageToWebContents(webContents, { [key]: value });
}

async function applyBrowserLibraryRendererStorageToWebContents(
  webContents: Electron.WebContents,
  values: Record<string, string | null>,
): Promise<void> {
  if (webContents.isDestroyed()) return;
  await webContents.executeJavaScript(`
    (() => {
      const values = ${JSON.stringify(values)};
      for (const [key, value] of Object.entries(values)) {
        if (value === null) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, value);
        }
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
      }
    })()
  `, true).catch(() => {});
}

async function hydrateNativeRendererStorageFromBrowserLibraryStore(): Promise<void> {
  const webContents = clipboardHistoryWindow?.getWindow()?.webContents;
  if (!webContents || webContents.isDestroyed()) return;
  const snapshot = await getBrowserLibraryRendererStorageStore().snapshot();
  await applyBrowserLibraryRendererStorageToWebContents(webContents, snapshot.values);
}

function broadcastBrowserLibraryRendererStorageChanged(key: string, value: string | null): void {
  if (!BROWSER_LIBRARY_RENDERER_STORAGE_KEY_SET.has(key)) return;
  browserHelperServer?.emitNativeEvent({ type: 'renderer-storage:changed', key, value });
}
let metricsManager: MetricsManager | null = null;
let todoStore: TodoStore | null = null;
let hotMicManager: HotMicManager | null = null;
let librarianMarkdownEditorFocused = false;
let browserLibraryMarkdownEditorFocused = false;
let activeBrowserLibraryClientId: string | null = null;
let activeBrowserLibrarySurfaceClientId: string | null = null;
let activeBrowserLibrarySurfaceKind: 'library' | 'commands' | 'bookmarks' | 'ember' | null = null;
let browserLibraryImmersiveDismissable = false;
let browserLibrarySizeKey: ClipboardHistorySizeKey = 'library';
let browserLibraryRepresentedFilename = '';
const browserLibraryImmersiveDismissableByClientId = new Map<string, boolean>();
const browserLibrarySizeKeyByClientId = new Map<string, ClipboardHistorySizeKey>();
const browserLibraryRepresentedFilenameByClientId = new Map<string, string>();
const pendingBrowserLibraryReplaceSelectedText = new Map<string, {
  resolve: (success: boolean) => void;
  timeout: NodeJS.Timeout;
}>();
let codexTerminalManager: CodexTerminalManager | null = null;
let focusedCodexTerminalLauncherSessionId: string | null = null;
let lastScratchpadOpenAt = 0;
let appQuitConfirmedWithLocalWork = false;
let appQuitConfirmationOpen = false;
let appQuitWatcherCleanupComplete = false;
let appQuitWatcherCleanupInFlight: Promise<void> | null = null;
let appMetadataIPCHandlersInstalled = false;
let onboardingIPCHandlersInstalled = false;
let transcribeIPCHandlersInstalled = false;
let globalImproveInFlight = false;

function emitBrowserLibraryNavigationEvent(event: BrowserHelperNativeEvent, options: { broadcastFallback?: boolean } = {}): boolean {
  if (
    shouldTargetBrowserLibraryNavigation({ nativeMarkdownEditorFocused: librarianMarkdownEditorFocused }) &&
    activeBrowserLibrarySurfaceClientId &&
    browserHelperServer?.hasNativeEventClient(activeBrowserLibrarySurfaceClientId)
  ) {
    browserHelperServer.emitNativeEventToClient(activeBrowserLibrarySurfaceClientId, event);
    return true;
  }
  if (options.broadcastFallback !== false) {
    browserHelperServer?.emitNativeEvent(event);
  }
  return false;
}

function emitBrowserLibraryLauncherTarget(target: unknown): boolean {
  return emitBrowserLibraryNavigationEvent({ type: 'commands:openMarkdownFromLauncher', target });
}

function toggleActiveLibraryLineNumbersForLauncher(): { success: boolean; error?: string } {
  if (
    activeLibraryFileContextSourceId?.startsWith('browser-helper:')
    && emitBrowserLibraryNavigationEvent({ type: 'commands:toggleLineNumbersFromLauncher' }, { broadcastFallback: false })
  ) {
    commandLauncherWindow?.hide(true);
    return { success: true };
  }

  const window = clipboardHistoryWindow?.getWindow();
  if (!window || window.isDestroyed()) return { success: false, error: 'Field Theory window is not available' };
  if (!clipboardHistoryWindow?.isVisible()) {
    clipboardHistoryWindow?.showLibrary(restoreClipboardHistoryBounds('library'));
  } else {
    clipboardHistoryWindow.focusExistingWindow();
  }
  commandLauncherWindow?.hide(true);
  browserHelperServer?.emitNativeEvent({ type: 'commands:toggleLineNumbersFromLauncher' });
  window.webContents.send('commands:toggleLineNumbersFromLauncher');
  return { success: true };
}

function openFieldTheoryMarkdownInNativeApp(rawTarget: unknown): { success: boolean; error?: string } {
  const target = normalizeFieldTheoryMarkdownTarget(rawTarget);
  appendCommandLauncherTrace('browser-library-open-field-theory-native-start', {
    kind: target?.kind ?? null,
    path: target?.path ?? null,
    contentMode: target?.contentMode ?? null,
  });
  if (!target) return { success: false, error: 'Invalid markdown target' };
  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }

  const sizeKey: ClipboardHistorySizeKey = target.kind === 'bookmarks'
    ? clipboardHistoryWindow.getCurrentSizeKey()
    : target.kind === 'clipboard'
      ? 'fields'
      : 'library';
  if (clipboardHistoryWindow.isVisible()) {
    suspendDynamicIslandFocusForClipboardHistory('browser-library-open-field-theory-native');
    clipboardHistoryWindow.focusExistingWindow();
  } else {
    const boundsToUse = restoreClipboardHistoryBounds(sizeKey);
    suspendDynamicIslandFocusForClipboardHistory('browser-library-open-field-theory-native');
    if (target.kind === 'clipboard') {
      clipboardHistoryWindow.show(boundsToUse);
    } else {
      clipboardHistoryWindow.showLibrary(boundsToUse);
    }
  }

  clipboardHistoryWindow.getWindow()?.webContents.send('commands:openMarkdownFromLauncher', target);
  appendCommandLauncherTrace('browser-library-open-field-theory-native-success', {
    kind: target.kind,
    path: target.path,
    contentMode: target.contentMode ?? null,
  });
  return { success: true };
}

function ensureBookmarksManager(): BookmarksManager {
  if (!bookmarksManager) {
    const { BookmarksManager } = require('./bookmarksManager') as typeof import('./bookmarksManager');
    bookmarksManager = new BookmarksManager();
  }
  return bookmarksManager;
}

function ensureBookmarksWatcher(): void {
  if (bookmarksWatcherStarted) return;
  const manager = ensureBookmarksManager();
  manager.startWatcher();
  manager.on('bookmarks:changed', () => {
    browserHelperServer?.emitNativeEvent({ type: 'bookmarks:changed' });
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('bookmarks:changed');
    });
  });
  bookmarksWatcherStarted = true;
}

async function pasteBookmarkTextFromBrowserLibrary(
  tracePrefix: string,
  tracePayload: Record<string, unknown>,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const targetApp = getCommandLauncherTargetApp();
    appendCommandLauncherTrace(`${tracePrefix}-start`, {
      ...tracePayload,
      targetBundleId: targetApp?.bundleId ?? null,
      targetName: targetApp?.name ?? null,
      source: 'browser-library',
    });

    if (!targetApp) {
      appendCommandLauncherTrace(`${tracePrefix}-no-target`, { ...tracePayload, source: 'browser-library' });
      return { success: false, error: 'No external target app available' };
    }

    await runWithCommandLauncherExternalInvocation(async () => {
      clipboard.writeText(text);
      clipboardManager?.syncClipboardHash();
      await activateAndPasteFromCommandLauncher(targetApp);
    });

    appendCommandLauncherTrace(`${tracePrefix}-success`, {
      ...tracePayload,
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      source: 'browser-library',
    });
    return { success: true };
  } catch (error) {
    log.error(`Error invoking ${tracePrefix} from Browser Library:`, error);
    appendCommandLauncherTrace(`${tracePrefix}-error`, { ...tracePayload, source: 'browser-library', error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function getActiveWebPageForBrowserLibraryBookmark(tracePrefix: string) {
  const targetApp = getCommandLauncherTargetApp();
  appendCommandLauncherTrace(`${tracePrefix}-start`, {
    targetBundleId: targetApp?.bundleId ?? null,
    targetName: targetApp?.name ?? null,
    source: 'browser-library',
  });

  if (!targetApp) {
    appendCommandLauncherTrace(`${tracePrefix}-no-target`, { source: 'browser-library' });
    return { success: false, error: 'No browser app was active before Field Theory opened' };
  }

  try {
    const page = await getActiveBrowserPage(targetApp);
    if (!page) {
      appendCommandLauncherTrace(`${tracePrefix}-no-page`, {
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        source: 'browser-library',
      });
      return { success: false, error: `No active browser page found in ${targetApp.name}` };
    }
    appendCommandLauncherTrace(`${tracePrefix}-success`, {
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      url: page.url,
      source: 'browser-library',
    });
    return { success: true, page };
  } catch (error) {
    log.error(`Error resolving active browser page for ${tracePrefix}:`, error);
    appendCommandLauncherTrace(`${tracePrefix}-error`, {
      targetBundleId: targetApp.bundleId,
      targetName: targetApp.name,
      source: 'browser-library',
      error,
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function cleanupFileWatchersBeforeQuit(): Promise<void> {
  if (appQuitWatcherCleanupComplete) return Promise.resolve();
  if (appQuitWatcherCleanupInFlight) return appQuitWatcherCleanupInFlight;

  appQuitWatcherCleanupInFlight = (async () => {
    await Promise.allSettled([
      librarianManager?.destroy(),
      taggedDocsManager?.destroy(),
      bookmarksManager?.stopWatcher(),
      documentPresenceManager?.flush(),
    ]);
    documentPresenceManager?.destroy();
    librarianManager = null;
    taggedDocsManager = null;
    documentPresenceManager = null;
    bookmarksWatcherStarted = false;
    appQuitWatcherCleanupComplete = true;
  })().finally(() => {
    appQuitWatcherCleanupInFlight = null;
  });

  return appQuitWatcherCleanupInFlight;
}

async function ensureUserDataManagerRestored(): Promise<UserDataManager> {
  if (!userDataManager) {
    userDataManager = createUserDataManager();
    await userDataManager.restoreCurrentUser();
    startupMark('user-data-restored');
  }
  return userDataManager;
}

function inferCurrentLibrarianSetupComplete(): boolean {
  const settingsPath = userDataManager?.isLoggedIn()
    ? userDataManager.getUserDataPath('librarian-settings.json')
    : path.join(app.getPath('userData'), 'librarian-settings.json');
  return inferLibrarianSetupComplete({ settingsPath, libraryPath: libraryDir() });
}

const LAUNCHER_FILE_ICON_CACHE_LIMIT = 512;
const launcherFileIconCache = new Map<string, string | null>();

function rememberLauncherFileIcon(filePath: string, iconDataUrl: string | null): void {
  if (launcherFileIconCache.size >= LAUNCHER_FILE_ICON_CACHE_LIMIT) {
    const oldestKey = launcherFileIconCache.keys().next().value;
    if (oldestKey) launcherFileIconCache.delete(oldestKey);
  }
  launcherFileIconCache.set(filePath, iconDataUrl);
}

async function getLauncherFileIcon(filePath: string): Promise<LauncherFileIconResult> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { success: false, error: 'File path missing' };
  }

  const normalizedPath = path.normalize(filePath);
  if (launcherFileIconCache.has(normalizedPath)) {
    const iconDataUrl = launcherFileIconCache.get(normalizedPath);
    return iconDataUrl ? { success: true, iconDataUrl } : { success: false, error: 'Icon unavailable' };
  }

  if (!fs.existsSync(normalizedPath)) {
    rememberLauncherFileIcon(normalizedPath, null);
    return { success: false, error: 'Icon target not found' };
  }

  try {
    if (/\.app$/i.test(normalizedPath)) {
      const { resolveLauncherAppIconPath } = require('./launcherApps') as typeof import('./launcherApps');
      const appIconPath = resolveLauncherAppIconPath(normalizedPath);
      if (appIconPath) {
        const appIcon = nativeImage.createFromPath(appIconPath);
        if (!appIcon.isEmpty()) {
          const iconDataUrl = appIcon.resize({ width: 32, height: 32, quality: 'best' }).toDataURL();
          rememberLauncherFileIcon(normalizedPath, iconDataUrl);
          return { success: true, iconDataUrl };
        }
      }
    }

    const icon = await app.getFileIcon(normalizedPath, { size: 'small' });
    if (icon.isEmpty()) {
      rememberLauncherFileIcon(normalizedPath, null);
      return { success: false, error: 'Icon unavailable' };
    }
    const iconDataUrl = icon.toDataURL();
    rememberLauncherFileIcon(normalizedPath, iconDataUrl);
    return { success: true, iconDataUrl };
  } catch (error) {
    rememberLauncherFileIcon(normalizedPath, null);
    return { success: false, error: error instanceof Error ? error.message : 'Icon unavailable' };
  }
}

function emitLocalCommandStatus(status: Omit<LocalCommandStatus, 'updatedAt'>): LocalCommandStatus {
  const payload = { ...status, updatedAt: Date.now() };
  browserHelperServer?.emitNativeEvent({ type: 'commands:localCommandStatus', status: payload });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(CommandsIPCChannels.LOCAL_COMMAND_STATUS, payload);
    }
  });
  return payload;
}

function compactLocalCommandDetail(value: string | undefined, maxLength = 140): string | undefined {
  const compacted = value?.replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3)}...`
    : compacted;
}

function summarizeLocalCommandChange(before: string, after: string): { changedLines: number; changedBytes: number; detail: string } {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let changedLines = 0;
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      changedLines += 1;
    }
  }
  const changedBytes = Buffer.byteLength(after, 'utf8') - Buffer.byteLength(before, 'utf8');
  const lineDetail = changedLines === 1 ? '1 line changed' : `${changedLines} lines changed`;
  const byteDetail = changedBytes === 0 ? 'same size' : `${changedBytes > 0 ? '+' : ''}${changedBytes} bytes`;
  return { changedLines, changedBytes, detail: `${lineDetail}, ${byteDetail}` };
}

function normalizeLocalCommandRequest(raw: unknown): LocalCommandRunRequest | null {
  if (typeof raw === 'string') {
    const commandName = raw.trim();
    return commandName ? { commandName } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const request = raw as LocalCommandRunRequest;
  const commandName = typeof request.commandName === 'string' ? request.commandName.trim() : undefined;
  const customInstruction = typeof request.customInstruction === 'string' ? request.customInstruction.trim() : undefined;
  const mode = request.mode === 'selection' ? 'selection' : 'document';
  const selection = request.selection && typeof request.selection === 'object' ? request.selection : null;
  if (!commandName && !customInstruction) return null;
  return {
    commandName,
    customInstruction,
    mode,
    selection,
    useMemory: request.useMemory !== false,
  };
}

function resolveLocalCommandSelection(
  selection: LocalCommandSelectionInput | null | undefined,
  targetContent: string,
): { ok: true; start: number; end: number; text: string } | { ok: false; error: string } {
  if (!selection) return { ok: false, error: 'Select text to improve' };
  if (typeof selection.start === 'number' && typeof selection.end === 'number') {
    const rawStart = Math.min(selection.start, selection.end);
    const rawEnd = Math.max(selection.start, selection.end);
    const start = Math.max(0, Math.min(rawStart, targetContent.length));
    const end = Math.max(start, Math.min(rawEnd, targetContent.length));
    const text = targetContent.slice(start, end);
    const expectedText = typeof selection.text === 'string' ? selection.text : '';
    if (start === end || text.trim().length === 0) {
      if (expectedText.trim().length > 0) return resolveLocalCommandSelection({ text: expectedText }, targetContent);
      return { ok: false, error: 'Select text to improve' };
    }
    if (expectedText && text !== expectedText && text.trim() !== expectedText.trim()) {
      return resolveLocalCommandSelection({ text: expectedText }, targetContent);
    }
    return { ok: true, start, end, text };
  }

  if (typeof selection.text !== 'string' || selection.text.trim().length === 0) {
    return { ok: false, error: 'Select text to improve' };
  }
  const first = targetContent.indexOf(selection.text);
  if (first < 0) return { ok: false, error: 'Selected text is not in the current document' };
  const second = targetContent.indexOf(selection.text, first + selection.text.length);
  if (second >= 0) {
    return { ok: false, error: 'Selected text appears more than once. Use Markdown edit mode to improve the exact selection.' };
  }
  return { ok: true, start: first, end: first + selection.text.length, text: selection.text };
}

async function ensureLocalImproveCommand(): Promise<PortableCommand | null> {
  if (!commandsManager) return null;
  const existing = commandsManager.getCommand('improve');
  if (existing) return existing;
  const defaultDir = await commandsManager.createDefaultDirectory();
  if (!defaultDir) return null;
  const created = commandsManager.createCommand(defaultDir, 'improve', DEFAULT_IMPROVE_COMMAND_CONTENT);
  return created ? commandsManager.getCommand(created.name) : commandsManager.getCommand('improve');
}

async function copySelectedTextFromFrontmostApp(): Promise<{ text: string; targetApp: { bundleId: string; name: string } | null }> {
  const target = nativeHelper?.getFrontmostApp() ?? null;
  const targetApp = target?.bundleId
    ? { bundleId: target.bundleId, name: target.name ?? target.bundleId }
    : null;

  try {
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'], { timeout: 3000 });
  } catch (error) {
    log.warn('Global improve could not copy selected text:', error);
    return { text: '', targetApp };
  }
  await new Promise(resolve => setTimeout(resolve, 80));
  return { text: clipboard.readText().trim(), targetApp };
}

async function pasteTextToGlobalImproveTarget(text: string, targetApp: { bundleId: string; name: string } | null): Promise<boolean> {
  if (!text) return false;
  clipboard.writeText(text);
  clipboardManager?.syncClipboardHash();
  return activateAndPaste(targetApp, {
    clipboardTrace: () => ({ textLength: clipboard.readText().length }),
  });
}

async function runGlobalImproveSelection(): Promise<void> {
  if (globalImproveInFlight) return;
  globalImproveInFlight = true;
  try {
    if (!commandsManager) {
      cursorStatusManager?.showNoTargetError('Maxwell is not ready');
      return;
    }
    const { text, targetApp } = await copySelectedTextFromFrontmostApp();
    if (!text) {
      cursorStatusManager?.showNoTargetError('Select text to improve');
      return;
    }

    const command = await ensureLocalImproveCommand();
    if (!command) {
      cursorStatusManager?.showNoTargetError('Improve command not found');
      return;
    }
    const loaded = await commandsManager.loadCommandContent(command);
    if (!loaded) {
      cursorStatusManager?.showNoTargetError('Improve command could not be loaded');
      return;
    }

    emitLocalCommandStatus({
      status: 'running',
      message: 'Improving selected text locally...',
      commandName: loaded.name,
      mode: 'selection',
      phase: 'generating',
    });

    const localManager = getLocalLlmManager();
    const replacement = await localManager.runSelectionCommand({
      commandName: loaded.name,
      commandContent: loaded.content,
      targetTitle: targetApp?.name ?? 'Selected text',
      targetPath: targetApp?.bundleId ?? 'global-selection',
      targetContent: text,
      selectedText: text,
      memorySnapshot: readMaxwellMemorySnapshot(true),
    }, {
      onProgress: (event) => {
        emitLocalCommandStatus({
          status: 'running',
          message: event.message,
          detail: compactLocalCommandDetail(event.detail),
          eventKind: event.kind,
          commandName: loaded.name,
          mode: 'selection',
          phase: event.phase ?? 'generating',
        });
      },
    });

    const targetIsFieldTheory = isFieldTheoryBundleId(targetApp?.bundleId);
    const pasted = targetIsFieldTheory
      ? await replaceSelectedTextInFieldTheoryMarkdown({
        expectedText: text,
        replacementText: replacement,
      })
      : await pasteTextToGlobalImproveTarget(replacement, targetApp);
    if (!pasted) {
      if (targetIsFieldTheory) {
        clipboard.writeText(replacement);
        clipboardManager?.syncClipboardHash();
      }
      cursorStatusManager?.showNoTargetError('Improved text copied; paste failed');
      emitLocalCommandStatus({
        status: 'error',
        message: 'Improved text copied; paste failed',
        commandName: loaded.name,
        mode: 'selection',
        error: 'Paste failed',
      });
      return;
    }

    const changeSummary = summarizeLocalCommandChange(text, replacement);
    await quotaManager?.updateUsage('portable_commands', 1);
    metricsManager?.recordCommandExecuted();
    emitLocalCommandStatus({
      status: 'success',
      message: 'Improved selected text',
      detail: changeSummary.detail,
      eventKind: 'file_change',
      commandName: loaded.name,
      mode: 'selection',
      phase: 'done',
      changedLines: changeSummary.changedLines,
      changedBytes: changeSummary.changedBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Global improve failed';
    log.error('Global improve failed:', error);
    cursorStatusManager?.showNoTargetError(message);
    emitLocalCommandStatus({
      status: 'error',
      message,
      commandName: 'improve',
      mode: 'selection',
      error: message,
    });
  } finally {
    globalImproveInFlight = false;
  }
}

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

function canUseSharedFeatures(): boolean {
  return authManager?.isAuthenticated() ?? false;
}

function fieldTheorySyncDisabledError(): string {
  const status = getFieldTheorySyncStatus();
  if (status.reason === 'not_authenticated') return 'Not authenticated';
  return 'Field Theory sync is not enabled for this user';
}

function sharedFeaturesDisabledError(): string {
  return canUseSharedFeatures() ? 'River is not available' : 'Not authenticated';
}

function refreshFieldTheorySyncServices(): void {
  if (!canUseSharedFeatures()) {
    clearPendingSharedFilesSync();
    void sharedSyncService?.dispose();
    sharedSyncService = null;
    sharedTeamService = null;
  } else {
    if (!sharedTeamService && authManager) {
      sharedTeamService = new SharedTeamService(authManager);
    }
    if (!sharedSyncService && authManager) {
      sharedSyncService = new SharedSyncService(authManager, sharedTeamService ?? undefined);
      sharedSyncService.on('presenceChanged', broadcastSharedFilePresence);
      sharedSyncService.on('pinsChanged', broadcastSharedFilePinsChanged);
      sharedSyncService.on('cacheChanged', () => {
        librarianManager?.emit('library:changed');
      });
    }
    void sharedSyncService?.startRemoteChangeSync();
  }

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

function clearPendingSharedFilesSync(): void {
  if (!sharedFilesSyncTimeout) return;
  clearTimeout(sharedFilesSyncTimeout);
  sharedFilesSyncTimeout = null;
}

function scheduleLibrarySyncIfAllowed(): void {
  refreshFieldTheorySyncServices();
  if (canUseFieldTheorySync()) {
    librarySyncService?.scheduleSync();
  }
  if (canUseSharedFeatures()) {
    scheduleSharedFilesSyncAndBroadcastChanges();
  }
}

function scheduleSharedFilesSyncAndBroadcastChanges(): void {
  if (sharedFilesSyncTimeout) {
    clearTimeout(sharedFilesSyncTimeout);
  }
  sharedFilesSyncTimeout = setTimeout(() => {
    sharedFilesSyncTimeout = null;
    void syncSharedFilesAndBroadcastChanges();
  }, SHARED_FILES_SYNC_DEBOUNCE_MS);
}

async function syncSharedFilesAndBroadcastChanges(): Promise<void> {
  if (!sharedSyncService) return;
  try {
    const result = await sharedSyncService.syncOnce();
    if (result.written > 0 || result.removed > 0 || result.created > 0) {
      librarianManager?.emit('library:changed');
    }
    broadcastSharedFilePinsChanged();
  } catch (err) {
    log.warn('River sync failed:', err);
  }
}

function broadcastSharedFilePresence(payload: { sharedId: string; users: SharedFilePresenceUser[] }): void {
  browserHelperServer?.emitNativeEvent({ type: 'sharedFiles:presenceChanged', payload });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('sharedFiles:presenceChanged', payload);
    }
  });
}

function broadcastSharedFilePinsChanged(): void {
  browserHelperServer?.emitNativeEvent({ type: 'sharedFiles:pinsChanged' });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('sharedFiles:pinsChanged');
    }
  });
}

function broadcastTeamChanged(): void {
  browserHelperServer?.emitNativeEvent({ type: 'team:changed' });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('team:changed');
    }
  });
}

async function afterTeamMutation(result: Promise<SharedTeamMutationResult>): Promise<SharedTeamMutationResult> {
  const resolved = await result;
  if (resolved.ok) {
    broadcastTeamChanged();
    refreshFieldTheorySyncServices();
    void syncSharedFilesAndBroadcastChanges();
  }
  return resolved;
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

function getLocalLlmManager(): LocalLlmManager {
  if (!localLlmManager) {
    localLlmManager = new LocalLlmManager();
  }
  return localLlmManager;
}

function getMaxwellRunManager(): MaxwellRunManager {
  if (!maxwellRunManager) {
    maxwellRunManager = new MaxwellRunManager();
  }
  const dbPath = userDataManager?.isLoggedIn()
    ? userDataManager.getUserDataPath('maxwell.db')
    : path.join(app.getPath('userData'), 'maxwell.db');
  maxwellRunManager.setDatabasePath(dbPath);
  return maxwellRunManager;
}

function resolveDefaultCodexTerminalCwd(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'mac-app') {
    const parent = path.dirname(cwd);
    if (fs.existsSync(path.join(parent, '.git'))) return parent;
  }
  return fs.existsSync(cwd) ? cwd : os.homedir();
}

function getCodexTerminalManager(): CodexTerminalManager {
  if (!codexTerminalManager) {
    codexTerminalManager = new CodexTerminalManager({
      defaultCwd: resolveDefaultCodexTerminalCwd(),
    });
  }
  return codexTerminalManager;
}

function broadcastCodexTerminalSessions(manager = getCodexTerminalManager()): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(CodexTerminalIPCChannels.SESSIONS_CHANGED, manager.listSessions());
    }
  });
}

function getQuitBlockingActivities() {
  return collectQuitBlockingActivities({
    transcriptionStatus: transcriberManager?.getStatus() ?? 'idle',
    hotMicActive: hotMicManager?.isActive ?? false,
    localLlmActive: localLlmManager?.isRunning() ?? false,
    agentRunCount: agentKickoffManager?.getInFlightCount() ?? 0,
    codexTerminalSessions: codexTerminalManager?.listSessions() ?? [],
  });
}

function broadcastMeetingStatus(status: MeetingSession): void {
  browserHelperServer?.emitNativeEvent({ type: 'meetings:status', session: status });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('meetings:status', status);
    }
  });
}

function getMeetingManager(): MeetingManager {
  if (meetingManager) return meetingManager;
  if (!librarianManager || !transcriberManager) {
    throw new Error('Field Theory meetings are not ready');
  }

  meetingManager = new MeetingManager({
    librarian: librarianManager,
    transcriber: transcriberManager,
    localLlm: getLocalLlmManager(),
    getMeetingSummaryPrompt: () => preferencesManager?.getPreference('meetingSummaryPrompt') || DEFAULT_MEETING_SUMMARY_PROMPT,
    getMaxwellRunManager,
    readMemorySnapshot: () => readMaxwellMemorySnapshot(true),
    canWrite: canWriteFieldTheoryContent,
    onBlockedWrite: () => blockWrite(),
  });
  meetingManager.on('status', (status: MeetingSession) => {
    if (status.status === 'idle') {
      if (status.type === 'wiki' && status.relPath) {
        recordRecentEntry({ kind: 'wiki', path: status.relPath, title: status.title, lastOpenedAt: Date.now() });
      } else if (status.type === 'external') {
        recordRecentExternalDocument(status.filePath, status.title);
      }
    }
    broadcastMeetingStatus(status);
  });
  meetingManager.on('summary-progress', (event: LocalLlmProgressEvent & { filePath?: string; runId?: string }) => {
    const isDone = event.phase === 'done';
    const isError = event.kind === 'error' || event.phase === 'error';
    emitLocalCommandStatus({
      status: isDone ? 'success' : isError ? 'error' : 'running',
      message: event.message,
      detail: compactLocalCommandDetail(event.detail),
      eventKind: event.kind,
      commandName: 'summarize-meeting',
      filePath: event.filePath,
      mode: 'document',
      runId: event.runId,
      phase: event.phase ?? 'generating',
      error: isError ? event.message : undefined,
    });
  });
  return meetingManager;
}

const MAXWELL_MEMORY_MAX_CHARS = 12_000;

function getMaxwellMemoryPath(): string {
  return userDataManager?.isLoggedIn()
    ? userDataManager.getUserDataPath(path.join('maxwell', 'memory.md'))
    : path.join(app.getPath('userData'), 'maxwell', 'memory.md');
}

function isMaxwellMemoryEnabled(): boolean {
  return preferencesManager?.getPreference('maxwellMemoryEnabled') !== false;
}

function getMaxwellMemoryState(): MaxwellMemoryState {
  const memoryPath = getMaxwellMemoryPath();
  try {
    const stat = fs.existsSync(memoryPath) ? fs.statSync(memoryPath) : null;
    const content = stat ? fs.readFileSync(memoryPath, 'utf8') : '';
    return {
      enabled: isMaxwellMemoryEnabled(),
      content,
      path: memoryPath,
      updatedAt: stat?.mtimeMs ?? null,
      maxChars: MAXWELL_MEMORY_MAX_CHARS,
    };
  } catch (error) {
    log.warn('Could not read Maxwell memory:', error);
    return {
      enabled: isMaxwellMemoryEnabled(),
      content: '',
      path: memoryPath,
      updatedAt: null,
      maxChars: MAXWELL_MEMORY_MAX_CHARS,
    };
  }
}

function readMaxwellMemorySnapshot(useMemory = true): string | null {
  if (!useMemory || !isMaxwellMemoryEnabled()) return null;
  const memory = getMaxwellMemoryState().content.trim();
  if (!memory) return null;
  if (memory.length <= MAXWELL_MEMORY_MAX_CHARS) return memory;
  return `${memory.slice(0, MAXWELL_MEMORY_MAX_CHARS).trimEnd()}\n\n[Maxwell memory truncated to ${MAXWELL_MEMORY_MAX_CHARS} characters for this run.]`;
}

function summarizeMaxwellRun(run: MaxwellRunRecord): MaxwellRunSummary {
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    commandName: run.commandName,
    targetPath: run.targetPath,
    targetRelPath: run.targetRelPath,
    targetType: run.targetType,
    mode: run.mode,
    summary: run.summary,
    errorMessage: run.errorMessage,
    model: run.model,
    harness: run.harness,
    memoryUsed: !!run.memorySnapshot,
    canUndo: run.status === 'success' && !!run.postVersion && run.postContent !== null,
    canRedo: run.status === 'reverted' && !!run.revertVersion && run.postContent !== null,
  };
}

function emitMaxwellUndoFailure(
  reason: MaxwellUndoFailureReason,
  error: string,
  run?: MaxwellRunRecord | null,
): MaxwellUndoResult {
  emitLocalCommandStatus({
    status: 'error',
    message: error,
    commandName: run?.commandName,
    filePath: run?.targetPath,
    mode: run?.mode,
    runId: run?.runId,
    error,
  });
  return {
    success: false,
    reason,
    error,
    run: run ? summarizeMaxwellRun(run) : undefined,
  };
}

function emitMaxwellRedoFailure(
  reason: MaxwellRedoFailureReason,
  error: string,
  run?: MaxwellRunRecord | null,
): MaxwellRedoResult {
  emitLocalCommandStatus({
    status: 'error',
    message: error,
    commandName: run?.commandName,
    filePath: run?.targetPath,
    mode: run?.mode,
    runId: run?.runId,
    error,
  });
  return {
    success: false,
    reason,
    error,
    run: run ? summarizeMaxwellRun(run) : undefined,
  };
}

function emitMaxwellCancelFailure(error: string, run?: MaxwellRunRecord | null): MaxwellCancelResult {
  return {
    success: false,
    error,
    run: run ? summarizeMaxwellRun(run) : undefined,
  };
}

function listNativeMaxwellRuns(rawLimit?: unknown): MaxwellRunSummary[] {
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : 20;
  try {
    return getMaxwellRunManager().listRuns(limit).map(summarizeMaxwellRun);
  } catch (error) {
    log.warn('Could not list Maxwell runs:', error);
    return [];
  }
}

async function saveNativeMaxwellMemory(rawRequest: unknown): Promise<MaxwellMemorySaveResult> {
  if (!rawRequest || typeof rawRequest !== 'object') {
    return { success: false, error: 'Invalid Maxwell memory request' };
  }
  const request = rawRequest as { enabled?: unknown; content?: unknown };
  const content = typeof request.content === 'string' ? request.content : '';
  const enabled = request.enabled !== false;
  if (content.length > MAXWELL_MEMORY_MAX_CHARS) {
    return {
      success: false,
      error: `Maxwell memory is too large (${content.length} characters, limit ${MAXWELL_MEMORY_MAX_CHARS}).`,
      memory: getMaxwellMemoryState(),
    };
  }
  try {
    const memoryPath = getMaxwellMemoryPath();
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, content, 'utf8');
    await preferencesManager?.save({ maxwellMemoryEnabled: enabled });
    return { success: true, memory: getMaxwellMemoryState() };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save Maxwell memory';
    log.warn('Could not save Maxwell memory:', error);
    return { success: false, error: message, memory: getMaxwellMemoryState() };
  }
}

function cancelNativeMaxwellRun(rawRunId: unknown): MaxwellCancelResult {
  if (typeof rawRunId !== 'string' || !rawRunId.trim()) {
    return emitMaxwellCancelFailure('Invalid Maxwell run id');
  }
  const runId = rawRunId.trim();
  const manager = getMaxwellRunManager();
  const run = manager.getRun(runId);
  if (!run) {
    return emitMaxwellCancelFailure('Maxwell run not found');
  }
  if (activeMaxwellLocalRun?.runId !== runId) {
    return emitMaxwellCancelFailure('Maxwell run is not active', run);
  }
  activeMaxwellLocalRun.cancelled = true;
  getLocalLlmManager().stop();
  const cancelled = manager.markError(runId, 'cancelled', 'Maxwell run cancelled') ?? run;
  emitLocalCommandStatus({
    status: 'notice',
    message: 'Maxwell run cancelled',
    commandName: run.commandName,
    filePath: run.targetPath,
    mode: run.mode,
    runId,
    phase: 'cancelled',
  });
  return {
    success: true,
    run: summarizeMaxwellRun(cancelled),
  };
}

function undoNativeMaxwellRun(rawRunId: unknown): MaxwellUndoResult {
  if (!librarianManager) {
    return emitMaxwellUndoFailure('not-ready', 'Field Theory library is not ready');
  }
  if (!canWriteFieldTheoryContent()) {
    blockWrite();
    return emitMaxwellUndoFailure('blocked', 'Field Theory is read-only');
  }
  const runId = typeof rawRunId === 'string' ? rawRunId.trim() : '';
  if (!runId) {
    return emitMaxwellUndoFailure('not-found', 'Maxwell run not found');
  }

  const manager = getMaxwellRunManager();
  const run = manager.getRun(runId);
  if (!run) {
    return emitMaxwellUndoFailure('not-found', 'Maxwell run not found');
  }

  let currentVersion: DocumentVersion;
  let currentContent: string;
  try {
    currentVersion = readDocumentVersion(run.targetPath);
    currentContent = fs.readFileSync(run.targetPath, 'utf-8');
  } catch {
    return emitMaxwellUndoFailure('not-found', 'Current document no longer exists', run);
  }

  const undo = manager.prepareUndo(runId, currentVersion, currentContent);
  if (!undo.ok) {
    const error = undo.reason === 'conflict'
      ? 'Current document changed since Maxwell saved this result'
      : 'This Maxwell run cannot be undone';
    return emitMaxwellUndoFailure(undo.reason, error, undo.run ?? run);
  }

  const saveResult = undo.targetType === 'wiki'
    ? undo.targetRelPath
      ? librarianManager.saveWikiPage(undo.targetRelPath, undo.preContent, undo.expectedVersion)
      : { ok: false as const, reason: 'not-found' as const }
    : librarianManager.saveReading(undo.targetPath, undo.preContent, undo.expectedVersion);

  if (!saveResult.ok) {
    const error = saveResult.reason === 'conflict'
      ? 'Current document changed while Maxwell was undoing this run'
      : `Could not undo Maxwell run: ${saveResult.reason}`;
    return emitMaxwellUndoFailure(saveResult.reason === 'conflict' ? 'conflict' : 'save-error', error, run);
  }

  const reverted = manager.markReverted(runId, saveResult.version) ?? run;
  emitLocalCommandStatus({
    status: 'success',
    message: `Undid ${run.commandName}`,
    detail: 'Restored previous document version',
    eventKind: 'file_change',
    commandName: run.commandName,
    filePath: run.targetPath,
    mode: run.mode,
    runId,
    phase: 'done',
  });
  return {
    success: true,
    run: summarizeMaxwellRun(reverted),
    filePath: run.targetPath,
    commandName: run.commandName,
  };
}

function redoNativeMaxwellRun(rawRunId: unknown): MaxwellRedoResult {
  if (!librarianManager) {
    return emitMaxwellRedoFailure('not-ready', 'Field Theory library is not ready');
  }
  if (!canWriteFieldTheoryContent()) {
    blockWrite();
    return emitMaxwellRedoFailure('blocked', 'Field Theory is read-only');
  }
  const runId = typeof rawRunId === 'string' ? rawRunId.trim() : '';
  if (!runId) {
    return emitMaxwellRedoFailure('not-found', 'Maxwell run not found');
  }

  const manager = getMaxwellRunManager();
  const run = manager.getRun(runId);
  if (!run) {
    return emitMaxwellRedoFailure('not-found', 'Maxwell run not found');
  }

  let currentVersion: DocumentVersion;
  let currentContent: string;
  try {
    currentVersion = readDocumentVersion(run.targetPath);
    currentContent = fs.readFileSync(run.targetPath, 'utf-8');
  } catch {
    return emitMaxwellRedoFailure('not-found', 'Current document no longer exists', run);
  }

  const redo = manager.prepareRedo(runId, currentVersion, currentContent);
  if (!redo.ok) {
    const error = redo.reason === 'conflict'
      ? 'Current document changed since Maxwell was undone'
      : 'This Maxwell run cannot be redone';
    return emitMaxwellRedoFailure(redo.reason, error, redo.run ?? run);
  }

  const saveResult = redo.targetType === 'wiki'
    ? redo.targetRelPath
      ? librarianManager.saveWikiPage(redo.targetRelPath, redo.postContent, redo.expectedVersion)
      : { ok: false as const, reason: 'not-found' as const }
    : librarianManager.saveReading(redo.targetPath, redo.postContent, redo.expectedVersion);

  if (!saveResult.ok) {
    const error = saveResult.reason === 'conflict'
      ? 'Current document changed while Maxwell was redoing this run'
      : `Could not redo Maxwell run: ${saveResult.reason}`;
    return emitMaxwellRedoFailure(saveResult.reason === 'conflict' ? 'conflict' : 'save-error', error, run);
  }

  const redone = manager.markRedone(runId, saveResult.version) ?? run;
  emitLocalCommandStatus({
    status: 'success',
    message: `Redid ${run.commandName}`,
    detail: 'Reapplied Maxwell result',
    eventKind: 'file_change',
    commandName: run.commandName,
    filePath: run.targetPath,
    mode: run.mode,
    runId,
    phase: 'done',
  });
  return {
    success: true,
    run: summarizeMaxwellRun(redone),
    filePath: run.targetPath,
    commandName: run.commandName,
  };
}

function isActiveMaxwellRunCancelled(runId: string | undefined): boolean {
  return !!runId && activeMaxwellLocalRun?.runId === runId && activeMaxwellLocalRun.cancelled;
}

function getLocalLlmSetupScriptPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'scripts', 'setup-gemma.sh'),
    path.join(app.getAppPath(), 'scripts', 'setup-gemma.sh'),
    path.join(process.cwd(), 'scripts', 'setup-gemma.sh'),
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

async function installOrAccessLocalLlmModel(model: string): Promise<{ success: boolean; error?: string; modelPath?: string; reusedExisting?: boolean }> {
  const manager = getLocalLlmManager();
  if (!isLocalLlmModelId(model)) {
    return { success: false, error: 'Unsupported local model.' };
  }

  const selected = manager.setSelectedModel(model);
  if (!selected.success) return selected;

  const modelId = model as LocalLlmModelId;
  const currentHealth = manager.getModelHealth(modelId);
  if (currentHealth.status === 'ready') {
    return {
      success: true,
      modelPath: currentHealth.modelPath,
      reusedExisting: true,
    };
  }

  if (localLlmInstallInFlight) return localLlmInstallInFlight;

  localLlmInstallInFlight = (async () => {
    try {
      const setupScript = getLocalLlmSetupScriptPath();
      if (!setupScript) {
        return { success: false, error: 'Gemma setup script was not found.' };
      }

      const installPath = manager.getDefaultInstallPath(modelId);
      fs.mkdirSync(path.dirname(installPath), { recursive: true });

      const result = await execFileAsync('bash', [setupScript], {
        cwd: app.getAppPath(),
        timeout: 60 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? ''].filter(Boolean).join(':'),
          FT_LOCAL_LLM_MODEL_PATH: installPath,
          FT_GEMMA_MODEL_ID: modelId,
          FT_GEMMA_REUSE_EXISTING: '1',
        },
      });
      const health = manager.getModelHealth(modelId);
      if (health.status === 'ready') {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        return {
          success: true,
          modelPath: health.modelPath,
          reusedExisting: /already present|linking|existing model/i.test(output),
        };
      }
      return {
        success: false,
        error: `Gemma setup finished, but the model is still ${health.status}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gemma setup failed.';
      log.error('Local Gemma setup failed:', error);
      return { success: false, error: message };
    } finally {
      localLlmInstallInFlight = null;
    }
  })();

  return localLlmInstallInFlight;
}

function openScratchpadDefaultFromHotkey(): WikiPage | null {
  if (!librarianManager) return null;
  if (!canWriteFieldTheoryContent()) {
    blockWrite();
    return null;
  }

  const now = Date.now();
  if (now - lastScratchpadOpenAt < 750) return null;
  lastScratchpadOpenAt = now;

  const page = librarianManager.createScratchpadDefault();
  if (!page) return null;
  recordRecentWikiPage(page);
  if (emitBrowserLibraryNavigationEvent({ type: 'wiki:openScratchpad', relPath: page.relPath }, { broadcastFallback: false })) {
    return page;
  }
  const existingClipboardHistoryWindow = clipboardHistoryWindow?.getWindow();
  const hasExistingClipboardHistoryWindow = Boolean(
    existingClipboardHistoryWindow && !existingClipboardHistoryWindow.isDestroyed()
  );
  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }
  const boundsToUse = hasExistingClipboardHistoryWindow ? undefined : restoreClipboardHistoryBounds('library');
  suspendDynamicIslandFocusForClipboardHistory('show-scratchpad-hotkey');
  clipboardHistoryWindow.showLibrary(boundsToUse);
  clipboardHistoryWindow.openScratchpad({
    relPath: page.relPath,
  });
  return page;
}

function broadcastRecentChanged(entries?: RecentEntry[]): void {
  browserHelperServer?.emitNativeEvent({ type: 'recent:changed', entries });
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('recent:changed', entries);
  });
}

function recordRecentEntry(entry: RecentEntry): void {
  if (!recentManager) return;
  recentManager.visit(entry);
  broadcastRecentChanged();
}

function recordRecentWikiPage(page: Pick<WikiPage, 'relPath' | 'title'> | null): void {
  if (!page) return;
  recordRecentEntry({
    kind: 'wiki',
    path: page.relPath,
    title: page.title,
    lastOpenedAt: Date.now(),
  });
}

function recordRecentExternalDocument(absPath: string | null | undefined, title: string | null | undefined): void {
  if (!absPath || !isLibraryTextDocumentPath(absPath)) return;
  let canonical = absPath;
  try {
    canonical = fs.realpathSync(absPath);
  } catch {
    // The file may have just been reported by a watcher; keep the given path.
  }
  recordRecentEntry({
    kind: 'external',
    path: canonical,
    title: title?.trim() || stripMarkdownFileExtension(path.basename(canonical)),
    lastOpenedAt: Date.now(),
  });
}

function loadMarkdownPreview(filePath: string): { title: string; filePath: string; content: string } | null {
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
}

function recordRecentCreatedLibraryPage(page: WikiPage | null, rootPath: string): void {
  if (!page) return;
  const root = librarianManager?.getLibraryRoots().find((candidate) => (
    path.resolve(candidate.path) === path.resolve(rootPath)
  ));
  if (root?.builtin) {
    recordRecentWikiPage(page);
    return;
  }
  recordRecentExternalDocument(page.absPath, page.title);
}

function rememberCommandTargetApp(appInfo: { bundleId?: string | null; name?: string | null } | null | undefined): void {
  if (!appInfo?.bundleId || !appInfo.name || !isExternalCommandTargetBundleId(appInfo.bundleId)) {
    return;
  }

  lastExternalCommandTargetApp = {
    bundleId: appInfo.bundleId,
    name: appInfo.name,
  };
}

function getCommandLauncherTargetApp(): { bundleId: string; name: string } | null {
  const previousApp = commandLauncherWindow?.getPreviousApp() ?? null;
  if (previousApp?.bundleId && isExternalCommandTargetBundleId(previousApp.bundleId)) {
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
  return lastExternalCommandTargetApp?.bundleId && isExternalCommandTargetBundleId(lastExternalCommandTargetApp.bundleId)
    ? lastExternalCommandTargetApp
    : null;
}

function getCommandLauncherInvocationTarget(targetApp: { bundleId: string; name: string } | null) {
  return resolveCommandLauncherInvocationTarget({
    fieldTheoryActive: commandLauncherWindow?.wasFieldTheoryActiveOnShow() ?? false,
    hasFocusedFieldTheoryTerminal: Boolean(focusedCodexTerminalLauncherSessionId),
    hasActiveFieldTheoryMarkdown: hasActiveFieldTheoryMarkdownInsertionTarget(),
    hasExternalTargetApp: Boolean(targetApp),
  });
}

let visibilityAppTraceInstalled = false;

function getBrowserWindowVisibilitySnapshot(window: BrowserWindow): Record<string, unknown> {
  if (window.isDestroyed()) {
    return {
      id: window.id,
      destroyed: true,
    };
  }

  return {
    id: window.id,
    title: window.getTitle(),
    visible: window.isVisible(),
    focused: window.isFocused(),
    minimized: window.isMinimized(),
    bounds: window.getBounds(),
  };
}

function appendAppVisibilityTrace(event: string, data: Record<string, unknown> = {}): void {
  if (!isVisibilityTraceEnabled()) return;
  appendVisibilityTrace(event, {
    hidden: process.platform === 'darwin' ? app.isHidden() : null,
    focusedWindowId: BrowserWindow.getFocusedWindow()?.id ?? null,
    mode: preferencesManager ? getFieldTheoryWindowMode() : null,
    clipboardVisible: clipboardHistoryWindow?.isVisible() ?? null,
    clipboardShowing: clipboardHistoryWindow?.isShowing() ?? null,
    windows: BrowserWindow.getAllWindows().map(getBrowserWindowVisibilitySnapshot),
    ...data,
  });
}

function installAppVisibilityTrace(): void {
  if (!isVisibilityTraceEnabled()) return;
  if (visibilityAppTraceInstalled) return;
  visibilityAppTraceInstalled = true;

  app.on('activate', () => appendAppVisibilityTrace('app.activate'));
  app.on('browser-window-focus', (_event, window) => {
    appendAppVisibilityTrace('app.browser-window-focus', {
      window: getBrowserWindowVisibilitySnapshot(window),
    });
  });
  app.on('browser-window-blur', (_event, window) => {
    appendAppVisibilityTrace('app.browser-window-blur', {
      window: getBrowserWindowVisibilitySnapshot(window),
    });
  });
}

function hideFieldTheoryForAlfred(): void {
  commandLauncherWindow?.hide(true);

  if (!shouldHideFieldTheoryWindowsForAlfred(getFieldTheoryWindowMode())) {
    appendVisibilityTrace('main.alfred-hide.skipped-app-mode', {
      mode: getFieldTheoryWindowMode(),
      clipboardVisible: clipboardHistoryWindow?.isVisible() ?? null,
      clipboardShowing: clipboardHistoryWindow?.isShowing() ?? null,
      mainVisible: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isVisible() : null,
    });
    return;
  }

  appendVisibilityTrace('main.alfred-hide.begin', {
    mode: getFieldTheoryWindowMode(),
    clipboardVisible: clipboardHistoryWindow?.isVisible() ?? null,
    clipboardShowing: clipboardHistoryWindow?.isShowing() ?? null,
    mainVisible: mainWindow && !mainWindow.isDestroyed() ? mainWindow.isVisible() : null,
  });

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
  const engine = transcriberManager.getConfiguredTranscriptionEngine();
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

function normalizeRecordingIndicatorMode(value: unknown): RecordingIndicatorMode {
  return value === 'notch' || value === 'floating' || value === 'auto' ? value : 'auto';
}

function normalizeFloatingIndicatorPosition(value: unknown): FloatingIndicatorPosition | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as Partial<FloatingIndicatorPosition>;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return {
    x: Math.round(position.x as number),
    y: Math.round(position.y as number),
  };
}

function getRecordingIndicatorModeFromPreferences(): RecordingIndicatorMode {
  return normalizeRecordingIndicatorMode(preferencesManager?.getPreference('recordingIndicatorMode'));
}

function getFloatingIndicatorPositionFromPreferences(): FloatingIndicatorPosition | null {
  return normalizeFloatingIndicatorPosition(preferencesManager?.getPreference('floatingIndicatorPosition'));
}

function sameFloatingIndicatorPosition(
  left: FloatingIndicatorPosition | null,
  right: FloatingIndicatorPosition | null
): boolean {
  if (left === null || right === null) return left === right;
  return left.x === right.x && left.y === right.y;
}

function applyFloatingIndicatorPositionFromPreferences(): FloatingIndicatorPosition | null {
  const stored = getFloatingIndicatorPositionFromPreferences();
  const applied = dynamicIslandManager?.setFloatingPosition(stored) ?? stored;
  if (!sameFloatingIndicatorPosition(stored, applied)) {
    void preferencesManager?.save({ floatingIndicatorPosition: applied });
  }
  return applied;
}

function applyDynamicIslandPreferencesFromPreferences(): void {
  if (!dynamicIslandManager) return;
  const hotMicEnabled = preferencesManager?.getPreference('hotMicEnabled') ?? false;
  dynamicIslandManager.setInputMode(resolveInputModeFromHotMicEnabled(hotMicEnabled));
  dynamicIslandManager.setGeometryTuning(getHotMicIslandGeometryFromPreferences());
  dynamicIslandManager.setDrawerTextSize(getHotMicDrawerTextSizeFromPreferences());
  dynamicIslandManager.setStayOnLaptop(preferencesManager?.getPreference('hotMicIslandStayOnLaptop') ?? false);
  dynamicIslandManager.setRecordingIndicatorMode(getRecordingIndicatorModeFromPreferences());
  applyFloatingIndicatorPositionFromPreferences();
  dynamicIslandManager.setAutoHide(preferencesManager?.getPreference('hotMicIslandAutoHide') ?? false);
}

function enableDynamicIslandFromPreferences(): void {
  if (!dynamicIslandManager) return;
  applyDynamicIslandPreferencesFromPreferences();
  if (clipboardManager) {
    dynamicIslandManager.setClipboardManager(clipboardManager);
  }
  dynamicIslandManager.setEnabled(true);
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
type PendingUpdateStatus = Extract<UpdateStatus, 'available' | 'downloading' | 'ready' | 'installing'>;

let pendingUpdateInfo: { status: PendingUpdateStatus; version: string } | null = null;

function shouldApplyUpdaterStatus(next: UpdateStatus): boolean {
  const current = pendingUpdateInfo?.status ?? 'idle';
  return resolveUpdaterStatusTransition(current, next) === next;
}

function setPendingUpdateStatus(status: PendingUpdateStatus, version?: string): boolean {
  if (!shouldApplyUpdaterStatus(status)) return false;
  pendingUpdateInfo = { status, version: version ?? pendingUpdateInfo?.version ?? '' };
  return true;
}

function sendUpdateNotAvailable(): void {
  if (!shouldApplyUpdaterStatus('uptodate')) return;
  browserHelperServer?.emitNativeEvent({ type: 'updater:updateNotAvailable' });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:updateNotAvailable');
    }
  });
}

function sendUpdaterErrorMessage(message: string): void {
  if (!shouldApplyUpdaterStatus('error')) return;
  browserHelperServer?.emitNativeEvent({ type: 'updater:error', error: message });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:error', message);
    }
  });
}

function reportAutoUpdaterError(context: string, err: unknown): void {
  const message = formatAutoUpdaterErrorMessage(err);
  log.error('%s: %s', context, message);
  sendUpdaterErrorMessage(message);
}

function checkForAppUpdates(): unknown {
  if (!isAutoUpdaterEnabled) return undefined;
  if (app.isPackaged) {
    return getAutoUpdater().checkForUpdates().catch((err) => reportAutoUpdaterError('Update check failed', err));
  }
  sendUpdateNotAvailable();
  return undefined;
}

function downloadAppUpdate(): unknown {
  if (!isAutoUpdaterEnabled) return undefined;
  return getAutoUpdater().downloadUpdate().catch((err) => reportAutoUpdaterError('Update download failed', err));
}

function installAppUpdate(): void {
  if (!isAutoUpdaterEnabled) return;
  if (pendingUpdateInfo && !setPendingUpdateStatus('installing')) return;
  browserHelperServer?.emitNativeEvent({ type: 'updater:installing' });
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:installing');
    }
  });
  setTimeout(() => {
    try {
      appQuitConfirmedWithLocalWork = true;
      getAutoUpdater().quitAndInstall(false, true);
    } catch (err) {
      appQuitConfirmedWithLocalWork = false;
      reportAutoUpdaterError('Update install failed', err);
    }
  }, 250);
}

function dismissAppUpdate(): void {
  pendingUpdateInfo = null;
}

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
  if (startupBenchmarkUserData) {
    return;
  }
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
  getHotkeyManager().register('globalImprove', HOTKEY_CONFIGS.globalImprove.defaultKey, () => {
    void runGlobalImproveSelection();
  });

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
          clipboardWindow?.webContents.send('librarian:insertPlainMarkdownText', imagePath);
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
      const launcherSessionId = createLauncherSessionId();
      const launcherVisible = commandLauncherWindow?.isVisible() ?? false;
      const launcherShowingOrVisible = commandLauncherWindow?.isShowingOrVisible() ?? false;
      const immersiveMode = clipboardHistoryWindow?.getImmersiveMode() ?? false;
      const fieldTheoryFocused = clipboardHistoryWindow?.getWindow()?.isFocused() ?? false;

      appendCommandLauncherTrace('hotkey-trigger', {
        launcherSessionId,
        hotkey: commandLauncherHotkey,
        launcherVisible,
        launcherShowingOrVisible,
        immersiveMode,
        fieldTheoryFocused,
      });

      try {
        if (launcherVisible) {
          appendCommandLauncherTrace('hotkey-hide-request', { launcherSessionId });
          commandLauncherWindow?.hide();
          return;
        }

        if (!commandLauncherWindow) {
          appendCommandLauncherTrace('hotkey-show-missing-window', { launcherSessionId });
          return;
        }

        // If immersive view is open behind another app, dismiss it first to avoid
        // z-order conflicts. Keep it in place when Field Theory is the active
        // writing surface so launcher selection can navigate inside the app.
        if (immersiveMode && !fieldTheoryFocused) {
          appendCommandLauncherTrace('hotkey-hide-immersive-window', { launcherSessionId });
          clipboardHistoryWindow?.hide();
        }

        const anchorBounds = fieldTheoryFocused
          ? clipboardHistoryWindow?.getBounds()
          : null;

        const appWindowFocusSuppressed = !fieldTheoryFocused
          && (clipboardHistoryWindow?.temporarilyDisableAppWindowFocus('command-launcher-show') ?? false);

        appendCommandLauncherTrace('hotkey-show-request', {
          launcherSessionId,
          anchor: anchorBounds ? 'field-theory-window' : 'frontmost-window',
          appWindowFocusSuppressed,
        });
        await commandLauncherWindow.show({ anchorBounds, launcherSessionId });
        appendCommandLauncherTrace('hotkey-show-complete', {
          launcherSessionId,
          launcherVisible: commandLauncherWindow.isVisible(),
          launcherShowingOrVisible: commandLauncherWindow.isShowingOrVisible(),
        });
        metricsManager?.recordCommandLauncherUse();
      } catch (error) {
        appendCommandLauncherTrace('hotkey-show-error', { launcherSessionId, error });
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

function setupOnboardingIPCHandlersOnce(): void {
  if (onboardingIPCHandlersInstalled) return;
  setupOnboardingIPCHandlers();
  onboardingIPCHandlersInstalled = true;
}

function setupTranscribeIPCHandlersOnce(): void {
  if (transcribeIPCHandlersInstalled) return;
  setupTranscribeIPCHandlers();
  transcribeIPCHandlersInstalled = true;
}

function setupAppMetadataIPCHandlersOnce(): void {
  if (appMetadataIPCHandlersInstalled) return;
  ipcMain.on('app:getVersion', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.on('updater:isEnabled', (event) => {
    event.returnValue = isAutoUpdaterEnabled;
  });
  ipcMain.handle('updater:getStatus', () => {
    return pendingUpdateInfo;
  });
  appMetadataIPCHandlersInstalled = true;
}

function showEarlyOnboardingIfNeeded(): boolean {
  const prefs = preferencesManager?.get();
  if (prefs?.onboardingComplete) return false;
  if (userDataManager?.isLoggedIn()) return false;
  setupOnboardingIPCHandlersOnce();
  setupTranscribeIPCHandlersOnce();
  onboardingWindow = onboardingWindow ?? createOnboardingWindow();
  onboardingWindow.show(prefs?.onboardingStep ?? OnboardingStep.PERMISSIONS);
  markStartupSurfaceShown(onboardingWindow.getWindow(), 'early-onboarding-window-shown');
  startupMark('early-onboarding-show-called');
  maybeExitStartupBenchmark('early-onboarding-show-called');
  return true;
}

function showEarlyClipboardWindowIfNeeded(): boolean {
  const prefs = preferencesManager?.get();
  const openedAsLoginItem = wasOpenedAsLoginItem();
  if (!shouldShowClipboardWindowOnStartup(prefs?.onboardingComplete, openedAsLoginItem)) {
    return false;
  }
  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }
  const boundsToUse = restoreClipboardHistoryBounds('library');
  suspendDynamicIslandFocusForClipboardHistory('early-startup-show');
  clipboardHistoryWindow.showLibrary(boundsToUse);
  markStartupSurfaceShown(clipboardHistoryWindow.getWindow(), 'early-clipboard-window-shown');
  startupMark('early-clipboard-show-called');
  maybeExitStartupBenchmark('early-clipboard-show-called');
  return true;
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
    window.rememberExternalApp(nativeHelper.getFrontmostApp());
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
  window.setOnDidFinishLoad(() => {
    void hydrateNativeRendererStorageFromBrowserLibraryStore();
  });

  return window;
}

function getLibraryDocumentWindowManager(): LibraryDocumentWindowManager {
  if (!libraryDocumentWindowManager) {
    libraryDocumentWindowManager = new LibraryDocumentWindowManager(
      () => preferencesManager?.get().libraryDocumentWindowBounds,
      (bounds) => {
        preferencesManager?.save({
          libraryDocumentWindowBounds: persistableLibraryDocumentWindowBounds(bounds),
        }).catch((error) => {
          log.error('Failed to save Library document window bounds:', error);
        });
      },
    );
  }
  return libraryDocumentWindowManager;
}

function getDocumentPresenceManager(): DocumentPresenceManager {
  if (!documentPresenceManager) {
    documentPresenceManager = new DocumentPresenceManager();
  }
  return documentPresenceManager;
}

function registerDocumentPresenceWindow(win: BrowserWindow): void {
  if (documentPresenceWindows.has(win)) return;
  documentPresenceWindows.add(win);
  const windowId = String(win.id);
  win.on('focus', () => getDocumentPresenceManager().focusWindow(windowId));
  win.on('closed', () => {
    getDocumentPresenceManager().closeWindow(windowId);
    if (activeLibraryFileContextSourceId === windowId) {
      activeLibraryFileContext = null;
      activeLibraryFileContextSourceId = null;
    }
  });
}

function normalizeLibraryDocumentWindowTarget(target: Partial<LibraryDocumentWindowTarget> | null | undefined): LibraryDocumentWindowTarget | null {
  if (!target || typeof target.path !== 'string' || !target.path.trim()) return null;
  const pathValue = target.path.trim();
  const contentMode = target.contentMode === 'markdown' || target.contentMode === 'typedown' || target.contentMode === 'rendered'
    ? target.contentMode
    : undefined;
  const sidebarCollapsed = target.sidebarCollapsed === true ? true : undefined;

  if (target.kind === 'wiki') {
    return librarianManager?.getWikiPage(pathValue)
      ? { kind: 'wiki', path: pathValue, contentMode, sidebarCollapsed }
      : null;
  }

  if (target.kind === 'artifact') {
    return librarianManager?.getReading(pathValue)
      ? { kind: 'artifact', path: pathValue, contentMode, sidebarCollapsed }
      : null;
  }

  if (target.kind === 'external') {
    try {
      const canonical = fs.realpathSync(pathValue);
      if (!isLibraryTextDocumentPath(canonical)) return null;
      return { kind: 'external', path: canonical, contentMode, sidebarCollapsed };
    } catch {
      return null;
    }
  }

  return null;
}

function getFieldTheoryWindowMode(): FieldTheoryWindowMode {
  return resolveFieldTheoryWindowMode(preferencesManager?.get());
}

function shouldUseClipboardAppWindowMode(): boolean {
  return getFieldTheoryWindowMode() === 'app';
}

function wasOpenedAsLoginItem(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  try {
    const settings = app.getLoginItemSettings();
    return Boolean(settings.wasOpenedAtLogin || settings.wasOpenedAsHidden);
  } catch {
    return false;
  }
}

function showClipboardHistoryOnStartup(): void {
  const prefs = preferencesManager?.get();
  const openedAsLoginItem = wasOpenedAsLoginItem();
  if (!shouldShowClipboardWindowOnStartup(prefs?.onboardingComplete, openedAsLoginItem)) {
    appendVisibilityTrace('app-startup.show-clipboard.skipped', {
      reason: openedAsLoginItem ? 'login-item' : 'onboarding-incomplete',
      onboardingComplete: prefs?.onboardingComplete ?? null,
      openedAsLoginItem,
    });
    return;
  }

  appendVisibilityTrace('app-startup.show-clipboard.action', { action: 'show', initialViewMode: 'library' });
  showClipboardHistoryOnActivate();
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
  const commandLauncherExternalInvocationSuppressed =
    commandLauncherWindow?.isExternalInvocationActivationSuppressed() ?? false;
  const commandLauncherShowingOrVisible = commandLauncherWindow?.isShowingOrVisible() ?? false;
  appendVisibilityTrace('app-activate.show-clipboard.request', {
    mode: preferencesManager ? getFieldTheoryWindowMode() : null,
    initialViewMode: 'library',
    onboardingComplete: prefs?.onboardingComplete ?? null,
    clipboardVisible: clipboardHistoryWindow?.isVisible() ?? null,
    clipboardShowing: clipboardHistoryWindow?.isShowing() ?? null,
    commandLauncherShowingOrVisible,
    commandLauncherExternalInvocationSuppressed,
  });
  const preflightSkipReason = getClipboardHistoryActivationPreflightSkipReason({
    onboardingComplete: prefs?.onboardingComplete === true,
    commandLauncherExternalInvocationSuppressed,
    commandLauncherShowingOrVisible,
  });
  if (preflightSkipReason) {
    appendVisibilityTrace('app-activate.show-clipboard.skipped', { reason: preflightSkipReason });
    return;
  }

  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }

  // If clipboard history is already visible (e.g., immersive mode), don't call show().
  // Calling show() triggers moveTop() which would steal focus from other windows.
  if (clipboardHistoryWindow.isVisible()) {
    appendVisibilityTrace('app-activate.show-clipboard.skipped', { reason: 'already-visible' });
    return;
  }

  if (shouldUseClipboardAppWindowMode() && clipboardHistoryWindow.focusExistingWindow()) {
    appendVisibilityTrace('app-activate.show-clipboard.action', { action: 'focus-existing' });
    cursorStatusManager?.refreshWindowProperties();
    dynamicIslandManager?.refreshWindowProperties('clipboard-history:focus-app-activate');
    return;
  }

  // Show the clipboard window when app is activated (e.g., Dock icon click).
  const boundsToUse = restoreClipboardHistoryBounds('library');
  suspendDynamicIslandFocusForClipboardHistory('show-app-activate');
  appendVisibilityTrace('app-activate.show-clipboard.action', {
    action: 'show',
    initialViewMode: 'library',
    bounds: boundsToUse,
  });
  clipboardHistoryWindow.showLibrary(boundsToUse);
  // Re-assert transparent overlay properties after clipboard window show.
  cursorStatusManager?.refreshWindowProperties();
  dynamicIslandManager?.refreshWindowProperties('clipboard-history:show-app-activate');
}

/** Route an incoming Field Theory document path to the library view. Called from `open-file`
 *  (macOS) and also deferred until the main window exists for cold starts. */
function routeOpenMarkdown(inputPath: string): void {
  const resolved = resolveIncomingMarkdownPath(inputPath, librarianManager?.getWikiRoot() ?? null);
  if (!resolved) {
    log.info(`open-file: ignoring unsupported or unreadable path: ${inputPath}`);
    return;
  }
  const browserHandled = resolved.kind === 'wiki'
    ? emitBrowserLibraryNavigationEvent({ type: 'wiki:openPage', relPath: resolved.relPath }, { broadcastFallback: false })
    : emitBrowserLibraryNavigationEvent({ type: 'external:openPage', absPath: resolved.absPath }, { broadcastFallback: false });
  if (browserHandled) return;
  if (!clipboardHistoryWindow) {
    log.info('open-file: main window not ready, queueing');
    pendingOpenMarkdownPath = inputPath;
    return;
  }
  const boundsToUse = restoreClipboardHistoryBounds('library');
  suspendDynamicIslandFocusForClipboardHistory('show-reading');
  clipboardHistoryWindow.showLibrary(boundsToUse);
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
    await setThemePreferenceAndBroadcast(isDark);
  });
}

async function setThemePreferenceAndBroadcast(isDark: boolean): Promise<void> {
  if (preferencesManager) {
    await preferencesManager.save({ darkMode: isDark });
  }

  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    win.webContents.send('theme:changed', isDark);
  }
  browserHelperServer?.emitNativeEvent({ type: 'theme:changed', isDark });
}

/**
 * Point the tagged-docs scanner/watcher at exactly the directories the user
 * added to their library (left nav). Called whenever that set can change so we
 * only ever scan/watch what the user is actually looking at — never whole
 * cloud-storage trees.
 */
function syncTaggedDocsRootsFromLibrary(): void {
  if (!taggedDocsManager) return;
  taggedDocsManager.setRoots(librarianManager?.getLibraryRootPaths() ?? []);
}

/**
 * Set up IPC handlers for Librarian (reading collection) functionality.
 */
function setupLibrarianIPCHandlers(): void {
  const currentLibraryRootPaths = (): string[] => (
    librarianManager?.getLibraryRoots().map((root) => root.path) ?? []
  );

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
    const added = librarianManager.addLibraryRoot(dirPath);
    syncTaggedDocsRootsFromLibrary();
    return added;
  });

  ipcMain.handle('library:removeRoot', (_event, dirPath: string): boolean => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    const removed = librarianManager.removeLibraryRoot(dirPath);
    syncTaggedDocsRootsFromLibrary();
    return removed;
  });

  ipcMain.handle('library:createFile', (_event, rootPath: string, folderRelPath: string, fileName: string): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    const page = librarianManager.createLibraryFile(rootPath, folderRelPath, fileName);
    recordRecentCreatedLibraryPage(page, rootPath);
    return page;
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

  ipcMain.handle('wiki:getBacklinkRelationDocuments', (_event, relPath: string): WikiBacklinkRelationDocument[] => {
    if (!librarianManager) return [];
    return librarianManager.getWikiBacklinkRelationDocuments(relPath);
  });

  ipcMain.handle('library:getBacklinkRelationDocuments', async (_event, target: LibraryBacklinkTarget): Promise<LibraryBacklinkRelationDocument[]> => {
    if (!librarianManager) return [];
    return librarianManager.getLibraryBacklinkRelationDocuments(
      target,
      (filePath) => commandsManager?.getCommandByPath(filePath) ?? null,
    );
  });

  ipcMain.handle('wiki:findPageByDocumentVersion', (_event, version: DocumentVersion, previousRelPath?: string): WikiPage | null => {
    if (!librarianManager) return null;
    return librarianManager.findWikiPageByDocumentVersion(version, previousRelPath);
  });

  async function saveSharedCacheFileIfNeeded(
    filePath: string,
    content: string,
    expectedVersion?: DocumentVersion | null,
  ): Promise<DocumentSaveResult | null> {
    const currentContent = fs.readFileSync(filePath, 'utf-8');
    const sharedMeta = parseSharedFileFrontmatter(currentContent);
    if (!sharedMeta) return null;
    const localConflict = documentSaveConflictIfVersionChanged(filePath, expectedVersion);
    if (localConflict) return localConflict;

    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { ok: false, reason: 'error' };

    const result = await sharedSyncService.updateSharedContent(
      sharedMeta.sharedId,
      content,
      sharedMeta.revision ?? 0,
      filePath,
    );
    if (result.cachePath || result.conflictPath) librarianManager?.emit('library:changed');
    if (result.ok && result.cachePath) return documentSaveResultForUpdatedFile(result.cachePath);
    if (result.error === 'Remote revision changed before this edit synced') {
      return documentSaveResultForSharedConflict(result.remoteContent ?? currentContent, result.cachePath);
    }
    return { ok: false, reason: 'error' };
  }

  ipcMain.handle('wiki:save', async (_event, relPath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> => {
    if (!librarianManager) return { ok: false, reason: 'error' };
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { ok: false, reason: 'blocked' };
    }
    const page = librarianManager.getWikiPage(relPath);
    if (page) {
      const sharedSave = await saveSharedCacheFileIfNeeded(page.absPath, content, expectedVersion);
      if (sharedSave) return sharedSave;
    }
    return librarianManager.saveWikiPage(relPath, content, expectedVersion);
  });

  ipcMain.handle('wiki:createFile', (_event, folderName: string, fileName: string): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    const page = librarianManager.createWikiFile(folderName, fileName);
    recordRecentWikiPage(page);
    return page;
  });

  ipcMain.handle('wiki:createFileWithDefaultTitle', (_event, folderName: string): WikiPage | null => {
    if (!librarianManager) return null;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    const page = librarianManager.createWikiFileWithDefaultTitle(folderName);
    recordRecentWikiPage(page);
    return page;
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
    const page = librarianManager.createScratchpadDefault();
    recordRecentWikiPage(page);
    return page;
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
  ipcMain.handle('recent:list', (): RecentEntry[] => recentManager?.list() ?? []);
  ipcMain.handle('recent:visit', (_event, entry: RecentEntry): RecentEntry[] => {
    const next = recentManager?.visit(entry) ?? [];
    broadcastRecentChanged(next);
    return next;
  });
  ipcMain.handle(
    'recent:remove',
    (_event, kind: 'wiki' | 'external', entryPath: string): RecentEntry[] => {
      const next = recentManager?.remove(kind, entryPath) ?? [];
      broadcastRecentChanged(next);
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
        if (!isLibraryTextDocumentPath(canonical)) return null;
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

  ipcMain.handle('external:save', async (_event, absPath: string, content: string, expectedVersion?: DocumentVersion | null): Promise<DocumentSaveResult> => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { ok: false, reason: 'blocked' };
    }
    try {
      const canonical = fs.realpathSync(absPath);
      if (!isLibraryTextDocumentPath(canonical)) return { ok: false, reason: 'not-found' };
      const sharedSave = await saveSharedCacheFileIfNeeded(canonical, content, expectedVersion);
      if (sharedSave) return sharedSave;
      const previousContent = fs.readFileSync(canonical, 'utf-8');
      const nextContent = isAllowedMarkdownExt(canonical)
        ? stampMarkdownContentEditIfBodyChanged(previousContent, content)
        : content;
      return writeTextFileWithConflictGuard(canonical, nextContent, expectedVersion);
    } catch (error) {
      log.error(`external:save failed for ${absPath}:`, error);
      return { ok: false, reason: 'error' };
    }
  });

  ipcMain.handle('markdownImages:copyImageForDocument', (_event, documentPath: string, imagePath: string, alt?: string) => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return copyImageForMarkdownDocument(documentPath, imagePath, alt || 'Image', { libraryRoots: currentLibraryRootPaths() });
  });

  ipcMain.handle('markdownImages:copyImageDataUrlForDocument', (_event, documentPath: string, dataUrl: string, alt?: string) => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return null;
    }
    return copyImageDataUrlForMarkdownDocument(documentPath, dataUrl, alt || 'Image', { libraryRoots: currentLibraryRootPaths() });
  });

  ipcMain.handle('markdownImages:makeImagesPortable', (_event, documentPath: string, content: string) => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { content, copied: 0, rewritten: 0, missing: 0 };
    }
    return makeMarkdownImagesPortable(documentPath, content, { libraryRoots: currentLibraryRootPaths() });
  });

  ipcMain.handle('markdownImages:deleteUnusedCopiedImages', (_event, documentPath: string, removedMarkdown: string, remainingContent: string) => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { deleted: 0, skipped: 0, missing: 0 };
    }
    return deleteUnusedCopiedMarkdownImages(documentPath, removedMarkdown, remainingContent, { libraryRoots: currentLibraryRootPaths() });
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
        if (!isLibraryTextDocumentPath(canonical)) return null;
        const trimmed = newName.trim();
        if (!trimmed) return null;
        const extension = path.extname(canonical) || '.md';
        const nextFileName = libraryTextDocumentFileNameFromUserInput(trimmed, extension);
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

  ipcMain.handle('external:delete', async (_event, absPath: string): Promise<boolean> => {
    if (!librarianManager) return false;
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return false;
    }
    return librarianManager.deleteExternalLibraryFile(absPath);
  });

  if (librarianManager) {
    librarianManager.startWikiWatcher();
    librarianManager.on('wiki:changed', (event?: LibraryChangeEvent) => {
      scheduleLibrarySyncIfAllowed();
      const launcherDirectNotified = event && typeof event === 'object'
        && (event as LibraryChangeEvent & { launcherDirectNotified?: unknown }).launcherDirectNotified === true;
      traceLibraryRename('broadcast-wiki-changed', {
        windows: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
        changeType: event?.type ?? null,
      });
      browserHelperServer?.emitNativeEvent({ type: 'wiki:changed', event });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) {
          w.webContents.send('wiki:changed', event);
          w.webContents.send('library:changed', event);
        }
      });
      if (!launcherDirectNotified) {
        commandLauncherWindow?.send('wiki:changed', event);
        commandLauncherWindow?.send('library:changed', event);
      }
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
      browserHelperServer?.emitNativeEvent({ type: 'wiki:renamed', event });
      browserHelperServer?.emitNativeEvent({ type: 'library:renamed', event });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) {
          w.webContents.send('wiki:renamed', event);
          w.webContents.send('library:renamed', event);
        }
      });
      commandLauncherWindow?.send('wiki:renamed', event);
      commandLauncherWindow?.send('library:renamed', event);
    });
    librarianManager.on('library:changed', (_rootPath?: string, event?: LibraryChangeEvent) => {
      scheduleLibrarySyncIfAllowed();
      const launcherDirectNotified = event && typeof event === 'object'
        && (event as LibraryChangeEvent & { launcherDirectNotified?: unknown }).launcherDirectNotified === true;
      traceLibraryRename('broadcast-library-changed', {
        windows: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
        changeType: event?.type ?? null,
      });
      browserHelperServer?.emitNativeEvent({ type: 'library:changed', event });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('library:changed', event);
      });
      if (!launcherDirectNotified) commandLauncherWindow?.send('library:changed', event);
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
      browserHelperServer?.emitNativeEvent({ type: 'library:renamed', event });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('library:renamed', event);
      });
      commandLauncherWindow?.send('library:renamed', event);
    });
    // Auto-prune recent when a wiki page is trashed so stale entries drop
    // from the sidebar even if the caller didn't explicitly call recent:remove.
    librarianManager.on('wiki:deleted', (relPath: string) => {
      if (recentManager) {
        recentManager.remove('wiki', relPath);
        broadcastRecentChanged();
      }
      browserHelperServer?.emitNativeEvent({ type: 'wiki:deleted', relPath });
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('wiki:deleted', relPath);
      });
    });
  }

  ipcMain.handle('bookmarks:getAll', (): BookmarksSnapshot => {
    return ensureBookmarksManager().getSnapshot();
  });

  ipcMain.handle('bookmarks:syncIfStale', () => syncBookmarksFromCliIfStale());

  ipcMain.handle('bookmarks:getAuthors', () => {
    const { buildBookmarkAuthorSummaries } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
    return buildBookmarkAuthorSummaries(ensureBookmarksManager().getSnapshot().bookmarks);
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

      await runWithCommandLauncherExternalInvocation(async () => {
        clipboard.writeText(text);
        clipboardManager?.syncClipboardHash();
        await activateAndPasteFromCommandLauncher(targetApp);
      });

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
    const { bookmarksForAuthor } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
    return bookmarksForAuthor(handle, ensureBookmarksManager().getSnapshot().bookmarks);
  });

  ipcMain.handle('bookmarks:getTaxonomyBookmarks', (_event, filePaths: string[]) => {
    if (!Array.isArray(filePaths)) return [];
    const { bookmarksForTaxonomyFiles } = require('./bookmarkCollections') as typeof import('./bookmarkCollections');
    return bookmarksForTaxonomyFiles(filePaths, ensureBookmarksManager().getSnapshot().bookmarks);
  });

  ipcMain.handle('bookmarks:search', (_event, query: string) => {
    if (typeof query !== 'string') return [];
    const { searchBookmarks } = require('./bookmarkCollections') as typeof import('./bookmarkCollections');
    return searchBookmarks(query, ensureBookmarksManager().getSnapshot().bookmarks);
  });

  ipcMain.handle('bookmarks:saveWebUrl', async (_event, url: string) => {
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      return { success: false, error: 'Field Theory is read-only' };
    }
    const manager = ensureBookmarksManager();
    if (typeof url !== 'string' || !url.trim()) {
      return { success: false, error: 'URL is required' };
    }

    try {
      const result = await manager.saveWebBookmarkFromUrl(url);
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
    const manager = ensureBookmarksManager();

    const activePage = await getActiveWebPageForLauncher('save-active-web-page');
    if (!activePage.success || !activePage.page) {
      return activePage;
    }

    try {
      const { page } = activePage;
      const result = await manager.saveWebBookmarkFromUrl(page.url);
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
    const { bookmarkById, formatBookmarkPost } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
    const bookmark = bookmarkById(id, ensureBookmarksManager().getSnapshot().bookmarks);
    if (!bookmark) {
      return { success: false, error: 'Bookmark not found' };
    }

    return pasteBookmarkTextFromLauncher('invoke-bookmark-post', { id }, formatBookmarkPost(bookmark));
  });

  ipcMain.handle('bookmarks:copyForAgent', async (_event, id: string) => {
    const { buildBookmarkAgentCopyText } = require('./bookmarkAgentCopy') as typeof import('./bookmarkAgentCopy');
    const { bookmarkById } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
    const { mediaDir: bookmarkMediaDir } = require('./bookmarksManager') as typeof import('./bookmarksManager');
    const bookmark = bookmarkById(id, ensureBookmarksManager().getSnapshot().bookmarks);
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
    const { formatBookmarkAuthorTimeline } = require('./bookmarkAuthorTimeline') as typeof import('./bookmarkAuthorTimeline');
    const timeline = formatBookmarkAuthorTimeline(handle, ensureBookmarksManager().getSnapshot().bookmarks);
    if (!timeline) {
      return { success: false, error: 'No bookmarks found for author' };
    }

    return pasteBookmarkTextFromLauncher('invoke-bookmark-author', { handle }, timeline);
  });

  ensureBookmarksWatcher();

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
    const handoff = getBrowserLibraryNativeFocusHandoff(librarianMarkdownEditorFocused);
    if (handoff.clearBrowserMarkdownEditorOwner) {
      browserLibraryMarkdownEditorFocused = false;
      activeBrowserLibraryClientId = null;
    }
    if (handoff.clearBrowserNavigationOwner) {
      activeBrowserLibrarySurfaceClientId = null;
      activeBrowserLibrarySurfaceKind = null;
    } else if (handoff.promoteBrowserNavigationOwner && activeBrowserLibrarySurfaceClientId) {
      promoteBrowserLibraryClientContext(activeBrowserLibrarySurfaceClientId);
    }
  });

  ipcMain.on('browser-library:get-renderer-storage-sync', (event) => {
    event.returnValue = getBrowserLibraryRendererStorageStore().snapshotSync();
  });

  ipcMain.on('browser-library:renderer-storage-changed', (_event, payload: { key?: unknown; value?: unknown }) => {
    const key = typeof payload?.key === 'string' ? payload.key : '';
    const value = typeof payload?.value === 'string' ? payload.value : null;
    void setBrowserLibraryRendererStorage(key, value);
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
    return librarianManager?.isSetupComplete() ?? inferCurrentLibrarianSetupComplete();
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
      librarianCommand: path.join(commandsDir(), 'librarian.md'),
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
  // Shared/River Files
  // ===========================================================================

  ipcMain.handle('sharedFiles:getAvailability', async () => {
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { available: false, canWrite: false, hasTeamMembers: false, reason: 'not_authenticated' };
    return sharedSyncService.getAvailability();
  });

  ipcMain.handle('sharedFiles:getStatus', async (_event, filePath: string) => {
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { shared: false };
    return sharedSyncService.getShareStatus(filePath);
  });

  ipcMain.handle('sharedFiles:share', async (_event, input: SharedFileShareInput) => {
    if (!canWriteFieldTheoryContent()) return { shared: false };
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { shared: false };
    const result = await sharedSyncService.shareFile(input);
    if (result.shared) librarianManager?.emit('library:changed');
    return result;
  });

  ipcMain.handle('sharedFiles:unshare', async (_event, filePath: string): Promise<boolean> => {
    if (!canWriteFieldTheoryContent()) return false;
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return false;
    const result = await sharedSyncService.unshareFile(filePath);
    if (result) librarianManager?.emit('library:changed');
    return result;
  });

  ipcMain.handle('sharedFiles:sync', async () => {
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { written: 0, removed: 0, created: 0, errors: [sharedFeaturesDisabledError()] };
    const result = await sharedSyncService.syncOnce();
    if (result.written > 0 || result.removed > 0 || result.created > 0) {
      librarianManager?.emit('library:changed');
    }
    broadcastSharedFilePinsChanged();
    return result;
  });

  ipcMain.handle('sharedFiles:updateContent', async (_event, sharedId: string, content: string, expectedRevision: number, documentPath?: string | null) => {
    if (!canWriteFieldTheoryContent()) return { ok: false, error: 'Read-only account mode' };
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { ok: false, error: sharedFeaturesDisabledError() };
    const result = await sharedSyncService.updateSharedContent(sharedId, content, expectedRevision, documentPath);
    if (result.cachePath || result.conflictPath) librarianManager?.emit('library:changed');
    return result;
  });

  ipcMain.handle('sharedFiles:setActivePresence', async (_event, sharedId: string | null) => {
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return [];
    return sharedSyncService.setActivePresence(sharedId);
  });

  ipcMain.handle('sharedFiles:getPinnedItemIds', async () => {
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return [];
    return sharedSyncService.getPinnedSidebarItemIds();
  });

  ipcMain.handle('sharedFiles:setPinned', async (_event, filePath: string, pinned: boolean) => {
    if (!canWriteFieldTheoryContent()) return { ok: false, reason: 'read_only' };
    refreshFieldTheorySyncServices();
    if (!sharedSyncService || !canUseSharedFeatures()) return { ok: false, reason: 'not_authenticated' };
    return sharedSyncService.setPinned(filePath, pinned);
  });

  // ===========================================================================
  // Team Membership
  // ===========================================================================

  ipcMain.handle('team:getState', async () => {
    refreshFieldTheorySyncServices();
    if (!sharedTeamService || !canUseSharedFeatures()) {
      return {
        available: false,
        currentTeamScopeUserId: null,
        reason: 'not_authenticated',
        isOwner: false,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      };
    }
    return sharedTeamService.getTeamState();
  });

  ipcMain.handle('team:inviteMember', async (_event, email: string): Promise<SharedTeamMutationResult> => {
    if (!canWriteFieldTheoryContent()) return { ok: false, error: 'Read-only account mode' };
    refreshFieldTheorySyncServices();
    if (!sharedTeamService || !canUseSharedFeatures()) return { ok: false, error: sharedFeaturesDisabledError() };
    return afterTeamMutation(sharedTeamService.inviteMember(email));
  });

  ipcMain.handle('team:respondToInvite', async (_event, contactId: string, accept: boolean): Promise<SharedTeamMutationResult> => {
    if (!canWriteFieldTheoryContent()) return { ok: false, error: 'Read-only account mode' };
    refreshFieldTheorySyncServices();
    if (!sharedTeamService || !canUseSharedFeatures()) return { ok: false, error: sharedFeaturesDisabledError() };
    return afterTeamMutation(sharedTeamService.respondToInvite(contactId, accept));
  });

  ipcMain.handle('team:removeMember', async (_event, contactId: string): Promise<SharedTeamMutationResult> => {
    if (!canWriteFieldTheoryContent()) return { ok: false, error: 'Read-only account mode' };
    refreshFieldTheorySyncServices();
    if (!sharedTeamService || !canUseSharedFeatures()) return { ok: false, error: sharedFeaturesDisabledError() };
    return afterTeamMutation(sharedTeamService.removeMember(contactId));
  });

  ipcMain.handle('team:leaveTeam', async (): Promise<SharedTeamMutationResult> => {
    if (!canWriteFieldTheoryContent()) return { ok: false, error: 'Read-only account mode' };
    refreshFieldTheorySyncServices();
    if (!sharedTeamService || !canUseSharedFeatures()) return { ok: false, error: sharedFeaturesDisabledError() };
    return afterTeamMutation(sharedTeamService.leaveTeam());
  });

  // ===========================================================================
  // Public Sharing
  // ===========================================================================

  // Share a reading publicly
  ipcMain.handle('librarian:shareReading', async (_event, filePath: string): Promise<{ slug: string; url: string } | null> => {
    return shareLibrarianReading(filePath);
  });

  // Unshare a reading (soft delete)
  ipcMain.handle('librarian:unshareReading', async (_event, filePath: string): Promise<boolean> => {
    return unshareLibrarianReading(filePath);
  });

  // Check if a reading is shared
  ipcMain.handle('librarian:getShareStatus', async (_event, filePath: string): Promise<{ shared: boolean; slug?: string; url?: string } | null> => {
    return getLibrarianShareStatus(filePath);
  });

  // Update a shared reading's content
  ipcMain.handle('librarian:updateSharedReading', async (_event, filePath: string, content: string, title: string): Promise<boolean> => {
    return updateSharedLibrarianReading(filePath, content, title);
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
    return clipboardManager?.getFiguresPath()
      ?? (userDataManager?.isLoggedIn()
        ? userDataManager.getUserDataPath('figures')
        : path.join(app.getPath('userData'), 'figures'));
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

  ipcMain.handle(CodexTerminalIPCChannels.CREATE, (_event, input?: { cwd?: string; title?: string; cols?: number; rows?: number; auto?: boolean; launchCommand?: string }) => {
    const manager = getCodexTerminalManager();
    const session = manager.createSession(input);
    broadcastCodexTerminalSessions(manager);
    return session;
  });

  ipcMain.handle(CodexTerminalIPCChannels.LIST, () => {
    return getCodexTerminalManager().listSessions();
  });

  ipcMain.handle(CodexTerminalIPCChannels.LIST_HISTORY, (_event, input?: { query?: string; limit?: number }) => {
    return getCodexTerminalManager().listHistory(input);
  });

  ipcMain.handle(CodexTerminalIPCChannels.READ_HISTORY_PREVIEW, (_event, filePath: string, input?: { maxBytes?: number }) => {
    return getCodexTerminalManager().readHistoryPreview(filePath, input);
  });

  ipcMain.handle(CodexTerminalIPCChannels.GET_BUFFER, (_event, id: string): string | null => {
    return getCodexTerminalManager().getBuffer(id);
  });

  ipcMain.handle(CodexTerminalIPCChannels.INPUT, (_event, id: string, data: string): boolean => {
    return getCodexTerminalManager().writeInput(id, data);
  });

  ipcMain.handle(CodexTerminalIPCChannels.SET_LAUNCHER_TARGET_SESSION, (_event, id: string | null): boolean => {
    focusedCodexTerminalLauncherSessionId = typeof id === 'string' && id.trim() ? id : null;
    return true;
  });

  ipcMain.handle(CodexTerminalIPCChannels.RESIZE, (_event, id: string, cols: number, rows: number): boolean => {
    return getCodexTerminalManager().resize(id, cols, rows);
  });

  ipcMain.handle(CodexTerminalIPCChannels.KILL, (_event, id: string): boolean => {
    const manager = getCodexTerminalManager();
    const didKill = manager.kill(id);
    if (didKill) {
      broadcastCodexTerminalSessions(manager);
    }
    return didKill;
  });

  ipcMain.handle(CodexTerminalIPCChannels.RENAME, (_event, id: string, title: string): boolean => {
    const manager = getCodexTerminalManager();
    const didRename = manager.rename(id, title);
    if (didRename) {
      broadcastCodexTerminalSessions(manager);
    }
    return didRename;
  });

  ipcMain.handle(CodexTerminalIPCChannels.READ_CLIPBOARD_TEXT, (): string => {
    return clipboard.readText();
  });

  ipcMain.handle(CodexTerminalIPCChannels.READ_TERMINAL_PASTE_TEXT, async (): Promise<string> => {
    return readCodexTerminalPasteText({
      clipboard,
      imageExporter: clipboardManager,
    });
  });

  ipcMain.handle(CodexTerminalIPCChannels.WRITE_CLIPBOARD_TEXT, (_event, text: string): boolean => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle(CodexTerminalIPCChannels.ATTACH_PAGE_CONTEXT, (_event, id: string, context: CodexTerminalPageContext, options?: { notifyTerminal?: boolean }) => {
    const manager = getCodexTerminalManager();
    const result = manager.attachPageContext(id, context, options);
    if (result.ok) {
      broadcastCodexTerminalSessions(manager);
    }
    return result;
  });

  registerMetricsIpc({
    getMetricsManager: () => metricsManager,
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
      const includeFieldTheoryWindows = source === 'command-launcher'
        && (commandLauncherWindow?.wasFieldTheoryActiveOnShow() ?? false);
      return squaresManager?.executeAction(action, {
        source,
        includeFieldTheoryWindows,
      }) ?? false;
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
      return {};
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

  ipcMain.handle(ClipboardIPCChannels.SAVE_PASTED_IMAGE_FILE, async (_event, file: { name?: string | null; type?: string | null; data: Uint8Array }): Promise<string | null> => {
    if (!clipboardManager) {
      return null;
    }
    return clipboardManager.savePastedImageFileToCache(file);
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
        const targetApp = await clipboardHistoryWindow.getTargetAppForPaste();
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
      let commandLauncherTextContent: string | undefined;

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
        commandLauncherTextContent = textContent;
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
            commandLauncherTextContent = figureRefWithSpace;
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

      const useCommandLauncherPaste = Boolean(targetBundleId && commandLauncherWindow?.isShowingOrVisible());

      if (useCommandLauncherPaste && targetBundleId) {
        const pasted = await pasteClipboardFromCommandLauncher(targetBundleId, 'paste-item-command-launcher', commandLauncherTextContent);
        if (!pasted) {
          cursorStatusManager?.showNoTargetError('Clipboard paste failed');
        }
      } else {
        if (commandLauncherWindow?.isShowingOrVisible()) {
          commandLauncherWindow.hide(false);
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
        const targetApp = await clipboardHistoryWindow.getTargetAppForPaste();
        effectiveBundleId = targetApp?.bundleId || null;
      }

      const commandLauncherPasteTarget = targetBundleId && commandLauncherWindow?.isShowingOrVisible()
        ? findRunningAppForBundleId(targetBundleId)
        : null;
      if (commandLauncherPasteTarget) {
        const targetReady = await runWithCommandLauncherExternalInvocation(async () => {
          const activated = await activateCommandLauncherTargetApp(commandLauncherPasteTarget, 'paste-stack-command-launcher');
          if (!activated) return false;
          commandLauncherWindow?.hide(true);
          clipboardHistoryWindow?.hideAfterPaste('paste-stack-command-launcher');
          return true;
        });
        if (!targetReady) {
          cursorStatusManager?.showNoTargetError('Clipboard paste failed');
          return;
        }
      } else {
        // Dismiss panel mode before paste; app mode stays visible.
        if (clipboardHistoryWindow) {
          clipboardHistoryWindow.hideAfterPaste('paste-stack');
        }
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

      if (frontmostBundleId && clipboardHistoryWindow && !commandLauncherPasteTarget && !isFinder(frontmostBundleId)) {
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
        const targetApp = await clipboardHistoryWindow.getTargetAppForPaste();
        effectiveBundleId = targetApp?.bundleId || null;
      }

      if (isFinder(effectiveBundleId)) {
        log.info('pasteText: skipping paste to Finder');
        if (clipboardHistoryWindow) {
          clipboardHistoryWindow.hideAfterPaste('paste-text-finder-skip');
        }
        return;
      }

      const useCommandLauncherPaste = Boolean(targetBundleId && commandLauncherWindow?.isShowingOrVisible());

      if (useCommandLauncherPaste && targetBundleId) {
        const pasted = await pasteClipboardFromCommandLauncher(targetBundleId, 'paste-text-command-launcher', text);
        if (!pasted) {
          cursorStatusManager?.showNoTargetError('Clipboard paste failed');
        }
      } else {
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

  ipcMain.on('clipboard:closeWindow', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const mainClipboardWindow = clipboardHistoryWindow?.getWindow() ?? null;
    if (senderWindow && senderWindow !== mainClipboardWindow) {
      senderWindow.close();
      return;
    }

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

  ipcMain.handle('library:openDocumentWindow', (_event, target: Partial<LibraryDocumentWindowTarget>): { success: boolean; error?: string } => {
    const normalized = normalizeLibraryDocumentWindowTarget(target);
    if (!normalized) return { success: false, error: 'Invalid document window target' };
    getLibraryDocumentWindowManager().open(normalized);
    return { success: true };
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

  // Local LLM model management for offline command execution.
  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_MODELS, async () => {
    return getLocalLlmManager().getAvailableModels();
  });

  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_STATUS, async () => {
    return getLocalLlmManager().getDownloadStatus();
  });

  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_HEALTH, async () => {
    return getLocalLlmManager().getModelHealthMap();
  });

  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_SELECTED, async () => {
    return getLocalLlmManager().getSelectedModel();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_LOCAL_LLM_SELECTED, async (_event, model: string) => {
    return getLocalLlmManager().setSelectedModel(model);
  });

  ipcMain.handle(ClipboardIPCChannels.DOWNLOAD_LOCAL_LLM, async (_event, model: string) => {
    return installOrAccessLocalLlmModel(model);
  });

  ipcMain.handle(ClipboardIPCChannels.DELETE_LOCAL_LLM, async () => {
    return {
      success: false,
      error: 'Bundled local models are removed by deleting the model file from resources/models.',
    };
  });

  ipcMain.handle(ClipboardIPCChannels.GET_USE_LOCAL_LLM, async () => {
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.SET_USE_LOCAL_LLM, async (_event, useLocal: boolean) => {
    return useLocal
      ? { success: true }
      : { success: false, error: 'Offline commands require the local model.' };
  });

  ipcMain.handle(ClipboardIPCChannels.GET_MEETING_SUMMARY_PROMPT, async () => {
    return preferencesManager?.getPreference('meetingSummaryPrompt') || DEFAULT_MEETING_SUMMARY_PROMPT;
  });

  ipcMain.handle(ClipboardIPCChannels.SAVE_MEETING_SUMMARY_PROMPT, async (_event, prompt: string) => {
    if (!preferencesManager) {
      return { success: false, error: 'Preferences manager not initialized.' };
    }

    if (typeof prompt !== 'string') {
      return { success: false, error: 'Meeting notes prompt must be text.' };
    }

    const trimmed = prompt.trim();
    if (!trimmed) {
      return { success: false, error: 'Meeting notes prompt cannot be empty.' };
    }

    await preferencesManager.save({ meetingSummaryPrompt: prompt });
    return { success: true, prompt };
  });

  ipcMain.handle(ClipboardIPCChannels.RESET_MEETING_SUMMARY_PROMPT, async () => {
    if (!preferencesManager) {
      return { success: false, prompt: DEFAULT_MEETING_SUMMARY_PROMPT, error: 'Preferences manager not initialized.' };
    }

    await preferencesManager.save({ meetingSummaryPrompt: DEFAULT_MEETING_SUMMARY_PROMPT });
    return { success: true, prompt: DEFAULT_MEETING_SUMMARY_PROMPT };
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
    clearBrowserHelperState();

    // Unregister all hotkeys via HotkeyManager
    const hotkeyManager = getHotkeyManager();
    hotkeyManager.unregisterAll();

    // Unregister Squares window management hotkeys.
    squaresManager?.unregisterHotkeys();

    // Clean up TranscriberManager (stop persistent runtimes, unregister hotkeys)
    transcriberManager?.destroy();

    // Stop any local agent kickoff subprocesses.
    agentKickoffManager?.destroy();

    // Clean up embedded Codex terminals.
    codexTerminalManager?.destroy();

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
    const result = await authManager.signInWithPassword(email, password);
    return {
      ...result,
      session: result.session ? authManager.getSessionState() : null,
    };
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

    return {
      ...result,
      session: result.session ? authManager.getSessionState() : null,
    };
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
    const result = await authManager.setSessionFromUrl(accessToken, refreshToken);
    return {
      ...result,
      session: result.session ? authManager.getSessionState() : null,
    };
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
    return authManager.getSessionState();
  });

  ipcMain.handle('auth:isSuperAdmin', (): boolean => {
    return authManager?.isSuperAdmin() ?? false;
  });

  registerShellIpc();

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
      return true;
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
      return false;
    }
    return preferencesManager.getPreference('clickAwayToDismiss') ?? false;
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
        openAsHidden: true, // Keep login-item launches quiet; direct launches show the window.
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

  registerQuotaIpc({
    getQuotaManager: () => quotaManager,
    logError: (message, error) => log.error(message, error),
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

  ipcMain.handle('diagnostics:appendRenderedEditorDebug', (_event, entry: unknown) => {
    return writeRenderedEditorDebugLog(entry);
  });

  ipcMain.handle('diagnostics:appendScrollDiagnostics', (_event, entry: unknown) => {
    return writeScrollDiagnosticsLog(entry);
  });

  ipcMain.handle('diagnostics:getRenderedEditorDebugLogPath', () => renderedEditorDebugLogPath);

  ipcMain.handle('diagnostics:clearRenderedEditorDebugLog', () => clearRenderedEditorDebugLog());

  ipcMain.handle('diagnostics:getScrollDiagnosticsLogPath', () => scrollDiagnosticsLogPath);

  ipcMain.handle('diagnostics:clearScrollDiagnosticsLog', () => clearScrollDiagnosticsLog());

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
      lastModified: cmd.lastModified,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.GET_COMMAND_DIRECTORIES, async () => {
    if (!commandsManager) {
      return [];
    }
    return commandsManager.getCommandDirectories();
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
      lastModified: cmd.lastModified,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.GET_LAUNCHER_FILE_ICON, async (_event, filePath: string): Promise<LauncherFileIconResult> => {
    return getLauncherFileIcon(filePath);
  });

  ipcMain.handle(CommandsIPCChannels.SEARCH_LAUNCHER_FILES, async (_event, query: string): Promise<LauncherFileSearchResult> => {
    const { searchLauncherFiles } = require('./launcherFiles') as typeof import('./launcherFiles');
    return searchLauncherFiles(query);
  });

  ipcMain.handle(CommandsIPCChannels.OPEN_LAUNCHER_FILE, async (_event, filePath: string): Promise<{ success: boolean; error?: string }> => {
    const { openLauncherFile } = require('./launcherFiles') as typeof import('./launcherFiles');
    return openLauncherFile(filePath, {
      openPath: (resolvedPath) => shell.openPath(resolvedPath),
    });
  });

  ipcMain.handle(CommandsIPCChannels.WARM_LAUNCHER_FILE_INDEX, async (): Promise<{ started: boolean }> => {
    const { warmLauncherFileIndex } = require('./launcherFiles') as typeof import('./launcherFiles');
    void warmLauncherFileIndex();
    return { started: true };
  });

  ipcMain.handle(CommandsIPCChannels.GET_LAUNCHER_SETTINGS, async (): Promise<LauncherSettings> => {
    return {
      rootSearchEnabledKinds: normalizeLauncherRootSearchEnabledKinds(
        preferencesManager?.getPreference('launcherRootSearchEnabledKinds'),
      ),
    };
  });

  ipcMain.handle(CommandsIPCChannels.SET_LAUNCHER_SETTINGS, async (_event, settings: LauncherSettings): Promise<LauncherSettings> => {
    const rootSearchEnabledKinds = normalizeLauncherRootSearchEnabledKinds(settings?.rootSearchEnabledKinds);
    if (preferencesManager) {
      await preferencesManager.save({ launcherRootSearchEnabledKinds: rootSearchEnabledKinds });
    }
    return { rootSearchEnabledKinds };
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
    return loadMarkdownPreview(filePath);
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

  ipcMain.handle('commands:getLauncherContext', async (): Promise<{ fieldTheoryActive: boolean; hasActiveLibraryFileContext: boolean; targetApp: { bundleId: string; name: string } | null }> => {
    const fieldTheoryActive = commandLauncherWindow?.wasFieldTheoryActiveOnShow() ?? false;
    const previousApp = commandLauncherWindow?.getPreviousApp() ?? null;
    const frontmostApp = nativeHelper?.getFrontmostApp() ?? null;
    const targetApp = previousApp?.bundleId && isExternalCommandTargetBundleId(previousApp.bundleId)
      ? previousApp
      : lastExternalCommandTargetApp?.bundleId && isExternalCommandTargetBundleId(lastExternalCommandTargetApp.bundleId)
        ? lastExternalCommandTargetApp
        : null;
    appendCommandLauncherTrace('launcher-context', {
      fieldTheoryActive,
      previousBundleId: previousApp?.bundleId ?? null,
      previousName: previousApp?.name ?? null,
      frontmostBundleId: frontmostApp?.bundleId ?? null,
      frontmostName: frontmostApp?.name ?? null,
      fallbackBundleId: lastExternalCommandTargetApp?.bundleId ?? null,
      fallbackName: lastExternalCommandTargetApp?.name ?? null,
      integratedTerminalSessionId: focusedCodexTerminalLauncherSessionId,
      hasActiveLibraryFileContext: Boolean(activeLibraryFileContext?.filePath),
      targetBundleId: targetApp?.bundleId ?? null,
      targetName: targetApp?.name ?? null,
    });
    return { fieldTheoryActive, hasActiveLibraryFileContext: Boolean(activeLibraryFileContext?.filePath), targetApp };
  });

  ipcMain.handle('commands:getActiveLibraryFileContext', (): ActiveLibraryFileContext | null => {
    return activeLibraryFileContext;
  });

  ipcMain.handle('commands:setActiveLibraryFileContext', (event, context: ActiveLibraryFileContext | null): boolean => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow) registerDocumentPresenceWindow(sourceWindow);
    const windowId = sourceWindow ? String(sourceWindow.id) : null;

    if (context === null) {
      if (!windowId || activeLibraryFileContextSourceId === windowId) {
        activeLibraryFileContext = null;
        activeLibraryFileContextSourceId = null;
      }
      if (windowId) getDocumentPresenceManager().clearWindow(windowId);
      return true;
    }
    if (
      (context.type !== 'wiki' && context.type !== 'external') ||
      typeof context.rootPath !== 'string' ||
      typeof context.relPath !== 'string' ||
      typeof context.filePath !== 'string' ||
      !context.filePath ||
      typeof context.title !== 'string' ||
      !context.title
    ) {
      return false;
    }
    const nextContext: ActiveLibraryFileContext = {
      type: context.type,
      rootPath: context.rootPath,
      relPath: context.relPath,
      filePath: context.filePath,
      title: context.title,
      ...(typeof context.selectionStart === 'number' && typeof context.selectionEnd === 'number'
        ? {
            selectionStart: context.selectionStart,
            selectionEnd: context.selectionEnd,
            ...(typeof context.selectionText === 'string' ? { selectionText: context.selectionText } : {}),
          }
        : {}),
    };
    if (!shouldAcceptActiveLibraryFileContext(nextContext)) {
      if (!windowId || activeLibraryFileContextSourceId === windowId) {
        activeLibraryFileContext = null;
        activeLibraryFileContextSourceId = null;
      }
      if (windowId) getDocumentPresenceManager().clearWindow(windowId);
      appendCommandLauncherTrace('active-library-context-rejected', {
        source: 'native-window',
        windowId,
        filePath: nextContext.filePath,
        rootPath: nextContext.rootPath,
      });
      return false;
    }
    activeLibraryFileContext = nextContext;
    activeLibraryFileContextSourceId = windowId;
    if (windowId) {
      getDocumentPresenceManager().setWindowDocument(windowId, activeLibraryFileContext, sourceWindow?.isFocused() ?? false);
    }
    return true;
  });

  ipcMain.handle('commands:archiveActiveLibraryFile', (): { success: boolean; error?: string } => (
    archiveActiveLibraryFileForLauncher()
  ));

  ipcMain.handle('commands:toggleActiveLibraryLineNumbers', (): { success: boolean; error?: string } => {
    return toggleActiveLibraryLineNumbersForLauncher();
  });

  runNativeLocalCommand = async (rawRequest: unknown): Promise<LocalCommandRunResult> => {
    if (!commandsManager || !librarianManager) {
      emitLocalCommandStatus({
        status: 'error',
        message: 'Field Theory command system is not ready',
        error: 'Field Theory command system is not ready',
      });
      return { success: false, error: 'Field Theory command system is not ready' };
    }
    if (!canWriteFieldTheoryContent()) {
      blockWrite();
      emitLocalCommandStatus({
        status: 'error',
        message: 'Field Theory is read-only',
        error: 'Field Theory is read-only',
      });
      return { success: false, error: 'Field Theory is read-only' };
    }
    const request = normalizeLocalCommandRequest(rawRequest);
    if (!request) {
      emitLocalCommandStatus({
        status: 'error',
        message: 'Invalid local command',
        error: 'Invalid local command',
      });
      return { success: false, error: 'Invalid command' };
    }
    const mode: LocalCommandRunMode = request.mode ?? 'document';
    const customInstruction = request.customInstruction?.trim();
    const requestedCommandName = request.commandName?.trim();
    const statusCommandName = customInstruction ? 'local' : requestedCommandName;
    if (!activeLibraryFileContext) {
      emitLocalCommandStatus({
        status: 'error',
        message: 'No current Field Theory document',
        commandName: statusCommandName,
        mode,
        error: 'No current Field Theory document',
      });
      return { success: false, error: 'No current Field Theory document' };
    }
    if (!fs.existsSync(activeLibraryFileContext.filePath)) {
      emitLocalCommandStatus({
        status: 'error',
        message: 'Current document no longer exists',
        commandName: statusCommandName,
        filePath: activeLibraryFileContext.filePath,
        mode,
        error: 'Current document no longer exists',
      });
      return { success: false, error: 'Current document no longer exists' };
    }

    const command = customInstruction
      ? null
      : requestedCommandName?.toLowerCase() === 'improve'
        ? await ensureLocalImproveCommand()
        : requestedCommandName
          ? commandsManager.getCommand(requestedCommandName)
          : null;
    if (!customInstruction && !command) {
      const error = 'Command not found';
      emitLocalCommandStatus({
        status: 'error',
        message: requestedCommandName ? `Command not found: ${requestedCommandName}` : error,
        commandName: requestedCommandName,
        filePath: activeLibraryFileContext.filePath,
        mode,
        error,
      });
      return { success: false, error };
    }

    let maxwellRuns: MaxwellRunManager | null = null;
    let maxwellRunId: string | undefined;
    const updateMaxwellRun = (
      action: string,
      update: (manager: MaxwellRunManager, runId: string) => void,
    ): void => {
      if (!maxwellRuns || !maxwellRunId) return;
      try {
        update(maxwellRuns, maxwellRunId);
      } catch (error) {
        log.warn(`Could not ${action}:`, error);
      }
    };

    let selectionStatusFields = (): { selectionStart?: number; selectionEnd?: number } => ({});
    try {
      emitLocalCommandStatus({
        status: 'running',
        message: customInstruction
          ? 'Preparing local instruction...'
          : `Loading ${command!.displayName || command!.name}...`,
        commandName: statusCommandName,
        filePath: activeLibraryFileContext.filePath,
        mode,
        phase: 'loading',
      });
      const loaded = customInstruction
        ? { name: 'local', content: customInstruction, filePath: null as string | null }
        : await commandsManager.loadCommandContent(command!);
      if (!loaded) {
        const error = 'Command file could not be loaded';
        emitLocalCommandStatus({
          status: 'error',
          message: error,
          commandName: statusCommandName,
          filePath: activeLibraryFileContext.filePath,
          mode,
          error,
        });
        return { success: false, error };
      }

      const expectedVersion = readDocumentVersion(activeLibraryFileContext.filePath);
      const targetContent = fs.readFileSync(activeLibraryFileContext.filePath, 'utf-8');
      const memorySnapshot = readMaxwellMemorySnapshot(request.useMemory !== false);
      let resolvedSelection: { start: number; end: number; text: string } | null = null;
      if (mode === 'selection') {
        const selection = resolveLocalCommandSelection(request.selection, targetContent);
        if (!selection.ok) {
          emitLocalCommandStatus({
            status: 'error',
            message: selection.error,
            commandName: loaded.name,
            filePath: activeLibraryFileContext.filePath,
            mode,
            error: selection.error,
          });
          return { success: false, error: selection.error, commandName: loaded.name, mode };
        }
        resolvedSelection = selection;
      }
      selectionStatusFields = () => resolvedSelection
        ? { selectionStart: resolvedSelection.start, selectionEnd: resolvedSelection.end }
        : {};

      const localManager = getLocalLlmManager();
      const maxwellStartedAt = Date.now();
      try {
        maxwellRuns = getMaxwellRunManager();
        const run = maxwellRuns.createPendingRun({
          commandName: loaded.name,
          commandPath: loaded.filePath,
          commandContent: loaded.content,
          targetPath: activeLibraryFileContext.filePath,
          targetRelPath: activeLibraryFileContext.type === 'wiki' ? activeLibraryFileContext.relPath : null,
          targetType: activeLibraryFileContext.type === 'wiki' ? 'wiki' : 'reading',
          mode,
          preContent: targetContent,
          preVersion: expectedVersion,
          model: localManager.getSelectedModel(),
          harness: localManager.getHarness(),
          memorySnapshot,
        });
        maxwellRunId = run.runId;
        activeMaxwellLocalRun = { runId: run.runId, cancelled: false };
      } catch (error) {
        log.warn('Could not create Maxwell run row:', error);
      }
      appendCommandLauncherTrace('run-local-command-start', {
        commandName: loaded.name,
        commandPath: loaded.filePath,
        targetType: activeLibraryFileContext.type,
        targetPath: activeLibraryFileContext.filePath,
        mode,
        memoryUsed: !!memorySnapshot,
        maxwellRunId: maxwellRunId ?? null,
      });
      const targetFilePath = activeLibraryFileContext.filePath;
      const emitHarnessProgress = (event: LocalLlmProgressEvent) => {
        updateMaxwellRun('append Maxwell progress event', (manager, runId) => {
          manager.appendProgressEvent(runId, event);
        });
        emitLocalCommandStatus({
          status: 'running',
          message: event.message,
          detail: compactLocalCommandDetail(event.detail),
          eventKind: event.kind,
          commandName: loaded.name,
          filePath: targetFilePath,
          mode,
          runId: maxwellRunId,
          phase: event.phase ?? 'generating',
          ...selectionStatusFields(),
        });
      };

      emitLocalCommandStatus({
        status: 'running',
        message: mode === 'selection'
          ? `Improving selected text locally...`
          : `Running ${customInstruction ? 'local instruction' : loaded.name} locally...`,
        commandName: loaded.name,
        filePath: activeLibraryFileContext.filePath,
        mode,
        runId: maxwellRunId,
        phase: 'generating',
        ...selectionStatusFields(),
      });

      let replacement: string;
      if (mode === 'selection') {
        const selection = resolvedSelection!;
        const selectedReplacement = await localManager.runSelectionCommand({
          commandName: loaded.name,
          commandContent: loaded.content,
          targetTitle: activeLibraryFileContext.title,
          targetPath: activeLibraryFileContext.filePath,
          targetContent,
          selectedText: selection.text,
          memorySnapshot,
        }, {
          onProgress: emitHarnessProgress,
        });
        replacement = `${targetContent.slice(0, selection.start)}${selectedReplacement}${targetContent.slice(selection.end)}`;
      } else {
        replacement = await localManager.runReplacementCommand({
          commandName: loaded.name,
          commandContent: loaded.content,
          targetTitle: activeLibraryFileContext.title,
          targetPath: activeLibraryFileContext.filePath,
          targetContent,
          memorySnapshot,
        }, {
          onProgress: emitHarnessProgress,
        });
      }
      if (isActiveMaxwellRunCancelled(maxwellRunId)) {
        emitLocalCommandStatus({
          status: 'notice',
          message: 'Maxwell run cancelled',
          commandName: loaded.name,
          filePath: activeLibraryFileContext.filePath,
          mode,
          runId: maxwellRunId,
          phase: 'cancelled',
          ...selectionStatusFields(),
        });
        return { success: false, error: 'Maxwell run cancelled', commandName: loaded.name, mode, runId: maxwellRunId };
      }
      updateMaxwellRun('mark Maxwell run generated', (manager, runId) => {
        manager.markGenerated(runId, replacement, {
          generationMs: Date.now() - maxwellStartedAt,
        });
      });

      const changeSummary = summarizeLocalCommandChange(targetContent, replacement);
      emitLocalCommandStatus({
        status: 'running',
        message: mode === 'selection' ? 'Saving improved text...' : 'Saving local command result...',
        detail: changeSummary.detail,
        eventKind: 'file_change',
        commandName: loaded.name,
        filePath: activeLibraryFileContext.filePath,
        mode,
        runId: maxwellRunId,
        phase: 'saving',
        changedLines: changeSummary.changedLines,
        changedBytes: changeSummary.changedBytes,
        ...selectionStatusFields(),
      });

      const saveResult = activeLibraryFileContext.type === 'wiki'
        ? librarianManager.saveWikiPage(activeLibraryFileContext.relPath, replacement, expectedVersion)
        : librarianManager.saveReading(activeLibraryFileContext.filePath, replacement, expectedVersion);

      if (!saveResult.ok) {
        const error = saveResult.reason === 'conflict'
          ? 'Current document changed while the local command was running'
          : `Could not save local command result: ${saveResult.reason}`;
        appendCommandLauncherTrace('run-local-command-save-error', {
          commandName: loaded.name,
          targetPath: activeLibraryFileContext.filePath,
          reason: saveResult.reason,
          maxwellRunId: maxwellRunId ?? null,
        });
        updateMaxwellRun('mark Maxwell save failure', (manager, runId) => {
          if (saveResult.reason === 'conflict') {
            manager.markSaveConflict(runId, {
              generatedContent: replacement,
              errorMessage: error,
            });
          } else {
            manager.markError(runId, 'save_error', error);
          }
        });
        emitLocalCommandStatus({
          status: 'error',
          message: error,
          commandName: loaded.name,
          filePath: activeLibraryFileContext.filePath,
          mode,
          runId: maxwellRunId,
          error,
          ...selectionStatusFields(),
        });
        return { success: false, error, commandName: loaded.name, mode, runId: maxwellRunId };
      }

      appendCommandLauncherTrace('run-local-command-success', {
        commandName: loaded.name,
        commandPath: loaded.filePath,
        targetPath: activeLibraryFileContext.filePath,
        mode,
        maxwellRunId: maxwellRunId ?? null,
      });
      updateMaxwellRun('mark Maxwell run success', (manager, runId) => {
        manager.markSuccess(runId, {
          generatedContent: replacement,
          postContent: replacement,
          postVersion: saveResult.version,
          summary: changeSummary.detail,
          timings: { totalMs: Date.now() - maxwellStartedAt },
        });
      });
      await quotaManager?.updateUsage('portable_commands', 1);
      metricsManager?.recordCommandExecuted();
      emitLocalCommandStatus({
        status: 'success',
        message: mode === 'selection'
          ? 'Improved selected text'
          : `Ran ${customInstruction ? 'local instruction' : loaded.name} locally`,
        detail: changeSummary.detail,
        eventKind: 'file_change',
        commandName: loaded.name,
        filePath: activeLibraryFileContext.filePath,
        mode,
        runId: maxwellRunId,
        phase: 'done',
        changedLines: changeSummary.changedLines,
        changedBytes: changeSummary.changedBytes,
        ...selectionStatusFields(),
      });
      return { success: true, filePath: activeLibraryFileContext.filePath, commandName: loaded.name, mode, runId: maxwellRunId };
    } catch (error) {
      log.error('Error running local command:', error);
      const message = error instanceof Error ? error.message : 'Local command failed';
      if (isActiveMaxwellRunCancelled(maxwellRunId)) {
        emitLocalCommandStatus({
          status: 'notice',
          message: 'Maxwell run cancelled',
          commandName: statusCommandName,
          filePath: activeLibraryFileContext.filePath,
          mode,
          runId: maxwellRunId,
          phase: 'cancelled',
          ...selectionStatusFields(),
        });
        return { success: false, error: 'Maxwell run cancelled', commandName: statusCommandName, mode, runId: maxwellRunId };
      }
      updateMaxwellRun('mark Maxwell generation failure', (manager, runId) => {
        manager.markError(runId, 'generation_error', message);
      });
      appendCommandLauncherTrace('run-local-command-error', { commandName: statusCommandName, mode, error, maxwellRunId: maxwellRunId ?? null });
      emitLocalCommandStatus({
        status: 'error',
        message,
        commandName: statusCommandName,
        filePath: activeLibraryFileContext.filePath,
        mode,
        runId: maxwellRunId,
        error: message,
        ...selectionStatusFields(),
      });
      return { success: false, error: message, commandName: statusCommandName, mode, runId: maxwellRunId };
    } finally {
      if (maxwellRunId && activeMaxwellLocalRun?.runId === maxwellRunId) {
        activeMaxwellLocalRun = null;
      }
    }
  };

  ipcMain.handle(CommandsIPCChannels.RUN_LOCAL_COMMAND, async (_event, rawRequest: unknown): Promise<LocalCommandRunResult> => {
    return runNativeLocalCommand(rawRequest);
  });

  ipcMain.handle(CommandsIPCChannels.LIST_MAXWELL_RUNS, (_event, rawLimit?: unknown): MaxwellRunSummary[] => {
    return listNativeMaxwellRuns(rawLimit);
  });

  ipcMain.handle(CommandsIPCChannels.GET_MAXWELL_MEMORY, (): MaxwellMemoryState => {
    return getMaxwellMemoryState();
  });

  ipcMain.handle(CommandsIPCChannels.SAVE_MAXWELL_MEMORY, async (_event, rawRequest: unknown): Promise<MaxwellMemorySaveResult> => {
    return saveNativeMaxwellMemory(rawRequest);
  });

  ipcMain.handle(CommandsIPCChannels.CANCEL_MAXWELL_RUN, (_event, rawRunId: unknown): MaxwellCancelResult => {
    return cancelNativeMaxwellRun(rawRunId);
  });

  ipcMain.handle(CommandsIPCChannels.UNDO_MAXWELL_RUN, (_event, rawRunId: unknown): MaxwellUndoResult => {
    return undoNativeMaxwellRun(rawRunId);
  });

  ipcMain.handle(CommandsIPCChannels.REDO_MAXWELL_RUN, (_event, rawRunId: unknown): MaxwellRedoResult => {
    return redoNativeMaxwellRun(rawRunId);
  });

  ipcMain.handle('commands:openFieldTheoryMarkdown', async (_event, rawTarget: { kind?: unknown; path?: unknown; contentMode?: 'rendered' | 'markdown' | 'typedown'; selectionStart?: number; selectionEnd?: number; clipboardItemId?: number; clipboardStackId?: string; clipboardSearch?: string }) => {
    const target = normalizeFieldTheoryMarkdownTarget(rawTarget);
    appendCommandLauncherTrace('open-field-theory-markdown-start', {
      kind: rawTarget?.kind ?? null,
      path: rawTarget?.path ?? null,
      contentMode: rawTarget?.contentMode ?? null,
    });
    if (!target) {
      appendCommandLauncherTrace('open-field-theory-markdown-error', {
        reason: 'invalid-target',
        kind: rawTarget?.kind ?? null,
        path: rawTarget?.path ?? null,
      });
      return { success: false, error: 'Invalid markdown target' };
    }
    if (
      target.kind !== 'clipboard' &&
      emitBrowserLibraryNavigationEvent({ type: 'commands:openMarkdownFromLauncher', target }, { broadcastFallback: false })
    ) {
      commandLauncherWindow?.hide(true);
      appendCommandLauncherTrace('open-field-theory-markdown-success', {
        kind: target.kind,
        path: target.path,
        contentMode: target.contentMode ?? null,
        target: 'browser-library',
      });
      return { success: true };
    }
    if (!clipboardHistoryWindow) {
      appendCommandLauncherTrace('open-field-theory-markdown-error', {
        reason: 'missing-field-theory-window',
        kind: target.kind,
        path: target.path,
      });
      return { success: false, error: 'Field Theory window not available' };
    }

    const sizeKey: ClipboardHistorySizeKey = target.kind === 'bookmarks'
      ? clipboardHistoryWindow.getCurrentSizeKey()
      : target.kind === 'clipboard'
        ? 'fields'
        : 'library';
    if (clipboardHistoryWindow.isVisible()) {
      suspendDynamicIslandFocusForClipboardHistory('command-launcher-open-markdown');
      clipboardHistoryWindow.focusExistingWindow();
    } else {
      const boundsToUse = restoreClipboardHistoryBounds(sizeKey);
      suspendDynamicIslandFocusForClipboardHistory('command-launcher-open-markdown');
      if (target.kind === 'clipboard') {
        clipboardHistoryWindow.show(boundsToUse);
      } else {
        clipboardHistoryWindow.showLibrary(boundsToUse);
      }
    }

    commandLauncherWindow?.hide(true);
    emitBrowserLibraryLauncherTarget(target);
    clipboardHistoryWindow.getWindow()?.webContents.send('commands:openMarkdownFromLauncher', target);
    appendCommandLauncherTrace('open-field-theory-markdown-success', {
      kind: target.kind,
      path: target.path,
      contentMode: target.contentMode ?? null,
    });
    return { success: true };
  });

  ipcMain.handle('commands:insertMarkdownText', async (_event, text: string) => {
    if (!text) {
      return { success: false, error: 'No markdown editor target' };
    }
    commandLauncherWindow?.hide(true);
    return insertTextIntoActiveFieldTheoryMarkdown(text)
      ? { success: true }
      : { success: false, error: 'No markdown editor target' };
  });

  ipcMain.handle('commands:insertClipboardItemsAsMarkdown', async (_event, ids: number[]) => {
    if (!clipboardManager) {
      return { success: false, error: 'No markdown editor target' };
    }
    const manager = clipboardManager;
    const items = ids
      .map((id) => manager.getItem(id))
      .filter((item): item is ClipboardItem => Boolean(item));
    if (items.length === 0) {
      return { success: false, error: 'Clipboard item not found' };
    }
    const payload = await buildFieldTheoryMarkdownClipboardPayload(
      items,
      (item) => manager.exportImageToCache(item),
    );
    if (!payload) {
      return { success: false, error: 'Clipboard item has no insertable content' };
    }
    commandLauncherWindow?.hide(true);
    return insertTextIntoActiveFieldTheoryMarkdown(payload)
      ? { success: true }
      : { success: false, error: 'No markdown editor target' };
  });

  // Handle handoff invocation from command launcher (same behavior as commands).
  ipcMain.handle('commands:invokeHandoff', async (_event, filePath: string) => {
    if (!commandsManager || !fs.existsSync(filePath)) {
      return { success: false, error: 'Handoff not found' };
    }

    try {
      const targetApp = getCommandLauncherTargetApp();
      const invocationTarget = getCommandLauncherInvocationTarget(targetApp);
      appendCommandLauncherTrace('invoke-handoff-start', {
        filePath,
        targetBundleId: targetApp?.bundleId ?? null,
        targetName: targetApp?.name ?? null,
        integratedTerminalSessionId: focusedCodexTerminalLauncherSessionId,
        invocationTarget: invocationTarget.kind,
      });
      const fileName = path.basename(filePath);
      if (invocationTarget.kind === 'field-theory-terminal') {
        const handoffText = formatCommandFilePasteText({
          kind: 'handoff',
          fileName,
          filePath,
          mode: 'text-reference',
          markdownContent: '',
        });
        if (writeTextIntoFocusedCodexTerminal(handoffText)) {
          commandLauncherWindow?.hide(true);
          appendCommandLauncherTrace('invoke-handoff-integrated-terminal-success', {
            filePath,
            sessionId: focusedCodexTerminalLauncherSessionId,
            textLength: handoffText.length,
          });
          return { success: true };
        }
        appendCommandLauncherTrace('invoke-handoff-integrated-terminal-failed', { filePath });
      }
      if (invocationTarget.kind === 'field-theory-markdown') {
        const handoffText = formatCommandFilePasteText({
          kind: 'handoff',
          fileName,
          filePath,
          mode: 'wiki-link',
          markdownContent: '',
        });
        if (insertTextIntoActiveFieldTheoryMarkdown(handoffText)) {
          commandLauncherWindow?.hide(true);
          appendCommandLauncherTrace('invoke-handoff-field-theory-markdown-success', {
            filePath,
            textLength: handoffText.length,
          });
          return { success: true };
        }
        appendCommandLauncherTrace('invoke-handoff-field-theory-markdown-failed', { filePath });
      }
      if (invocationTarget.kind !== 'external-app' || !targetApp) {
        commandLauncherWindow?.hide(true);
        appendCommandLauncherTrace('invoke-handoff-no-target', { filePath });
        return { success: false, error: 'No external target app available' };
      }

      return await runWithCommandLauncherExternalInvocation(async () => {
        const isTerminal = isTerminalApp(targetApp.bundleId);
        const isIDE = isIDEWithTerminal(targetApp.bundleId);
        const pasteMode = resolveCommandFilePasteMode({ isTerminal, isIDE });
        const handoffText = formatCommandFilePasteText({
          kind: 'handoff',
          fileName,
          filePath,
          mode: pasteMode,
          markdownContent: pasteMode === 'markdown-content' ? fs.readFileSync(filePath, 'utf-8') : '',
        });

        clipboard.writeText(handoffText);
        clipboardManager?.syncClipboardHash();
        appendCommandLauncherTrace('invoke-handoff-clipboard-written', {
          format: 'text',
          contentMode: pasteMode,
          targetBundleId: targetApp.bundleId,
          targetName: targetApp.name,
          filePath,
          textReferenceTarget: pasteMode === 'text-reference',
          markdownContentTarget: pasteMode === 'markdown-content',
          ...commandPayloadTrace(handoffText),
          textLength: handoffText.length,
          clipboard: readCommandPasteClipboardTrace(),
        });

        let pasted = false;
        let fallbackRan = false;
        const pasteDelivery = resolveCommandFilePasteDelivery({ mode: pasteMode, isTerminal, isIDE });
        if (pasteDelivery === 'native-helper') {
          pasted = await typeTextFromCommandLauncher(targetApp, handoffText, 'invoke-handoff');
        } else {
          appendCommandLauncherTrace('invoke-handoff-native-type-skipped', {
            filePath,
            targetBundleId: targetApp.bundleId,
            targetName: targetApp.name,
            contentMode: pasteMode,
            delivery: pasteDelivery,
          });
        }
        if (!pasted) {
          fallbackRan = true;
          appendCommandLauncherTrace('invoke-handoff-native-type-fallback', {
            filePath,
            targetBundleId: targetApp.bundleId,
            targetName: targetApp.name,
            contentMode: pasteMode,
          });
        }
        if (!pasted) {
          pasted = await activateAndPasteFromCommandLauncher(targetApp, {
            clipboardTrace: readCommandPasteClipboardTrace,
            requireFocusedTextInput: true,
          });
        }
        if (!pasted) {
          cursorStatusManager?.showNoTargetError('Portable command paste failed');
          return { success: false, error: 'Could not paste into target app' };
        }

        appendCommandLauncherTrace('invoke-handoff-success', {
          filePath,
          targetBundleId: targetApp.bundleId,
          targetName: targetApp.name,
          terminal: isTerminal,
          IDE: isIDE,
          contentMode: pasteMode,
          fallbackRan,
        });
        return { success: true };
      });
    } catch (error) {
      log.error('Error invoking handoff:', error);
      appendCommandLauncherTrace('invoke-handoff-error', { filePath, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Handle direct command invocation from command launcher (Cmd+Shift+K).
  // Gets the command, determines if target is terminal, and pastes appropriately.
  ipcMain.handle('commands:invoke', async (_event, commandName: string, traceContext?: Record<string, unknown>) => {
    if (!commandsManager) {
      return { success: false, error: 'Not initialized' };
    }
    const invocationTrace = traceContext && typeof traceContext === 'object' ? traceContext : {};

    const command = commandsManager.getCommand(commandName);
    if (!command) {
      log.error(`Command not found: "${commandName}". Available: ${commandsManager.getCommands().map(c => c.name).join(', ')}`);
      return { success: false, error: 'Command not found' };
    }

    try {
      const targetApp = getCommandLauncherTargetApp();
      const invocationTarget = getCommandLauncherInvocationTarget(targetApp);
      appendCommandLauncherTrace('invoke-command-start', {
        ...invocationTrace,
        commandName,
        commandPath: command.filePath,
        targetBundleId: targetApp?.bundleId ?? null,
        targetName: targetApp?.name ?? null,
        integratedTerminalSessionId: focusedCodexTerminalLauncherSessionId,
        invocationTarget: invocationTarget.kind,
      });
      if (invocationTarget.kind === 'field-theory-terminal') {
        const commandText = formatCommandFilePasteText({
          kind: 'command',
          name: command.name,
          filePath: command.filePath,
          mode: 'text-reference',
          markdownContent: '',
        });
        if (writeTextIntoFocusedCodexTerminal(commandText)) {
          commandLauncherWindow?.hide(true);
          appendCommandLauncherTrace('invoke-command-integrated-terminal-success', {
            ...invocationTrace,
            commandName,
            commandPath: command.filePath,
            sessionId: focusedCodexTerminalLauncherSessionId,
            textLength: commandText.length,
          });
          return { success: true };
        }
        appendCommandLauncherTrace('invoke-command-integrated-terminal-failed', {
          ...invocationTrace,
          commandName,
          commandPath: command.filePath,
        });
      }
      if (invocationTarget.kind === 'field-theory-markdown') {
        const commandText = formatCommandFilePasteText({
          kind: 'command',
          name: command.name,
          filePath: command.filePath,
          mode: 'wiki-link',
          markdownContent: '',
        });
        if (insertTextIntoActiveFieldTheoryMarkdown(commandText)) {
          commandLauncherWindow?.hide(true);
          appendCommandLauncherTrace('invoke-command-field-theory-markdown-success', {
            ...invocationTrace,
            commandName,
            commandPath: command.filePath,
            textLength: commandText.length,
          });
          return { success: true };
        }
        appendCommandLauncherTrace('invoke-command-field-theory-markdown-failed', {
          ...invocationTrace,
          commandName,
          commandPath: command.filePath,
        });
      }
      if (invocationTarget.kind !== 'external-app' || !targetApp) {
        appendCommandLauncherTrace('invoke-command-no-target', {
          ...invocationTrace,
          commandName,
          commandPath: command.filePath,
        });
        cursorStatusManager?.showNoTargetError('Portable command: no target app');
        return { success: false, error: 'No external target app available' };
      }
      const isTerminal = isTerminalApp(targetApp.bundleId);
      const isIDE = isIDEWithTerminal(targetApp.bundleId);

      log.info(`Invoking command "${commandName}" → ${command.filePath} (target: ${targetApp?.name ?? 'unknown'} [${targetApp?.bundleId ?? '?'}], terminal: ${isTerminal}, IDE: ${isIDE})`);

      let pasteMode = resolveCommandFilePasteMode({ isTerminal, isIDE });
      let fallbackRan = false;
      const invocationFailure = await runWithCommandLauncherExternalInvocation(async (): Promise<{ success: false; error: string } | null> => {
        const clipboardRestore = commandClipboardRestoreCoordinator.begin(captureClipboardSnapshot());
        let launcherClipboardPayload: CommandClipboardPayloadSnapshot | null = null;
        try {
          pasteMode = resolveCommandFilePasteMode({ isTerminal, isIDE });
          const commandText = formatCommandFilePasteText({
            kind: 'command',
            name: command.name,
            filePath: command.filePath,
            mode: pasteMode,
            markdownContent: pasteMode === 'markdown-content' ? fs.readFileSync(command.filePath, 'utf-8') : '',
          });

          clipboard.writeText(commandText);
          clipboardManager?.syncClipboardHash();
          launcherClipboardPayload = captureCommandClipboardPayload();
          appendCommandLauncherTrace('invoke-command-clipboard-written', {
            ...invocationTrace,
            commandName,
            format: 'text',
            contentMode: pasteMode,
            targetBundleId: targetApp.bundleId,
            targetName: targetApp.name,
            textReferenceTarget: pasteMode === 'text-reference',
            markdownContentTarget: pasteMode === 'markdown-content',
            ...commandPayloadTrace(commandText),
            textLength: commandText.length,
            clipboard: readCommandPasteClipboardTrace(),
          });

          let pasted = false;
          const pasteDelivery = resolveCommandFilePasteDelivery({ mode: pasteMode, isTerminal, isIDE });
          if (pasteDelivery === 'native-helper') {
            pasted = await typeTextFromCommandLauncher(targetApp, commandText, 'invoke-command', invocationTrace);
          } else {
            appendCommandLauncherTrace('invoke-command-native-type-skipped', {
              ...invocationTrace,
              commandName,
              targetBundleId: targetApp.bundleId,
              targetName: targetApp.name,
              contentMode: pasteMode,
              delivery: pasteDelivery,
            });
          }
          if (!pasted) {
            fallbackRan = true;
            appendCommandLauncherTrace('invoke-command-native-type-fallback', {
              ...invocationTrace,
              commandName,
              targetBundleId: targetApp.bundleId,
              targetName: targetApp.name,
              contentMode: pasteMode,
            });
          }
          if (!pasted) {
            pasted = await activateAndPasteFromCommandLauncher(targetApp, {
              clipboardTrace: readCommandPasteClipboardTrace,
              requireFocusedTextInput: true,
              traceDetails: invocationTrace,
            });
          }
          if (!pasted) {
            cursorStatusManager?.showNoTargetError('Portable command paste failed');
            return { success: false, error: 'Could not paste into target app' };
          }
        } finally {
          scheduleCommandClipboardRestore({
            commandName,
            commandPath: command.filePath,
            restoreGeneration: clipboardRestore.generation,
            restoreSnapshot: clipboardRestore.snapshot,
            launcherClipboardPayload,
          });
        }
        return null;
      });
      if (invocationFailure) return invocationFailure;
      appendCommandLauncherTrace('invoke-command-success', {
        ...invocationTrace,
        commandName,
        commandPath: command.filePath,
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        terminal: isTerminal,
        IDE: isIDE,
        contentMode: pasteMode,
        fallbackRan,
      });

      await quotaManager?.updateUsage('portable_commands', 1);
      metricsManager?.recordCommandExecuted();
      return { success: true };
    } catch (error) {
      log.error('Error invoking command:', error);
      appendCommandLauncherTrace('invoke-command-error', { ...invocationTrace, commandName, commandPath: command.filePath, error });
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

  // Feedback-only mode still mounts the shared social view, which asks for the
  // legacy DM/contact surfaces during initial load. Keep those paths inert.
  ipcMain.handle(SocialIPCChannels.SEND_DM, async () => null);
  ipcMain.handle(SocialIPCChannels.GET_CONVERSATIONS, async () => []);
  ipcMain.handle(SocialIPCChannels.GET_DMS_WITH_USER, async () => []);
  ipcMain.handle(SocialIPCChannels.HAS_UNREAD, async () => false);
  ipcMain.handle(SocialIPCChannels.GET_CONTACTS, async () => []);
  ipcMain.handle(SocialIPCChannels.ADD_FRIEND, async () => ({ success: false, error: 'DM contacts are not enabled.' }));
  ipcMain.handle(SocialIPCChannels.SEARCH_CONTACTS, async () => []);
  ipcMain.handle(SocialIPCChannels.GET_PENDING_INVITES, async () => []);
  ipcMain.handle(SocialIPCChannels.RESPOND_TO_INVITE, async () => false);
  ipcMain.handle(SocialIPCChannels.REMOVE_FRIEND, async () => false);
  ipcMain.handle(SocialIPCChannels.GET_HOT_MIC, async () => false);
  ipcMain.handle(SocialIPCChannels.SET_HOT_MIC, async () => false);

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

  // Keep realtime feedback delivery scoped to active feedback sessions.
  ipcMain.handle(SocialIPCChannels.SET_FEEDBACK_REALTIME_ACTIVE, async (_event, active: boolean) => {
    if (!feedbackManager) {
      return false;
    }
    feedbackManager.setFeedbackRealtimeActive(active);
    return true;
  });

  // Check if current user is admin.
  ipcMain.handle(SocialIPCChannels.IS_ADMIN, async () => {
    if (!feedbackManager) {
      return false;
    }
    return await feedbackManager.isCurrentUserAdmin();
  });

  registerAccountIpc({
    getAccountStatusManager: () => accountStatusManager,
  });

  registerFieldTheorySyncIpc({
    getStatus: getFieldTheorySyncStatus,
    setLocalEnabled: async (enabled: boolean) => {
      if (preferencesManager) {
        await preferencesManager.save({ fieldTheoryInternalSyncEnabled: enabled });
        refreshFieldTheorySyncServices();
      }
    },
  });
}

function setupMeetingsIPCHandlers(): void {
  registerMeetingsIpc({
    getMeetingManager,
    getActiveFileContext: () => activeLibraryFileContext ? { ...activeLibraryFileContext } : null,
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
    await preferencesManager.save({ onboardingComplete: true, onboardingStep: undefined });

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
    await preferencesManager.save({ onboardingComplete: true, onboardingStep: undefined });

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

function isClipboardHistoryWindowFocused(): boolean {
  const window = clipboardHistoryWindow?.getWindow();
  return Boolean(window && !window.isDestroyed() && window.isFocused());
}

function restoreClipboardHistoryFocusAfterFloatingRecording(): void {
  [120, 260].forEach((delayMs) => setTimeout(() => {
    const window = clipboardHistoryWindow?.getWindow();
    const shouldRestore = getFieldTheoryWindowMode() === 'app'
      && dynamicIslandManager?.getResolvedRecordingIndicatorMode() === 'floating'
      && transcriberManager?.getStatus() === 'recording'
      && Boolean(window && !window.isDestroyed() && window.isVisible())
      && !Boolean(window && !window.isDestroyed() && window.isFocused());

    appendVisibilityTrace('main.floating-recording-focus-restore.check', {
      delayMs,
      shouldRestore,
      mode: getFieldTheoryWindowMode(),
      resolvedIndicatorMode: dynamicIslandManager?.getResolvedRecordingIndicatorMode() ?? null,
      transcriberStatus: transcriberManager?.getStatus() ?? null,
      clipboardVisible: window && !window.isDestroyed() ? window.isVisible() : null,
      clipboardFocused: window && !window.isDestroyed() ? window.isFocused() : null,
    });

    if (!shouldRestore) return;

    appendVisibilityTrace('main.floating-recording-focus-restore.action');
    clipboardHistoryWindow?.focusVisibleWindow('floating-recording-focus-restore');
  }, delayMs));
}

/**
 * Broadcast transcription events to all renderer windows.
 */
function broadcastTranscribeEvents(): void {
  if (!transcriberManager) return;

  transcriberManager.on('statusChanged', (status) => {
    const clipboardFocused = isClipboardHistoryWindowFocused();
    const shouldRestoreFocusAfterFloatingRecording = shouldRestoreFieldTheoryFocusAfterFloatingRecording(
      preferencesManager ? getFieldTheoryWindowMode() : null,
      dynamicIslandManager?.getResolvedRecordingIndicatorMode() ?? null,
      status,
      clipboardHistoryWindow?.isVisible() ?? false,
      clipboardFocused,
    );
    appendVisibilityTrace('transcriber.status-changed', {
      status,
      mode: preferencesManager ? getFieldTheoryWindowMode() : null,
      recordingIndicatorMode: preferencesManager?.getPreference('recordingIndicatorMode') ?? null,
      clipboardVisible: clipboardHistoryWindow?.isVisible() ?? null,
      clipboardShowing: clipboardHistoryWindow?.isShowing() ?? null,
      clipboardFocused,
      restoreFocusAfterFloatingRecording: shouldRestoreFocusAfterFloatingRecording,
      dynamicIslandState: dynamicIslandManager?.getState() ?? null,
      resolvedIndicatorMode: dynamicIslandManager?.getResolvedRecordingIndicatorMode() ?? null,
    });

    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.STATUS_CHANGED, status);
      }
    });
    
    // Update clipboard history window's recording state
    // This ensures blur event doesn't hide the app when recording is active
    clipboardHistoryWindow?.setRecordingActive(status === 'recording');
    trayManager?.setRecordingActive(status === 'recording');

    // Update dynamic island with recording state transitions.
    if (dynamicIslandManager) {
      if (status === 'silentStacking') {
        dynamicIslandManager.setState('silentStacking');
      } else if (status === 'recording') {
        dynamicIslandManager.setState('recording');
        if (shouldRestoreFocusAfterFloatingRecording) {
          restoreClipboardHistoryFocusAfterFloatingRecording();
        }
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

  transcriberManager.on('paste-starting', async () => {
    const delayMs = dynamicIslandManager?.prepareForPaste() ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  });

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
    trayManager?.updateRecordingAudioLevel(level);
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
    dynamicIslandManager?.showEscapeHint();
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
    clipboardHistoryWindow?.rememberExternalApp(appInfo);
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
  const { QuotaManager } = require('./quotaManager') as typeof import('./quotaManager');
  quotaManager = new QuotaManager();
  accountStatusManager = new AccountStatusManager();

  // Initialize librarian manager for watching markdown reading files.
  const { LibrarianManager } = require('./librarianManager') as typeof import('./librarianManager');
  librarianManager = new LibrarianManager();
  if (!markdownAssetsConsolidated) {
    markdownAssetsConsolidated = true;
    setImmediate(() => {
      if (!librarianManager || !canWriteFieldTheoryContent()) return;
      let changed = false;
      for (const root of librarianManager.getLibraryRoots()) {
        const result = consolidateMarkdownAssetsForLibraryRoot(root.path);
        if (result.filesRewritten > 0 || result.deleted > 0 || result.oldFoldersRemoved > 0) changed = true;
        if (result.errors.length > 0) log.warn('Markdown asset consolidation had errors for %s: %j', root.path, result.errors);
      }
      if (changed) librarianManager.emit('library:changed');
    });
  }
  recentManager = new RecentManager();
  void startBrowserHelperIfEnabled().catch((error) => {
    log.warn('Failed to start Field Theory browser helper: %s', error instanceof Error ? error.message : String(error));
  });

  // Initialize bookmarks manager for reading synced X bookmarks.
  ensureBookmarksManager();

  // Broadcast artifact-added events to all windows and auto-show if enabled
  librarianManager.on('reading-added', async (reading: Reading) => {
    recordRecentExternalDocument(reading.path, reading.title);

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
    browserHelperServer?.emitNativeEvent({ type: 'librarian:readingAdded', reading });

    // Check if muted for today - halts interruption even if existing sessions create artifacts
    const isMuted = librarianManager!.isMutedForToday();
    if (isMuted) {
      return;
    }

    const browserReadingEvent: BrowserHelperNativeEvent = activeBrowserLibrarySurfaceKind === 'library'
      ? { type: 'librarian:showNewReading', readingPath: reading.path }
      : { type: 'librarian:newReadingAvailable', readingPath: reading.path };
    const sentToActiveBrowserLibrary = Boolean(
      activeBrowserLibrarySurfaceClientId &&
      browserHelperServer?.emitNativeEventToClient(activeBrowserLibrarySurfaceClientId, browserReadingEvent)
    );

    // If the Field Theory window is already open, the user may be typing,
    // reading, searching, or managing another surface. Save and index the
    // artifact, but do not take over the current view.
    if (clipboardHistoryWindow?.isVisible()) {
      clipboardHistoryWindow.getWindow()?.webContents.send('librarian:newReadingAvailable', reading.path);
      if (!sentToActiveBrowserLibrary) {
        browserHelperServer?.emitNativeEvent({ type: 'librarian:newReadingAvailable', readingPath: reading.path });
      }
      clipboardHistoryWindow.playArtifactDiscoverySound();
      return;
    }

    if (sentToActiveBrowserLibrary) {
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
      clipboardHistoryWindow.showLibrary(boundsToUse, true, shouldStealFocus);
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
    browserHelperServer?.emitNativeEvent({ type: 'librarian:readingUpdated', reading });
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
    browserHelperServer?.emitNativeEvent({ type: 'librarian:readingRenamed', event });
  });

  // Broadcast reading-removed events to all windows
  librarianManager.on('reading-removed', (filePath: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingRemoved', filePath);
      }
    });
    browserHelperServer?.emitNativeEvent({ type: 'librarian:readingRemoved', filePath });
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
    browserHelperServer?.emitNativeEvent({ type: 'quota:tierChanged', tier: tier as 'free' | 'pro' });
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
    browserHelperServer?.emitNativeEvent({ type: 'quota:changed', data: formatted });
  });

  // Initialize cursor status indicator BEFORE transcriberManager so it can be passed in.
  cursorStatusManager = new CursorStatusManager();
  const cursorStatusEnabled = preferencesManager.getPreference('cursorStatusEnabled') ?? true;
  cursorStatusManager.setEnabled(cursorStatusEnabled);
  const hideStatusLabels = preferencesManager.getPreference('hideStatusLabels') ?? false;
  cursorStatusManager.setHideLabels(hideStatusLabels);

  // Initialize the recording indicator after applying saved placement preferences.
  dynamicIslandManager = new DynamicIslandManager();
  dynamicIslandManager.setEnabled(false);
  dynamicIslandManager.on('floating-position-changed', (position: FloatingIndicatorPosition) => {
    void preferencesManager?.save({ floatingIndicatorPosition: position });
  });

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
    browserHelperServer?.emitNativeEvent({ type: 'agent:kickoffProgress', event });
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('agent:kickoffProgress', event);
    });
  });
  agentKickoffManager.on('status', (event: AgentKickoffStatusEvent) => {
    browserHelperServer?.emitNativeEvent({ type: 'agent:kickoffStatus', event });
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
  const { TranscriberManager } = require('./transcriberManager') as typeof import('./transcriberManager');
  transcriberManager = new TranscriberManager(nativeHelper, preferencesManager, clipboardManager, quotaManager, audioManager ?? undefined, cursorStatusManager);
  transcriberManager.setFieldTheoryMarkdownInsertionTarget({
    isAvailable: hasFocusedFieldTheoryMarkdownInsertionTarget,
    insertText: insertTextIntoFocusedFieldTheoryMarkdown,
  });
  transcriberManager.setFieldTheoryTerminalInsertionTarget({
    isAvailable: () => Boolean(focusedCodexTerminalLauncherSessionId),
    insertText: writeTextIntoFocusedCodexTerminal,
  });
  transcriberManager.setMeetingCaptureHotkeyHandler(async () => {
    const result = await getMeetingManager().stopActiveMeeting();
    if (!result.success) {
      const message = result.error ?? result.summaryError ?? 'Could not stop meeting';
      log.warn('Could not stop meeting from transcription hotkey: %s', message);
      emitLocalCommandStatus({
        status: 'error',
        message,
        commandName: 'stop-meeting',
        mode: 'document',
        error: message,
      });
    }
  });
  await transcriberManager.init();
  startupMark('transcriber-manager-init-complete');
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
    hotMicManager = new HotMicManager(nativeHelper, preferencesManager, soundMgr, {
      startHttpServer: !qualityBenchmarkIdFromCommandLine(),
    });
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
        if (
          transcriberStatus === 'silentStacking'
          || transcriberStatus === 'recording'
          || transcriberStatus === 'transcribing'
        ) {
          void transcriberManager?.cancelActiveSession();
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
        appendVisibilityTrace('dynamic-island.open-field-theory.received', {
          mode: getFieldTheoryWindowMode(),
          toggleCloseAllowed: shouldToggleCloseFieldTheoryFromDynamicIsland(getFieldTheoryWindowMode()),
          clipboardVisible: clipboardHistoryWindow.isVisible(),
          clipboardShowing: clipboardHistoryWindow.isShowing(),
          lastHideReason: clipboardHistoryLastHideReason,
          lastHideAgeMs: clipboardHistoryLastHideAt > 0 ? Date.now() - clipboardHistoryLastHideAt : null,
          dynamicIslandState: dynamicIslandManager?.getState() ?? null,
          resolvedIndicatorMode: dynamicIslandManager?.getResolvedRecordingIndicatorMode() ?? null,
        });
        if (clipboardHistoryWindow.isVisible()) {
          if (shouldToggleCloseFieldTheoryFromDynamicIsland(getFieldTheoryWindowMode())) {
            appendVisibilityTrace('dynamic-island.open-field-theory.action', {
              action: 'toggle-close',
              reason: 'visible-panel-mode',
            });
            await clipboardHistoryWindow.hideAndRestorePreviousApp('dynamic-island-toggle-history-window');
          } else {
            appendVisibilityTrace('dynamic-island.open-field-theory.action', {
              action: 'focus-visible-app-window',
              reason: 'visible-app-mode',
            });
            clipboardHistoryWindow.focusExistingWindow();
          }
          cursorStatusManager?.refreshWindowProperties();
          dynamicIslandManager?.refreshWindowProperties('clipboard-history:open-field-theory-visible');
          return;
        }

        // Clicking the Dynamic Island while Field Theory is focused causes a blur-hide
        // first; suppress immediate reopen so second click behaves like a true toggle-close.
        if (
          clipboardHistoryLastHideReason === 'window-blur-handler' &&
          Date.now() - clipboardHistoryLastHideAt <= DYNAMIC_ISLAND_BLUR_TOGGLE_SUPPRESS_MS
        ) {
          appendVisibilityTrace('dynamic-island.open-field-theory.action', {
            action: 'suppress-reopen-after-blur-hide',
            lastHideAgeMs: Date.now() - clipboardHistoryLastHideAt,
          });
          return;
        }

        appendVisibilityTrace('dynamic-island.open-field-theory.action', {
          action: 'show-app-window',
          reason: 'not-visible',
        });
        clipboardHistoryWindow.playOpenSound();
        const boundsToUse = restoreClipboardHistoryBounds('library');
        suspendDynamicIslandFocusForClipboardHistory('show-open-field-theory');
        clipboardHistoryWindow.capturePreviousAppAndShowLibrary(boundsToUse, true);
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
  commandsManager = new CommandsManager({
    indexCommandContent: (filePath, content) => {
      librarianManager?.recordLibraryIndexLinkHits(filePath, content);
    },
    removeCommandIndex: (filePath) => {
      librarianManager?.removeLibraryIndexPath(filePath);
    },
  });

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
  startupMark('commands-manager-initialize-complete');

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
    const commandInfos = commands.map((cmd: PortableCommand) => ({
      name: cmd.name,
      displayName: cmd.displayName,
      filePath: cmd.filePath,
      lastModified: cmd.lastModified,
    }));
    browserHelperServer?.emitNativeEvent({ type: 'commands:changed', commands: commandInfos });
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(CommandsIPCChannels.COMMANDS_CHANGED, commandInfos);
      }
    });
  });
  
  commandsManager.on('directoryChanged', (directoryPath) => {
    browserHelperServer?.emitNativeEvent({ type: 'commands:directoryChanged', directoryPath });
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
  appendCommandLauncherTrace('command-launcher-main-ready', {
    pasteTraceVersion: COMMAND_LAUNCHER_PASTE_TRACE_VERSION,
    mainProcessStartedAt: MAIN_PROCESS_STARTED_AT,
    pid: process.pid,
    nativeHelperAvailable: Boolean(nativeHelper),
    payloadTraceEnabled: isCommandPayloadTraceEnabled(),
  });
  commandLauncherWindow.preload();
  startupMark('command-launcher-preload-called');
  const startupQualityBenchmarkId = qualityBenchmarkIdFromCommandLine();
  if (startupQualityBenchmarkId) {
    const startupQualityBenchmarkMode = qualityBenchmarkModeFromCommandLine();
    setTimeout(() => {
      const benchmark = startupQualityBenchmarkMode === 'launcher'
        ? runLauncherInteractionQualityBenchmark(startupQualityBenchmarkId)
        : startupQualityBenchmarkMode === 'launcher-normal'
        ? runLauncherInteractionQualityBenchmark(startupQualityBenchmarkId, { focusProtection: false })
        : startupQualityBenchmarkMode === 'immersive'
        ? runImmersiveSurfaceQualityBenchmark(startupQualityBenchmarkId)
        : startupQualityBenchmarkMode === 'recording-asr-delivery'
        ? runRecordingAsrDeliveryQualityBenchmark(startupQualityBenchmarkId)
        : startupQualityBenchmarkMode === 'recording-asr'
        ? runRecordingAsrQualityBenchmark(startupQualityBenchmarkId)
        : startupQualityBenchmarkMode === 'recording'
        ? runRecordingDeliveryQualityBenchmark(startupQualityBenchmarkId)
        : runCommandLauncherQualityBenchmark(startupQualityBenchmarkId, startupQualityBenchmarkMode);
      void benchmark
        .finally(() => setTimeout(() => app.exit(0), 50));
    }, 250);
  }

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
  userDataManager = await ensureUserDataManagerRestored();

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
  enableDynamicIslandFromPreferences();
  if (librarianManager) {
    librarianManager.setUserDataManager(userDataManager);
    if (userDataManager.isLoggedIn()) {
      await librarianManager.reinitializeForUser();
    }
  }
  startupMark('librarian-user-data-ready');
  if (commandsManager) {
    commandsManager.setUserDataManager(userDataManager);
    // Reload per-user commands immediately if user was restored from disk.
    if (userDataManager.isLoggedIn()) {
      await commandsManager.reinitializeForUser();
    }
  }
  startupMark('commands-user-data-ready');
  if (recentManager) {
    recentManager.setUserDataManager(userDataManager);
  }
  const { AuthManager } = require('./authManager') as typeof import('./authManager');
  authManager = new AuthManager();
  authManager.setUserDataManager(userDataManager);

  taggedDocsManager = new TaggedDocsManager({
    dbPath: userDataManager.isLoggedIn()
      ? userDataManager.getUserDataPath('tagged.db')
      : userDataManager.getSharedDataPath('tagged.db'),
  });

  taggedDocsManager.on('updated', (docs: TaggedDoc[]) => {
    trayManager?.setTaggedDocsUnreadCount(docs.filter((doc) => doc.unread).length);
    browserHelperServer?.emitNativeEvent({ type: 'taggedDocs:updated', docs });
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(TaggedDocsIPCChannels.UPDATED, docs);
      }
    });
  });

  taggedDocsManager.on('scanProgress', (progress: TaggedDocsScanProgress) => {
    browserHelperServer?.emitNativeEvent({ type: 'taggedDocs:scanProgress', progress });
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
  startupMark('metrics-manager-init-complete');

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
      enableDynamicIslandFromPreferences();
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
      syncTaggedDocsRootsFromLibrary();
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
    if (!authManager) return;
    const sessionState = authManager.getSessionState();
    logUserState(session ? 'login' : 'logout');
    taggedDocsManager?.setIdentity(session?.user?.email ?? null);

    browserHelperServer?.emitNativeEvent({ type: 'auth:sessionChanged', session: sessionState });

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('session-changed', sessionState);
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

  // Now safe to init AuthManager - handlers are registered. Keep this off the
  // cold-start critical path; returning users can open local surfaces while the
  // SDK restores or refreshes the server session.
  void authManager.init(envVars.supabaseUrl, envVars.supabasePublishableKey)
    .then(() => startupMark('auth-manager-init-complete'))
    .catch((error) => {
      log.warn('Auth initialization failed during background startup:', error);
    });

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
  if (quotaManager && envVars.supabaseUrl && envVars.supabasePublishableKey) {
    quotaManager.init(envVars.supabaseUrl, envVars.supabasePublishableKey, () => {
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
  feedbackManager.on('messageReceived', (message) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(SocialIPCChannels.MESSAGE_RECEIVED, message);
      }
    });
  });

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

// Prevent multiple instances of the app. Dev quality probes can opt into an
// isolated parallel instance so instrumentation does not disturb the real app.
const allowParallelDevInstance = !app.isPackaged && ['1', 'true', 'yes', 'on'].includes((process.env.FIELD_THEORY_ALLOW_PARALLEL_INSTANCE ?? '').toLowerCase());
const gotTheLock = allowParallelDevInstance || app.requestSingleInstanceLock();

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
    const browserLibraryTarget = browserLibraryTargetFromProtocolUrl(parsed);
    if (browserLibraryTarget) {
      if (emitBrowserLibraryNavigationEvent({ type: 'commands:openMarkdownFromLauncher', target: browserLibraryTarget }, { broadcastFallback: false })) {
        return;
      }
      if (clipboardHistoryWindow) {
        const sizeKey: ClipboardHistorySizeKey = browserLibraryTarget.kind === 'bookmarks'
          ? clipboardHistoryWindow.getCurrentSizeKey()
          : 'library';
        const boundsToUse = restoreClipboardHistoryBounds(sizeKey);
        suspendDynamicIslandFocusForClipboardHistory('protocol-open-browser-library-target');
        clipboardHistoryWindow.showLibrary(boundsToUse);
        emitBrowserLibraryLauncherTarget(browserLibraryTarget);
        clipboardHistoryWindow.getWindow()?.webContents.send('commands:openMarkdownFromLauncher', browserLibraryTarget);
        return;
      }
    }

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
      if (emitBrowserLibraryNavigationEvent({ type: 'wiki:openPage', relPath }, { broadcastFallback: false })) {
        if (immersive) {
          emitBrowserLibraryNavigationEvent({ type: 'librarian:setFullscreen', fullscreen: true }, { broadcastFallback: false });
        }
        return;
      }

      if (clipboardHistoryWindow) {
        const boundsToUse = restoreClipboardHistoryBounds('library');
        suspendDynamicIslandFocusForClipboardHistory('show-reading');
        clipboardHistoryWindow.showLibrary(boundsToUse);
        emitBrowserLibraryNavigationEvent({ type: 'wiki:openPage', relPath });
        clipboardHistoryWindow.getWindow()?.webContents.send('wiki:openPage', relPath);
        if (immersive) {
          emitBrowserLibraryNavigationEvent({ type: 'librarian:setFullscreen', fullscreen: true });
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
          if (emitBrowserLibraryNavigationEvent({ type: 'librarian:showReading', readingPath: reading.path }, { broadcastFallback: false })) {
            if (fullscreen) {
              emitBrowserLibraryNavigationEvent({ type: 'librarian:setFullscreen', fullscreen: true }, { broadcastFallback: false });
            }
            return;
          }
          // Send the reading path to the renderer to display it
          emitBrowserLibraryNavigationEvent({ type: 'librarian:showReading', readingPath: reading.path });
          clipboardHistoryWindow?.getWindow()?.webContents.send('librarian:showReading', reading.path);
        }
      }

      // Show and focus the clipboard history window (show() handles focusing)
      if (clipboardHistoryWindow) {
        const boundsToUse = restoreClipboardHistoryBounds('library');
        suspendDynamicIslandFocusForClipboardHistory('show-reading');
        clipboardHistoryWindow.showLibrary(boundsToUse);
        // If fullscreen requested, notify renderer to enter fullscreen mode
        if (fullscreen) {
          emitBrowserLibraryNavigationEvent({ type: 'librarian:setFullscreen', fullscreen: true });
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
    const benchmarkId = qualityBenchmarkIdFromArgv(argv);
    if (benchmarkId) {
      if (shouldRunLauncherQualityBenchmark(argv)) {
        void runLauncherInteractionQualityBenchmark(benchmarkId);
      } else if (shouldRunLauncherNormalQualityBenchmark(argv)) {
        void runLauncherInteractionQualityBenchmark(benchmarkId, { focusProtection: false });
      } else if (shouldRunImmersiveQualityBenchmark(argv)) {
        void runImmersiveSurfaceQualityBenchmark(benchmarkId);
      } else if (shouldRunRecordingAsrDeliveryQualityBenchmark(argv)) {
        void runRecordingAsrDeliveryQualityBenchmark(benchmarkId);
      } else if (shouldRunRecordingAsrQualityBenchmark(argv)) {
        void runRecordingAsrQualityBenchmark(benchmarkId);
      } else if (shouldRunRecordingQualityBenchmark(argv)) {
        void runRecordingDeliveryQualityBenchmark(benchmarkId);
      } else {
        void runCommandLauncherQualityBenchmark(
          benchmarkId,
          shouldRunCommandQualityBenchmark(argv)
            ? 'command'
            : shouldRunBrowserQualityBenchmark(argv) ? 'browser' : shouldRunExternalQualityBenchmark(argv) ? 'external' : 'controlled',
        );
      }
      return;
    }

    // Handle URL from second instance (Windows/Linux)
    const url = argv.find(arg => arg.startsWith('fieldtheory://'));
    if (url) {
      handleProtocolUrl(url);
      return;
    }

    const markdownPath = argv.find(arg => /\.(?:md|markdown|mdx)$/i.test(arg) && !arg.startsWith('-'));
    if (markdownPath) {
      routeOpenMarkdown(markdownPath);
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

  installAppVisibilityTrace();

  app.whenReady().then(async () => {
    startupMark('app-when-ready');
    log.info('App ready');

    // ftmedia://media/<filename> → the bookmark media folder.
    protocol.handle('ftmedia', (req) => {
      const filename = path.basename(decodeURIComponent(new URL(req.url).pathname));
      const { resolveBookmarkMediaFile } = require('./bookmarksManager') as typeof import('./bookmarksManager');
      const filePath = resolveBookmarkMediaFile(filename);
      return filePath ? net.fetch(pathToFileURL(filePath).toString()) : new Response('', { status: 404 });
    });

    protocol.handle('ftlocalfile', async (req) => {
      const filePath = localImagePathFromProtocolUrl(req.url);
      if (!filePath || !isAllowedLocalImagePath(filePath)) {
        log.warn('ftlocalfile blocked invalid image URL: %s -> %s', req.url, filePath ? obscureHomePath(filePath) : '(unparseable)');
        return new Response('', { status: 404 });
      }
      try {
        const stat = await fs.promises.stat(filePath);
        const cacheHeaders = getLocalImageCacheHeaders(stat);
        if (shouldReturnLocalImageNotModified(stat, {
          ifNoneMatch: req.headers.get('if-none-match'),
          ifModifiedSince: req.headers.get('if-modified-since'),
        })) {
          return new Response(null, { status: 304, headers: cacheHeaders });
        }
        const image = await fs.promises.readFile(filePath);
        log.debug('ftlocalfile served image: %s (%d bytes)', obscureHomePath(filePath), image.byteLength);
        return new Response(image, {
          headers: {
            'Content-Type': getLocalImageContentType(filePath),
            ...cacheHeaders,
          },
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        log.warn('ftlocalfile failed to read image: %s (%s)', obscureHomePath(filePath), err.code ?? err.message ?? 'unknown error');
        return new Response('', { status: 404 });
      }
    });

    // Migrate data from legacy app directories (littleai-mac, Oscar) if needed.
    migrateFromLegacyPaths();
    const restoredUserDataManager = await ensureUserDataManagerRestored();

    if (!preferencesManager) {
      preferencesManager = new PreferencesManager();
    }
    preferencesManager.setUserDataManager(restoredUserDataManager);
    await preferencesManager.load();
    startupMark('startup-preferences-loaded');
    setupAppMetadataIPCHandlersOnce();
    showEarlyOnboardingIfNeeded();

    setupIPCHandlers();
    setupThemeIPCHandlers();
    setupLibrarianIPCHandlers();
    setupTaggedDocsIPCHandlers();
    setupSquaresIPCHandlers();
    setupGazeIPCHandlers();
    setupTranscribeIPCHandlersOnce();
    setupClipboardIPCHandlers();
    setupMeetingsIPCHandlers();
    setupOnboardingIPCHandlersOnce();
    setupDisplayListeners();
    startupMark('ipc-and-display-handlers-ready');
    showEarlyClipboardWindowIfNeeded();

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

    ipcMain.handle('hotmic:getRecordingIndicatorMode', () => {
      return dynamicIslandManager?.getRecordingIndicatorMode() ?? getRecordingIndicatorModeFromPreferences();
    });

    ipcMain.handle('hotmic:setRecordingIndicatorMode', async (_event, mode: RecordingIndicatorMode) => {
      const next = normalizeRecordingIndicatorMode(mode);
      if (preferencesManager) {
        await preferencesManager.save({ recordingIndicatorMode: next });
      }
      dynamicIslandManager?.setRecordingIndicatorMode(next);
      return next;
    });

    ipcMain.handle('hotmic:getResolvedRecordingIndicatorMode', () => {
      return dynamicIslandManager?.getResolvedRecordingIndicatorMode() ?? 'floating';
    });

    ipcMain.handle('hotmic:getFloatingIndicatorPosition', () => {
      return dynamicIslandManager?.getFloatingPosition() ?? getFloatingIndicatorPositionFromPreferences();
    });

    ipcMain.handle('hotmic:setFloatingIndicatorPosition', async (_event, position: FloatingIndicatorPosition | null) => {
      const next = normalizeFloatingIndicatorPosition(position);
      const applied = dynamicIslandManager?.setFloatingPosition(next) ?? next;
      if (preferencesManager) {
        await preferencesManager.save({ floatingIndicatorPosition: applied });
      }
      return applied;
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

    const checkForUpdatesManual = isAutoUpdaterEnabled
      ? () => {
        getAutoUpdater().checkForUpdates().catch((err) => reportAutoUpdaterError('Update check failed', err));
      }
      : undefined;

    startupMark('init-audio-start');
    await initAudioSystem(checkForUpdatesManual);
    startupMark('init-audio-complete');
    startupMark('init-transcriber-start');
    await initTranscriberSystem();
    startupMark('init-transcriber-complete');
    startupMark('init-clipboard-callbacks-start');
    await initClipboardCallbacks();
    startupMark('init-clipboard-callbacks-complete');

    // Preload clipboard history window for instant first open.
    // Always preload - even before onboarding completes, user may trigger hotkey.
    if (!clipboardHistoryWindow) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
      const boundsToUse = restoreClipboardHistoryBounds();
      clipboardHistoryWindow.preload(boundsToUse);
    }
    startupMark('clipboard-window-preload-called');
    maybeExitStartupBenchmark('clipboard-window-preload-called');

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
    // Default is app-window mode, with Dock/Cmd+Tab presence.
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

    if (isAutoUpdaterEnabled) {
      const autoUpdater = getAutoUpdater();
      // Initial check after 5s delay to not block UI.
      setTimeout(() => {
        autoUpdater.checkForUpdates();
      }, 5000);

      // Periodic check every 30 minutes.
      setInterval(() => {
        autoUpdater.checkForUpdates();
      }, 30 * 60 * 1000);

      // Auto-updater event handlers - send to renderer for in-app notification UI.
      autoUpdater.on('checking-for-update', () => {
        if (!shouldApplyUpdaterStatus('checking')) return;
        browserHelperServer?.emitNativeEvent({ type: 'updater:checkingForUpdate' });
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send('updater:checkingForUpdate');
          }
        });
      });

      autoUpdater.on('update-available', (info) => {
        if (!setPendingUpdateStatus('available', info.version)) return;
        browserHelperServer?.emitNativeEvent({ type: 'updater:updateAvailable', info: { version: info.version } });
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send('updater:updateAvailable', { version: info.version });
          }
        });
      });

      autoUpdater.on('update-not-available', (_info) => {
        sendUpdateNotAvailable();
      });

      autoUpdater.on('error', (err) => {
        log.error('Updater error:', err);
        sendUpdaterErrorMessage(formatAutoUpdaterErrorMessage(err));
      });

      autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        if (pendingUpdateInfo && !setPendingUpdateStatus('downloading')) return;
        browserHelperServer?.emitNativeEvent({ type: 'updater:downloadProgress', percent });
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send('updater:downloadProgress', percent);
          }
        });
      });

      autoUpdater.on('update-downloaded', (info) => {
        if (!setPendingUpdateStatus('ready', info.version)) return;
        browserHelperServer?.emitNativeEvent({ type: 'updater:updateDownloaded', info: { version: info.version } });
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send('updater:updateDownloaded', { version: info.version });
          }
        });
      });
    }

    setupAppMetadataIPCHandlersOnce();

    // Updater IPC handlers.
    ipcMain.handle('updater:checkForUpdates', () => {
      return checkForAppUpdates();
    });

    ipcMain.handle('updater:downloadUpdate', () => {
      return downloadAppUpdate();
    });

    ipcMain.handle('updater:installUpdate', () => {
      return installAppUpdate();
    });

    ipcMain.handle('updater:dismissUpdate', () => {
      return dismissAppUpdate();
    });

    // Check permissions on startup and notify main window
    const permissions = await checkPermissions();
    startupMark('permissions-checked');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('permissions-status', permissions);
      });
    }
    
    // Permission and model check at startup.
    // Returning users with saved local setup should still load their current app
    // surface; experimental builds can have fresh macOS permission state.
    const prefs = preferencesManager?.get();
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    const accessibilityStatus = systemPreferences.isTrustedAccessibilityClient(false);
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');

    // Check if the configured transcription engine is ready
    const modelDownloaded = await isTranscriptionEngineReady();
    startupMark('transcription-engine-ready-checked');

    // Check if user is authenticated. A returning user with a stored local
    // session can use offline/local features while token refresh catches up.
    const isAuthenticated = authManager?.isAuthenticated() ?? false;
    const canUseLocalAccount =
      isAuthenticated ||
      (authManager?.hasEverBeenAuthenticated() ?? false) ||
      (userDataManager?.isLoggedIn() ?? false);

    const hasAllPermissions =
      micStatus === 'granted' &&
      accessibilityStatus &&
      screenStatus === 'granted';
    const startupReadiness = resolveStartupReadiness({
      onboardingComplete: prefs?.onboardingComplete === true,
      hasAllPermissions,
      modelReady: modelDownloaded,
      canUseLocalAccount,
    });

    if (startupReadiness.showApp) {
      // All requirements met, or this is a returning local user. Mark only
      // fully ready users complete so incomplete onboarding is preserved for
      // genuinely new users.
      if (!prefs?.onboardingComplete || prefs?.onboardingStep !== undefined) {
        if (startupReadiness.fullyReady) {
          await preferencesManager?.save({ onboardingComplete: true, onboardingStep: undefined });
        }
      }
      if (onboardingWindow) {
        onboardingWindow.close();
        onboardingWindow = null;
      }
      if (hasAllPermissions) {
        registerHotkeysAfterOnboarding();
      } else {
        getHotkeyManager().unregisterAll();
      }
      showClipboardHistoryOnStartup();
      startupMark('startup-decision-complete');
      maybeExitStartupBenchmark('startup-decision-complete');
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
      startupMark('startup-decision-complete');
      maybeExitStartupBenchmark('startup-decision-complete');
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

      const canUseLocalAccountNow =
        authenticated ||
        hasEverAuthenticated ||
        (userDataManager?.isLoggedIn() ?? false);

      // Check if permissions are revoked. Returning users keep the app surface;
      // permission-dependent features can prompt from inside the app.
      if (!hasAllPermissions) {
        // Unregister all hotkeys - they shouldn't work without permissions
        getHotkeyManager().unregisterAll();

        if (canUseLocalAccountNow) {
          return;
        }

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

  app.on('before-quit', (event) => {
    const blockingActivities = getQuitBlockingActivities();
    if (!appQuitConfirmedWithLocalWork && blockingActivities.length > 0) {
      event.preventDefault();
      if (appQuitConfirmationOpen) return;
      appQuitConfirmationOpen = true;

      const options = {
        type: 'warning' as const,
        buttons: ['Quit and Stop Them', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Quit Field Theory?',
        message: 'Field Theory is still running local work.',
        detail: formatQuitBlockingActivityDetail(blockingActivities),
      };
      const parent = BrowserWindow.getFocusedWindow()
        ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      const prompt = parent
        ? dialog.showMessageBox(parent, options)
        : dialog.showMessageBox(options);

      void prompt.then(({ response }) => {
        appQuitConfirmationOpen = false;
        if (response === 0) {
          appQuitConfirmedWithLocalWork = true;
          app.quit();
        }
      }).catch((error) => {
        appQuitConfirmationOpen = false;
        log.warn('Quit confirmation failed: %s', error instanceof Error ? error.message : String(error));
      });
      return;
    }

    log.info('App quitting, cleaning up...');

    if (!appQuitWatcherCleanupComplete) {
      event.preventDefault();
      void cleanupFileWatchersBeforeQuit().then(() => {
        app.quit();
      }).catch((error) => {
        log.warn('File watcher cleanup before quit failed: %s', error instanceof Error ? error.message : String(error));
        appQuitWatcherCleanupComplete = true;
        app.quit();
      });
      return;
    }

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

    agentKickoffManager?.destroy();

    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.destroy();
    }

    libraryDocumentWindowManager?.destroy();

    librarySyncService?.dispose();
    clearPendingSharedFilesSync();
    void sharedSyncService?.dispose();
    void browserHelperServer?.stop();
    browserHelperServer = null;
    commandSyncService?.destroy();
    todoStore?.destroy();
    localLlmManager?.stop();

    // Sync metrics before quitting (fire-and-forget, don't block quit)
    if (metricsManager) {
      metricsManager.shutdown().catch(() => {});
    }
  });
}
