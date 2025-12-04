/**
 * MobileSync - Syncs mobile transcriptions from Supabase to local clipboard history.
 * 
 * When a user records a transcription on their iOS device, it syncs to Supabase.
 * This module fetches those transcriptions and adds them to the Mac clipboard history
 * with source='ios', so they appear in the clipboard timeline ordered by their
 * original recording timestamp.
 */

import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { ClipboardManager } from './clipboardManager';
import { PreferencesManager } from './preferences';

/**
 * Row from the Supabase transcripts table.
 */
interface TranscriptRow {
  id: string;
  user_id: string;
  text: string;
  client_id: string;
  client_created_at_ms: number;
  updated_at: string;
}

/**
 * Preferences for mobile sync feature.
 */
interface MobileSyncConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  lastSyncedAt?: number;
  syncEnabled?: boolean;
}

/**
 * Manages syncing mobile transcriptions to local clipboard history.
 * Periodically fetches new transcripts from Supabase and inserts them
 * as 'transcript' type items with source='ios'.
 */
export class MobileSync {
  private clipboardManager: ClipboardManager;
  private preferences: PreferencesManager;
  private supabase: SupabaseClient | null = null;
  private session: Session | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncedAt: number = 0;
  private syncEnabled: boolean = true;

  // Track which client_ids we've already synced to avoid duplicates.
  // The content hash in clipboard also prevents true duplicates, but this
  // lets us skip the DB call entirely for known items.
  private syncedClientIds: Set<string> = new Set();

  constructor(clipboardManager: ClipboardManager, preferences: PreferencesManager) {
    this.clipboardManager = clipboardManager;
    this.preferences = preferences;
  }

  /**
   * Initialize the sync module with Supabase credentials.
   * Call this after preferences are loaded.
   */
  async init(supabaseUrl?: string, supabaseAnonKey?: string): Promise<void> {
    // Use provided credentials or fall back to environment variables.
    const url = supabaseUrl || process.env.VITE_SUPABASE_URL;
    const anonKey = supabaseAnonKey || process.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      console.log('[MobileSync] No Supabase credentials available, sync disabled');
      return;
    }

    this.supabase = createClient(url, anonKey, {
      auth: {
        persistSession: false, // Main process doesn't persist sessions; we get them from renderer.
        autoRefreshToken: true,
      },
    });

    console.log('[MobileSync] Initialized with Supabase client');
  }

  /**
   * Set the authenticated session from the renderer process.
   * This allows the main process to make authenticated Supabase calls.
   */
  async setSession(accessToken: string, refreshToken: string): Promise<void> {
    if (!this.supabase) {
      console.warn('[MobileSync] Cannot set session - Supabase not initialized');
      return;
    }

    const { data, error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('[MobileSync] Failed to set session:', error);
      return;
    }

    this.session = data.session;
    console.log('[MobileSync] Session set for user:', this.session?.user?.email);

    // Start periodic sync now that we're authenticated.
    this.startPeriodicSync();
  }

  /**
   * Clear the session (e.g., when user signs out).
   */
  clearSession(): void {
    this.session = null;
    this.stopPeriodicSync();
    console.log('[MobileSync] Session cleared');
  }

  /**
   * Enable or disable sync.
   */
  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
    if (enabled && this.session) {
      this.startPeriodicSync();
    } else if (!enabled) {
      this.stopPeriodicSync();
    }
    console.log(`[MobileSync] Sync ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if sync is currently enabled.
   */
  isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  /**
   * Start periodic sync (every 30 seconds).
   * Also runs an immediate sync.
   */
  private startPeriodicSync(): void {
    if (this.syncInterval) {
      return; // Already running.
    }

    // Run immediate sync.
    this.syncTranscripts().catch(err => {
      console.error('[MobileSync] Initial sync failed:', err);
    });

    // Then sync every 30 seconds.
    this.syncInterval = setInterval(() => {
      if (!this.syncEnabled || !this.session) {
        return;
      }
      this.syncTranscripts().catch(err => {
        console.error('[MobileSync] Periodic sync failed:', err);
      });
    }, 30000);

    console.log('[MobileSync] Periodic sync started');
  }

  /**
   * Stop periodic sync.
   */
  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[MobileSync] Periodic sync stopped');
    }
  }

  /**
   * Fetch new transcripts from Supabase and add to clipboard history.
   * Only fetches transcripts newer than the last sync.
   */
  async syncTranscripts(): Promise<number> {
    if (!this.supabase || !this.session) {
      return 0;
    }

    try {
      // Fetch transcripts updated since last sync.
      // We use updated_at to catch edits, but client_created_at_ms for the actual timestamp.
      let query = this.supabase
        .from('transcripts')
        .select('*')
        .order('client_created_at_ms', { ascending: false });

      // If we've synced before, only fetch newer items.
      if (this.lastSyncedAt > 0) {
        // Use a small overlap window (1 minute) to catch any edge cases.
        const overlapMs = 60000;
        query = query.gt('client_created_at_ms', this.lastSyncedAt - overlapMs);
      } else {
        // First sync - limit to last 7 days to avoid importing huge backlog.
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        query = query.gt('client_created_at_ms', sevenDaysAgo);
      }

      const { data: transcripts, error } = await query;

      if (error) {
        throw error;
      }

      if (!transcripts || transcripts.length === 0) {
        return 0;
      }

      let syncedCount = 0;
      let latestTimestamp = this.lastSyncedAt;

      for (const transcript of transcripts as TranscriptRow[]) {
        // Skip if we've already synced this client_id.
        if (this.syncedClientIds.has(transcript.client_id)) {
          continue;
        }

        // Insert into clipboard history with source='ios'.
        // Use createdAtOverride to preserve the original recording timestamp.
        const itemId = await this.clipboardManager.storeText(
          transcript.text,
          'transcript',
          undefined, // No source app for iOS items.
          undefined, // No stack ID.
          'ios',
          transcript.client_created_at_ms
        );

        if (itemId > 0) {
          this.syncedClientIds.add(transcript.client_id);
          syncedCount++;
        }

        // Track latest timestamp for next sync.
        if (transcript.client_created_at_ms > latestTimestamp) {
          latestTimestamp = transcript.client_created_at_ms;
        }
      }

      // Update last synced timestamp.
      if (latestTimestamp > this.lastSyncedAt) {
        this.lastSyncedAt = latestTimestamp;
      }

      if (syncedCount > 0) {
        console.log(`[MobileSync] Synced ${syncedCount} new transcripts from iOS`);
      }

      return syncedCount;
    } catch (error) {
      console.error('[MobileSync] Failed to sync transcripts:', error);
      throw error;
    }
  }

  /**
   * Force a full sync, ignoring the last synced timestamp.
   * Useful for debugging or when the user wants to re-sync.
   */
  async forceSyncAll(): Promise<number> {
    this.lastSyncedAt = 0;
    this.syncedClientIds.clear();
    return this.syncTranscripts();
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.stopPeriodicSync();
    this.session = null;
    console.log('[MobileSync] Destroyed');
  }
}
