/**
 * MetricsManager - User-visible usage metrics tracking.
 *
 * Philosophy: "The metrics you see are the metrics we see."
 * Users can view their own stats in Settings. We aggregate the same metrics
 * for product understanding. Nothing hidden.
 *
 * All 16 metrics tracked:
 * - Transcription: transcriptions, words_transcribed, priority_mic_minutes
 * - Voice: verbal_commands, command_launcher_uses
 * - Clipboard: clipboard_items, pastes_used, stacks_created, autostacks_created
 * - Creative: sketches_created, screenshots_taken
 * - Librarian: librarian_artifacts_created, librarian_artifacts_shared
 * - Commands: commands_executed, commands_contributed
 * - Community: feedback_given
 */

import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { AuthManager } from './authManager';
import { Session } from '@supabase/supabase-js';

// =============================================================================
// Types
// =============================================================================

/**
 * All tracked metrics - running totals.
 */
export interface UserMetrics {
  // Transcription
  transcriptions: number;
  words_transcribed: number;
  priority_mic_minutes: number;

  // Voice commands
  verbal_commands: number;
  command_launcher_uses: number;

  // Clipboard
  clipboard_items: number;
  pastes_used: number;
  stacks_created: number;
  autostacks_created: number;
  stacks_pasted: number;
  items_added_to_context: number;

  // Creative
  sketches_created: number;
  screenshots_taken: number;

  // Librarian
  librarian_artifacts_created: number;
  librarian_artifacts_shared: number;

  // Commands
  commands_executed: number;
  commands_contributed: number;

  // Community
  feedback_given: number;
}

/**
 * Local storage format with sync metadata.
 */
interface LocalMetricsStorage {
  metrics: UserMetrics;
  lastSyncedAt: string | null;  // ISO timestamp
  pendingSync: boolean;         // Has changes since last sync
}

// =============================================================================
// MetricsManager
// =============================================================================

export class MetricsManager {
  private authManager: AuthManager;
  private localPath: string;
  private storage: LocalMetricsStorage;
  private syncInterval: NodeJS.Timeout | null = null;
  private boundHandleSessionChanged: (session: Session | null) => void;

  private static readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // Sync every 5 minutes
  private static readonly DEFAULT_METRICS: UserMetrics = {
    transcriptions: 0,
    words_transcribed: 0,
    priority_mic_minutes: 0,
    verbal_commands: 0,
    command_launcher_uses: 0,
    clipboard_items: 0,
    pastes_used: 0,
    stacks_created: 0,
    autostacks_created: 0,
    stacks_pasted: 0,
    items_added_to_context: 0,
    sketches_created: 0,
    screenshots_taken: 0,
    librarian_artifacts_created: 0,
    librarian_artifacts_shared: 0,
    commands_executed: 0,
    commands_contributed: 0,
    feedback_given: 0,
  };

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
    this.localPath = path.join(app.getPath('userData'), 'user-metrics.json');
    this.storage = {
      metrics: { ...MetricsManager.DEFAULT_METRICS },
      lastSyncedAt: null,
      pendingSync: false,
    };

