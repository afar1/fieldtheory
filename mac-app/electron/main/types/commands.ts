/**
 * IPC channels and types for Portable Commands feature.
 */

// IPC channel names for commands management.
export const CommandsIPCChannels = {
  // Legacy single-directory management
  GET_DIRECTORY: 'commands:getDirectory',
  SET_DIRECTORY: 'commands:setDirectory',
  BROWSE_DIRECTORY: 'commands:browseDirectory',

  // Commands listing
  GET_COMMANDS: 'commands:getCommands',
  GET_COMMAND_DIRECTORIES: 'commands:getCommandDirectories',
  REFRESH_COMMANDS: 'commands:refreshCommands',

  // Command content
  GET_COMMAND_CONTENT: 'commands:getCommandContent',
  GET_MARKDOWN_PREVIEW: 'commands:getMarkdownPreview',

  // Direct invocation (from command launcher)
  INVOKE_COMMAND: 'commands:invoke',
  LIST_LAUNCHER_APPS: 'commands:listLauncherApps',
  LAUNCH_APP: 'commands:launchApp',
  GET_LAUNCHER_FILE_ICON: 'commands:getLauncherFileIcon',
  SEARCH_LAUNCHER_FILES: 'commands:searchLauncherFiles',
  OPEN_LAUNCHER_FILE: 'commands:openLauncherFile',
  WARM_LAUNCHER_FILE_INDEX: 'commands:warmLauncherFileIndex',
  GET_LAUNCHER_SETTINGS: 'commands:getLauncherSettings',
  SET_LAUNCHER_SETTINGS: 'commands:setLauncherSettings',
  RUN_LOCAL_COMMAND: 'commands:runLocalCommand',
  LIST_MAXWELL_RUNS: 'commands:listMaxwellRuns',
  GET_MAXWELL_MEMORY: 'commands:getMaxwellMemory',
  SAVE_MAXWELL_MEMORY: 'commands:saveMaxwellMemory',
  CANCEL_MAXWELL_RUN: 'commands:cancelMaxwellRun',
  UNDO_MAXWELL_RUN: 'commands:undoMaxwellRun',
  REDO_MAXWELL_RUN: 'commands:redoMaxwellRun',

  // Events
  COMMANDS_CHANGED: 'commands:commandsChanged',
  DIRECTORY_CHANGED: 'commands:directoryChanged',
  LOCAL_COMMAND_STATUS: 'commands:localCommandStatus',

  // Multi-directory management
  INITIALIZE: 'commands:initialize',
  GET_WATCHED_DIRS: 'commands:getWatchedDirs',
  ADD_WATCHED_DIR: 'commands:addWatchedDir',
  REMOVE_WATCHED_DIR: 'commands:removeWatchedDir',
  GET_DEFAULT_DIRECTORY: 'commands:getDefaultDirectory',
  CREATE_DEFAULT_DIRECTORY: 'commands:createDefaultDirectory',

  // CRUD operations
  GET_COMMAND_BY_PATH: 'commands:getCommandByPath',
  SAVE_COMMAND: 'commands:saveCommand',
  CREATE_COMMAND: 'commands:createCommand',
  DELETE_COMMAND: 'commands:deleteCommand',
  RENAME_COMMAND: 'commands:renameCommand',

  // Mobile sync operations
  SET_MOBILE_SYNC: 'commands:setMobileSync',
  GET_MOBILE_SYNC_STATUS: 'commands:getMobileSyncStatus',
  SYNC_TO_MOBILE: 'commands:syncToMobile',
  GET_REMOTE_COMMAND_COUNT: 'commands:getRemoteCommandCount',

  // Handoffs - global session handoff files
  GET_HANDOFFS: 'commands:getHandoffs',
  GET_HANDOFF_CONTENT: 'commands:getHandoffContent',
} as const;

/**
 * Represents a portable command for display in the UI.
 */
export interface PortableCommandInfo {
  name: string;           // Command name (filename without extension)
  displayName: string;    // Human-readable name
  filePath: string;       // Full path to the markdown file
  lastModified: number;   // File modification time
}

export interface PortableCommandDirectoryInfo {
  name: string;
  displayName: string;
  rootPath: string;
  directoryPath: string;
  directoryRelPath: string;
  lastModified: number;
}

export interface LauncherAppInfo {
  name: string;
  displayName: string;
  appPath: string;
  bundleId?: string;
  lastModified: number;
}

