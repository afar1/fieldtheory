/**
 * Portable Commands Manager
 *
 * Manages user's portable commands (markdown files) that can be invoked from
 * any application. Users can point to directories containing markdown files
 * (like Claude skills, Cursor rules, etc.) and invoke them by name.
 *
 * Detection: When the user says "use the X command" or "please use commands X, Y",
 * we detect the command names and load the corresponding markdown content.
 *
 * The loaded markdown is then injected into the prompt for the LLM to follow.
 *
 * Now supports:
 * - Multiple watched directories (like Librarian)
 * - Full CRUD operations (create, read, update, delete)
 * - Default directory creation
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';

/**
 * Settings stored in JSON file.
 */
interface CommandsSettings {
  watchedDirs: string[];
}

/**
 * Represents a watched directory.
 */
export interface WatchedDir {
  path: string;
  enabled: boolean;
}

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
 * Command with full content loaded.
 */
export interface CommandWithContent extends PortableCommand {
  content: string;
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
 * Manages portable commands from user-configured directories.
 * Scans for markdown files and provides lookup/loading functionality.
 * Now supports multiple directories and full CRUD operations.
 */
export class CommandsManager extends EventEmitter {
  private settings: CommandsSettings = { watchedDirs: [] };
  private settingsPath: string;
  private commands: Map<string, PortableCommand> = new Map();
  private watchers: Map<string, AbortController> = new Map();

  // Legacy single directory support (for migration)
  private directoryPath: string | null = null;
  private watcherAbort: AbortController | null = null;

  constructor() {
    super();

    // Settings file path
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'commands-settings.json');

    // Load settings
    this.loadSettings();
  }

