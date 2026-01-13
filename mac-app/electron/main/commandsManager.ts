/**
 * Portable Commands Manager
 * 
 * Manages user's portable commands (markdown files) that can be invoked from
 * any application. Users can point to a directory containing markdown files
 * (like Claude skills, Cursor rules, etc.) and invoke them by name.
 * 
 * Detection: When the user says "use the X command" or "please use commands X, Y",
 * we detect the command names and load the corresponding markdown content.
 * 
 * The loaded markdown is then injected into the prompt for the LLM to follow.
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * Represents a portable command (markdown file).
 */
export interface PortableCommand {
  name: string;           // Command name (filename without extension)
  filePath: string;       // Full path to the markdown file
  displayName: string;    // Human-readable name (e.g., "Debug" from "debug.md")
  lastModified: number;   // File modification time for cache invalidation
}

/**
 * Result of parsing a user's text for command invocations.
 */
export interface CommandDetectionResult {
  detected: boolean;                // Whether any commands were detected
  commandNames: string[];           // Names of commands that were invoked
  matchedCommands: PortableCommand[]; // Commands that exist in the user's library
  unmatchedNames: string[];         // Command names that weren't found
  originalText: string;             // The original user text
  textWithoutCommandRefs: string;   // Text with command references stripped
}

/**
 * Result of loading command content.
 */
export interface LoadedCommand {
  name: string;
  content: string;
  filePath: string;
}

/**
 * Events emitted by CommandsManager.
 */
export interface CommandsManagerEvents {
  commandsChanged: (commands: PortableCommand[]) => void;
  directoryChanged: (directoryPath: string | null) => void;
}

/**
 * Manages portable commands from a user-configured directory.
 * Scans for markdown files and provides lookup/loading functionality.
 */
export class CommandsManager extends EventEmitter {
  private directoryPath: string | null = null;
  private commands: Map<string, PortableCommand> = new Map();
  private watcherAbort: AbortController | null = null;

  constructor() {
    super();
  }

