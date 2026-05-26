/**
 * UserDataManager - Central manager for user-specific data paths.
 *
 * Handles per-account data isolation by organizing files into user-specific
 * subdirectories keyed by callsign (e.g., "KJN-BKT").
 *
 * Directory structure:
 * ~/Library/Application Support/Field Theory/
 * ├── models/                    # Shared (large downloads)
 * ├── llm-models/                # Shared (large downloads)
 * └── users/
 *     └── {callsign}/            # Per-user data
 *         ├── preferences.json
 *         ├── clipboard.db
 *         └── ...
 *
 * ~/.fieldtheory/
 * └── users/
 *     └── {callsign}/
 *         └── librarian/
 */

import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { createLogger } from './logger';

const log = createLogger('UserData');

function getStoredSessionUserId(userDataPath: string): string | null {
  const sessionPath = path.join(userDataPath, 'supabase-session.json');
  try {
    if (!fs.existsSync(sessionPath)) return null;

    const diskData = fs.readJsonSync(sessionPath) as Record<string, unknown>;
    for (const value of Object.values(diskData)) {
      if (typeof value !== 'string') continue;

      const parsed = JSON.parse(value) as { user?: { id?: unknown } };
      if (typeof parsed.user?.id === 'string' && parsed.user.id.trim().length > 0) {
        return parsed.user.id;
      }
    }
  } catch (err) {
    log.warn('Failed to restore user from stored session:', err);
  }

  return null;
}

export class UserDataManager extends EventEmitter {
  private currentCallsign: string | null = null;
  private baseUserDataPath: string;
  private baseFieldTheoryPath: string;

  constructor() {
    super();
    this.baseUserDataPath = app.getPath('userData');
    this.baseFieldTheoryPath = path.join(os.homedir(), '.fieldtheory');
  }

  /**
   * Get the current user's callsign.
   */
  getCurrentCallsign(): string | null {
    return this.currentCallsign;
  }

  /**
   * Check if a user is currently logged in.
   */
  isLoggedIn(): boolean {
    return this.currentCallsign !== null;
  }

  /**
   * Get path for user-specific data in Application Support.
   * @param subpath - Optional subpath within user directory
   * @throws Error if no user is logged in
   */
  getUserDataPath(subpath?: string): string {
    if (!this.currentCallsign) {
      throw new Error('No user logged in - cannot get user data path');
    }
    const userDir = path.join(this.baseUserDataPath, 'users', this.currentCallsign);
    return subpath ? path.join(userDir, subpath) : userDir;
  }

  /**
   * Get path for user-specific data in ~/.fieldtheory.
   * @param subpath - Optional subpath within user directory
   * @throws Error if no user is logged in
   */
  getFieldTheoryPath(subpath?: string): string {
    if (!this.currentCallsign) {
      throw new Error('No user logged in - cannot get fieldtheory path');
    }
    const userDir = path.join(this.baseFieldTheoryPath, 'users', this.currentCallsign);
    return subpath ? path.join(userDir, subpath) : userDir;
  }

  /**
   * Get path for shared data (models, caches).
   * @param subpath - Optional subpath within shared directory
   */
  getSharedDataPath(subpath?: string): string {
    return subpath ? path.join(this.baseUserDataPath, subpath) : this.baseUserDataPath;
  }

  /**
   * Set the current user by callsign. Called on login.
   * Creates user directories if they don't exist.
   */
  async setCurrentUser(callsign: string): Promise<void> {
    if (!callsign || typeof callsign !== 'string') {
      throw new Error('Invalid callsign');
    }

    // Store previous callsign for comparison
    const previousCallsign = this.currentCallsign;
    this.currentCallsign = callsign;

    // Ensure user directories exist
    const userDataDir = this.getUserDataPath();
    const fieldTheoryDir = this.getFieldTheoryPath();

    await fs.ensureDir(userDataDir);
    await fs.ensureDir(fieldTheoryDir);

    // Save current user to file for session persistence
    const currentUserFile = path.join(this.baseUserDataPath, 'current-user.json');
    await fs.writeJson(currentUserFile, { callsign }, { spaces: 2 });

    // Emit event for other managers to reload data
    if (previousCallsign !== callsign) {
      this.emit('user-changed', callsign);
    }
  }

  /**
   * Clear the current user. Called on logout.
   */
  async clearCurrentUser(): Promise<void> {
    this.currentCallsign = null;

    // Remove current user file
    const currentUserFile = path.join(this.baseUserDataPath, 'current-user.json');
    await fs.remove(currentUserFile).catch(() => {});

    // Emit event for other managers to clear state
    this.emit('user-logged-out');
  }