export interface LauncherFileInfo {
  name: string;
  displayName: string;
  filePath: string;
  isDirectory: boolean;
  lastModified: number;
}

export interface LauncherFileSearchResult {
  files: LauncherFileInfo[];
  indexing: boolean;
  indexedAt: number | null;
}

export interface LauncherFileIconResult {
  success: boolean;
  iconDataUrl?: string;
  error?: string;
}

export type LauncherRootSearchEnabledKinds = Record<string, boolean>;

export interface LauncherSettings {
  rootSearchEnabledKinds: LauncherRootSearchEnabledKinds;
}

export type LocalCommandRunMode = 'document' | 'selection';

export interface LocalCommandSelectionInput {
  start?: number;
  end?: number;
  text?: string;
}

export interface LocalCommandRunRequest {
  commandName?: string;
  customInstruction?: string;
  mode?: LocalCommandRunMode;
  selection?: LocalCommandSelectionInput | null;
  useMemory?: boolean;
}

export interface LocalCommandRunResult {
  success: boolean;
  error?: string;
  filePath?: string;
  commandName?: string;
  mode?: LocalCommandRunMode;
  runId?: string;
}

export interface MaxwellCancelResult {
  success: boolean;
  error?: string;
  run?: MaxwellRunSummary;
}

export interface MaxwellMemoryState {
  enabled: boolean;
  content: string;
  path: string;
  updatedAt: number | null;
  maxChars: number;
}

export interface MaxwellMemorySaveRequest {
  enabled: boolean;
  content: string;
}

export interface MaxwellMemorySaveResult {
  success: boolean;
  error?: string;
  memory?: MaxwellMemoryState;
}

export interface LocalCommandStatus {
  status: 'running' | 'success' | 'error' | 'notice';
  message: string;
  detail?: string;
  eventKind?: 'status' | 'model_output' | 'tool_call' | 'file_change' | 'error';
  commandName?: string;
  filePath?: string;
  mode?: LocalCommandRunMode;
  runId?: string;
  phase?: string;
  changedLines?: number;
  changedBytes?: number;
  error?: string;
  updatedAt: number;
}

export type MaxwellRunStatus =
  | 'pending'
  | 'generated'
  | 'success'
  | 'generation_error'
  | 'selection_error'
  | 'save_conflict'
  | 'save_error'
  | 'cancelled'
  | 'reverted';

export type MaxwellRunMode = 'document' | 'selection';
export type MaxwellTargetType = 'wiki' | 'reading';

export interface MaxwellRunSummary {
  runId: string;
  createdAt: number;
  updatedAt: number;
  status: MaxwellRunStatus;
  commandName: string;
  targetPath: string;
  targetRelPath: string | null;
  targetType: MaxwellTargetType;
  mode: MaxwellRunMode;
  summary: string | null;
  errorMessage: string | null;
  model: string | null;
  harness: string | null;
  memoryUsed: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export type MaxwellUndoFailureReason =
  | 'not-ready'
  | 'not-found'
  | 'not-applied'
  | 'not-reverted'
  | 'conflict'
  | 'blocked'
  | 'save-error'
  | 'error';

export type MaxwellRedoFailureReason = MaxwellUndoFailureReason;

export type MaxwellUndoResult =
  | {
      success: true;
      run: MaxwellRunSummary;
      filePath: string;
      commandName: string;
    }
  | {
      success: false;
      reason: MaxwellUndoFailureReason;
      error: string;
      run?: MaxwellRunSummary;
    };

export type MaxwellRedoResult =
  | {
      success: true;
      run: MaxwellRunSummary;
      filePath: string;
      commandName: string;
    }
  | {
      success: false;
      reason: MaxwellRedoFailureReason;
      error: string;
      run?: MaxwellRunSummary;
    };

/**
 * Represents a watched directory.
 */
export interface WatchedDir {
  path: string;
  enabled: boolean;
  /** Whether this directory's commands are synced to mobile */
  mobileSyncEnabled: boolean;
}

/**
 * Result of a mobile sync operation.
 */
export interface CommandSyncResult {
  success: boolean;
  uploaded: number;
  updated: number;
  deleted: number;
  errors: string[];
}

/**
 * Command with full content loaded.
 */
export interface CommandWithContent extends PortableCommandInfo {
  lastModified: number;
  content: string;
  documentVersion: {
    mtimeMs: number;
    size: number;
    sha256: string;
  };
}
