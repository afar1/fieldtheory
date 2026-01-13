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
      this.watcherAbort.abort();
      this.watcherAbort = null;
    }

    this.directoryPath = directoryPath;
    this.commands.clear();

    if (directoryPath) {
      await this.scanDirectory();
      this.startWatching();
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
   */
  private startWatching(): void {
    if (!this.directoryPath) return;

    try {
      this.watcherAbort = new AbortController();
      
      // Use fs.watch with AbortController for cleanup
      fs.watch(
        this.directoryPath,
        { recursive: true, signal: this.watcherAbort.signal },
        async (eventType, filename) => {
          if (filename && this.isMarkdownFile(filename)) {
            console.log(`[CommandsManager] File changed: ${filename}`);
            // Rescan the directory to update commands
            this.commands.clear();
            await this.scanDirectory();
            this.emit('commandsChanged', this.getCommands());
          }
        }
      );
      
      console.log(`[CommandsManager] Watching directory: ${this.directoryPath}`);
    } catch (error) {
      console.error('[CommandsManager] Error starting directory watch:', error);
    }
  }

  /**
   * Detect command invocations in user text.
   * 
   * Looks for patterns like:
   * - "use the X command"
   * - "please use the X command"
   * - "use commands X, Y, Z"
   * - "apply the X command"
   * - "invoke X command"
   * 
   * Returns detection results including matched and unmatched commands.
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

    // Normalize text for pattern matching
    const lowerText = text.toLowerCase();

    // Patterns to detect command invocations:
    // Pattern 1: "use (the)? [command_name] command(s)?"
    // Pattern 2: "use command(s)? [command_name](, [command_name])*"
    // Pattern 3: "apply/invoke (the)? [command_name] command"
    // Pattern 4: "please use (the)? [command_name]"
    
    const patterns = [
      // "use the X command" or "use X command"
      /(?:use|apply|invoke|run)\s+(?:the\s+)?["']?(\w[\w\s-]*)["']?\s+commands?/gi,
      // "use commands X, Y" or "use command X"
      /(?:use|apply|invoke|run)\s+commands?\s+["']?(\w[\w\s,-]*)["']?/gi,
      // "please use X" when X is a known command
      /please\s+use\s+(?:the\s+)?["']?(\w[\w\s-]*)["']?/gi,
    ];

    const detectedNames = new Set<string>();

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(lowerText)) !== null) {
        // Extract command names (may be comma-separated)
        const namesStr = match[1];
        const names = namesStr
          .split(/[,\s]+and\s+|,\s*/)
          .map(n => n.trim().toLowerCase())
          .filter(n => n.length > 0);

        for (const name of names) {
          detectedNames.add(name);
        }
      }
    }

    // Check which detected names match actual commands
    for (const name of detectedNames) {
      const command = this.getCommand(name);
      if (command) {
        result.matchedCommands.push(command);
        result.commandNames.push(name);
      } else {
        result.unmatchedNames.push(name);
      }
    }

    result.detected = result.matchedCommands.length > 0;

    // Strip command references from text for cleaner prompt
    if (result.detected) {
      let cleanText = text;
      for (const pattern of patterns) {
        cleanText = cleanText.replace(pattern, '');
      }
      result.textWithoutCommandRefs = cleanText.trim();
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
