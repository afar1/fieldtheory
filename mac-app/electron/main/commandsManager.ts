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
import crypto from 'crypto';
import { app, shell } from 'electron';
import { EventEmitter } from 'events';
import { UserDataManager } from './userDataManager';
import { createLogger } from './logger';
import { commandsDir } from './fieldTheoryPaths';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import { existingPathInsideRoots, isMarkdownDocumentPath, isPathInside, markdownFileNameFromUserInput, realpathIfExists } from './pathSafety';
import { parseMarkdownFrontmatter } from '../shared/markdownFrontmatter';
import { inferSharedFileType, parseSharedFileFrontmatter, sharedFilesRoot, SHARED_FILES_UI_LABEL } from './sharedFiles';

const log = createLogger('Commands');

export const DEFAULT_IMPROVE_COMMAND_CONTENT = "Improve the selected text for clarity while preserving meaning, tone, markdown formatting, links, filenames, screenshots, and checkbox state. Return only the improved replacement text.\n";

const SHARED_COMMAND_SOURCE_LABEL = SHARED_FILES_UI_LABEL;

function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

function withCommandFrontmatter(content: string, title: string): string {
  const parsed = parseMarkdownFrontmatter(content);
  const commandLines = [
    'kind: command',
    `title: ${yamlQuoted(title)}`,
    parsed.meta.enabled ? null : 'enabled: true',
  ].filter((line): line is string => Boolean(line));

  if (parsed.raw !== null) {
    const frontmatterLines = parsed.raw.trim().length > 0
      ? parsed.lines.filter((line) => !/^\s*(kind|type|title)\s*:/i.test(line))
      : [];
    return `---\n${[
      ...frontmatterLines,
      ...commandLines,
    ].join('\n')}\n---\n\n${parsed.body}`;
  }

  return `---\n${commandLines.join('\n')}\n---\n\n${content.replace(/^\n+/, '')}`;
}

function commandTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, '');
}

const DEFAULT_INTERNAL_COMMAND_TEMPLATES: Array<{ name: string; content: string }> = [
  {
    name: 'refactor',
    content: "Now that you've done some work are there any parts you would go back and refactor. Refactor those. Write tests that you think should be written along the way.\n",
  },
  {
    name: 'review',
    content: "Review what we've just proposed, implemented, or outlined against our engineering principles. And as a second set of technical eyes.\n\nAre there any minor changes, major changes, logical flaws, or are we good to go?\n\nFeel free to use the questions command if you need more info.\n",
  },
  {
    name: 'questions',
    content: "Ask me as many questions as you may need until you have a full comprehension of my intent and what I'm trying to do and any important dependencies. I'm happy to answer as many questions as you'd like, even after I've answered some of your first sets of questions.\n",
  },
  {
    name: 'improve',
    content: DEFAULT_IMPROVE_COMMAND_CONTENT,
  },
  {
    name: 'commit',
    content: `# Remove AI code slop

Check the diff against main, and remove all AI generated slop introduced in this branch.

This includes:
- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file

Report with only a 1-3 sentence summary of what you changed

# Commit current work
Commit all current work and push to origin. But if we are working on a web app of any kind (this does not apply to dmg or ios apps) before you do, try to build this locally using npm run build. Once we confirm that it built properly locally since it takes such a short time, we can then commit and push to origin. If it fails to build locally, identify and fix those issues first, then commit and push to origin.

## Important
- Always commit ALL modified and staged files (use \`git add -A\` to stage everything)
- If you can't get information from git diff, use your working memory to determine what has changed
- Review the staged files to write an accurate commit message

## Instructions
1. Stage all changes: \`git add -A\` (or \`git add .\` to include untracked files)
2. Review what will be committed using \`git status\` and \`git diff --staged\`
3. Write a brief commit message in the following format:
   - Short title description (< 80 characters)
   - 2~3 bullet points (< 80 characters) with a quick description
4. Commit and push: \`git commit -m "..." && git push origin main\`

## Notes
- You should only commit work when instructed. Do not keep committing subsequent work unless explicitly told so
- If there are unrelated changes mixed in, mention them in the commit message or ask the user if they should be split into separate commits
`,
  },
];

/**
 * Settings stored in JSON file.
 */
interface CommandsSettings {
  watchedDirs: string[];
  /** Directories with mobile sync enabled (paths) */
  mobileSyncDirs: string[];
}

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
 * Command ready to be synced to Supabase.
 */
export interface SyncableCommand {
  name: string;
  displayName: string;
  content: string;
  sourcePath: string;
  contentHash: string;
}

/**
 * Represents a portable command (markdown file).
 */
export interface PortableCommand {
  name: string;           // Command name (filename without extension)
  filePath: string;       // Full path to the markdown file
  displayName: string;    // Human-readable name (e.g., "Debug" from "debug.md")
  lastModified: number;   // File modification time for cache invalidation
  source?: 'private' | 'shared';
  sourceLabel?: string;
  sharedAuthorCallsign?: string;
  sourceRootPath?: string;
  sourceRelPath?: string;
}

