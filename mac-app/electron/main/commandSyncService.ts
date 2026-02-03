/**
 * CommandSyncService - Syncs portable commands to Supabase for mobile access.
 *
 * When users enable mobile sync for a commands directory, we:
 * 1. Upload command files (markdown content) to Supabase user_commands table
 * 2. Keep them in sync when files change (using content hash for change detection)
 * 3. Remove commands that no longer exist locally
 *
 * On mobile, the iOS app fetches these commands and can:
 * - Detect command invocations in transcribed text ("use the review command")
 * - Inline the full command content in the clipboard output
 */

import { AuthManager } from './authManager';
import { CommandsManager, SyncableCommand } from './commandsManager';
import { EventEmitter } from 'events';
import { createLogger } from './logger';

const log = createLogger('CommandSync');

/**
 * Command as stored in Supabase.
 */
interface RemoteCommand {
  id: string;
  user_id: string;
  name: string;
  display_name: string;
  content: string;
  source_path: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Sync result summary.
 */
export interface CommandSyncResult {
  success: boolean;
  uploaded: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export class CommandSyncService extends EventEmitter {
  private authManager: AuthManager;
  private commandsManager: CommandsManager;
  private isSyncing: boolean = false;
  private lastSyncAt: number | null = null;
  private pendingSyncTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 1000; // Debounce rapid changes
  private static readonly MIN_SYNC_INTERVAL_MS = 5000; // Don't sync more than once per 5 seconds

  constructor(authManager: AuthManager, commandsManager: CommandsManager) {
    super();
    this.authManager = authManager;
    this.commandsManager = commandsManager;

    // Listen for command changes to auto-sync
    this.commandsManager.on('commandsChanged', () => this.scheduleSync());
    this.commandsManager.on('mobileSyncChanged', () => this.scheduleSync());

    // Listen for auth changes
    this.authManager.on('sessionChanged', (session) => {
      if (session) {
        // When user logs in, sync commands if any are enabled for mobile
        this.scheduleSync();
      }
    });
  }

  /**
   * Schedule a sync with debouncing. Multiple rapid calls will be coalesced.
   */
  private scheduleSync(): void {
    // Clear any pending sync
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
    }

    // Schedule a new sync after debounce period
    this.pendingSyncTimeout = setTimeout(async () => {
      this.pendingSyncTimeout = null;
      await this.syncIfNeeded();
    }, CommandSyncService.DEBOUNCE_MS);
  }

  /**
   * Sync commands if there are any directories with mobile sync enabled.
   */
  private async syncIfNeeded(): Promise<void> {
    // Skip if we synced very recently (prevents duplicate syncs from multiple events)
    if (this.lastSyncAt && Date.now() - this.lastSyncAt < CommandSyncService.MIN_SYNC_INTERVAL_MS) {
      return;
    }

    const mobileSyncDirs = this.commandsManager.getMobileSyncDirs();
    if (mobileSyncDirs.length === 0) {
      return; // No directories have mobile sync enabled
    }

    await this.syncToSupabase();
  }

  /**
   * Check if authenticated and ready to sync.
   */
  isReady(): boolean {
    return this.authManager.isAuthenticated();
  }

  /**
   * Get the last sync timestamp.
   */
  getLastSyncAt(): number | null {
    return this.lastSyncAt;
  }