  /**
   * Permanently delete all local data for the current user.
   * Called on account deletion for GDPR compliance (right to erasure).
   * DANGER: This is irreversible and deletes all user preferences, figures, etc.
   * @returns true if deletion succeeded, false if no user was logged in
   */
  async deleteCurrentUserData(): Promise<boolean> {
    const callsign = this.currentCallsign;
    if (!callsign) {
      return false;
    }

    // Get paths BEFORE clearing current user
    const userDataDir = path.join(this.baseUserDataPath, 'users', callsign);
    const fieldTheoryDir = path.join(this.baseFieldTheoryPath, 'users', callsign);

    // Clear current user state first
    await this.clearCurrentUser();

    // Delete user directories
    try {
      if (await fs.pathExists(userDataDir)) {
        await fs.remove(userDataDir);
      }
    } catch (err) {
      console.error('[UserDataManager] Failed to delete user data dir:', err);
    }

    try {
      if (await fs.pathExists(fieldTheoryDir)) {
        await fs.remove(fieldTheoryDir);
      }
    } catch (err) {
      console.error('[UserDataManager] Failed to delete fieldtheory dir:', err);
    }

    return true;
  }

  /**
   * Try to restore the current user from saved file.
   * Called on app startup before auth check.
   * @returns The restored callsign, or null if none saved
   */
  async restoreCurrentUser(): Promise<string | null> {
    const currentUserFile = path.join(this.baseUserDataPath, 'current-user.json');

    try {
      const data = await fs.readJson(currentUserFile);
      if (data?.callsign) {
        this.currentCallsign = data.callsign;
        return this.currentCallsign;
      }
    } catch {
      // No saved user or invalid file
    }

    const sessionUserId = getStoredSessionUserId(this.baseUserDataPath);
    if (sessionUserId) {
      await this.setCurrentUser(sessionUserId);
      await this.migrateExistingData(sessionUserId);
      return sessionUserId;
    }

    return null;
  }

  /**
   * Migrate existing legacy data to user's directory.
   * Called on first login after update to per-user data structure.
   *
   * Migration rules:
   * - Only migrates if user directory doesn't exist yet
   * - Only migrates if no other users exist (first user gets legacy data)
   * - Moves files, doesn't copy (atomic, no data duplication)
   */
  async migrateExistingData(callsign: string): Promise<void> {
    const userDir = path.join(this.baseUserDataPath, 'users', callsign);

    // Skip if user directory already exists
    if (await fs.pathExists(userDir)) {
      return;
    }

    // Check if this is the first user (no other users exist)
    const usersDir = path.join(this.baseUserDataPath, 'users');
    let existingUsers: string[] = [];
    try {
      existingUsers = await fs.readdir(usersDir);
      // Filter out hidden files like .DS_Store
      existingUsers = existingUsers.filter(f => !f.startsWith('.'));
    } catch {
      // users directory doesn't exist yet
    }

    if (existingUsers.length > 0) {
      await fs.ensureDir(userDir);
      return;
    }

    // Check if legacy data exists
    const legacyPrefs = path.join(this.baseUserDataPath, 'preferences.json');
    const hasLegacyData = await fs.pathExists(legacyPrefs);

    if (!hasLegacyData) {
      await fs.ensureDir(userDir);
      return;
    }

    // Files to migrate from Application Support
    const filesToMigrate = [
      'preferences.json',
      'clipboard.db',
      'clipboard.db-wal',
      'clipboard.db-shm',
      'user-metrics.json',
      'librarian-settings.json',
      'librarian-index.json',
      'commands-settings.json',
    ];

    await fs.ensureDir(userDir);

    for (const file of filesToMigrate) {
      const src = path.join(this.baseUserDataPath, file);
      const dst = path.join(userDir, file);
      if (await fs.pathExists(src)) {
        try {
          await fs.move(src, dst);
        } catch (err) {
          log.error(`Failed to migrate ${file}:`, err);
        }
      }
    }

    // Migrate figures directory
    const figuresSrc = path.join(this.baseUserDataPath, 'figures');
    const figuresDst = path.join(userDir, 'figures');
    if (await fs.pathExists(figuresSrc)) {
      try {
        await fs.move(figuresSrc, figuresDst);
      } catch (err) {
        log.error('Failed to migrate figures/', err);
      }
    }

    // Migrate ~/.fieldtheory/librarian to user-specific location
    const librarianSrc = path.join(this.baseFieldTheoryPath, 'librarian');
    const librarianDst = path.join(this.baseFieldTheoryPath, 'users', callsign, 'librarian');
    if (await fs.pathExists(librarianSrc)) {
      try {
        await fs.ensureDir(path.dirname(librarianDst));
        await fs.move(librarianSrc, librarianDst);
      } catch (err) {
        log.error('Failed to migrate librarian/', err);
      }
    }

  }
}

// Singleton instance
let userDataManagerInstance: UserDataManager | null = null;

export function getUserDataManager(): UserDataManager {
  if (!userDataManagerInstance) {
    userDataManagerInstance = new UserDataManager();
  }
  return userDataManagerInstance;
}

export function createUserDataManager(): UserDataManager {
  userDataManagerInstance = new UserDataManager();
  return userDataManagerInstance;
}