  /**
   * Load settings from JSON file.
   */
  private loadSettings(): void {
    const defaults: CommandsSettings = { watchedDirs: [] };

    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        this.settings = {
          watchedDirs: data.watchedDirs || defaults.watchedDirs,
        };
      } else {
        this.settings = defaults;
      }
    } catch (error) {
      console.error('[CommandsManager] Error loading settings:', error);
      this.settings = defaults;
    }
  }

  /**
   * Save settings to JSON file.
   */
  private saveSettings(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.error('[CommandsManager] Error saving settings:', error);
    }
  }

  /**
   * Initialize the manager - scan all watched directories.
   */
  async initialize(): Promise<void> {
    // Scan all watched directories
    for (const dirPath of this.settings.watchedDirs) {
      await this.scanDirectory(dirPath);
      this.watchDirectory(dirPath);
    }

    this.emit('commandsChanged', this.getCommands());
    console.log(`[CommandsManager] Initialized with ${this.settings.watchedDirs.length} directories, ${this.commands.size} commands`);
  }

  /**
   * Get the default commands directory path.
   * Creates ~/Library/Application Support/field-theory/commands/ if it doesn't exist.
   */
  getDefaultDirectory(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'commands');
  }

  /**
   * Create and add the default commands directory.
   * Returns the path if successful, null otherwise.
   */
  async createDefaultDirectory(): Promise<string | null> {
    const defaultDir = this.getDefaultDirectory();

    try {
      if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
        console.log(`[CommandsManager] Created default directory: ${defaultDir}`);
      }

      // Add to watched directories
      const result = await this.addWatchedDir(defaultDir);
      if (result) {
        return defaultDir;
      }
      return defaultDir; // Already exists and is watched
    } catch (error) {
      console.error('[CommandsManager] Error creating default directory:', error);
      return null;
    }
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
   * Expand ~ to home directory in a path.
   */
  private expandPath(dirPath: string): string {
    if (dirPath.startsWith('~/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(homeDir, dirPath.slice(2));
    } else if (dirPath === '~') {
      return process.env.HOME || process.env.USERPROFILE || '';
    }
    return dirPath;
  }

  /**
   * Normalize a path for consistent comparison.
   */
  private normalizePath(dirPath: string): string {
    return path.normalize(dirPath);
  }

  /**
   * Scan a specific directory for markdown files and add to the commands index.
   * If no path provided, scans all watched directories.
   */
  private async scanDirectory(dirPath?: string): Promise<void> {
    // If specific path provided, scan that directory
    if (dirPath) {
      try {
        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
          console.warn(`[CommandsManager] Directory does not exist: ${dirPath}`);
          return;
        }

        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
          console.warn(`[CommandsManager] Path is not a directory: ${dirPath}`);
          return;
        }

        // Recursively scan for markdown files
        await this.scanDirectoryRecursive(dirPath);

        console.log(`[CommandsManager] Scanned ${dirPath}`);
      } catch (error) {
        console.error(`[CommandsManager] Error scanning directory ${dirPath}:`, error);
      }
      return;
    }

    // Legacy: scan single directory if set
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
   * Uses smart detection based on singular vs plural usage:
   * - "command" (singular) → find the ONE nearest command name
   * - "commands" (plural) → find multiple command names (list mode)
   *
   * This prevents false positives where a command name happens to be a common word.
   * For example: "please include some stuff and run the flow command"
   * → only matches "flow", not "include" (even if "include" is a command name)
   *
   * Examples:
   * - "run the include command" → matches: include
   * - "please include some stuff and run the flow command" → matches: flow only
   * - "use the commands include, commit, and main" → matches: include, commit, main
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

    // If no commands are loaded (from either legacy single-dir or multi-dir), skip detection
    if (this.commands.size === 0) {
      return result;
    }

    const lowerText = text.toLowerCase();

    // Check if "command" or "commands" appears in the text.
    if (!lowerText.includes('command')) {
      return result;
    }

    // Track which commands we've already matched to avoid duplicates.
    const matchedCommandNames = new Set<string>();

    // Find all occurrences of "command" (singular) and "commands" (plural).
    // We process them in order of appearance to handle cases correctly.
    const commandWordMatches = this.findCommandWords(lowerText);

    for (const match of commandWordMatches) {
      if (match.isPlural) {
        // Plural "commands" → look for multiple command names in a list.
        // Typically appears as: "use the commands X, Y, and Z"
        const listCommands = this.findCommandsInList(lowerText, match.index, matchedCommandNames);
        for (const cmd of listCommands) {
          if (!matchedCommandNames.has(cmd.name)) {
            matchedCommandNames.add(cmd.name);
            result.matchedCommands.push(cmd);
            result.commandNames.push(cmd.name);
          }
        }
      } else {
        // Singular "command" → find the ONE nearest command name.
        const nearestCommand = this.findNearestCommand(lowerText, match.index, matchedCommandNames);
        if (nearestCommand && !matchedCommandNames.has(nearestCommand.name)) {
          matchedCommandNames.add(nearestCommand.name);
          result.matchedCommands.push(nearestCommand);
          result.commandNames.push(nearestCommand.name);
        }
      }
    }

    result.detected = result.matchedCommands.length > 0;

    // Strip command invocation phrases from text for cleaner output.
    if (result.detected) {
      let cleanText = text;
      // Remove common patterns that mention commands.
      for (const name of result.commandNames) {
        // Escape special regex characters in command name.
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Remove variations like "use the X command", "X command", "command X".
        const patterns = [
          new RegExp(`\\b(?:use|apply|run|invoke|with)\\s+(?:the\\s+)?${escapedName}\\s+commands?\\b`, 'gi'),
          new RegExp(`\\b${escapedName}\\s+commands?\\b`, 'gi'),
          new RegExp(`\\bcommands?\\s+${escapedName}\\b`, 'gi'),
          // Also handle list patterns like "commands X, Y, and Z".
          new RegExp(`\\bcommands\\s+(?:${escapedName}(?:,\\s*|\\s+and\\s+|\\s+))+`, 'gi'),
        ];
        for (const pattern of patterns) {
          cleanText = cleanText.replace(pattern, '');
        }
      }
      // Clean up extra whitespace.
      result.textWithoutCommandRefs = cleanText.replace(/\s+/g, ' ').trim();
    }

    return result;
  }

  /**
   * Find all occurrences of "command" and "commands" in text.
   * Returns matches in order of appearance with info about singular vs plural.
   */
  private findCommandWords(text: string): Array<{ index: number; isPlural: boolean }> {
    const matches: Array<{ index: number; isPlural: boolean }> = [];
    
    // Use regex to find "command" or "commands" as whole words.
    const regex = /\bcommands?\b/gi;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const isPlural = match[0].toLowerCase() === 'commands';
      matches.push({ index: match.index, isPlural });
    }
    
    return matches;
  }

  /**
   * Find the nearest command name to a given position (for singular "command").
   * Looks within a 50-character window on either side of the "command" word.
   * Returns the closest matching command, or null if none found.
   */
  private findNearestCommand(
    text: string, 
    commandWordIndex: number,
    alreadyMatched: Set<string>
  ): PortableCommand | null {
    const windowSize = 50;
    const windowStart = Math.max(0, commandWordIndex - windowSize);
    const windowEnd = Math.min(text.length, commandWordIndex + 'command'.length + windowSize);
    
    let nearestCommand: PortableCommand | null = null;
    let nearestDistance = Infinity;

    for (const [commandName, command] of this.commands) {
      // Skip commands we've already matched.
      if (alreadyMatched.has(commandName)) continue;

      // Find all occurrences of this command name in the text.
      let searchStart = 0;
      while (true) {
        const nameIndex = text.indexOf(commandName, searchStart);
        if (nameIndex === -1) break;

        // Check if this occurrence is within our window.
        if (nameIndex >= windowStart && nameIndex <= windowEnd) {
          // Verify it's a word boundary (not part of another word).
          if (this.isWordBoundary(text, nameIndex, commandName)) {
            // Calculate distance from the "command" word.
            const distance = Math.abs(nameIndex - commandWordIndex);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestCommand = command;
            }
          }
        }

        searchStart = nameIndex + 1;
      }
    }

    return nearestCommand;
  }

  /**
   * Find multiple commands in a list following "commands" (plural).
   * Handles patterns like: "use the commands X, Y, and Z"
   * Looks for command names in the text following the "commands" word.
   */
  private findCommandsInList(
    text: string,
    commandsWordIndex: number,
    alreadyMatched: Set<string>
  ): PortableCommand[] {
    const foundCommands: PortableCommand[] = [];
    
    // Look at the text following "commands" - typically a comma-separated list.
    // We look ahead 100 characters or until a sentence boundary.
    const searchStart = commandsWordIndex + 'commands'.length;
    const searchEnd = Math.min(text.length, searchStart + 100);
    
    // Find sentence boundaries (period, question mark, exclamation).
    const remainingText = text.slice(searchStart, searchEnd);
    const sentenceEnd = remainingText.search(/[.!?]/);
    const listText = sentenceEnd !== -1 
      ? remainingText.slice(0, sentenceEnd) 
      : remainingText;

    // Search for each known command in the list portion.
    for (const [commandName, command] of this.commands) {
      if (alreadyMatched.has(commandName)) continue;

      const nameIndex = listText.toLowerCase().indexOf(commandName);
      if (nameIndex !== -1) {
        // Verify word boundary.
        if (this.isWordBoundary(listText.toLowerCase(), nameIndex, commandName)) {
          foundCommands.push(command);
        }
      }
    }

    return foundCommands;
  }

  /**
   * Check if a match at a given index represents a complete word.
   * Returns true if the character before and after the match is a word boundary.
   */
  private isWordBoundary(text: string, index: number, word: string): boolean {
    const beforeChar = index > 0 ? text[index - 1] : ' ';
    const afterChar = index + word.length < text.length ? text[index + word.length] : ' ';
    
    // Word boundaries: whitespace, punctuation, or string boundary.
    const boundaryPattern = /[\s,.:;!?'"()\[\]{}|<>\/\\-]/;
    const isBeforeBoundary = index === 0 || boundaryPattern.test(beforeChar);
    const isAfterBoundary = index + word.length === text.length || boundaryPattern.test(afterChar);
    
    return isBeforeBoundary && isAfterBoundary;
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
   * Refresh the commands list by rescanning all directories.
   */
  async refresh(): Promise<void> {
    this.commands.clear();

    // Scan all watched directories
    for (const dirPath of this.settings.watchedDirs) {
      await this.scanDirectory(dirPath);
    }

    // Legacy: also scan single directory if set
    if (this.directoryPath) {
      await this.scanDirectory();
    }

    this.emit('commandsChanged', this.getCommands());
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    // Stop all directory watchers
    for (const [, abort] of this.watchers) {
      try {
        abort.abort();
      } catch {
        // Ignore abort errors
      }
    }
    this.watchers.clear();

    // Legacy watcher
    if (this.watcherAbort) {
      this.watcherAbort.abort();
      this.watcherAbort = null;
    }

    this.commands.clear();
  }

  // =========================================================================
  // Multi-Directory Management
  // =========================================================================

  /**
   * Watch a specific directory for changes.
   */
  private watchDirectory(dirPath: string): void {
    if (this.watchers.has(dirPath)) {
      return; // Already watching
    }

    try {
      const abort = new AbortController();
      this.watchers.set(dirPath, abort);

      const watcher = fs.watch(
        dirPath,
        { recursive: true, signal: abort.signal },
        async (eventType, filename) => {
          try {
            if (filename && this.isMarkdownFile(filename)) {
              console.log(`[CommandsManager] File changed: ${filename} in ${dirPath}`);
              // Rescan all directories to update commands
              await this.refresh();
            }
          } catch (error) {
            console.error('[CommandsManager] Error handling file change:', error);
          }
        }
      );

      watcher.on('error', (error) => {
        console.warn(`[CommandsManager] File watcher error for ${dirPath} (non-fatal):`, error);
      });

      console.log(`[CommandsManager] Watching directory: ${dirPath}`);
    } catch (error) {
      console.error(`[CommandsManager] Error starting directory watch for ${dirPath}:`, error);
    }
  }

  /**
   * Stop watching a specific directory.
   */
  private unwatchDirectory(dirPath: string): void {
    const abort = this.watchers.get(dirPath);
    if (abort) {
      try {
        abort.abort();
      } catch {
        // Ignore abort errors
      }
      this.watchers.delete(dirPath);
      console.log(`[CommandsManager] Stopped watching: ${dirPath}`);
    }
  }

  /**
   * Get all watched directories.
   */
  getWatchedDirs(): WatchedDir[] {
    return this.settings.watchedDirs.map(dirPath => ({
      path: dirPath,
      enabled: true,
    }));
  }

  /**
   * Add a directory to watch.
   * Returns the WatchedDir if successful, null if not found or already watched.
   */
  async addWatchedDir(dirPath: string): Promise<WatchedDir | null> {
    const expandedPath = this.expandPath(dirPath);
    const normalizedPath = this.normalizePath(expandedPath);

    // Check if directory exists
    if (!fs.existsSync(normalizedPath)) {
      console.warn(`[CommandsManager] Directory does not exist: ${normalizedPath}`);
      return null;
    }

    // Check if already watched
    if (this.settings.watchedDirs.includes(normalizedPath)) {
      console.log(`[CommandsManager] Already watching: ${normalizedPath}`);
      return null;
    }

    // Add to settings
    this.settings.watchedDirs.push(normalizedPath);
    this.saveSettings();

    // Scan the new directory
    await this.scanDirectory(normalizedPath);

    // Start watching
    this.watchDirectory(normalizedPath);

    // Emit change
    this.emit('commandsChanged', this.getCommands());

    console.log(`[CommandsManager] Added watched directory: ${normalizedPath}`);

    return { path: normalizedPath, enabled: true };
  }

  /**
   * Remove a watched directory by path.
   * Also removes all cached commands from that directory.
   */
  removeWatchedDir(dirPath: string): boolean {
    const normalizedPath = this.normalizePath(dirPath);

    const index = this.settings.watchedDirs.indexOf(normalizedPath);
    if (index === -1) {
      return false;
    }

    // Stop watching
    this.unwatchDirectory(normalizedPath);

    // Remove from settings
    this.settings.watchedDirs.splice(index, 1);
    this.saveSettings();

    // Remove cached commands from this directory
    for (const [name, command] of this.commands) {
      if (command.filePath.startsWith(normalizedPath)) {
        this.commands.delete(name);
      }
    }

    // Emit change
    this.emit('commandsChanged', this.getCommands());

    console.log(`[CommandsManager] Removed watched directory: ${normalizedPath}`);
    return true;
  }

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  /**
   * Get a command by file path with full content.
   */
  async getCommandByPath(filePath: string): Promise<CommandWithContent | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);
      const nameWithoutExt = filename.replace(/\.(md|markdown)$/i, '');

      const displayName = nameWithoutExt
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      return {
        name: nameWithoutExt.toLowerCase(),
        filePath,
        displayName,
        lastModified: stats.mtimeMs,
        content,
      };
    } catch (error) {
      console.error(`[CommandsManager] Error getting command by path ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Save/update a command's content.
   */
  saveCommand(filePath: string, content: string): boolean {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`[CommandsManager] Saved command: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`[CommandsManager] Error saving command ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Create a new command file.
   * Returns the created command info if successful, null otherwise.
   */
  createCommand(directoryPath: string, name: string, content: string = ''): { path: string; name: string } | null {
    try {
      // Ensure the name has .md extension
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const filePath = path.join(directoryPath, fileName);

      // Check if file already exists
      if (fs.existsSync(filePath)) {
        console.warn(`[CommandsManager] Command already exists: ${filePath}`);
        return null;
      }

      // Create the file
      fs.writeFileSync(filePath, content, 'utf-8');

      console.log(`[CommandsManager] Created command: ${filePath}`);
      return { path: filePath, name: fileName.replace('.md', '') };
    } catch (error) {
      console.error(`[CommandsManager] Error creating command:`, error);
      return null;
    }
  }

  /**
   * Delete a command file.
   */
  deleteCommand(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      fs.unlinkSync(filePath);

      // Remove from commands map
      const command = Array.from(this.commands.values()).find(c => c.filePath === filePath);
      if (command) {
        this.commands.delete(command.name);
        this.emit('commandsChanged', this.getCommands());
      }

      console.log(`[CommandsManager] Deleted command: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`[CommandsManager] Error deleting command ${filePath}:`, error);
      return false;
    }
  }
}