  /**
   * Sync all mobile-enabled commands to Supabase.
   */
  async syncToSupabase(): Promise<CommandSyncResult> {
    const result: CommandSyncResult = {
      success: false,
      uploaded: 0,
      updated: 0,
      deleted: 0,
      errors: [],
    };

    // Check authentication
    if (!this.authManager.isAuthenticated()) {
      result.errors.push('Not authenticated');
      return result;
    }

    // Prevent concurrent syncs
    if (this.isSyncing) {
      result.errors.push('Sync already in progress');
      return result;
    }

    this.isSyncing = true;
    this.emit('syncStarted');

    try {
      const supabase = this.authManager.getSupabaseClient();
      const session = this.authManager.getSession();
      if (!supabase || !session) {
        result.errors.push('No Supabase client or session');
        return result;
      }

      const userId = session.user.id;

      // Get local commands that should be synced
      const localCommands = await this.commandsManager.getCommandsForMobileSync();
      const localCommandMap = new Map(localCommands.map(c => [c.name, c]));

      // Get remote commands for this user
      const { data: remoteCommands, error: fetchError } = await supabase
        .from('user_commands')
        .select('*')
        .eq('user_id', userId);

      if (fetchError) {
        result.errors.push(`Failed to fetch remote commands: ${fetchError.message}`);
        return result;
      }

      const remoteCommandMap = new Map((remoteCommands || []).map((c: RemoteCommand) => [c.name, c]));

      // Find commands to upload (new) or update (changed)
      const toUpload: SyncableCommand[] = [];
      const toUpdate: { id: string; command: SyncableCommand }[] = [];

      for (const [name, localCmd] of localCommandMap) {
        const remoteCmd = remoteCommandMap.get(name) as RemoteCommand | undefined;
        if (!remoteCmd) {
          // New command
          toUpload.push(localCmd);
        } else if (remoteCmd.content_hash !== localCmd.contentHash) {
          // Content changed
          toUpdate.push({ id: remoteCmd.id, command: localCmd });
        }
        // If content_hash matches, no update needed
      }

      // Find commands to delete (exist remotely but not locally)
      const toDelete: string[] = [];
      for (const [name, remoteCmd] of remoteCommandMap) {
        if (!localCommandMap.has(name)) {
          toDelete.push((remoteCmd as RemoteCommand).id);
        }
      }

      // Upload new commands
      if (toUpload.length > 0) {
        const insertData = toUpload.map(cmd => ({
          user_id: userId,
          name: cmd.name,
          display_name: cmd.displayName,
          content: cmd.content,
          source_path: cmd.sourcePath,
          content_hash: cmd.contentHash,
        }));

        const { error: insertError } = await supabase
          .from('user_commands')
          .insert(insertData);

        if (insertError) {
          result.errors.push(`Failed to upload commands: ${insertError.message}`);
        } else {
          result.uploaded = toUpload.length;
          log.info(`Uploaded ${toUpload.length} new commands`);
        }
      }

      // Update changed commands
      for (const { id, command } of toUpdate) {
        const { error: updateError } = await supabase
          .from('user_commands')
          .update({
            display_name: command.displayName,
            content: command.content,
            source_path: command.sourcePath,
            content_hash: command.contentHash,
          })
          .eq('id', id);

        if (updateError) {
          result.errors.push(`Failed to update command ${command.name}: ${updateError.message}`);
        } else {
          result.updated++;
        }
      }
      if (result.updated > 0) {
        log.info(`Updated ${result.updated} commands`);
      }

      // Delete removed commands
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('user_commands')
          .delete()
          .in('id', toDelete);

        if (deleteError) {
          result.errors.push(`Failed to delete commands: ${deleteError.message}`);
        } else {
          result.deleted = toDelete.length;
          log.debug(`Deleted ${toDelete.length} commands`);
        }
      }

      result.success = result.errors.length === 0;
      this.lastSyncAt = Date.now();

      if (result.success) {
        log.debug('Command sync completed');
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(message);
      log.error('Command sync failed:', error);
    } finally {
      this.isSyncing = false;
      this.emit('syncCompleted', result);
    }

    return result;
  }

  /**
   * Delete all synced commands from Supabase.
   * Called when user disables all mobile sync.
   */
  async deleteAllRemoteCommands(): Promise<boolean> {
    if (!this.authManager.isAuthenticated()) {
      return false;
    }

    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session) {
      return false;
    }

    try {
      const { error } = await supabase
        .from('user_commands')
        .delete()
        .eq('user_id', session.user.id);

      if (error) {
        log.error('Failed to delete remote commands:', error);
        return false;
      }

      log.info('Deleted all remote commands');
      return true;
    } catch (error) {
      log.error('Error deleting remote commands:', error);
      return false;
    }
  }

  /**
   * Get count of commands currently synced to Supabase.
   */
  async getRemoteCommandCount(): Promise<number> {
    if (!this.authManager.isAuthenticated()) {
      return 0;
    }

    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();
    if (!supabase || !session) {
      return 0;
    }

    try {
      const { count, error } = await supabase
        .from('user_commands')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id);

      if (error) {
        return 0;
      }

      return count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
      this.pendingSyncTimeout = null;
    }
    this.commandsManager.removeAllListeners('commandsChanged');
    this.commandsManager.removeAllListeners('mobileSyncChanged');
    this.removeAllListeners();
  }
}