  /**
   * Set the commands directory path and scan for commands.
   * Pass null to disable commands.
   */
  async setDirectory(directoryPath: string | null): Promise<void> {
    // Stop watching old directory
    if (this.watcherAbort) {
      try {
        this.watcherAbort.abort();
      } catch (e) {
        // Ignore abort errors
      }
      this.watcherAbort = null;
    }

    // Expand ~ to home directory
    let expandedPath = directoryPath;
    if (expandedPath && expandedPath.startsWith('~/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      expandedPath = path.join(homeDir, expandedPath.slice(2));
    } else if (expandedPath === '~') {
      expandedPath = process.env.HOME || process.env.USERPROFILE || '';
    }

    this.directoryPath = expandedPath;
    this.commands.clear();

    if (expandedPath) {
      try {
        await this.scanDirectory();
      } catch (error) {
        console.error('[CommandsManager] Error scanning directory:', error);
      }

      // Start watching in a try-catch - don't let watcher issues crash the app
      try {
        this.startWatching();
      } catch (error) {
        console.warn('[CommandsManager] Could not start file watcher (non-fatal):', error);
      }
    }

    this.emit('directoryChanged', directoryPath);
    this.emit('commandsChanged', this.getCommands());
    console.log(`[CommandsManager] Directory set to: ${directoryPath || '(none)'}`);
  }

  /**
   * Get the currently configured directory path.
   */
  getDirectory(): string | null {
    return this.directoryPath;
  }

  /**
   * Get all available commands.
   */
  getCommands(): PortableCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get a command by name (case-insensitive).
   */
  getCommand(name: string): PortableCommand | null {
    return this.commands.get(name.toLowerCase()) || null;
  }

  /**
   * Check if a command exists.
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  /**
   * Scan the directory for markdown files and build the commands index.
   */
  private async scanDirectory(): Promise<void> {
    if (!this.directoryPath) return;

    try {
      // Check if directory exists
      if (!fs.existsSync(this.directoryPath)) {
        console.warn(`[CommandsManager] Directory does not exist: ${this.directoryPath}`);
        return;
      }

      const stats = fs.statSync(this.directoryPath);
      if (!stats.isDirectory()) {
        console.warn(`[CommandsManager] Path is not a directory: ${this.directoryPath}`);
        return;
      }

      // Recursively scan for markdown files
      await this.scanDirectoryRecursive(this.directoryPath);
      
      console.log(`[CommandsManager] Found ${this.commands.size} commands in ${this.directoryPath}`);
    } catch (error) {
      console.error('[CommandsManager] Error scanning directory:', error);
    }
  }

  /**
   * Recursively scan a directory for markdown files.
   */
  private async scanDirectoryRecursive(dirPath: string): Promise<void> {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files/directories
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectoryRecursive(fullPath);
        } else if (entry.isFile() && this.isMarkdownFile(entry.name)) {
          // Add markdown file as a command
          const command = this.createCommandFromFile(fullPath);
          if (command) {
            this.commands.set(command.name, command);
          }
        }
      }
    } catch (error) {
      console.error(`[CommandsManager] Error scanning ${dirPath}:`, error);
    }
  }

  /**
   * Check if a file is a markdown file.
   */
  private isMarkdownFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ext === '.md' || ext === '.markdown';
  }

  /**
   * Create a PortableCommand from a file path.
   */
  private createCommandFromFile(filePath: string): PortableCommand | null {
    try {
      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);
      const nameWithoutExt = filename.replace(/\.(md|markdown)$/i, '');
      
      // Convert filename to command name: kebab-case or snake_case -> spaces
      // e.g., "debug-assistant.md" -> "debug assistant"
      const displayName = nameWithoutExt
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase()); // Title case

      return {
        name: nameWithoutExt.toLowerCase(),
        filePath,
        displayName,
        lastModified: stats.mtimeMs,
      };
    } catch (error) {
      console.error(`[CommandsManager] Error creating command from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Start watching the directory for changes.
   * Note: fs.watch with recursive can be unstable on macOS, so we wrap in try-catch
   * and gracefully degrade if watching fails.
   */
  private startWatching(): void {
    if (!this.directoryPath) return;

    try {
      this.watcherAbort = new AbortController();

      // Use fs.watch with AbortController for cleanup
      // Wrap in try-catch because recursive watching can be unstable on macOS
      const watcher = fs.watch(
        this.directoryPath,
        { recursive: true, signal: this.watcherAbort.signal },
        async (eventType, filename) => {
          try {
            if (filename && this.isMarkdownFile(filename)) {
              console.log(`[CommandsManager] File changed: ${filename}`);
              // Rescan the directory to update commands
              this.commands.clear();
              await this.scanDirectory();
              this.emit('commandsChanged', this.getCommands());
            }
          } catch (error) {
            console.error('[CommandsManager] Error handling file change:', error);
          }
        }
      );

      // Handle watcher errors gracefully
      watcher.on('error', (error) => {
        console.warn('[CommandsManager] File watcher error (non-fatal):', error);
        // Don't crash - the commands will still work, just won't auto-refresh
      });
      
      console.log(`[CommandsManager] Watching directory: ${this.directoryPath}`);
    } catch (error) {
      console.error('[CommandsManager] Error starting directory watch:', error);
    }
  }

  /**
   * Detect command invocations in user text.
   *
   * Simple detection: looks for the word "command" near a known command name.
   * This is flexible enough to catch natural speech variations like:
   * - "use the debug command"
   * - "debug command please"
   * - "with the debug command"
   * - "apply the debug command here"
   *
   * Returns detection results including matched commands.
   */
  detectCommands(text: string): CommandDetectionResult {
    const result: CommandDetectionResult = {
      detected: false,
      commandNames: [],
      matchedCommands: [],
      unmatchedNames: [],
      originalText: text,
      textWithoutCommandRefs: text,
    };

    if (!this.directoryPath || this.commands.size === 0) {
      return result;
    }

    const lowerText = text.toLowerCase();

    // Check if "command" or "commands" appears in the text
    if (!lowerText.includes('command')) {
      return result;
    }

    // For each known command, check if its name appears near "command"
    for (const [commandName, command] of this.commands) {
      // Find all occurrences of the command name
      let searchStart = 0;
      while (true) {
        const nameIndex = lowerText.indexOf(commandName, searchStart);
        if (nameIndex === -1) break;

        // Check if "command" appears within 30 characters of the command name
        const windowStart = Math.max(0, nameIndex - 30);
        const windowEnd = Math.min(lowerText.length, nameIndex + commandName.length + 30);
        const nearbyText = lowerText.slice(windowStart, windowEnd);

        if (nearbyText.includes('command')) {
          result.matchedCommands.push(command);
          result.commandNames.push(commandName);
          break; // Found this command, move to next
        }

        searchStart = nameIndex + 1;
      }
    }

    result.detected = result.matchedCommands.length > 0;

    // Strip command invocation phrases from text for cleaner output
    if (result.detected) {
      let cleanText = text;
      // Remove common patterns that mention commands
      for (const name of result.commandNames) {
        // Remove variations like "use the X command", "X command", "command X"
        const patterns = [
          new RegExp(`\\b(?:use|apply|run|invoke|with)\\s+(?:the\\s+)?${name}\\s+commands?\\b`, 'gi'),
          new RegExp(`\\b${name}\\s+commands?\\b`, 'gi'),
          new RegExp(`\\bcommands?\\s+${name}\\b`, 'gi'),
        ];
        for (const pattern of patterns) {
          cleanText = cleanText.replace(pattern, '');
        }
      }
      // Clean up extra whitespace
      result.textWithoutCommandRefs = cleanText.replace(/\s+/g, ' ').trim();
    }

    return result;
  }

  /**
   * Load the content of a command from its markdown file.
   */
  async loadCommandContent(command: PortableCommand): Promise<LoadedCommand | null> {
    try {
      // Check if file still exists
      if (!fs.existsSync(command.filePath)) {
        console.warn(`[CommandsManager] Command file no longer exists: ${command.filePath}`);
        return null;
      }

      const content = fs.readFileSync(command.filePath, 'utf-8');
      
      return {
        name: command.name,
        content,
        filePath: command.filePath,
      };
    } catch (error) {
      console.error(`[CommandsManager] Error loading command ${command.name}:`, error);
      return null;
    }
  }

  /**
   * Load content for multiple commands.
   */
  async loadCommands(commands: PortableCommand[]): Promise<LoadedCommand[]> {
    const results: LoadedCommand[] = [];
    
    for (const command of commands) {
      const loaded = await this.loadCommandContent(command);
      if (loaded) {
        results.push(loaded);
      }
    }
    
    return results;
  }

  /**
   * Format loaded commands for injection into a prompt.
   * Creates a clear section that instructs the LLM to follow the commands.
   */
  formatCommandsForPrompt(loadedCommands: LoadedCommand[]): string {
    if (loadedCommands.length === 0) {
      return '';
    }

    const sections = loadedCommands.map(cmd => {
      return `## Command: ${cmd.name}\n\n${cmd.content}`;
    });

    return `
---
# User Commands

The user has invoked the following commands. Please follow the instructions in each command carefully.

${sections.join('\n\n---\n\n')}

---
End of User Commands
---

`;
  }

  /**
   * Insert inline command references into text (like [Figure A] for screenshots).
   * Format: [cmd:command-name.md]
   * Returns the text with references inserted at the end.
   */
  insertCommandReferences(text: string, commands: PortableCommand[]): string {
    if (commands.length === 0) {
      return text;
    }

    // Add command references at the end of the text
    const refs = commands.map(cmd => `[cmd:${cmd.name}.md]`).join(' ');
    return `${text} ${refs}`;
  }

  /**
   * Format commands for terminal output with numbered references.
   * Similar to how figures are displayed for terminals.
   *
   * Example output:
   * Your text here [cmd1] [cmd2]
   *
   * Commands:
   * [cmd1] /path/to/debug.md
   * [cmd2] /path/to/review.md
   */
  formatCommandsForTerminal(text: string, commands: PortableCommand[]): string {
    if (commands.length === 0) {
      return text;
    }

    // Replace [cmd:name.md] references with numbered [cmd1], [cmd2], etc.
    let formattedText = text;
    const commandPaths: string[] = [];

    commands.forEach((cmd, index) => {
      const cmdNum = index + 1;
      const refPattern = new RegExp(`\\[cmd:${cmd.name}\\.md\\]`, 'gi');
      formattedText = formattedText.replace(refPattern, `[cmd${cmdNum}]`);
      commandPaths.push(`[cmd${cmdNum}] ${cmd.filePath}`);
    });

    // Add the commands list at the end
    if (commandPaths.length > 0) {
      formattedText += '\n\nCommands:\n' + commandPaths.join('\n');
    }

    return formattedText;
  }

  /**
   * Process text to detect and expand commands.
   * Returns the enhanced text with command content injected if any were detected.
   */
  async processTextWithCommands(text: string): Promise<{
    processedText: string;
    commandsApplied: string[];
    commandsNotFound: string[];
  }> {
    const detection = this.detectCommands(text);

    if (!detection.detected) {
      return {
        processedText: text,
        commandsApplied: [],
        commandsNotFound: detection.unmatchedNames,
      };
    }

    // Load the matched commands
    const loadedCommands = await this.loadCommands(detection.matchedCommands);
    
    // Format for injection
    const commandsSection = this.formatCommandsForPrompt(loadedCommands);

    // Combine: commands section + user's text (with command refs stripped)
    const processedText = commandsSection + detection.textWithoutCommandRefs;

    return {
      processedText,
      commandsApplied: loadedCommands.map(c => c.name),
      commandsNotFound: detection.unmatchedNames,
    };
  }

  /**
   * Refresh the commands list by rescanning the directory.
   */
  async refresh(): Promise<void> {
    this.commands.clear();
    await this.scanDirectory();
    this.emit('commandsChanged', this.getCommands());
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.watcherAbort) {
      this.watcherAbort.abort();
      this.watcherAbort = null;
    }
    this.commands.clear();
  }
}