export interface PortableCommandDirectory {
  name: string;
  displayName: string;
  rootPath: string;
  directoryPath: string;
  directoryRelPath: string;
  lastModified: number;
}

interface CommandSourceContext {
  source: 'private' | 'shared';
  sourceLabel?: string;
  sourceRootPath?: string;
}

interface SharedCommandMetadata {
  type: ReturnType<typeof inferSharedFileType>;
  title?: string;
  authorCallsign?: string;
}

/**
 * Command with full content loaded.
 */
export interface CommandWithContent extends PortableCommand {
  content: string;
  documentVersion: DocumentVersion;
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
  private settings: CommandsSettings = { watchedDirs: [], mobileSyncDirs: [] };
  private settingsPath: string;
  private commands: Map<string, PortableCommand> = new Map();
  private watchers: Map<string, AbortController> = new Map();
  private userDataManager: UserDataManager | null = null;

  // Legacy single directory support (for migration)
  private directoryPath: string | null = null;
  private watcherAbort: AbortController | null = null;

  constructor() {
    super();

    // Settings file path (legacy - will be updated when user logs in)
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'commands-settings.json');

    // Load settings
    this.loadSettings();
  }

  /**
   * Set the UserDataManager for per-user paths.
   */
  setUserDataManager(manager: UserDataManager): void {
    this.userDataManager = manager;
  }

  /**
   * Update the settings path for the current user.
   */
  private updateSettingsPath(): void {
    if (this.userDataManager?.isLoggedIn()) {
      this.settingsPath = this.userDataManager.getUserDataPath('commands-settings.json');
    }
  }

  /**
   * Reinitialize for the current user. Call after setUserDataManager.
   */
  async reinitializeForUser(): Promise<void> {
    // Skip if settings path hasn't changed (avoids redundant re-scans when
    // auth confirms the same user already restored from disk).
    const oldPath = this.settingsPath;
    this.updateSettingsPath();
    if (this.settingsPath === oldPath && this.commands.size > 0) {
      return;
    }

    // Stop existing watchers
    for (const abort of this.watchers.values()) {
      abort.abort();
    }
    this.watchers.clear();
    this.commands.clear();

    this.loadSettings();

    // Rescan all directories
    await this.initialize();
  }

  /**
   * Clear state on logout.
   */
  onUserLoggedOut(): void {
    // Stop watchers
    for (const abort of this.watchers.values()) {
      abort.abort();
    }
    this.watchers.clear();
    this.commands.clear();
  }

  /**
   * Load settings from JSON file.
   */
  private loadSettings(): void {
    const defaults: CommandsSettings = { watchedDirs: [], mobileSyncDirs: [] };

    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        this.settings = {
          watchedDirs: data.watchedDirs || defaults.watchedDirs,
          mobileSyncDirs: data.mobileSyncDirs || defaults.mobileSyncDirs,
        };
      } else {
        this.settings = defaults;
      }
    } catch (error) {
      log.error('Error loading settings:', error);
      this.settings = defaults;
    }
  }

  /**
   * Save settings to JSON file.
   */
  private saveSettings(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      log.error('Error saving settings:', error);
    }
  }

  /**
   * Initialize the manager - scan all watched directories.
   */
  async initialize(): Promise<void> {
    await this.createDefaultDirectory();

    // Scan all watched directories
    for (const dirPath of this.settings.watchedDirs) {
      await this.scanDirectory(dirPath);
      this.watchDirectory(dirPath);
    }
    await this.scanSharedCommandSources();
    this.watchSharedCommandSources();

    this.emit('commandsChanged', this.getCommands());
  }

  /**
   * Get the default commands directory path.
   */
  getDefaultDirectory(): string {
    return commandsDir();
  }

  private seedDefaultCommands(defaultDir: string): void {
    for (const command of DEFAULT_INTERNAL_COMMAND_TEMPLATES) {
      const filePath = path.join(defaultDir, `${command.name}.md`);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, withCommandFrontmatter(command.content, command.name));
      }
    }
  }

  private legacyCommandsDirectoryForDefault(defaultDir: string): string | null {
    const parentDir = path.dirname(defaultDir);
    if (path.basename(defaultDir) !== 'Commands' || path.basename(parentDir) !== 'library') {
      return null;
    }
    return path.join(path.dirname(parentDir), 'commands');
  }

  private legacyCommandsDirectory(): string | null {
    return this.legacyCommandsDirectoryForDefault(this.getDefaultDirectory());
  }

  private sharedCommandCacheRoot(): string {
    return this.normalizePath(sharedFilesRoot());
  }

  private sharedCommandSourceForPath(filePath: string): CommandSourceContext | null {
    const normalizedRoot = this.sharedCommandCacheRoot();
    const normalizedFilePath = this.normalizePath(this.expandPath(filePath));
    if (!isPathInside(normalizedRoot, normalizedFilePath)) return null;

    return {
      source: 'shared',
      sourceLabel: SHARED_COMMAND_SOURCE_LABEL,
      sourceRootPath: normalizedRoot,
    };
  }

  private sharedCommandSources(): CommandSourceContext[] {
    const normalizedRoot = this.sharedCommandCacheRoot();
    try {
      if (!fs.statSync(normalizedRoot).isDirectory()) return [];
    } catch {
      return [];
    }

    return [{
      source: 'shared',
      sourceLabel: SHARED_COMMAND_SOURCE_LABEL,
      sourceRootPath: normalizedRoot,
    }];
  }

  private sharedCommandMetadata(filePath: string): SharedCommandMetadata | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const shared = parseSharedFileFrontmatter(content);
      return {
        type: shared?.type ?? inferSharedFileType({ filePath, content }),
        title: shared?.title,
        authorCallsign: shared?.authorCallsign,
      };
    } catch (error) {
      log.warn(`Failed to read shared command metadata for ${filePath}:`, error);
      return null;
    }
  }

  private sharedCommandRelPath(
    filePath: string,
    source: CommandSourceContext,
  ): string | undefined {
    if (!source.sourceRootPath) return undefined;
    return path.relative(source.sourceRootPath, filePath).replace(/\\/g, '/');
  }

  private isSharedCommandFile(
    filePath: string,
    source: CommandSourceContext,
    metadata: SharedCommandMetadata | null,
  ): boolean {
    if (metadata?.type === 'command') return true;

    const relPath = this.sharedCommandRelPath(filePath, source);
    if (relPath?.split('/').some(part => part.toLowerCase() === 'commands')) {
      return true;
    }
    return false;
  }

  private isLegacyCommandsDirectoryPath(dirPath: string): boolean {
    const legacyDir = this.legacyCommandsDirectory();
    if (!legacyDir) return false;
    return isPathInside(this.normalizePath(legacyDir), this.normalizePath(this.expandPath(dirPath)));
  }

  private isLegacyCommandPath(filePath: string): boolean {
    const legacyDir = this.legacyCommandsDirectory();
    if (!legacyDir) return false;
    return isPathInside(this.normalizePath(legacyDir), this.normalizePath(this.expandPath(filePath)));
  }

  private removeLegacyCommandsDirectoryFromSettings(defaultDir: string): void {
    const legacyDir = this.legacyCommandsDirectoryForDefault(defaultDir);
    if (!legacyDir || this.normalizePath(legacyDir) === this.normalizePath(defaultDir)) return;

    const normalizedLegacyDir = this.normalizePath(legacyDir);
    const beforeWatched = this.settings.watchedDirs.length;
    const removedWatchedDirs = this.settings.watchedDirs.filter(dirPath =>
      isPathInside(normalizedLegacyDir, this.normalizePath(this.expandPath(dirPath)))
    );
    this.settings.watchedDirs = this.settings.watchedDirs.filter(dirPath =>
      !isPathInside(normalizedLegacyDir, this.normalizePath(this.expandPath(dirPath)))
    );

    const beforeMobileSync = this.settings.mobileSyncDirs.length;
    this.settings.mobileSyncDirs = this.settings.mobileSyncDirs.filter(dirPath =>
      !isPathInside(normalizedLegacyDir, this.normalizePath(this.expandPath(dirPath)))
    );

    for (const removedDir of removedWatchedDirs) {
      this.unwatchDirectory(this.normalizePath(this.expandPath(removedDir)));
    }
    for (const [name, command] of this.commands) {
      if (isPathInside(normalizedLegacyDir, this.normalizePath(this.expandPath(command.filePath)))) {
        this.commands.delete(name);
      }
    }

    if (this.settings.watchedDirs.length !== beforeWatched || this.settings.mobileSyncDirs.length !== beforeMobileSync) {
      this.saveSettings();
    }
  }

  private preferWatchedDir(dirPath: string): void {
    const normalizedPath = this.normalizePath(dirPath);
    const index = this.settings.watchedDirs.indexOf(normalizedPath);
    if (index <= 0) return;
    this.settings.watchedDirs.splice(index, 1);
    this.settings.watchedDirs.unshift(normalizedPath);
    this.saveSettings();
  }

  /**
   * Create and add the default commands directory.
   * Returns the path if successful, null otherwise.
   */
  async createDefaultDirectory(): Promise<string | null> {
    const defaultDir = this.normalizePath(this.getDefaultDirectory());

    try {
      const dirAlreadyExisted = fs.existsSync(defaultDir);
      const wasWatched = this.settings.watchedDirs.includes(defaultDir);
      if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
      }

      const hasMarkdownFiles = fs.readdirSync(defaultDir).some(entry => this.isMarkdownFile(entry));
      const seededDefaults = !dirAlreadyExisted || !hasMarkdownFiles;
      if (seededDefaults) {
        this.seedDefaultCommands(defaultDir);
      }

      // Add to watched directories
      const result = await this.addWatchedDir(defaultDir);
      if (!result && wasWatched && seededDefaults) {
        await this.scanDirectory(defaultDir);
        this.emit('commandsChanged', this.getCommands());
      }
      this.preferWatchedDir(defaultDir);
      this.removeLegacyCommandsDirectoryFromSettings(defaultDir);
      if (result) {
        return defaultDir;
      }
      return defaultDir; // Already exists and is watched
    } catch (error) {
      log.error('Error creating default directory:', error);
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

    if (expandedPath && this.isLegacyCommandsDirectoryPath(expandedPath)) {
      this.removeLegacyCommandsDirectoryFromSettings(this.getDefaultDirectory());
      this.directoryPath = null;
      this.emit('directoryChanged', null);
      this.emit('commandsChanged', this.getCommands());
      return;
    }

    this.directoryPath = expandedPath;
    this.commands.clear();

    if (expandedPath) {
      try {
        await this.scanDirectory();
        await this.scanSharedCommandSources();
      } catch (error) {
        log.error('Error scanning directory:', error);
      }

      // Start watching in a try-catch - don't let watcher issues crash the app
      try {
        this.startWatching();
      } catch (error) {
        // Non-fatal: commands will still work, just won't auto-refresh
      }
    }

    this.emit('directoryChanged', directoryPath);
    this.emit('commandsChanged', this.getCommands());
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
    return Array.from(this.commands.values()).filter(command => !this.isLegacyCommandPath(command.filePath));
  }

  getCommandDirectories(): PortableCommandDirectory[] {
    const items: PortableCommandDirectory[] = [];
    const seen = new Set<string>();

    const addDirectory = (rootPath: string, directoryPath: string) => {
      const normalizedRoot = this.normalizePath(rootPath);
      const normalizedDirectory = this.normalizePath(directoryPath);
      if (seen.has(normalizedDirectory)) return;
      seen.add(normalizedDirectory);

      let stats: fs.Stats;
      try {
        stats = fs.statSync(normalizedDirectory);
        if (!stats.isDirectory()) return;
      } catch {
        return;
      }

      const relPath = path.relative(normalizedRoot, normalizedDirectory);
      const cleanRelPath = relPath === '.' ? '' : relPath.replace(/\\/g, '/');
      const rootName = path.basename(normalizedRoot);
      const name = cleanRelPath ? path.basename(normalizedDirectory) : rootName;
      items.push({
        name,
        displayName: cleanRelPath || rootName,
        rootPath: normalizedRoot,
        directoryPath: normalizedDirectory,
        directoryRelPath: cleanRelPath,
        lastModified: stats.mtimeMs,
      });
    };

    const visit = (rootPath: string, dirPath: string) => {
      addDirectory(rootPath, dirPath);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        visit(rootPath, path.join(dirPath, entry.name));
      }
    };

    for (const rootPath of this.watchedRootPaths()) {
      if (this.isLegacyCommandsDirectoryPath(rootPath)) continue;
      visit(rootPath, rootPath);
    }

    return items.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Get a command by name (case-insensitive).
   */
  getCommand(name: string): PortableCommand | null {
    const command = this.commands.get(name.toLowerCase()) || null;
    if (command && this.isLegacyCommandPath(command.filePath)) return null;
    return command;
  }

  /**
   * Check if a command exists.
   */
  hasCommand(name: string): boolean {
    return this.getCommand(name) !== null;
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

  private watchedRootPaths(): string[] {
    return this.settings.watchedDirs
      .filter(dirPath => !this.isLegacyCommandsDirectoryPath(dirPath))
      .map(dirPath => this.normalizePath(this.expandPath(dirPath)));
  }

  private isInsideWatchedRoot(filePath: string): boolean {
    return this.watchedRootPaths().some((rootPath) => {
      const realRootPath = realpathIfExists(rootPath);
      return !!realRootPath && isPathInside(realRootPath, filePath);
    });
  }

  private resolveWatchedCommandFile(filePath: string): string | null {
    const normalizedPath = this.normalizePath(this.expandPath(filePath));
    if (!this.isMarkdownFile(normalizedPath)) return null;
    return existingPathInsideRoots(normalizedPath, this.watchedRootPaths()) ? normalizedPath : null;
  }

  private resolveWatchedCommandDirectory(dirPath: string): string | null {
    const normalizedPath = this.normalizePath(this.expandPath(dirPath));
    const realDirPath = realpathIfExists(normalizedPath);
    if (!realDirPath) return null;
    try {
      if (!fs.statSync(realDirPath).isDirectory()) return null;
    } catch {
      return null;
    }
    return this.isInsideWatchedRoot(realDirPath) ? normalizedPath : null;
  }

  private commandFileNameFromUserInput(name: string): string | null {
    return markdownFileNameFromUserInput(name);
  }

  private syncCommandFrontmatterTitle(filePath: string, title: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const nextContent = withCommandFrontmatter(content, title);
      if (nextContent !== content) {
        fs.writeFileSync(filePath, nextContent, 'utf-8');
      }
    } catch (error) {
      log.warn(`Failed to sync command frontmatter title for ${filePath}:`, error);
    }
  }

  /**
   * Scan a specific directory for markdown files and add to the commands index.
   * If no path provided, scans all watched directories.
   */
  private async scanDirectory(dirPath?: string): Promise<void> {
    // If specific path provided, scan that directory
    if (dirPath) {
      if (this.isLegacyCommandsDirectoryPath(dirPath)) return;

      try {
        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
          return;
        }

        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
          return;
        }

        // Recursively scan for markdown files
        await this.scanDirectoryRecursive(dirPath);
      } catch (error) {
        log.error(`Error scanning directory ${dirPath}:`, error);
      }
      return;
    }

    // Legacy: scan single directory if set
    if (!this.directoryPath) return;

    try {
      // Check if directory exists
      if (!fs.existsSync(this.directoryPath)) {
        return;
      }

      const stats = fs.statSync(this.directoryPath);
      if (!stats.isDirectory()) {
        return;
      }

      // Recursively scan for markdown files
      await this.scanDirectoryRecursive(this.directoryPath);
    } catch (error) {
      log.error('Error scanning directory:', error);
    }
  }

  private async scanSharedCommandSources(): Promise<void> {
    for (const source of this.sharedCommandSources()) {
      if (!source.sourceRootPath) continue;
      await this.scanDirectoryRecursive(source.sourceRootPath, source);
    }
  }

  private watchSharedCommandSources(): void {
    for (const source of this.sharedCommandSources()) {
      if (source.sourceRootPath) this.watchDirectory(source.sourceRootPath);
    }
  }

  /**
   * Recursively scan a directory for markdown files.
   */
  private async scanDirectoryRecursive(dirPath: string, source?: CommandSourceContext): Promise<void> {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files/directories
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectoryRecursive(fullPath, source);
        } else if (entry.isFile() && this.isMarkdownFile(entry.name)) {
          // Add markdown file as a command
          const command = this.createCommandFromFile(fullPath, source);
          const existing = command ? this.commands.get(command.name) : null;
          if (command && (!existing || this.shouldReplaceCommand(existing, command))) {
            this.commands.set(command.name, command);
          }
        }
      }
    } catch (error) {
      log.error(`Error scanning ${dirPath}:`, error);
    }
  }

  /**
   * Check if a file is a markdown file.
   */
  private isMarkdownFile(filename: string): boolean {
    return isMarkdownDocumentPath(filename);
  }

  /**
   * Create a PortableCommand from a file path.
   */
  private createCommandFromFile(filePath: string, sourceContext?: CommandSourceContext): PortableCommand | null {
    try {
      const source = sourceContext ?? this.sharedCommandSourceForPath(filePath) ?? { source: 'private' as const };
      const sharedMetadata = source.source === 'shared' ? this.sharedCommandMetadata(filePath) : null;
      if (source.source === 'shared' && !this.isSharedCommandFile(filePath, source, sharedMetadata)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);
      const nameWithoutExt = filename.replace(/\.(md|markdown)$/i, '');
      const sharedTitle = source.source === 'shared' ? sharedMetadata?.title?.trim() : '';
      const displayName = sharedTitle || (source.source === 'shared' ? 'Untitled' : nameWithoutExt);
      const name = sharedTitle || nameWithoutExt;

      return {
        name: name.toLowerCase(),
        filePath,
        displayName,
        lastModified: stats.mtimeMs,
        source: source.source,
        sourceLabel: source.sourceLabel,
        sharedAuthorCallsign: sharedMetadata?.authorCallsign,
        sourceRootPath: source.sourceRootPath,
        sourceRelPath: source.source === 'shared' ? this.sharedCommandRelPath(filePath, source) : undefined,
      };
    } catch (error) {
      log.error(`Error creating command from ${filePath}:`, error);
      return null;
    }
  }

  private shouldReplaceCommand(existing: PortableCommand, next: PortableCommand): boolean {
    return existing.source === 'shared' && next.source !== 'shared';
  }

  private updateCachedCommandFromFile(filePath: string): PortableCommand | null {
    const normalizedFilePath = this.normalizePath(filePath);
    for (const [name, command] of this.commands) {
      if (this.normalizePath(command.filePath) === normalizedFilePath) {
        this.commands.delete(name);
      }
    }

    const command = this.createCommandFromFile(filePath);
    const existing = command ? this.commands.get(command.name) : null;
    if (command && (!existing || this.shouldReplaceCommand(existing, command))) {
      this.commands.set(command.name, command);
    }
    return command;
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
            // File saves, file renames, and folder renames can all affect
            // launcher labels, paths, and folder rows.
            if (!filename) return;
            this.commands.clear();
            await this.scanDirectory();
            this.emit('commandsChanged', this.getCommands());
          } catch (error) {
            log.error('Error handling file change:', error);
          }
        }
      );

      // Handle watcher errors gracefully - don't crash, commands still work
      watcher.on('error', () => {});
    } catch (error) {
      log.error('Error starting directory watch:', error);
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

    // Replace the command name + "command" word with inline reference.
    // e.g., "can you run the review command" → "can you run the [cmd:review.md]"
    // We only replace "<name> command" or "command <name>", keeping surrounding phrases.
    if (result.detected) {
      let cleanText = text;
      for (const cmd of result.matchedCommands) {
        const name = cmd.name;
        // Escape special regex characters in command name.
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ref = `[cmd:${name}.md]`;
        // Replace the command name + "command" word with the reference in-place.
        const patterns = [
          new RegExp(`\\b${escapedName}\\s+commands?\\b`, 'gi'),  // "review command" → [cmd:review.md]
          new RegExp(`\\bcommands?\\s+${escapedName}\\b`, 'gi'),  // "command review" → [cmd:review.md]
        ];
        for (const pattern of patterns) {
          cleanText = cleanText.replace(pattern, ref);
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
        return null;
      }

      const content = fs.readFileSync(command.filePath, 'utf-8');

      return {
        name: command.name,
        content,
        filePath: command.filePath,
      };
    } catch (error) {
      log.error(`Error loading command ${command.name}:`, error);
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
   *
   * Note: References are now inserted in-place during detectCommands() when
   * "X command" patterns are replaced. This method now just returns the text
   * as-is since references are already inline.
   */
  insertCommandReferences(text: string, commands: PortableCommand[]): string {
    // References are already inserted inline during detection.
    // Just return the text (which already has [cmd:name.md] refs in-place).
    return text;
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

    // Replace [cmd:name.md] references with numbered [cmd1: name], [cmd2: name], etc.
    let formattedText = text;
    const commandPaths: string[] = [];

    commands.forEach((cmd, index) => {
      const cmdNum = index + 1;
      const refPattern = new RegExp(`\\[cmd:${cmd.name}\\.md\\]`, 'gi');
      formattedText = formattedText.replace(refPattern, `[cmd${cmdNum}: ${cmd.name}]`);
      commandPaths.push(`[cmd${cmdNum}: ${cmd.name}] ${cmd.filePath}`);
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

    await this.scanSharedCommandSources();
    this.watchSharedCommandSources();

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
            // Folder renames do not always report a markdown filename, but
            // they still change launcher folder rows and command paths.
            if (filename) await this.refresh();
          } catch (error) {
            log.error('Error handling file change:', error);
          }
        }
      );

      // Handle watcher errors gracefully - don't crash, commands still work
      watcher.on('error', () => {});
    } catch (error) {
      log.error(`Error starting directory watch for ${dirPath}:`, error);
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
    }
  }

  /**
   * Get all watched directories.
   */
  getWatchedDirs(): WatchedDir[] {
    return this.settings.watchedDirs.filter(dirPath => !this.isLegacyCommandsDirectoryPath(dirPath)).map(dirPath => ({
      path: dirPath,
      enabled: true,
      mobileSyncEnabled: this.settings.mobileSyncDirs.includes(dirPath),
    }));
  }

  /**
   * Add a directory to watch.
   * Returns the WatchedDir if successful, null if not found or already watched.
   */
  async addWatchedDir(dirPath: string): Promise<WatchedDir | null> {
    const expandedPath = this.expandPath(dirPath);
    const normalizedPath = this.normalizePath(expandedPath);

    if (this.isLegacyCommandsDirectoryPath(normalizedPath)) {
      this.removeLegacyCommandsDirectoryFromSettings(this.getDefaultDirectory());
      this.emit('commandsChanged', this.getCommands());
      return null;
    }

    // Check if directory exists
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }

    // Check if already watched
    if (this.settings.watchedDirs.includes(normalizedPath)) {
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

    return { path: normalizedPath, enabled: true, mobileSyncEnabled: false };
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
      const safePath = this.resolveWatchedCommandFile(filePath);
      if (!safePath) {
        return null;
      }

      const content = fs.readFileSync(safePath, 'utf-8');
      const stats = fs.statSync(safePath);
      const filename = path.basename(safePath);
      const nameWithoutExt = filename.replace(/\.(md|markdown)$/i, '');
      const displayName = nameWithoutExt;

      return {
        name: nameWithoutExt.toLowerCase(),
        filePath: safePath,
        displayName,
        lastModified: stats.mtimeMs,
        content,
        documentVersion: readDocumentVersion(safePath),
      };
    } catch (error) {
      log.error(`Error getting command by path ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Save/update a command's content.
   */
  saveCommand(filePath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    try {
      const safePath = this.resolveWatchedCommandFile(filePath);
      if (!safePath) return { ok: false, reason: 'not-found' };
      const result = writeTextFileWithConflictGuard(safePath, content, expectedVersion);
      if (result.ok) {
        this.updateCachedCommandFromFile(safePath);
        this.emit('commandsChanged', this.getCommands());
        log.info(`Saved command: ${safePath}`);
      }
      return result;
    } catch (error) {
      log.error(`Error saving command ${filePath}:`, error);
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * Create a new command file.
   * Returns the created command info if successful, null otherwise.
   */
  createCommand(directoryPath: string, name: string, content: string = ''): { path: string; name: string } | null {
    try {
      const directory = this.resolveWatchedCommandDirectory(directoryPath);
      const fileName = this.commandFileNameFromUserInput(name);
      if (!directory || !fileName) return null;

      const filePath = path.join(directory, fileName);
      if (!isPathInside(directory, filePath)) return null;

      // Check if file already exists
      if (fs.existsSync(filePath)) {
        return null;
      }

      // Create the file
      fs.writeFileSync(filePath, withCommandFrontmatter(content, commandTitleFromFileName(fileName)), 'utf-8');

      // Add to commands map immediately (don't wait for file watcher)
      const command = this.createCommandFromFile(filePath);
      if (command) {
        this.commands.set(command.name, command);
        this.emit('commandsChanged', this.getCommands());
      }

      log.info(`Created command: ${filePath}`);
      return { path: filePath, name: commandTitleFromFileName(fileName) };
    } catch (error) {
      log.error('Error creating command:', error);
      return null;
    }
  }

  /**
   * Delete a command file.
   */
  async deleteCommand(filePath: string): Promise<boolean> {
    try {
      const safePath = this.resolveWatchedCommandFile(filePath);
      if (!safePath) {
        return false;
      }

      await shell.trashItem(safePath);

      // Remove from commands map
      const command = Array.from(this.commands.values()).find(c => this.normalizePath(c.filePath) === this.normalizePath(safePath));
      if (command) {
        this.commands.delete(command.name);
        this.emit('commandsChanged', this.getCommands());
      }

      log.info(`Deleted command: ${safePath}`);
      return true;
    } catch (error) {
      log.error(`Error deleting command ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Rename a command file.
   * Returns the new file path if successful, null otherwise.
   */
  renameCommand(oldFilePath: string, newName: string): string | null {
    try {
      const safeOldPath = this.resolveWatchedCommandFile(oldFilePath);
      const newFileName = this.commandFileNameFromUserInput(newName);
      if (!safeOldPath || !newFileName) return null;

      const directory = path.dirname(safeOldPath);
      const newFilePath = path.join(directory, newFileName);
      if (!isPathInside(directory, newFilePath)) return null;

      // Check if target file already exists
      if (fs.existsSync(newFilePath)) {
        return null;
      }

      // Rename the file
      fs.renameSync(safeOldPath, newFilePath);
      this.syncCommandFrontmatterTitle(newFilePath, commandTitleFromFileName(newFileName));

      // Update commands map
      const oldCommand = Array.from(this.commands.values()).find(c => this.normalizePath(c.filePath) === this.normalizePath(safeOldPath));
      if (oldCommand) {
        this.commands.delete(oldCommand.name);
      }
      this.updateCachedCommandFromFile(newFilePath);
      this.emit('commandsChanged', this.getCommands());

      log.info(`Renamed command: ${oldFilePath} -> ${newFilePath}`);
      return newFilePath;
    } catch (error) {
      log.error(`Error renaming command ${oldFilePath}:`, error);
      return null;
    }
  }

  // =========================================================================
  // Mobile Sync Operations
  // =========================================================================

  /**
   * Enable or disable mobile sync for a watched directory.
   * When enabled, commands from this directory will be synced to Supabase
   * and available for voice invocation on mobile.
   */
  setMobileSyncEnabled(dirPath: string, enabled: boolean): boolean {
    const normalizedPath = this.normalizePath(dirPath);

    if (this.isLegacyCommandsDirectoryPath(normalizedPath)) {
      this.removeLegacyCommandsDirectoryFromSettings(this.getDefaultDirectory());
      return false;
    }

    // Check if this directory is watched
    if (!this.settings.watchedDirs.includes(normalizedPath)) {
      log.warn(`Cannot set mobile sync: ${normalizedPath} is not a watched directory`);
      return false;
    }

    const isCurrentlyEnabled = this.settings.mobileSyncDirs.includes(normalizedPath);

    if (enabled && !isCurrentlyEnabled) {
      // Enable mobile sync
      this.settings.mobileSyncDirs.push(normalizedPath);
      this.saveSettings();
      log.info(`Mobile sync enabled for: ${normalizedPath}`);
      this.emit('mobileSyncChanged', normalizedPath, true);
      return true;
    } else if (!enabled && isCurrentlyEnabled) {
      // Disable mobile sync
      const index = this.settings.mobileSyncDirs.indexOf(normalizedPath);
      this.settings.mobileSyncDirs.splice(index, 1);
      this.saveSettings();
      log.info(`Mobile sync disabled for: ${normalizedPath}`);
      this.emit('mobileSyncChanged', normalizedPath, false);
      return true;
    }

    return false; // No change needed
  }

  /**
   * Check if mobile sync is enabled for a directory.
   */
  isMobileSyncEnabled(dirPath: string): boolean {
    const normalizedPath = this.normalizePath(dirPath);
    if (this.isLegacyCommandsDirectoryPath(normalizedPath)) return false;
    return this.settings.mobileSyncDirs.includes(normalizedPath);
  }

  /**
   * Get all directories with mobile sync enabled.
   */
  getMobileSyncDirs(): string[] {
    return this.settings.mobileSyncDirs.filter(dirPath => !this.isLegacyCommandsDirectoryPath(dirPath));
  }

  /**
   * Compute SHA256 hash of content for change detection.
   */
  private computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Get all commands from mobile-sync-enabled directories, ready for Supabase sync.
   * Returns commands with their full content and metadata.
   */
  async getCommandsForMobileSync(): Promise<SyncableCommand[]> {
    const syncableCommands: SyncableCommand[] = [];

    // Only include commands from directories with mobile sync enabled
    for (const command of this.commands.values()) {
      if (this.isLegacyCommandPath(command.filePath)) continue;
      if (command.source === 'shared') continue;

      // Check if this command's directory has mobile sync enabled
      const commandDir = path.dirname(command.filePath);
      const isMobileSynced = this.getMobileSyncDirs().some(syncDir =>
        commandDir.startsWith(syncDir)
      );

      if (!isMobileSynced) {
        continue;
      }

      try {
        // Load the command content
        const content = fs.readFileSync(command.filePath, 'utf-8');
        const contentHash = this.computeContentHash(content);

        syncableCommands.push({
          name: command.name,
          displayName: command.displayName,
          content,
          sourcePath: command.filePath,
          contentHash,
        });
      } catch (error) {
        log.error(`Error reading command for mobile sync: ${command.filePath}`, error);
      }
    }

    log.debug(`Prepared ${syncableCommands.length} commands for mobile sync`);
    return syncableCommands;
  }

  /**
   * Get a single command with content by name.
   * Used for fetching command content when needed.
   */
  async getCommandWithContent(name: string): Promise<SyncableCommand | null> {
    const command = this.getCommand(name);
    if (!command) {
      return null;
    }

    try {
      const content = fs.readFileSync(command.filePath, 'utf-8');
      const contentHash = this.computeContentHash(content);

      return {
        name: command.name,
        displayName: command.displayName,
        content,
        sourcePath: command.filePath,
        contentHash,
      };
    } catch (error) {
      log.error(`Error reading command content: ${command.filePath}`, error);
      return null;
    }
  }

  // =========================================================================
  // Handoffs - Global session handoff files
  // =========================================================================

  /**
   * Get the global handoffs directory path.
   * Creates the directory if it doesn't exist.
   */
  getHandoffsDirectory(): string {
    const userDataPath = app.getPath('userData');
    const handoffsDir = path.join(userDataPath, 'handoffs');

    // Create directory if it doesn't exist
    if (!fs.existsSync(handoffsDir)) {
      try {
        fs.mkdirSync(handoffsDir, { recursive: true });
      } catch (error) {
        log.error('Error creating handoffs directory:', error);
      }
    }

    return handoffsDir;
  }

  /**
   * Get the 10 most recent handoff files, sorted by modification time.
   * Returns handoff info similar to PortableCommand for consistent handling.
   */
  async getHandoffs(limit: number = 10): Promise<PortableCommand[]> {
    const handoffsDir = this.getHandoffsDirectory();
    const handoffs: PortableCommand[] = [];

    try {
      if (!fs.existsSync(handoffsDir)) {
        return [];
      }

      const entries = fs.readdirSync(handoffsDir, { withFileTypes: true });

      // Collect all markdown files with their stats
      const filesWithStats: Array<{ entry: typeof entries[0]; stats: fs.Stats }> = [];

      for (const entry of entries) {
        if (entry.isFile() && this.isMarkdownFile(entry.name)) {
          try {
            const fullPath = path.join(handoffsDir, entry.name);
            const stats = fs.statSync(fullPath);
            filesWithStats.push({ entry, stats });
          } catch {
            // Skip files we can't stat
          }
        }
      }

      // Sort by modification time, most recent first
      filesWithStats.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

      // Take top N
      const topFiles = filesWithStats.slice(0, limit);

      for (const { entry, stats } of topFiles) {
        const fullPath = path.join(handoffsDir, entry.name);
        const nameWithoutExt = entry.name.replace(/\.(md|markdown)$/i, '');

        // Parse project path and date from filename
        // New format: "parent-project-2025-02-11-143022-handoff" (e.g., "fieldtheory-mac-app-2025-02-11-143022-handoff")
        // Old format: "project-2025-02-11-143022-handoff" (e.g., "mac-app-2025-02-11-143022-handoff")
        const match = nameWithoutExt.match(/^(.+?)-(\d{4})-(\d{2})-(\d{2})-(\d+)-handoff$/);
        let displayName: string;

        if (match) {
          const [, projectPath, year, month, day] = match;
          // Format: "↩ fieldtheory/mac-app · Feb 11"
          // Convert "fieldtheory-mac-app" to "fieldtheory/mac-app" for display
          const projectDisplay = projectPath.replace(/-([^-]+)$/, '/$1');
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          const shortDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          displayName = `↩ ${projectDisplay} · ${shortDate}`;
        } else {
          // Fallback: just use the filename without extension with prefix
          displayName = `↩ ${nameWithoutExt}`;
        }

        handoffs.push({
          name: nameWithoutExt.toLowerCase(),
          filePath: fullPath,
          displayName,
          lastModified: stats.mtimeMs,
        });
      }
    } catch (error) {
      log.error('Error reading handoffs directory:', error);
    }

    return handoffs;
  }

  /**
   * Load handoff content by file path.
   */
  async loadHandoffContent(filePath: string): Promise<LoadedCommand | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const filename = path.basename(filePath);
      const nameWithoutExt = filename.replace(/\.(md|markdown)$/i, '');

      return {
        name: nameWithoutExt,
        content,
        filePath,
      };
    } catch (error) {
      log.error(`Error loading handoff ${filePath}:`, error);
      return null;
    }
  }
}
