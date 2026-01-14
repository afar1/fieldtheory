/**
 * IPC channels and types for Portable Commands feature.
 */

// IPC channel names for commands management.
export const CommandsIPCChannels = {
  // Directory management
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
} as const;

/**
 * Represents a portable command for display in the UI.
 */
export interface PortableCommandInfo {
  name: string;           // Command name (filename without extension)
  displayName: string;    // Human-readable name
  filePath: string;       // Full path to the markdown file
}
