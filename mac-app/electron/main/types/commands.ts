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

  // Direct invocation (from command launcher)
  INVOKE_COMMAND: 'commands:invoke',

  // Events
  COMMANDS_CHANGED: 'commands:commandsChanged',
  DIRECTORY_CHANGED: 'commands:directoryChanged',

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
} as const;

/**
 * Represents a portable command for display in the UI.
 */
export interface PortableCommandInfo {
  name: string;           // Command name (filename without extension)
  displayName: string;    // Human-readable name
  filePath: string;       // Full path to the markdown file
}

/**
 * Represents a watched directory.
 */
export interface WatchedDir {
  path: string;
  enabled: boolean;
}

/**
 * Command with full content loaded.
 */
export interface CommandWithContent extends PortableCommandInfo {
  lastModified: number;
  content: string;
}