    this.boundHandleSessionChanged = this.handleSessionChanged.bind(this);
    this.authManager.on('sessionChanged', this.boundHandleSessionChanged);
  }

  /**
   * Initialize the metrics manager - load local storage.
   */
  async init(): Promise<void> {
    await this.loadFromDisk();
    this.startSyncInterval();
    console.log('[MetricsManager] Initialized');
  }

  // ===========================================================================
  // Local Storage
  // ===========================================================================

  /**
   * Load metrics from local disk.
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.localPath, 'utf-8');
      const parsed = JSON.parse(data) as LocalMetricsStorage;
      this.storage = {
        metrics: { ...MetricsManager.DEFAULT_METRICS, ...parsed.metrics },
        lastSyncedAt: parsed.lastSyncedAt || null,
        pendingSync: parsed.pendingSync || false,
      };
      console.log('[MetricsManager] Loaded metrics from disk');
    } catch (error) {
      // File doesn't exist or is invalid, use defaults
      console.log('[MetricsManager] Using default metrics');
    }
  }

  /**
   * Save metrics to local disk.
   */
  private async saveToDisk(): Promise<void> {
    try {
      await fs.writeFile(this.localPath, JSON.stringify(this.storage, null, 2), 'utf-8');
    } catch (error) {
      console.error('[MetricsManager] Failed to save metrics:', error);
    }
  }

  // ===========================================================================
  // Metric Increment Methods
  // ===========================================================================

  /**
   * Increment a metric by a given amount.
   * Fire-and-forget - no awaiting needed.
   */
  increment(metric: keyof UserMetrics, amount: number = 1): void {
    this.storage.metrics[metric] += amount;
    this.storage.pendingSync = true;
    // Save async without blocking
    this.saveToDisk().catch(() => {});
  }

  /**
   * Convenience methods for common operations.
   */
  recordTranscription(wordCount: number): void {
    this.increment('transcriptions');
    this.increment('words_transcribed', wordCount);
  }

  recordPriorityMicMinute(): void {
    this.increment('priority_mic_minutes');
  }

  recordVerbalCommand(): void {
    this.increment('verbal_commands');
  }

  recordCommandLauncherUse(): void {
    this.increment('command_launcher_uses');
  }

  recordClipboardItem(): void {
    this.increment('clipboard_items');
  }

  recordPaste(): void {
    this.increment('pastes_used');
  }

  recordStackCreated(): void {
    this.increment('stacks_created');
  }

  recordAutostackCreated(): void {
    this.increment('autostacks_created');
  }

  recordStackPasted(itemCount: number): void {
    this.increment('stacks_pasted');
    this.increment('items_added_to_context', itemCount);
  }

  recordSketchCreated(): void {
    this.increment('sketches_created');
  }

  recordScreenshot(): void {
    this.increment('screenshots_taken');
  }

  recordLibrarianArtifactCreated(): void {
    this.increment('librarian_artifacts_created');
  }

  recordLibrarianArtifactShared(): void {
    this.increment('librarian_artifacts_shared');
  }

  recordCommandExecuted(): void {
    this.increment('commands_executed');
  }

  recordCommandContributed(): void {
    this.increment('commands_contributed');
  }

  recordFeedbackGiven(): void {
    this.increment('feedback_given');
  }

  // ===========================================================================
  // Get Metrics (for UI display)
  // ===========================================================================

  /**
   * Get current metrics for display in Settings.
   */
  getMetrics(): UserMetrics {
    return { ...this.storage.metrics };
  }

  /**
   * Get metrics with sync status.
   */
  getMetricsWithStatus(): { metrics: UserMetrics; lastSyncedAt: string | null; pendingSync: boolean } {
    return {
      metrics: { ...this.storage.metrics },
      lastSyncedAt: this.storage.lastSyncedAt,
      pendingSync: this.storage.pendingSync,
    };
  }

  // ===========================================================================
  // Supabase Sync
  // ===========================================================================

  /**
   * Handle session changes - sync on login.
   */
  private handleSessionChanged(session: Session | null): void {
    if (session && this.storage.pendingSync) {
      // User logged in and we have pending changes - sync
      this.syncToSupabase().catch((err) => {
        console.error('[MetricsManager] Sync on session change failed:', err);
      });
    }
  }

  /**
   * Start periodic sync interval.
   */
  private startSyncInterval(): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      if (this.storage.pendingSync && this.authManager.isAuthenticated()) {
        this.syncToSupabase().catch((err) => {
          console.error('[MetricsManager] Periodic sync failed:', err);
        });
      }
    }, MetricsManager.SYNC_INTERVAL_MS);
  }

  /**
   * Sync metrics to Supabase.
   * Uses upsert to create or update the user's row.
   */
  async syncToSupabase(): Promise<boolean> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();

    if (!supabase || !session?.user?.id) {
      return false;
    }

    try {
      const { error } = await supabase
        .from('user_metrics')
        .upsert({
          user_id: session.user.id,
          ...this.storage.metrics,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (error) {
        // Table might not exist yet - that's OK
        if (error.code === '42P01') {
          console.log('[MetricsManager] user_metrics table not found - sync skipped');
          return false;
        }
        console.error('[MetricsManager] Sync failed:', error);
        return false;
      }

      this.storage.lastSyncedAt = new Date().toISOString();
      this.storage.pendingSync = false;
      await this.saveToDisk();

      console.log('[MetricsManager] Synced to Supabase');
      return true;
    } catch (err) {
      console.error('[MetricsManager] Sync error:', err);
      return false;
    }
  }

  /**
   * Fetch metrics from Supabase (to sync across devices).
   * Takes the maximum of local and remote values for each metric.
   */
  async fetchFromSupabase(): Promise<boolean> {
    const supabase = this.authManager.getSupabaseClient();
    const session = this.authManager.getSession();

    if (!supabase || !session?.user?.id) {
      return false;
    }

    try {
      const { data, error } = await supabase
        .from('user_metrics')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No row exists yet - that's OK
          return true;
        }
        if (error.code === '42P01') {
          // Table doesn't exist yet - that's OK
          return false;
        }
        console.error('[MetricsManager] Fetch failed:', error);
        return false;
      }

      if (data) {
        // Merge: take max of local and remote for each metric
        const metricKeys = Object.keys(MetricsManager.DEFAULT_METRICS) as (keyof UserMetrics)[];
        for (const key of metricKeys) {
          const remoteValue = data[key] as number | undefined;
          if (typeof remoteValue === 'number') {
            this.storage.metrics[key] = Math.max(this.storage.metrics[key], remoteValue);
          }
        }
        await this.saveToDisk();
        console.log('[MetricsManager] Merged with Supabase data');
      }

      return true;
    } catch (err) {
      console.error('[MetricsManager] Fetch error:', err);
      return false;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Sync and cleanup before app closes.
   */
  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    // Final sync attempt
    if (this.storage.pendingSync && this.authManager.isAuthenticated()) {
      await this.syncToSupabase();
    }

    await this.saveToDisk();
    this.authManager.removeListener('sessionChanged', this.boundHandleSessionChanged);
    console.log('[MetricsManager] Shutdown complete');
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.authManager.removeListener('sessionChanged', this.boundHandleSessionChanged);
    console.log('[MetricsManager] Destroyed');
  }
}
