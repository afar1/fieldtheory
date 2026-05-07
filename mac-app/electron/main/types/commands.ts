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
  REFRESH_COMMANDS: 'commands:refreshCommands',

  // Command content
  GET_COMMAND_CONTENT: 'commands:getCommandContent',
  GET_MARKDOWN_PREVIEW: 'commands:getMarkdownPreview',

  // Direct invocation (from command launcher)
  INVOKE_COMMAND: 'commands:invoke',
  RUN_LOCAL_COMMAND: 'commands:runLocalCommand',
  LIST_MAXWELL_RUNS: 'commands:listMaxwellRuns',
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
}

export interface LocalCommandRunResult {
  success: boolean;
  error?: string;
  filePath?: string;
  commandName?: string;
  mode?: LocalCommandRunMode;
  runId?: string;
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
